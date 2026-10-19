// Evaluation harness: npm run eval -- [options]
//
//   --mode agent|single_shot   which pipeline to evaluate (default agent)
//   --variant A|B              system prompt for the agent's SQL step (default B)
//   --profiles on|off          column statistics in get_schema (default on)
//   --set <file>               question file (default eval/questions.jsonl)
//   --ids e01,m02              only these questions
//   --label <name>             name for this run (default <mode>-<variant>-<profiles>)
//
// For each question: run the reference SQL and the pipeline's SQL through the read-only layer,
// compare result sets (eval/score.ts), and mark it correct, wrong or error. Writes
// eval/results/<date>-<label>.json and prints a summary table. Every run is also traced in
// agent_runs with source = 'eval' and eval_run = <label>.
import fs from 'fs';
import path from 'path';
require('dotenv').config();
import { seedDemo } from '../scripts/seed_demo';
import { ask } from '../agent/service';
import { createChatModel } from '../agent/llm';
import { runReadonlyQuery, closeReaderPool } from '../services/readonlyQuery';
import type { Workspace } from '../services/workspaceService';
import type { PromptVariant } from '../agent/prompts';
import { resultsMatch, type ResultSet } from './score';
const pool = require('../config/database');

interface Question {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  categories: string[];
  question: string;
  sql: string;
  ordered: boolean;
}

type Verdict = 'correct' | 'wrong' | 'error';

export interface QuestionResult {
  id: string;
  difficulty: string;
  categories: string[];
  question: string;
  verdict: Verdict;
  reason: string;
  predictedSql: string | null;
  referenceRows: number;
  predictedRows: number | null;
  attempts: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  runId: number;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] ?? '';
  }
  return args;
}

export function loadQuestions(file: string): Question[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

async function fullResult(
  sql: string,
  workspace: Workspace
): Promise<ResultSet | { error: string }> {
  const r = await runReadonlyQuery(sql, workspace, { pageSize: 1000 });
  return r.success ? { columns: r.columns, rows: r.rows } : { error: `${r.code}: ${r.error}` };
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');

export function summarize(results: QuestionResult[]) {
  const groups: Record<string, QuestionResult[]> = { all: results };
  for (const r of results) (groups[r.difficulty] ??= []).push(r);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
  };
  return Object.fromEntries(
    Object.entries(groups).map(([name, rs]) => [
      name,
      {
        n: rs.length,
        correct: rs.filter((r) => r.verdict === 'correct').length,
        wrong: rs.filter((r) => r.verdict === 'wrong').length,
        error: rs.filter((r) => r.verdict === 'error').length,
        accuracy: rs.length ? rs.filter((r) => r.verdict === 'correct').length / rs.length : 0,
        medianLatencyMs: median(rs.map((r) => r.latencyMs)),
        meanAttempts: rs.reduce((a, r) => a + r.attempts, 0) / (rs.length || 1),
      },
    ])
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = (args.mode || 'agent') as 'agent' | 'single_shot';
  const variant = (args.variant || 'B') as PromptVariant;
  const includeProfiles = (args.profiles || 'on') !== 'off';
  const setFile = path.resolve(args.set || path.join(__dirname, 'questions.jsonl'));
  const label =
    args.label ||
    (mode === 'agent'
      ? `agent-${variant}-profiles_${includeProfiles ? 'on' : 'off'}`
      : `single_shot-profiles_${includeProfiles ? 'on' : 'off'}`);
  const ids = args.ids ? new Set(args.ids.split(',')) : null;

  const { workspace } = await seedDemo({ log: () => {} });
  const questions = loadQuestions(setFile).filter((q) => !ids || ids.has(q.id));
  const modelInfo = createChatModel();
  console.log(`Eval "${label}": ${questions.length} questions, ${mode}, model ${modelInfo.name}`);

  const results: QuestionResult[] = [];
  for (const q of questions) {
    const ref = await fullResult(q.sql, workspace);
    if ('error' in ref) throw new Error(`Reference SQL for ${q.id} failed: ${ref.error}`);

    const run = await ask({
      workspace,
      question: q.question,
      mode,
      promptVariant: variant,
      schemaOptions: { includeProfiles },
      summarize: false,
      source: 'eval',
      evalRun: label,
      modelInfo,
    });

    let verdict: Verdict;
    let reason: string;
    let predictedRows: number | null = null;
    if (!run.sql) {
      verdict = 'error';
      reason = run.error || 'no SQL produced';
    } else {
      const pred = await fullResult(run.sql, workspace);
      if ('error' in pred) {
        verdict = 'error';
        reason = pred.error;
      } else {
        predictedRows = pred.rows.length;
        verdict = resultsMatch(ref, pred, q.ordered) ? 'correct' : 'wrong';
        reason =
          verdict === 'correct'
            ? ''
            : `expected ${ref.rows.length} row(s), got ${pred.rows.length}`;
      }
    }

    const r: QuestionResult = {
      id: q.id,
      difficulty: q.difficulty,
      categories: q.categories,
      question: q.question,
      verdict,
      reason,
      predictedSql: run.sql,
      referenceRows: ref.rows.length,
      predictedRows,
      attempts: run.attempts.length,
      latencyMs: run.latencyMs,
      inputTokens: run.usage.inputTokens,
      outputTokens: run.usage.outputTokens,
      runId: run.runId,
    };
    results.push(r);
    console.log(
      `${q.id.padEnd(4)} ${verdict.padEnd(7)} ${String(r.latencyMs).padStart(6)} ms  ${r.attempts} att  ${reason}`
    );
  }

  const summary = summarize(results);
  const date = new Date().toISOString().slice(0, 10);
  const out = path.join(__dirname, 'results', `${date}-${label}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        label,
        date: new Date().toISOString(),
        model: modelInfo.name,
        mode,
        promptVariant: mode === 'agent' ? variant : null,
        includeProfiles,
        questionSet: path.basename(setFile),
        command: `npm run eval -- ${process.argv.slice(2).join(' ')}`.trim(),
        summary,
        results,
      },
      null,
      2
    ) + '\n'
  );

  console.log(
    '\n| Subset | N | Correct | Wrong | Error | Accuracy | Median latency | Mean attempts |'
  );
  console.log('|---|---|---|---|---|---|---|---|');
  for (const [name, s] of Object.entries(summary)) {
    console.log(
      `| ${name} | ${s.n} | ${s.correct} | ${s.wrong} | ${s.error} | ${pct(s.correct, s.n)} | ${s.medianLatencyMs} ms | ${s.meanAttempts.toFixed(2)} |`
    );
  }
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeReaderPool();
      await pool.end();
    });
}
