# Rulith Brain

> **The first release is being prepared.** Downloads will appear under [Releases](../../releases).

Long-term memory for the model on your own PC. Rulith Brain is a Windows desktop app that runs a 125B model on your
computer with a memory that lasts: what it learns from your folders, from research and from your conversations stays
with it, and each answer names the documents it drew on. Your data stays on your computer.

Rulith Brain - the app and its engine - is closed source: this repository holds none of their source. It is where
the releases, the licence and the issue tracker live, and it holds the source of **Rulith Brain Agent**, the
open-source companion agent ([agent/](agent/), MIT). Product page, prices and purchase:
[rulith.ai/brain.html](https://rulith.ai/brain.html).

## What it does

- **Remembers across conversations.** What you discussed before stays in the memory, and a new conversation can draw
  on it. With **Remember conversations** off (Settings), each new conversation starts without the earlier ones.
- **Learns in three ways.**
  - *A folder*: in **Learn**, choose a folder of notes and documents; Brain reads it and keeps up as files are added or
    changed. Text and Markdown files are read; PDF and Word documents are not read yet.
  - *Research with Rulith Brain Agent*: with **Learn from research** on, the web pages the agent reads while it works on
    your tasks are learned into the same memory.
  - *Conversations*: what you say in **Chat** is learned while **Remember conversations** is on.
- **Names its sources.** Under an answer, **Sources** lists the documents it drew on.
- **Makes room by itself.** When the memory is full, it forgets whole documents, the least used first.
- **Local only.** The model, the memory and your documents stay on your computer. The memory is a folder on your disk:
  back it up, move it, delete it. No telemetry.

## Getting started

1. **Install.** Download `Rulith-Brain-Setup-<version>.exe` from [Releases](../../releases) and run it (no
   administrator rights needed). The app updates itself and installs an update only when its signature verifies.
2. **Start.** The **Start** page lists what Brain needs and sets each part up: it downloads its engine and the model
   (about 107 GB; a copy already on this PC can be used), starts the 30-day trial or activates your licence key, and
   makes a memory. Press **Load the model and start**; loading takes a few minutes.
3. **Chat, Learn, Settings.** Ask in **Chat**, give it a folder in **Learn**, choose what it remembers in **Settings**.
   English and Chinese.

### Rulith Brain Agent

The companion agent: it works on tasks you give it, opens in your browser, and uses the same memory. Download
`rulith-brain-agent-<version>.zip` from [Releases](../../releases), unpack it, and run `start.cmd` while Rulith Brain
is open (Node.js is included). Its switch **Learn from research** is on by default. It searches Wikipedia without an
account and reads any web page by its address.

The agent is open source under the MIT licence: its source, and how to run it from source, are in [agent/](agent/).
A preview of it is on the Releases page already; it needs Rulith Brain, whose first release is being prepared.

## Requirements

- AMD Ryzen AI Max+ 395 with Radeon 8060S graphics and 128 GB of memory; Windows 11.
- Graphics memory set in the BIOS to 64 GB (the setting Brain is tested with).
- Disk: about 107 GB for the model, and for the memory about 6.5 GB for every million tokens it holds.
- A connection to download the app, its engine and the model, and once each to start the trial, to activate a licence
  and to move one. Daily use needs no connection.
- Brain needs the graphics memory for itself: unload a model another app holds before you start it.

## Licence

A 30-day trial with everything included, then a one-time purchase per device, sized by how much the memory holds
(10M, 50M, 200M or unlimited tokens). Prices, the sizes on sale, refunds, moving to new hardware and larger sizes:
[rulith.ai/brain.html](https://rulith.ai/brain.html). The full terms (the end user licence agreement) are published
here with the first release. Rulith Brain Agent is not under them: it is open source, [MIT](agent/LICENSE).

## Download

From [Releases](../../releases):

| File | |
|---|---|
| `Rulith-Brain-Setup-<version>.exe` | the desktop app: install this |
| `rulith-brain-agent-<version>.zip` | Rulith Brain Agent, the companion agent |
| `rulith-brain-runtime-<version>.zip` | the app's engine: downloaded by the app itself, nothing to do |

Each release lists SHA-256 checksums.

## Support

Open an [issue](../../issues) (never post a licence key), or write to contact@rulith.com - for orders, licences and
refunds with the order number from your receipt and the Device id shown on the app's Start page.

## Third-party software

Rulith Brain is built on open-source components under their own licences; see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
