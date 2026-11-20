// The agent's web search (rulith-brain-web as dsh's search provider: Wikipedia's own search without an account, or
// the service the user chose - Baidu with their key, a SearXNG address) and the system's proxy handed to the agent's
// process (system-proxy.mjs). No network: the fetch is the test's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wikipediaSearch, baiduSearch, searxngSearch, searchConfig, appSearchSettings, SearchProvider, SERVICES, PROVIDER_ID, inject, apply } from '../rulith-brain-web/lib/index.js';
import { parseProxyServer, noProxy, proxyEnv } from '../system-proxy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const answer = (found, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ query: { search: found } }) });
const HIT = [{ title: 'Zen 5', snippet: 'a <span class="searchmatch">Zen</span> core &amp; more&#39;s' }, { title: 'AMD Ryzen (series)', snippet: '' }];

test('a search asks Wikipedia by its own interface, under the client\'s own name', async () => {
  const asked = [];
  const f = async (url, init) => { asked.push([url, init.headers['User-Agent']]); return answer(HIT); };
  const r = await wikipediaSearch('  Zen   5  core ', { fetch: f, limit: 5 });
  assert.equal(asked.length, 1);
  const u = new URL(asked[0][0]);
  assert.deepEqual([u.origin + u.pathname, u.searchParams.get('srsearch'), u.searchParams.get('srlimit'), u.searchParams.get('list'), u.searchParams.get('format')],
    ['https://en.wikipedia.org/w/api.php', 'Zen 5 core', '5', 'search', 'json']);
  assert.match(asked[0][1], /RulithBrain\/[\d.]+; \+https:\/\/rulith\.ai/);
  assert.deepEqual(r.sources, [{ url: 'https://en.wikipedia.org/wiki/Zen_5', title: 'Zen 5', snippet: "a Zen core & more's" },
    { url: 'https://en.wikipedia.org/wiki/AMD_Ryzen_(series)', title: 'AMD Ryzen (series)' }]);
  assert.equal(r.truncated, false);
  assert.match(r.content, /Wikipedia articles \(en\.wikipedia\.org\)/);
});

test('a query in Chinese asks the Chinese edition first, the English one when it has nothing', async () => {
  const asked = [];
  const f = async (url) => { asked.push(new URL(url).hostname); return answer(asked.length === 1 ? [] : HIT); };
  const r = await wikipediaSearch('锐龙 处理器', { fetch: f });
  assert.deepEqual(asked, ['zh.wikipedia.org', 'en.wikipedia.org']);
  assert.equal(r.sources[0].url, 'https://en.wikipedia.org/wiki/Zen_5');
  const zh = await wikipediaSearch('锐龙', { fetch: async () => answer([{ title: '锐龙 7000', snippet: 'x' }]) });
  assert.equal(zh.sources[0].url, `https://zh.wikipedia.org/wiki/${encodeURIComponent('锐龙_7000')}`);
});

test('nothing found is an answer; a site that does not answer is an error the model can read', async () => {
  const none = await wikipediaSearch('qqqq zzzz', { fetch: async () => answer([]) });
  assert.deepEqual([none.sources, none.truncated], [[], false]);
  assert.match(none.content, /no article/);
  await assert.rejects(wikipediaSearch('x', { fetch: async () => answer([], 503) }), (e) => e.code === 'WEB_PROVIDER_ERROR' && /HTTP 503/.test(e.message));
  await assert.rejects(wikipediaSearch('x', { fetch: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }); } }),
    (e) => e.code === 'WEB_PROVIDER_ERROR' && /could not be reached: UND_ERR_CONNECT_TIMEOUT/.test(e.message));
  await assert.rejects(wikipediaSearch('x', { fetch: async () => ({ ok: true, status: 200, json: async () => ({ error: 'x' }) }) }), /could not be read/);
  await assert.rejects(wikipediaSearch('   ', { fetch: async () => answer(HIT) }), /needs words/);
  // stopped by the caller: its own error, not a provider's
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(wikipediaSearch('x', { fetch: async () => { throw new DOMException('aborted', 'AbortError'); }, signal: ctl.signal }), (e) => e.name === 'AbortError');
});

