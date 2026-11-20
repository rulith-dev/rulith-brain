// Brain mode, conversations and the protocol's retry rules, against the mock server (test/mock-server.mjs) in this
// process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryTransport, MemoryError, createMemoryProxy, parseBrain, parseFocus, parseWindows, recalledWindows, transcriptOf, errorCode } from '../memory-transport.mjs';
import { startMock } from './mock-server.mjs';

const sys = { role: 'system', content: 'You are Mira, a study assistant.' };
const u1 = { role: 'user', content: 'What does chapter 3 say about osmosis?' };
const u2 = { role: 'user', content: 'And about diffusion?' };
const u3 = { role: 'user', content: 'Summarise both.' };
const a = (text) => ({ role: 'assistant', content: text });

async function mockAt(t, options) {
  const mock = startMock({ port: 0, ...options });
  const port = await mock.ready;
  t.after(() => mock.server.close());
  return { ...mock, url: `http://127.0.0.1:${port}` };
}
const answerOf = async (r) => (await r.json()).choices[0].message.content;
const turnsOf = (mock) => mock.events.filter((e) => e.body);
const count = (mock, what) => mock.events.filter((e) => e[what]).length;
const sysOf = (b) => (b.messages[0]?.role === 'system' ? b.messages[0].content : undefined);
const rest = (b) => b.messages.filter((m) => m.role !== 'system');

test('the headers of a brain turn', () => {
  assert.deepEqual(parseFocus('8 windows (12,40,77,90,91,300,301,5000); continuous, a scan every 128 steps'),
    { windows: 8, ids: [12, 40, 77, 90, 91, 300, 301, 5000], detail: 'continuous, a scan every 128 steps' });
  assert.deepEqual(parseFocus('2 windows (7,9)'), { windows: 2, ids: [7, 9], detail: '' });
  assert.deepEqual(parseFocus('0 pieces (best cover 0.12)'), { windows: 0, ids: [], detail: '0 pieces (best cover 0.12)' });
  assert.equal(parseFocus(null), null);
  assert.deepEqual(parseBrain('lookups=1; input_tokens=1951; proposals=0; front_frozen=1; trials=0; restored=0; accepted=0'),
    { lookups: 1, input_tokens: 1951, proposals: 0, front_frozen: 1, trials: 0, restored: 0, accepted: 0 });
  assert.equal(parseBrain(''), null);
  // the answer's last part: the windows as the turn ended
  assert.deepEqual(parseWindows('front=12,40; text=; appended=77; kv_added=90,91'), { front: [12, 40], text: [], appended: [77], kv_added: [90, 91] });
  assert.equal(parseWindows(undefined), null);
  assert.deepEqual(recalledWindows({ windows: { front: [12, 40], text: [12], appended: [77], kv_added: [90] }, focus: { ids: [1] } }), [12, 40, 77, 90]);
  assert.deepEqual(recalledWindows({ windows: null, focus: { ids: [7, 9] } }), [7, 9]);
  assert.deepEqual(recalledWindows({}), []);
  assert.equal(errorCode('brain append: one slot only (start the server with --parallel 1)', 501), 'one_slot');
  assert.equal(errorCode('memory mode is off (start the server with --memory-mode)', 501), 'memory_off');
  assert.equal(errorCode('brain append requires LLAMA_QSA_SEAL_FOCUS>=512 and focus_k>0', 400), 'brain_unavailable');
  assert.equal(errorCode('something else', 500), 'server_error');
});

test('the conversation so far, for a session started again', () => {
  const text = transcriptOf([sys, u1, a('Osmosis is ...'), { role: 'tool', tool_call_id: 'c', content: 'x'.repeat(2000) }, u2]);
  assert.match(text, /^\[Earlier in this conversation, oldest first\]\nUser: What does chapter 3/);
  assert.match(text, /Assistant: Osmosis is \.\.\./);
  assert.match(text, /Tool result: x{600} \[\.\.\.\]/);
  assert.ok(!text.includes('Mira'));                       // the persona is not a turn
  assert.equal(transcriptOf([sys]), '');
  const long = transcriptOf([u1, a('first answer'), u2, a('second answer')], 60);
  assert.match(long, /its beginning is left out/);
  assert.ok(long.includes('second answer') && !long.includes('first answer'));
});

test('update mode: brain fields on every turn, the persona once a conversation', async (t) => {
  const mock = await mockAt(t);
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true, front: 'text', focusK: 6 } });
  const tools = [{ type: 'function', function: { name: 'read' } }];
  const r1 = await tr.send({ messages: [sys, u1], tools });
  const a1 = await answerOf(r1.response);
  assert.equal(r1.record.session, 'new');
  assert.equal(r1.record.focus.windows, 6);
  assert.deepEqual(r1.record.lookups, { lookups: 0, input_tokens: 0, proposals: 0, front_frozen: 1, trials: 0, restored: 0, accepted: 0, kv_added: 0 });
  assert.deepEqual(r1.record.windows.text, r1.record.windows.front);   // as source text: the six were read
  assert.equal(r1.record.done, true);
  const r2 = await tr.send({ messages: [sys, u1, a(a1), u2], tools });
  assert.equal(r2.record.session, 'continued');
  await r2.response.text();
  // another conversation on the same memory: its persona is read once, as its front
  const other = { role: 'system', content: 'You are Rex, terse.' };
  const r3 = await tr.send({ messages: [other, u3], tools });
  await r3.response.text();
  const [b1, b2, b3] = turnsOf(mock).map((e) => e.body);
  for (const b of [b1, b2, b3]) {
    assert.equal(b.brain_append, true);
    assert.equal(b.focus_k, 6);
    assert.equal(b.focus_every, 128);
    assert.equal(b.brain_front, 'text');
  }
  assert.deepEqual(b1.messages, [sys, u1]);                // the opening turn: its front, one system message
  assert.deepEqual(b1.tools, tools);
  assert.equal(b1.conversation_open, true);
  assert.deepEqual(b2.messages, [u2]);
  assert.equal(b2.tools, undefined);
  assert.equal(b2.conversation, b1.conversation);
  assert.equal(b2.conversation_open, undefined);
  assert.deepEqual(rest(b3), [u3]);
  assert.equal(sysOf(b3), 'You are Rex, terse.');
  assert.deepEqual(b3.tools, tools);                       // every conversation opens with its own tools
  assert.notEqual(b3.conversation, b1.conversation);
  assert.equal(tr.state().turn, 3);
  assert.equal(tr.state().conversations.length, 2);
});

