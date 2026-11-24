#!/usr/bin/env node
// Conformance tests for Rulith Memory Protocol 1.0 (../rulith-memory-protocol.md), its sections 2 to 4.
//
//   node run-1.0.mjs --server http://127.0.0.1:8091 [--key <api key>] [--max-tokens 24] [--timeout 180]
//
// Uses GET /v1/brain/models and POST /v1/brain/chat/completions for the protocol; section 3 sends whole lists
// to POST /v1/chat/completions.
// Everything it says is kept - the memory hears about twenty short requests ("Reply with the single word ok.", a code
// word, a long note, a count to sixty): run it against a memory you may add to. What the answers say depends on the
// model: it is reported as INFO, never checked. --destructive and --learn are accepted and have no effect. One line
// per check; exit code 0 when all passed. Node 18 or later, nothing to install. MIT licence.

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const SERVER = String(opt('server', 'http://127.0.0.1:8091')).replace(/\/+$/, '');
const KEY = opt('key', process.env.RULITH_MEMORY_KEY || '');
const MAX_TOKENS = Number(opt('max-tokens', 24));
const TIMEOUT_MS = Number(opt('timeout', 180)) * 1000;

const NATIVE = '/v1/brain/chat/completions';
const COMPATIBLE = '/v1/chat/completions';
const REASONS = new Set(['invalid_request', 'too_large', 'busy', 'loading', 'unavailable', 'server_error']);

