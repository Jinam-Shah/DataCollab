// Split text blocks into overlapping chunks of roughly `size` characters. Splits prefer
// paragraph, then sentence, then word boundaries. Chunks never cross a page or section, so
// every chunk has one citation.
import type { TextBlock } from './parse';

export interface Chunk {
  index: number;
  content: string;
  page: number | null;
  section: string | null;
}

export const DEFAULT_CHUNK_SIZE = 800;
export const DEFAULT_OVERLAP = 150;

function splitPoint(text: string, max: number): number {
  if (text.length <= max) return text.length;
  const window = text.slice(0, max);
  for (const sep of ['\n\n', '. ', '\n', ' ']) {
    const at = window.lastIndexOf(sep);
    if (at > max * 0.5) return at + sep.length;
  }
  return max;
}

export function chunkBlocks(
  blocks: TextBlock[],
  size = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const block of blocks) {
    let rest = block.text.replace(/\n{3,}/g, '\n\n').trim();
    while (rest.length) {
      const cut = splitPoint(rest, size);
      const content = rest.slice(0, cut).trim();
      if (content)
        chunks.push({ index: chunks.length, content, page: block.page, section: block.section });
      if (cut >= rest.length) break;
      // Step back by `overlap` characters, to the start of a word.
      let next = Math.max(cut - overlap, 1);
      const space = rest.indexOf(' ', next);
      if (space > 0 && space < cut) next = space + 1;
      rest = rest.slice(next);
    }
  }
  return chunks;
}
