import { config } from '../config.js';
import { createOllamaProvider } from './ollama.js';
import { createAnthropicProvider } from './anthropic.js';

/**
 * A provider is one method:
 *
 *   chat({ system, messages, tools }) -> { text, toolCalls, raw }
 *
 * where `messages` is the agent's own transcript format (see agent.js) and
 * `toolCalls` is `[{ id, name, input }]`. Everything provider-specific — wire
 * shapes, ids, stop conditions, thinking blocks — is the adapter's problem, which
 * is what lets one loop drive two very different APIs.
 */
export function createProvider(name = config.provider) {
  switch (name) {
    case 'ollama':
      return createOllamaProvider();
    case 'anthropic':
      return createAnthropicProvider();
    default:
      throw new Error(`Unknown LLM_PROVIDER "${name}". Expected "ollama" or "anthropic".`);
  }
}
