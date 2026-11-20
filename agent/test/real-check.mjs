#!/usr/bin/env node
// A check of the client side against a REAL memory server (Rulith Memory Protocol 1.0). No browser, no dsh, nothing
// installed: node 18+ and this folder.
//
//   node test/real-check.mjs [--server http://127.0.0.1:8091] [--front kv|text] [--max-tokens 300]
//                            [--timeout 100] [--out <file.json>]
//
// It goes through brain-core.mjs, the turn logic the forwarder and the app's chat run:
//   1. the status: the protocol, the mode, the features, the instance;
//   2. a conversation: its opening turn carries its front (a persona) as its one system message, then two turns that
//      continue it - the second streamed - with one status read between turns, which must not end it; every turn has
//      a request_id and the answer's memory object names it;
//   3. what the turns drew on: the sources the memory object names (/v1/memory/sources), the windows at the first
//      token (header), the windows and the lookup counters as the answer ended (the answer's last part), their labels
//      and source text (/v1/memory/windows);
//   4. a new conversation: it ends the first one (end_conversations); on a frozen memory it starts from the frozen
//      memory (nothing of the first one is there);
//   5. refusals that change nothing: a turn without previous_turn (invalid_request), a turn on an old previous_turn
//      (turn_mismatch, carrying the turn and this client's last request), the ended conversation continued
//      (conversation_not_found);
//   6. on an update memory: the last turn is taken back (undo {turn}); on a frozen one undo is refused (read_only).
// On an update memory the turns stay as a short exchange (algebra questions, a made-up code word) but the last one;
// nothing is forgotten. One line per check: "PASS <what>" or "FAIL <what>: <why>", "INFO ..." for what it saw, and a
// last line "RESULT PASS" or "RESULT FAIL"; the exit code is 0 or 1. --timeout is seconds per request; the whole run
// stops after five minutes. --out keeps the request bodies and answers.
import fs from 'node:fs';
import { MemoryTransport, recalledWindows } from '../brain-core.mjs';

