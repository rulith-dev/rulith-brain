# Rulith Brain

**Give your local AI a long-term memory, on your own PC.**

Rulith Brain is a Windows desktop app that gives a local AI a long-term memory. It learns from new and updated
notes in folders you choose, remembers earlier chats when conversation memory is on, and can search the web and
learn from the pages it reads when you enable web research. The model runs on your PC, and its memory stays on
your disk.

As your project grows, Brain can draw on more of its history. Ask it to compare two approaches today. Weeks
later, open a fresh chat and ask, "We have a tighter budget now. Would you still recommend the same approach?"
Brain can use your earlier research, the reasons behind your decision, and your updated notes to help you
reconsider without starting from scratch.

**[Download Rulith Brain 0.2.6 for Windows](https://github.com/rulith-dev/rulith-brain/releases/latest)** -
free for 30 days, no payment details asked. Product page: [rulith.ai](https://rulith.ai/brain.html).
Already using [Rulith Inference](https://github.com/rulith-dev/rulith-inference)? Since 0.8.0 its **Brain** page runs
Brain with the model you already have, and shares the licence and memories with this app.

## What you get

- **A memory that lasts.** It is there after a restart and weeks later, so you stop pasting the same material
  into every chat.
- **It keeps learning.** Notes in your folders, your conversations and web research all go into one memory.
- **Private.** The model and its memory run on your own machine: no cloud account, no telemetry, and local
  chat works offline. The memory is a folder on your disk that you can back up or move.
- **An agent included.** Rulith Brain Agent, a free open-source companion, researches the web and works on tasks
  with what Brain remembers. Ask it to research a question today, then open Chat tomorrow and ask what it found.
- **Works with your tools.** Other programs on your PC can use the same memory through an OpenAI-compatible
  address or the open Rulith Memory Protocol.
- **One device, every model, for life.** Pay once, with no subscription. The licence is not tied to a model: it
  covers every model Rulith Brain supports on your device, today's and the ones added later, with all updates
  included.

## Three ways to learn

- **A folder.** In **Learn**, choose a folder of text or Markdown notes. Brain reads it into the memory and keeps
  up as files are added or changed. Learning can be paused and resumed.
- **Conversations.** With **Remember conversations** on (the default), Brain can use earlier chats when it answers
  a new question. Turn it off in **Settings** to chat without adding those messages to the memory.
- **Web research.** Turn on **Web** in Chat and Brain can search and read pages for an answer. What it reads
  reaches the memory with the conversation, so later chats can draw on it. Search uses Wikipedia by default, and
  you can choose your own search service in **Settings**. Search terms go to that service, and Brain fetches
  pages from their sites.

The memory is yours to look after: on the **Memory** page you can search for passages and remove the ones you
select. When the memory is full, it makes room for what it reads next by letting old material go, what was
never used first.

## Install and start

1. Download `Rulith-Brain-Setup-0.2.6.exe` from
   [GitHub Releases](https://github.com/rulith-dev/rulith-brain/releases/latest) and run it. The setup includes
   the engine, installs for your Windows account without administrator rights, and the app checks the signature
   of each update before installing it. If Windows SmartScreen shows "Windows protected your PC", choose
   **More info**, then **Run anyway**.
2. Open Rulith Brain. On the **Start** page, start your free 30-day trial (a memory of up to 10 million tokens),
   download the model **Qwen3.8-Flash-Next** (about 107 GB) or select a copy already on your PC, and create a
   memory.
3. Select **Load the model and start**. Loading takes a few minutes. Then ask in **Chat**, give it a folder in
   **Learn**, and choose what it remembers in **Settings**. The interface is in English and Chinese.

## Rulith Brain Agent

The Agent is a free, open-source companion (MIT licence) that uses the same model and the same memory as Chat. It
can search the web, read a page by its address and work on a task with what Brain remembers; what it reads is there
for your later conversations. It runs on the same PC as Brain or on another one that can reach it. The Agent has a
repository of its own, with its source, instructions and downloads:
**[rulith-dev/rulith-brain-agent](https://github.com/rulith-dev/rulith-brain-agent)** - get the desktop app or the
portable version from its [releases](https://github.com/rulith-dev/rulith-brain-agent/releases/latest). The desktop
app updates itself.

## Use Brain from your own programs

While Brain runs, programs on the same PC can speak to it at `http://127.0.0.1:8091` (the **Start** page shows the
address), and the same memory serves them. No API key is needed. Under **Settings > Network** you can choose another
port, or let other devices on your local network use Brain: they then send the access key Brain generates for you as
`Authorization: Bearer <key>`. There are two ways in, each with a path of its own:

- **Rulith Memory Protocol 1.0** - `POST /v1/brain/chat/completions`. Brain's own protocol: a program sends only
  what is new, and Brain has the rest. The request has the shape of an OpenAI chat request, so a client library
  for those works with the base URL `http://127.0.0.1:8091/v1/brain`. The [protocol](protocol/rulith-memory-protocol.md)
  is open and short, and comes with a small [reference client](protocol/client/) and
  [conformance tests](protocol/conformance/).
- **OpenAI-compatible** - `POST /v1/chat/completions`, base URL `http://127.0.0.1:8091/v1`. For programs written
  for an OpenAI-style server, which send their whole conversation with every request. Brain hears only what
  follows the last answer in it, so such a program may shorten or summarise its history without Brain reading
  it again.

Rulith Brain Agent speaks to Brain by the Rulith Memory Protocol, on that same path, and by nothing else. What the
Agent can do with Brain, your own program can do too. Learning from folders, saving, and searching or removing
passages are done in the app.

## What you need

| | |
|---|---|
| Machine | An AMD Ryzen AI Max+ 395 PC with Radeon 8060S graphics and 128 GB of memory |
| Graphics memory | 64 GB, set in the BIOS |
| System | Windows 11 |
| Supported models | Qwen3.8-Flash-Next: 180B parameters in all, 6B active per token. The app downloads it (about 107 GB), or uses a copy already on your PC. Your licence covers the models later versions add |
| Disk | About 107 GB for the model, and for the memory about 6.5 GB for every million tokens it holds |
| Connection | To download the app and the model, and once each to start the trial, to activate a licence and to move one. Local chat then works offline; web research needs a connection |

Brain needs the graphics memory for itself: unload a model another app holds before you start it.

## Sizes and prices

Start with the free 30-day trial of the 10M size: once per device, no payment details asked. A licence is a
one-time purchase for one device, with no subscription; the price depends on how much the memory can hold.
Purchases open later, and [rulith.ai](https://rulith.ai/brain.html#sizes) shows which sizes are on sale.

| Size | What it holds | One-time price |
|---|---|---|
| 10M tokens | A memory of up to 10 million tokens - about 15,000 pages | 20 USD |
| 50M tokens | A memory of up to 50 million tokens - about 75,000 pages | 100 USD |
| 200M tokens | A memory of up to 200 million tokens - about 300,000 pages | 200 USD |
| Unlimited | As large a memory as your device can hold | 500 USD |

Tokens are the pieces of text the model reads. A size is the most one memory may hold. The app also estimates
how large a memory your device can hold, from its free memory and disk space. For example, on a PC with an
estimate of 40 million tokens, the trial covers the first 10 million, and a 50M licence covers growth up to the
roughly 40 million the PC can hold. Prices do not include sales tax or VAT; Creem, the merchant of record, adds
it at checkout where it applies.

**One device, every model, for life.** A licence is bought once for one device and lasts as long as the device.
It is not tied to a model: it covers every model Rulith Brain supports on your device, today's and the ones added
later, and every update for your device and size.

- **Refunds within 14 days.** Within 14 days of purchase you get a full refund without giving a reason
  ([refund policy](https://rulith.ai/refund-policy.html)).
- **New hardware.** Move the licence to your new device yourself, on the **Start** page: once per licence key.
  For another move, write to contact@rulith.ai.
- **A larger size.** A larger size costs only the difference between the two prices: in the app, on the Start
  page, choose Upgrade, enter your licence key and pay the difference. Your key stays the same and gets the larger
  size as soon as the payment is done.

## Questions

- **How does the trial work?** Each device gets one free 30-day trial with a memory of up to 10M tokens, starting
  when you start it on the app's **Start** page. After it ends, Brain needs a licence to run and your memory
  folder stays on disk.
- **Where is my memory?** In a folder on your disk. You can back it up or move it, and the app sends none of it
  anywhere.
- **Does it work offline?** Yes. After the model is downloaded and the trial or licence is started, chatting and
  learning from local files need no connection.
- **What does the Agent add?** While Brain is running, the Agent can research a question on the web and draw on
  the same memory you use in Chat.

## Licence and support

The app and its engine are covered by the [end user licence agreement](EULA.md); paid licences also by the
[terms of sale](https://rulith.ai/brain-terms-of-sale.html). The Agent is open source under the MIT licence, in
[its own repository](https://github.com/rulith-dev/rulith-brain-agent). Bundled components are listed in the [third-party notices](THIRD-PARTY-NOTICES.md).
What the app sends and keeps is described in the [privacy notice](https://rulith.ai/privacy.html).

Report problems on [GitHub Issues](https://github.com/rulith-dev/rulith-brain/issues) (never post a licence key).
For orders and licences, write to contact@rulith.ai. Product and purchase information: [rulith.ai](https://rulith.ai/brain.html).