let passed = 0;
let failed = 0;
const say = (kind, text) => console.log(`${kind} ${text}`);
function check(ok, text, detail) {
  if (ok) {
    passed += 1;
    say('PASS', text);
  } else {
    failed += 1;
    say('FAIL', `${text}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
  return ok;
}
const info = (text) => say('INFO', text);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quote = (s) => JSON.stringify(String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80));
// this run's own words: what an earlier run said is not taken for this one's
const TAG = Math.random().toString(36).slice(2, 8);

async function http(method, path, body, { raw } = {}) {
  const headers = {};
  if (KEY) headers.Authorization = `Bearer ${KEY}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SERVER + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}
const what = (r) => r.json || (r.text || '').slice(0, 300);

// an error response of the protocol's shape with this reason and status (section 4)
function isError(r, reason, status) {
  const e = r.json && r.json.error;
  return !!e && r.status === status && e.code === status && e.reason === reason && typeof e.message === 'string' &&
    typeof e.type === 'string';
}
const shapeOf = (e, status) => !!e && e.code === status && typeof e.type === 'string' && REASONS.has(e.reason) && typeof e.message === 'string';

// what the answers carry beyond 1.0, and every usage reported (for the cached_tokens check)
const extras = new Set();
const usages = [];
const streamErrors = [];
function noted(json, headers) {
  if (json?.usage) usages.push(json.usage);
  if (json && typeof json === 'object' && 'memory' in json) extras.add('a memory object');
  for (const [k] of headers ?? []) if (k.toLowerCase().startsWith('x-memory-')) extras.add(`the header ${k}`);
}

// a chat completion of the common format (section 2.2)
function isCompletion(j) {
  const c = j && Array.isArray(j.choices) && j.choices[0];
  const m = c && c.message;
  return !!m && m.role === 'assistant' && (typeof m.content === 'string' || Array.isArray(m.tool_calls)) &&
    typeof c.finish_reason === 'string';
}

// a request not streamed: { status, json, text, headers, message }
async function post(body, path = NATIVE) {
  const r = await http('POST', path, { max_tokens: MAX_TOKENS, reasoning_effort: 'low', ...body });
  if (r.status === 200) noted(r.json, r.headers);
  return { ...r, message: r.json?.choices?.[0]?.message };
}
const user = (content) => ({ role: 'user', content });

// a streamed request, read to its end: { status, type, chunks, done ([DONE] seen), error, content, reasoning, finish, usage }
async function stream(body, { onFirst, onChunk } = {}) {
  const res = await http('POST', NATIVE, { max_tokens: MAX_TOKENS, reasoning_effort: 'low', ...body, stream: true,
    stream_options: { include_usage: true } }, { raw: true });
  if (res.status !== 200) {
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, json, text, chunks: [] };
  }
  const out = { status: 200, type: res.headers.get('content-type') || '', chunks: [], done: false, error: null, content: '',
    reasoning: '', finish: null, usage: null };
  let buf = '';
  const dec = new TextDecoder();
  for await (const part of res.body) {
    buf = (buf + dec.decode(part, { stream: true })).replace(/\r/g, '');
    for (let at = buf.indexOf('\n\n'); at >= 0; at = buf.indexOf('\n\n')) {
      const ev = buf.slice(0, at);
      buf = buf.slice(at + 2);
      for (const line of ev.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { out.done = true; continue; }
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        out.chunks.push(j);
        if (j.error) { out.error = j.error; streamErrors.push(j.error); }
        if (j.usage) out.usage = j.usage;
        if ('memory' in j) extras.add('a memory object');
        const c = j.choices?.[0];
        if (c?.delta?.content) out.content += c.delta.content;
        if (c?.delta?.reasoning_content) out.reasoning += c.delta.reasoning_content;
        if (c?.finish_reason) out.finish = c.finish_reason;
        if (out.chunks.length === 1 && onFirst) onFirst();
        if (onChunk) onChunk(out.chunks.length);
      }
    }
  }
  noted({ usage: out.usage }, res.headers);
  return out;
}

const SAY_OK = 'Reply with the single word ok.';
const SYSTEM = { role: 'system', content: 'You are a terse assistant. Answer in as few words as you can.' };
const TOOLS = [{ type: 'function', function: { name: 'lookup_order', description: 'Look up an order by its number.',
  parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'] } } }];
const CODE = `BASALT-${100 + Math.floor(Math.random() * 900)}`;

// GET /v1/brain/models, waiting while the memory loads (503 loading): the answer, once it is not loading
async function ready() {
  const t0 = Date.now();
  let loading = null;
  for (;;) {
    const r = await http('GET', '/v1/brain/models');
    if (r.status === 503 && r.json?.error?.reason === 'loading' && Date.now() - t0 < 600_000) {
      loading ??= r;
      await sleep(Math.min(5000, Math.max(200, Number(r.json.error.retry_after_ms) || 1000)));
      continue;
    }
    if (loading) check(isError(loading, 'loading', 503), 'while the memory loads, requests are answered 503 loading (the error\'s shape)', loading.json);
    else info('loading not seen: the memory was loaded when the suite began');
    return r;
  }
}

async function suite(models) {
  const list = models.json?.data;
  check(models.status === 200 && Array.isArray(list) && list.length === 1 && typeof list[0]?.id === 'string',
    'GET /v1/brain/models answers one model', what(models));
  if (Array.isArray(list) && list[0]) info(`the model: ${list[0].id}`);

  // --- 2.1: what a request must carry (a refusal keeps nothing, 2.3)
  let r = await http('POST', NATIVE, { max_tokens: MAX_TOKENS });
  check(isError(r, 'invalid_request', 400), 'a request without messages is refused (invalid_request)', what(r));
  check(shapeOf(r.json?.error, r.status), 'a refused request: the error has code = status, a type, a reason of the closed set and a message', what(r));
  r = await http('POST', NATIVE, { max_tokens: MAX_TOKENS, messages: [] });
  check(isError(r, 'invalid_request', 400), 'an empty message list is refused (invalid_request)', what(r));
  r = await http('POST', NATIVE, { max_tokens: MAX_TOKENS, messages: [SYSTEM] });
  check(isError(r, 'invalid_request', 400), 'a request with only a system message is refused (invalid_request)', what(r));
  r = await http('POST', NATIVE, { max_tokens: MAX_TOKENS, messages: [{ role: 'assistant', content: 'ok' }] });
  check(isError(r, 'invalid_request', 400), 'a request with only an assistant message is refused (invalid_request)', what(r));

  // --- 2, 2.2: a request without context, then streamed
  let a = await post({ messages: [user(SAY_OK)] });
  check(a.status === 200 && isCompletion(a.json), 'a request without context (one user message) is answered as a chat completion', what(a));
  info(`its answer: ${quote(a.message?.content)}; usage.prompt_tokens ${a.json?.usage?.prompt_tokens ?? 'not reported'}`);
  let s = await stream({ messages: [user(SAY_OK)] });
  check(s.status === 200 && /text\/event-stream/i.test(s.type) && s.chunks.length > 0 && s.chunks.every((c) => c.error || Array.isArray(c.choices))
    && s.chunks.some((c) => c.choices?.[0]?.delta), 'streamed, it is answered as server-sent chunks (choices[].delta)', s.json || s.type);
  check(s.status === 200 && !!s.finish && s.done, 'the stream carries a finish_reason and ends with [DONE]', { finish: s.finish, done: s.done });
  info(`the streamed answer: ${quote(s.content || s.reasoning)}`);

  a = await post({ messages: [user(`Remember this code word for later: ${CODE}. ${SAY_OK}`)] });
  check(a.status === 200, 'a request that tells the brain something is answered', what(a));

  // --- 2.1: instructions (system, developer, tools) may come with every request
  a = await post({ messages: [SYSTEM, user(SAY_OK)] });
  check(a.status === 200 && isCompletion(a.json), 'a request with its own system message is answered', what(a));
  a = await post({ messages: [SYSTEM, user('Reply with the single word yes.')] });
  check(a.status === 200 && isCompletion(a.json), 'the same instructions again, with the next request, are answered (not refused)', what(a));
  a = await post({ messages: [{ role: 'developer', content: SYSTEM.content }, user(SAY_OK)] });
  check(a.status === 200 && isCompletion(a.json), 'a developer message is taken as instructions, as a system message', what(a));
  a = await post({ messages: [SYSTEM, user('call lookup_order {"number": "4711"}')], tools: TOOLS });
  check(a.status === 200 && isCompletion(a.json), 'a request with tools is answered', what(a));
  const calls = a.message?.tool_calls;
  if (Array.isArray(calls) && calls.length) {
    check(calls.every((c) => typeof c.id === 'string' && typeof c.function?.name === 'string' && typeof c.function?.arguments === 'string'),
      'its tool calls have the common shape (id, function.name, function.arguments)', calls);
    a = await post({ tools: TOOLS, messages: [SYSTEM, ...calls.map((c) => ({ role: 'tool', tool_call_id: c.id,
      content: JSON.stringify({ number: '4711', status: 'shipped' }) }))] });
    check(a.status === 200 && isCompletion(a.json), 'the tool results, sent as the next request\'s only new messages, are answered', what(a));
    info(`the answer to the tool results: ${quote(a.message?.content)}`);
  } else {
    info(`the model called no tool (${quote(a.message?.content)}): a request with tool results not sent`);
  }

  // --- 2.3: a request sent again is heard again, and answered again
  {
    const note = user(`Note ${TAG}: the delivery van comes on Thursdays. ${SAY_OK}`);
    const a1 = await post({ messages: [note] });
    const a2 = await post({ messages: [note] });
    check(a1.status === 200 && a2.status === 200 && isCompletion(a2.json), 'the same request sent twice is answered both times', what(a2));
    const p1 = a1.json?.usage?.prompt_tokens;
    const p2 = a2.json?.usage?.prompt_tokens;
    if (Number.isInteger(p1) && Number.isInteger(p2)) {
      // (a brain may read instructions of its own before the first of the two - the turn behind another conversation's -
      // so the two counts are not compared with each other: the second holds the message itself again, ~1 token a 5 characters)
      const least = Math.ceil(note.content.length / 5);
      check(p2 >= least, `the second was heard again (2.3): usage.prompt_tokens ${p1}, then ${p2} (the message alone is at least ${least})`, { p1, p2, least });
    }
  }

  // --- 3: a whole list goes to the compatible entry. The native entry refuses the same history.
  {
    const compatibleModels = await http('GET', '/v1/models');
    const other = compatibleModels.json?.data;
    check(compatibleModels.status === 200 && Array.isArray(other) && other.length === 1 &&
      typeof other[0]?.id === 'string' && other[0].id === list?.[0]?.id, 'GET /v1/models lists the same model as GET /v1/brain/models', what(compatibleModels));
    const ended = [user('Earlier question.'), { role: 'assistant', content: 'Earlier answer.' }];
    const badNative = await post({ messages: [...ended, user(SAY_OK)] });
    check(isError(badNative, 'invalid_request', 400), 'assistant history with a new question on the native path is refused (400 invalid_request)', what(badNative));
    info('the public paths expose no state to compare before and after a refusal; whether anything was kept cannot be verified from outside');
    const badList = await post({ messages: ended }, COMPATIBLE);
    check(isError(badList, 'invalid_request', 400), 'a compatible list ending with an assistant answer is refused (400 invalid_request)', what(badList));

    const long = user(`Archive note ${TAG}. ` + 'The shelves are sorted by year and every box has a label with its year and owner. '.repeat(120) + SAY_OK);
    // The replacement itself must be long: rereading a short summary could otherwise pass the usage check.
    const summary = user(`Invented summary ${TAG}. ` + 'The maps are filed by town and every drawer has a card with its town and region. '.repeat(120));
    const first = await post({ messages: [long] }, COMPATIBLE);
    if (check(first.status === 200 && isCompletion(first.json), 'a compatible first turn of about 2,000 words is answered', what(first))) {
      const shown = { role: 'assistant', content: first.message.content ?? '', ...(first.message.tool_calls ? { tool_calls: first.message.tool_calls } : {}) };
      const question = user(`Archive ${TAG}: ${SAY_OK}`);
      const pLong = first.json?.usage?.prompt_tokens;
      const after = async (head, label) => {
        const r = await post({ messages: [head, shown, question] }, COMPATIBLE);
        check(r.status === 200 && isCompletion(r.json), `${label} is answered (200)`, what(r));
        const count = r.json?.usage?.prompt_tokens;
        if (!Number.isInteger(count) || !Number.isInteger(pLong)) info('usage.prompt_tokens is not reported: the skipping of the history cannot be measured');
        check(Number.isInteger(pLong) && Number.isInteger(count) && count > 0 && count < pLong / 4,
          `${label}: usage.prompt_tokens ${count} for the question, ${pLong} for the long turn`, { count, pLong });
        return r;
      };
      const w = await after(summary, 'the list with a long made-up summary replacing its first turn');
      info(`its answer: ${quote(w.message?.content)}`);
      await after(summary, 'the same changed list sent again (a regenerate)');
      await after(long, 'a whole list with its original head');
    }
  }

  // --- 2.4: one at a time - a request sent while another is answered waits its turn (or, past the server's limit, busy)
  {
    let second = null;
    let seen = 0;
    let sentAt = 0;
    let at = null;
    const first = await stream({ max_tokens: 200, messages: [user('Count from one to sixty in words, separated by commas.')] }, {
      onChunk: (n) => { seen = n; },
      onFirst: () => {
        sentAt = Date.now();
        second = http('POST', NATIVE, { max_tokens: MAX_TOKENS, reasoning_effort: 'low', messages: [user(SAY_OK)] }, { raw: true })
          .then(async (res) => {
            at = { chunks: seen, waitedMs: Date.now() - sentAt };
            const text = await res.text();
            let json = null;
            try { json = JSON.parse(text); } catch { /* */ }
            if (res.status === 200) noted(json, res.headers);
            return { status: res.status, json, text };
          }, (e) => {
            at = { chunks: seen, waitedMs: Date.now() - sentAt };
            return { status: 0, json: null, text: String(e) };
          });
      },
    });
    check(first.status === 200 && first.done, 'a long streamed request runs to its end while another one is sent', first.json || { done: first.done });
    const b = second ? await second : null;
    if (check(!!b, 'a second request was sent while the first streamed')) {
      check(b.status !== 409 && b.json?.error?.reason !== 'turn_in_flight', 'the second is not refused (no 409, no turn_in_flight)', what(b));
      if (b.status === 200) {
        check(isCompletion(b.json), 'it waited its turn and was answered (200)', what(b));
        if (first.chunks.length >= 10) {
          check(at.chunks >= first.chunks.length - 4, `it was answered as the first ended (after ${at.chunks} of the first's ${first.chunks.length} chunks)`, at);
        } else info(`the first answer was too short to overlap (${first.chunks.length} chunks): the order not checked`);
        info('busy not provoked: the server\'s wait limit is longer than this wait');
      } else {
        check(isError(b, 'busy', 503) && Number.isInteger(b.json.error.retry_after_ms),
          'it waited past the server\'s limit: 503 busy carrying retry_after_ms', what(b));
        info(`the server's wait limit is shorter than this wait (${(at.waitedMs / 1000).toFixed(1)} s); Rulith Brain waits 240 s`);
      }
    }
  }

  // --- what the brain heard before, asked for in a request that carries only the new question
  a = await post({ messages: [user('What was the code word I asked you to remember? Answer with the code word only.')] });
  check(a.status === 200 && isCompletion(a.json), 'a later request carrying only the new question is answered', what(a));
  const said = `${a.message?.content ?? ''} ${a.message?.reasoning_content ?? ''}`;
  if (said.toUpperCase().includes(CODE)) info(`the brain remembered: the code word ${CODE} came back`);
  else info(`the code word ${CODE} did not come back in ${MAX_TOKENS} tokens: ${quote(a.message?.content)}`);

  // --- 2.2: usage counts the request, not the memory
  const detailed = usages.filter((u) => u && u.prompt_tokens_details && 'cached_tokens' in u.prompt_tokens_details);
  if (!usages.length) info('no answer reported usage: cached_tokens not checked');
  else if (!detailed.length) info(`usage reported by ${usages.length} answers, none with a cached_tokens detail`);
  else check(detailed.every((u) => u.prompt_tokens_details.cached_tokens === 0), `every cached_tokens detail is 0 (${detailed.length} answers)`,
    detailed.map((u) => u.prompt_tokens_details.cached_tokens));

  // --- 4: errors inside a stream; what cannot be provoked from outside
  if (streamErrors.length) {
    check(streamErrors.every((e) => Number.isInteger(e.code) && shapeOf(e, e.code)), 'an error inside a stream is a chunk {"error": {...}} of the protocol\'s shape', streamErrors);
  } else info('no error came inside a stream (it cannot be provoked from outside)');
  info('too_large, unavailable and server_error cannot be provoked safely from outside: not exercised');
  if (extras.size) info(`answers carried ${[...extras].join(', ')}: not part of 1.0 (a client ignores what it does not know)`);
}

async function main() {
  info(`server ${SERVER}`);
  for (const f of ['destructive', 'learn']) {
    if (flag(f)) info(`--${f} has no effect on 1.0: learning and taking text out are the Rulith Brain application's, not the protocol's`);
  }
  let models;
  try {
    models = await ready();
  } catch (e) {
    failed += 1;
    say('FAIL', `no answer to GET /v1/brain/models: ${e.message}`);
  }
  if (models) {
    try {
      await suite(models);
    } catch (e) {
      failed += 1;
      say('FAIL', `the suite stopped: ${e.stack || e.message}`);
    }
  }
  console.log(`RESULT ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed)`);
  // (no process.exit: the kept connections close by themselves in a few seconds; exiting under them aborts on Windows)
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
