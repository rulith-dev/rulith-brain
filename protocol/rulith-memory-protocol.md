# Rulith Memory Protocol 1.0

Version 1.0, 2026-11-24. Rulith Brain serves it from version 0.2.0.

How a program speaks to Rulith Brain. There are two ways in, each with a path of its own:

| | Path | What a request carries |
|---|---|---|
| **The Rulith Memory Protocol** (section 2) | `POST /v1/brain/chat/completions` | only what is new - Brain has the rest |
| **The OpenAI-compatible request** (section 3) | `POST /v1/chat/completions` | a whole conversation, as a program written for an OpenAI-compatible server sends it |

Both have the format of OpenAI's chat completions, so a client library for those works with either: its base URL is
`<server>/v1/brain` for the protocol and `<server>/v1` for the compatible request. A reference client is in
[client/](client/), conformance tests are in [conformance/](conformance/).

There is no other way in. Rulith Brain Agent, the companion agent, is a client of the Rulith Memory Protocol like any
other program: it speaks to Brain on `/v1/brain/chat/completions` and uses nothing that is not in this document.

The key words MUST, MUST NOT, SHOULD, MAY are used as in RFC 2119.

## 1. The model

Rulith Brain is **one brain**: a language model with a memory that holds everything it was told and everything it
answered. It does not tell its clients apart and keeps no conversations: whoever speaks to it, it hears, and it answers
from all it remembers. To the outside it offers one thing: **a language model request without context** - a client
sends what is new, the brain has the rest.

- **It has the context itself.** A client sends only what is new. A program built for a stateless chat service, which
  sends its whole message list every time, uses the compatible request instead: of such a list the brain hears only
  the end (section 3).
- **It does one thing at a time.** Requests that arrive while it answers wait their turn (2.4).
- **What was said stays said.** Nothing in the memory is rewritten by a request. When the memory is full it lets old,
  unused material go by itself (the oldest it never used, then the oldest). A request does not ask it to
  forget; taking text out is an operation on the memory in the application (below).
- **Several clients at once hear the same brain.** What one client said may come up in the answer to another, as a
  person who listens to two people at once remembers both.

Everything else - what the brain reads (folders, files), what it holds, where an answer came from, saving, taking text out - is done in the Rulith Brain application, on its own interface. It is not part of
this protocol and not offered to other clients.

## 2. The request

`POST /v1/brain/chat/completions`, in the common chat-completions format - that of OpenAI's API (JSON over HTTP,
UTF-8). A server MAY require `Authorization: Bearer <key>` (Rulith Brain on its own PC asks for none).
`GET /v1/brain/models` answers one model, named after the memory.

**Every message of a request is new.** The brain hears each of them now; it has everything said before.

```json
{
  "messages": [{"role": "user", "content": "Where did we leave the migration plan?"}],
  "stream": true
}
```

A server MUST ignore request fields it does not know, and a client MUST ignore response fields it does not know.
Generation settings (`max_tokens`, `temperature`, `stream`, `reasoning_effort`, ...) and the shape of messages, tools,
tool calls and streamed chunks are those of the common format.

### 2.1 Messages

- `user` messages are what is said to the brain; `tool` messages carry the results of the tool calls of its last
  answer that called tools. A request MUST contain at least one of them. A tool result belongs to the answer that
  called it: the brain places it right after that answer, also when others spoke to the brain in between.
- `system` (or `developer`) messages and `tools` are the instructions this answer follows. They MAY come with every
  request; the brain reads them when they differ from the instructions it read last. The instructions name the brain's
  own thread of what is said under them (inside its one memory: it still answers from all it remembers). A request
  without them is answered under no instructions of its own; that does not clear the instructions read before.
- `assistant` messages are a conversation's history: a request MUST NOT carry one. A request that does is refused
  (`400`, reason `invalid_request`) and nothing of it is kept - it is never heard as if it were said now. A program
  that keeps and sends whole conversations speaks to the compatible request (section 3).

