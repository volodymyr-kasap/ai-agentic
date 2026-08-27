import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInWorkspace, toRelative } from '../lib/workspace.js';
import { toolFailure } from '../lib/result.js';

/**
 * The uniqueness rule below is the whole design of this tool.
 *
 * A naive `replace(old, new)` silently edits the *first* occurrence, which on a
 * repeated string like `return this.users;` is very often the wrong one — and the
 * model never finds out. Requiring a unique match converts that silent corruption
 * into an error message the model can act on, and pushes it to read the file and
 * quote enough surrounding context to be unambiguous. Real coding agents work the
 * same way for the same reason.
 */

export default {
  name: 'edit_file',
  description:
    'Edit a file by replacing an exact string. old_string must appear EXACTLY ONCE ' +
    'in the file — include surrounding lines to make it unique. Read the file first ' +
    'so you can quote it exactly, whitespace included. To create a new file, pass an ' +
    'empty old_string and the full contents as new_string. To delete code, pass an ' +
    'empty new_string.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to the workspace root.',
      },
      old_string: {
        type: 'string',
        description:
          'The exact text to replace, including indentation. Empty string creates a new file.',
      },
      new_string: {
        type: 'string',
        description: 'The replacement text. Empty string deletes old_string.',
      },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },

  async handler({ path: relPath, old_string: oldString, new_string: newString }) {
    const abs = resolveInWorkspace(relPath);
    const rel = toRelative(abs);
    const exists = await fs
      .stat(abs)
      .then((s) => s.isFile())
      .catch(() => false);

    // --- create mode -------------------------------------------------------
    if (oldString === '') {
      if (exists) {
        return toolFailure(
          `Cannot create "${rel}": it already exists. ` +
            `Read it and edit it with a non-empty old_string instead.`
        );
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, newString, 'utf8');
      return `Created ${rel} (${newString.split('\n').length} lines).`;
    }

    // --- replace mode ------------------------------------------------------
    if (!exists) {
      return toolFailure(
        `Cannot edit "${rel}": no such file. Pass an empty old_string to create it.`
      );
    }

    const before = await fs.readFile(abs, 'utf8');
    const occurrences = countOccurrences(before, oldString);

    if (occurrences === 0) {
      return toolFailure(
        `old_string was not found in "${rel}". The match is exact, including ` +
          `whitespace and indentation — read the file again and copy the text verbatim.`
      );
    }
    if (occurrences > 1) {
      return toolFailure(
        `old_string appears ${occurrences} times in "${rel}", so the edit is ambiguous. ` +
          `Include more surrounding lines to make it unique.`
      );
    }

    const after = before.replace(oldString, () => newString);
    await fs.writeFile(abs, after, 'utf8');

    const delta = after.split('\n').length - before.split('\n').length;
    const sign = delta > 0 ? `+${delta}` : String(delta);
    return `Edited ${rel} (${delta === 0 ? 'same line count' : `${sign} lines`}).`;
  },
};

function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return count;
    count += 1;
    from = i + needle.length;
  }
}
