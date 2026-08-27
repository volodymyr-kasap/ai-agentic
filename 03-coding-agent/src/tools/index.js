import readFile from './read-file.js';
import listFiles from './list-files.js';
import searchCode from './search-code.js';
import editFile from './edit-file.js';
import runCommand from './run-command.js';
import loadSkill from './load-skill.js';

/**
 * The agent's entire capability surface. Five tools for the code is not a
 * limitation of this project — it is roughly what a coding agent needs. Capability
 * comes from the loop composing them, not from having many of them.
 *
 * load_skill is the sixth and is a different kind of thing: it does not touch the
 * project at all, it changes what the model knows. It hides itself when the harness
 * runs without skills (see `available`), because a tool that cannot do anything is
 * still a tool the model will try.
 */
export const tools = [readFile, listFiles, searchCode, editFile, runCommand, loadSkill];

const byName = new Map(tools.map((t) => [t.name, t]));

/**
 * Provider-neutral schemas; each LLM adapter reshapes these for its own wire format.
 * A tool may declare `available()` to keep itself out of the list for this run.
 */
export function toolSchemas() {
  return tools
    .filter((tool) => tool.available?.() !== false)
    .map(({ name, description, parameters }) => ({ name, description, parameters }));
}

/**
 * Execute one tool call. Never throws: a failure is a result the model must see
 * and recover from, exactly like a successful one. Swallowing it would leave the
 * model waiting on a tool result that never arrives.
 *
 * @param {{ id: string, name: string, input: object }} call
 * @returns {Promise<{ id: string, name: string, content: string, isError: boolean }>}
 */
export async function executeTool(call) {
  const tool = byName.get(call.name);
  if (!tool) {
    return {
      id: call.id,
      name: call.name,
      content: `No such tool "${call.name}". Available tools: ${[...byName.keys()].join(', ')}.`,
      isError: true,
    };
  }

  try {
    const returned = await tool.handler(call.input ?? {});
    // Handlers return a plain string on success, or toolFailure(...) to flag one.
    const { content, isError } =
      typeof returned === 'object' && returned !== null
        ? returned
        : { content: returned, isError: false };
    return { id: call.id, name: call.name, content: String(content), isError };
  } catch (err) {
    return {
      id: call.id,
      name: call.name,
      content: `${tool.name} failed: ${err.message}`,
      isError: true,
    };
  }
}
