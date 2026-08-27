# Site Archive — a local RAG on Node.js

Learning project: scrape a site → split the text into chunks → turn them into
embeddings with a local model via **Ollama** → store them in **ChromaDB** → for a
question, retrieve the relevant pieces and ask the local model to answer while
citing its sources.

Everything runs offline and for free (apart from the site scraping itself).

```
Site --scrape--> data/raw/*.json --ingest--> Chroma (vectors)
                                                   ^
                                                   |  similar chunks
Question --------------------------------embed----+---> LLM (Ollama) --> Answer + sources
```

## Stack

- **Node.js 20+** — all the logic
- **Ollama** — local models for embeddings and answer generation
- **ChromaDB** — local vector store (Python server, Node client)
- **axios + cheerio** — scraping and HTML parsing
- **Fastify** — API and serving the simple web UI

## 1. Install the prerequisites

**Ollama** (https://ollama.com):

```bash
# pull the embedding model and the generation model
ollama pull nomic-embed-text
ollama pull llama3.1
```

Ollama must be running (it usually starts as a background service on
`http://localhost:11434` right after installation).

**ChromaDB server** (requires Python):

```bash
pip install chromadb
chroma run --path ./chroma_data
```

This starts the server on `http://localhost:8000`. Alternatively, use Docker:

```bash
docker run -p 8000:8000 chromadb/chroma
```

## 2. Install the project

```bash
npm install
cp .env.example .env
```

`.env` already contains working defaults — you don't need to touch it unless
you changed ports or models.

## 3. Scrape a site

```bash
npm run scrape -- https://example.com --depth 1 --limit 20
```

- `--depth` — how many link hops inside the domain to follow (0 — start page only)
- `--limit` — maximum number of pages

The result is JSON files with the page text in `data/raw/`.

## 4. Index (chunk + embed + load into Chroma)

```bash
npm run ingest
```

The script splits each page's text into overlapping chunks (~220 words),
embeds them in batches via Ollama and loads them into the Chroma collection
(`upsert`, so re-running does not create duplicates).

## 5. Ask questions

From the terminal:

```bash
npm run query
```

Or through the web UI:

```bash
npm run server
# open http://localhost:3000
```

The answer is built strictly from the retrieved fragments, and the URLs that
were used are shown to the right of (or below) the answer.

## Project structure

```
src/
  lib/
    ollama.js   — Ollama calls (embeddings + chat)
    chroma.js   — ChromaDB client
    chunk.js    — splitting text into chunks
  scrape.js     — CLI: crawl a site and save the text
  ingest.js     — CLI: chunking + embeddings + loading into Chroma
  query.js      — RAG logic (retrieval + generation) + CLI
  server.js     — Fastify API (/api/ask, /api/health) + serves public/
public/
  index.html    — simple chat UI
data/raw/       — raw scraped pages (JSON)
```

## Debugging the server

The server logs structured JSON (pino) for every request: request id, method, URL,
status code and duration in ms, plus per-question timing, source count and answer length.

```bash
LOG_LEVEL=debug npm run server   # also logs request headers/bodies and answer payloads
```

`GET /api/health` reports the resolved config and probes the dependencies — whether Ollama
is reachable and the configured embed/chat models are actually pulled, and whether Chroma
is reachable and how many chunks the collection holds:

```bash
curl -s localhost:3000/api/health | jq
```

## Where to take it next

- **Better chunking**: a sentence/token splitter instead of words (e.g. from LangChain.js)
- **Hybrid search**: combine vector search with BM25/keyword search
- **Reranking**: run the top-N results through a reranker model before generation
- **Streaming answers**: `stream: true` in Ollama + Server-Sent Events on the frontend
- **Incremental scraping**: skip re-scraping unchanged pages (ETag/Last-Modified)
- **Quality evaluation**: a set of question-answer pairs and retrieval precision/recall metrics

## Common problems

- **`ECONNREFUSED` on 11434** — Ollama is not running. Start the Ollama app or `ollama serve`.
- **`ECONNREFUSED` on 8000** — the Chroma server is not running (see step 1).
- **Empty/poor answers** — increase `--limit` when scraping or `TOP_K` in `.env`.
- **Scraping returns nothing** — some sites render content via JS (SPA).
  `axios + cheerio` only sees the source HTML; for such sites you need a
  headless browser (e.g. Playwright) instead of `axios.get`.
