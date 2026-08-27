import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { embed, chat } from './lib/ollama.js';
import { getCollection } from './lib/chroma.js';

const TOP_K = Number(process.env.TOP_K || 4);

const SYSTEM_PROMPT =
  'You answer questions using ONLY the provided context from the site. ' +
  'If the answer is not in the context, honestly say you do not know — do not make things up. ' +
  'At the end of the answer, list the sources (URLs) the information came from. ' +
  'Always reply in the same language the question is written in, regardless of the language of the context.';

/**
 * Core RAG function: embed the question -> search Chroma -> generate an answer.
 * @param {string} question
 * @returns {Promise<{ answer: string, sources: string[] }>}
 */
export async function answerQuestion(question) {
  const [queryEmbedding] = await embed(question);
  const collection = await getCollection();

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: TOP_K,
  });

  const docs = results.documents?.[0] || [];
  const metadatas = results.metadatas?.[0] || [];

  if (docs.length === 0) {
    return {
      answer: 'The index is still empty. Run scrape and ingest first.',
      sources: [],
    };
  }

  const context = docs
    .map((doc, i) => `[${i + 1}] Source: ${metadatas[i].url}\n${doc}`)
    .join('\n\n');

  const answer = await chat({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Context:\n\n${context}\n\nQuestion: ${question}` }],
  });

  const sources = [...new Set(metadatas.map((m) => m.url))];
  return { answer, sources };
}

async function main() {
  const rl = readline.createInterface({ input, output });
  console.log('RAG CLI. Type a question or "exit" to quit.\n');

  while (true) {
    const question = await rl.question('> ');
    if (!question || question.trim().toLowerCase() === 'exit') break;

    try {
      const { answer, sources } = await answerQuestion(question);
      console.log(`\n${answer}\n`);
      if (sources.length) {
        console.log(`Sources:\n${sources.map((s) => `  - ${s}`).join('\n')}\n`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}\n`);
    }
  }

  rl.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