test('update mode: a regenerated answer takes its turn back, and its opening turn opens again', async (t) => {
  const mock = await mockAt(t, { turn: 5 });
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true, persona: 'Always answer in one line.' } });
  const r1 = await tr.send({ messages: [sys, u1] });
  await r1.response.text();
  const r2 = await tr.send({ messages: [sys, u1] });       // regenerate
  await r2.response.text();
  assert.equal(r2.record.session, 'retaken');
  assert.equal(count(mock, 'undo'), 1);
  const [b1, b2] = turnsOf(mock).map((e) => e.body);
  assert.equal(sysOf(b1), 'Always answer in one line.\n\nYou are Mira, a study assistant.');
  assert.deepEqual(b2.messages, b1.messages);
  assert.equal(b2.previous_turn, 5);
  assert.equal(b2.conversation, b1.conversation);
  assert.equal(b2.conversation_open, true);
  assert.equal(mock.state.turn, 6);
});

test('a frozen memory: the status is asked once, the conversation is held', async (t) => {
  const mock = await mockAt(t, { readonly: true });
  const done = [];
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true }, onTurn: (e) => done.push(e.id) });
  const tools = [{ type: 'function', function: { name: 'read' } }];
  const r1 = await tr.send({ messages: [sys, u1], tools });
  const a1 = await answerOf(r1.response);
  const r2 = await tr.send({ messages: [sys, u1, a(a1), u2] });
  const a2 = await answerOf(r2.response);
  const r3 = await tr.send({ messages: [sys, u1, a(a1), u2, a(a2), u3], stream: true });
  assert.equal(r3.record.done, false);                     // what it recalled comes with the end of the answer
  const streamed = await r3.response.text();
  assert.equal(count(mock, 'status'), 1);                  // a frozen memory's turn never changes
  assert.equal(count(mock, 'restore'), 0);
  assert.match(a1, /conversation turn 1; fronts 1; brain kv\)/);
  assert.match(a2, /conversation turn 2; fronts 1; brain kv; kept\)/);
  assert.match(streamed, /\[DONE\]/);
  assert.deepEqual(done, [1, 2, 3]);
  const [b1, b2, b3] = turnsOf(mock).map((e) => e.body);
  assert.equal(b1.previous_turn, 412);
  assert.equal(b2.previous_turn, 412);
  assert.equal(sysOf(b1), 'You are Mira, a study assistant.');
  assert.equal(b1.conversation_open, true);
  assert.deepEqual(b1.tools, tools);                       // the conversation's own tools
  assert.deepEqual(rest(b1), [u1]);
  assert.deepEqual([b1.brain_front, b1.focus_k, b1.focus_every], ['kv', 12, 16]);   // the native base, as the server's status.recall says
  assert.equal(b1.focus_pin_user, undefined);
  assert.equal(b2.conversation, b1.conversation);
  assert.equal(b2.conversation_open, undefined);
  assert.deepEqual(b2.messages, [u2]);
  assert.deepEqual(b3.messages, [u3]);
  assert.equal(b3.conversation, b1.conversation);
  assert.deepEqual([r1, r2, r3].map((r) => r.record.session), ['new', 'continued', 'continued']);
  // a streamed answer: the lookup counters and the windows as it ended, from its last chunk
  assert.equal(r3.record.done, true);
  assert.equal(r3.record.lookups.lookups, 0);
  assert.equal(r3.record.lookups.kv_added, 2);
  assert.equal(r3.record.focus, null);                     // a stream has no X-Memory-Focus header
  assert.equal(r3.record.windows.front.length, 12);
  assert.equal(r2.record.focus.windows, 12);               // an answer that is not streamed has it
  assert.deepEqual(r2.record.windows.front, r2.record.focus.ids);
  assert.equal(r3.record.windows.kv_added.length, 2);
  assert.ok(recalledWindows(r3.record).length > 12);
  // asking for the status in the middle of a conversation does not end it
  await tr.status(true);
  assert.equal(count(mock, 'status'), 2);
  assert.equal(count(mock, 'restore'), 0);
  const s = tr.state();
  assert.equal(s.mode, 'read_only');
  assert.equal(s.session.turns, 3);
  assert.ok(s.memory.retained_tokens > 10_000_000);        // read in the session: its own tokens are on top
  assert.equal(s.turns.length, 3);
  assert.equal(s.turns[0].question, 'Summarise both.');
});

