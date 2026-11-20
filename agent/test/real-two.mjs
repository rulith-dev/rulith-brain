#!/usr/bin/env node
// Two clients on ONE real memory server (update mode), each through brain-core.mjs as the app's page and the agent's
// forwarder use it: full chat transcripts in, memory turns out.
//
//   node test/real-two.mjs [--server http://127.0.0.1:8091]
//
// The agent has instructions and a tool; the app has neither. They take turns:
//   1. the agent's question -> a tool call;  2. the app's question in between;  3. the tool's result -> the answer;
//   4. the app goes on;  5. the app asks its last message again (its turn is taken back first);
//   6. the agent's next task -> a tool call;  7. the app starts a NEW conversation with "Remember conversations" off:
//      nothing is forgotten while the agent's task is in progress, and the turn's record says so;
//   8. the tool's result -> the agent's answer: its conversation is still whole;  9. what the status lists.
// It leaves a handful of short turns in the memory. One line per check, RESULT PASS / FAIL, exit code 0 or 1.
import { MemoryTransport } from '../brain-core.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--server');
const server = String(at >= 0 ? argv[at + 1] : process.env.RULITH_MEMORY_SERVER || 'http://127.0.0.1:8091').replace(/\/+$/, '');

let passed = 0;
let failed = 0;
const check = (ok, text, detail) => {
  if (ok) { passed += 1; console.log(`PASS ${text}`); } else {
    failed += 1;
    console.log(`FAIL ${text}${detail === undefined ? '' : ` :: ${(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}`}`);
  }
  return ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOOLS = [{ type: 'function', function: { name: 'get_shipment', description: 'Where a shipment is now, by its code.',
  parameters: { type: 'object', properties: { code: { type: 'string', description: "the shipment's code" } }, required: ['code'] } } }];
const AGENT_SYS = 'You are a logistics agent. To find where a shipment is you MUST call the tool get_shipment with its code; '
  + 'never guess a location. After the tool answers, report the location in one short sentence.';

let forget = false;
const waits = [];
const agent = new MemoryTransport({ server, brain: { enabled: true }, idPrefix: 'agent', busyWaitMs: 900_000 });
const app = new MemoryTransport({ server, brain: { enabled: true }, idPrefix: 'app', forgetOnNew: () => forget, onWait: (w) => waits.push(w) });

// one chat request (the whole transcript, as a chat client sends it) -> { msg, record, seconds }
async function ask(tr, messages, extra = {}) {
  const t0 = Date.now();
  const { response, record } = await tr.send({ messages, max_tokens: 400, reasoning_effort: 'low', ...extra });
  const j = await response.json();
  await sleep(50);   // (the record is completed as the answer's last bytes pass)
  return { msg: j?.choices?.[0]?.message ?? {}, record, j, seconds: ((Date.now() - t0) / 1000).toFixed(1) };
}
const status = async () => (await fetch(`${server}/v1/memory/status`)).json();
const idle = async () => { for (let i = 0; i < 600; i += 1) { const s = await status(); if (!s.busy) return s; await sleep(500); } throw new Error('busy'); };

async function main() {
  const s0 = await idle();
  if (!check(s0.mode === 'update' && s0.protocol?.name === 'rulith-memory', 'an update-mode server that speaks the protocol', s0.protocol)) return;

  // 1. the agent's first turn
  const A = [{ role: 'system', content: AGENT_SYS }, { role: 'user', content: 'Where is shipment ZX-4471?' }];
  let a = await ask(agent, A, { tools: TOOLS });
  let calls = a.msg.tool_calls ?? [];
  const ok1 = check(calls.length === 1 && calls[0].function?.name === 'get_shipment' && String(calls[0].function.arguments).includes('ZX-4471'),
    `agent: its first turn calls the tool (${a.seconds} s)`, a.j);
  const convA = a.record?.conversation;
  check(typeof convA === 'string' && convA.startsWith('agent-'), 'agent: the turn opened a conversation of its own', a.record);

  // 2. the app in between
  const P = [{ role: 'user', content: 'What is 17 + 26? Answer with the number only.' }];
  let p = await ask(app, P);
  check(!p.msg.tool_calls?.length && String(p.msg.content ?? '').includes('43'), `app: a question between the call and its result, no tool call (${p.seconds} s)`, p.j);
  const convP = p.record?.conversation;
  check(typeof convP === 'string' && convP.startsWith('app-') && convP !== convA, 'app: a conversation of its own', p.record);

  // 3. the tool's result
  if (ok1) {
    A.push({ role: 'assistant', content: a.msg.content ?? '', tool_calls: calls });
    A.push({ role: 'tool', tool_call_id: calls[0].id ?? 'call_1', content: JSON.stringify({ code: 'ZX-4471', location: 'Rotterdam, bay 12' }) });
    a = await ask(agent, A, { tools: TOOLS });
    check(/rotterdam/i.test(a.msg.content ?? ''), `agent: the tool's result after the app's turn is used (${a.seconds} s)`, a.j);
    check(a.record?.conversation === convA, 'agent: the same conversation');
    A.push({ role: 'assistant', content: a.msg.content ?? '' });
  }

  // 4. the app goes on, 5. and asks again
  P.push({ role: 'assistant', content: p.msg.content ?? '' });
  P.push({ role: 'user', content: 'And that number minus 5? Answer with the number only.' });
  p = await ask(app, P);
  check(!p.msg.tool_calls?.length && String(p.msg.content ?? '').includes('38'), `app: its conversation goes on (${p.seconds} s)`, p.j);
  const turnAfter4 = (await idle()).turn;
  p = await ask(app, P);
  const sAgain = await idle();
  check(String(p.msg.content ?? '').includes('38') && sAgain.turn === turnAfter4, 'app: the same message again took its turn back first (the turn count did not grow)',
    { turn: sAgain.turn, was: turnAfter4, session: p.record?.session });

  // 6. the agent's next task
  A.push({ role: 'user', content: 'Now shipment QP-9000, the same way.' });
  a = await ask(agent, A, { tools: TOOLS });
  calls = a.msg.tool_calls ?? [];
  const ok6 = check(calls.length === 1 && String(calls[0].function?.arguments).includes('QP-9000'), `agent: back in its conversation it calls the tool again (${a.seconds} s)`, a.j);

  // 7. the app's user starts a new conversation and does not want conversations remembered
  const canForget = (sAgain.features ?? []).includes('forget_conversations');
  forget = true;
  app.newSession();
  const P2 = [{ role: 'user', content: 'What is the capital of France? One word.' }];
  p = await ask(app, P2);
  check(/paris/i.test(p.msg.content ?? ''), `app: a new conversation answers (${p.seconds} s)`, p.j);
  if (canForget) {
    check(p.record?.forgot?.done === false && p.record.forgot.reason === 'conversation_in_progress',
      'app: nothing was forgotten while the agent is in the middle of its task, and the record says so', p.record?.forgot ?? p.record);
  } else {
    console.log('INFO this memory does not forget conversations: the request was not made');
    check(p.record?.forgot === undefined || p.record?.forgot === null, 'app: no forgetting asked where the feature is not listed', p.record?.forgot);
  }
  forget = false;

  // 8. the agent's tool result
  if (ok6) {
    A.push({ role: 'assistant', content: a.msg.content ?? '', tool_calls: calls });
    A.push({ role: 'tool', tool_call_id: calls[0].id ?? 'call_2', content: JSON.stringify({ code: 'QP-9000', location: 'Gdansk, yard C' }) });
    a = await ask(agent, A, { tools: TOOLS });
    check(/gda/i.test(a.msg.content ?? '') && a.record?.conversation === convA, `agent: its conversation is whole after the app's new one (${a.seconds} s)`, a.j);
  }

  // 9. the status
  const s9 = await idle();
  const ids = new Map((s9.conversations ?? []).map((c) => [c.id, c]));
  check(ids.has(convA) && ids.get(convA).tools === 1, "the status lists the agent's conversation with its tool", s9.conversations);
  check(!ids.has(convP), "the app's first conversation is ended (the new one named it)", [...ids.keys()]);
  check(ids.has(p.record?.conversation) && ids.get(p.record.conversation).tools === 0, "the app's new conversation is listed, without tools", s9.conversations);
  if (waits.length) console.log(`INFO the app waited ${waits.length} time(s) for another conversation's answer`);
}

main().catch((e) => { failed += 1; console.log(`FAIL the run stopped: ${e?.stack ?? e}`); }).finally(() => {
  console.log(`RESULT ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed)`);
  process.exitCode = failed === 0 ? 0 : 1;
});