test('it is a search provider as dsh asks for one, registered with the web service and selected by the profile', async () => {
  const p = new SearchProvider({ fetch: async () => answer(HIT), config: () => ({ service: 'wikipedia' }) });
  assert.deepEqual([p.id, p.available()], [PROVIDER_ID, true]);
  assert.equal(PROVIDER_ID, 'rulith-search');
  assert.equal((await p.search({ query: 'Zen 5', maxResults: 3 })).sources.length, 2);
  const registered = [];
  apply({ web: { registerSearchProvider: (x) => registered.push(x.id) } });
  assert.deepEqual([registered, inject], [[PROVIDER_ID], ['web']]);
  // the profile loads the plugin and names its provider for the web service (dsh's own profile names dsh's, and a
  // configured id wins over everything else); the launcher copies the plugin into the profile
  const profile = fs.readFileSync(path.join(HERE, '..', 'memory-agent.cordis.yml'), 'utf8').replaceAll('\r\n', '\n');
  assert.ok(profile.includes('    - id: rulith-brain-web\n      name: rulith-brain-web\n'));
  assert.ok(profile.includes(`\n- id: web\n  config:\n    searchProvider: ${PROVIDER_ID}\n    fetchProvider: http\n`));
  assert.ok(fs.readFileSync(path.join(HERE, '..', 'start.mjs'), 'utf8').includes("'rulith-brain-web'"));
});

test('Baidu is asked through its own interface with the user\'s key, and its refusals are said on', async () => {
  const asked = [];
  const f = async (url, init) => {
    asked.push([url, init]);
    return { ok: true, status: 200, json: async () => ({ request_id: 'r', references: [
      { id: 1, title: '锐龙 AI Max+ 395 <em>实测</em>', url: 'https://example.cn/a', snippet: '内存带宽 &amp; 性能' },
      { id: 2, title: 'no address', url: '' }, { id: 3, title: '视频', url: 'https://example.cn/v', content: 'only content' }] }) };
  };
  const r = await baiduSearch(' 锐龙  AI Max+ 395 ', { key: ' KEY-1 ', fetch: f, limit: 5 });
  const [url, init] = asked[0];
  assert.deepEqual([url, init.method, init.headers.Authorization], ['https://qianfan.baidubce.com/v2/ai_search/web_search', 'POST', 'Bearer KEY-1']);
  assert.deepEqual(JSON.parse(init.body), { messages: [{ role: 'user', content: '锐龙 AI Max+ 395' }], search_source: 'baidu_search_v2', resource_type_filter: [{ type: 'web', top_k: 5 }] });
  assert.deepEqual(r.sources, [{ url: 'https://example.cn/a', title: '锐龙 AI Max+ 395 实测', snippet: '内存带宽 & 性能' }, { url: 'https://example.cn/v', title: '视频', snippet: 'only content' }]);
  assert.ok(!JSON.stringify(r).includes('KEY-1'));
  // no key: said before anything is asked, with where it is entered
  await assert.rejects(baiduSearch('x', { key: '', fetch: async () => { throw new Error('never asked'); } }), (e) => e.code === 'WEB_PROVIDER_ERROR' && /needs your API key/.test(e.message));
  const says = (status, body) => baiduSearch('x', { key: 'K', fetch: async () => ({ ok: status < 300, status, json: async () => { if (body === undefined) throw new Error('not JSON'); return body; } }) });
  await assert.rejects(says(200, { requestId: 'r', code: 216003, message: 'Authentication error' }), /^Error: Baidu: Authentication error \(216003\)$/);
  await assert.rejects(says(429, { code: 'QUOTA', message: 'free quota used up' }), /Baidu: free quota used up \(QUOTA\)/);
  await assert.rejects(says(502), /Baidu: HTTP 502/);
  await assert.rejects(says(401, { code: 216003, message: '[Code: InvalidHTTPAuthHeader; Message: Fail to parse apikey authorization]' }), /Baidu did not accept the API key/);
  await assert.rejects(baiduSearch('x', { key: 'K', fetch: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } }), /Baidu could not be reached: ENOTFOUND/);
  assert.deepEqual((await says(200, { references: [] })).sources, []);
});

