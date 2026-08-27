# AI Agentic Engineering

A learning monorepo. Four self-contained Node.js projects, each one built to make a
single idea about agentic systems concrete enough to argue with — plus the course
outline and roadmap they follow.

Nothing here is a framework. Every project is small, dependency-light and runnable
on a laptop; three of the four run entirely offline against a local model.

## The projects

| # | Project | The one idea | Stack |
|---|---|---|---|
| 01 | **[Site Archive — local RAG](01-rag/)** | Retrieval is a *search* problem wearing an LLM costume. Chunking and top-k decide answer quality far more than the model does. | Ollama · ChromaDB · Fastify · cheerio |
| 02 | **[MCP Weather Server](02-mcp/)** | Tools don't have to live inside your loop. A separate process + a standard protocol = a tool any client can discover. | MCP SDK · zod · stdio JSON-RPC |
| 03 | **[Coding Agent](03-coding-agent/)** | The loop is the agent, not the model. Then: what the harness *verifies* (V2) and what it *tells* the model (V3) matter more than tool count. | Ollama · Anthropic SDK · 2 deps total |
| 04 | **[Vision Extract](04-vision-extract/)** | A model's output is untrusted input. Validate every field on the way back, or ship hallucinated money. | TypeScript · Fastify · OpenRouter · sharp |

### 01 — [Site Archive](01-rag/) · local RAG over a scraped site

Scrape a site → chunk the text → embed it with a local model via Ollama → store the
vectors in ChromaDB → answer questions from the retrieved fragments, with sources.
Fully offline and free. Ships with a small web UI and a `/api/health` endpoint that
probes every dependency, because "the answer is empty" is almost always a
missing-service problem rather than a model problem.

```bash
cd 01-rag && npm install && cp .env.example .env
npm run scrape -- https://example.com --depth 1 --limit 20
npm run ingest && npm run server
```

### 02 — [MCP Weather Server](02-mcp/) · the protocol, with nothing around it

Two tools, hardcoded data, stdio transport. The data is fake on purpose: the point is
the handshake — how a client discovers a tool exists and what the model is actually
shown. The pairing of `get_weather` with `list_known_cities` is the smallest honest
illustration of a real rule: a model cannot guess your key space.

```bash
cd 02-mcp && npm install && npm run inspect
```

### 03 — [Coding Agent](03-coding-agent/) · a minimal agent loop that edits real code

The largest project here, and the one the roadmap builds toward. A model gets six
tools and a real NestJS-shaped workspace, and works until it decides it is done.

- **V1 — the loop.** Output feeds back into input. That circuit, not the model, is
  what makes it an agent.
- **V2 — the feedback loop.** The harness runs the test suite after every landed edit
  and again when the model claims victory. Run the demo task on `llama3.1` with
  `--no-verify` and watch it confidently report work it never did — the most
  convincing thing in the repo.
- **V3 — skills.** A library of `SKILL.md` conventions, a router that loads only the
  ones the task needs, and `load_skill` for the ones it discovers it needs mid-run.
  Irrelevant instructions are not neutral.

Runs against local Ollama or Anthropic — same loop, two adapters, which is the
fastest way to feel how much of "agent quality" is the model versus the harness.

```bash
cd 03-coding-agent && npm install && cp .env.example .env
npm run agent -- "add a DELETE /users/:id endpoint and a test for it"
```

### 04 — [Vision Extract](04-vision-extract/) · structured data out of a screenshot

`POST /tx/extract` with a screenshot, get back typed transaction fields. The
interesting half is everything *after* the model replies: closed vocabularies checked
against the same lists rendered into the prompt, amounts kept as decimal strings end
to end, placeholder text normalized to `null`, and a normalizer that never throws — a
partly legible screenshot still returns what was readable. TypeScript, 29 tests, no
network needed to run them.

```bash
cd 04-vision-extract && npm install && cp .env.example .env
npm test && npm run dev
```

## Reading order

The projects are numbered in the order they make sense, and each one is a reaction to
a limitation of the previous:

```
01-rag ──────► how do you get the right context in front of a model?
   │
   │           ...but retrieval is passive. What if the model could act?
   ▼
03-coding-agent ─► the loop, then verification, then what the model is told
   │
   │           ...but its tools are hardcoded into the harness.
   ▼
02-mcp ──────► tools as a separate process, behind a standard protocol
   │
   │           ...and everything above assumes the model's output is usable.
   ▼
04-vision-extract ─► it isn't. Validate on the way back.
```

If you only run one, run `03-coding-agent` with `--no-verify` once and without it
once. That contrast is the thesis of the whole repo.

## Documents

| File | What it is |
|---|---|
| [`AI_Agentic_Engineering_Course.md`](AI_Agentic_Engineering_Course.md) | Ten-module course outline: design patterns, prompt/context engineering, tool use, memory, planning, multi-agent, frameworks, safety & evals, production, capstone *(Russian)* |
| [`agentic_harness_roadmap.md`](agentic_harness_roadmap.md) | A six-week study plan through the primary sources — Codex harness engineering, SWE-agent, OpenHands, evals, the Agent SDK — and the V1→V4 spec that `03-coding-agent` implements *(Russian)* |

## Requirements

- **Node.js 20+** for `01-rag`, `02-mcp` and `03-coding-agent`
- **Node.js 22+** for `04-vision-extract` (`.nvmrc` included — `nvm use`)
- **[Ollama](https://ollama.com)** for `01-rag` and the default path of `03-coding-agent`
- **Python + ChromaDB** (or Docker) for `01-rag`'s vector store

There is no workspace root: each project has its own `package.json` and is installed
independently with `npm install` in its directory.

## API keys

Every project reads config from a `.env` that is **git-ignored**; each ships a
`.env.example` to copy. Only two projects can use a paid API at all:

| Project | Variable | Needed? |
|---|---|---|
| `03-coding-agent` | `ANTHROPIC_API_KEY` | No — defaults to local Ollama |
| `04-vision-extract` | `OPENROUTER_API_KEY` | Yes for `/tx/extract`; **not** for `npm test` |

`04-vision-extract` sends every uploaded image through OpenRouter to a third-party
model vendor. For transaction screenshots that is a real data-handling decision —
see [its README](04-vision-extract/README.md#the-model-provider) before pointing it at
anything you care about.

## License

Learning material, provided as-is.
