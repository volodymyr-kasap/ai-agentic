import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Every path the model supplies is confined to the workspace root. The model is
 * not adversarial, but it is routinely wrong: a hallucinated `../../src/server.js`
 * would otherwise edit a different project on disk.
 *
 * Two checks, both needed:
 *   1. `path.resolve` + `path.relative` catches `..` traversal.
 *   2. `fs.realpathSync` on the nearest existing ancestor catches a symlink
 *      inside the workspace pointing out of it.
 */

export class WorkspaceError extends Error {}

let cachedRoot;

/** The workspace root, with symlinks resolved. Created on first use if missing. */
export function workspaceRoot() {
  if (cachedRoot) return cachedRoot;
  fs.mkdirSync(config.workspace, { recursive: true });
  cachedRoot = fs.realpathSync(config.workspace);
  return cachedRoot;
}

/** Realpath of the deepest ancestor of `target` that actually exists. */
function realpathOfNearestExisting(target) {
  let current = target;
  for (;;) {
    try {
      return { real: fs.realpathSync(current), checked: current };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const parent = path.dirname(current);
      // Reached the filesystem root without finding anything that exists.
      if (parent === current) return { real: current, checked: current };
      current = parent;
    }
  }
}

/**
 * Turn a model-supplied path into an absolute path inside the workspace.
 * @param {string} [relPath] path relative to the workspace root ('.' when omitted)
 * @param {{ mustExist?: boolean }} [opts]
 * @returns {string} absolute path
 */
export function resolveInWorkspace(relPath = '.', { mustExist = false } = {}) {
  if (typeof relPath !== 'string') {
    throw new WorkspaceError(`path must be a string, got ${typeof relPath}`);
  }
  const root = workspaceRoot();
  const target = path.resolve(root, relPath);

  if (!contains(root, target)) {
    throw new WorkspaceError(
      `path "${relPath}" escapes the workspace. Everything must stay inside ${root}.`
    );
  }

  // Re-check after following symlinks on whatever part of the path exists.
  const { real, checked } = realpathOfNearestExisting(target);
  if (!contains(root, real)) {
    throw new WorkspaceError(
      `path "${relPath}" resolves through a symlink (${checked}) that leaves the workspace.`
    );
  }

  if (mustExist && !fs.existsSync(target)) {
    throw new WorkspaceError(`path "${relPath}" does not exist in the workspace.`);
  }
  return target;
}

/** True when `child` is `parent` or lives underneath it. */
function contains(parent, child) {
  if (parent === child) return true;
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Workspace-relative display path, for logs and tool output. */
export function toRelative(absPath) {
  const rel = path.relative(workspaceRoot(), absPath);
  return rel === '' ? '.' : rel;
}
