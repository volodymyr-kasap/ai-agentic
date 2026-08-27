import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInWorkspace, toRelative } from '../lib/workspace.js';
import { LIMITS } from '../lib/truncate.js';
import { IGNORED } from './list-files.js';

/**
 * Deliberately a plain JS walk rather than a shell-out to ripgrep: no extra
 * dependency, no "works on my machine", and the whole search path stays readable.
 * A real harness would use ripgrep and care about the speed difference.
 */

export default {
  name: 'search_code',
  description:
    'Search file contents in the workspace with a regular expression. Returns ' +
    'matching lines as "path:line: text". Use this to find where something is ' +
    'defined or used before reading whole files.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'JavaScript regular expression, e.g. "class \\w+Controller" or "findAll".',
      },
      glob: {
        type: 'string',
        description:
          'Optional filename filter, e.g. "*.js" or "*.test.js". Matches the file name only, not the directory.',
      },
      path: {
        type: 'string',
        description: 'Optional directory to search under, relative to the workspace root.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },

  async handler({ pattern, glob, path: relPath = '.' }) {
    let regex;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (err) {
      return `Invalid regular expression: ${err.message}`;
    }
    const nameFilter = glob ? globToRegExp(glob) : null;
    const root = resolveInWorkspace(relPath, { mustExist: true });

    const hits = [];
    let scanned = 0;
    let hitLimit = false;

    async function walk(dir) {
      if (hitLimit) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (hitLimit) return;
        if (IGNORED.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
        } else if (entry.isFile()) {
          if (nameFilter && !nameFilter.test(entry.name)) continue;
          await searchFile(abs);
        }
      }
    }

    async function searchFile(abs) {
      const stat = await fs.stat(abs);
      if (stat.size > 1_000_000) return; // almost certainly not source
      const text = await fs.readFile(abs, 'utf8').catch(() => null);
      if (text === null || text.includes('\u0000')) return; // unreadable or binary
      scanned += 1;

      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!regex.test(lines[i])) continue;
        hits.push(`${toRelative(abs)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        if (hits.length >= LIMITS.searchHits) {
          hitLimit = true;
          return;
        }
      }
    }

    await walk(root);

    if (hits.length === 0) {
      const scope = glob ? ` matching ${glob}` : '';
      return `No match for /${pattern}/i in ${scanned} file(s) under ${toRelative(root)}/${scope}.`;
    }
    const note = hitLimit
      ? `\n\n... [stopped at ${LIMITS.searchHits} matches. Narrow the pattern.]`
      : '';
    return `${hits.length} match(es) in ${scanned} file(s):\n${hits.join('\n')}${note}`;
  },
};

/** Minimal glob -> RegExp for file names: supports * and ?. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}
