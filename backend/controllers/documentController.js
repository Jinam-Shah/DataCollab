const pool = require('../config/database');
const { ingestDocument, searchDocuments } = require('../rag/store');

const isId = (v) => /^\d+$/.test(String(v));

// POST /api/documents  (multipart field "file": PDF, Markdown or TXT)
exports.upload = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const doc = await ingestDocument({
      workspaceSlug: req.workspaceId,
      userId: req.userId,
      filename: req.file.originalname,
      buffer: req.file.buffer,
    });
    req.app.get('broadcast')(req.workspaceId, 'document:uploaded', {
      documentId: doc.id,
      filename: doc.filename,
      username: req.username,
    });
    res.status(201).json({ document: doc });
  } catch (error) {
    const clientError = /supported|No text could be extracted|Invalid PDF/i.test(error.message);
    if (!clientError) console.error('Document upload error:', error);
    res.status(clientError ? 400 : 500).json({ error: error.message });
  }
};

exports.list = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.filename, d.mime_type, d.file_size, d.page_count, d.chunk_count,
              d.embedding_model, d.created_at, u.username
         FROM documents d LEFT JOIN users u ON u.id = d.user_id
        WHERE d.workspace_id = $1 ORDER BY d.created_at DESC`,
      [req.workspaceId]
    );
    res.json({ documents: rows });
  } catch (error) {
    console.error('List documents error:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
};

exports.get = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Document not found' });
    const doc = await pool.query('SELECT * FROM documents WHERE id = $1 AND workspace_id = $2', [
      req.params.id,
      req.workspaceId,
    ]);
    if (!doc.rows[0]) return res.status(404).json({ error: 'Document not found' });
    const chunks = await pool.query(
      `SELECT id::int AS id, chunk_index, page, section, content FROM document_chunks
        WHERE document_id = $1 ORDER BY chunk_index`,
      [req.params.id]
    );
    res.json({ document: doc.rows[0], chunks: chunks.rows });
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: 'Failed to get document' });
  }
};

// GET /api/documents/:id/chunks/:chunkId  Source text behind a citation.
exports.getChunk = async (req, res) => {
  try {
    if (!isId(req.params.id) || !isId(req.params.chunkId)) {
      return res.status(404).json({ error: 'Chunk not found' });
    }
    const { rows } = await pool.query(
      `SELECT c.id::int AS id, c.document_id, d.filename, c.chunk_index, c.page, c.section, c.content
         FROM document_chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.id = $1 AND c.document_id = $2 AND c.workspace_id = $3`,
      [req.params.chunkId, req.params.id, req.workspaceId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Chunk not found' });
    res.json({ chunk: rows[0] });
  } catch (error) {
    console.error('Get chunk error:', error);
    res.status(500).json({ error: 'Failed to get chunk' });
  }
};

exports.remove = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Document not found' });
    const { rowCount } = await pool.query(
      'DELETE FROM documents WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.workspaceId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Document not found' });
    req.app.get('broadcast')(req.workspaceId, 'document:deleted', {
      documentId: Number(req.params.id),
    });
    res.json({ message: 'Document deleted' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
};

// POST /api/documents/search  { query, mode?: 'hybrid' | 'vector' | 'keyword', k? }
exports.search = async (req, res) => {
  const { query, mode = 'hybrid', k = 5 } = req.body || {};
  if (!query || typeof query !== 'string')
    return res.status(400).json({ error: 'query is required' });
  if (!['hybrid', 'vector', 'keyword'].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'hybrid', 'vector' or 'keyword'" });
  }
  try {
    const hits = await searchDocuments(req.workspaceId, query, {
      mode,
      k: Math.min(20, Number(k) || 5),
    });
    res.json({ hits });
  } catch (error) {
    console.error('Document search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
};
