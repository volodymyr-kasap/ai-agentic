#!/usr/bin/env node
import { config, DEFAULT_ALLOWLIST } from './config.js';
import { createProvider } from './llm/index.js';
import { runAgent } from './agent.js';
import { tools } from './tools/index.js';
import { setCommandPolicy } from './tools/run-command.js';
import { workspaceRoot } from './lib/workspace.js';
import { discoverSkills, initSkills } from './skills/index.js';
import * as log from './lib/log.js';

const USAGE = `
Usage: npm run agent -- "<task>" [options]

Options:
  --provider <name>   ollama | anthropic          (default: ${config.provider})
  --workspace <dir>   directory the agent may edit (default: ${config.workspace})
  --max-steps <n>     hard iteration cap           (default: ${config.maxSteps})
  --verify <cmd>      command the harness runs after each edit
                                                  (default: ${config.verifyCommand || 'off'})
  --no-verify         turn the V2 feedback loop off
  --skills <dir>      skill library to route from      (default: ${config.skillsDir})
  --router <mode>     keyword | llm | all | off        (default: ${config.skillRouter})
  --skill <name>      force a skill to load (repeatable, skips the router)
  --max-skills <n>    cap on skills loaded up front    (default: ${config.maxSkills})
  --no-skills         turn the V3 skill system off
  --allow <prefix>    extra allowlisted command prefix (repeatable)
  --approve           ask before every run_command
  --yolo              skip the command allowlist entirely
  --verbose           print full tool output, not just the first line
  --list-tools        print the tool schemas the model sees, then exit
  --list-skills       print the skill catalog and what each would cost, then exit
  --help

Examples:
  npm run agent -- "add a DELETE /users/:id endpoint and a test for it"
  npm run agent -- "why does the users test fail?" --approve
  npm run agent -- "add pagination to GET /users" --router llm
  LLM_PROVIDER=anthropic npm run agent -- "switch users to sqlite" --skill database
`;

function parseArgs(argv) {
  const opts = { allow: [], skill: [] };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };

    switch (arg) {
      case '--provider': opts.provider = next(); break;
      case '--workspace': opts.workspace = next(); break;
      case '--max-steps': opts.maxSteps = Number(next()); break;
      case '--verify': opts.verify = next(); break;
      case '--no-verify': opts.verify = ''; break;
      case '--skills': opts.skills = next(); break;
      case '--router': opts.router = next(); break;
      case '--skill': opts.skill.push(next()); break;
      case '--max-skills': opts.maxSkills = Number(next()); break;
      case '--no-skills': opts.noSkills = true; break;
      case '--list-skills': opts.listSkills = true; break;
      case '--allow': opts.allow.push(next()); break;
      case '--approve': opts.approve = true; break;
      case '--yolo': opts.yolo = true; break;
      case '--verbose': opts.verbose = true; break;
      case '--list-tools': opts.listTools = true; break;
      case '--help':
      case '-h': opts.help = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
        positional.push(arg);
    }
  }

  opts.task = positional.join(' ').trim();
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    log.fail(err.message);
    console.log(USAGE);
    process.exit(2);
  }

  if (opts.help) {
    console.log(USAGE);
    return;
  }

  // CLI flags override the environment. Done before --list-skills so that
  // `--skills ./other --list-skills` inspects the library it names.
  if (opts.workspace) config.workspace = opts.workspace;
  if (opts.maxSteps) config.maxSteps = opts.maxSteps;
  if (opts.verify !== undefined) config.verifyCommand = opts.verify;
  if (opts.skills) config.skillsDir = opts.skills;
  if (opts.router) config.skillRouter = opts.router;
  if (opts.maxSkills) config.maxSkills = opts.maxSkills;

  const skills = opts.noSkills ? [] : discoverSkills(config.skillsDir);
  initSkills({ enabled: !opts.noSkills, skills });

  if (opts.listSkills) {
    if (opts.noSkills) {
      log.warn('Skills are off (--no-skills); drop the flag to see the catalog.');
      return;
    }
    if (skills.length === 0) {
      log.warn(`No skills found in ${config.skillsDir} (expecting <name>/SKILL.md).`);
      return;
    }
    for (const skill of skills) {
      console.log(`\n\x1b[1m${skill.name}\x1b[0m — ${skill.description}`);
      console.log(`  file      ${skill.file}`);
      console.log(`  size      ${skill.chars} chars${skill.always ? ' (always loaded)' : ''}`);
      console.log(`  triggers  ${skill.triggers.join(', ') || '(none — only load_skill can reach it)'}`);
    }
    console.log();
    return;
  }

  if (opts.listTools) {
    // Filtered the same way the model's tool list is: load_skill is not there when
    // the harness runs without skills.
    for (const tool of tools.filter((t) => t.available?.() !== false)) {
      console.log(`\n\x1b[1m${tool.name}\x1b[0m — ${tool.description}`);
      console.log(JSON.stringify(tool.parameters, null, 2));
    }
    return;
  }

  if (!opts.task) {
    log.fail('No task given.');
    console.log(USAGE);
    process.exit(2);
  }

  log.setVerbose(Boolean(opts.verbose));
  setCommandPolicy({
    allowlist: [...DEFAULT_ALLOWLIST, ...opts.allow],
    approve: Boolean(opts.approve),
    yolo: Boolean(opts.yolo),
  });

  let provider;
  try {
    provider = createProvider(opts.provider);
  } catch (err) {
    log.fail(err.message);
    process.exit(1);
  }

  const root = workspaceRoot();

  log.banner([
    `task       ${opts.task}`,
    `model      ${provider.name}`,
    `workspace  ${root}`,
    `max steps  ${config.maxSteps}`,
    opts.yolo
      ? 'commands   UNRESTRICTED (--yolo): the model can run anything in the workspace'
      : `commands   allowlisted${opts.approve ? ', with approval prompts' : ''}`,
    `verify     ${config.verifyCommand || 'off (--no-verify)'}`,
    opts.noSkills
      ? 'skills     off (--no-skills)'
      : `skills     ${skills.length} available, router=${config.skillRouter}`,
  ]);

  try {
    const result = await runAgent({
      task: opts.task,
      provider,
      workspace: root,
      maxSteps: config.maxSteps,
      skills: {
        router: config.skillRouter,
        max: config.maxSkills,
        forced: opts.skill,
      },
    });
    // Exit non-zero when the work is not actually finished, so the agent can be
    // used from a script without reading the prose summary.
    const failed = result.hitLimit || result.verified === false;
    if (result.verified !== null) {
      log.summary(result.verified, config.verifyCommand);
    }
    process.exit(failed ? 1 : 0);
  } catch (err) {
    log.fail(err.message);
    process.exit(1);
  }
}

await main();
