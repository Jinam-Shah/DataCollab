// Extract text from uploaded documents, keeping page numbers (PDF) or section headings
// (Markdown) so answers can cite where a passage came from.
export interface TextBlock {
  text: string;
  page: number | null;
  section: string | null;
}

export interface ParsedDocument {
  blocks: TextBlock[];
  pageCount: number | null;
}

export const SUPPORTED_EXTENSIONS = ['.pdf', '.md', '.markdown', '.txt'];

export function documentKind(filename: string): 'pdf' | 'markdown' | 'text' | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.txt')) return 'text';
  return null;
}

function parseMarkdown(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const trail: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const body = current.join('\n').trim();
    if (body)
      blocks.push({ text: body, page: null, section: trail.filter(Boolean).join(' > ') || null });
    current = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      trail.length = level;
      trail[level - 1] = heading[2].trim();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

export async function parseDocument(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const kind = documentKind(filename);
  if (kind === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = text as string[];
    return {
      pageCount: pages.length,
      blocks: pages
        .map((t, i) => ({ text: t.replace(/[ \t]+/g, ' ').trim(), page: i + 1, section: null }))
        .filter((b) => b.text),
    };
  }
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (kind === 'markdown') return { pageCount: null, blocks: parseMarkdown(text) };
  if (kind === 'text')
    return { pageCount: null, blocks: [{ text: text.trim(), page: null, section: null }] };
  throw new Error(`Unsupported document type: ${filename}`);
}