test('a frozen memory: a regenerated or edited message opens a new conversation with what was said', async (t) => {
  const mock = await mockAt(t, { readonly: true });
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true } });
  const a1 = await answerOf((await tr.send({ messages: [sys, u1] })).response);
  await (await tr.send({ messages: [sys, u1, a(a1), u2] })).response.text();
  const r = await tr.send({ messages: [sys, u1, a(a1), u2] });   // regenerate the second answer
  const again = await answerOf(r.response);
  assert.equal(r.record.session, 'resumed');
  assert.equal(count(mock, 'undo'), 0);
  assert.match(again, /conversation turn 1; fronts 1; brain kv\)/);   // from the frozen memory, not on top of the old answer
  const b = turnsOf(mock).at(-1).body;
  const before = turnsOf(mock)[0].body;
  assert.equal(b.conversation_open, true);
  assert.notEqual(b.conversation, before.conversation);
  assert.deepEqual(rest(b), [u2]);
  assert.match(sysOf(b), /^You are Mira, a study assistant\.\n\n\[Earlier in this conversation, oldest first\]\nUser: What does chapter 3/);
  assert.ok(sysOf(b).includes('Assistant: ' + a1));
  // then it goes on in that conversation
  const r4 = await tr.send({ messages: [sys, u1, a(a1), u2, a(again), u3] });
  assert.equal(r4.record.session, 'continued');
  assert.match(await answerOf(r4.response), /conversation turn 2; fronts 1/);
  // another transcript: a new conversation without a transcript
  const r5 = await tr.send({ messages: [sys, u3] });
  assert.equal(r5.record.session, 'new');
  assert.equal(sysOf(turnsOf(mock).at(-1).body), 'You are Mira, a study assistant.');
  await r5.response.text();
  // newSession(): the next request does not continue, whatever it holds
  tr.newSession();
  const r6 = await tr.send({ messages: [sys, u3, a('x'), u1] });
  assert.equal(r6.record.session, 'resumed');
});

test("a client's context notes are read with the conversation's front, not as part of a turn", async (t) => {
  const mock = await mockAt(t, { readonly: true });
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true } });
  const rt = { role: 'user', content: 'Current runtime context. Windows, C:/projects.' };
  const sk = { role: 'user', content: '<system-reminder>\nA skill is a reusable set of task-specific instructions. Skills: a, b.' };
  const time = (step, date) => ({ role: 'user', content: `Time sampled while preparing turn ${step}, step 1: ${date}T09:12:49-08:00` });
  const r1 = await tr.send({ messages: [sys, rt, sk, time(1, '2026-11-13'), u1] });
  const a1 = await answerOf(r1.response);
  const first = [sys, rt, sk, time(1, '2026-11-13'), u1, a(a1)];
  const a2 = await answerOf((await tr.send({ messages: [...first, rt, sk, time(2, '2026-11-13'), u2] })).response);
  await (await tr.send({ messages: [...first, rt, sk, time(2, '2026-11-13'), u2, a(a2), rt, sk, time(3, '2026-11-14'), u3] })).response.text();
  const [b1, b2, b3] = turnsOf(mock).map((e) => e.body);
  assert.deepEqual(rest(b1), [u1]);                        // only the question picks what is recalled
  assert.equal(sysOf(b1), [sys.content, rt.content, sk.content, time(1, '2026-11-13').content].join('\n\n'));
  assert.deepEqual(b2.messages, [u2]);
  assert.deepEqual(b3.messages, [time(3, '2026-11-14'), u3]);   // a new day is said once
  assert.equal(r1.record.question, u1.content);
});

test('a frozen memory without brain mode still runs as conversations', async (t) => {
  const mock = await mockAt(t, { readonly: true });
  const tr = new MemoryTransport({ server: mock.url });
  const a1 = await answerOf((await tr.send({ messages: [sys, u1] })).response);
  await (await tr.send({ messages: [sys, u1, a(a1), u2] })).response.text();
  const [b1, b2] = turnsOf(mock).map((e) => e.body);
  assert.equal(b1.brain_append, undefined);
  assert.equal(sysOf(b1), 'You are Mira, a study assistant.');
  assert.equal(b2.conversation, b1.conversation);
  assert.equal(b2.conversation_open, undefined);
});

test('a frozen memory holds a conversation that has no front of its own', async (t) => {
  const mock = await mockAt(t, { readonly: true });
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true } });
  const a1 = await answerOf((await tr.send({ messages: [u1] })).response);   // no persona, no system prompt
  const a2 = await answerOf((await tr.send({ messages: [u1, a(a1), u2] })).response);
  const [b1, b2] = turnsOf(mock).map((e) => e.body);
  assert.deepEqual(b1.messages, [u1]);                     // no system message at all
  assert.equal(b1.conversation_open, true);
  assert.equal(b2.conversation, b1.conversation);
  assert.equal(count(mock, 'restore'), 0);
  assert.match(a2, /conversation turn 2; fronts 0; brain kv; kept\)/);
});

test('the request fields of brain mode: the front, its window counts, the optional ones', async (t) => {
  const mock = await mockAt(t, { readonly: true });
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true, front: 'text' } });
  await (await tr.send({ messages: [u1] })).response.text();
  tr.configure({ front: 'kv', focusK: 999, focusEvery: 64, focusPinUser: 16, focusSwap: 4, focusCarry: 0.5 });
  tr.newSession();
  await (await tr.send({ messages: [u2] })).response.text();
  const [b1, b2] = turnsOf(mock).map((e) => e.body);
  assert.deepEqual([b1.brain_front, b1.focus_k, b1.focus_every], ['text', 8, 128]);   // the skill reads 8 as source text
  assert.deepEqual([b2.brain_front, b2.focus_k, b2.focus_every], ['kv', 256, 64]);    // the server's bound
  assert.deepEqual([b2.focus_pin_user, b2.focus_swap, b2.focus_carry], [16, 4, 0.5]);
  assert.equal(tr.state().brain.focus_k, 256);
});

test('what was recalled, as labels and source text', async (t) => {
  const mock = await mockAt(t, { readonly: true });
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true, focusK: 128 } });
  const r = await tr.send({ messages: [u1], stream: true });
  await r.response.text();
  const got = await tr.windows([5, 5, 7, 99999999]);
  assert.deepEqual(got.map((w) => w.window), [5, 7]);
  assert.match(got[0].label, /^Mock Library \/ Book 1 \/ Section 1$/);
  assert.match(got[0].text, /^Source text of window 5: /);
  assert.deepEqual([got[1].token_start, got[1].token_end], [1792, 2304]);
  const ids = recalledWindows(r.record);                   // ~130 windows: the server answers 64 at a time
  const all = await tr.windows(ids);
  assert.ok(ids.length > 128 && all.length === ids.length);
  assert.deepEqual(mock.events.filter((e) => e.windows).map((e) => e.windows.length), [3, 64, 64, ids.length - 128]);
  assert.equal(count(mock, 'restore'), 0);                 // and the conversation is still there
  const off = await mockAt(t, { off: true });
  await assert.rejects(new MemoryTransport({ server: off.url }).windows([1]), (e) => e instanceof MemoryError);
});

