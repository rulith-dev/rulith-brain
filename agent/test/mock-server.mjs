// A stand-in for Rulith Brain's memory server, for trying the agent and the app's Brain page without a model:
//   node test/mock-server.mjs [port] [log.jsonl] [--readonly] [--turn N] [--parallel N] [--no-focus] [--off] [--slow ms]
//                             [--licence trial|10M|50M|200M|unlimited|none|ended|device] [--device-max N] [--loading ms]
//                             [--no-forget] [--idle s]
// It speaks the Rulith Memory Protocol 1.0 (rulith-brain/protocol/rulith-memory-protocol.md) as strictly as the spec
// says, and passes its conformance suite (rulith-brain/protocol/conformance/run.mjs) in both modes:
//   - GET /v1/memory/status: protocol, features, instance (new at every start), mode, turn, busy (a streamed answer is
//     being sent), last_request, conversation, conversations [{id, turns, tools, idle_s}], conversation_idle_s (--idle,
//     600), tokens, capacity (null), and the server's own fields (memory counters, recall, licence);
//   - POST /v1/memory/input: previous_turn required and checked; errors come before any change, as the protocol's
//     error object {error: {code, type, reason, message, ...}}; while a streamed answer is sent, other turns and undo
//     get turn_in_flight (retry_after_ms); turn_mismatch carries turn and last_request; conversations (ids of
//     A-Z a-z 0-9 . _ : -, 1-64): an opening turn (conversation_open) fixes the conversation's system messages and
//     tools, later turns send neither (identical tools are tolerated, others are tools_fixed), conversation_not_found
//     / conversation_exists (an id whose opening turn was taken back opens again); a request without conversation is
//     the default conversation (system and tools only on the memory's first turn); end_conversations; and
//     forget_conversations on an opening turn (feature forget_conversations; --no-forget drops it, and the field is
//     then refused as unsupported): what conversations added is forgotten unless another conversation took a turn
//     within conversation_idle_s and was not ended - the answer says forgot {done, tokens} or {done: false, reason};
//   - the answer: the X-Memory-Turn header and a memory object {turn, conversation, request_id, sources, forgot} in
//     the body, or with a stream in its last chunk; sources are window numbers (POST /v1/memory/sources resolves up
//     to 64);
//   - update mode: every turn adds one to the memory's turn; POST /v1/memory/undo {turn} takes the last one back,
//     once, and not after the memory changed otherwise (a learning run: nothing_to_undo until the next turn, as the
//     server); a conversation whose opening turn was taken back stays known with no turns;
//   - read_only mode (--readonly): the turn never changes; one conversation is held at a time - opening another, or a
//     turn without conversation (a single question, nothing kept), ends it; undo, learn, save are refused (read_only);
//   - brain mode ("brain_append"): one slot only (--parallel), refused without the focus tables (--no-focus), up to
//     256 windows, the X-Memory-Focus header (the windows picked) and X-Brain-Append on answers that are not streamed
//     only, and with the answer's last part timings.memory_brain (the lookup counters) and timings.memory_focus (the
//     windows as the turn ended);
//   - /v1/memory/windows: the label and source text of up to 64 windows;
//   - the learn queue: POST /v1/memory/learn {items: [{name, text}]} answers {ids}, GET /v1/memory/learn the items, all
//     read at once ("done");
//   - --licence trial|10M|50M|200M|unlimited|none|ended|device: a release runtime's licence check at the start
//     (brain-licence.h). One it accepts is reported by /v1/memory/status as `licence` (ok, kind, tier, capacity,
//     trial_days_left, device, error, device_max, placeholder); one it does not, or a memory larger than the tier, ends
//     the start as the release runtime does: "Rulith Brain: <why> - the memory is not loaded" and exit code 3.
//     Without --licence there is no `licence` in the status (a server from before the licence). --device-max N: what
//     the status says this device could hold (default 200000000; 0 = not known).
//   - status.recall: how the memory's folder says a turn recalls (kv, 12 windows, every step: startMock's `recall`;
//     null = an older server without it);
//   - --loading ms (startMock's `loading`: true until state.loading is set false): the server loading its model -
//     every /v1/ route and /health answer 503 loading;
//   - --slow ms: a pause between the chunks of a streamed answer (10 on the command line: a turn sent meanwhile meets
//     turn_in_flight, as on the server; 0 in startMock unless asked);
//   - CORS for a page of another origin, with the X-Memory-* headers exposed (Access-Control-Expose-Headers), as
//     the protocol asks of a server that allows such pages (brain-core still follows the turn from the mode, and
//     from the memory object, where a page cannot read them).
// The answer says what the "model" has in front of it in its conversation, so a test can tell a held conversation
// from a new one. Every event is appended to the log; startMock() returns the same things to a test in the same process.
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE_TOKENS = 10_000_000;   // what the frozen memory holds
const WINDOW_LIMIT = 32768;
const DEVICE = '3f9a0c27d1e84b6a9c5d2e7f10ab4c8d';
// the tiers' caps (brain-licence.h tier_cap: the measure plus 6%; null: no limit)
const TIER_CAP = { '10M': 10_600_000, '50M': 53_000_000, '200M': 212_000_000, unlimited: null };
export const FEATURES = ['undo', 'conversations', 'forget_conversations', 'sources', 'save', 'learn'];
// the headers a page of another origin may read
export const EXPOSED = 'X-Memory-Turn, X-Memory-Focus, X-Memory-Recall, X-Brain-Append';
const ID = /^[A-Za-z0-9._:-]{1,64}$/;
const ERROR_TYPES = { 400: 'invalid_request_error', 404: 'not_found_error', 409: 'conflict_error', 500: 'server_error',
  501: 'not_supported_error', 503: 'unavailable_error' };

