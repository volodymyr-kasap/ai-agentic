import { spawn } from 'node:child_process';
import { LIMITS, truncate } from './truncate.js';

/**
 * Runs a command and collects its result. Shared by the `run_command` tool (where
 * the model chooses the command) and by verification (where the operator does),
 * so both truncate, time out and report failures the same way.
 */

/**
 * @param {string} command
 * @param {string} cwd
 * @param {number} timeout milliseconds
 * @returns {Promise<{ ok: boolean, code: number|null, timedOut: boolean, output: string }>}
 */
export function runShell(command, cwd, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      timeout,
      killSignal: 'SIGKILL',
      // NO_COLOR keeps ANSI escapes out of the model's context, where they are
      // pure noise; CI=1 stops test runners waiting for a TTY.
      env: { ...process.env, CI: '1', NO_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        code: null,
        timedOut: false,
        output: `Failed to start command: ${err.message}`,
      });
    });

    child.on('close', (code, signal) => {
      const timedOut = signal === 'SIGKILL';
      const parts = [
        timedOut ? `exit: killed after ${timeout / 1000}s timeout` : `exit code: ${code}`,
      ];
      if (stdout.trim()) {
        parts.push(`stdout:\n${truncate(stdout.trim(), LIMITS.commandBytes, 'stdout')}`);
      }
      if (stderr.trim()) {
        parts.push(`stderr:\n${truncate(stderr.trim(), LIMITS.commandBytes, 'stderr')}`);
      }
      if (!stdout.trim() && !stderr.trim()) parts.push('(no output)');

      resolve({
        ok: code === 0 && !timedOut,
        code,
        timedOut,
        output: parts.join('\n'),
      });
    });
  });
}
