// A tiny reference client of the Rulith Memory Protocol 1.0 (../rulith-memory-protocol.md). Node 18+ or a
// browser; no dependencies.
//
// MIT License. Copyright (c) 2026 Tengfei Xiao.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
// notice and this permission notice shall be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// The brain has the context itself: a request carries only what is new - what the user says, or the results of the
// tools the brain's last answer called - and your instructions (system, tools) every time; the brain reads those only
// when they change. What this client does for you: it puts a streamed answer together (content, reasoning_content,
// tool_calls), and while the server answers 503 busy or loading it sends the request again - an error status means
// nothing of the request was kept (sections 2.3, 2.4). What it never does: send a request again after a network failure
// or a cut stream (see send() and read()).

/** An error of the protocol: `reason` is what to branch on (section 4). */
export class MemoryProtocolError extends Error {
  constructor(status, error) {
    super(`HTTP ${status}${error?.reason ? ` ${error.reason}` : ''}: ${error?.message ?? ''}`);
    this.name = 'MemoryProtocolError';
    this.status = status;
    this.reason = error?.reason ?? 'server_error';
    this.retryAfterMs = error?.retry_after_ms;
    this.error = error ?? null;   // the whole error object
  }
}

const AGAIN = new Set(['busy', 'loading']);

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')); }, { once: true });
});

export class RulithMemoryClient {
  /**
   * @param server - the server's address, "http://127.0.0.1:8091".
   * @param key - the API key, when the server asks for one.
   * @param system - your instructions (a system message), sent with every request; a call may give its own.
   * @param tools - your tools, sent with every request; a call may give its own.
   * @param model - sent as `model` when given (the server has one model, named after the memory).
   * @param waitMs - how long to go on sending a request again while the server is busy or loading.
   */
  constructor({ server, key = '', system = '', tools = null, model = '', waitMs = 300_000, fetch: f = globalThis.fetch } = {}) {
    this.server = String(server).replace(/\/+$/, '');
    Object.assign(this, { key, system, tools, model, waitMs });
    this.fetch = (...a) => f(...a);
  }

  /** GET /v1/brain/models: [{ id, ... }] - one model, named after the memory. */
  async models({ signal } = {}) {
    return (await (await this.send('GET', '/v1/brain/models', undefined, signal)).json()).data ?? [];
  }

  /** Says `text` to the brain; resolves to the answer's text. */
  async ask(text, options = {}) {
    return (await this.chat({ ...options, messages: [{ role: 'user', content: text }] })).message.content;
  }

  /**
   * One request. `messages`: what is new - user messages, or tool messages with the results of the tool calls of the
   * brain's last answer. The messages go as they are: several people speaking through one application set `name` on
   * each user message ({ role: 'user', name: 'Bea', content }), chosen by the application and stable per person
   * (spec 2.1). `stream` with `onDelta(delta, chunk)` receives the answer as it comes. Other fields (max_tokens,
   * temperature, reasoning_effort, ...) go into the request as they are.
   * @returns { message: { role, content, reasoning_content?, tool_calls? }, finishReason, usage }
   */
  async chat({ messages, system = this.system, tools = this.tools, stream = false, onDelta, signal, ...settings }) {
    const body = { ...(this.model ? { model: this.model } : {}), ...settings,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
      ...(tools?.length ? { tools } : {}), ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}) };
    const r = await this.send('POST', '/v1/brain/chat/completions', body, signal);
    if (stream) return read(r, onDelta);
    const j = await r.json();
    const c = j.choices?.[0] ?? {};
    return { message: c.message ?? { role: 'assistant', content: '' }, finishReason: c.finish_reason ?? null, usage: j.usage ?? null };
  }

  // One call, sent again while the server answers busy or loading (up to waitMs). A network failure is NOT sent again:
  // the request may have reached the brain and its response begun before the connection broke, and then it counts - a
  // request sent again is heard again (section 2.3), so the brain would hear it twice. Only the caller can tell whether
  // it is worth saying again.
  async send(method, path, body, signal) {
    const t0 = Date.now();
    const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) };
    for (;;) {
      const r = await this.fetch(this.server + path, { method, headers, body: body && JSON.stringify(body), signal });
      if (r.ok) return r;
      let error = null;
      try { error = (await r.json()).error; } catch { /* not JSON */ }
      const e = new MemoryProtocolError(r.status, error);
      const wait = e.retryAfterMs ?? 1000;
      if (!AGAIN.has(e.reason) || Date.now() - t0 + wait > this.waitMs) throw e;
      await sleep(wait, signal);
    }
  }
}

// A streamed answer, put together. A stream that breaks off - an error chunk, a broken connection, no [DONE] - is
// thrown with what came (`error.partial`): the request counts all the same (section 2.3), so it is not sent again.
async function read(r, onDelta) {
  const message = { role: 'assistant', content: '', reasoning_content: '', tool_calls: [] };
  const tidy = () => {
    const m = { ...message, tool_calls: message.tool_calls.filter(Boolean) };
    if (!m.reasoning_content) delete m.reasoning_content;
    if (!m.tool_calls.length) delete m.tool_calls;
    return m;
  };
  let finishReason = null, usage = null, done = false, buf = '';
  const event = (data) => {
    if (data === '[DONE]') { done = true; return; }
    let j;
    try { j = JSON.parse(data); } catch { return; }
    if (j.error) throw new MemoryProtocolError(j.error.code ?? 500, j.error);
    if (j.usage) usage = j.usage;
    const c = j.choices?.[0];
    if (!c) return;
    const d = c.delta ?? {};
    if (d.content) message.content += d.content;
    if (d.reasoning_content) message.reasoning_content += d.reasoning_content;
    for (const tc of d.tool_calls ?? []) {
      const k = tc.index ?? message.tool_calls.length;
      const t = (message.tool_calls[k] ??= { id: tc.id, type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) t.id = tc.id;
      if (tc.function?.name) t.function.name += tc.function.name;
      if (tc.function?.arguments) t.function.arguments += tc.function.arguments;
    }
    if (c.finish_reason) finishReason = c.finish_reason;
    onDelta?.(d, j);
  };
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf = (buf + dec.decode(value, { stream: true })).replace(/\r/g, '');
      let at;
      while ((at = buf.indexOf('\n\n')) >= 0) {
        for (const line of buf.slice(0, at).split('\n')) if (line.startsWith('data:')) event(line.slice(5).trim());
        buf = buf.slice(at + 2);
      }
    }
    if (!done) throw new Error('the answer was cut off before its end');
  } catch (e) {
    reader.cancel().catch(() => {});
    e.partial = tidy();
    throw e;
  }
  return { message: tidy(), finishReason, usage };
}