test("the server's refusals come back with a code", async (t) => {
  const off = await mockAt(t, { off: true });
  await assert.rejects(new MemoryTransport({ server: off.url, brain: { enabled: true } }).send({ messages: [sys, u1] }),
    (e) => e instanceof MemoryError && e.code === 'memory_off');
  const two = await mockAt(t, { parallel: 2 });
  const tr2 = new MemoryTransport({ server: two.url, brain: { enabled: true } });
  await assert.rejects(tr2.send({ messages: [sys, u1] }), (e) => e.code === 'one_slot' && e.status === 501);
  assert.equal(tr2.state().error.code, 'one_slot');
  assert.equal(tr2.state().turns[0].ok, false);
  const plain = await mockAt(t, { focus: false });
  await assert.rejects(new MemoryTransport({ server: plain.url, brain: { enabled: true } }).send({ messages: [sys, u1] }),
    (e) => e.code === 'brain_unavailable');
  await assert.rejects(new MemoryTransport({ server: 'http://127.0.0.1:9', brain: { enabled: true } }).send({ messages: [sys, u1] }),
    (e) => e.code === 'server_down');
});

test('a memory moved on by someone else is read again, once', async (t) => {
  const mock = await mockAt(t, { readonly: true });
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true } });
  await (await tr.send({ messages: [sys, u1] })).response.text();
  mock.state.turn = 500;                                   // another snapshot was loaded behind the forwarder's back
  const r = await tr.send({ messages: [sys, u2] });
  assert.equal(r.record.turn, 500);
  assert.equal(turnsOf(mock).at(-1).body.previous_turn, 500);
  assert.equal(count(mock, 'status'), 2);
});

test('the forwarder: brain headers, the session, the state for a page', async (t) => {
  const mock = await mockAt(t, { readonly: true });
  const { proxy } = createMemoryProxy({ server: mock.url, brain: { enabled: true, front: 'kv', persona: 'Be brief.', systemFrom: 'persona' }, panel: '<p>panel</p>' });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const ask = { role: 'user', content: 'Please do a lookup on osmosis.' };
  const chat = (messages, stream, conversation) => fetch(base + '/v1/chat/completions', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(conversation ? { 'X-Brain-Conversation': conversation } : {}) },
    body: JSON.stringify({ model: 'mock-model', messages, stream }) });
  const r1 = await chat([sys, ask], false, 't1');
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('x-brain-session'), 'new');
  assert.equal(r1.headers.get('x-memory-turn'), '412');
  assert.match(r1.headers.get('x-memory-focus'), /^12 windows \(/);
  assert.match(r1.headers.get('x-brain-append'), /^lookups=1; input_tokens=1951/);
  const a1 = (await r1.json()).choices[0].message;
  const r2 = await chat([sys, ask, a1, u2], true, 't1');
  assert.equal(r2.headers.get('x-brain-session'), 'continued');
  assert.equal(r2.headers.get('x-brain-append'), null);
  assert.equal(r2.headers.get('x-memory-focus'), null);    // streamed: the windows come with the last chunk
  assert.match(await r2.text(), /kept\)/);
  const state = await (await fetch(base + '/brain/state?refresh=1')).json();   // asks the server; the conversation stays
  assert.equal(count(mock, 'status'), 2);
  assert.equal(count(mock, 'restore'), 0);
  assert.equal(state.mode, 'read_only');
  assert.equal(state.brain.front, 'kv');
  assert.deepEqual([state.brain.focus_k, state.brain.focus_every], [12, 16]);
  assert.equal(state.reach.state, 'up');
  assert.equal(state.session.turns, 2);
  assert.deepEqual(state.turns.map((x) => x.session), ['continued', 'new']);
  assert.equal(state.turns[1].lookups.lookups, 1);
  assert.equal(state.turns[0].lookups.kv_added, 2);        // the streamed answer's last chunk
  assert.equal(state.turns[0].windows.front.length, 12);
  // the page asks for what a turn recalled
  const seen = await (await fetch(base + '/brain/windows', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ windows: state.turns[0].windows.kv_added }) })).json();
  assert.equal(seen.windows.length, 2);
  assert.match(seen.windows[0].label, /^Mock Library \/ Book /);
  assert.equal(sysOf(turnsOf(mock)[0].body), 'Be brief.');
  assert.match(turnsOf(mock)[0].body.conversation, /^agent-/);
  assert.equal(turnsOf(mock)[0].body.brain_front, 'kv');
  assert.equal(await (await fetch(base + '/brain')).text(), '<p>panel</p>');
  // a refusal keeps its code
  const bad = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'assistant', content: 'only an answer' }] }) });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'nothing_new');
});

