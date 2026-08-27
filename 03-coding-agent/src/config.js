import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Resolve a possibly-relative env path against the project root, not the cwd. */
function resolveFromProject(p) {
  return path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
}

export const config = {
  projectRoot,

  provider: process.env.LLM_PROVIDER || 'ollama',

  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.1',
    // See the comment in llm/ollama.js: the 4096 default silently truncates the
    // transcript mid-run. Lower this if the model does not fit in your VRAM.
    contextTokens: Number(process.env.OLLAMA_CONTEXT || 16384),
  },

  anthropic: {
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    // The SDK also accepts an `ant auth login` profile, so a missing key is not fatal here.
    apiKey: process.env.ANTHROPIC_API_KEY,
    fallbacks: process.env.ANTHROPIC_FALLBACKS !== '0',
  },

  workspace: resolveFromProject(process.env.WORKSPACE || './workspace'),

  // V3: the skill library. Here it sits next to the harness; in a real setup it
  // lives next to the code the agent works on, because the conventions belong to
  // the repository, not to the agent.
  skillsDir: resolveFromProject(process.env.SKILLS_DIR || './skills'),
  // keyword | llm | all | off — see src/skills/select.js
  skillRouter: process.env.SKILL_ROUTER || 'keyword',
  // Cap on how many skills the router may load up front. The cap is the feature:
  // without it a broadly-worded task pulls in the whole library and V3 is pointless.
  maxSkills: Number(process.env.MAX_SKILLS || 3),

  // V2 feedback loop: run after every landed edit, and before the agent is
  // allowed to declare itself finished. Empty string disables it.
  verifyCommand: process.env.VERIFY_COMMAND ?? 'npm test',

  maxSteps: Number(process.env.MAX_STEPS || 20),
  commandTimeout: Number(process.env.COMMAND_TIMEOUT || 120) * 1000,
};

/** Commands run_command will execute without asking. Prefix match on the first token(s). */
export const DEFAULT_ALLOWLIST = [
  'npm',
  'node',
  'npx',
  'ls',
  'cat',
  'mkdir',
  'git status',
  'git diff',
  'git log',
  'git add',
];