**Several people.** The brain is one party of a chat, with one person or several. An application through which several
people speak to it sets `name` on each `user` message (`{"role": "user", "name": "Bea", "content": "..."}`): one line,
at most 64 bytes, chosen by the application - a person cannot pick another's name - and the same for one person every
time. The brain holds who said what, and the same words from two people are two messages. There is no
isolation: what one person told the brain, it knows when another asks. Asking it to keep something from someone is a
request to its judgement, not a guarantee.

### 2.2 The answer

A chat completion, or with `"stream": true` its chunks as server-sent events. `usage` counts the request, not the
memory: what this request made the brain read; a `cached_tokens` detail, if present, is 0.

### 2.3 What a failed request leaves

A response with an error status means nothing of the request was kept; so does a request whose connection closed
before its response began. Once a response began (status 200) the request counts, also when the stream then ends in an
error or the client stops reading: the brain holds what was said and its answer as far as it got. A request sent again
is heard again, and answered again - a client that does not know whether a request counted says so to its user rather
than sending it again by itself.

### 2.4 Waiting

A request that arrives while another is answered waits, in the order requests arrived, up to the server's limit
(Rulith Brain: 240 s). One that would wait longer is answered `503` (reason `busy`, with `retry_after_ms`) and nothing
of it is kept; the client may send it again after that time. While the memory is still loading the answer is `503`
(reason `loading`).

A waiting request has no response yet, and a long answer takes a while to its end. A client SHOULD stream
(`"stream": true`: the response begins when the brain starts on the request) or wait for a response longer than the
server's limit - many HTTP clients give up waiting for a response's head after a few minutes (Node's fetch after 300 s),
and a request given up that way may count all the same (2.3).

## 3. The OpenAI-compatible request

`POST /v1/chat/completions` (with `GET /v1/models`) is for a program written for a stateless chat service: it keeps
its conversation itself and sends the whole message list with every request. The request and the answer are those of
section 2 - instructions, tools, names, the answer, what a failed request leaves, waiting - with one difference in what
is heard:

**Of a message list, the brain hears what follows the list's last `assistant` message** - the new question, or the
results of the tool calls of that answer; all of the list when it holds no answer yet. Everything before that is not
read and not compared with anything: the brain has what it was told. System messages are the request's instructions
wherever they stand in the list (2.1).

- A program MAY shorten its list as it likes - replace old turns by a summary, drop its oldest turns, edit an earlier
  message. None of that is read again, and none of it changes the memory.
- History the brain never heard is not read either: turns from another service, or examples written as earlier turns.
  What the brain should take into account without having been told belongs in the system message, or is said to it
  as a user message.
- A list sent again (a regenerate, or the same request repeated) ends with the same question: it is heard again and
  answered again, as any request sent again (2.3).
- A list that ends with an `assistant` message asks nothing: `400`, reason `invalid_request`.

A read-only memory keeps no conversation between requests but the one it is serving; of another conversation's list
it reads the whole list, every time.

## 4. Errors

```json
{"error": {"code": 503, "type": "unavailable_error", "reason": "busy", "message": "...", "retry_after_ms": 5000}}
```

| Reason | Status | Meaning |
|---|---|---|
| `invalid_request` | 400 | a field is missing or malformed, or the messages break 2.1 |
| `too_large` | 400 | the request does not fit |
| `busy` | 503 | the request waited too long for its turn |
| `loading` | 503 | the memory is still loading |
| `unavailable` | 503 | the server cannot serve the memory now |
| `server_error` | 500 | anything else |

In a stream, an error after the response began arrives as a chunk `{"error": {...}}` of the same shape - `code`, `type`,
`reason`, `message` as a response with that error would have had them.

## 5. Versions

This is version 1.0. A later minor version only adds; a client that ignores what it does not know keeps working.
