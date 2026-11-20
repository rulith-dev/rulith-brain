// The loopback forwarder: an OpenAI client's requests (dsh's, or any other's), sent to Rulith Brain's memory server as
// one turn at a time of the Rulith Memory Protocol. The turn logic - what is cut, the conversation each transcript goes
// on in, when a turn is taken back (and what happens when the server cannot take it back any more), waiting while
// another conversation is answered, brain mode - is brain-core.mjs, shared with Rulith Brain's own page
// (integrations/brain-ui) and the Rulith Inference app's chat.
//
//   POST /v1/chat/completions   one chat request -> one memory turn (<server>/v1/memory/input), streamed or not. The
//                               answer carries the server's X-Memory-Turn, X-Memory-Focus, X-Brain-Append and
//                               X-Memory-Recall, and X-Brain-Session: new | continued | resumed | retaken.
//                               The transcript's name, when the client has one: the header X-Brain-Conversation.
//                               A turn that meets another conversation's answer in the app waits for it (busyWaitMs,
//                               15 minutes: a tool result must not be lost to a long answer there)
//   GET  /v1/models             passes through
//   GET  /brain/state           what a page shows: the server as last seen, the settings, the conversations, the last
//                               turns, and "reach": whether the server answered when it was last asked - up, loading (it
//                               answers 503 while it loads its model), down (?refresh=1 asks the server again)
//   POST /brain/windows         {"windows": [w, ...]} -> the label and source text of memory windows (what a turn
//                               recalled), from the server's /v1/memory/windows
//   POST /brain/sources         {"ids": [...]} -> the passages an answer drew on, from the server's /v1/memory/sources
//   POST /brain/session/new     the next request opens a new conversation (the agent's earlier ones end)
//   POST /brain/settings        {"learn_research": true | false}: the switch "Learn from research"
//   GET  /brain                 a small page of the above
//
// Learning from research (research-learn.mjs): once a turn has been answered, the web pages among its new tool results
// (what the agent opened with web_fetch) go to the memory's learn queue, each once; nothing waits for that.
import http from 'node:http';
import { MemoryTransport, MemoryError, errorFrom } from './brain-core.mjs';
import { ResearchLearner } from './research-learn.mjs';

export * from './brain-core.mjs';
export * from './research-learn.mjs';

// how long a turn waits while the app's own chat (another conversation) is being answered
export const AGENT_BUSY_WAIT_MS = 15 * 60 * 1000;

const HTTP_OF = { server_down: 502, loading: 503, turn_in_flight: 503, memory_off: 409, one_slot: 409, brain_unavailable: 409, brain_invalid: 409, memory_load: 500 };
// what the agent's page and its user are told when Rulith Brain does not answer (the server's own words go to the log)
export const PLAIN = {
  down: 'Rulith Brain is not running. Open Rulith Brain and press "Load the model and start"; keep the app open while you use the agent.',
  loading: 'Rulith Brain is loading the model. This takes a few minutes; the agent goes on when it is ready.',
};
const reachOf = (error) => (error?.code === 'loading' ? 'loading' : error?.code === 'server_down' ? 'down' : null);

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * Waits until Rulith Brain's memory server answers with its model loaded: while nothing listens at `server`, or it
 * answers 503 (the model is loading), it says so once in plain words (`log`) and asks again every `every` ms. A server
 * that answers but cannot serve the agent (no memory mode, a key it refuses) ends the wait with a MemoryError.
 * @returns { status, model } - the server's status and the id of its model.
 */
export async function waitForServer({ server, headers = {}, fetch: f = globalThis.fetch, log = () => {}, every = 3000, signal } = {}) {
  const base = String(server).replace(/\/+$/, '');
  let said = null;
  const get = async (path) => {
    let r;
    try { r = await f(base + path, { headers }); } catch (error) {
      throw new MemoryError(`memory server ${path}: ${error?.message ?? error}`, { code: 'server_down' });
    }
    const text = await r.text();
    if (!r.ok) {
      const error = errorFrom(`memory server ${path}`, r.status, text);
      if (r.status === 401 || r.status === 403) error.code = 'auth';
      else if (r.status === 404) error.code = 'memory_off';
      throw error;
    }
    try { return JSON.parse(text); } catch { return { raw: text }; }
  };
  for (;;) {
    if (signal?.aborted) throw new MemoryError('stopped while waiting for the memory server', { code: 'server_down' });
    let state;
    try {
      const status = await get('/v1/memory/status');
      if (status?.memory_mode === false) throw new MemoryError('memory mode is off', { code: 'memory_off' });
      const model = (await get('/v1/models'))?.data?.[0]?.id;
      if (model) {
        if (said) log('Rulith Brain is ready.');
        return { status, model };
      }
      state = 'loading';   // (it answers, and lists no model yet)
    } catch (error) {
      state = reachOf(error);
      if (!state) throw error;
    }
    if (state !== said) log(PLAIN[state] + (state === 'down' ? ` (waiting for it at ${base})` : ''));
    said = state;
    await sleep(every, signal);
  }
}
const PASS = ['x-memory-turn', 'x-memory-focus', 'x-brain-append', 'x-memory-recall'];
const NAME = { 'x-memory-turn': 'X-Memory-Turn', 'x-memory-focus': 'X-Memory-Focus', 'x-brain-append': 'X-Brain-Append', 'x-memory-recall': 'X-Memory-Recall' };

