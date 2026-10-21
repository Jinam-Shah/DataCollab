// Upload endpoint: inline loading for small files, background jobs for large ones.
process.env.INLINE_UPLOAD_MAX_BYTES = '200';
const fs = require('fs');
const path = require('path');
const { registerUser } = require('./helpers/api');
const { drainLocalJobs, enqueueIngest } = require('../ingest/queue');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'quality.csv'), 'utf8');
const bigCsv =
  'n,label\n' + Array.from({ length: 3000 }, (_, i) => `${i},row${i}`).join('\n') + '\n';

let user;
beforeAll(async () => {
  user = await registerUser('upload-team');
});

describe('inline upload', () => {
  it('returns the quality report and a typed preview', async () => {
    const res = await user.upload('Quality Check.csv', fixture);
    expect(res.status).toBe(201);
    const { file } = res.body;
    expect(file.tableName).toBe('quality_check');
    expect(file.status).toBe('ready');
    expect(file.qualityReport.duplicateRows).toBe(1);
    expect(file.qualityReport.warnings.some((w) => w.kind === 'mixed_types')).toBe(true);
    expect(file.preview[0]).toMatchObject({
      id: 1,
      name: 'ann',
      amount: 10.5,
      joined: '2024-01-05',
    });
    expect(file.preview[2].joined).toBe('2024-01-15');

    const details = await user.get(`/api/files/${file.id}`);
    expect(details.body.file.qualityReport.rowCount).toBe(5);
  });

  it('names a second upload of the same file uniquely', async () => {
    const res = await user.upload('Quality Check.csv', fixture);
    expect(res.body.file.tableName).toBe('quality_check_2');
  });

  it('rejects an empty CSV and leaves no file record', async () => {
    const before = await user.get('/api/files');
    const res = await user.upload('empty.csv', 'a,b\n');
    expect(res.status).toBe(400);
    const after = await user.get('/api/files');
    expect(after.body.files.length).toBe(before.body.files.length);
  });

  it('rejects non-CSV files', async () => {
    const res = await user.upload('notes.txt', 'hello');
    expect(res.status).toBe(400);
  });
});

describe('browsing and downloading a table', () => {
  let file;
  beforeAll(async () => {
    const csv = 'Region Name,amount,"note, with comma"\nnorth,10,"say ""hi"""\nsouth,,x\n';
    file = (await user.upload('Browse Me.csv', csv)).body.file;
  });

  it('pages through every row in upload order', async () => {
    const p1 = await user.get(`/api/files/${file.id}/rows?page=1&pageSize=1`);
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(p1.body.columns).toEqual(['region_name', 'amount', 'note__with_comma']);
    expect(p1.body.rows).toEqual([
      { region_name: 'north', amount: '10', note__with_comma: 'say "hi"' },
    ]);
    const p2 = await user.get(`/api/files/${file.id}/rows?page=2&pageSize=1`);
    expect(p2.body.rows[0]).toMatchObject({ region_name: 'south', amount: null });
  });

  it('downloads the table as CSV with the original headers', async () => {
    const res = await user.get(`/api/files/${file.id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('Browse Me.csv');
    expect(res.text).toBe(
      'Region Name,amount,"note, with comma"\r\nnorth,10,"say ""hi"""\r\nsouth,,x\r\n'
    );
  });

  it('keeps rows and downloads private to the workspace', async () => {
    const outsider = await registerUser('upload-outsider');
    expect((await outsider.get(`/api/files/${file.id}/rows`)).status).toBe(404);
    expect((await outsider.get(`/api/files/${file.id}/download`)).status).toBe(404);
  });
});

describe('background upload', () => {
  it('returns 202 at once and finishes in the background', async () => {
    const res = await user.upload('big.csv', bigCsv);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
    expect(res.body.file.status).toBe('queued');

    await drainLocalJobs();
    const details = await user.get(`/api/files/${res.body.file.id}`);
    expect(details.body.file).toMatchObject({ status: 'ready', rowCount: 3000, columnCount: 2 });

    const count = await user.query('SELECT count(*)::int AS n, max(n) AS top FROM big');
    expect(count.body.data[0]).toEqual({ n: 3000, top: 2999 });
  });

  it('marks the file failed after all retries', async () => {
    const res = await user.upload('retry.csv', bigCsv);
    await drainLocalJobs();
    // Re-run ingestion for that file against a path that does not exist: every attempt fails.
    await enqueueIngest({
      fileId: res.body.file.id,
      workspaceSlug: user.user.workspaceId,
      filePath: path.join(__dirname, 'no-such-file.csv'),
    });
    await drainLocalJobs();
    const details = await user.get(`/api/files/${res.body.file.id}`);
    expect(details.body.file.status).toBe('failed');
    expect(details.body.file.error).toMatch(/missing/);
  });
});
