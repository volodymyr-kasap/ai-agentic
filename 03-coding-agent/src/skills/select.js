import { allSkills } from './index.js';

/**
 * THE ROUTER: task -> which skills does this task need?
 *
 *     "add a DELETE /users/:id endpoint and a test for it"
 *          -> api, nestjs, testing        loaded  (7.5k chars)
 *          -> database                    skipped (2.7k chars never sent)
 *
 * Selecting is the entire point of V3. Loading everything is not a skill system,
 * it is a long system prompt with extra steps — and it gets worse with every skill
 * added, because irrelevant instructions are not neutral. A model told about
 * repository patterns while writing a test will find a way to use them.
 *
 * Two strategies, because the tradeoff between them is worth seeing:
 *
 *   keyword — trigger words in the frontmatter, matched against the task. Free,
 *             instant, deterministic, and blind to anything the author did not
 *             think to list. The default.
 *   llm     — one extra model call that reads the catalog and picks. Understands
 *             "make the users list not return everything at once" is a paging
 *             task without the word "pagination" in it, costs a round trip, and
 *             can hallucinate a skill name (we drop those).
 *
 * Neither is reliable enough to be the only way in. That is what the `load_skill`
 * tool is for: whatever the router missed, the model can still ask for once it has
 * looked at the code — and the catalog in the prompt is what tells it the skill is
 * there to ask for.
 */

/**
 * @param {object} params
 * @param {string} params.task
 * @param {'keyword'|'llm'|'all'|'off'} params.mode
 * @param {number} params.max        cap on how many skills may load up front
 * @param {string[]} params.forced   skill names from --skill, always loaded
 * @param {object} [params.provider] required for mode 'llm'
 * @returns {Promise<{ selected: Skill[], skipped: Skill[], mode: string, reason: string }>}
 */
export async function selectSkills({ task, mode = 'keyword', max = 3, forced = [], provider }) {
  const skills = allSkills();
  if (skills.length === 0) return done([], skills, mode, 'no skills found');

  // `always: true` in the frontmatter and anything named with --skill bypass the
  // router entirely; the operator's choice is not a suggestion.
  const pinned = skills.filter(
    (s) => s.always || forced.some((f) => f.toLowerCase() === s.name.toLowerCase())
  );

  if (mode === 'off') return done(pinned, skills, mode, 'routing disabled');
  if (mode === 'all') return done(skills, skills, mode, 'every skill (--router all)');

  const routed =
    mode === 'llm'
      ? await routeWithModel({ task, skills, provider, max })
      : routeWithKeywords({ task, skills, max });

  const selected = dedupe([...pinned, ...routed.skills]);
  return done(selected, skills, mode, routed.reason);
}

function done(selected, all, mode, reason) {
  const chosen = new Set(selected.map((s) => s.name));
  return { selected, skipped: all.filter((s) => !chosen.has(s.name)), mode, reason };
}

function dedupe(skills) {
  const seen = new Set();
  return skills.filter((s) => (seen.has(s.name) ? false : seen.add(s.name)));
}

// ---------------------------------------------------------------------------
// keyword routing
// ---------------------------------------------------------------------------

/**
 * Score = how much of this skill's vocabulary shows up in the task. Multi-word
 * triggers ("npm test", "dependency injection") count double: they are specific
 * enough that a single hit is real evidence, where a bare "test" could be anything.
 */
function routeWithKeywords({ task, skills, max }) {
  const haystack = ` ${task.toLowerCase()} `;

  const scored = skills
    .map((skill) => {
      const hits = new Set();
      let score = 0;

      if (contains(haystack, skill.name.toLowerCase())) {
        score += 3;
        hits.add(skill.name);
      }
      for (const trigger of skill.triggers) {
        if (!contains(haystack, trigger)) continue;
        score += trigger.includes(' ') ? 2 : 1;
        hits.add(trigger);
      }
      return { skill, score, hits: [...hits] };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));

  const top = scored.slice(0, max);
  return {
    skills: top.map((s) => s.skill),
    reason: top.length
      ? top.map((s) => `${s.skill.name}(${s.hits.slice(0, 3).join('/')})`).join(', ')
      : 'no trigger matched',
  };
}

/** Word-boundary match, so "api" does not fire on "rapid" and "db" not on "adb". */
function contains(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

// ---------------------------------------------------------------------------
// llm routing
// ---------------------------------------------------------------------------

const ROUTER_SYSTEM = `You route a coding task to the reference guides that will help with it.

You are given a catalog of guides — name and one-line description — and one task.
Reply with ONLY a JSON array of the names worth loading, most relevant first, and
nothing else. No prose, no code fence.

Pick only what the task actually needs. Loading a guide that does not apply makes
the agent worse, and an empty array [] is the right answer for a task none of them
cover.`;

async function routeWithModel({ task, skills, provider, max }) {
  if (!provider) return { ...routeWithKeywords({ task, skills, max }), reason: 'no provider' };

  const catalog = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  const prompt = `Guides:\n${catalog}\n\nTask: ${task}\n\nJSON array of guide names:`;

  try {
    // No tools on this call: it is a classification, and a router that can call
    // read_file is just a second agent loop hiding inside the first one.
    const { text } = await provider.chat({
      system: ROUTER_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      tools: [],
    });

    const names = parseNames(text);
    const picked = names
      .map((name) => skills.find((s) => s.name.toLowerCase() === name.toLowerCase()))
      // A model asked for names from a list will still occasionally invent one.
      .filter(Boolean)
      .slice(0, max);

    return {
      skills: picked,
      reason: picked.length ? `model chose ${picked.map((s) => s.name).join(', ')}` : 'model chose none',
    };
  } catch (err) {
    // A router failure must not take the run down — fall back to the free strategy.
    const fallback = routeWithKeywords({ task, skills, max });
    return { ...fallback, reason: `llm router failed (${err.message}); keyword: ${fallback.reason}` };
  }
}

/** The array is usually the whole reply, but small models wrap it in commentary. */
function parseNames(text) {
  const match = /\[[\s\S]*?\]/.exec(String(text ?? ''));
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'string') : [];
  } catch {
    return [];
  }
}
