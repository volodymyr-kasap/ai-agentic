import readline from 'node:readline/promises';
import { config } from '../config.js';
import { resolveInWorkspace, toRelative } from '../lib/workspace.js';
import { runShell } from '../lib/shell.js';
import { toolFailure } from '../lib/result.js';

/**
 * The dangerous tool. There is no container yet, so the policy below *is* the
 * sandbox:
 *
 *   - the command runs with cwd pinned inside the workspace;
 *   - it is split on shell operators and EVERY segment must match the allowlist,
 *     so `npm test && rm -rf ~` is rejected on its second half rather than waved
 *     through because it starts with `npm`;
 *   - command substitution is refused outright — it hides the real command from
 *     both the allowlist and the human reading the trace;
 *   - it is killed after a timeout, and its output is truncated.
 *
 * None of this contains a determined attacker; it contains a confused model,
 * which is the actual threat here. Roadmap V4 replaces it with a real sandbox.
 */

let policy = { allowlist: [], approve: false, yolo: false };

export function setCommandPolicy(next) {
  policy = { ...policy, ...next };
}

/** Shell operators we split on before checking the allowlist. */
const SEGMENT_SPLIT = /\s*(?:&&|\|\||;|\|)\s*/;

export default {
  name: 'run_command',
  description:
    'Run a shell command inside the workspace and return its stdout, stderr and exit ' +
    'code. Use it to install packages, run tests, or inspect git state. Only ' +
    'allowlisted commands run; anything else is refused and you should work around it.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command line, e.g. "npm test" or "node --test test/users.test.js".',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory relative to the workspace root.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },

  async handler({ command, cwd: relCwd = '.' }) {
    const cwd = resolveInWorkspace(relCwd, { mustExist: true });

    const refusal = checkPolicy(command);
    if (refusal) return toolFailure(refusal);

    if (policy.approve && !(await confirm(command, toRelative(cwd)))) {
      return toolFailure(
        'The user declined to run this command. Try a different approach, or ask them why.'
      );
    }

    return await run(command, cwd);
  },
};

/** @returns {string|null} a refusal message for the model, or null when allowed. */
function checkPolicy(command) {
  if (policy.yolo) return null;

  if (/`|\$\(/.test(command)) {
    return (
      'Refused: command substitution (backticks or $(...)) is not allowed, because it ' +
      'hides what actually runs. Run the inner command on its own instead.'
    );
  }

  const segments = command
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    if (!policy.allowlist.some((prefix) => matchesPrefix(segment, prefix))) {
      return (
        `Refused: "${segment}" is not on the allowlist. Allowed commands start with: ` +
        `${policy.allowlist.join(', ')}. Work with what is allowed, or tell the user ` +
        `what you need and why.`
      );
    }
  }
  return null;
}

/** Prefix match on whole tokens, so "npmx" does not pass as "npm". */
function matchesPrefix(segment, prefix) {
  if (!segment.startsWith(prefix)) return false;
  const next = segment[prefix.length];
  return next === undefined || next === ' ';
}

async function confirm(command, relCwd) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\n  run \x1b[1m${command}\x1b[0m in ${relCwd}/ ? [y/N] `);
    return answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

function run(command, cwd) {
  return runShell(command, cwd, config.commandTimeout).then(({ ok, output }) =>
    // A failing `npm test` is a real failure — the trace should not show a tick.
    // The model still gets the full output either way; only the flag changes.
    (ok ? output : toolFailure(output))
  );
}
