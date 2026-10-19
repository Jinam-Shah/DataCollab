// Retrieval evaluation: npm run eval:retrieval
//
// Loads eval/docs/* into a dedicated workspace (re-embedding if the embedding model changed),
// then for each question in eval/retrieval_questions.jsonl checks whether a chunk from one of
// the gold files containing the gold passage appears in the top 5, for vector-only,
// keyword-only and hybrid search. Reports hit rate at 5 and mean reciprocal rank (MRR@5).
import fs from 'fs';
import path from 'path';
require('dotenv').config();
import {
  ingestDocument,
  searchDocuments,
  type SearchMode,
  type KeywordRanking,
} from '../rag/store';
import { embeddingModelName } from '../rag/embeddings';
import { ensureWorkspace } from '../services/workspaceService';
const pool = require('../config/database');

const WORKSPACE = process.env.RETRIEVAL_EVAL_WORKSPACE || 'retrieval-eval';
const DOCS_DIR = path.join(__dirname, 'docs');
const K = 5;

interface RQuestion {
  id: string;
  question: string;
  files: string[];
  contains: string;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();

async function loadCorpus() {
  await ensureWorkspace(WORKSPACE);
  const model = embeddingModelName();
  const { rows } = await pool.query(
    'SELECT filename, embedding_model FROM documents WHERE workspace_id = $1',
    [WORKSPACE]
  );
  const files = fs.readdirSync(DOCS_DIR).filter((f) => /\.(pdf|md|txt)$/.test(f));
  const current =
    rows.length === files.length &&
    rows.every((r: { embedding_model: string }) => r.embedding_model === model);
  if (current) return;
  await pool.query('DELETE FROM documents WHERE workspace_id = $1', [WORKSPACE]);
  for (const filename of files) {
    const doc = await ingestDocument({
      workspaceSlug: WORKSPACE,
      userId: null,
      filename,
      buffer: fs.readFileSync(path.join(DOCS_DIR, filename)),
    });
    console.log(`Indexed ${filename}: ${doc.chunk_count} chunks`);
  }
}

// Options: --set <file> (default eval/retrieval_questions.jsonl), --keyword-ranking rank|cover_density
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  await loadCorpus();
  const setFile = path.resolve(arg('set') || path.join(__dirname, 'retrieval_questions.jsonl'));
  const keywordRanking = (arg('keyword-ranking') || 'rank') as KeywordRanking;
  const questions: RQuestion[] = fs
    .readFileSync(setFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const { rows: stats } = await pool.query(
    'SELECT count(*)::int AS chunks, count(DISTINCT document_id)::int AS docs FROM document_chunks WHERE workspace_id = $1',
    [WORKSPACE]
  );

  const modes: SearchMode[] = ['vector', 'keyword', 'hybrid'];
  const summary: Record<string, { hits: number; mrr: number; hitRate: number }> = {};
  const perQuestion: Record<string, Record<string, number | null>> = {};

  for (const mode of modes) {
    let hits = 0;
    let rrSum = 0;
    for (const q of questions) {
      const results = await searchDocuments(WORKSPACE, q.question, { mode, k: K, keywordRanking });
      const rank = results.findIndex(
        (h) => q.files.includes(h.filename) && squash(h.content).includes(squash(q.contains))
      );
      (perQuestion[q.id] ??= {})[mode] = rank >= 0 ? rank + 1 : null;
      if (rank >= 0) {
        hits++;
        rrSum += 1 / (rank + 1);
      }
    }
    summary[mode] = { hits, hitRate: hits / questions.length, mrr: rrSum / questions.length };
  }

  const label = `${path.basename(setFile, '.jsonl')}-${keywordRanking}`;
  const out = path.join(
    __dirname,
    'results',
    `${new Date().toISOString().slice(0, 10)}-${label}.json`
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        embeddingModel: embeddingModelName(),
        keywordRanking,
        questionSet: path.basename(setFile),
        command: `npm run eval:retrieval -- ${process.argv.slice(2).join(' ')}`.trim(),
        corpus: stats[0],
        k: K,
        questions: questions.length,
        summary,
        perQuestion,
      },
      null,
      2
    ) + '\n'
  );

  console.log(
    `\nCorpus: ${stats[0].docs} documents, ${stats[0].chunks} chunks. Embeddings: ${embeddingModelName()}`
  );
  console.log('| Retriever | Hit rate @5 | MRR@5 |');
  console.log('|---|---|---|');
  for (const mode of modes) {
    const s = summary[mode];
    console.log(
      `| ${mode} | ${s.hits}/${questions.length} (${(100 * s.hitRate).toFixed(1)}%) | ${s.mrr.toFixed(3)} |`
    );
  }
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
