// Document storage and hybrid retrieval.
//
// search() runs two retrievers over the workspace's chunks and merges them with reciprocal rank
// fusion (RRF): score(chunk) = sum over retrievers of 1 / (k + rank). RRF needs no score
// calibration between cosine distance and ts_rank, which live on different scales.
//   vector:  pgvector cosine distance on the HNSW index
//   keyword: PostgreSQL full-text search (OR of the query words, ts_rank with length normalization)
import { embedTexts, embeddingModelName, toVectorLiteral } from './embeddings';
import { parseDocument, documentKind } from './parse';
import { chunkBlocks } from './chunk';
const pool = require('../config/database');

export type SearchMode = 'hybrid' | 'vector' | 'keyword';

export interface SearchHit {
  chunkId: number;
  documentId: number;
  filename: string;
  chunkIndex: number;
  page: number | null;
  section: string | null;
  content: string;
  score: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

export const RRF_K = 60;
const CANDIDATES = 20;

export async function ingestDocument(opts: {
  workspaceSlug: string;
  userId: number | null;
  filename: string;
  buffer: Buffer;
}) {
  const kind = documentKind(opts.filename);
  if (!kind) throw new Error('Only PDF, Markdown and TXT documents are supported');
  const parsed = await parseDocument(opts.buffer, opts.filename);
  const chunks = chunkBlocks(parsed.blocks);
  if (chunks.length === 0) throw new Error('No text could be extracted from this document');
  const vectors = await embedTexts(
    chunks.map((c) => (c.section ? `${c.section}\n${c.content}` : c.content)),
    'document'
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO documents (workspace_id, user_id, filename, mime_type, file_size, page_count,
                              chunk_count, embedding_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        opts.workspaceSlug,
        opts.userId,
        opts.filename,
        kind === 'pdf' ? 'application/pdf' : kind === 'markdown' ? 'text/markdown' : 'text/plain',
        opts.buffer.length,
        parsed.pageCount,
        chunks.length,
        embeddingModelName(),
      ]
    );
    const doc = rows[0];
    // One multi-row INSERT per 100 chunks.
    for (let i = 0; i < chunks.length; i += 100) {
      const values: unknown[] = [];
      const tuples = chunks.slice(i, i + 100).map((c, j) => {
        const b = values.length;
        values.push(
          doc.id,
          opts.workspaceSlug,
          c.index,
          c.content,
          c.page,
          c.section,
          toVectorLiteral(vectors[i + j])
        );
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::vector)`;
      });
      await client.query(
        `INSERT INTO document_chunks (document_id, workspace_id, chunk_index, content, page, section, embedding)
         VALUES ${tuples.join(', ')}`,
        values
      );
    }
    await client.query('COMMIT');
    return { ...doc, chunk_count: chunks.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

interface ChunkRow {
  id: string;
  document_id: number;
  filename: string;
  chunk_index: number;
  page: number | null;
  section: string | null;
  content: string;
}

async function vectorSearch(
  workspaceSlug: string,
  query: string,
  limit: number
): Promise<ChunkRow[]> {
  const [vec] = await embedTexts([query], 'query');
  const { rows } = await pool.query(
    `SELECT c.id, c.document_id, d.filename, c.chunk_index, c.page, c.section, c.content
       FROM document_chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.workspace_id = $1
      ORDER BY c.embedding <=> $2::vector
      LIMIT $3`,
    [workspaceSlug, toVectorLiteral(vec), limit]
  );
  return rows;
}

// Keyword ranking. 'rank' (default): OR of the query's words ranked by ts_rank with length
// normalization. 'cover_density': the first version (AND query, then OR, ranked by
// ts_rank_cd), kept so the retrieval eval can compare the two (see METRICS.md).
export type KeywordRanking = 'rank' | 'cover_density';

const OR_QUERY =
  "to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', $2)), ' | '))";

async function keywordSearch(
  workspaceSlug: string,
  query: string,
  limit: number,
  ranking: KeywordRanking = 'rank'
): Promise<ChunkRow[]> {
  const sql = (tsquery: string, order: string) => `
    SELECT c.id, c.document_id, d.filename, c.chunk_index, c.page, c.section, c.content
      FROM document_chunks c JOIN documents d ON d.id = c.document_id, ${tsquery} AS q
     WHERE c.workspace_id = $1 AND c.tsv @@ q
     ORDER BY ${order} DESC, c.id
     LIMIT $3`;
  if (ranking === 'rank') {
    // Normalization 1 divides by 1 + log(document length), so long chunks do not win just by size.
    const { rows } = await pool.query(sql(OR_QUERY, 'ts_rank(c.tsv, q, 1)'), [
      workspaceSlug,
      query,
      limit,
    ]);
    return rows;
  }
  const strict = await pool.query(
    sql("websearch_to_tsquery('english', $2)", 'ts_rank_cd(c.tsv, q)'),
    [workspaceSlug, query, limit]
  );
  if (strict.rows.length >= limit) return strict.rows;
  const loose = await pool.query(sql(OR_QUERY, 'ts_rank_cd(c.tsv, q)'), [
    workspaceSlug,
    query,
    limit,
  ]);
  const seen = new Set(strict.rows.map((r: ChunkRow) => r.id));
  return [...strict.rows, ...loose.rows.filter((r: ChunkRow) => !seen.has(r.id))].slice(0, limit);
}

export async function searchDocuments(
  workspaceSlug: string,
  query: string,
  opts: { mode?: SearchMode; k?: number; keywordRanking?: KeywordRanking } = {}
): Promise<SearchHit[]> {
  const mode = opts.mode ?? 'hybrid';
  const k = opts.k ?? 5;
  const vector = mode === 'keyword' ? [] : await vectorSearch(workspaceSlug, query, CANDIDATES);
  const keyword =
    mode === 'vector'
      ? []
      : await keywordSearch(workspaceSlug, query, CANDIDATES, opts.keywordRanking);

  const hits = new Map<string, SearchHit>();
  const add = (rows: ChunkRow[], which: 'vectorRank' | 'keywordRank') => {
    rows.forEach((r, i) => {
      const hit =
        hits.get(r.id) ??
        ({
          chunkId: Number(r.id),
          documentId: r.document_id,
          filename: r.filename,
          chunkIndex: r.chunk_index,
          page: r.page,
          section: r.section,
          content: r.content,
          score: 0,
          vectorRank: null,
          keywordRank: null,
        } as SearchHit);
      hit[which] = i + 1;
      hit.score += 1 / (RRF_K + i + 1);
      hits.set(r.id, hit);
    });
  };
  add(vector, 'vectorRank');
  add(keyword, 'keywordRank');
  return [...hits.values()].sort((a, b) => b.score - a.score || a.chunkId - b.chunkId).slice(0, k);
}

export async function hasDocuments(workspaceSlug: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM documents WHERE workspace_id = $1 LIMIT 1', [
    workspaceSlug,
  ]);
  return rows.length > 0;
}
