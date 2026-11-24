#!/usr/bin/env node
// Rulith Brain Agent launcher: dsh's web app on Rulith Brain's memory server.
//   node start.mjs [<server url> | --server http://127.0.0.1:8091] [--home <folder>] [--learn-research on|off]
//                  [dsh web flags such as --port 3000 --no-open]
// For users: open Rulith Brain and press "Load the model and start"; keep the app open. The agent connects to it at
// http://127.0.0.1:8091 (the app's address) and, while Brain is not running yet or still loading its model, waits for
// it. The agent's own files (dsh profile, page transcripts) go to --home, default ~/.rulith-brain-agent; the memory
// itself stays with the server.
//   --learn-research  "Learn from research" (default on): pages the agent reads while working on a task are learned
//               into the memory (research-learn.mjs). Also RULITH_BRAIN_LEARN_RESEARCH=on|off; the page's switch is
//               kept in <home>/agent-settings.json and is the default of the next start
// For developers (README.md, "Developer flags"): [--brain on|off] [--front kv|text] [--focus-k 1..256]
//   [--focus-every N] [--persona <text file>] [--system both|request|persona] [--forwarder-port N]
//   --brain     brain mode (default on): the memory windows picked for each message and re-chosen as the answer is
//               written, the persona read once a conversation (its opening turn)
//   --front, --focus-k, --focus-every   how a turn recalls; unset, the server's memory folder decides (status.recall:
//               kv, 12 windows, chosen again every 16 steps by default)
//   --persona   a text file read as each conversation's front before dsh's own system prompt (--system picks which go)
// The agent's page, http://127.0.0.1:<forwarder port>/brain, says whether Brain runs, has the switches, and shows what
// the last answer drew on. The page carries the product's brand (rulith-brain-ui, copied into the dsh profile at every
// start); the packaged agent (tools/pack.mjs) starts this file with its own Node through start.cmd.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createMemoryProxy, waitForServer } from './memory-transport.mjs';
import { proxyEnv, windowsProxySettings } from './system-proxy.mjs';
import { capacityLimit, capacityText, localCapacity } from './capacity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = 'rulith-memory';
// Rulith Brain's own address (the app's memory server)
const DEFAULT_SERVER = 'http://127.0.0.1:8091';

