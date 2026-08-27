import { toolFailure } from '../lib/result.js';
import { allSkills, isLoaded, markLoaded, skillByName, skillsEnabled } from '../skills/index.js';

/**
 * V3: the model's own way into a skill the router did not pick.
 *
 * The router only ever sees the task string. Half of what a task needs becomes
 * obvious later — "fix the failing test" says nothing about a database until you
 * read the failure and find it is about seed data. The catalog in the system prompt
 * advertises every skill; this tool is how the model cashes one in.
 *
 * The body does NOT come back as this tool's result. It goes into the system prompt
 * on the next turn, which the loop rebuilds from the loaded set — one place where
 * skills live, in the same section, whether they were routed or requested. The
 * result here is just the receipt.
 */
export default {
  name: 'load_skill',
  description:
    'Load a project skill — a written guide to the conventions for one area of this ' +
    'codebase. The available skills are listed in your instructions; load one when ' +
    'the task turns out to touch its area. Its full text is added to your ' +
    'instructions from the next step onward.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill name exactly as listed in your instructions, e.g. "testing".',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },

  /** Hidden from the model when the harness is running without skills. */
  available: skillsEnabled,

  handler({ name }) {
    const skill = skillByName(name);
    if (!skill) {
      return toolFailure(
        `No skill named "${name}". Available: ${allSkills().map((s) => s.name).join(', ')}.`
      );
    }
    if (isLoaded(skill.name)) {
      return toolFailure(
        `Skill "${skill.name}" is already loaded — its full text is in your instructions ` +
          `under SKILLS. Re-read it there rather than loading it again.`
      );
    }

    markLoaded(skill.name);
    return (
      `Loaded skill "${skill.name}" (${skill.chars} characters). Its full text is in your ` +
      `instructions under SKILLS from the next step onward. Follow it.`
    );
  },
};