/** The protocol's error object. */
export const protocolError = (code, reason, message, extra = {}) => ({ error: { code, type: ERROR_TYPES[code] ?? 'server_error', reason, message, ...extra } });

/** The licence a release runtime found at its start: { licence } it reports, or { refusal } it stops with. */
export function licenceCheck(kind, { memoryTokens = 0, deviceMax = 200_000_000, file = 'C:/Users/me/AppData/Local/Rulith/Brain/licence.txt' } = {}) {
  const report = { device: DEVICE, device_max: deviceMax, placeholder: false };
  if (kind === 'trial') return { licence: { ok: true, kind: 'trial', tier: 'trial', capacity: null, trial_days_left: 23, error: '', ...report } };
  if (kind in TIER_CAP) {
    const cap = TIER_CAP[kind];
    if (cap !== null && memoryTokens > cap) return { refusal: `this memory holds ${memoryTokens} tokens, the ${kind} licence allows ${cap}` };
    return { licence: { ok: true, kind: 'paid', tier: kind, capacity: cap, trial_days_left: null, error: '', ...report } };
  }
  const why = { none: 'no licence', ended: 'trial ended', device: 'licence is for another device' }[kind];
  if (!why) throw new Error('--licence: trial, 10M, 50M, 200M, unlimited, none, ended or device');
  return { refusal: `${why} (${file})` };
}

// a conversation: its own instructions and tools, and what its turns brought (for the answer to say)
const newConversation = (id, system = [], tools = null) => ({ id, system, tools, turns: 0, lastAt: 0, heard: [], tokens: 0 });
const copyConversation = (c) => ({ ...c, system: [...c.system], heard: [...c.heard] });

