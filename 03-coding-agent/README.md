# Coding Agent — a minimal agent loop on Node.js

Learning project: the smallest thing that is honestly a coding agent. A model is
given a task and a handful of tools, and it works on a real project until it decides
it is done — reading files, searching, editing, running tests.

This is **Versions 1, 2 and 3** of the roadmap's coding-agent project: the loop, the
feedback loop that keeps it honest, and the skill system that decides what the model
is told in the first place. No sandbox yet — that is V4.

```
        Task: "add a DELETE /users/:id endpoint"
                        │
                        ▼                                    V3
              ┌───────────────────┐   catalog  api, testing, nestjs, database
              │   skill router    │   loads    api ●  testing ●
              └─────────┬─────────┘   skips    nestjs ○  database ○
                        │
                        ▼   system prompt = rules + the ● bodies, rebuilt each step
              ┌───────────────────┐      ▲
              │  LLM decides the  │◄─────┴── load_skill pulls in a ○ mid-run
              │  next step        │◄───────────────┬──────────────┐
              └─────────┬─────────┘                │              │
                        │                          │              │
              tool calls│                   results│              │
                        ▼                          │              │
          ┌─────────────────────────────┐          │              │
          │ read_file    list_files     │          │              │
          │ search_code  edit_file      │──────────┘              │
          │ run_command  load_skill     │                         │
          └─────────────┬───────────────┘                         │
                        │ an edit landed                          │
                        ▼                                V2       │
                 ┌─────────────┐    failed    ┌──────────────────┐│
                 │  npm test   │─────────────▶│ failure output   ├┘
                 └──────┬──────┘              └──────────────────┘
                 passed │                              ▲
                        ▼                              │
                  no tool calls ──── "I'm done" ───────┘
                        │              (final check, red = back to work)
                        ▼
                  Answer + summary
```

**V1** is the inner circuit: the model's output feeds back into its own next input.
That is what makes it an agent rather than a chatbot — not the model, not the tools.

**V2** is the outer one, and it exists because V1 has a specific, reproducible
failure. Run the demo task on `llama3.1` with `--no-verify` and you can watch the
agent finish a run in which *every single edit was rejected* and still report "the
endpoint was added, the test was added". Nothing in V1 is able to contradict it —
the only thing the model hears is its own voice.

The fix is not a better prompt. It is giving the harness a source of truth the model
does not author. The test suite is that source of truth: it runs after every landed
edit, and again if the model tries to declare victory, and a red result puts the
model straight back to work.

**V3** is about the other direction. V2 adds what the model cannot know; V3 removes
what it does not need. Four written-down conventions live in `skills/`, a router
reads the task and loads the two that apply, and the other two never enter the
prompt — while their one-line descriptions stay in the catalog, so the model can
still ask for them with `load_skill` once it has seen the code.

## Stack

- **Node.js 20+** — the loop, the tools, the CLI
- **Ollama** — a local model for a free, offline agent (`llama3.1` by default)
- **Anthropic Messages API** — the same loop against a frontier model
- Two dependencies total: `@anthropic-ai/sdk` and `dotenv`

Both backends are real. Running the same task on each is the fastest way to feel
how much of "agent quality" is the model versus the harness.

## Setup

```bash
npm install
cp .env.example .env
```

**For the Ollama path** (default — free, no API key), Ollama must be running with a
tool-calling model pulled:

```bash
ollama pull llama3.1
```

**For the Anthropic path**, set a key in `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

(or run `ant auth login` — the SDK picks up the profile on its own.)

## Run it

```bash
npm run agent -- "add a DELETE /users/:id endpoint and a test for it"

# against Claude instead of the local model
LLM_PROVIDER=anthropic npm run agent -- "add pagination to GET /users"

# see exactly what the model is allowed to do, and what it may be told
npm run tools
npm run skills
```

The first thing a run prints is the routing decision:

```
◇ skills api, testing (5.6k chars loaded, router=keyword)
  skipped database, nestjs — 5.3k chars not sent
  matched on api(endpoint/delete), testing(test)
