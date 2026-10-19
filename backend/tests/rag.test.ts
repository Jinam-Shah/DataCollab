// Document parsing, chunking, storage, hybrid search and the agent's document path.
import fs from 'fs';
import path from 'path';
import { parseDocument } from '../rag/parse';
import { chunkBlocks } from '../rag/chunk';
import { searchDocuments } from '../rag/store';
import { ensureWorkspace } from '../services/workspaceService';
import { runAgent } from '../agent/graph';
import { ScriptedChatModel, toolCall, text } from './helpers/scriptedModel';
const { registerUser } = require('./helpers/api');

const fixtures = path.join(__dirname, 'fixtures');

describe('parsing and chunking', () => {
  it('keeps Markdown section headings', async () => {
    const doc = await parseDocument(
      fs.readFileSync(path.join(fixtures, 'dictionary.md')),
      'dictionary.md'
    );
    expect(doc.blocks.map((b) => b.section)).toEqual([
      'Earthquakes table',
      'Earthquakes table > Columns',
      'Causes of death table',
      'Causes of death table > Caveats',
    ]);
  });

  it('keeps PDF page numbers', async () => {
    const doc = await parseDocument(
      fs.readFileSync(path.join(fixtures, 'magnitudes.pdf')),
      'magnitudes.pdf'
    );
    expect(doc.pageCount).toBe(2);
    expect(doc.blocks[1]).toMatchObject({ page: 2 });
    expect(doc.blocks[1].text).toContain('subduction zones');
  });

  it('splits long text into overlapping chunks on word boundaries', () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkBlocks([{ text: words, page: 3, section: 'S' }], 300, 60);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(300);
      expect(c).toMatchObject({ page: 3, section: 'S' });
      expect(c.content).toMatch(/^word\d+/);
    }
    // Consecutive chunks share words (the overlap).
    const lastWord = chunks[0].content.split(' ').pop();
    expect(chunks[1].content).toContain(lastWord);
  });

  it('never merges text from different pages', () => {
    const chunks = chunkBlocks([
      { text: 'page one text', page: 1, section: null },
      { text: 'page two text', page: 2, section: null },
    ]);
    expect(chunks.map((c) => [c.page, c.content])).toEqual([
      [1, 'page one text'],
      [2, 'page two text'],
    ]);
  });
});

describe('document API and search', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let alice: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mallory: any;
  let docId: number;

  beforeAll(async () => {
    alice = await registerUser('rag-team');
    mallory = await registerUser('rag-other');
    const md = await alice
      .post('/api/documents')
      .attach('file', path.join(fixtures, 'dictionary.md'));
    expect(md.status).toBe(201);
    docId = md.body.document.id;
    const pdf = await alice
      .post('/api/documents')
      .attach('file', path.join(fixtures, 'magnitudes.pdf'));
    expect(pdf.status).toBe(201);
    expect(pdf.body.document).toMatchObject({ page_count: 2, mime_type: 'application/pdf' });
  });

  it('rejects unsupported files', async () => {
    const res = await alice.post('/api/documents').attach('file', Buffer.from('x'), 'image.png');
    expect(res.status).toBe(400);
  });

  it('lists documents in the workspace only', async () => {
    expect((await alice.get('/api/documents')).body.documents).toHaveLength(2);
    expect((await mallory.get('/api/documents')).body.documents).toHaveLength(0);
  });

  it.each(['hybrid', 'keyword', 'vector'])(
    '%s search finds the caveat about "All causes"',
    async (mode) => {
      const res = await alice
        .post('/api/documents/search')
        .send({ query: 'All causes counted twice', mode, k: 3 });
      expect(res.status).toBe(200);
      expect(res.body.hits[0].content).toContain('counted twice');
      expect(res.body.hits[0].section).toBe('Causes of death table > Caveats');
    }
  );

  it('hybrid search fuses both rankings', async () => {
    const ws = await ensureWorkspace('rag-team');
    const hits = await searchDocuments(ws.slug, 'deep earthquakes subduction depth', { k: 5 });
    const top = hits[0];
    expect(top.filename).toBe('magnitudes.pdf');
    expect(top.page).toBe(2);
    expect(top.vectorRank).not.toBeNull();
    expect(top.keywordRank).not.toBeNull();
  });

  it("does not return other workspaces' passages", async () => {
    const res = await mallory
      .post('/api/documents/search')
      .send({ query: 'All causes counted twice' });
    expect(res.body.hits).toEqual([]);
  });

  it('serves the source text of a citation, only within the workspace', async () => {
    const doc = await alice.get(`/api/documents/${docId}`);
    const chunkId = doc.body.chunks[0].id;
    const chunk = await alice.get(`/api/documents/${docId}/chunks/${chunkId}`);
    expect(chunk.body.chunk).toMatchObject({ filename: 'dictionary.md', id: chunkId });
    expect((await mallory.get(`/api/documents/${docId}/chunks/${chunkId}`)).status).toBe(404);
    expect((await mallory.delete(`/api/documents/${docId}`)).status).toBe(404);
  });
});

describe('agent with documents', () => {
  it('answers from documents with citations when the plan asks only for documents', async () => {
    const workspace = await ensureWorkspace('rag-team');
    const model = new ScriptedChatModel([
      (messages) => {
        expect(String(messages[0].content)).toContain('search_documents');
        return toolCall('search_documents', { query: 'All causes double counting' });
      },
      (messages) => {
        expect(String(messages[1].content)).toMatch(
          /\[1\] dictionary\.md \(Causes of death table > Caveats\)/
        );
        return text(
          '"All causes" is the total of every cause, so adding it to the others counts deaths twice [1].'
        );
      },
    ]);
    const result = await runAgent('What does the All causes value mean?', { workspace, model });
    expect(result.status).toBe('answered');
    expect(result.sql).toBeNull();
    expect(result.answer).toContain('[1]');
    expect(result.citations[0]).toMatchObject({ n: 1, filename: 'dictionary.md' });
  });

  it('uses document excerpts while writing SQL when the plan asks for both', async () => {
    const workspace = await ensureWorkspace('rag-team');
    const user = await registerUser('rag-team');
    await user.upload(
      'causes.csv',
      'state,cause,deaths\nTexas,All causes,10\nTexas,Cancer,4\nTexas,Stroke,6\n'
    );
    const model = new ScriptedChatModel([
      new (require('@langchain/core/messages').AIMessage)({
        content: '',
        tool_calls: [
          { id: 'a', name: 'get_schema', args: { tables: ['causes'] }, type: 'tool_call' },
          { id: 'b', name: 'search_documents', args: { query: 'All causes' }, type: 'tool_call' },
        ],
      }),
      (messages) => {
        expect(String(messages[1].content)).toContain('Relevant document excerpts');
        return toolCall('run_readonly_query', {
          sql: "SELECT deaths FROM causes WHERE state = 'Texas' AND cause = 'All causes'",
        });
      },
      text('Texas had 10 deaths in total [1].'),
    ]);
    const result = await runAgent('How many people died in Texas?', { workspace, model });
    expect(result.rows).toEqual([{ deaths: 10 }]);
    expect(result.citations.length).toBeGreaterThan(0);
  });
});