/**
 * @param server - the memory server.
 * @param brain - brain mode's settings (brain-core.mjs); { enabled: true } turns it on.
 * @param headers - sent to the server with every request (its API key).
 * @param panel - the HTML of GET /brain, when there is one.
 * @param learn - learning from research: { research: the switch (default on), onChange({ research }) when the page
 *   changes it, limits (research-learn.mjs RESEARCH_DEFAULTS) }.
 * @param busyWaitMs - how long a turn waits for another conversation's answer, or for the model to load.
 * @returns { proxy, transport, learner }.
 */
export function createMemoryProxy({ server, log = () => {}, fetch: f = globalThis.fetch, brain = {}, headers = {}, panel, learn = {},
  busyWaitMs = AGENT_BUSY_WAIT_MS }) {
  const transport = new MemoryTransport({ server, log, fetch: f, brain, headers, idPrefix: 'agent', busyWaitMs });
  const learner = new ResearchLearner({ transport, log, research: learn.research !== false, onChange: learn.onChange, limits: learn.limits });
  // whether the server answered when it was last asked: { state: 'up' | 'loading' | 'down' | null, at }
  let reach = { state: null, at: null };
  const saw = (state) => { if (state) reach = { state, at: new Date().toISOString() }; };
  const json = (res, code, body) => {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const fail = (res, error) => {
    const code = error instanceof MemoryError ? error.code : 'forwarder_error';
    const status = HTTP_OF[code] ?? (error?.status >= 400 ? error.status : 400);
    // (Rulith Brain not running, or loading its model: said in plain words to the agent's user; the log has the rest)
    const plain = PLAIN[reachOf(error)];
    json(res, status, { error: { message: plain ?? String(error?.message ?? error), type: 'memory_agent', code } });
  };
  const proxy = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname.replace(/\/+$/, '');
      let answered = null;   // the chat request whose turn the server took: its pages are learned after the answer
      try {
        if (req.method === 'GET' && path.endsWith('/models')) {
          const r = await f(transport.server + '/v1/models', { headers });
          res.writeHead(r.status, { 'Content-Type': 'application/json' });
          res.end(await r.text());
          return;
        }
        if (req.method === 'GET' && path === '/brain/state') {
          if (url.searchParams.get('refresh') === '1')
            await transport.serial(() => transport.status(true)).then(() => saw('up'), (e) => { transport.failed(e); saw(reachOf(e)); });
          return json(res, 200, { ...transport.state(), reach, learn: learner.state() });
        }
        if (req.method === 'POST' && path === '/brain/settings') {
          // (JSON only: a page of another site cannot send that without asking first, and nothing here answers it)
          if (!/^application\/json\b/i.test(req.headers['content-type'] ?? ''))
            return json(res, 415, { error: { message: 'a JSON body is expected', type: 'memory_agent', code: 'bad_request' } });
          const asked = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (typeof asked?.learn_research !== 'boolean')
            return json(res, 400, { error: { message: '"learn_research": true or false', type: 'memory_agent', code: 'bad_request' } });
          learner.configure({ research: asked.learn_research });
          return json(res, 200, { learn: learner.state() });
        }
        if (req.method === 'POST' && path === '/brain/windows') {
          const asked = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}').windows;
          if (!Array.isArray(asked)) return json(res, 400, { error: { message: '"windows": an array of window numbers', type: 'memory_agent', code: 'bad_request' } });
          return json(res, 200, { windows: await transport.windows(asked.slice(0, 256)) });
        }
        if (req.method === 'POST' && path === '/brain/sources') {
          const asked = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}').ids;
          if (!Array.isArray(asked)) return json(res, 400, { error: { message: '"ids": an array of source ids', type: 'memory_agent', code: 'bad_request' } });
          return json(res, 200, { sources: await transport.sources(asked.slice(0, 256)) });
        }
        if (req.method === 'POST' && path === '/brain/session/new') { transport.newSession(); return json(res, 200, { ok: true }); }
        if (req.method === 'GET' && path === '/brain' && panel) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(panel);
          return;
        }
        if (req.method !== 'POST' || !path.endsWith('/chat/completions'))
          return json(res, 404, { error: { message: `memory agent: no route ${path}`, type: 'memory_agent', code: 'no_route' } });
        const params = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const ac = new AbortController();
        res.on('close', () => { if (!res.writableFinished) ac.abort(); });
        const key = req.headers['x-brain-conversation'] || undefined;
        // the turn goes out (and gets its number) before the next request may read the memory's turn
        const { response: r, record } = await transport.send(params, { key, signal: ac.signal, accept: req.headers.accept });
        answered = params;
        saw('up');
        const out = { 'Content-Type': r.headers.get('content-type') ?? 'application/json', 'X-Brain-Session': record.session };
        for (const h of PASS) { const v = r.headers.get(h); if (v !== null) out[NAME[h]] = v; }
        res.writeHead(r.status, out);
        if (!r.body) { res.end(); return; }
        for await (const part of r.body) res.write(part);
        res.end();
      } catch (error) {
        if (error?.name === 'AbortError') { res.end(); return; }
        log(`memory agent: ${error.message}`);
        saw(reachOf(error));
        fail(res, error);
      } finally {
        // (the answer has gone out, or was cut off: the pages the turn carried were read all the same)
        if (answered) learner.observe(answered);
      }
    });
  });
  return { proxy, transport, learner };
}
