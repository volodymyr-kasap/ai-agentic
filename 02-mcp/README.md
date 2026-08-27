# MCP Weather Server — the smallest useful MCP server

Learning project: the **Model Context Protocol** reduced to the part that matters.
A server that exposes two tools over stdio, with fake data behind them, so that
nothing distracts from the protocol itself.

The data is hardcoded on purpose. The interesting question here is not "how do I
call a weather API" — it is *how does a model find out a tool exists, and what
does the handshake look like*.

```
 ┌──────────────┐   stdio (JSON-RPC 2.0)   ┌────────────────────┐
 │  MCP client  │◄────────────────────────►│   this server      │
 │ Claude Code, │                          │                    │
 │ Claude Desktop│  1. initialize          │  get_weather       │
 │ Inspector... │  2. tools/list  ─────────┤  list_known_cities │
 └──────────────┘  3. tools/call           └────────────────────┘
```

## Why MCP at all

In `03-coding-agent` the tools are hardcoded into the harness: the loop knows every
tool at startup because the developer wrote them into a registry. That works right
up to the moment you want the *same* tool in two different agents, or a tool
maintained by someone who does not have commit access to your loop.

MCP is the answer to that: a tool provider becomes a separate process speaking a
standard protocol, and any MCP-capable client can discover and call it. The agent
loop stops being the place tools live.

## Stack

- **Node.js 20+**
- **`@modelcontextprotocol/sdk`** — `McpServer` + `StdioServerTransport`
- **`zod`** — input schemas; the SDK converts them to the JSON Schema the client sees

## Run it

```bash
npm install
npm start
```

Nothing appears to happen — that is correct. The server talks JSON-RPC over stdin
and stdout, so a bare `npm start` is a process waiting for a client. **Never
`console.log` in a stdio MCP server**: stdout is the transport, and a stray log line
corrupts the protocol frame. Use `console.error` (stderr) for debugging.

### Drive it with the Inspector

The official GUI is the fastest way to see the protocol:

```bash
npm run inspect
```

It opens a browser tab where you can run `tools/list`, call a tool with arguments
and read the raw JSON-RPC traffic in both directions.

### Drive it by hand

The protocol is plain newline-delimited JSON-RPC, so `echo` is a valid client:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_weather","arguments":{"city":"Berlin"}}}' \
  | node server.js
```

Reading that exchange once is worth more than any diagram: `initialize` negotiates,
`tools/list` returns the schemas the model will be shown, `tools/call` runs one.

### Connect it to Claude Code

```bash
claude mcp add weather -- node /absolute/path/to/02-mcp/server.js
```

Then ask Claude something that needs it ("what's the weather in Wrocław?") and watch
it pick the tool out of the catalogue on its own.

For Claude Desktop, the equivalent lives in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "weather": { "command": "node", "args": ["/absolute/path/to/02-mcp/server.js"] }
  }
}
```

Use an **absolute path** in both cases — the client spawns the process itself and
does not inherit your shell's working directory.

## The tools

| Tool | Input | What it returns |
|---|---|---|
| `get_weather` | `{ city: string }` | A one-line forecast, or `"No data"` for an unknown city |
| `list_known_cities` | `{}` | JSON array of the cities that have data |

Two tools rather than one, because that pair is the smallest illustration of a real
design rule: **a model cannot guess your key space.** `get_weather("Wroclaw")` — no
diacritic — silently returns `"No data"`, and the model has no way to tell a broken
call from a genuinely unknown city. `list_known_cities` is what makes the first tool
usable, and the same shape recurs everywhere (list-then-fetch, search-then-read).

## The three things that make a tool work

A tool definition is mostly prose, and the prose is the part the model actually reads:

```js
server.tool(
  "get_weather",                  // 1. the name — a verb the model can pattern-match
  "Return the current weather",   // 2. the description — the ONLY thing that decides
                                  //    whether the model reaches for it. Say when to
                                  //    use it, not just what it does.
  { city: z.string() },           // 3. the schema — becomes JSON Schema on the wire,
                                  //    and it is the client that enforces it, so a
                                  //    handler never sees a malformed argument
  async ({ city }) => ({ content: [{ type: "text", text: "…" }] })
);
```

The return shape is always `{ content: [...] }` — a list of blocks, because a tool
result is not always text. Errors are returned in-band with `isError: true` rather
than thrown, so the model can read what went wrong and try again.

## Things worth trying

- **Break the description.** Change `"Return the current weather"` to `"wx"` and ask
  the same question. Watch the model stop finding the tool. Tool descriptions are
  prompt engineering, and this is the cheapest way to prove it.
- **Add a required field the model can't know** — `{ city: z.string(), apiVersion: z.string() }`
  — and watch it invent one. Then make it `.optional()`.
- **`console.log("hello")` inside a handler** and watch the client fail to parse the
  response. That failure mode is confusing the first time and obvious ever after.
- **Return `isError: true`** for an unknown city instead of `"No data"`, and compare
  how the model behaves. An error it can read is worth more than an empty success.
- **Add a resource or a prompt** (`server.resource(...)`, `server.prompt(...)`) — tools
  are the most used of the three MCP primitives, not the only one.

## Where to take it next

- **Real data** — swap the hardcoded object for `fetch` against a public weather API,
  and deal with the first real problem: what a tool should return when upstream is down.
- **HTTP transport** — `StreamableHTTPServerTransport` instead of stdio, which is what
  a server that is not a local subprocess needs.
- **Authentication** — the moment it is over HTTP, the question of who may call it
  becomes real.
- **Consume MCP from `03-coding-agent`** — attach this server to the agent loop so its
  tools sit next to the hardcoded ones. That is the point where MCP stops being a demo.
