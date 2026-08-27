import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInWorkspace, toRelative } from '../lib/workspace.js';
import { toolFailure } from '../lib/result.js';
import { LIMITS } from '../lib/truncate.js';

/** Directories that are never worth showing the model — noise, and huge. */
export const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

export default {
  name: 'list_files',
  description:
    'List files and directories in the workspace as a tree. Start here to orient ' +
    'yourself in an unfamiliar project. Skips node_modules, .git and build output.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory relative to the workspace root. Defaults to the root itself.',
      },
      depth: {
        type: 'integer',
        description: 'How many levels to descend. Defaults to 3.',
      },
    },
    additionalProperties: false,
  },

  async handler({ path: relPath = '.', depth = 3 }) {
    const abs = resolveInWorkspace(relPath, { mustExist: true });
    const stat = await fs.stat(abs);
    if (!stat.isDirectory()) {
      return toolFailure(
        `"${toRelative(abs)}" is a file, not a directory. Use read_file to read it.`
      );
    }

    const lines = [];
    let hitLimit = false;

    async function walk(dir, prefix, remaining) {
      if (remaining < 0 || hitLimit) return;
      const entries = (await fs.readdir(dir, { withFileTypes: true }))
        .filter((e) => !IGNORED.has(e.name))
        .sort((a, b) => {
          // Directories first, then alphabetical — easier to skim.
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      for (const entry of entries) {
        if (lines.length >= LIMITS.listEntries) {
          hitLimit = true;
          return;
        }
        const isDir = entry.isDirectory();
        lines.push(`${prefix}${entry.name}${isDir ? '/' : ''}`);
        if (isDir && remaining > 0) {
          await walk(path.join(dir, entry.name), prefix + '  ', remaining - 1);
        }
      }
    }

    await walk(abs, '', depth - 1);

    if (lines.length === 0) return `${toRelative(abs)}/ is empty.`;
    const note = hitLimit ? `\n\n... [stopped at ${LIMITS.listEntries} entries. Narrow the path.]` : '';
    return `${toRelative(abs)}/\n${lines.join('\n')}${note}`;
  },
};