const argv = process.argv.slice(2);
const take = (flag, fallback) => { const i = argv.indexOf(flag); if (i < 0) return fallback; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const server = String(take('--server', process.env.RULITH_MEMORY_SERVER || 'http://127.0.0.1:8091')).replace(/\/+$/, '');
const front = take('--front', 'kv') === 'text' ? 'text' : 'kv';
const maxTokens = Number(take('--max-tokens', 300));
const timeout = Number(take('--timeout', 100)) * 1000;
const outFile = take('--out');
const key = process.env.RULITH_MEMORY_KEY || '';
const headers = key && key !== 'local' ? { Authorization: `Bearer ${key}` } : {};

const WORD = 'HERON-42';
const NAME = 'Mira';
const PERSONA = `You are ${NAME}, a study assistant. When asked for your name, answer "${NAME}". Answer briefly.`;

let failed = 0, passed = 0;
const kept = { server, front, started: new Date().toISOString(), steps: [] };
const say = (line) => console.log(line);
const one = (text, n = 220) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const check = (ok, what, why = '') => { if (ok) { passed += 1; say(`PASS ${what}`); } else { failed += 1; say(`FAIL ${what}${why ? ': ' + one(why, 300) : ''}`); } return ok; };
const finish = () => {
  if (outFile) { try { fs.writeFileSync(outFile, JSON.stringify(kept, null, 1)); say(`INFO details in ${outFile}`); } catch (e) { say(`INFO could not write ${outFile}: ${e.message}`); } }
  say(`INFO ${passed} passed, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  say(failed ? 'RESULT FAIL' : 'RESULT PASS');
  process.exitCode = failed ? 1 : 0;   // (no process.exit: on Windows it trips a libuv assertion while fetch still holds sockets)
};
const t0 = Date.now();
setTimeout(() => { check(false, 'the run ends within five minutes', 'stopped at the limit'); finish(); process.exit(1); }, 5 * 60 * 1000).unref();

const bodies = [];
const spy = async (url, init) => {
  if (String(url).endsWith('/v1/memory/input') && init?.body) bodies.push(JSON.parse(init.body));
  return fetch(url, init);
};
const tr = new MemoryTransport({ server, fetch: spy, headers, idPrefix: 'check', busyWaitMs: timeout,
  brain: { enabled: true, front, persona: PERSONA, systemFrom: 'persona' } });

// a request of the protocol, outside the turn logic: { status, error }
async function raw(path, body) {
  const r = await fetch(server + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, error: json?.error ?? null, text };
}

// one turn; returns { record, text, reasoning, timings, status, error }
async function turn(messages, stream) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  const step = { stream, question: messages.at(-1).content };
  kept.steps.push(step);
  try {
    const { response, record } = await tr.send({ model: 'brain', messages, stream, max_tokens: maxTokens, temperature: 0 }, { signal: ac.signal });
    step.http = response.status;
    step.headers = Object.fromEntries(['x-memory-turn', 'x-memory-focus', 'x-brain-append'].map((h) => [h, response.headers.get(h)]));
    let text = '', reasoning = '', timings = null, memory = null;
    if (!stream) {
      const j = await response.json();
      text = j.choices?.[0]?.message?.content ?? '';
      reasoning = j.choices?.[0]?.message?.reasoning_content ?? '';
      timings = j.timings ?? null;
      memory = j.memory ?? null;
    } else {
      const all = await response.text();
      for (const l of all.split('\n')) {
        if (!l.startsWith('data:') || l.includes('[DONE]')) continue;
        try {
          const j = JSON.parse(l.slice(5));
          const d = j.choices?.[0]?.delta;
          if (d?.content) text += d.content;
          if (d?.reasoning_content) reasoning += d.reasoning_content;
          if (j.timings) timings = j.timings;
          if (j.memory) memory = j.memory;
        } catch { /* a partial line */ }
      }
    }
    Object.assign(step, { body: bodies.at(-1), answer: text, reasoning: one(reasoning, 2000), timings, memory, record: { ...record } });
    return { record, text, reasoning, timings, memory, status: response.status };
  } catch (e) {
    step.error = `${e?.code ?? e?.name ?? 'error'}: ${e?.message ?? e}`;
    return { error: e?.name === 'AbortError' ? `no answer within ${timeout / 1000} s` : step.error };
  } finally {
    clearTimeout(timer);
  }
}

// what every turn must say about itself
function turnChecks(n, r, { streamed, session, turnNo, features }) {
  if (!check(!r.error, `turn ${n}: answered${streamed ? ' (streamed)' : ''}`, r.error)) return false;
  say(`INFO turn ${n}: ${(r.record.ms / 1000).toFixed(1)} s${r.timings?.predicted_per_second ? `, ${Number(r.timings.predicted_per_second).toFixed(1)} tok/s` : ''}; answer: ${one(r.text) || '(empty)'}`);
  check(r.text.trim().length > 0, `turn ${n}: the answer has text`, `reasoning only: ${one(r.reasoning)}`);
  check(r.record.session === session, `turn ${n}: the client sent it as "${session}"`, `it was "${r.record.session}"`);
  check(r.record.turn === turnNo, `turn ${n}: the memory's turn after it is ${turnNo}`, `it is ${r.record.turn}`);
  const b = bodies.at(-1);
  check(b.previous_turn === turnNo - (r.record.mode === 'update' ? 1 : 0) && b.brain_append === true && b.brain_front === front && typeof b.request_id === 'string',
    `turn ${n}: previous_turn, request_id, brain_append, brain_front "${front}" in the request`,
    JSON.stringify({ previous_turn: b.previous_turn, request_id: b.request_id, brain_append: b.brain_append, brain_front: b.brain_front }));
  // the answer's memory object: the turn, the conversation, the request, the sources
  const m = r.memory;
  check(!!m && m.turn === turnNo && m.conversation === b.conversation && m.request_id === b.request_id,
    `turn ${n}: the answer's memory object names the turn, the conversation and the request`, JSON.stringify(m));
  if (features.includes('sources')) check(Array.isArray(m?.sources) && Array.isArray(r.record.sources), `turn ${n}: the memory object lists sources`, JSON.stringify(m?.sources ?? null));
  // the headers of a stream leave before the windows are picked: only an answer that is not streamed names them there
  if (!streamed) check((r.record.focus?.windows ?? 0) > 0, `turn ${n}: X-Memory-Focus names the windows picked`, JSON.stringify(r.record.focus?.detail ?? null));
  check(r.record.done === true && !!r.record.lookups, `turn ${n}: the lookup counters with the answer's end (timings.memory_brain)`, JSON.stringify(r.timings ?? null));
  check((r.record.windows?.front?.length ?? 0) > 0, `turn ${n}: the windows as the turn ended (timings.memory_focus${streamed ? ', the last chunk' : ''})`, JSON.stringify(r.timings?.memory_focus ?? null));
  const w = r.record.windows;
  say(`INFO turn ${n}: ${streamed ? 'streamed (no header)' : `${r.record.focus?.windows ?? 0} windows at the first token`}; at the end front ${w?.front?.length ?? '?'}, text ${w?.text?.length ?? '?'}, appended ${w?.appended?.length ?? '?'}, kv_added ${w?.kv_added?.length ?? '?'}; lookups ${r.record.lookups?.lookups ?? '?'}; sources ${r.record.sources?.length ?? '?'}`);
  return true;
}

async function main() {
// ---- 1. the status
let st;
try {
  st = await tr.status(true);
  check(true, `status: memory mode on at ${server}`);
} catch (e) {
  check(false, `status: memory mode on at ${server}`, e.message);
  return;
}
const features = st.features ?? [];
check(st.protocol?.name === 'rulith-memory' && /^1\.\d+$/.test(String(st.protocol?.version)), 'status: the protocol is rulith-memory 1.x', JSON.stringify(st.protocol));
check(typeof st.instance === 'string' && st.instance.length > 0, 'status: an instance');
check(features.includes('conversations'), 'status: the server serves conversations', features.join(' '));
say(`INFO mode ${st.mode}, turn ${st.turn}, features ${features.join(' ')}, ${Number(st.memory?.retained_tokens ?? 0).toLocaleString('en-US')} tokens kept`);
const frozen = st.mode === 'read_only';
const T = st.turn;
const next = (k) => (frozen ? T : T + k);   // the memory's turn after our k-th turn

// ---- 2. a conversation of three turns
const q1 = { role: 'user', content: `For this conversation my code word is ${WORD}. Remember it. Now, in two sentences: what is a variable in algebra?` };
const r1 = await turn([q1], false);
let first = null;
if (turnChecks(1, r1, { streamed: false, session: 'new', turnNo: next(1), features })) {
  const b = bodies.at(-1);
  first = b.conversation;
  check(b.conversation_open === true && /^check-/.test(b.conversation ?? '') && b.messages[0]?.role === 'system' && b.messages[0].content === PERSONA
    && b.messages.filter((m) => m.role === 'system').length === 1, 'turn 1: opens a conversation with its front as its one system message',
  JSON.stringify({ conversation: b.conversation, conversation_open: b.conversation_open, roles: b.messages.map((m) => m.role) }));
  check(!('session_open' in b) && !('session_system' in b) && !('session_keep' in b), 'turn 1: no session fields');
}
// one status read between turns must not end the conversation
let st2;
try { st2 = await tr.status(true); } catch (e) { st2 = null; check(false, 'status between turns', e.message); }
if (st2) {
  check(st2.turn === next(1) && st2.mode === st.mode && st2.last_request === bodies.at(-1)?.request_id && st2.conversation === first,
    'status between turns: the turn, the last request and the conversation', JSON.stringify({ mode: st2.mode, turn: st2.turn, last_request: st2.last_request, conversation: st2.conversation }));
}
const a1 = { role: 'assistant', content: r1.text || '(no answer)' };
const q2 = { role: 'user', content: 'What code word did I give you? Say it, then in one sentence: what is a coefficient?' };
const r2 = r1.error ? { error: 'turn 1 failed' } : await turn([q1, a1, q2], true);
if (turnChecks(2, r2, { streamed: true, session: 'continued', turnNo: next(2), features })) {
  const b = bodies.at(-1);
  check(b.conversation === first && b.conversation_open === undefined && b.messages.length === 1 && b.messages[0].role === 'user',
    'turn 2: continues the conversation, sends only the new message', JSON.stringify({ conversation: b.conversation, roles: b.messages.map((m) => m.role) }));
  check(r2.text.includes(WORD), 'turn 2: the conversation was held across the status read (the code word is still known)', one(r2.text));
}
const a2 = { role: 'assistant', content: r2.text || '(no answer)' };
const q3 = { role: 'user', content: 'What is your name, and what was my code word? Answer in one short sentence.' };
const r3 = r2.error ? { error: 'turn 2 failed' } : await turn([q1, a1, q2, a2, q3], false);
if (turnChecks(3, r3, { streamed: false, session: 'continued', turnNo: next(3), features })) {
  check(r3.text.includes(WORD), 'turn 3: the dialogue is still there (the code word)', one(r3.text));
  check(r3.text.includes(NAME), `turn 3: the conversation's front was read (the persona's name, ${NAME})`, one(r3.text));
}

// ---- 3. what was drawn on: sources, windows
const withSources = [r1, r2, r3].find((r) => !r.error && r.record.sources?.length);
if (features.includes('sources')) {
  if (withSources) {
    try {
      const got = await tr.sources(withSources.record.sources);
      check(got.length > 0 && got.every((x) => 'id' in x && typeof x.text === 'string'), `/v1/memory/sources: the ${withSources.record.sources.length} sources resolve to {id, label, text}`, `${got.length} answered`);
      for (const x of got.slice(0, 4)) say(`INFO source ${x.id}: ${one(x.label, 100)}: ${one(x.text, 100)}`);
    } catch (e) {
      check(false, '/v1/memory/sources answers', e.message);
    }
  } else say('INFO no turn named sources (an empty memory?): /v1/memory/sources not exercised');
}
const src = [r2, r1, r3].find((r) => !r.error && recalledWindows(r.record).length);
if (check(!!src, 'a turn recalled windows to look up')) {
  const ids = recalledWindows(src.record);
  try {
    const got = await tr.windows(ids);
    check(got.length === ids.length, `/v1/memory/windows: all ${ids.length} windows answered`, `${got.length} of ${ids.length}`);
    check(got.every((w) => typeof w.text === 'string' && w.text.length > 0 && Number.isInteger(w.window)), '/v1/memory/windows: every window has source text');
    const labelled = got.filter((w) => typeof w.label === 'string' && w.label.length > 0);
    check(labelled.length > 0, '/v1/memory/windows: windows have labels', `${labelled.length} of ${got.length}`);
    const by = new Map();
    for (const w of got) by.set(w.label || '(no label)', (by.get(w.label || '(no label)') ?? 0) + 1);
    for (const [label, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 6)) say(`INFO recalled ${n} x ${one(label, 150)}`);
    kept.windows = got.map((w) => ({ window: w.window, label: w.label, chars: w.text?.length }));
  } catch (e) {
    check(false, '/v1/memory/windows answers', e.message);
  }
}

// ---- 4. a new conversation
tr.newSession({ forget: false });
tr.configure({ persona: '' });
const q4 = { role: 'user', content: 'What code word did I give you earlier in this conversation? If I gave you none, answer exactly: NO CODE WORD.' };
const r4 = await turn([q4], true);
if (turnChecks(4, r4, { streamed: true, session: 'new', turnNo: next(4), features })) {
  const b = bodies.at(-1);
  check(b.conversation_open === true && b.conversation !== first && !b.messages.some((m) => m.role === 'system')
    && Array.isArray(b.end_conversations) && b.end_conversations.includes(first) && b.forget_conversations === undefined,
  'turn 4: a new conversation without a front, ending the first one, forgetting nothing',
  JSON.stringify({ conversation: b.conversation, end_conversations: b.end_conversations, forget_conversations: b.forget_conversations }));
  if (frozen) check(!r4.text.includes(WORD) && !r4.reasoning.includes(WORD), 'turn 4: the new conversation starts from the frozen memory (the code word is gone)', one(r4.text));
  else say(`INFO turn 4 on an update memory (the memory holds the first conversation): ${one(r4.text)}`);
}

// ---- 5. refusals that change nothing
const before = await tr.status(true).catch(() => null);
try {
  let r = await raw('/v1/memory/input', { messages: [{ role: 'user', content: 'hello' }], max_tokens: 8 });
  check(r.status === 400 && r.error?.reason === 'invalid_request', 'a turn without previous_turn is refused (400 invalid_request)', `HTTP ${r.status} ${one(r.text, 160)}`);
  if (before && !frozen) {
    r = await raw('/v1/memory/input', { previous_turn: before.turn - 1, conversation: bodies.at(-1)?.conversation, messages: [{ role: 'user', content: 'hello' }], max_tokens: 8 });
    check(r.status === 409 && r.error?.reason === 'turn_mismatch' && r.error.turn === before.turn && r.error.last_request === bodies.at(-1)?.request_id,
      'an old previous_turn is refused (409 turn_mismatch), naming the turn and this client\'s last request', one(r.text, 200));
  }
  if (before && first) {
    r = await raw('/v1/memory/input', { previous_turn: before.turn, conversation: first, messages: [{ role: 'user', content: 'hello' }], max_tokens: 8 });
    check(r.status === 409 && r.error?.reason === 'conversation_not_found', 'the ended conversation cannot be continued (409 conversation_not_found)', one(r.text, 200));
  }
  const after = await tr.status(true);
  check(!before || after.turn === before.turn, 'the refusals did not move the turn', JSON.stringify({ before: before?.turn, after: after.turn }));
} catch (e) {
  check(false, 'the refusals', e.message);
}

// ---- 6. undo
try {
  const s = await tr.status(true);
  const r = await raw('/v1/memory/undo', { turn: s.turn });
  if (frozen) check(r.status === 409 && r.error?.reason === 'read_only', 'undo on a frozen memory is refused (409 read_only)', one(r.text, 160));
  else if (features.includes('undo')) {
    check(r.status === 200 && r.json?.turn === s.turn - 1, 'the last turn is taken back (undo {turn})', one(r.text, 160));
    const s2 = await tr.status(true);
    check(s2.turn === s.turn - 1, 'the status shows the turn after the undo', `${s2.turn}`);
  }
} catch (e) {
  check(false, 'undo', e.message);
}
}

await main();
finish();
