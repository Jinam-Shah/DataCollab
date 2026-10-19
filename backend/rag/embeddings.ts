// Text embeddings for document chunks and queries. All providers return 384-dim unit vectors.
//   EMBEDDINGS_PROVIDER=local   all-MiniLM-L6-v2 via transformers.js, runs in-process (default)
//   EMBEDDINGS_PROVIDER=gemini  Gemini embedding API with outputDimensionality 384 (free tier key)
//   EMBEDDINGS_PROVIDER=hash    hashed bag of words; deterministic, no model download (tests only)
import crypto from 'crypto';

export const EMBEDDING_DIM = 384;
const LOCAL_MODEL = process.env.LOCAL_EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
const GEMINI_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

export function embeddingProvider(): 'local' | 'gemini' | 'hash' {
  const p = (process.env.EMBEDDINGS_PROVIDER || 'local').toLowerCase();
  return p === 'gemini' || p === 'hash' ? p : 'local';
}

export function embeddingModelName(): string {
  const p = embeddingProvider();
  if (p === 'local') return `local:${LOCAL_MODEL}`;
  if (p === 'gemini') return `gemini:${GEMINI_MODEL}`;
  return 'hash:bow-384';
}

function normalizeVec(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function hashEmbed(text: string): number[] {
  const v = new Array(EMBEDDING_DIM).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const h = crypto.createHash('md5').update(word).digest();
    v[h.readUInt16LE(0) % EMBEDDING_DIM] += h[2] & 1 ? 1 : -1;
  }
  return normalizeVec(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: Promise<any> | null = null;
async function localEmbed(texts: string[]): Promise<number[][]> {
  if (!extractor) {
    // Loaded lazily, so the API starts fast and the hash provider never loads the model.
    extractor = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      if (process.env.TRANSFORMERS_CACHE_DIR) env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR;
      return pipeline('feature-extraction', LOCAL_MODEL, { dtype: 'q8' });
    })();
  }
  const ext = await extractor;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = await ext(texts.slice(i, i + 32), { pooling: 'mean', normalize: true });
    out.push(...(batch.tolist() as number[][]));
  }
  return out;
}

async function geminiEmbed(texts: string[], taskType: string): Promise<number[][]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:batchEmbedContents`,
      {
        method: 'POST',
        // The key goes in a header, not the URL, so it never appears in proxy or request logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          requests: texts.slice(i, i + 100).map((text) => ({
            model: `models/${GEMINI_MODEL}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: EMBEDDING_DIM,
          })),
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini embeddings failed: HTTP ${res.status}`);
    const body = (await res.json()) as { embeddings: { values: number[] }[] };
    // Truncated (MRL) Gemini vectors are not unit length, so normalize for cosine distance.
    out.push(...body.embeddings.map((e) => normalizeVec(e.values)));
  }
  return out;
}

export async function embedTexts(
  texts: string[],
  kind: 'document' | 'query' = 'document'
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const p = embeddingProvider();
  if (p === 'hash') return texts.map(hashEmbed);
  if (p === 'gemini')
    return geminiEmbed(texts, kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT');
  return localEmbed(texts);
}

/** pgvector literal: '[0.1,0.2,...]' */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => Number(x.toFixed(7))).join(',')}]`;
}
