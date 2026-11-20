// Brain core: an OpenAI chat request, sent to a Rulith Brain memory server as one turn of the Rulith Memory Protocol
// (rulith-brain/protocol/rulith-memory-protocol.md, version 1.0).
//
// No Node imports: the same file runs in the loopback forwarder (memory-transport.mjs, for dsh and other OpenAI
// clients), in Rulith Brain's own page (integrations/brain-ui) and in the Rulith Inference app's chat
// (integrations/jan/brain.ts).
//
// The server keeps the memory: one endless record of what it was told and what it answered, counted in turns. A client
// still builds every request from its full transcript; here it is cut down to what the protocol asks for:
//   - previous_turn: the memory's turn as last read (GET /v1/memory/status); a request based on another turn is
//     refused (turn_mismatch) and goes again with the current one;
//   - a conversation per transcript (a thread): an id chosen here ("<prefix>-<random>"). Its opening turn says
//     conversation_open and carries the conversation's own instructions as ONE leading system message - the persona,
//     the request's leading system text, a client's context notes and, on a read_only memory that has to pick up a
//     transcript, the conversation so far - and the request's tools; the later turns send only the id, and the server
//     applies the conversation's instructions and tools itself, whichever conversation took the turn before;
//   - the messages after the last assistant answer in the request (the memory already holds everything up to it);
//   - a request_id per turn, so a lost answer can be told apart from a turn the memory never took.
// The last few threads (maxThreads) are remembered: a request that continues or repeats any of them goes on in that
// thread's conversation, so interleaved transcripts (an agent's subagents, two chats) keep their own conversations.
//
// The server serves a memory in one of two modes (status "mode"):
//   update     the memory grows with every turn. A request that repeats a thread's last request (regenerated,
//              retried, stopped, the last message edited) takes that turn back first (POST /v1/memory/undo {turn}) when
//              it is still the memory's last turn. The server keeps one turn to take back and drops it when the memory
//              changes otherwise (a learning run, something forgotten): a repeat it cannot take back then goes on as a
//              new turn (the memory keeps the earlier answer too) instead of failing - undoRefusedAsNewTurn, on by
//              default. The status is read before every turn;
//   read_only  a frozen memory holds one conversation at a time and the turn never changes, so the status is read
//              once and kept (and read again after any error). A repeat, or a thread whose conversation another one
//              took the place of, opens a new conversation with the conversation so far as part of its front.
// The protocol's retry rules (section 6): turn_in_flight and loading wait (retry_after_ms) and go again, up to
// busyWaitMs; turn_mismatch goes again with the current turn, after taking back the turn of this very request when the
// error says the memory took it (its answer was lost); conversation_not_found opens the thread again as a new
// conversation; conversation_exists takes another id, once. A changed status "instance" (the server started again)
// drops everything remembered of the server.
//
// A conversation the user starts (newSession()) ends this client's earlier ones (end_conversations) and, with the
// option forgetOnNew and the server's feature forget_conversations, asks the memory to forget what conversations
// added. The answer says whether it did (its memory object: forgot {done, tokens} or {done: false, reason}).
//
// What a turn drew on comes with the answer's last part (the last chunk of a stream): the memory object (turn,
// conversation, request_id, sources: passage ids for POST /v1/memory/sources), and for the advanced view
// timings.memory_focus (the windows as the turn ended) and timings.memory_brain (the lookup counters). An answer that
// is not streamed also says them in its headers (X-Memory-Focus: the windows at its first token; X-Brain-Append); a
// streamed one has neither header, so its windows are known when it ends, and never when it is cut off. Brain mode
// (the server's "brain_append") adds per turn how the memory is recalled: "brain_front" kv | text, "focus_k" windows
// re-chosen every "focus_every" steps - as the client sets, else as the server's memory folder says (status.recall),
// else FRONTS below. POST /v1/memory/windows gives a window's label and source text.

export const NOTE_PREFIX = '(system note) ';
export const TOOL_PREFIX = '(tool result) ';

// dsh adds these to every turn as user messages; the memory needs them again only when they change
const REPEATED_CONTEXT = [
  ['runtime', 'Current runtime context.'],
  ['skills', '<system-reminder>\nA skill is a reusable set of task-specific instructions.'],
];
// its note of the time comes with every step. Where a turn's text also picks what is recalled (brain mode, a frozen
// memory), it is context too: it goes again only when the date changes
const TIME_NOTE = 'Time sampled while preparing turn';
const contextKind = (m, withTime = false) => {
  if (m.role !== 'user' || typeof m.content !== 'string') return undefined;
  if (withTime && m.content.startsWith(TIME_NOTE)) return 'time';
  return REPEATED_CONTEXT.find(([, prefix]) => m.content.startsWith(prefix))?.[0];
};
const contextValue = (kind, text) => kind === 'time' ? (/\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? text) : text;

export const textOf = (content) => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '';

const isSystem = (m) => m?.role === 'system' || m?.role === 'developer';

/** Index of the last assistant message, -1 when there is none. */
export const lastAnswer = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'assistant') return i;
  return -1;
};

// a 64-bit string hash (two FNV-1a passes with different offsets): enough to tell transcripts apart, and it needs
// no crypto module
const hash = (text) => {
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b) + (a >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
};

// what of a message has to be the same for it to be the same message: not the fields clients add or drop between
// requests (reasoning, ids of their own)
const essence = (m) => [m.role, textOf(m.content), m.tool_call_id ?? '',
  (m.tool_calls ?? []).map((c) => [c.id ?? '', c.function?.name ?? '', c.function?.arguments ?? ''])];

