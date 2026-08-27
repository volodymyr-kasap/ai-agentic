import { executeTool, toolSchemas } from './tools/index.js';
import { systemPrompt } from './prompts.js';
import { verify, verifyEnabled, modelAlreadyVerified } from './verify.js';
import { loadedSkills, markLoaded, skillsEnabled } from './skills/index.js';
import { selectSkills } from './skills/select.js';
import * as log from './lib/log.js';

/**
 * THE AGENT LOOP.
 *
 * V1 was this, and only this:
 *
 *     task -> model -> tool calls -> results -> model -> ... -> answer
 *
 * What makes it an agent is that the model's output feeds back into its own next
 * input, so it can act on what it just learned.
 *
 * V2 adds a second feedback source the model does not author:
 *
 *     ... -> edits -> npm test -> failures -> model -> fix -> npm test -> ...
 *
 * That distinction is the whole point. Tool results tell the model what happened;
 * verification tells it whether the code actually works. Without it, a model can
 * finish a run in which every edit was rejected and still report success — which
 * is exactly what llama3.1 did before this existed.
 *
 * V3 adds a third input, and this one arrives before the first step:
 *
 *     task -> router -> the 2 skills out of 4 that this task needs -> system prompt
 *
 * Both V2 and V3 are about what the model is told, but from opposite directions.
 * V2 adds what it cannot know (did the code work?). V3 removes what it does not
 * need (how we do databases, during a test-writing task). The loop below is still
 * V1's; everything since has been about the quality of its context.
 *
 * The transcript format is our own, not any provider's:
 *
 *   { role: 'user',         content: string }
 *   { role: 'assistant',    text: string, toolCalls: [{id, name, input}], raw?: any }
 *   { role: 'tool_results', results: [{id, name, content, isError}], note?: string }
 *
 * Adapters in src/llm/ translate it to and from the wire. `note` carries the
 * verification report; it rides along with the tool results rather than becoming a
 * message of its own, because Anthropic requires tool_result blocks to be the
 * content of a single user turn. `raw` is an escape hatch for provider-specific
 * blocks that must be replayed verbatim (Anthropic's thinking blocks); the loop
 * itself never looks at either.
 */

/** Tools whose success means the code on disk changed, so verification is due. */
const MUTATING_TOOLS = new Set(['edit_file']);

/**
 * @param {object} params
 * @param {string} params.task            what the user asked for
 * @param {object} params.provider        from createProvider()
 * @param {string} params.workspace       absolute workspace root
 * @param {number} params.maxSteps        hard iteration cap
 * @param {object} [params.skills]        V3 routing: { router, max, forced }
 * @returns {Promise<{ answer: string, steps: number, hitLimit: boolean,
 *                     edited: boolean, verified: boolean|null, skills: string[],
 *                     messages: any[] }>}
 */
export async function runAgent({ task, provider, workspace, maxSteps, skills = {} }) {
  const tools = toolSchemas();

  // ---- V3: route the task to its skills, before any step is spent ------------
  // Up front, because the whole point is that the model's FIRST decision is made
  // with the right conventions already in front of it. Anything the router misses
  // is still reachable mid-run through the load_skill tool.
  if (skillsEnabled()) {
    const routing = await selectSkills({
      task,
      provider,
      mode: skills.router,
      max: skills.max,
      forced: skills.forced,
    });
    for (const skill of routing.selected) markLoaded(skill.name);
    log.skills(routing);
  }

  /** The context. It only ever grows — trimming it is roadmap V4's problem. */
  const messages = [{ role: 'user', content: task }];

  /** Has any edit landed? Verification is pointless before the first one. */
  let edited = false;
  /** Result of the most recent verification run, or null if we never ran one. */
  let verified = null;

  for (let step = 1; step <= maxSteps; step += 1) {
    log.step(step, maxSteps);

    // Rebuilt every step rather than hoisted, so a skill the model loaded on the
    // previous turn is in front of it on this one. Cheap: it is string assembly,
    // and the whole prompt is re-sent on every request either way.
    const system = systemPrompt({ workspace, maxSteps, verifying: verifyEnabled() });

    const { text, toolCalls, raw } = await provider.chat({ system, messages, tools });

    log.thinking(text);
    messages.push({ role: 'assistant', text, toolCalls, raw });

    // ---- the model thinks it is finished -----------------------------------
    if (toolCalls.length === 0) {
      // V2: it does not get the last word. If it touched the code, the suite has
      // to agree before the run is allowed to end.
      //
      // This re-runs even when the last post-edit check was green, which costs one
      // extra suite run per completed task. That is deliberate: the alternative is
      // tracking whether anything could have invalidated the last green result —
      // another edit, an npm install, a stray run_command — and the moment that
      // bookkeeping is wrong, the agent finishes on a red suite. A second test run
      // is cheaper than that bug.
      if (verifyEnabled() && edited) {
        const check = await verify();
        verified = check.ok;
        log.verify(check.ok, 'final check');

        if (!check.ok) {
          messages.push({
            role: 'user',
            content:
              `You said you were done, but the code does not work yet.\n\n${check.report}`,
          });
          continue;
        }
      }

      log.done(text);
      return {
        answer: text,
        steps: step,
        hitLimit: false,
        edited,
        verified,
        skills: loadedSkillNames(),
        messages,
      };
    }

    for (const call of toolCalls) log.toolCall(call.name, call.input);

    // Run them concurrently — a model that asks for three files at once should get
    // all three in one round trip rather than three sequential turns.
    const results = await Promise.all(toolCalls.map(executeTool));

    for (const result of results) log.toolResult(result.name, result);

    // ---- V2: verify after any edit that actually landed ---------------------
    let note;
    const landedAnEdit = results.some((r) => !r.isError && MUTATING_TOOLS.has(r.name));
    if (landedAnEdit) edited = true;

    if (verifyEnabled() && landedAnEdit) {
      if (modelAlreadyVerified(toolCalls)) {
        // It ran the suite itself this turn; its own result is already in `results`.
        verified = results.some((r) => r.name === 'run_command' && !r.isError);
      } else {
        const check = await verify();
        verified = check.ok;
        note = check.report;
        log.verify(check.ok, 'after edit');
      }
    }

    // All results go back in ONE turn, failures included. A dropped result leaves
    // the model waiting on an answer that never comes; splitting them across turns
    // trains it out of asking for things in parallel.
    messages.push({ role: 'tool_results', results, note });
  }

  log.warn(`Hit the ${maxSteps}-step limit before the model finished.`);
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.text);
  return {
    answer: last?.text ?? '',
    steps: maxSteps,
    hitLimit: true,
    edited,
    verified,
    skills: loadedSkillNames(),
    messages,
  };
}

/** Everything in the prompt by the end of the run — routed and self-loaded alike. */
function loadedSkillNames() {
  return loadedSkills().map((s) => s.name);
}
