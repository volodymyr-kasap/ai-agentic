/**
 * Tool output goes straight into the model's context, so it has to be bounded.
 * An unbounded `cat` of a bundled file is one of the fastest ways to blow a
 * context window and derail a run — hence a cap on every tool that reads bytes.
 */

export const LIMITS = {
  fileBytes: 60_000,
  commandBytes: 30_000,
  searchHits: 60,
  listEntries: 400,
};

/** Cut `text` to `max` characters, appending a note so the model knows it was cut. */
export function truncate(text, max, what = 'output') {
  if (text.length <= max) return text;
  const kept = text.slice(0, max);
  const dropped = text.length - max;
  return `${kept}\n\n... [${what} truncated: ${dropped} more characters. Narrow the request to see the rest.]`;
}
