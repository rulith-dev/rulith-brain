# Rulith Memory Protocol: reference client

`rulith-memory-client.mjs` is a tiny client of the [Rulith Memory Protocol 1.0](../rulith-memory-protocol.md)
for Node 18+ or a browser, with no dependencies (MIT). The brain has the context itself: each request carries only what
is new, with your instructions (system, tools) every time - the brain reads them only when they change.

```js
import { RulithMemoryClient } from './rulith-memory-client.mjs';

const brain = new RulithMemoryClient({ server: 'http://127.0.0.1:8091', system: 'You are a careful assistant.' });
console.log((await brain.models())[0].id);   // one model, named after the memory

await brain.ask('The migration plan waits for the database upgrade on March 3. Reply with ok.');
// later - another run, another day, another client: only the new question goes, the brain has the rest
console.log(await brain.ask('When does the migration plan go on?'));

// streamed, with a tool: the tool's result goes back as the next request's only message
const tools = [{ type: 'function', function: { name: 'lookup_order', description: 'Look up an order by its number.',
  parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'] } } }];
const r = await brain.chat({ tools, stream: true, onDelta: (d) => process.stdout.write(d.content ?? ''),
  messages: [{ role: 'user', content: 'Is order 4711 on its way?' }] });
if (r.message.tool_calls) await brain.chat({ tools, messages: r.message.tool_calls.map((c) =>
  ({ role: 'tool', tool_call_id: c.id, content: JSON.stringify({ number: '4711', status: 'shipped' }) })) });
```

`chat()` returns `{ message, finishReason, usage }`; other request fields (`max_tokens`, `reasoning_effort`, ...) pass
through. Errors are `MemoryProtocolError` with the protocol's `reason` (section 4). While the server answers `busy` or
`loading`, the client sends the request again (up to `waitMs`): nothing of such a request was kept. It never sends a
request again after a network failure or a cut stream - that request may count already, and a request sent again is
heard again (section 2.3); a cut stream's error carries the answer as far as it came (`error.partial`).

Several people speaking to the brain through one application: set `name` on each user message, chosen by the
application and the same for one person every time - `{ role: 'user', name: 'Bea', content: '...' }`. Messages go as
they are. The brain holds who said what; it does not keep one person's words from another (section 2.1).