test('the stand-in licence: a release runtime reports the one it accepts and stops without one', async (t) => {
  const { licenceCheck } = await import('./mock-server.mjs');
  const status = async (mock) => (await (await fetch(`${mock.url}/v1/memory/status`)).json()).licence;
  const paid = await status(await mockAt(t, { readonly: true, licence: '50M', deviceMax: 95_000_000 }));
  assert.deepEqual(paid, { ok: true, kind: 'paid', tier: '50M', capacity: 53_000_000, trial_days_left: null, error: '',
    device: '3f9a0c27d1e84b6a9c5d2e7f10ab4c8d', device_max: 95_000_000, placeholder: false });
  const trial = await status(await mockAt(t, { licence: 'trial' }));
  assert.deepEqual([trial.ok, trial.kind, trial.capacity, trial.trial_days_left], [true, 'trial', null, 23]);
  assert.equal(await status(await mockAt(t, { readonly: true })), undefined);           // a server from before the licence
  // no licence, an ended trial, another device's licence, a memory larger than the tier: nothing starts (exit code 3)
  for (const [kind, why] of [['none', 'no licence'], ['ended', 'trial ended'], ['device', 'licence is for another device']]) {
    assert.throws(() => startMock({ port: 0, licence: kind }), (e) => e.exitCode === 3 && e.message.startsWith(`Rulith Brain: ${why} (`)
      && e.message.endsWith(' - the memory is not loaded'));
  }
  assert.deepEqual(licenceCheck('10M', { memoryTokens: 20_000_000 }), { refusal: 'this memory holds 20000000 tokens, the 10M licence allows 10600000' });
  assert.throws(() => licenceCheck('5M'), /--licence: trial, 10M/);
  // as a program: the line and the exit code the manager reads from a launch
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [new URL('./mock-server.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '0', 'NUL', '--licence', 'ended'], { encoding: 'utf8' });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /^Rulith Brain: trial ended \(.+\) - the memory is not loaded$/m);
});

test('how a turn recalls: as set, else as the server\'s status.recall says, else kv / 12 / every 16 steps', async (t) => {
  const fields = (b) => [b.brain_front, b.focus_k, b.focus_every];
  const run = async (mockOptions, brain) => {
    const mock = await mockAt(t, mockOptions);
    const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true, ...brain } });
    await (await tr.send({ messages: [u1] })).response.text();
    return { body: turnsOf(mock).at(-1).body, state: tr.state() };
  };
  const folder = { recall: { front: 'text', focus_k: 6, focus_every: 64 } };
  // nothing set: the memory folder's way, its counts
  const own = await run(folder, {});
  assert.deepEqual(fields(own.body), ['text', 6, 64]);
  assert.deepEqual([own.state.brain.front, own.state.brain.focus_k, own.state.brain.focus_every], ['text', 6, 64]);
  // another front set: the folder's counts are for its own front, so that front's defaults
  assert.deepEqual(fields((await run(folder, { front: 'kv' })).body), ['kv', 12, 16]);
  // a count set: it, the rest the folder's
  assert.deepEqual(fields((await run(folder, { focusK: 20 })).body), ['text', 20, 64]);
  // the server's default folder, and a server too old to say
  assert.deepEqual(fields((await run({}, {})).body), ['kv', 12, 16]);
  assert.deepEqual(fields((await run({ recall: null }, {})).body), ['kv', 12, 16]);
  assert.deepEqual(fields((await run({ recall: null }, { front: 'text' })).body), ['text', 8, 128]);
});

test('a repeat the server can no longer take back (it learned since) goes on as a new turn, in the core', async (t) => {
  const mock = await mockAt(t);
  const logs = [];
  const tr = new MemoryTransport({ server: mock.url, brain: { enabled: true }, log: (l) => logs.push(l) });
  const r1 = await tr.send({ messages: [sys, u1] });
  await r1.response.text();
  // a learning run between the answer and its repeat (another client's folder, the agent's research)
  await fetch(`${mock.url}/v1/memory/learn`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ name: 'notes.md', text: 'Osmosis moves water.' }] }) });
  const r2 = await tr.send({ messages: [sys, u1] });   // asked again
  await r2.response.text();
  assert.equal(r2.record.turn, 2);
  assert.equal(r2.record.ok, true);
  assert.equal(count(mock, 'undo'), 0);
  assert.equal(turnsOf(mock).at(-1).body.previous_turn, 1);
  assert.ok(logs.some((l) => /cannot be taken back/.test(l)));
  // with the server's undo there, it is taken back as always
  const r3 = await tr.send({ messages: [sys, u1] });
  await r3.response.text();
  assert.equal(count(mock, 'undo'), 1);
  assert.equal(r3.record.turn, 2);
  // a client that wants the refusal
  const strict = new MemoryTransport({ server: mock.url, brain: { enabled: true }, undoRefusedAsNewTurn: false });
  await (await strict.send({ messages: [u2] }, { key: 's' })).response.text();
  mock.state.readSinceTurn = true;
  await assert.rejects(strict.send({ messages: [u2] }, { key: 's' }), (e) => e instanceof MemoryError && /nothing to undo/.test(e.message));
});

test('a page of another origin cannot read the X-Memory-* headers: the turns follow from the mode', async (t) => {
  const mock = await mockAt(t);
  // (what a browser shows a page of another origin when a server does not expose its headers - an older one)
  const hidden = async (...args) => {
    const r = await fetch(...args);
    const headers = new Headers([...r.headers].filter(([k]) => !/^x-(memory|brain)-/i.test(k)));
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
  };
  const options = await fetch(`${mock.url}/v1/memory/input`, { method: 'OPTIONS' });
  assert.match(options.headers.get('access-control-expose-headers'), /X-Memory-Turn/, 'as the protocol asks: exposed');
  const tr = new MemoryTransport({ server: mock.url, fetch: hidden, brain: { enabled: true } });
  const a1 = await answerOf((await tr.send({ messages: [sys, u1] })).response);
  const r2 = await tr.send({ messages: [sys, u1, a(a1), u2] });
  await r2.response.text();
  assert.equal(r2.record.turn, 2);
  assert.equal(r2.record.focus, null);
  const r3 = await tr.send({ messages: [sys, u1, a(a1), u2] });   // asked again: taken back, then turn 2 again
  await r3.response.text();
  assert.equal(r3.record.turn, 2);
  assert.equal(count(mock, 'undo'), 1);
  assert.equal(mock.state.turn, 2);
});