export function startMock({ port = 8099, logFile, readonly = false, turn = readonly ? 412 : 0, parallel = 1, focus = true,
  off = false, slow = 0, licence = null, deviceMax = 200_000_000, recall = { front: 'kv', focus_k: 12, focus_every: 16 }, loading = false,
  features = FEATURES, idleS = 600 } = {}) {
  // the licence first, as the runtime checks it before it loads anything
  const checked = licence && !off ? licenceCheck(licence, { memoryTokens: readonly ? BASE_TOKENS : turn * 400, deviceMax }) : null;
  if (checked?.refusal) {
    const e = new Error(`Rulith Brain: ${checked.refusal} - the memory is not loaded`);
    e.exitCode = 3;
    throw e;
  }
  const state = { turn, readonly, instance: `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    // (a frozen memory lists none of the parts that change it: the real server's features, and the spec's section 8)
    features: features.filter((f) => !readonly || !['undo', 'save', 'learn', 'forget_conversations', 'documents'].includes(f)), idleS,
    // the default conversation (no id): its system messages and tools come with the memory's first turn
    base: newConversation(null),
    conversations: new Map(),   // update mode: every conversation the server knows; read_only: the one it holds
    lastRequest: null, lastConversation: null, inFlight: false, undo: null, readSinceTurn: false,
    restores: 0, forgets: 0, learned: [], learnId: 1, brainTurn: false, ended: null,
    loading: loading === true || (typeof loading === 'number' && loading > 0) };
  if (typeof loading === 'number' && loading > 0) setTimeout(() => { state.loading = false; }, loading).unref?.();
  const events = [];
  const note = (e) => { events.push(e); if (logFile) fs.appendFileSync(logFile, JSON.stringify(e) + '\n'); };
  const has = (f) => state.features.includes(f);
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const refuse = (res, code, reason, message, extra) => send(res, code, protocolError(code, reason, message, extra));
  const mismatch = (res, what, said) => refuse(res, 409, 'turn_mismatch', `${what} is ${said}, the memory is at turn ${state.turn}`,
    { turn: state.turn, last_request: state.lastRequest });
  const words = (text) => String(text ?? '').split(/\s+/).filter(Boolean).length;
  const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '';
  const idleOf = (c) => (c.lastAt ? Math.floor((Date.now() - c.lastAt) / 1000) : null);
  // the windows a question "recalls": fixed by its text, so a test can name them
  const windowsOf = (text, k) => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
    const ids = [];
    for (let i = 0; i < k; i++) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; ids.push(h % Math.floor(BASE_TOKENS / 256)); }
    return ids.sort((a, b) => a - b);
  };
  // what the memory holds in tokens: the frozen base, or 400 a turn
  const heldTokens = () => {
    const live = [...state.conversations.values()].reduce((n, c) => n + c.tokens, 0) + state.base.tokens;
    return state.readonly ? BASE_TOKENS + live : state.turn * 400;
  };
  const endHeld = (why) => {
    if (!state.readonly || !state.conversations.size) return;
    state.conversations.clear();
    state.restores += 1;
    note({ restore: why });
  };

  // a page of another origin may ask (the app's browser preview): every answer says so, and lets it read the
  // X-Memory-* headers (section 2 of the protocol)
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': EXPOSED };
  const N_WINDOWS = Math.floor(BASE_TOKENS / 256);
  const labelOf = (w) => `Mock Library / Book ${Math.floor(w / 2000) + 1} / Section ${Math.floor(w / 40) % 50 + 1}`;
  const sourceText = (w) => `Source text of window ${w}: ` + Array.from({ length: 60 }, (_, i) => `word${(w * 7 + i) % 97}`).join(' ');

  function status(res) {
    note({ status: true });
    if (off) return send(res, 200, { memory_mode: false, mode: 'update', turn: 0, raw_log_tokens: 0, memory_dir: '' });
    const live = state.readonly ? [...state.conversations.values()].reduce((n, c) => n + c.tokens, 0) : Math.min(WINDOW_LIMIT, state.turn * 400);
    const sealed = state.readonly ? BASE_TOKENS : Math.max(0, state.turn * 400 - WINDOW_LIMIT);
    return send(res, 200, {
      protocol: { name: 'rulith-memory', version: '1.0' }, features: state.features, instance: state.instance,
      memory_mode: true, mode: state.readonly ? 'read_only' : 'update', turn: state.turn, busy: state.inFlight,
      last_request: state.lastRequest, conversation: state.lastConversation,
      conversations: [...state.conversations.values()].map((c) => ({ id: c.id, turns: c.turns, tools: c.tools?.length ?? 0, idle_s: idleOf(c) ?? 0 })),
      conversation_idle_s: state.idleS, tokens: heldTokens(), capacity: null,
      raw_log_tokens: sealed + live, memory_dir: 'mock', reserve: 0,
      memory: { sealing: true, read_only: state.readonly, window_tokens: live, window_limit: WINDOW_LIMIT,
        sealed_tokens: sealed, retained_tokens: sealed + live, archive_bytes: sealed * 9000, index_bytes: sealed * 40,
        slot_tokens: live, restores: state.restores }, ...(recall ? { recall } : {}), ...(checked ? { licence: checked.licence } : {}) });
  }

  function undo(res, body) {
    if (off) return refuse(res, 501, 'unsupported', 'memory mode is off');
    if (state.readonly) return refuse(res, 409, 'read_only', 'memory mode is read-only: nothing to undo');
    if (!has('undo')) return refuse(res, 501, 'unsupported', 'this server does not take turns back');
    if (state.inFlight) return refuse(res, 409, 'turn_in_flight', 'a turn is being answered', { retry_after_ms: 300 });
    if (!Number.isInteger(body?.turn)) return refuse(res, 400, 'invalid_request', '"turn": the memory\'s turn, to take back');
    if (body.turn !== state.turn) return mismatch(res, 'turn', body.turn);
    if (!state.undo || state.readSinceTurn) return refuse(res, 409, 'nothing_to_undo', 'memory mode: nothing to undo (one turn back, once, and not after the memory changed)');
    const u = state.undo;
    state.undo = null;
    state.turn = u.turn;
    state.lastRequest = u.lastRequest;
    state.lastConversation = u.lastConversation;
    state.base = u.base;
    state.conversations = u.conversations;
    // a conversation whose opening turn was taken back stays known, with no turns: it may be opened again
    if (u.opened) state.conversations.set(u.opened.id, { ...u.opened, turns: 0, heard: [], tokens: 0 });
    note({ undo: true, turn: state.turn });
    return send(res, 200, { turn: state.turn });
  }

  function sources(res, body) {
    if (!has('sources')) return refuse(res, 501, 'unsupported', 'this server does not name sources');
    const ids = body?.ids;
    if (!Array.isArray(ids) || ids.length > 64) return refuse(res, 400, 'invalid_request', '"ids": an array of at most 64 source ids');
    note({ sources: ids });
    return send(res, 200, { sources: ids.filter((w) => Number.isInteger(w) && w >= 0 && w < N_WINDOWS)
      .map((w) => ({ id: w, label: labelOf(w), text: sourceText(w) })) });
  }

  // the checks of a turn, in order; a refusal changes nothing. Returns the refusal, or what the turn is
  function check(body) {
    const no = (code, reason, message, extra) => ({ refuse: [code, reason, message, extra] });
    if (state.inFlight) return no(409, 'turn_in_flight', 'a turn is being answered: send it again when it is done', { retry_after_ms: 300 });
    if (!Number.isInteger(body.previous_turn)) return no(400, 'invalid_request', 'previous_turn: the memory\'s turn as the client last saw it (an integer) is required');
    const conv = body.conversation;
    if (conv !== undefined && (typeof conv !== 'string' || !ID.test(conv)))
      return no(400, 'invalid_request', 'conversation: 1 to 64 characters of A-Z a-z 0-9 . _ : -');
    if (body.conversation_open !== undefined && typeof body.conversation_open !== 'boolean') return no(400, 'invalid_request', 'conversation_open: true or false');
    const open = body.conversation_open === true;
    if (open && conv === undefined) return no(400, 'invalid_request', 'conversation_open needs a conversation');
    if (open && !has('conversations')) return no(501, 'unsupported', 'this server serves the default conversation only');
    if (body.request_id !== undefined && (typeof body.request_id !== 'string' || body.request_id.length > 128))
      return no(400, 'invalid_request', 'request_id: a string of at most 128 characters');
    if (body.end_conversations !== undefined && (!Array.isArray(body.end_conversations) || !body.end_conversations.every((x) => typeof x === 'string')))
      return no(400, 'invalid_request', 'end_conversations: an array of conversation ids');
    if (body.forget_conversations !== undefined) {
      if (!has('forget_conversations')) return no(501, 'unsupported', 'this server does not forget conversations');
      if (typeof body.forget_conversations !== 'boolean') return no(400, 'invalid_request', 'forget_conversations: true or false');
      if (body.forget_conversations && !open) return no(400, 'invalid_request', 'forget_conversations goes only with a turn that opens a conversation');
    }
    if (!Array.isArray(body.messages) || !body.messages.length) return no(400, 'invalid_request', "messages: the turn's new messages");
    // the default conversation takes system messages and tools on the memory's first turn only
    const first = conv === undefined && !state.readonly && state.turn === 0;
    const sys = [], rest = [];
    for (const m of body.messages) {
      if (!m || typeof m !== 'object') return no(400, 'invalid_request', 'a message is an object');
      if (m.role === 'system' || m.role === 'developer') {
        if (!(open || first) || rest.length) return no(400, 'invalid_request', 'system messages come only with the turn that opens a conversation, before its other messages');
        sys.push(m);
      } else if (m.role === 'assistant') {
        return no(400, 'invalid_request', "the memory keeps its answers itself: send only user and tool messages");
      } else if (m.role === 'user' || m.role === 'tool') rest.push(m);
      else return no(400, 'invalid_request', `a message's role: user, tool, or system on an opening turn (not ${m.role})`);
    }
    const asks = rest.some((m) => m.role === 'user');
    if (!rest.length) return no(400, 'invalid_request', 'a turn needs a user or tool message');
    if ((open || first) && !asks) return no(400, 'invalid_request', 'the first turn of a conversation needs a user message');
    if (body.tools !== undefined && body.tools !== null && !Array.isArray(body.tools)) return no(400, 'invalid_request', 'tools: an array');
    // brain mode, the server's own fields
    const brain = body.brain_append === true;
    if (body.brain_auto_eval && !brain) return no(501, 'unsupported', 'brain trials require brain_append');
    if (body.brain_front !== undefined && body.brain_front !== 'kv' && body.brain_front !== 'text') return no(400, 'invalid_request', 'brain_front: kv or text');
    if (brain && parallel > 1) return no(501, 'unsupported', 'brain append: one slot only (start the server with --parallel 1)');
    if (brain) {
      if (!focus || (asks && (body.focus_k ?? 8) <= 0)) return no(400, 'invalid_request', 'brain append requires LLAMA_QSA_SEAL_FOCUS>=512 and focus_k>0');
      if (!asks && !state.brainTurn) return no(400, 'invalid_request', 'brain append tool continuation needs a preceding brain user turn');
    }
    // the memory's turn
    if (body.previous_turn !== state.turn) return { refuse: [409, 'turn_mismatch', `previous_turn is ${body.previous_turn}, the memory is at turn ${state.turn}`,
      { turn: state.turn, last_request: state.lastRequest }] };
    if (state.readonly && body.forget_conversations) return no(409, 'read_only', 'memory mode is read-only: nothing is forgotten');
    // the conversation
    const tools = Array.isArray(body.tools) ? body.tools : null;
    const known = conv === undefined ? state.base : state.conversations.get(conv);
    if (open) {
      if (known && known.turns > 0) return no(409, 'conversation_exists', `conversation ${conv} has turns: open another id`);
    } else if (conv !== undefined) {
      if (!known) return no(409, 'conversation_not_found', `conversation ${conv} is not known: open a new one`);
    }
    if (!open && !first && tools !== null && JSON.stringify(tools) !== JSON.stringify(known?.tools ?? null))
      return no(400, 'tools_fixed', 'the tools are fixed when the conversation opens');
    return { conv, open, first, sys, rest, asks, brain, tools };
  }

  async function input(req, res, body) {
    const c = check(body);
    if (c.refuse) return refuse(res, ...c.refuse);
    const { conv, open, first, sys, rest, asks, brain, tools } = c;
    // ---- the turn is taken
    let forgot;
    if (body.forget_conversations === true) {
      // another conversation in progress (it took a turn lately and is not ended here) keeps everything. The default
      // conversation - turns without an id - does not count: it cannot be ended (the spec's section 5.5)
      const ending = new Set(body.end_conversations ?? []);
      const others = [...state.conversations.values()].filter((x) => x.id !== conv && !ending.has(x.id) && x.turns > 0
        && idleOf(x) !== null && idleOf(x) < state.idleS);
      if (others.length) forgot = { done: false, reason: 'conversation_in_progress' };
      else {
        const tokens = [...state.conversations.values(), state.base].reduce((n, x) => n + x.tokens, 0);
        state.conversations.clear();
        state.base = newConversation(null, state.base.system, state.base.tools);
        state.forgets += 1;
        forgot = { done: true, tokens };
        note({ forgot: tokens });
      }
    }
    if (!state.readonly) {
      // the one turn that can be taken back: how the memory was before it
      state.undo = { turn: state.turn, lastRequest: state.lastRequest, lastConversation: state.lastConversation,
        base: copyConversation(state.base), conversations: new Map([...state.conversations].map(([k, v]) => [k, copyConversation(v)])), opened: null };
    }
    let C;
    if (conv === undefined) {
      if (state.readonly) { endHeld('a single question'); C = newConversation(null); }
      else {
        if (first) { state.base.system = sys; state.base.tools = tools; }
        C = state.base;
      }
    } else if (open) {
      if (state.readonly) endHeld('another conversation');
      C = newConversation(conv, sys, tools);
      state.conversations.set(conv, C);
      if (state.undo) state.undo.opened = { id: conv, system: sys, tools, lastAt: 0 };
    } else C = state.conversations.get(conv);
    if (!state.readonly) {
      state.turn += 1;
      state.readSinceTurn = false;
    }
    for (const id of body.end_conversations ?? []) if (id !== conv) state.conversations.delete(id);
    state.lastRequest = body.request_id ?? null;
    state.lastConversation = conv ?? null;
    C.turns += 1;
    C.lastAt = Date.now();
    const asked = rest.filter((m) => m.role === 'user').map((m) => textOf(m.content));
    C.heard.push(...asked);
    C.tokens += words(sys.map((m) => textOf(m.content)).join(' ')) + rest.reduce((n, m) => n + words(textOf(m.content)), 0) + 12;
    if (asks) state.brainTurn = brain;
    const question = asked.join('\n');
    note({ turn: state.turn, body, conversation: conv ?? null, conversation_turns: C.turns, fronts: C.system.length });
    const headers = { 'X-Memory-Turn': String(state.turn) };
    const lookups = brain && /\blookup\b/i.test(question) ? 1 : 0;
    let ids = windowsOf(question || 'tool', 4);
    if (brain && asks) {
      const k = Math.max(1, Math.min(256, body.focus_k ?? 8));
      ids = windowsOf(question, k);
      const text = (body.brain_front ?? 'text') === 'text';
      // as the answer is written: a lookup's window is appended (text front), a scan step brings windows in (KV)
      state.ended = { front: ids, text: text ? ids.slice(0, 8) : [], appended: lookups ? [(ids[0] + 3) % N_WINDOWS] : [],
        kv_added: text ? [] : [(ids[0] + 1) % N_WINDOWS, (ids[0] + 2) % N_WINDOWS] };
      // (a stream's headers leave before the windows are picked: the real server has none there)
      if (!body.stream) headers['X-Memory-Focus'] = `${k} windows (${ids.join(',')}); continuous, a scan every ${body.focus_every ?? 128} steps: 3 scans, 0 rotations; first (${ids.join(',')}); ever ${k} (${ids.join(',')}); entered (); 96 steps; 5120 votes; 1.20 ms`;
    }
    const counters = `lookups=${lookups}; input_tokens=${lookups * 1951}; proposals=0; front_frozen=1; trials=0; restored=0; accepted=0; kv_added=${state.ended?.kv_added.length ?? 0}`;
    if (brain && !body.stream) headers['X-Brain-Append'] = counters;
    const timings = { prompt_n: 10, predicted_n: 10, predicted_per_second: 30 };
    if (brain && state.ended) {
      const list = (name) => `${name}=${state.ended[name].join(',')}`;
      timings.memory_brain = counters;
      timings.memory_focus = ['front', 'text', 'appended', 'kv_added'].map(list).join('; ');
    }
    const memory = { turn: state.turn, conversation: conv ?? null, request_id: body.request_id ?? null,
      ...(has('sources') ? { sources: [...new Set([...ids.slice(0, 8), ...(state.ended?.kv_added ?? [])])].slice(0, 12) } : {}),
      ...(forgot ? { forgot } : {}) };
    const roles = rest.map((m) => m.role).join(',');
    const front = C.system.map((m) => textOf(m.content));
    const text = `Mock answer for memory turn ${state.turn} (received: ${roles}; conversation turn ${C.turns}; `
      + `fronts ${front.length}${brain ? '; brain ' + (body.brain_front ?? 'kv') : ''}${!open && conv !== undefined ? '; kept' : ''}).`
      // what the "model" has in front of it in this conversation: its front, then what the user said
      + ` In this conversation: ${[...front, ...C.heard].join(' | ').slice(0, 600)}`;
    const id = `chatcmpl-mock-${state.turn}-${C.turns}`;
    if (!body.stream) {
      return send(res, 200, { id, object: 'chat.completion', model: 'mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }, timings, memory }, headers);
    }
    // one turn at a time: while the answer is sent, other turns and undo are refused (turn_in_flight)
    state.inFlight = true;
    let gone = false;
    res.on('close', () => { gone = true; state.inFlight = false; });
    try {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers });
      const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'mock-model',
        choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      chunk({ role: 'assistant', content: '' });
      // a tool call on request, for trying a client's tools without a model: the message
      //   call web_search {"queries": ["Zen 5"]}
      // is answered with that call when the conversation has a tool of that name
      const want = /^\s*call\s+([A-Za-z0-9_.-]+)\s+(\{[\s\S]*\})\s*$/.exec(question ?? '');
      const has = (C.tools ?? []).some((t) => (t?.function?.name ?? t?.name) === want?.[1]);
      if (want && has) {
        chunk({ tool_calls: [{ index: 0, id: `call_mock_${state.turn}_${C.turns}`, type: 'function', function: { name: want[1], arguments: want[2] } }] });
        chunk({}, 'tool_calls');
      } else {
        for (const w of text.split(' ')) {
          if (slow) await new Promise((r) => setTimeout(r, slow));
          if (gone) return;
          chunk({ content: w + ' ' });
        }
        chunk({}, 'stop');
      }
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'mock-model', choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }, timings, memory })}\n\n`);
      res.end('data: [DONE]\n\n');
    } finally {
      state.inFlight = false;
    }
  }

  const server = http.createServer((req, res) => {
    const writeHead = res.writeHead.bind(res);
    res.writeHead = (code, headers = {}) => writeHead(code, { ...CORS, ...headers });
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname;
      if (state.loading && (path === '/health' || path.startsWith('/v1/')))
        return refuse(res, 503, 'loading', 'Loading model', { retry_after_ms: 1000 });
      if (path === '/health') return send(res, 200, { status: 'ok' });
      if (path === '/v1/models') return send(res, 200, { object: 'list', data: [{ id: 'mock-model', object: 'model' }] });
      if (path === '/v1/memory/status') return status(res);
      if (path === '/slots') return send(res, 200, [{ id: 0, is_processing: state.inFlight, n_prompt_tokens: heldTokens() }]);
      let body = {};
      if (req.method === 'POST') {
        try { body = JSON.parse(raw || '{}'); } catch { return refuse(res, 400, 'invalid_request', 'the body is not JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(res, 400, 'invalid_request', 'the body is a JSON object');
      }
      if (off && path.startsWith('/v1/memory/')) return refuse(res, 501, 'unsupported', 'memory mode is off (start the server with --memory-mode)');
      if (path === '/v1/memory/windows') {
        const asked = body.windows;
        if (!Array.isArray(asked)) return refuse(res, 400, 'invalid_request', '"windows": an array of window numbers');
        note({ windows: asked });
        const windows = asked.filter((w) => Number.isInteger(w) && w >= 0 && w < N_WINDOWS).slice(0, 64).map((w) => ({
          window: w, token_start: 256 * w, token_end: 256 * w + 512, label: labelOf(w), text: sourceText(w) }));
        return send(res, 200, { windows });
      }
      if (path === '/v1/memory/sources' && req.method === 'POST') return sources(res, body);
      if (path === '/v1/memory/save' && req.method === 'POST') {
        if (state.readonly) return refuse(res, 409, 'read_only', 'memory mode is read-only: nothing is saved');
        note({ save: true, turn: state.turn });
        return send(res, 200, { turn: state.turn, saved: true });
      }
      if (path === '/v1/memory/learn') {
        if (req.method === 'GET') {
          return send(res, 200, { learner: { state: 'idle', queue: 0, tokens_done: 0, tokens_total: 0, tokens_per_s: 0, current: null,
            tokens_read: state.learned.reduce((n, e) => n + e.tokens, 0), settling: false, forgotten_documents: 0, forgotten_tokens: 0 },
          items: state.learned.map((e) => ({ id: e.id, name: e.name, state: 'done', tokens_done: e.tokens, tokens_total: e.tokens,
            tokens_per_s: null, added_at: e.added_at, error: null, read: null })),
          mode: state.readonly ? 'read_only' : 'update', reads: ['fast'], read_default: 'fast' });
        }
        if (state.readonly) return refuse(res, 409, 'read_only', 'memory mode is read-only: this memory cannot learn');
        if (!Array.isArray(body.items)) return refuse(res, 400, 'invalid_request', '"items" must be an array of {name, text}');
        const ids = body.items.map((it) => {
          const id = String(state.learnId++);
          const text = String(it?.text ?? '');
          state.learned.push({ id, name: String(it?.name ?? `document ${id}`), text, tokens: Math.ceil(text.length / 4), added_at: Math.floor(Date.now() / 1000) });
          return id;
        });
        // a learning run changes the memory: the last turn cannot be taken back any more
        state.readSinceTurn = true;
        note({ learn: body.items.map((it) => ({ name: it?.name, text: it?.text })) });
        return send(res, 200, { ids });
      }
      if (path === '/v1/memory/undo' && req.method === 'POST') return undo(res, body);
      if ((path === '/v1/memory/chat/completions' || path === '/v1/memory/input') && req.method === 'POST') return input(req, res, body);
      return refuse(res, 404, 'not_found', `no route ${req.method} ${path}`);
    });
  });
  const ready = new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
  return { server, state, events, ready };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const value = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
  const readonly = flag('--readonly'), noFocus = flag('--no-focus'), off = flag('--off'), noForget = flag('--no-forget');
  const turn = value('--turn'), parallel = Number(value('--parallel', 1)), slow = Number(value('--slow', 10));
  const licence = value('--licence', null), deviceMax = Number(value('--device-max', 200_000_000)), loading = Number(value('--loading', 0));
  const idleS = Number(value('--idle', 600));
  const port = Number(args[0] || 8099);
  const logFile = args[1] || 'mock-turns.jsonl';
  let mock;
  try {
    mock = startMock({ port, logFile, readonly, parallel, focus: !noFocus, off, slow, licence, deviceMax, loading, idleS,
      features: noForget ? FEATURES.filter((f) => f !== 'forget_conversations') : FEATURES,
      ...(turn !== undefined ? { turn: Number(turn) } : {}) });
  } catch (e) {
    console.error(e.message);
    process.exit(e.exitCode ?? 1);
  }
  mock.ready.then((p) => console.log(`mock memory server on http://127.0.0.1:${p} (${off ? 'memory mode off' : readonly ? 'read-only' : 'update'}`
    + `${licence ? `, licence ${licence}` : ''}), log ${logFile}`));
}
