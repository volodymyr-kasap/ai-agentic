import 'dotenv/config';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const CHAT_MODEL = process.env.CHAT_MODEL || 'llama3.1';

/**
 * Get embeddings for one or more strings via the local Ollama instance.
 * @param {string | string[]} input
 * @returns {Promise<number[][]>}
 */
export async function embed(input) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });

  if (!res.ok) {
    throw new Error(
      `Ollama embed failed (${res.status}). Make sure Ollama is running and the model ` +
        `"${EMBED_MODEL}" is pulled: ollama pull ${EMBED_MODEL}\n${await res.text()}`
    );
  }

  const data = await res.json();
  return data.embeddings;
}

/**
 * Ask the local chat model a question, optionally with a system prompt.
 * @param {{ system?: string, messages: { role: string, content: string }[] }} params
 * @returns {Promise<string>}
 */
export async function chat({ system, messages }) {
  const fullMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, messages: fullMessages, stream: false }),
  });

  if (!res.ok) {
    throw new Error(
      `Ollama chat failed (${res.status}). Make sure the model "${CHAT_MODEL}" is pulled: ` +
        `ollama pull ${CHAT_MODEL}\n${await res.text()}`
    );
  }

  const data = await res.json();
  return data.message.content;
}