test('the agent waits for Rulith Brain: not up yet, then loading its model, then ready', async (t) => {
  const { waitForServer, PLAIN } = await import('../memory-transport.mjs');
  // a port nothing listens on yet
  const probe = startMock({ port: 0 });
  const port = await probe.ready;
  await new Promise((r) => probe.server.close(r));
  const lines = [];
  let mock = null;
  const waiting = waitForServer({ server: `http://127.0.0.1:${port}`, every: 20, log: (l) => {
    lines.push(l);
    // Brain is opened and starts loading its model; a moment later it is ready
    if (l.startsWith(PLAIN.down) && !mock) {
      mock = startMock({ port, loading: true });
      setTimeout(() => { mock.state.loading = false; }, 150);
    }
  } });
  const { status, model } = await waiting;
  t.after(() => mock.server.close());
  assert.equal(model, 'mock-model');
  assert.equal(status.mode, 'update');
  assert.deepEqual(lines.map((l) => l.startsWith(PLAIN.down) ? 'down' : l === PLAIN.loading ? 'loading' : l), ['down', 'loading', 'Rulith Brain is ready.']);
  // what cannot serve the agent ends the wait
  const off = await mockAt(t, { off: true });
  await assert.rejects(waitForServer({ server: off.url, every: 20 }), (e) => e.code === 'memory_off');
});

test('the forwarder while Rulith Brain is not running: plain words, and the page knows', async (t) => {
  const { PLAIN } = await import('../memory-transport.mjs');
  const { proxy } = createMemoryProxy({ server: 'http://127.0.0.1:9', brain: { enabled: true } });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const r = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [u1] }) });
  assert.equal(r.status, 502);
  assert.deepEqual((await r.json()).error, { message: PLAIN.down, type: 'memory_agent', code: 'server_down' });
  const state = await (await fetch(base + '/brain/state?refresh=1')).json();
  assert.equal(state.reach.state, 'down');
  // loading its model: 503, said as such
  const loading = await mockAt(t, { loading: true });
  // (a forwarder that does not wait for the model: the agent's own waits up to 15 minutes)
  const p2 = createMemoryProxy({ server: loading.url, brain: { enabled: true }, busyWaitMs: 0 }).proxy;
  await new Promise((resolve) => p2.listen(0, '127.0.0.1', resolve));
  t.after(() => p2.close());
  const b2 = `http://127.0.0.1:${p2.address().port}`;
  const r2 = await fetch(b2 + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [u1] }) });
  assert.equal(r2.status, 503);
  assert.equal((await r2.json()).error.message, PLAIN.loading);
  assert.equal((await (await fetch(b2 + '/brain/state?refresh=1')).json()).reach.state, 'loading');
  loading.state.loading = false;
  assert.equal((await (await fetch(b2 + '/brain/state?refresh=1')).json()).reach.state, 'up');
});

// ---- the Rulith Memory Protocol: conversations and the retry rules ----

const json = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('two interleaved transcripts keep their own conversations, instructions and tools', async (t) => {
  const mock = await mockAt(t);
  const tr = new MemoryTransport({ server: mock.url });
  const toolsA = [{ type: 'function', function: { name: 'read' } }];
  const toolsB = [{ type: 'function', function: { name: 'search' } }];
  const sysB = { role: 'system', content: 'You are a researcher.' };
  const qA = { role: 'user', content: 'The main task.' }, qB = { role: 'user', content: 'A subtask.' };
  const a1 = await answerOf((await tr.send({ messages: [sys, qA], tools: toolsA })).response);
  const b1 = await answerOf((await tr.send({ messages: [sysB, qB], tools: toolsB })).response);
  const r3 = await tr.send({ messages: [sys, qA, a(a1), u2], tools: toolsA });   // the first goes on after the second
  await r3.response.text();
  const r4 = await tr.send({ messages: [sysB, qB, a(b1), u3], tools: toolsB });
  const said = await answerOf(r4.response);
  const [x1, y1, x2, y2] = turnsOf(mock).map((e) => e.body);
  assert.deepEqual([r3.record.session, r4.record.session], ['continued', 'continued']);
  assert.equal(x2.conversation, x1.conversation);
  assert.equal(y2.conversation, y1.conversation);
  assert.notEqual(x1.conversation, y1.conversation);
  assert.deepEqual([x1.tools, y1.tools, x2.tools, y2.tools], [toolsA, toolsB, undefined, undefined]);
  assert.deepEqual([x2.messages, y2.messages], [[u2], [u3]]);
  // the server applied the second conversation's own instructions, and only its own turns are in front of it
  assert.match(said, /In this conversation: You are a researcher\. \| A subtask\. \| Summarise both\./);
  assert.doesNotMatch(said, /main task/);
  // a repeat of the first transcript after the second took a turn: its turn is not the memory's last, no undo
  const r5 = await tr.send({ messages: [sys, qA, a(a1), u2], tools: toolsA });
  await r5.response.text();
  assert.equal(r5.record.session, 'continued');
  assert.equal(turnsOf(mock).at(-1).body.conversation, x1.conversation);
  assert.equal(count(mock, 'undo'), 0);
  assert.equal(tr.state().conversations.length, 2);
});

test('turn_mismatch: another client took a turn in between - the request goes again in its own conversation', async (t) => {
  const mock = await mockAt(t);
  let bump = false;
  const racing = async (url, init) => {
    if (bump && String(url).endsWith('/v1/memory/input')) {
      bump = false;
      const other = await json(`${mock.url}/v1/memory/input`, { previous_turn: mock.state.turn, conversation: 'other-client-1',
        conversation_open: true, request_id: 'theirs', messages: [{ role: 'user', content: 'from another client' }] });
      assert.equal(other.status, 200);
      await other.text();
    }
    return fetch(url, init);
  };
  const tr = new MemoryTransport({ server: mock.url, fetch: racing });
  const a1 = await answerOf((await tr.send({ messages: [sys, u1] })).response);
  bump = true;
  const r = await tr.send({ messages: [sys, u1, a(a1), u2] });
  await r.response.text();
  const mine = turnsOf(mock).map((e) => e.body).filter((b) => b.request_id !== 'theirs');
  assert.equal(r.record.session, 'continued');
  assert.equal(r.record.turn, 3);
  assert.equal(mine.at(-1).previous_turn, 2);
  assert.equal(mine.at(-1).conversation, mine[0].conversation);
  assert.deepEqual(mine.at(-1).messages, [u2]);
  assert.equal(count(mock, 'undo'), 0);
});

