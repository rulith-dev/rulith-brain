// The desktop app (desktop/: a Tauri shell around the agent the zip package holds; tools/desktop.mjs builds its
// setup): what can be checked without building it - the shell and the launcher agree on the lines that pass between
// them, the shell's own page knows the launcher's words in both languages, the setup's parts are there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAIN } from '../memory-transport.mjs';
import { APP, DESKTOP, PRODUCT, setupName, crateNotices } from '../tools/desktop.mjs';

const AGENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const rust = read(APP, 'rust', 'lib.rs');
const page = read(DESKTOP, 'ui', 'shell.js');
const launcher = read(AGENT, 'start.mjs');

test('the setup: a per-user install with its hooks, icons and the shell\'s own page', () => {
  const conf = JSON.parse(read(APP, 'tauri.conf.json'));
  assert.deepEqual([conf.productName, conf.identifier, conf.mainBinaryName], [PRODUCT, 'ai.rulith.brain.agent', 'rulith-brain-agent']);
  assert.deepEqual([conf.bundle.targets, conf.bundle.windows.nsis.installMode], [['nsis'], 'currentUser']);
  assert.ok(fs.existsSync(path.join(APP, conf.bundle.windows.nsis.installerHooks)));
  for (const icon of [...conf.bundle.icon, conf.bundle.windows.nsis.installerIcon]) assert.ok(fs.existsSync(path.join(APP, icon)), icon);
  const ui = path.resolve(APP, conf.build.frontendDist);
  for (const f of ['index.html', 'shell.js', 'icon.svg']) assert.ok(fs.existsSync(path.join(ui, f)), f);
  // the page runs its script from a file (the app's content policy lets no inline script run)
  assert.equal(conf.app.security.csp['script-src'], "'self'");
  assert.doesNotMatch(read(ui, 'index.html'), /<script(?![^>]*\bsrc=)/);
  // MIT, as the agent is
  assert.match(read(APP, 'Cargo.toml'), /^license = "MIT"$/m);
  assert.equal(setupName('0.2.0'), 'Rulith-Brain-Agent-Setup-0.2.0.exe');
  assert.equal(setupName('0.2.9', true), 'Rulith-Brain-Agent-Setup-0.2.9-draft.exe');
  // the hooks stop only Node under the install folder
  const hooks = read(APP, conf.bundle.windows.nsis.installerHooks);
  assert.match(hooks, /\$\$_\.Name -eq 'node\.exe' -and \$\$_\.ExecutablePath -like '\$INSTDIR\\\*'/);
});

test('the shell and the launcher agree: how the agent is started, the line that names its page', () => {
  // the line dsh prints with the page's address, as the launcher renames it
  const says = /const SAYS_PAGE: &str = "([^"]+)";/.exec(rust)[1];
  assert.equal(says, 'Rulith Brain Agent: ');
  assert.ok(launcher.includes(`line.replace(/^dsh web: /, '${says}')`));
  // the page's port: one of the shell's own when it is free (the page's storage goes by its address), else any
  assert.match(rust, /const PAGE_PORT: u16 = \d{4,5};/);
  assert.match(rust, /free\(PAGE_PORT\)\.or_else\(\|_\| free\(0\)\)/);
  // the flags the shell passes are dsh's own, which the launcher hands on
  assert.match(rust, /\.args\(\["--port", &port\.to_string\(\), "--no-open"\]\)/);
  // the agent as the setup lays it down: what the package's start.cmd runs
  assert.match(rust, /root\.join\("node"\)\.join\("node\.exe"\), root\.join\("app"\)\.join\("start\.mjs"\)/);
  // stopped with everything it started
  assert.match(rust, /"\/PID", &pid\.to_string\(\), "\/T", "\/F"/);
});

