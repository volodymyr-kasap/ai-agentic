import { config } from '../config.js';

/**
 * Ollama adapter.
 *
 * Ollama speaks the OpenAI-ish function-calling shape: tools are wrapped in
 * `{type:"function", function:{...}}`, results come back on `message.tool_calls`,
 * and there is no `stop_reason` — the turn is final when `tool_calls` is absent.
 *
 * The one real mismatch with the agent's internal format: Ollama tool calls carry
 * no id, so results are matched back by tool *name*. We synthesize ids here so the
 * loop and the trace can stay uniform across providers.
 */

export function createOllamaProvider() {
  const { url, model } = config.ollama;

  return {
    name: `ollama:${model}`,

    async chat({ system, messages, tools }) {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, ...messages.flatMap(toOllamaMessages)],
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          stream: false,
          options: {
            temperature: 0,
            // Ollama defaults to a 4096-token context and silently drops the
            // oldest messages past it. An agent transcript blows through that in
            // two or three tool results, and the symptom is not an error — it is
            // a model that forgets the system prompt and repeats a failed edit
            // forever. Raise it explicitly; this is the single most important
            // setting for making a local model usable in a loop.
            num_ctx: config.ollama.contextTokens,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Ollama chat failed (${res.status}). Make sure Ollama is running and the model ` +
            `"${model}" is pulled: ollama pull ${model}\n${body}`
        );
      }

      const data = await res.json();
      const message = data.message ?? {};

      const toolCalls = (message.tool_calls ?? []).map((call, i) => ({
        id: `ollama_${Date.now()}_${i}`,
        name: call.function?.name,
        input: parseArguments(call.function?.arguments),
      }));

      return { text: message.content ?? '', toolCalls, raw: null };
    },
  };
}

/** One internal message can expand into several Ollama messages (one per tool result). */
function toOllamaMessages(msg) {
  if (msg.role === 'user') {
    return [{ role: 'user', content: msg.content }];
  }

  if (msg.role === 'assistant') {
    const out = { role: 'assistant', content: msg.text ?? '' };
    if (msg.toolCalls?.length) {
      out.tool_calls = msg.toolCalls.map((c) => ({
        function: { name: c.name, arguments: c.input },
      }));
    }
    return [out];
  }

  if (msg.role === 'tool_results') {
    // Ollama wants one message per result, keyed by tool name rather than call id.
    const out = msg.results.map((r) => ({
      role: 'tool',
      tool_name: r.name,
      content: r.isError ? `ERROR: ${r.content}` : r.content,
    }));
    // The verification report did not come from a tool the model called, so it
    // goes back as a user turn rather than a tool result.
    if (msg.note) out.push({ role: 'user', content: msg.note });
    return out;
  }

  return [];
}

/**
 * Ollama usually returns `arguments` already parsed, but smaller models sometimes
 * emit a JSON string — and occasionally a malformed one. Never string-match on it;
 * hand a parse failure back to the loop as an empty input so the tool can complain.
 */
function parseArguments(args) {
  if (args && typeof args === 'object') return args;
  if (typeof args !== 'string') return {};
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}