test('a lost answer: the turn the memory took for this very request is taken back, then sent again', async (t) => {
  const mock = await mockAt(t);
  let lose = null;
  const losing = async (url, init) => {
    if (lose && String(url).endsWith('/v1/memory/input')) {
      const how = lose;
      lose = null;
      // the request reaches the memory and its answer never arrives
      await (await fetch(url, init)).text();
      if (how === 'error') return fetch(url, init);   // the next attempt is refused: turn_mismatch, last_request = it
      throw new TypeError('fetch failed');              // the connection broke: the status says whose turn it was
    }
    return fetch(url, init);
  };
  const tr = new MemoryTransport({ server: mock.url, fetch: losing });
  const a1 = await answerOf((await tr.send({ messages: [sys, u1] })).response);
  lose = 'error';
  const r2 = await tr.send({ messages: [sys, u1, a(a1), u2] });
  const a2 = await answerOf(r2.response);
  assert.equal(count(mock, 'undo'), 1);
  assert.deepEqual([mock.state.turn, r2.record.turn], [2, 2]);
  let bodies = turnsOf(mock).map((e) => e.body);
  assert.equal(bodies.length, 3);                          // the first, the lost one, the one sent again
  assert.equal(bodies[1].request_id, bodies[2].request_id);
  assert.equal(bodies[2].previous_turn, 1);
  lose = 'break';
  const r3 = await tr.send({ messages: [sys, u1, a(a1), u2, a(a2), u3] });
  await r3.response.text();
  assert.equal(count(mock, 'undo'), 2);
  assert.deepEqual([mock.state.turn, r3.record.turn], [3, 3]);
  bodies = turnsOf(mock).map((e) => e.body);
  assert.equal(bodies.at(-1).request_id, bodies.at(-2).request_id);
  assert.equal(r3.record.ok, true);
});

test('turn_in_flight: a turn waits while another conversation is answered, then goes - or gives up', async (t) => {
  const mock = await mockAt(t, { slow: 15 });
  const other = new MemoryTransport({ server: mock.url, idPrefix: 'agent' });
  const tr = new MemoryTransport({ server: mock.url, idPrefix: 'app' });
  const long = await other.send({ messages: [u1], stream: true });
  const longText = long.response.text();
  assert.equal(mock.state.inFlight, true);
  assert.equal((await tr.status()).busy, true);            // the status answers at once, and says so
  const waits = [];
  const r = await tr.send({ messages: [u2] }, { onWait: (w) => waits.push(w.reason) });
  assert.match(await answerOf(r.response), /memory turn 2/);
  assert.match(await longText, /\[DONE\]/);
  assert.ok(waits.length >= 1 && waits.every((w) => w === 'busy'), String(waits));
  assert.ok(r.record.waited > 0);
  assert.equal(tr.state().waiting, null);
  // a client that waits no longer than 200 ms gives up, and nothing of it is in the memory
  const impatient = new MemoryTransport({ server: mock.url, busyWaitMs: 200 });
  const again = await other.send({ messages: [u1, a('x'), u3], stream: true });
  const againText = again.response.text();
  await assert.rejects(impatient.send({ messages: [u3] }), (e) => e instanceof MemoryError && e.code === 'turn_in_flight');
  assert.equal(impatient.state().turns[0].ok, false);
  await againText;
  assert.equal(mock.state.turn, 3);
  assert.ok(!turnsOf(mock).some((e) => e.body.conversation?.startsWith('brain-')));
});

test('conversation_not_found: the thread opens again as a new conversation (with what was said, on a frozen memory)', async (t) => {
  const mock = await mockAt(t);
  const tr = new MemoryTransport({ server: mock.url, forgetOnNew: true });
  const a1 = await answerOf((await tr.send({ messages: [sys, u1] })).response);
  const first = turnsOf(mock)[0].body.conversation;
  mock.state.conversations.delete(first);                  // the server does not know it any more
  const r = await tr.send({ messages: [sys, u1, a(a1), u2] });
  await r.response.text();
  const b = turnsOf(mock).at(-1).body;
  assert.equal(r.record.session, 'new');
  assert.equal(b.conversation_open, true);
  assert.notEqual(b.conversation, first);
  assert.deepEqual(b.messages, [sys, u2]);                 // the memory holds what was said: no transcript
  // (an internal recovery ends nothing and forgets nothing)
  assert.deepEqual([b.end_conversations, b.forget_conversations], [undefined, undefined]);
  // a frozen memory: another client's question ended the held conversation
  const frozen = await mockAt(t, { readonly: true });
  const fr = new MemoryTransport({ server: frozen.url });
  const f1 = await answerOf((await fr.send({ messages: [sys, u1] })).response);
  const q = await json(`${frozen.url}/v1/memory/input`, { previous_turn: 412, messages: [{ role: 'user', content: 'a single question' }] });
  assert.equal(q.status, 200);
  await q.text();
  const r2 = await fr.send({ messages: [sys, u1, a(f1), u2] });
  assert.match(await answerOf(r2.response), /conversation turn 1; fronts 1/);
  assert.equal(r2.record.session, 'resumed');
  assert.match(sysOf(turnsOf(frozen).at(-1).body), /Earlier in this conversation/);
});

