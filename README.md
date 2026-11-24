# Rulith Brain

Rulith Brain runs on your Windows PC and keeps a long-term memory you can use across conversations.
Give it a folder of notes, then open a new chat and ask about something you wrote. Under an answer,
**Sources** can show the passages Brain drew on. The model, your files and the memory stay on your PC.

**Version 0.2.0 is released.** Download `Rulith-Brain-Setup-0.2.0.exe` from [GitHub Releases](https://github.com/rulith-dev/rulith-brain/releases).

## Install and start

1. Run `Rulith-Brain-Setup-0.2.0.exe`. The setup includes the engine and installs for your Windows account.
   If Windows SmartScreen appears for the unsigned installer, select **More info** and then **Run anyway**.
2. Open Rulith Brain. This release supports **Qwen3.8-Flash-Next** in the EXL3 4.05 bpw format.
   On the **Start** page, download the model (about 107 GB) or select a copy already on your PC. Support for more models is planned.
3. Start the free 30-day trial and create a memory of up to 10 million tokens. Select **Load the model and start**.
   Once the model is ready, open **Chat**. The app is available in English and Chinese.

## What Brain can learn

- **Files and folders.** In **Learn**, choose a folder of plain text or Markdown files. Brain reads the text
  and picks up additions and changes to the files.
- **Conversations.** With **Remember conversations** on in **Settings**, Brain can draw on earlier chats.
  Turn it off to chat without adding those messages to memory.
- **Web research.** Turn on **Web** in Chat to let Brain search and read pages for an answer. It can learn
  from the pages it reads. Search uses Wikipedia by default. You can choose your own search service in
  **Settings**. Search terms go to that service, and Brain fetches pages from their sites.

On the **Memory** page you can search for passages and remove the ones you select. When memory fills up,
Brain makes room for new text by letting older material go, starting with material it has never used.

## Tested hardware and storage

Version 0.2.0 was tested on Windows 11 with an AMD Ryzen AI Max+ 395, Radeon 8060S graphics and 128 GB of
memory, with 64 GB assigned to graphics in the BIOS. Allow about 107 GB of disk space for the model and
about 6.5 GB for each million tokens stored. After downloading the model and starting the trial, you can
chat and learn from local files offline.

## Rulith Brain Agent

The optional Agent uses the same local model and memory to work on tasks. It can search the web, read a page
by its address and bring what it reads into the conversation. Start Brain and load the model, then choose
an Agent download from [GitHub Releases](https://github.com/rulith-dev/rulith-brain/releases).

- **Desktop app.** Run `Rulith-Brain-Agent-Setup-0.2.0.exe` and open Rulith Brain Agent from the Start menu.
- **Portable version.** Unpack `rulith-brain-agent-0.2.0.zip` and run `start.cmd` to open the Agent in your browser.
  The zip includes Node.js.

The Agent source and instructions are in the [Agent README](agent/README.md).

## Use Brain from other programs

While Brain runs, programs on the same PC can speak to it at `http://127.0.0.1:8091` (the **Start** page shows the
address). No API key is needed. There are two ways in, each with a path of its own:

- **Rulith Memory Protocol 1.0** - `POST /v1/brain/chat/completions`. Brain's own protocol: a program sends only
  what is new, and Brain has the rest. The request has the shape of an OpenAI chat request, so a client library
  for those works with the base URL `http://127.0.0.1:8091/v1/brain`. The [protocol](protocol/rulith-memory-protocol.md)
  is short and comes with a small [reference client](protocol/client/) and [conformance tests](protocol/conformance/).
- **OpenAI-compatible** - `POST /v1/chat/completions`, base URL `http://127.0.0.1:8091/v1`. For programs written
  for an OpenAI-style server, which send their whole conversation with every request. Brain hears only what
  follows the last answer in it, so such a program may shorten or summarise its history without Brain reading
  it again.

Rulith Brain Agent speaks to Brain by the Rulith Memory Protocol, on that same path, and by nothing else. What the
Agent can do with Brain, your own program can do too.

Learning from folders, saving, and searching or removing passages are done in the app; they are not offered to
other programs.

## Licence and support

The free trial covers up to 10 million tokens per memory. Brain also estimates how much memory your computer
can hold from its available RAM and disk space. For example, on a computer with an estimated capacity of
40 million tokens, the trial covers the first 10 million. A 50M licence covers growth beyond 10 million,
up to the roughly 40 million this device can hold. When purchases open, licences will be a one-time purchase per device.
The app and its engine are covered by the [end user licence agreement](EULA.md).
The Agent is open source under the [MIT licence](agent/LICENSE). Bundled components are listed in the
[third-party notices](THIRD-PARTY-NOTICES.md).

Report problems on [GitHub Issues](https://github.com/rulith-dev/rulith-brain/issues).
For product and purchase information, visit [rulith.ai](https://rulith.ai).