const argv = process.argv.slice(2);
const take = (flag, fallback) => {
  const i = argv.indexOf(flag);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const fail = (text) => { console.error(text); process.exit(1); };
const oneOf = (flag, value, allowed) => allowed.includes(value) ? value : fail(`${flag}: ${allowed.join(' or ')}`);

// the server's address may also come first, alone (start.cmd http://host:port)
if (/^https?:\/\//i.test(argv[0] ?? '')) argv.splice(0, 1, '--server', argv[0]);
const server = String(take('--server', process.env.RULITH_MEMORY_SERVER || DEFAULT_SERVER)).replace(/\/+$/, '');
const home = path.resolve(take('--home', process.env.RULITH_BRAIN_AGENT_HOME || process.env.RULITH_MEMORY_AGENT_HOME
  || path.join(os.homedir(), '.rulith-brain-agent')));
const brainOn = oneOf('--brain', take('--brain', process.env.RULITH_BRAIN || 'on'), ['on', 'off']) === 'on';
// the settings the agent's page changes, kept for the next start (a flag or the environment goes before them)
const settingsFile = path.join(home, 'agent-settings.json');
let saved = {};
try { saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { /* none yet */ }
if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
const learnResearch = oneOf('--learn-research', take('--learn-research', process.env.RULITH_BRAIN_LEARN_RESEARCH
  || (saved.learnResearch === false ? 'off' : 'on')), ['on', 'off']) === 'on';
const saveSettings = (change) => {
  saved = { ...saved, ...change };
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(settingsFile, `${JSON.stringify(saved, null, 2)}\n`);
  } catch (error) {
    console.log(`Rulith Brain Agent: the setting was not kept for the next start (${error.message})`);
  }
};
// (developer flags) unset: the server's memory folder decides how a turn recalls (brain-core.mjs request())
const frontFlag = take('--front');
const front = frontFlag === undefined ? undefined : oneOf('--front', frontFlag, ['kv', 'text']);
const focusK = Number(take('--focus-k', 0));
if (!Number.isInteger(focusK) || focusK < 0 || focusK > 256) fail('--focus-k: 1 to 256');
const focusEvery = Number(take('--focus-every', 0));
if (!Number.isInteger(focusEvery) || focusEvery < 0 || focusEvery > 65536) fail('--focus-every: 1 to 65536');
const systemFrom = oneOf('--system', take('--system', 'both'), ['both', 'request', 'persona']);
const personaFile = take('--persona');
const forwarderPort = Number(take('--forwarder-port', 0));
let persona = '';
if (personaFile) {
  try { persona = fs.readFileSync(path.resolve(personaFile), 'utf8').trim(); } catch (error) { fail(`--persona: ${error.message}`); }
}
// a server with an API key: the same key the app's Configuration page shows
const key = process.env.RULITH_MEMORY_KEY || '';
const headers = key && key !== 'local' ? { Authorization: `Bearer ${key}` } : {};

// Rulith Brain may not run yet, or still be loading its model: the agent waits for it (and says so once)
let model;
let frozen = false;
const local = localCapacity(server);
console.log('Brain capacity ' + JSON.stringify([capacityText(local, false), capacityText(local, true)]));
try {
  const { status, model: id } = await waitForServer({ server, headers, log: (line) => console.log(line) });
  model = id;
  frozen = status?.mode === 'read_only';
  const kept = status?.tokens ?? status?.memory?.retained_tokens;
  console.log(`Connected to Rulith Brain${status?.name ? `: the memory "${status.name}"` : ''}`
    + `${kept ? `, ${Number(kept).toLocaleString('en-US')} tokens` : ''}${frozen ? ' (read-only)' : ''}.`);
} catch (error) {
  fail(error?.code === 'auth'
    ? `Rulith Brain at ${server} needs an API key: set RULITH_MEMORY_KEY to the key it was started with, then run this again.`
    : error?.code === 'memory_off'
      ? `The server at ${server} is not Rulith Brain (it runs without a memory). Open Rulith Brain and press "Load the model and start", then run this again.`
      : `Rulith Brain at ${server} could not be used (${error.message}).`);
}

let dshBin;
try {
  const require = createRequire(import.meta.url);
  dshBin = path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js');
} catch {
  fail(`dsh is not installed here: run "npm install" in ${here} first.`);
}

// the forwarder dsh's model route points at: each request goes to the memory as one turn (its conversation ids start
// with "agent"; a turn that meets the app's own chat being answered waits for it, up to 15 minutes)
const { proxy } = createMemoryProxy({ server, model, log: (t) => console.log(t), headers,
  brain: { enabled: brainOn, front, focusK, focusEvery, persona, systemFrom },
  learn: { research: learnResearch, onChange: ({ research }) => saveSettings({ learnResearch: research }) },
  panel: fs.readFileSync(path.join(here, 'brain-panel.html'), 'utf8') });
await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(forwarderPort, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${proxy.address().port}`;
const base = `${origin}/v1`;
console.log(`The agent's page (whether Brain runs, the switches, what each answer drew on): ${origin}/brain`
  + `${brainOn ? '' : ' - answers do not draw on the memory (--brain off)'}`);
console.log(`Learn from research: ${learnResearch ? 'on' : 'off'}${learnResearch && frozen ? ' (this memory is read-only: it does not learn)' : ''}`
  + ' - pages the agent reads while working on a task are learned into the memory; the switch is on the agent\'s page.');

const overlay = path.join(here, 'memory-agent.cordis.yml');
// the web: through the system's proxy when Windows is set to use one (as a browser follows it)
const viaProxy = proxyEnv(windowsProxySettings());
const proxyOf = (e) => e.HTTPS_PROXY || e.https_proxy || e.HTTP_PROXY || e.http_proxy || '';
if (viaProxy.HTTPS_PROXY) console.log(`The web is reached through the system's proxy (${viaProxy.HTTPS_PROXY}).`);
else if (viaProxy.NODE_USE_ENV_PROXY && proxyOf(process.env)) console.log(`The web is reached through the proxy your environment names (${proxyOf(process.env).replace(/\/\/[^@/]*@/, '//')}).`);
const env = {
  ...process.env,
  ...viaProxy,
  DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED', DSH_TELEMETRY_DISABLED: '1',
  RULITH_MEMORY_SERVER: server, RULITH_MEMORY_BASE: base, RULITH_MEMORY_MODEL: model,
  // (11-24, the owner: the page said 100M under a 10M trial) what the page's context meter measures against
  RULITH_MEMORY_CONTEXT: String(capacityLimit(local) ?? 100000000),
  // a local server takes any key; pi-ai wants one to be set
  RULITH_MEMORY_KEY: process.env.RULITH_MEMORY_KEY || 'local',
};
fs.mkdirSync(home, { recursive: true });

// the profile is made once from dsh's shipped web template
if (!fs.existsSync(path.join(home, 'profiles', PROFILE, 'package.json'))) {
  const made = spawnSync(process.execPath, [dshBin, '--profile', PROFILE, '--from-default-profile', 'web', '--patch', overlay, '--dump-config'],
    { cwd: here, env, stdio: ['ignore', 'ignore', 'inherit'] });
  if (made.status !== 0) process.exit(made.status ?? 1);
  console.log(`Profile "${PROFILE}" created in ${home}.`);
}
// the agent's own plugins - the page's brand, the search without an account: a fresh copy at every start (no link),
// so a newer agent never runs with an older one
for (const own of ['rulith-brain-ui', 'rulith-brain-web']) {
  const to = path.join(home, 'profiles', PROFILE, 'node_modules', own);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(path.join(here, own), to, { recursive: true });
}
// the brand's sidebar entry opens the agent's own Brain page: its address is this start's (the forwarder's port)
{
  const client = path.join(home, 'profiles', PROFILE, 'node_modules', 'rulith-brain-ui', 'lib', 'client.js');
  fs.writeFileSync(client, fs.readFileSync(client, 'utf8').replace('"__RULITH_BRAIN_PANEL__"', JSON.stringify(`${origin}/brain`)));
}

const child = spawn(process.execPath, [dshBin, '--profile', PROFILE, '--patch', overlay, ...argv],
  { cwd: process.cwd(), env, stdio: ['inherit', 'pipe', 'inherit'] });
// dsh's own lines name it ("dsh web: <address>"); the console says whose address it is
const named = (line) => line.replace(/^dsh web: /, 'Rulith Brain Agent: ');
let pending = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (text) => {
  const lines = (pending + text).split('\n');
  pending = lines.pop();
  for (const line of lines) process.stdout.write(`${named(line)}\n`);
});
child.stdout.on('end', () => { if (pending) process.stdout.write(named(pending)); });
child.on('close', (code) => { proxy.close(); process.exit(code ?? 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
