import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { embed } from './lib/ollama.js';
import { getCollection } from './lib/chroma.js';
import { splitIntoChunks } from './lib/chunk.js';

const RAW_DIR = path.resolve('data/raw');
const BATCH_SIZE = 16;

async function loadRawPages() {
  let files;
  try {
    files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const pages = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(RAW_DIR, file), 'utf-8');
    pages.push(JSON.parse(raw));
  }
  return pages;
}

function buildChunkRecords(pages) {
  const records = [];
  for (const page of pages) {
    const chunks = splitIntoChunks(page.text);
    chunks.forEach((text, i) => {
      const id = crypto.createHash('sha1').update(`${page.url}#${i}`).digest('hex');
      records.push({
        id,
        text,
        metadata: { url: page.url, title: page.title || page.url, chunkIndex: i },
      });
    });
  }
  return records;
}

async function main() {
  const pages = await loadRawPages();
  if (pages.length === 0) {
    console.error(
      `No saved pages found in ${RAW_DIR}.\nRun this first: npm run scrape -- <url>`
    );
    process.exit(1);
  }

  const records = buildChunkRecords(pages);
  console.log(`Loaded ${pages.length} pages -> ${records.length} chunks`);

  const collection = await getCollection();

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const embeddings = await embed(batch.map((r) => r.text));

    // upsert instead of add — re-running does not create duplicates
    await collection.upsert({
      ids: batch.map((r) => r.id),
      embeddings,
      documents: batch.map((r) => r.text),
      metadatas: batch.map((r) => r.metadata),
    });

    console.log(`Embedded and uploaded ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
  }

  console.log('Done. The collection is ready for queries.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