test('a SearXNG instance of the user\'s own is asked by its address, in JSON', async () => {
  const asked = [];
  const f = async (url) => { asked.push(url); return { ok: true, status: 200, json: async () => ({ results: [
    { title: 'Zen 5', url: 'https://en.wikipedia.org/wiki/Zen_5', content: 'a core' }, { title: '', url: 'https://x.example' }, { title: 'A file', url: 'magnet:?x' }] }) }; };
  const r = await searxngSearch('Zen 5', { base: 'http://127.0.0.1:8080/', fetch: f });
  assert.equal(asked[0], 'http://127.0.0.1:8080/search?q=Zen+5&format=json&language=en');
  assert.deepEqual(r.sources, [{ url: 'https://en.wikipedia.org/wiki/Zen_5', title: 'Zen 5', snippet: 'a core' }]);
  await searxngSearch('锐龙', { base: 'https://search.home.example/sx', fetch: f });
  assert.match(asked[1], /^https:\/\/search\.home\.example\/sx\/search\?q=.*&format=json&language=zh-CN$/);
  await assert.rejects(searxngSearch('x', { base: '', fetch: f }), (e) => e.code === 'WEB_PROVIDER_ERROR' && /needs the address/.test(e.message));
  await assert.rejects(searxngSearch('x', { base: 'ftp://x', fetch: f }), /needs the address/);
  // an instance with its JSON format off answers 403: said so
  await assert.rejects(searxngSearch('x', { base: 'http://127.0.0.1:8080', fetch: async () => ({ ok: false, status: 403, json: async () => { throw new Error('html'); } }) }),
    /HTTP 403 without results \(it must allow the JSON format\)/);
});

