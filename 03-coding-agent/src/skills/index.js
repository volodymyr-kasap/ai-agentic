import fs from 'node:fs';
import path from 'node:path';

/**
 * VERSION 3 — skills.
 *
 * A skill is a short written-down convention: "this is how we do X in this
 * codebase". The naive way to use them is to paste all of them into the system
 * prompt. That works with four skills and fails with forty — every token spent on
 * database conventions during a test-writing task is a token that isn't spent on
 * the task, and a model reading advice that doesn't apply gets worse, not better.
 *
 * So a skill is stored in two halves:
 *
 *   frontmatter (name + description)  — always in the prompt. One line each, cheap.
 *   body (the actual instructions)    — only when the task looks like it needs it.
 *
 * That split is the whole idea. The catalog is what lets the model *know* a skill
 * exists without paying for it; the router (select.js) and the `load_skill` tool
 * are the two ways a body gets pulled in.
 *
 * On disk:
 *
 *   skills/<name>/SKILL.md
 *
 * one directory per skill, so a skill can grow supporting files later without the
 * layout changing.
 */

/** @typedef {{ name: string, description: string, triggers: string[],
 *              body: string, chars: number, file: string, always: boolean }} Skill */

/**
 * Read every skills/<dir>/SKILL.md. A missing directory is not an error — running
 * without skills is a supported mode, and it's how you see what they're worth.
 * @returns {Skill[]}
 */
export function discoverSkills(dir) {
  if (!fs.existsSync(dir)) return [];

  const skills = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    skills.push(parseSkill(fs.readFileSync(file, 'utf8'), file, entry.name));
  }
  return skills;
}

/**
 * Split `--- frontmatter --- body`. Deliberately a tiny hand-rolled parser rather
 * than a YAML dependency: the format is three keys, and a skill file that needs
 * more structure than this is a skill that is trying to be a program.
 */
export function parseSkill(raw, file, dirName) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.trim());
  const meta = {};
  let body = raw.trim();

  if (match) {
    body = match[2].trim();
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
    }
  }

  const name = unquote(meta.name || dirName);
  return {
    name,
    description: unquote(meta.description) || `Conventions for ${name}.`,
    triggers: parseList(meta.triggers),
    // A skill can opt out of routing entirely — house rules that apply to every
    // task belong in every prompt.
    always: /^(true|yes|1)$/i.test(meta.always ?? ''),
    body,
    chars: body.length,
    file,
  };
}

function unquote(value) {
  return String(value ?? '').replace(/^['"]|['"]$/g, '').trim();
}

/** `a, b, c` or `[a, b, c]` — both spellings people actually write. */
function parseList(value) {
  return unquote(value)
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => unquote(s).toLowerCase())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Session registry.
//
// Which skills are loaded is per-run state that both the prompt builder and the
// load_skill tool need to see. Same pattern as the run_command policy: set once
// by the harness, read by everything downstream, never passed through six layers
// of function arguments.
// ---------------------------------------------------------------------------

let session = { enabled: false, skills: [], loaded: new Set() };

/** @param {{ enabled?: boolean, skills?: Skill[], loaded?: string[] }} init */
export function initSkills({ enabled = true, skills = [], loaded = [] } = {}) {
  session = { enabled, skills, loaded: new Set(loaded) };
}

export function skillsEnabled() {
  return session.enabled && session.skills.length > 0;
}

export function allSkills() {
  return session.skills;
}

export function skillByName(name) {
  const wanted = String(name ?? '').trim().toLowerCase();
  return session.skills.find((s) => s.name.toLowerCase() === wanted);
}

export function isLoaded(name) {
  return session.loaded.has(name);
}

/** @returns {Skill[]} in catalog order, so the prompt is stable between turns. */
export function loadedSkills() {
  return session.skills.filter((s) => session.loaded.has(s.name));
}

export function unloadedSkills() {
  return session.skills.filter((s) => !session.loaded.has(s.name));
}

/** @returns {boolean} false if it was already loaded. */
export function markLoaded(name) {
  if (session.loaded.has(name)) return false;
  session.loaded.add(name);
  return true;
}