/** The conversation without its system messages: the persona is the conversation's front, not a turn. */
export const dialogue = (messages) => messages.filter((m) => !isSystem(m));

export const digestOf = (messages) => hash(JSON.stringify(dialogue(messages).map(essence)));

/** A digest of the messages up to and including the last answer: what the memory already holds of this view. */
export const heldDigest = (messages) => digestOf(messages.slice(0, lastAnswer(messages) + 1));

/**
 * The turn's new messages for the memory.
 * @param messages - the OpenAI-shaped messages of the request.
 * @param first - keep the leading system messages as they are (a caller that sends them itself); otherwise they are
 *   left out at the start of a transcript (they go in the conversation's front) and a later one becomes a user note.
 * @returns the messages to send (never an assistant message).
 */
export function memoryDelta(messages, first) {
  const from = lastAnswer(messages) + 1;
  const out = [];
  for (let i = from; i < messages.length; i++) {
    const m = messages[i];
    if (isSystem(m)) {
      const leading = out.every(isSystem);
      if (first && leading) { out.push(m); continue; }
      if (leading && from === 0) continue;
      const text = textOf(m.content);
      if (text) out.push({ role: 'user', content: NOTE_PREFIX + text });
      continue;
    }
    out.push(m);
  }
  return out;
}

/** The request's leading system text: a client's persona and instructions. */
export const systemText = (messages) => {
  const out = [];
  for (const m of messages) {
    if (!isSystem(m)) break;
    const text = textOf(m.content).trim();
    if (text) out.push(text);
  }
  return out.join('\n\n');
};

const clip = (text, n) => text.length > n ? text.slice(0, n) + ' [...]' : text;

/**
 * The conversation so far as plain text, for a conversation that has to be opened again on a frozen memory: the newest
 * turns that fit `budget` characters. Tool outputs are cut to their head; a client's repeated context notes are left out.
 */
export function transcriptOf(messages, budget = 24000) {
  const lines = [];
  for (const m of dialogue(messages)) {
    if (contextKind(m, true) !== undefined) continue;
    const text = textOf(m.content).trim();
    if (m.role === 'user' && text) lines.push('User: ' + text);
    else if (m.role === 'assistant') {
      const calls = (m.tool_calls ?? []).map((c) => `[called ${c.function?.name ?? 'a tool'}]`).join(' ');
      if (text || calls) lines.push('Assistant: ' + [text, calls].filter(Boolean).join(' '));
    } else if (m.role === 'tool' && text) lines.push('Tool result: ' + clip(text, 600));
  }
  if (!lines.length) return '';
  const kept = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    size += lines[i].length + 1;
    if (size > budget && kept.length) break;
    kept.unshift(size > budget ? clip(lines[i], budget) : lines[i]);
  }
  const cut = kept.length < lines.length;
  return '[Earlier in this conversation, oldest first' + (cut ? '; its beginning is left out' : '') + ']\n'
    + kept.join('\n') + '\n[End of the earlier conversation]';
}

/** "8 windows (12,40,77); ..." -> { windows: 8, ids: [12, 40, 77], detail: '...' }; anything else -> { detail }. */
export function parseFocus(header) {
  if (!header) return null;
  const m = /^(\d+) windows? \(([^)]*)\)(?:;\s*)?(.*)$/s.exec(header);
  if (!m) return { windows: 0, ids: [], detail: header };
  const ids = m[2].split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0);
  return { windows: Number(m[1]), ids, detail: m[3] };
}