test('which search: the environment first, then what is set in the Rulith Brain app, then Wikipedia', () => {
  assert.deepEqual(SERVICES, ['wikipedia', 'baidu', 'searxng']);
  assert.deepEqual(searchConfig({}, {}), { service: 'wikipedia', baiduKey: '', searxngUrl: '' });
  const app = { provider: 'baidu', baidu_key: 'APP-KEY', searxng_url: 'http://127.0.0.1:8080' };
  assert.deepEqual(searchConfig({}, app), { service: 'baidu', baiduKey: 'APP-KEY', searxngUrl: 'http://127.0.0.1:8080' });
  assert.deepEqual(searchConfig({ RULITH_BRAIN_SEARCH: ' SearXNG ', RULITH_BRAIN_SEARXNG_URL: 'http://mine:1', RULITH_BRAIN_BAIDU_KEY: 'ENV-KEY' }, app),
    { service: 'searxng', baiduKey: 'ENV-KEY', searxngUrl: 'http://mine:1' });
  // a name that is no service is not followed: the app's, else Wikipedia
  assert.equal(searchConfig({ RULITH_BRAIN_SEARCH: 'google' }, app).service, 'baidu');
  assert.equal(searchConfig({ RULITH_BRAIN_SEARCH: 'google' }, { provider: 'bing' }).service, 'wikipedia');
  // the app's settings file, read only: its brain_web entry, {} when there is none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-search-'));
  try {
    assert.deepEqual(appSearchSettings({ RULITH_BRAIN_APP_HOME: home }), {});
    fs.mkdirSync(path.join(home, 'config'));
    fs.writeFileSync(path.join(home, 'config', 'settings.json'), JSON.stringify({ roots: [], brain_web: app }));
    assert.deepEqual(appSearchSettings({ RULITH_BRAIN_APP_HOME: home }), app);
    assert.equal(searchConfig({ RULITH_BRAIN_APP_HOME: home }).service, 'baidu');
    fs.writeFileSync(path.join(home, 'config', 'settings.json'), '{ not json');
    assert.deepEqual(appSearchSettings({ RULITH_BRAIN_APP_HOME: home }), {});
    assert.deepEqual(appSearchSettings({}), {});
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the provider asks the service that is set at the time of each search', async () => {
  let set = { service: 'wikipedia' };
  const asked = [];
  const f = async (url, init) => {
    asked.push(new URL(url).hostname);
    if (/baidubce/.test(url)) return { ok: true, status: 200, json: async () => ({ references: [{ title: 'B', url: 'https://b.example' }] }) };
    if (/127\.0\.0\.1/.test(url)) return { ok: true, status: 200, json: async () => ({ results: [{ title: 'S', url: 'https://s.example' }] }) };
    return answer(HIT);
  };
  const p = new SearchProvider({ fetch: f, config: () => set });
  assert.equal((await p.search({ query: 'Zen 5' })).sources[0].title, 'Zen 5');
  set = { service: 'baidu', baiduKey: 'K' };
  assert.equal((await p.search({ query: 'Zen 5' })).sources[0].title, 'B');
  set = { service: 'searxng', searxngUrl: 'http://127.0.0.1:8080' };
  assert.equal((await p.search({ query: 'Zen 5', maxResults: 3 })).sources[0].title, 'S');
  assert.deepEqual(asked, ['en.wikipedia.org', 'qianfan.baidubce.com', '127.0.0.1']);
});

test('the system\'s proxy: one proxy for everything, one per protocol, none', () => {
  assert.equal(parseProxyServer('127.0.0.1:7897'), 'http://127.0.0.1:7897');
  assert.equal(parseProxyServer(' http://proxy.corp:8080/ '), 'http://proxy.corp:8080');
  assert.equal(parseProxyServer('http=a.corp:80;https=b.corp:443;ftp=c.corp:21'), 'http://b.corp:443');
  assert.equal(parseProxyServer('http=a.corp:80'), 'http://a.corp:80');
  for (const none of ['', null, undefined, 'socks=127.0.0.1:1080', 'not a proxy', 'host', 'host:port']) assert.equal(parseProxyServer(none), null, String(none));
  assert.equal(noProxy('localhost;127.*;*.corp.example;intranet;<local>'), 'localhost,127.0.0.1,::1,.corp.example,intranet');
  assert.equal(noProxy(''), 'localhost,127.0.0.1,::1');
});

test('the agent gets the system\'s proxy as variables - unless the user set their own, or there is none', () => {
  const on = { enable: 1, server: '127.0.0.1:7897', override: '<local>' };
  assert.deepEqual(proxyEnv(on, {}), { HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897', NO_PROXY: 'localhost,127.0.0.1,::1', NODE_USE_ENV_PROXY: '1' });
  // this PC's own addresses never go through it: the agent talks to its forwarder and to Brain on them
  assert.match(proxyEnv({ ...on, override: 'example.org' }, {}).NO_PROXY, /^localhost,127\.0\.0\.1,::1,example\.org$/);
  assert.equal(proxyEnv(on, { NO_PROXY: 'mine.example' }).NO_PROXY, 'mine.example');
  // the user's own proxy variables win, and are followed: Node reads them only when told to; this PC's own addresses
  // join their NO_PROXY when they are not in it
  for (const own of ['HTTP_PROXY', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY'])
    assert.deepEqual(proxyEnv(on, { [own]: 'http://mine:1' }), { NODE_USE_ENV_PROXY: '1', NO_PROXY: 'localhost,127.0.0.1,::1' }, own);
  assert.deepEqual(proxyEnv(null, { HTTPS_PROXY: 'http://mine:1', NO_PROXY: 'LocalHost, 127.0.0.1 ,::1,.corp' }), { NODE_USE_ENV_PROXY: '1' });
  assert.deepEqual(proxyEnv(on, { HTTPS_PROXY: 'http://mine:1', no_proxy: '.corp' }), { NODE_USE_ENV_PROXY: '1', NO_PROXY: '.corp,localhost,127.0.0.1,::1' });
  // "no" is the user's to say
  assert.deepEqual(proxyEnv(on, { NODE_USE_ENV_PROXY: '0' }), {});
  assert.deepEqual(proxyEnv(on, { NODE_USE_ENV_PROXY: '0', HTTPS_PROXY: 'http://mine:1' }), {});
  assert.deepEqual(proxyEnv({ ...on, enable: 0 }, {}), {});
  assert.deepEqual(proxyEnv({ enable: 1, server: 'socks=127.0.0.1:1080' }, {}), {});
  assert.deepEqual(proxyEnv(null, {}), {});
});
