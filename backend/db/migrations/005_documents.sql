-- Phase 7: documents for retrieval-augmented answers (pgvector + full-text search).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    workspace_id VARCHAR(50) NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    page_count INTEGER,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    embedding_model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 384 dimensions matches all-MiniLM-L6-v2 (the default local model).
CREATE TABLE IF NOT EXISTS document_chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    workspace_id VARCHAR(50) NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    page INTEGER,
    section TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    embedding vector(384) NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(section, '')), 'A') ||
        setweight(to_tsvector('english', content), 'B')
    ) STORED
);

CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_workspace ON document_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON document_chunks USING gin (tsv);