/** "front=1,2; text=; appended=7; kv_added=9,10" -> { front: [1, 2], text: [], appended: [7], kv_added: [9, 10] }. */
export function parseWindows(text) {
  if (!text) return null;
  const out = {};
  for (const part of String(text).split(';')) {
    const m = /^\s*([a-z_]+)\s*=\s*([\d,\s]*)$/i.exec(part);
    if (m) out[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  }
  return Object.keys(out).length ? out : null;
}

/** The windows a turn had in front of it, each once: as it ended when the answer said so, else as it began. */
export function recalledWindows(record) {
  const w = record?.windows;
  const ids = w ? [...(w.front ?? []), ...(w.text ?? []), ...(w.appended ?? []), ...(w.kv_added ?? [])] : (record?.focus?.ids ?? []);
  return [...new Set(ids)];
}

// The end of an answer says what the turn did (its memory object, timings.memory_brain, timings.memory_focus): read as
// the bytes go by. Nothing is held back or changed; an answer that is cut off simply never reports
function watched(response, streamed, done) {
  try {
    if (!response.body || typeof TransformStream === 'undefined') return response;
    const dec = new TextDecoder();
    let carry = '', whole = '', timings = null, memory = null;
    const take = (j) => {
      if (j?.timings && typeof j.timings === 'object') timings = j.timings;
      if (j?.memory && typeof j.memory === 'object') memory = j.memory;
    };
    const line = (l) => {
      if (!l.startsWith('data:') || !(l.includes('"timings"') || l.includes('"memory"'))) return;
      try { take(JSON.parse(l.slice(5))); } catch { /* not a whole event */ }
    };
    const ts = new TransformStream({
      transform(chunk, ctl) {
        ctl.enqueue(chunk);
        const text = dec.decode(chunk, { stream: true });
        if (!streamed) { whole += text; return; }
        const parts = (carry + text).split('\n');
        carry = parts.pop();
        parts.forEach(line);
      },
      flush() {
        if (streamed) line(carry);
        else try { take(JSON.parse(whole)); } catch { /* not JSON */ }
        try { done({ timings, memory }); } catch { /* the page's own trouble */ }
      },
    });
    return new Response(response.body.pipeThrough(ts), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch {
    return response;
  }
}

/** "lookups=1; input_tokens=1951; ..." -> { lookups: 1, input_tokens: 1951, ... }. */
export function parseBrain(header) {
  if (!header) return null;
  const out = {};
  for (const part of header.split(';')) {
    const m = /^\s*([a-z_]+)\s*=\s*(-?\d+)\s*$/i.exec(part);
    if (m) out[m[1]] = Number(m[2]);
  }
  return Object.keys(out).length ? out : null;
}

// The protocol's reasons a client branches on (section 7): each is its own code
const REASONS = new Set(['turn_mismatch', 'turn_in_flight', 'conversation_not_found', 'conversation_exists', 'nothing_to_undo',
  'read_only', 'tools_fixed', 'too_large', 'not_found', 'loading']);
// what Rulith Brain's server says beside a general reason (invalid_request, unsupported, ...): refusals a person can
// act on, by what its message says
const PRODUCT_CODES = [
  ['memory_off', /memory mode is (off|not on)|--memory-mode/i],
  ['one_slot', /one slot only|--parallel 1/i],
  ['brain_unavailable', /requires LLAMA_QSA_SEAL_FOCUS|brain trials require/i],
  ['brain_invalid', /brain state is invalid/i],
  ['memory_load', /cannot load the saved memory/i],
  ['text_only', /memory mode is text only/i],
  ['brain_request', /brain append (supports|tool continuation)/i],
];
// a server from before the protocol's reasons: the same refusals by their words
const OLD_CODES = [
  ['turn_mismatch', /previous_turn is/i],
  ['tools_fixed', /tools are fixed at the first turn/i],
  ['nothing_to_undo', /nothing to undo|the memory changed since the last turn/i],
  ['read_only', /read-only/i],
];

/**
 * A code for a failed request: the protocol's reason when it is one a client acts on (REASONS), else one of
 * PRODUCT_CODES by the server's words, 'loading' (503 while the model loads), 'server_down' (no answer), else
 * 'server_error'. Without a reason (an older server) the words decide.
 */
export function errorCode(message, status, reason) {
  if (reason && REASONS.has(reason)) return reason;
  const text = String(message ?? '');
  for (const [code, re] of PRODUCT_CODES) if (re.test(text)) return code;
  if (!reason) for (const [code, re] of OLD_CODES) if (re.test(text)) return code;
  if (status === undefined || status === 0) return 'server_down';
  if (status === 503 && /loading/i.test(text)) return 'loading';
  return 'server_error';
}

export class MemoryError extends Error {
  /**
   * @param code - this client's code (errorCode() when not given).
   * @param reason - the protocol's reason, as the server sent it (null: none).
   * @param turn, last_request - what a turn_mismatch carries; retry_after_ms - what turn_in_flight and loading may.
   */
  constructor(message, { code, status, reason, turn, last_request, retry_after_ms } = {}) {
    super(message);
    this.name = 'MemoryError';
    this.status = status;
    this.reason = typeof reason === 'string' && reason ? reason : null;
    if (Number.isInteger(turn)) this.turn = turn;
    if (last_request !== undefined) this.last_request = last_request;
    if (Number.isFinite(retry_after_ms)) this.retry_after_ms = retry_after_ms;
    this.code = code ?? errorCode(message, status, this.reason);
  }
}

/** The MemoryError of a refused request: the protocol's error object ({error: {code, type, reason, message, ...}}). */
export function errorFrom(where, status, text, { code } = {}) {
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  const e = data?.error && typeof data.error === 'object' ? data.error : null;
  const said = String(e?.message ?? (typeof data?.error === 'string' ? data.error : String(text ?? '').slice(0, 300)));
  return new MemoryError(`${where}: HTTP ${status} ${said}`, { code, status, reason: e?.reason, turn: e?.turn,
    last_request: e?.last_request, retry_after_ms: e?.retry_after_ms });
}

// How a turn recalls when neither the client nor the server says otherwise - the server's own defaults (status.recall
// of a memory folder without RULITH_BRAIN_FRONT / _FOCUS_K / _FOCUS_EVERY). The native base: 12 windows join the
// cache as KV pieces, chosen again every 16 steps (the same answers as at every step, and faster decoding on a large
// memory; measured 11-19). As source text (the optional skill) a turn reads 8, chosen again every 128 steps.
export const FRONTS = { kv: { focusK: 12, focusEvery: 16 }, text: { focusK: 8, focusEvery: 128 } };
export const FOCUS_K_MAX = 256;       // the server's bound with brain_append
export const WINDOWS_PER_CALL = 64;   // /v1/memory/windows and /v1/memory/sources answer at most this many
// (front undefined: the server's; focusK / focusEvery 0: the front's own count, the server's or FRONTS)
const BRAIN_DEFAULTS = { enabled: false, front: undefined, focusK: 0, focusEvery: 0, autoEval: false, autoPolicy: undefined,
  focusPinUser: undefined, focusSwap: undefined, focusCarry: undefined,
  persona: '', systemFrom: 'both', resumeChars: 24000 };

/** status.recall as the server sends it ({ front, focus_k, focus_every }) -> { front, focusK, focusEvery }, or null. */
export function serverRecall(r) {
  if (!r || typeof r !== 'object' || (r.front !== 'kv' && r.front !== 'text')) return null;
  const count = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
  return { front: r.front, focusK: count(r.focus_k), focusEvery: count(r.focus_every) };
}
const MAX_TURNS = 50;
const MAX_ENDED = 64;
// how often one request goes again after the memory moved on, or its conversation had to be opened again
const MISMATCH_TRIES = 4;
const REOPEN_TRIES = 2;
const LOST_TRIES = 2;

// random base36 characters (crypto where there is one: conversation ids should not collide with another client's)
const randomPart = (n) => {
  const c = globalThis.crypto;
  let s = '';
  if (c?.getRandomValues) for (const x of c.getRandomValues(new Uint8Array(n))) s += (x % 36).toString(36);
  else for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
};
const abortError = () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e; };
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const t = setTimeout(() => { signal?.removeEventListener?.('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(t); reject(abortError()); };
  signal?.addEventListener?.('abort', stop, { once: true });
});

/** The turn logic: what the last requests left in the memory, and how the next one goes out. */
export class MemoryTransport {
  /**
   * @param server - the memory server, "http://127.0.0.1:8091" (Rulith Brain's).
   * @param fetch - the fetch to reach it with.
   * @param headers - sent with every request to the server (its API key).
   * @param brain - brain mode: { enabled, front 'kv'|'text' (unset: the server's status.recall, else kv), focusK
   *   1..256 and focusEvery (0: the front's own - the server's status.recall for its front, else FRONTS), persona,
   *   systemFrom 'both'|'request'|'persona', resumeChars, autoEval, autoPolicy, and the server's optional
   *   focusPinUser / focusSwap / focusCarry, sent only when set }.
   * @param onTurn - called when a turn's record is complete: the answer's end said what it drew on.
   * @param onWait - called when a turn waits ({ reason: 'busy' | 'loading', ms, since }): another conversation is
   *   being answered, or the server loads its model.
   * @param undoRefusedAsNewTurn - a repeated request whose turn the server can no longer take back (the memory learned
   *   or forgot something since) goes on as a new turn instead of failing (default); false: it fails.
   * @param idPrefix - the readable start of this client's conversation ids ("app", "agent").
   * @param busyWaitMs - how long a turn may wait for another conversation's answer (or the model to load).
   * @param forgetOnNew - true, or a function returning true: a conversation the user starts asks the memory to forget
   *   what conversations added (only where the server lists forget_conversations).
   * @param maxThreads - how many threads (transcripts) are remembered.
   */
  constructor({ server, fetch: f = globalThis.fetch, log = () => {}, headers = {}, brain = {}, onTurn, onWait, undoRefusedAsNewTurn = true,
    idPrefix = 'brain', busyWaitMs = 120_000, forgetOnNew = false, maxThreads = 8 }) {
    this.onTurn = onTurn;
    this.onWait = onWait;
    this.undoRefusedAsNewTurn = undoRefusedAsNewTurn !== false;
    this.server = String(server).replace(/\/+$/, '');
    this.fetch = (...args) => f(...args);   // (a browser's fetch must not be called as a method of this object)
    this.log = log;
    this.headers = headers;
    this.brain = { ...BRAIN_DEFAULTS, ...brain };
    this.idPrefix = String(idPrefix ?? '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 24) || 'brain';
    this.busyWaitMs = Math.max(0, Number(busyWaitMs) || 0);
    this.forgetOnNew = forgetOnNew;
    this.maxThreads = Math.max(1, Math.round(Number(maxThreads)) || 8);
    this.threads = [];        // the threads, the most recent first: see accepted()
    this.ended = [];          // conversation ids of this client no thread holds any more: ended with the next new one
    this.seen = null;         // the server's status as last read (status())
    this.stale = false;       // read the status again before the next turn (after an error)
    this.session = null;      // the conversation of the last turn: { key, conversation, startedAt, turns, resumed }
    this.turns = [];          // what the last turns did, newest first (see record())
    this.error = null;        // the last failure: { code, message, at }
    this.waiting = null;      // a turn waiting: { reason, since }
    this.fresh = null;        // the next request opens a new conversation the user started: { forget } (newSession())
    this.queue = Promise.resolve();
    this.serialN = 0;
    this.requestN = 0;
  }

  /** The thread of the last turn (as the transport before conversations called it). */
  get last() { return this.threads[0] ?? null; }

  configure(brain) { this.brain = { ...this.brain, ...brain }; }

  /**
   * The request fields of brain mode as they go out: the front and its window counts - as set, else as the server's
   * memory folder says (status.recall; its counts are for the front it names), else FRONTS.
   */
  request() {
    const said = this.seen?.recall ?? null;
    const set = this.brain.front === 'text' || this.brain.front === 'kv' ? this.brain.front : null;
    const front = set ?? said?.front ?? 'kv';
    const theirs = said && said.front === front ? said : null;
    const own = FRONTS[front];
    return { front,
      focusK: Math.max(1, Math.min(FOCUS_K_MAX, Math.round(Number(this.brain.focusK)) || theirs?.focusK || own.focusK)),
      focusEvery: Math.max(1, Math.round(Number(this.brain.focusEvery)) || theirs?.focusEvery || own.focusEvery) };
  }

  /** Forget what the server was last seen holding: it was restarted, or another memory was loaded. */
  reset() { this.forgetServer(); this.seen = null; this.stale = false; this.error = null; }

  // what this client remembered of the server (its threads, their context notes) no longer holds there
  forgetServer() { this.threads = []; this.ended = []; this.session = null; }

  /**
   * The next request opens a new conversation the user started, whatever it continues: it ends this client's earlier
   * conversations and, with forgetOnNew, asks the memory to forget what conversations added.
   * @param forget - false: never ask to forget with it (a new start of the same conversation, the persona read again).
   */
  newSession({ forget = true } = {}) { this.fresh = { forget: forget !== false }; }

  /** A new conversation id, or a request id: "<prefix>-<random>". */
  newId() { return `${this.idPrefix}-${randomPart(12)}`; }
  newRequestId() { return `${this.idPrefix}-${randomPart(10)}-${(++this.requestN).toString(36)}`; }

  forgets() { return typeof this.forgetOnNew === 'function' ? this.forgetOnNew() === true : this.forgetOnNew === true; }

  async json(path, body) {
    let r;
    try {
      r = await this.fetch(this.server + path, body === undefined ? { headers: { ...this.headers } } : {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...this.headers }, body: JSON.stringify(body) });
    } catch (error) {
      throw new MemoryError(`memory server ${path}: ${error?.message ?? error}`, { code: 'server_down' });
    }
    const text = await r.text();
    if (!r.ok) {
      const e = errorFrom(`memory server ${path}`, r.status, text);
      // (a route the server does not have: a server without a memory)
      if (r.status === 404 && !e.reason) e.code = 'memory_off';
      throw e;
    }
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  /**
   * The server's status. A read-only memory's is kept once read (its turn never changes), until an error.
   * @param force - ask whatever is kept.
   */
  async status(force = false) {
    if (!force && !this.stale && this.seen?.mode === 'read_only') return this.seen;
    return this.noteStatus(await this.json('/v1/memory/status'));
  }

  /** A status as the server answered it (GET /v1/memory/status), taken as the one last seen. */
  noteStatus(s) {
    if (s?.memory_mode === false) throw new MemoryError('memory mode is off (start the server with --memory-mode)', { code: 'memory_off' });
    const mode = s?.mode === 'read_only' ? 'read_only' : 'update';
    const instance = typeof s?.instance === 'string' && s.instance ? s.instance : null;
    // the server started again (or another memory is served): nothing remembered of it holds
    if (this.seen && ((instance && this.seen.instance && instance !== this.seen.instance) || mode !== this.seen.mode)) {
      if (this.threads.length) this.log('memory: the memory server started again: its conversations open anew');
      this.forgetServer();
    }
    // (recall: how the memory's folder says a turn recalls; name and forgetting: for a page to show)
    this.seen = { mode, turn: Number(s?.turn ?? 0), memory: s?.memory ?? null,
      raw_log_tokens: s?.raw_log_tokens, recall: serverRecall(s?.recall), name: typeof s?.name === 'string' ? s.name : null,
      forgetting: s?.forgetting && typeof s.forgetting === 'object' ? { on: s.forgetting.on === true } : null,
      instance, protocol: s?.protocol && typeof s.protocol === 'object' ? s.protocol : null,
      features: Array.isArray(s?.features) ? s.features.map(String) : [], busy: s?.busy === true,
      last_request: typeof s?.last_request === 'string' ? s.last_request : null,
      conversation: typeof s?.conversation === 'string' ? s.conversation : null,
      conversations: Array.isArray(s?.conversations) ? s.conversations : [],
      conversation_idle_s: Number.isFinite(s?.conversation_idle_s) ? s.conversation_idle_s : null,
      at: new Date().toISOString() };
    this.stale = false;
    return this.seen;
  }

  /** Whether the server lists an optional part of the protocol (status "features"). */
  has(feature) { return !!this.seen?.features?.includes(feature); }

  /** Takes back turn `turn`, the memory's last one: { turn } as it is after. */
  undo(turn) { return this.json('/v1/memory/undo', { turn }); }

  /**
   * The label (book / section) and source text of memory windows; window w is tokens [256 w, 256 w + 512).
   * @returns [{ window, label, text, token_start, token_end }], in the order asked, without the ones the memory lacks.
   */
  async windows(ids) {
    const want = [...new Set(ids)].filter((w) => Number.isInteger(w) && w >= 0);
    const out = [];
    for (let i = 0; i < want.length; i += WINDOWS_PER_CALL) {
      const r = await this.json('/v1/memory/windows', { windows: want.slice(i, i + WINDOWS_PER_CALL) });
      out.push(...(Array.isArray(r?.windows) ? r.windows : []));
    }
    return out;
  }

  /**
   * The passages an answer drew on (its memory object's sources), with the name of the document or conversation each
   * comes from: [{ id, label, text }].
   */
  async sources(ids) {
    const want = [...new Set(ids ?? [])].filter((x) => x !== null && x !== undefined);
    const out = [];
    for (let i = 0; i < want.length; i += WINDOWS_PER_CALL) {
      const r = await this.json('/v1/memory/sources', { ids: want.slice(i, i + WINDOWS_PER_CALL) });
      out.push(...(Array.isArray(r?.sources) ? r.sources : []));
    }
    return out;
  }

  /** One turn at a time: `fn` runs after the previous turn has been handed to the server. */
  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * The request body for the memory, plus what to remember once the server takes it.
   * @param params - the OpenAI chat request.
   * @param key - the client's name for the transcript, when it has one (a thread id): requests of different
   *   transcripts are then never taken for a repeat or a continuation of one another.
   * @param recover - what earlier attempts of the same request found: { requestId, force (read the status again),
   *   newId (open under another id), openId (the id an earlier attempt opened) }.
   */
  async rewrite(params, key, recover = {}) {
    if (!Array.isArray(params?.messages)) throw new MemoryError('memory mode: a chat request with messages is expected', { code: 'bad_request', status: 400 });
    const st = await this.status(recover.force === true);
    let turn = st.turn;
    const readOnly = st.mode === 'read_only';
    const brain = this.brain.enabled;
    const msgs = params.messages;
    const cut = lastAnswer(msgs) + 1;
    const all = dialogue(msgs);
    const heldN = dialogue(msgs.slice(0, cut)).length;     // the dialogue's messages up to the last answer
    const held = digestOf(msgs.slice(0, cut));
    const firstNew = textOf(all[heldN]?.content);
    const fresh = this.fresh;

    // the remembered thread this request goes on in: one whose last request, the answer it got, then something new
    // it is (continues); or one whose last request it is again up to its last answer (repeats: that answer was not
    // kept - regenerated, retried, stopped, the last message edited). Without an answer in it yet, only the same first
    // message is a repeat - anything else is another transcript
    let thread = null, repeats = false;
    if (!fresh) {
      for (const T of this.threads) {
        if (T.key !== key) continue;
        if (heldN === T.count + 1 && all.length > heldN && digestOf(all.slice(0, T.count)) === T.full) { thread = T; break; }
        if (held === T.held && (heldN > 0 || firstNew === T.firstNew)) { thread = T; repeats = true; break; }
      }
    }

    let open = !thread;              // this turn opens a conversation
    let id = thread?.id ?? null;
    let undone = false;
    let context = new Map(thread?.context ?? []);
    if (thread && readOnly && (repeats || thread !== this.threads[0])) {
      // a frozen memory keeps what a conversation's turns left, and holds one conversation: a repeat, or a thread
      // another conversation took the place of, opens a new one with what was said
      open = true; id = null; context = new Map();
    } else if (thread && repeats && thread.turn === turn && (st.last_request === null || st.last_request === thread.requestId)) {
      // the thread's last turn is the memory's last: take it back, then send the request again
      let u = null;
      try {
        u = await this.undo(turn);
      } catch (error) {
        // the memory changed since the turn (a learning run, something forgotten) and the server cannot take it back:
        // the turn stays, and this request goes on as a new turn after it (undoRefusedAsNewTurn)
        if (!this.undoRefusedAsNewTurn || (error?.code !== 'nothing_to_undo' && error?.code !== 'turn_mismatch')) throw error;
        this.log('memory: the last turn cannot be taken back (the memory changed since: it learned or forgot something): the request goes as a new turn');
      }
      if (u) {
        turn = Number.isInteger(u.turn) ? u.turn : turn - 1;
        this.seen = { ...this.seen, turn, last_request: null };
        this.log(`memory: took back turn ${turn + 1} (the request repeated it)`);
        undone = true;
        // its conversation's opening turn taken back: the conversation is known with no turns and opens again
        if (thread.opened) open = true;
        context = new Map();   // what the undone turn carried is gone: the context goes again
      }
    }
    if (open && (!id || recover.newId)) id = recover.openId && !recover.newId ? recover.openId : this.newId();

    // a client's context notes: sent again only when they change; on an opening turn they are read with the front,
    // once - as part of a turn their words would help pick what the turn recalls
    const withTime = readOnly || brain;
    const sent = new Map();
    const notes = [];
    let messages = memoryDelta(msgs, false).filter((m) => {
      const kind = contextKind(m, withTime);
      if (kind === undefined) return true;
      const value = contextValue(kind, m.content);
      if (context.get(kind) === value || sent.get(kind) === value) return false;
      sent.set(kind, value);
      if (open) { notes.push(m.content); return false; }
      return true;
    });
    // a new conversation has no tool call to answer: its tool results are read as notes (the front says what came before)
    if (open) messages = messages.map((m) => (m.role === 'tool' ? { role: 'user', content: TOOL_PREFIX + textOf(m.content) } : m));
    if (!messages.some((m) => m.role === 'user' || m.role === 'tool'))
      throw new MemoryError('memory mode: nothing new to send (a turn needs a user or tool message)', { code: 'nothing_new', status: 400 });

    const body = { ...params, previous_turn: turn, conversation: id, request_id: recover.requestId ?? this.newRequestId() };
    let resumed = false;
    let ended = [];
    if (open) {
      // the conversation's front: the persona, the request's instructions, the context notes, and on a frozen memory
      // the conversation it has to pick up
      const parts = [];
      if (this.brain.systemFrom !== 'request' && this.brain.persona?.trim()) parts.push(this.brain.persona.trim());
      if (this.brain.systemFrom !== 'persona') { const s = systemText(msgs); if (s) parts.push(s); }
      parts.push(...notes);
      if (readOnly) {
        const before = transcriptOf(msgs.slice(0, cut), this.brain.resumeChars);
        if (before) { parts.push(before); resumed = true; }
      }
      if (parts.length) messages = [{ role: 'system', content: parts.join('\n\n') }, ...messages];
      body.conversation_open = true;
      if (fresh) {
        // the user's new conversation: this client's earlier ones are finished
        ended = [...new Set([...this.threads.map((T) => T.id), ...this.ended])].filter((x) => x && x !== id);
        if (ended.length) body.end_conversations = ended;
        if (fresh.forget && !readOnly && this.forgets() && this.has('forget_conversations')) body.forget_conversations = true;
      }
    } else {
      delete body.tools; delete body.tool_choice; delete body.parallel_tool_calls;
    }
    body.messages = messages;
    if (brain) {
      const q = this.request();
      body.brain_append = true;
      body.brain_front = q.front;
      body.focus_k = q.focusK;
      body.focus_every = q.focusEvery;
      for (const [field, value] of [['focus_pin_user', this.brain.focusPinUser], ['focus_swap', this.brain.focusSwap], ['focus_carry', this.brain.focusCarry]])
        if (typeof value === 'number' && Number.isFinite(value)) body[field] = value;
      if (this.brain.autoEval) {
        body.brain_auto_eval = true;
        if (this.brain.autoPolicy) body.brain_auto_policy = this.brain.autoPolicy;
      }
    }
    const question = [...messages].reverse().find((m) => m.role === 'user' && contextKind(m, true) === undefined);
    return { body, key, held, full: digestOf(msgs), count: all.length, firstNew, turnBefore: turn,
      context: new Map([...context, ...sent]), open, sessionStart: open, conversation: id, thread, fresh, ended,
      session: undone ? 'retaken' : resumed ? 'resumed' : open ? 'new' : 'continued', readOnly,
      question: clip(textOf(question?.content ?? '').replace(/\s+/g, ' ').trim(), 200) };
  }

  /**
   * The server took the turn: remember what it holds now.
   * @param plan - what rewrite() returned.
   * @param turn - the memory's turn after it (X-Memory-Turn).
   */
  accepted(plan, turn) {
    const p = plan;
    const T = p.thread ?? { startedAt: null, turns: 0, resumed: false };
    // (a thread that goes on in another conversation: the old one is finished)
    if (T.id && T.id !== p.conversation && !p.readOnly) this.ended.push(T.id);
    Object.assign(T, { id: p.conversation, key: p.key, held: p.held, full: p.full, count: p.count, firstNew: p.firstNew, turn,
      opened: !!p.open, requestId: p.body.request_id, context: p.context ?? new Map() });
    if (p.session === 'retaken') T.turns = Math.max(0, T.turns - 1);
    else if (p.open) { T.startedAt = new Date().toISOString(); T.turns = 0; T.resumed = p.session === 'resumed'; }
    T.turns += 1;
    T.startedAt ??= new Date().toISOString();
    let threads = [T, ...this.threads.filter((x) => x !== T)];
    if (p.ended?.length) {
      const gone = new Set(p.ended);
      threads = threads.filter((x) => x === T || !gone.has(x.id));
      this.ended = this.ended.filter((x) => !gone.has(x));
    }
    while (threads.length > this.maxThreads) this.ended.push(threads.pop().id);
    this.threads = threads;
    if (this.ended.length > MAX_ENDED) this.ended = this.ended.slice(-MAX_ENDED);
    if (this.seen) this.seen = { ...this.seen, turn, conversation: p.conversation, last_request: p.body.request_id };
    this.session = { key: T.key, conversation: T.id, startedAt: T.startedAt, turns: T.turns, resumed: !!T.resumed };
    if (p.fresh && this.fresh === p.fresh) this.fresh = null;
    this.error = null;
  }

  /** Keep what a turn did, newest first, for whoever shows it. */
  record(entry) {
    this.turns.unshift({ id: ++this.serialN, at: new Date().toISOString(), ...entry });
    if (this.turns.length > MAX_TURNS) this.turns.length = MAX_TURNS;
    return this.turns[0];
  }

  failed(error) {
    this.error = { code: error?.code ?? 'server_error', message: String(error?.message ?? error), at: new Date().toISOString() };
    return this.error;
  }

  /**
   * One chat request as one memory turn: cut down, sent, remembered - waiting, going again and opening anew as the
   * protocol's retry rules say. Returns the server's response (streamed or not) and the turn's record; throws a
   * MemoryError when the turn could not be sent.
   * @param params - the OpenAI chat request.
   * @param key - the transcript (see rewrite).
   * @param signal - cancels the request (and a wait).
   * @param accept - the Accept header to pass on.
   * @param onWait - as the constructor's, for this request.
   */
  send(params, { key, signal, accept, onWait } = {}) {
    return this.serial(async () => {
      const t0 = Date.now();
      const requestId = this.newRequestId();
      let recover = { requestId };
      let plan = null, waited = 0, mismatches = 0, reopened = 0, lost = 0;
      // turn_in_flight / loading: wait as the server asks, then go again - until busyWaitMs is spent
      const wait = async (error) => {
        const reason = error?.code === 'loading' ? 'loading' : 'busy';
        const ms = Math.max(50, Math.min(Number(error?.retry_after_ms) || 1000, 10_000));
        if (Date.now() - t0 + ms > this.busyWaitMs) {
          throw new MemoryError(reason === 'loading'
            ? `memory server: the model is still loading after ${Math.round((Date.now() - t0) / 1000)} s`
            : `memory server: another conversation is being answered; gave up after ${Math.round((Date.now() - t0) / 1000)} s`,
          { code: reason === 'loading' ? 'loading' : 'turn_in_flight', status: error?.status, reason: error?.reason });
        }
        this.waiting = { reason, since: new Date(t0).toISOString() };
        for (const f of [onWait, this.onWait]) try { f?.({ reason, ms, since: this.waiting.since }); } catch { /* the page's own trouble */ }
        try { await sleep(ms, signal); } finally { this.waiting = null; }
        waited += ms;
        recover = { ...recover, force: true };
      };
      try {
        for (;;) {
          try {
            plan = await this.rewrite(params, key, recover);
          } catch (error) {
            // (the status, or the undo of a repeat, met a turn being answered or a model being loaded)
            if (error?.code === 'turn_in_flight' || error?.code === 'loading') { await wait(error); continue; }
            throw error;
          }
          if (plan.open) recover = { ...recover, openId: plan.conversation };
          let r;
          try {
            r = await this.fetch(this.server + '/v1/memory/input', {
              method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept ?? '*/*', ...this.headers },
              body: JSON.stringify(plan.body), signal });
          } catch (error) {
            if (error?.name === 'AbortError' || signal?.aborted) throw error;
            // a lost response (section 6.3): the status says whether the memory took this request
            if (lost++ >= LOST_TRIES) throw new MemoryError(`memory server: ${error?.message ?? error}`, { code: 'server_down' });
            const st = await this.status(true);
            if (st.last_request === requestId) await this.undoOwn(st.turn);
            recover = { ...recover, force: true };
            continue;
          }
          if (r.ok) {
            // (a browser may not show the header of another origin: the turn then follows from the mode)
            const said = r.headers.get('x-memory-turn');
            const turn = said !== null ? Number(said) : plan.turnBefore + (plan.readOnly ? 0 : 1);
            this.accepted(plan, turn);
            const thread = this.threads[0];
            const entry = this.record({
              turn, mode: plan.readOnly ? 'read_only' : 'update', session: plan.session, conversation: plan.conversation,
              request_id: requestId, streamed: !!params.stream,
              question: plan.question, brain: !!plan.body.brain_append, front: plan.body.brain_append ? plan.body.brain_front : null,
              // (the headers of an answer that is not streamed; a stream's come before anything was picked)
              focus: params.stream ? null : parseFocus(r.headers.get('x-memory-focus')),
              lookups: params.stream ? null : parseBrain(r.headers.get('x-brain-append')),
              windows: null, sources: null, forgot: null, recall: r.headers.get('x-memory-recall'), waited,
              ms: Date.now() - t0, ok: true, done: false });
            // the answer's end: its memory object, the lookup counters and the windows then (the only place a streamed
            // answer has them)
            const response = watched(r, !!params.stream, ({ timings, memory }) => {
              entry.lookups = parseBrain(timings?.memory_brain) ?? entry.lookups;
              entry.windows = parseWindows(timings?.memory_focus);
              if (memory) {
                if (Array.isArray(memory.sources)) entry.sources = memory.sources;
                if (memory.forgot && typeof memory.forgot === 'object') entry.forgot = memory.forgot;
                if (Number.isInteger(memory.turn) && memory.turn !== entry.turn) {
                  entry.turn = memory.turn;
                  if (thread && thread.requestId === requestId) thread.turn = memory.turn;
                }
              }
              entry.done = true;
              entry.ms = Date.now() - t0;
              this.onTurn?.(entry);
            });
            return { response, record: entry };
          }
          const error = errorFrom('memory server', r.status, await r.text());
          this.stale = true;
          if (error.code === 'turn_mismatch' && mismatches++ < MISMATCH_TRIES) {
            // another client took a turn in between - or this very request was taken by an attempt whose answer was
            // lost: then that turn is taken back first. Either way it goes again with the current turn
            if (error.last_request !== undefined && error.last_request !== null && error.last_request === requestId && Number.isInteger(error.turn))
              await this.undoOwn(error.turn);
            recover = { ...recover, force: true };
            continue;
          }
          if (error.code === 'turn_in_flight' || error.code === 'loading') { await wait(error); continue; }
          if (error.code === 'conversation_not_found' && reopened++ < REOPEN_TRIES) {
            // the server does not know the thread's conversation (any more): it goes on as a new conversation
            this.threads = this.threads.filter((T) => T !== plan.thread);
            this.log(`memory: conversation ${plan.conversation} is not known to the server: it opens again`);
            recover = { ...recover, force: true, openId: undefined };
            continue;
          }
          if (error.code === 'conversation_exists' && !recover.newId) {
            recover = { ...recover, force: true, newId: true, openId: undefined };
            continue;
          }
          throw error;
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        // (on a frozen memory the status is read again before the next turn)
        this.stale = true;
        if (error?.code === 'server_down') this.seen = null;
        const e = this.failed(error);
        this.record({ turn: plan?.turnBefore ?? this.seen?.turn ?? null, mode: plan ? (plan.readOnly ? 'read_only' : 'update') : null,
          session: plan?.session ?? null, conversation: plan?.conversation ?? null, request_id: requestId, streamed: !!params?.stream,
          question: plan?.question ?? '', brain: !!this.brain.enabled, front: null, focus: null, lookups: null, windows: null,
          sources: null, forgot: null, recall: null, waited, ms: Date.now() - t0, ok: false, done: true,
          error: { code: e.code, message: e.message } });
        throw error;
      }
    });
  }

  // the memory took this request in an attempt whose answer was lost: take that turn back before it goes again. When
  // the server cannot (the memory changed since), the request goes as a new turn (undoRefusedAsNewTurn) or fails
  async undoOwn(turn) {
    try {
      await this.undo(turn);
      this.log(`memory: took back turn ${turn} (its answer was lost; the request goes again)`);
    } catch (error) {
      if (!this.undoRefusedAsNewTurn || (error?.code !== 'nothing_to_undo' && error?.code !== 'turn_mismatch')) throw error;
      this.log('memory: a turn whose answer was lost cannot be taken back: the request goes as a new turn');
    }
  }

  /** What a page shows: the server as last seen, the brain settings in effect, the conversations, the last turns. */
  state() {
    return {
      server: this.server,
      mode: this.seen?.mode ?? null, turn: this.seen?.turn ?? null, memory: this.seen?.memory ?? null, seen_at: this.seen?.at ?? null,
      name: this.seen?.name ?? null, forgetting: this.seen?.forgetting ?? null, instance: this.seen?.instance ?? null,
      brain: { enabled: !!this.brain.enabled, front: this.request().front, focus_k: this.request().focusK, focus_every: this.request().focusEvery,
        persona_chars: (this.brain.persona ?? '').length, system_from: this.brain.systemFrom },
      session: this.session ? { ...this.session } : null,
      conversations: this.threads.map((T) => ({ id: T.id, key: T.key ?? null, turns: T.turns, started_at: T.startedAt })),
      waiting: this.waiting ? { ...this.waiting } : null,
      turns: this.turns.slice(),
      error: this.error,
    };
  }
}