test('conversation_exists: another id, once', async (t) => {
  const mock = await mockAt(t);
  const tr = new MemoryTransport({ server: mock.url });
  let n = 0;
  tr.newId = () => (++n === 1 ? 'taken-id' : `brain-${n}`);
  const r0 = await json(`${mock.url}/v1/memory/input`, { previous_turn: 0, conversation: 'taken-id', conversation_open: true, messages: [u1] });
  await r0.text();
  const r = await tr.send({ messages: [u2] });
  await r.response.text();
  assert.equal(turnsOf(mock).at(-1).body.conversation, 'brain-2');
  assert.equal(r.record.turn, 2);
});

test('the server started again (another instance): the threads are dropped and open anew', async (t) => {
  const mock = await mockAt(t);
  const tr = new MemoryTransport({ server: mock.url });
  const a1 = await answerOf((await tr.send({ messages: [sys, u1] })).response);
  mock.state.instance = 'started-again';
  const r = await tr.send({ messages: [sys, u1, a(a1), u2] });
  await r.response.text();
  const [b1, b2] = turnsOf(mock).map((e) => e.body);
  assert.equal(r.record.session, 'new');
  assert.equal(b2.conversation_open, true);
  assert.notEqual(b2.conversation, b1.conversation);
  assert.equal(b2.end_conversations, undefined);           // (the old ids mean nothing to the new server)
  assert.equal(tr.state().instance, 'started-again');
  assert.equal(tr.state().conversations.length, 1);
});

test('a conversation the user starts ends the earlier ones and, when asked and offered, forgets', async (t) => {
  const { FEATURES } = await import('./mock-server.mjs');
  const mock = await mockAt(t);
  let forget = true;
  const tr = new MemoryTransport({ server: mock.url, forgetOnNew: () => forget });
  await answerOf((await tr.send({ messages: [u1] }, { key: 'a' })).response);
  await answerOf((await tr.send({ messages: [u2] }, { key: 'b' })).response);   // another transcript: neither
  tr.newSession();
  const r3 = await tr.send({ messages: [u3] }, { key: 'c' });
  await answerOf(r3.response);
  const [b1, b2, b3] = turnsOf(mock).map((e) => e.body);
  for (const b of [b1, b2]) assert.deepEqual([b.end_conversations, b.forget_conversations], [undefined, undefined]);
  assert.deepEqual([...b3.end_conversations].sort(), [b1.conversation, b2.conversation].sort());
  assert.equal(b3.forget_conversations, true);
  assert.equal(r3.record.forgot.done, true);
  assert.ok(r3.record.forgot.tokens > 0);
  assert.deepEqual([...mock.state.conversations.keys()], [b3.conversation]);
  assert.equal(tr.state().conversations.length, 1);
  // the next turn of it: neither
  const r4 = await tr.send({ messages: [u3, a('ok'), u1] }, { key: 'c' });
  await r4.response.text();
  assert.deepEqual([turnsOf(mock).at(-1).body.end_conversations, turnsOf(mock).at(-1).body.forget_conversations], [undefined, undefined]);
  // another client's conversation is in progress: nothing is forgotten, and the turn's record says so
  await (await json(`${mock.url}/v1/memory/input`, { previous_turn: mock.state.turn, conversation: 'agent-busy', conversation_open: true, messages: [u2] })).text();
  tr.newSession();
  const r5 = await tr.send({ messages: [u2] }, { key: 'd' });
  await r5.response.text();
  assert.deepEqual(r5.record.forgot, { done: false, reason: 'conversation_in_progress' });
  assert.ok(mock.state.conversations.has('agent-busy'));
  // a new start without forgetting (the persona read again), and "Remember conversations" on: ended, nothing forgotten
  tr.newSession({ forget: false });
  await (await tr.send({ messages: [u3] }, { key: 'e' })).response.text();
  forget = false;
  tr.newSession();
  await (await tr.send({ messages: [u1] }, { key: 'f' })).response.text();
  for (const b of turnsOf(mock).slice(-2).map((e) => e.body)) {
    assert.equal(b.forget_conversations, undefined);
    assert.equal(b.end_conversations.length, 1);
  }
  // a server without the feature never gets the field (it would refuse it)
  const plain = await mockAt(t, { features: FEATURES.filter((f) => f !== 'forget_conversations') });
  const tp = new MemoryTransport({ server: plain.url, forgetOnNew: true });
  tp.newSession();
  const r6 = await tp.send({ messages: [u1] });
  await r6.response.text();
  assert.equal(turnsOf(plain).at(-1).body.forget_conversations, undefined);
  assert.equal(r6.record.forgot, null);
  const refused = await json(`${plain.url}/v1/memory/input`, { previous_turn: 1, conversation: 'x-1', conversation_open: true, forget_conversations: true, messages: [u1] });
  assert.equal(refused.status, 501);
  assert.equal((await refused.json()).error.reason, 'unsupported');
});

test('an undo refused as turn_mismatch (another client took a turn meanwhile): the repeat goes on as a new turn', async (t) => {
  const mock = await mockAt(t);
  const logs = [];
  let bump = false;
  const racing = async (url, init) => {
    if (bump && String(url).endsWith('/v1/memory/undo')) {
      bump = false;
      await (await json(`${mock.url}/v1/memory/input`, { previous_turn: mock.state.turn, conversation: 'other-2', conversation_open: true, messages: [u3] })).text();
    }
    return fetch(url, init);
  };
  const tr = new MemoryTransport({ server: mock.url, fetch: racing, log: (l) => logs.push(l) });
  await (await tr.send({ messages: [sys, u1] })).response.text();
  bump = true;
  const r = await tr.send({ messages: [sys, u1] });   // asked again
  await r.response.text();
  assert.equal(r.record.ok, true);
  assert.equal(r.record.turn, 3);
  assert.equal(count(mock, 'undo'), 0);
  assert.ok(logs.some((l) => /cannot be taken back/.test(l)));
  assert.equal(turnsOf(mock).at(-1).body.conversation, turnsOf(mock)[0].body.conversation);
});