```

Options:

| Flag | Effect |
|---|---|
| `--provider <name>` | `ollama` or `anthropic` |
| `--workspace <dir>` | which directory the agent may touch |
| `--max-steps <n>` | hard iteration cap (default 20) |
| `--verify <cmd>` | what the harness runs to check the work (default `npm test`) |
| `--no-verify` | turn the V2 feedback loop off — useful for seeing why it exists |
| `--skills <dir>` | which skill library to route from (default `./skills`) |
| `--router <mode>` | `keyword` (default), `llm`, `all`, `off` |
| `--skill <name>` | force a skill to load, skipping the router (repeatable) |
| `--max-skills <n>` | cap on skills loaded up front (default 3) |
| `--no-skills` | turn the V3 skill system off — the other half of the comparison |
| `--list-skills` | print the catalog and what each skill would cost |
| `--allow <prefix>` | add a command prefix to the allowlist (repeatable) |
| `--approve` | confirm before every `run_command` |
| `--yolo` | skip the command allowlist entirely |
| `--verbose` | print full tool output, not just the first line |

The agent works inside `workspace/` — a small NestJS-shaped HTTP API with tests,
included so there is something real to change. Point `--workspace` at your own
project when you want to see it work on real code.

Since the agent really does edit those files, reset them between runs:

```bash
git checkout -- workspace/     # `git checkout` is not on the allowlist, so the agent can't undo its own work
```

## The tools

| Tool | What it does |
|---|---|
| `read_file` | Read a file, line-numbered, with optional offset/limit |
| `list_files` | Tree listing, skipping `node_modules` and build output |
| `search_code` | Regex search over file contents, returns `path:line: text` |
| `edit_file` | Replace an exact string that must match **exactly once** |
| `run_command` | Run an allowlisted shell command, capture stdout/stderr/exit code |
| `load_skill` | Pull one skill's full text into the prompt (V3; hidden with `--no-skills`) |

Five for the code is not a limitation — it's roughly what a coding agent needs.
Capability comes from the loop composing them, not from having more of them.
`load_skill` is a different animal: it changes what the model *knows* rather than
what the project *is*.

The uniqueness rule on `edit_file` is the one non-obvious design choice. A plain
`replace()` silently edits the *first* match, which on a repeated line like
`return this.users;` is often the wrong one, and the model never finds out.
Requiring a unique match turns silent corruption into an error the model can act on.

## Project structure

```
skills/           V3: the library — one directory, one SKILL.md each
  nestjs/SKILL.md    module/controller/service layering, where new code goes
  api/SKILL.md       the HTTP contract: params, status codes, error shape
  testing/SKILL.md   node:test, the withServer helper, what to assert
  database/SKILL.md  the data layer, id and seed rules, adding persistence
src/
  agent.js        THE LOOP — V1 and V2, plus the V3 routing step before it
  verify.js       V2: runs the check the model does not control
  cli.js          argument parsing, step tracing
  prompts.js      the system prompt, rebuilt each step from the loaded skills
  config.js       env + defaults
  skills/
    index.js      discovery, frontmatter parsing, the loaded-set registry
    select.js     THE ROUTER — task -> which skills
  llm/
    index.js      provider factory
    ollama.js     /api/chat with `tools`
    anthropic.js  Messages API with `tools`
  tools/
    index.js      registry + executeTool()
    read-file.js  list-files.js  search-code.js  edit-file.js  run-command.js
    load-skill.js V3: the model's way into a skill the router did not pick
  lib/
    workspace.js  path confinement
    shell.js      one spawn helper, shared by run_command and verify.js
    truncate.js   output caps
    result.js     toolFailure() — marks a result as a failure for the trace
    log.js        step tracing
