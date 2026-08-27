import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

/**
 * Anthropic adapter (Messages API).
 *
 * Three things differ from Ollama in ways that matter to the loop:
 *
 *  1. Tool calls are `tool_use` content blocks with an `id`, and results must come
 *     back as `tool_result` blocks keyed by that id — all of them in a SINGLE user
 *     message. Splitting them across messages teaches the model to stop making
 *     parallel calls.
 *  2. The turn ends on `stop_reason`, not on the absence of tool calls.
 *  3. With adaptive thinking on, the response contains `thinking` blocks that must
 *     be echoed back UNCHANGED on the next request. That is why the assistant turn
 *     stores the raw content array (`raw`) and replays it verbatim rather than
 *     reconstructing text + tool_use from the internal format.
 */

export function createAnthropicProvider() {
  const { model, apiKey, fallbacks } = config.anthropic;

  // A missing ANTHROPIC_API_KEY is not fatal: the SDK also picks up an
  // `ant auth login` profile. Passing undefined lets it do its own resolution.
  const client = new Anthropic(apiKey ? { apiKey } : {});

  return {
    name: `anthropic:${model}`,

    async chat({ system, messages, tools }) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        messages: messages.map(toAnthropicMessage),
        // Route around a safety refusal instead of dying mid-task. Set
        // ANTHROPIC_FALLBACKS=0 to drop this.
        ...(fallbacks
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
          : {}),
      });

      // Guard before reading content: a refusal returns HTTP 200 with no answer.
      if (response.stop_reason === 'refusal') {
        throw new Error(
          `The model declined this request (${response.stop_details?.category ?? 'unknown'}): ` +
            `${response.stop_details?.explanation ?? 'no explanation given'}`
        );
      }

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      const toolCalls = response.content
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({ id: block.id, name: block.name, input: block.input }));

      return { text, toolCalls, raw: response.content };
    },
  };
}

function toAnthropicMessage(msg) {
  if (msg.role === 'user') {
    return { role: 'user', content: msg.content };
  }

  if (msg.role === 'assistant') {
    // Replay the original blocks when we have them — thinking blocks included.
    return { role: 'assistant', content: msg.raw ?? rebuildAssistantContent(msg) };
  }

  if (msg.role === 'tool_results') {
    const content = msg.results.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.id,
      content: r.content,
      is_error: r.isError,
    }));
    // The verification report is a plain text block appended to the same turn.
    // It cannot be its own message: tool_result blocks must be the content of a
    // single user turn, and a second consecutive user message would break that.
    if (msg.note) content.push({ type: 'text', text: msg.note });
    return { role: 'user', content };
  }

  throw new Error(`Unknown internal message role: ${msg.role}`);
}

/** Fallback for transcripts that did not come from this provider. */
function rebuildAssistantContent(msg) {
  const blocks = [];
  if (msg.text) blocks.push({ type: 'text', text: msg.text });
  for (const call of msg.toolCalls ?? []) {
    blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
  }
  return blocks.length ? blocks : [{ type: 'text', text: '(no content)' }];
}
