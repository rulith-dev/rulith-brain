# Rulith Brain Agent

The companion agent of [Rulith Brain](../README.md): one agent with one long memory that stays with it across days,
sessions and restarts. It works on the tasks you give it, shows its own page in your browser, and uses the same memory
as the Rulith Brain app.

It is open source (MIT). It is DeepSeek Harness (dsh, the npm package `@deepseek-ai/dsh`, MIT) with its web app, plus a
small forwarder that sends each turn to the memory instead of the whole conversation.

> **Preview.** The agent needs a running Rulith Brain, and Rulith Brain's first release is still being prepared. Until
> then the agent has nothing to connect to: this preview is here for reading, for building on, and for the day Brain
> is out.

## What it does

- **One memory.** The agent does not send its whole conversation with every request. Rulith Brain keeps the
  conversation itself; the agent sends each turn's new messages only, and Brain recalls what the turn needs.
- **Shares it with the app.** What you told the app's chat, the agent knows; what the agent worked out, the chat knows.
- **Learns from research.** With **Learn from research** on (the default), the web pages the agent reads while it works
  are learned into the memory, so they are there the next time without the web.
- **Searches without an account.** Its web search is Wikipedia's own search interface: no API key, nothing to sign up
  for. Any page of the web is read by its address. Behind a proxy that Windows is set to use, the agent follows it.
- **Or with a search address of your own.** A SearXNG instance by its address: see [Web search](#web-search).
- **Says what it works with.** **Rulith Brain** at the foot of the page's sidebar opens the agent's own Brain page:
  whether Brain runs, the switch Learn from research, and the documents the last answer drew on.

## Get it

**Windows package** (nothing else to install: Node.js is included): download `rulith-brain-agent-<version>.zip` from
[Releases](../../../releases), unpack it into a folder with a short path, and run `start.cmd` while Rulith Brain is open.

**As a desktop app** (a setup, a Start-menu entry, a window of its own instead of a console window and a browser
tab): no setup is published yet; it is built from source with `npm run desktop` (below).

**From source** (Node.js 22.19 or newer):

```
cd agent
npm install
npm start
```

Rulith Brain listens at `http://127.0.0.1:8091` by default. Another address goes first:
`npm start -- http://<address>:<port>`. A Brain started with an API key: set `RULITH_MEMORY_KEY` to the same key.

| Option | |
|---|---|
| `--learn-research on\|off` | Learn from research (default on). The same switch is on the agent's own page. |
| `--home <folder>` | where the agent keeps its own files: its dsh profile and the page's transcripts (default `~/.rulith-brain-agent`) |
| `--port N`, `--no-open` | the page's port, and not opening the browser |

While Brain is not running yet, or is still loading its model, the agent says so and waits for it.

## Web search

| `RULITH_BRAIN_SEARCH` | | needs |
|---|---|---|
| `wikipedia` (the default) | Wikipedia's own search interface; a query in Chinese asks the Chinese edition first | nothing |
| `searxng` | a SearXNG instance that you run, or trust, with its JSON format switched on | its address: `RULITH_BRAIN_SEARXNG_URL` |

With none of these variables set, the agent follows the search service chosen in the Rulith Brain app on the same PC
(Settings, Web search): it reads the app's settings file at each search and writes nothing to it. A variable goes
before the app's setting. The searches of the second service go to the address you gave. The result pages of search
engines are not read.

## What it keeps where

- The memory is Rulith Brain's: the agent keeps no copy of it.
- The agent's own files: `~/.rulith-brain-agent`, or `--home`.
- The page and the forwarder listen on this computer only (127.0.0.1); the address printed at start carries the page's key.
- No licence key, password or API key is stored in its files.

## How it is made

| | |
|---|---|
| `start.mjs` | the launcher: finds Brain, starts the forwarder and dsh's web app |
| `memory-transport.mjs` | the forwarder: an OpenAI-style endpoint on the loopback interface that dsh's model points at |
| `brain-core.mjs` | the turn logic, with no Node imports: a chat request cut down to one turn of the memory |
| `research-learn.mjs` | the pages read on the web, cleaned and sent to the memory to be learned |
| `system-proxy.mjs` | Windows' proxy setting, handed to the agent's process |
| `rulith-brain-web/` | the web search (Wikipedia, a SearXNG address) as a search provider for dsh |
| `rulith-brain-ui/` | the page's name and mark |
| `brain-panel.html` | the agent's own page: whether Brain runs, the switches, what the last answer drew on |
| `memory-agent.cordis.yml` | the changes to dsh's web profile |
| `test/` | the tests, and `mock-server.mjs`: a stand-in for Rulith Brain's memory server, for trying the agent without a model |
| `tools/pack.mjs` | builds the Windows package (`npm run package`) with every third-party licence text |
| `desktop/` | the desktop app: a small Tauri shell that starts the agent without a console window, shows its page in a window of its own and stops it with the window |
| `tools/desktop.mjs` | builds the desktop app's setup (`npm run desktop`; needs Rust and the Tauri CLI: `npm i -D @tauri-apps/cli`, or `--tauri <its tauri.js>`) |

```
npm test
node test/mock-server.mjs 8091        # a stand-in memory server; then: npm start
```

## Licence

MIT: [LICENSE](LICENSE). DeepSeek Harness, Node.js and the other packages the agent runs on keep their own licences;
the Windows package lists every one of them in its `THIRD-PARTY-NOTICES.txt`.

Rulith Brain itself - the app and its engine - is a separate, closed-source product under its own licence agreement.

## Questions and problems

Open an [issue](../../../issues), or write to contact@rulith.com.