workspace/        the demo project the agent edits
```

### The transcript is ours, not the provider's

The loop keeps its own message format and each adapter translates it to the wire:

```js
{ role: 'user',         content: string }
{ role: 'assistant',    text, toolCalls: [{ id, name, input }], raw? }
{ role: 'tool_results', results: [{ id, name, content, isError }], note? }
```

`note` is where V2's verification report rides. It travels with the tool results
rather than as its own message because Anthropic requires `tool_result` blocks to
be the content of a single user turn — a second consecutive user message would be
rejected. The Ollama adapter, which has no such rule, appends it as a plain user
turn instead. Same information, two different shapes: exactly the sort of thing the
adapter layer exists to absorb.

That indirection is what lets one loop drive two quite different APIs:

| | Ollama | Anthropic |
|---|---|---|
| Tool schema | `{type:"function", function:{…}}` | `{name, description, input_schema}` |
| Calls arrive as | `message.tool_calls[]` — **no ids** | `tool_use` blocks with an `id` |
| Results go back as | one `{role:"tool"}` message each | `tool_result` blocks, all in **one** user message |
| Turn ends when | `tool_calls` is absent | `stop_reason` says so |

The Ollama adapter synthesizes call ids so the loop never has to care. The Anthropic
adapter replays the raw content blocks verbatim, because adaptive thinking blocks
must come back unchanged.

## V2: the feedback loop

Two hook points, both in `src/agent.js`:

1. **After every edit that lands.** The harness runs the verify command itself and
   appends the result to the same turn as the tool results. The model does not ask
   for it and cannot skip it.
2. **When the model says it is finished.** If it touched the code and the suite has
   not passed since, the check runs once more. Red means it is not done: the loop
   pushes back with the failure and keeps going, rather than accepting the claim.

Details that matter:

- **The operator picks the command**, via `--verify` or `VERIFY_COMMAND`. It
  deliberately bypasses the `run_command` allowlist, because it is not the model's
  command — the model can neither change it nor route around it.
- **The model is told verification exists** (see `VERIFICATION_SECTION` in
  `prompts.js`). This changes behaviour on its own: knowing something else is about
  to look stops it treating "I wrote an edit" as "the code works".
- **If the model ran the suite itself that turn, the harness doesn't run it again** —
  no point paying twice, and two identical reports in context just invite confusion.
- **The exit code now means something.** A run ends non-zero if verification is
  failing or the step cap was hit, so the agent can be driven from a script without
  parsing its prose.

The honest limitation: this makes the agent unable to *claim* success falsely, not
unable to *fail*. A stubborn model still burns every remaining step and exits 1.
That is the right outcome — a loud failure instead of a quiet lie.

## V3: skills

A skill is a written-down convention — "in this codebase, a handler returns
`{ status, body }` and never touches `res`" — kept in `skills/<name>/SKILL.md`:

```markdown
---
name: api
description: The HTTP contract — how handlers return status and body, which codes to use.
triggers: api, http, endpoint, route, status, 404, pagination, validation, ...
---

# The HTTP contract
...the actual instructions...
```

The naive thing to do with four such files is paste all of them into the system
prompt. That works at four and fails at forty, and not only for cost: **irrelevant
instructions are not neutral**. A model told about repository patterns while writing
a test will find a way to use them.

So a skill is stored in two halves, and the split is the whole design:

| Half | Where it goes | Cost |
|---|---|---|
| frontmatter — `name` + `description` | **always** in the prompt, as a catalog | one line per skill |
| body — the instructions | only when the task needs it | 2–3k characters each |

The catalog is what makes the rest work: it is how the model knows a skill exists
without paying for its text, and therefore how it knows what to ask for.

### Routing: task → skills

`src/skills/select.js`, run once before the first step, so the model's *first*
decision is already made with the right conventions in front of it.

| `--router` | How it picks | Trade |
|---|---|---|
| `keyword` (default) | trigger words from the frontmatter, matched word-boundary against the task | free, instant, deterministic — and blind to anything the author didn't list |
| `llm` | one extra model call that reads the catalog and answers with a JSON array | understands paraphrase, costs a round trip, occasionally invents a skill name (dropped) |
| `all` | everything | the baseline V3 exists to beat |
| `off` | nothing up front, catalog only | the model must ask for what it wants |

The difference is easy to see for yourself:

```bash
npm run agent -- "make the users list not return everything at once"
#   keyword: no trigger matched — nothing loaded
#   --router llm: model chose api
```

Neither is reliable enough to be the only way in, which is why there is a third.

### `load_skill`: the model's own way in

The router only ever sees the task string, and half of what a task needs becomes
obvious later — "fix the failing test" says nothing about seed data until you read
the failure. `load_skill("database")` pulls a body in mid-run.

Its result is a receipt, not the text. The body arrives through the **system
prompt**, which the loop rebuilds every step from the loaded set:

```js
const system = systemPrompt({ workspace, maxSteps, verifying: verifyEnabled() });
```

One mechanism, one place skills live, routed and self-requested alike — no drift
between a copy in the transcript and a copy in the prompt. The cost is that the
system prompt is no longer constant across a run, which matters the day this grows
prompt caching; the fix then is to cache up to the skills section, not to move them.

### What to watch

The `skipped` line in the trace is the point of the whole version:

```
◇ skills api, testing (5.6k chars loaded, router=keyword)
  skipped database, nestjs — 5.3k chars not sent
