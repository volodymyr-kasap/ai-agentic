/**
 * Marks a tool handler's return value as a failure the model must correct.
 *
 * Most tool failures here are not exceptions — "that string appears twice" is a
 * perfectly ordinary answer to give the model. But it is still a failure, and the
 * trace should say so, or a run full of rejected edits reads as a run full of
 * successes.
 *
 * Handlers return a plain string on success, or toolFailure(...) to flag one.
 */
export function toolFailure(content) {
  return { content, isError: true };
}
