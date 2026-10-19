"""Builds agent_runs.ipynb. Run: python build_notebook.py && jupyter nbconvert --execute --inplace agent_runs.ipynb"""
import nbformat as nbf

nb = nbf.v4.new_notebook()
md = lambda s: nbf.v4.new_markdown_cell(s)
code = lambda s: nbf.v4.new_code_cell(s)

nb.cells = [
md("""# Agent run analysis

Reads the traces the agent writes to PostgreSQL (`agent_runs`, `agent_steps`) and the evaluation
reports in `backend/eval/results/`, then:

1. summarizes each evaluation run,
2. groups failures by type (wrong column, bad join, wrong filter, empty result, timeout, ...),
3. plots latency distributions and error rates by step,
4. compares configurations with McNemar's paired test.

Set `DATABASE_URL` to the database the evaluation ran against (default: local development)."""),
code("""import glob, json, os, re
import pandas as pd
import matplotlib.pyplot as plt
import psycopg
from statsmodels.stats.contingency_tables import mcnemar

pd.set_option('display.max_colwidth', 120)
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://datacollab:datacollab@localhost:5432/datacollab')
RESULTS = sorted(glob.glob('../backend/eval/results/*profiles*.json'))
with psycopg.connect(DATABASE_URL) as conn:
    runs = pd.read_sql("SELECT * FROM agent_runs WHERE source = 'eval'", conn)
    steps = pd.read_sql(
        "SELECT s.* FROM agent_steps s JOIN agent_runs r ON r.id = s.run_id WHERE r.source = 'eval'", conn)
print(len(runs), 'eval runs traced,', len(steps), 'steps;', len(RESULTS), 'report files')"""),
md("## 1. Evaluation runs"),
code("""reports = {}
rows = []
for path in RESULTS:
    rep = json.load(open(path))
    label = rep['label']
    reports[label] = pd.DataFrame(rep['results']).set_index('id')
    s = rep['summary']['all']
    rows.append({'run': label, 'model': rep['model'], 'n': s['n'], 'correct': s['correct'], 'wrong': s['wrong'],
                 'error': s['error'], 'accuracy': round(100 * s['accuracy'], 1),
                 'hard_accuracy': round(100 * rep['summary']['hard']['accuracy'], 1),
                 'median_latency_s': round(s['medianLatencyMs'] / 1000, 1), 'mean_attempts': round(s['meanAttempts'], 2)})
summary = pd.DataFrame(rows).set_index('run')
summary"""),
md("""## 2. Failure types

Failures are classified from the trace of the final attempt and the scored result:

| Type | Rule |
|---|---|
| `timeout` | the query hit the 5 s statement timeout |
| `wrong_column` | database error "column ... does not exist" |
| `bad_join` | database error "relation ... does not exist" / missing FROM, or the SQL joins and the result is wrong |
| `syntax_or_other_error` | any other database or parser error |
| `empty_result` | query ran but returned 0 rows when the reference has rows |
| `wrong_row_count` | different number of rows: usually a wrong filter or grouping |
| `wrong_values` | same shape, different values: wrong aggregate, double counting, or wrong filter |"""),
code("""def last_error(run_id):
    s = steps[(steps.run_id == run_id) & (steps.step_type == 'run_sql') & steps.error.notna()]
    return s.sort_values('step_index').error.iloc[-1] if len(s) else None

def classify(r):
    if r.verdict == 'correct':
        return 'correct'
    err = (last_error(r.runId) or r.reason or '') if r.verdict == 'error' else ''
    sql = (r.predictedSql or '').lower()
    if r.verdict == 'error':
        if 'timed out' in err.lower() or 'timeout' in err.lower(): return 'timeout'
        if re.search(r'column .* does not exist', err): return 'wrong_column'
        if re.search(r'relation .* does not exist|missing from-clause', err): return 'bad_join'
        return 'syntax_or_other_error'
    if r.predictedRows == 0 and r.referenceRows > 0: return 'empty_result'
    if ' join ' in sql: return 'bad_join'
    if r.predictedRows != r.referenceRows: return 'wrong_row_count'
    return 'wrong_values'

types = pd.DataFrame({label: df.apply(classify, axis=1) for label, df in reports.items()})
counts = types.apply(pd.Series.value_counts).fillna(0).astype(int).drop('correct', errors='ignore')
ax = counts.T.plot.bar(stacked=True, figsize=(9, 4), title='Failures by type and run (out of 40 questions)')
ax.set_ylabel('questions'); ax.set_xlabel(''); plt.xticks(rotation=20, ha='right'); plt.tight_layout(); plt.show()
counts"""),
code("""# Questions every configuration got wrong, with the SQL the best configuration produced.
always_wrong = types[(types != 'correct').all(axis=1)].index
best = summary.accuracy.idxmax()
reports[best].loc[always_wrong, ['question', 'predictedSql']]"""),
md("## 3. Latency and error rates"),
code("""fig, axes = plt.subplots(1, 2, figsize=(12, 4))
lat = pd.DataFrame({label: df.latencyMs / 1000 for label, df in reports.items()})
lat.plot.box(ax=axes[0], rot=20, title='End-to-end latency per question (s)')
axes[0].set_ylabel('seconds')
step_lat = steps[steps.step_type.isin(['plan', 'write_sql', 'run_sql', 'answer'])]
step_lat.boxplot(column='latency_ms', by='step_type', ax=axes[1])
axes[1].set_title('Latency by agent step (ms)'); axes[1].set_yscale('log'); axes[1].set_xlabel('')
plt.suptitle(''); plt.tight_layout(); plt.show()
steps.groupby('step_type').latency_ms.describe(percentiles=[0.5, 0.95]).round(0)"""),
code("""# Error rate of SQL execution by attempt number: how often retries fix things.
sql_steps = steps[steps.step_type == 'run_sql'].copy()
sql_steps['attempt'] = sql_steps.groupby('run_id').cumcount() + 1
by_attempt = sql_steps.groupby('attempt').agg(runs=('run_id', 'nunique'), error_rate=('error', lambda e: e.notna().mean()))
by_attempt['error_rate'] = (100 * by_attempt.error_rate).round(1)
by_attempt"""),
md("""## 4. Paired comparisons (McNemar's test)

Every configuration answered the same 40 questions, so the comparison is paired. McNemar's test
uses only the discordant questions: `b` = correct only in the first run, `c` = correct only in the
second. With so few discordant pairs the exact binomial version is used. A p-value above 0.05
means the difference could be chance on a set this small."""),
code("""def compare(a, b):
    ca, cb = reports[a].verdict.eq('correct'), reports[b].verdict.eq('correct')
    table = [[int((ca & cb).sum()), int((ca & ~cb).sum())], [int((~ca & cb).sum()), int((~ca & ~cb).sum())]]
    res = mcnemar(table, exact=True)
    return {'A': a, 'B': b, 'acc_A': f'{ca.mean():.1%}', 'acc_B': f'{cb.mean():.1%}',
            'only_A_correct': table[0][1], 'only_B_correct': table[1][0], 'p_value': round(res.pvalue, 3)}

pairs = [('single_shot-profiles_off', 'agent-A-profiles_off'),
         ('agent-A-profiles_off', 'agent-A-profiles_on'),
         ('agent-A-profiles_on', 'agent-B-profiles_on'),
         ('single_shot-profiles_off', 'agent-B-profiles_on')]
pd.DataFrame([compare(a, b) for a, b in pairs if a in reports and b in reports])"""),
md("""## Caveats

- The 40 questions are a fixed development set used while building the agent. Scores show
  differences on this set, not expected accuracy on new questions.
- These runs used a local 7B model (`qwen2.5-coder:7b` through Ollama) because no Gemini key was
  available in the build environment. Rerun with `LLM_PROVIDER=gemini` for Gemini numbers.
- Latency includes CPU-only local inference on a 4-vCPU machine and is not comparable to a hosted API."""),
]
nb.metadata['kernelspec'] = {'name': 'python3', 'display_name': 'Python 3', 'language': 'python'}
nbf.write(nb, 'agent_runs.ipynb')
print('wrote agent_runs.ipynb')
