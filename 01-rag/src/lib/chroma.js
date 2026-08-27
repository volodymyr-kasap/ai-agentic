import 'dotenv/config';
import { ChromaClient } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'site_rag';

/**
 * Split a URL into the ssl/host/port triple the Chroma client expects.
 * (Passing the URL as `path` still works, but is deprecated.)
 * @param {string} url
 * @returns {{ ssl: boolean, host: string, port: number }}
 */
function parseChromaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`CHROMA_URL is not a valid URL: "${url}"`);
  }

  const ssl = parsed.protocol === 'https:';
  return {
    ssl,
    host: parsed.hostname,
    // The URL may omit the port; fall back to the scheme's default.
    port: parsed.port ? Number(parsed.port) : ssl ? 443 : 80,
  };
}

const client = new ChromaClient(parseChromaUrl(CHROMA_URL));

/**
 * Get (or create) the collection that stores the site chunks.
 * We compute embeddings ourselves via Ollama, so no embeddingFunction is needed.
 */
export async function getCollection() {
  return client.getOrCreateCollection({ name: COLLECTION_NAME });
}