```

Half the library stayed out of the prompt, and the model was still told it exists.

## Safety

There is no sandbox yet, so the guards *are* the fence — enough to contain a confused
model, which is the actual threat here, not a determined attacker:

- **Workspace confinement** — every path is resolved against the workspace root and
  rejected if it escapes, symlinks included.
- **Command allowlist** — the command is split on `&&`, `||`, `;` and `|`, and
  *every* segment must match, so `npm test && rm -rf ~` is refused on its second
  half. Command substitution is refused outright.
- **Timeouts and truncation** — unbounded tool output is one of the fastest ways to
  blow a context window mid-run.
- **Step cap** — so a confused model can't loop forever.

One thing V3 adds to the threat model: **a skill is unverified text that lands
directly in the system prompt**, and the model is told to treat it as house rules.
`--skills <dir>` therefore points at something you trust as much as the code — a
skill library pulled from somewhere else is prompt injection with a directory
structure.

## Things worth trying

- Run the demo task twice on `llama3.1`, once with `--no-verify` and once without.
  The first will very likely end in a confident summary of work it never did. This
  is the single most convincing thing in the project.
- Run the same task on `llama3.1` and on Claude, and read both traces. The gap is
  mostly in *planning* — how many steps get wasted re-reading files.
- Break a test yourself, then give the agent an unrelated task. Watch V2 hand it a
  failure it did not cause, and see whether it investigates or blames its own edit.
- Break the system prompt on purpose (delete "read before you edit") and watch the
  `edit_file` failure rate climb. Most "the agent is dumb" problems are prompt
  problems.
- Give it a debugging task instead of a building one: break a test, then ask it why
  the suite fails.
- Run one task with `--no-skills` and once without, and diff the two traces. On a
  small model the difference is loud: without the `api` skill it reaches for
  `res.json()` and `res.status()`, because Express is what the weights know.
- Run `--router all` against `--router keyword` on a narrow task, and watch what the
  three extra skills talk it into doing.
- Word a task so no trigger fires ("make the users list not return everything at
  once") and watch the keyword router come back empty — then run it with
  `--router llm`. That gap is why `load_skill` exists.
- Add a fifth skill of your own with deliberately bad advice and see how much the
  model defers to it. Skills are unverified text that goes straight into the prompt;
  that is exactly as dangerous as it sounds.
- Watch what happens when a tool returns an error. Recovering from its own mistakes
  is most of what an agent does.

## Where to take it next

Following the roadmap (V1, V2 and V3 are built):

- **V4 — full harness**: context builder, sandbox, evaluator, memory, observability.

The V3 pieces that are deliberately left undone:

- **Progressive disclosure inside a skill** — a real library has skills too long to
  load whole. The next step is `SKILL.md` as an index over supporting files the
  model opens on demand, which is why a skill is a directory here and not a file.
- **Routing on more than the task string** — the changed files, the failure output,
  the previous step's tool results are all better evidence than the first sentence
  the user typed.
- **Unloading** — nothing ever leaves the prompt once loaded. Fine for a 20-step
  run, wrong for a long one.

Smaller improvements worth doing first:

- **Streaming** — print tokens as they arrive instead of waiting for a whole turn.
- **Context management** — the transcript here only ever grows; long runs need
  trimming or summarization.
- **A diff view** — show `edit_file` changes as a patch in the trace.
- **Usage accounting** — tokens and cost per step.

## Common problems

- **`ECONNREFUSED` on 11434** — Ollama isn't running. Start the app, or `ollama serve`.
- **The model never calls a tool** — the Ollama model doesn't support tool calling.
  `llama3.1`, `qwen2.5-coder` and `mistral-nemo` do; many others don't.
- **The model repeats the same failed tool call forever** — almost always context
  truncation. Ollama defaults to a **4096-token** context and silently drops the
  oldest messages past it, so after two or three tool results the model has lost
  the system prompt and the error it was supposed to learn from. `OLLAMA_CONTEXT`
  sets `num_ctx` explicitly (16384 here); it is the single most important setting
  for making a local model usable in a loop. There is no warning when this happens
  — the symptom is just a model that seems stupid.
- **`edit_file` keeps failing on "not found"** — the model is inventing file
  contents instead of reading them. Normal on small models; it's what the error
  message exists to correct.
- **It hits the step limit** — raise `--max-steps`, or give a narrower task. Small
  models spend a lot of steps re-reading what they already have.
- **No skill loads** — the task's wording missed every trigger. Check with
  `npm run skills`, add the word, or use `--router llm` / `--skill <name>`.
- **The model ignores a loaded skill** — small models weight the transcript far
  above the system prompt. Shorten the skill; a 2k-character guide is read, a
  10k-character one is skimmed.