test('the agent\'s page is given no way into the shell; other sites open in the browser', () => {
  const cap = JSON.parse(read(APP, 'capabilities', 'default.json'));
  assert.deepEqual([cap.windows, cap.permissions, 'remote' in cap], [['main'], ['core:default'], false]);
  const commands = /generate_handler!\[([^\]]+)\]/.exec(rust)[1].split(',').map((x) => x.trim()).sort();
  assert.deepEqual(commands, ['agent_start', 'agent_state']);
  assert.deepEqual([...page.matchAll(/invoke\('(\w+)'\)/g)].map((m) => m[1]).sort().filter((x, i, a) => a.indexOf(x) === i), commands);
  // Tauri lets any page the window shows call an app's commands (tried on the first build: the agent's page read
  // agent_state): each command asks whose page it is, first thing
  for (const c of commands) assert.ok(rust.split(`fn ${c}(app: AppHandle, window: tauri::WebviewWindow) -> Result<`)[1]?.split('\n')[1]?.trim() === 'asked_by_shell(&window)?;', c);
  assert.match(rust, /url\.scheme\(\) == "tauri" \|\| url\.host_str\(\) == Some\("tauri\.localhost"\) => Ok\(\(\)\)/);
  assert.match(rust, /\.on_navigation\(/);
  assert.match(rust, /\.on_new_window\(/);
  assert.match(rust, /Some\("tauri\.localhost" \| "127\.0\.0\.1" \| "localhost"\)/);
});

test('the shell\'s page knows the launcher\'s words, and says the same in both languages', () => {
  // the lines it reads the start from are the launcher's
  for (const [words, source] of [['Rulith Brain is not running', PLAIN.down], ['Rulith Brain is loading the model', PLAIN.loading],
    ['Rulith Brain is ready', read(AGENT, 'memory-transport.mjs')], ['Connected to Rulith Brain', launcher]]) {
    assert.ok(page.includes(`line.startsWith('${words}')`), words);
    assert.ok(source.includes(words), `the launcher no longer says "${words}"`);
  }
  // English and Chinese: the same keys, none empty but the one that is meant to be
  const [, zh, en] = /const T = zh \? \{([\s\S]*?)\n  \} : \{([\s\S]*?)\n  \};/.exec(page);
  const keys = (block) => [...block.matchAll(/(?:^|[\s,{])(\w+): (?:'|\()/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys(zh), keys(en));
  assert.ok(keys(en).length >= 14);
  for (const k of ['starting', 'down', 'loading', 'opening', 'ended']) assert.ok(keys(en).includes(k) && keys(en).includes(`${k}Help`), k);
  // what the agent is: the same words as on the agent's Brain page
  const about = /aboutText: '(This agent has no model[^']+)'/.exec(page)[1];
  assert.ok(read(AGENT, 'brain-panel.html').includes(`aboutText: '${about}'`));
});

test('the licence texts of the shell\'s crates: crates with the same text together, a crate without one named', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-crates-'));
  const crate = (name, licence, files) => {
    const at = path.join(dir, name);
    fs.mkdirSync(at);
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(at, f), text);
    return { name, version: '1.0.0', license: licence, authors: ['A. Person'], manifest_path: path.join(at, 'Cargo.toml') };
  };
  try {
    const text = crateNotices([crate('aaa', 'MIT', { 'LICENSE-MIT': 'MIT text\r\n', 'lib.rs': 'code' }), crate('bbb', 'MIT', { LICENSE: 'MIT text\n' }),
      crate('ccc', 'Apache-2.0', { 'LICENSE-APACHE': 'Apache text' }), crate('ddd', 'Zlib', { 'README.md': 'no licence file' })], '0.2.0');
    assert.match(text, /^Rust crates in rulith-brain-agent\.exe \(Rulith Brain Agent 0\.2\.0\)/);
    assert.match(text, /aaa 1\.0\.0 \(MIT\)\nbbb 1\.0\.0 \(MIT\)\n\nMIT text\n/);
    assert.match(text, /ccc 1\.0\.0 \(Apache-2\.0\)\n\nApache text\n/);
    assert.match(text, /Crates that ship no licence file[^\n]*:\n\nddd 1\.0\.0 \(Zlib\) - A\. Person\n/);
    assert.equal(text.split('MIT text').length, 2, 'one copy of a text');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
