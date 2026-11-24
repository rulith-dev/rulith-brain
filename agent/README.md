# Rulith Brain Agent

Rulith Brain Agent works on tasks you give it using the model and memory on your PC. Open it in its own
desktop window or use the portable version in your browser. Both connect to [Rulith Brain](../README.md).

## What it does

- **Work across conversations.** The Agent sends new messages and task results to Brain. Later conversations
  in the Agent or in Brain's Chat can draw on the same memory.
- **Research a question.** The Agent can search Wikipedia without an account, read a web page by its address
  and use the passages it finds in its answer. You can also choose your own search service.
- **Check the connection.** Select **Rulith Brain** at the foot of the sidebar to see whether Brain is ready.

## Get it

Start Rulith Brain and load its model. Choose a Windows download from [GitHub Releases](https://github.com/rulith-dev/rulith-brain/releases).

- **Desktop app.** Run `Rulith-Brain-Agent-Setup-0.2.0.exe`, then open Rulith Brain Agent from the Start menu.
- **Portable version.** Unpack `rulith-brain-agent-0.2.0.zip` into a folder with a short path. Run `start.cmd`
  to open the Agent in your browser. Node.js is included.

### Run from source

With Node.js 22.19 or newer, run these commands from the root of this repository.

```
cd agent
npm install
npm start
```

Rulith Brain listens at `http://127.0.0.1:8091` by default. To choose another address, run
`npm start -- http://<address>:<port>`. If Brain uses an API key, set `RULITH_MEMORY_KEY` to that key.

| Option | What it controls |
|---|---|
| `--learn-research on\|off` | Learn from research (default on). The same switch is on the agent's own page. |
| `--home <folder>` | Folder for the Agent's profile and transcripts (default `~/.rulith-brain-agent`). |
| `--port N`, `--no-open` | Set the page's port or leave the browser closed at startup. |

The Agent waits for Brain to start and finish loading its model.

## Web search

| `RULITH_BRAIN_SEARCH` | Search service | Configuration |
|---|---|---|
| `wikipedia` (the default) | Wikipedia. A query in Chinese searches the Chinese edition first. | Ready to use |
| `searxng` | A SearXNG instance with JSON results enabled. | Set `RULITH_BRAIN_SEARXNG_URL` to the instance address. |

By default the Agent uses the search service selected under **Settings** in Rulith Brain. The environment
variables above override that choice for the Agent. Queries go to the selected service.

## What it keeps where

Rulith Brain manages the memory. The Agent keeps its profile and transcripts in `~/.rulith-brain-agent`
or the folder you choose with `--home`. Its page and forwarder listen on `127.0.0.1`. The address
printed at startup includes the page's access key.

## How it speaks to Brain

The Agent has no channel of its own. It speaks to Brain by the
[Rulith Memory Protocol](../protocol/rulith-memory-protocol.md), on the path Brain offers to every program for it,
`POST /v1/brain/chat/completions` (with `GET /v1/brain/models`): it sends what is new in a conversation, and Brain
has the rest. What the Agent can do with Brain, any other program can do the same way.

## How it is made

| File or folder | Role |
|---|---|
| `start.mjs` | Finds Brain and starts the local forwarder and the Agent's web interface. |
| `memory-transport.mjs` | Forwards chat requests from the Agent to Brain. |
| `brain-core.mjs` | Prepares each turn for Brain and handles its response. |
| `capacity.mjs` | Reads the device estimate and the licence size Rulith Brain keeps on this PC, for the capacity line and the page's context meter. |
| `research-learn.mjs` | Cleans the pages read on the web for a Brain that offers programs a learn queue. Rulith Brain 0.2.0 offers none: the pages are part of the conversation. |
| `system-proxy.mjs` | Windows' proxy setting, handed to the agent's process |
| `rulith-brain-web/` | the web search (Wikipedia, a SearXNG address) as a search provider for dsh |
| `rulith-brain-ui/` | the page's name and mark |
| `brain-panel.html` | Shows the connection to Brain, settings and available source passages. |
| `memory-agent.cordis.yml` | the changes to dsh's web profile |
| `test/` | Agent tests and their fixtures |
| `tools/pack.mjs` | builds the Windows package (`npm run package`) with every third-party licence text |
| `desktop/` | The Tauri shell that starts the Agent, shows its page in a desktop window and stops it when the window closes. |
| `tools/desktop.mjs` | Builds the desktop setup with `npm run desktop`. Requires Rust and the Tauri CLI (`npm i -D @tauri-apps/cli` or `--tauri <its tauri.js>`). |

```
npm test
```

## Attribution

It is open source (MIT). It is DeepSeek Harness (dsh, the npm package `@deepseek-ai/dsh`, MIT) with its web app, plus a
small forwarder that sends each turn to the memory instead of the whole conversation.

## Licence

MIT: [LICENSE](LICENSE). DeepSeek Harness, Node.js and the other packages the agent runs on keep their own licences;
the Windows package lists every one of them in its `THIRD-PARTY-NOTICES.txt`.

Rulith Brain itself - the app and its engine - is a separate, closed-source product under its own licence agreement.

## Questions and problems

Report problems on [GitHub Issues](https://github.com/rulith-dev/rulith-brain/issues), or write to contact@rulith.ai.
