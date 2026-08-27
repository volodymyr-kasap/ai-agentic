/**
 * Step tracing. Watching what the agent decided, and on what evidence, is most of
 * the value of building one — so the trace is a first-class part of the harness
 * rather than a stray console.log.
 */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

let verbose = false;
export function setVerbose(v) {
  verbose = v;
}

export function banner(lines) {
  console.log();
  for (const line of lines) console.log(c.dim(line));
  console.log();
}

export function step(n, max) {
  console.log(c.dim(`\n── step ${n}/${max} ${'─'.repeat(Math.max(0, 50 - String(n).length))}`));
}

/** The model's prose between tool calls — its running commentary on the task. */
export function thinking(text) {
  if (!text) return;
  console.log(c.dim('│ ') + text.trim().split('\n').join('\n' + c.dim('│ ')));
}

export function toolCall(name, input) {
  console.log(`${c.cyan('→')} ${c.bold(name)} ${c.dim(summarizeInput(input))}`);
}

export function toolResult(name, result) {
  const mark = result.isError ? c.red('✗') : c.green('✓');
  const body = String(result.content ?? '');
  const firstLine = body.split('\n')[0] ?? '';
  const extra = body.includes('\n') ? c.dim(` (+${body.split('\n').length - 1} lines)`) : '';
  console.log(`${mark} ${c.dim(name)} ${truncateInline(firstLine, 100)}${extra}`);
  if (verbose && body.includes('\n')) {
    console.log(c.dim(body.split('\n').slice(1).map((l) => '    ' + l).join('\n')));
  }
}

/** V2: the harness's own verdict on the code, distinct from any tool result. */
export function verify(ok, when) {
  const label = ok ? c.green('verified') : c.red('verification failed');
  console.log(`${ok ? c.green('◆') : c.red('◆')} ${label} ${c.dim(`(${when})`)}`);
}

/**
 * V3: what the router decided, and what it cost. The skipped line is the one worth
 * watching — it is the context that did NOT go into the prompt, which is the only
 * reason to have a skill system at all.
 */
export function skills({ selected, skipped, mode, reason }) {
  const chars = (list) => list.reduce((sum, s) => sum + s.chars, 0);
  const names = (list) => (list.length ? list.map((s) => s.name).join(', ') : 'none');

  console.log(
    `${c.cyan('◇')} skills ${c.bold(names(selected))} ${c.dim(
      `(${kb(chars(selected))} loaded, router=${mode})`
    )}`
  );
  if (skipped.length) {
    console.log(`  ${c.dim(`skipped ${names(skipped)} — ${kb(chars(skipped))} not sent`)}`);
  }
  if (reason) console.log(`  ${c.dim(`matched on ${reason}`)}`);
}

function kb(chars) {
  return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k chars` : `${chars} chars`;
}

export function done(text) {
  console.log(`\n${c.green('●')} ${c.bold('done')}\n`);
  if (text) console.log(text.trim() + '\n');
}

/** Closing verdict, so a run's real outcome is visible without reading the prose. */
export function summary(ok, command) {
  console.log(
    ok
      ? c.green(`◆ ${command} passes — the change is verified.`)
      : c.red(`◆ ${command} still fails — the task is NOT complete.`)
  );
  console.log();
}

export function warn(msg) {
  console.log(`${c.yellow('!')} ${msg}`);
}

export function fail(msg) {
  console.error(`${c.red('✗')} ${msg}`);
}

/** One-line preview of tool input, so the trace stays scannable. */
function summarizeInput(input) {
  if (!input || typeof input !== 'object') return '';
  const parts = Object.entries(input).map(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    return `${k}=${truncateInline(String(val).replace(/\n/g, '\\n'), 60)}`;
  });
  return parts.join(' ');
}

function truncateInline(s, max) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
