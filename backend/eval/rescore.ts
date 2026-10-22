// Re-score saved eval results with the current scorer, without calling the model again: re-runs
// each stored reference and predicted SQL on the demo workspace and compares them.
//   npx tsx eval/rescore.ts eval/results/<file>.json [...]   (add --write to update the files)
import fs from 'fs';
import path from 'path';
import { seedDemo } from '../scripts/seed_demo';
import { runReadonlyQuery, closeReaderPool } from '../services/readonlyQuery';
import { resultsMatch } from './score';
import { summarize } from './run';
const pool = require('../config/database');

interface Question {
  id: string;
  sql: string;
  ordered: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const files = args.filter((a) => a.endsWith('.json'));
  const { workspace } = await seedDemo({ log: () => {} });
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const set = path.join(__dirname, path.basename(data.questionSet));
    const questions = new Map<string, Question>(
      fs
        .readFileSync(set, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .map((q: Question) => [q.id, q])
    );
    const changes: string[] = [];
    for (const r of data.results) {
      if (r.verdict === 'error' || !r.predictedSql) continue;
      const q = questions.get(r.id)!;
      const ref = await runReadonlyQuery(q.sql, workspace, { pageSize: 1000 });
      const pred = await runReadonlyQuery(r.predictedSql, workspace, { pageSize: 1000 });
      if (!ref.success || !pred.success) continue;
      const verdict = resultsMatch(ref, pred, q.ordered) ? 'correct' : 'wrong';
      if (verdict !== r.verdict) {
        changes.push(`${r.id}: ${r.verdict} -> ${verdict}`);
        r.verdict = verdict;
        if (verdict === 'correct') r.reason = '';
      }
    }
    const all = summarize(data.results).all;
    console.log(
      `${path.basename(file)}: ${all.correct}/${all.n} correct` +
        (changes.length ? `; changed ${changes.join(', ')}` : '; no changes')
    );
    if (write && changes.length) {
      data.summary = summarize(data.results);
      data.rescored = { date: new Date().toISOString().slice(0, 10), changes };
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    }
  }
  await closeReaderPool();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
