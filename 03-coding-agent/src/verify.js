import { config } from './config.js';
import { runShell } from './lib/shell.js';
import { workspaceRoot } from './lib/workspace.js';

/**
 * VERSION 2 — the feedback loop.
 *
 *     agent edits -> npm test -> failed? -> agent sees the errors -> fix -> retest
 *
 * V1 asked the model to verify its own work, and the model politely lied: it
 * finished a run in which every single edit had been rejected and still reported
 * "the endpoint was added, the test was added". Nothing in V1 could contradict it.
 *
 * The fix is not a better prompt. It is giving the harness its own source of truth
 * that the model does not author. The test suite is that source of truth, and this
 * module is how the loop consults it.
 *
 * Note who chooses the command: the *operator*, via --verify or VERIFY_COMMAND.
 * It deliberately bypasses the run_command allowlist, because it is not the
 * model's command — the model can neither change it nor skip it.
 */

/**
 * @returns {Promise<{ ok: boolean, output: string, report: string }>}
 */
export async function verify() {
  const command = config.verifyCommand;
  const { ok, output } = await runShell(command, workspaceRoot(), config.commandTimeout);

  const report = ok
    ? `Verification passed: \`${command}\` exited 0.`
    : `Verification FAILED. The harness ran \`${command}\` after your edits:\n\n${output}\n\n` +
      `Do not stop here and do not claim the task is done. Read the failure, find the ` +
      `cause, and fix it. If the failure is in a test you just wrote, the test may be ` +
      `the thing that is wrong.`;

  return { ok, output, report };
}

/** True when auto-verification is switched on. */
export function verifyEnabled() {
  return Boolean(config.verifyCommand);
}

/**
 * Did the model already run the verification command itself this turn? If so the
 * loop skips its own run — no point paying for the same test suite twice, and a
 * duplicated result in context just invites the model to compare two identical
 * reports.
 */
export function modelAlreadyVerified(toolCalls) {
  const target = normalize(config.verifyCommand);
  return toolCalls.some(
    (call) => call.name === 'run_command' && normalize(call.input?.command) === target
  );
}

function normalize(command) {
  return String(command ?? '').trim().replace(/\s+/g, ' ');
}
