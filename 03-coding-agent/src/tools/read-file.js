import fs from 'node:fs/promises';
import { resolveInWorkspace, toRelative } from '../lib/workspace.js';
import { toolFailure } from '../lib/result.js';
import { LIMITS, truncate } from '../lib/truncate.js';

export default {
  name: 'read_file',
  description:
    'Read a text file from the workspace. Returns the contents with line numbers, ' +
    'so you can quote an exact line back to edit_file. Read a file before editing it.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to the workspace root, e.g. "src/users/users.service.js".',
      },
      offset: {
        type: 'integer',
        description: 'Optional 1-based line to start from. Use with limit for large files.',
      },
      limit: {
        type: 'integer',
        description: 'Optional number of lines to read, starting at offset.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },

  async handler({ path: relPath, offset, limit }) {
    const abs = resolveInWorkspace(relPath, { mustExist: true });
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      return toolFailure(
        `"${toRelative(abs)}" is a directory. Use list_files to see what is inside it.`
      );
    }

    const raw = await fs.readFile(abs, 'utf8');
    const allLines = raw.split('\n');

    const start = offset ? Math.max(1, offset) : 1;
    const end = limit ? start + limit - 1 : allLines.length;
    const slice = allLines.slice(start - 1, end);

    if (slice.length === 0) {
      return toolFailure(
        `"${toRelative(abs)}" has ${allLines.length} lines; offset ${start} is past the end.`
      );
    }

    const width = String(start + slice.length - 1).length;
    const numbered = slice
      .map((line, i) => `${String(start + i).padStart(width, ' ')}\t${line}`)
      .join('\n');

    const header =
      slice.length < allLines.length
        ? `${toRelative(abs)} (lines ${start}-${start + slice.length - 1} of ${allLines.length})\n`
        : `${toRelative(abs)} (${allLines.length} lines)\n`;

    return header + truncate(numbered, LIMITS.fileBytes, 'file');
  },
};
