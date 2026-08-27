/**
 * Split text into overlapping word-based chunks.
 * Good enough for a learning project; in production use a
 * tokenizer-aware splitter (for example, the one from LangChain).
 *
 * @param {string} text
 * @param {{ chunkSize?: number, overlap?: number }} options
 * @returns {string[]}
 */
export function splitIntoChunks(text, { chunkSize = 220, overlap = 40 } = {}) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}
