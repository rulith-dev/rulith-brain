// Rulith Brain Agent's web search, without an account or a key: dsh's web_search tool asks the search provider the
// profile selects, and the one dsh ships needs a paid API key of the user's. This one is Wikipedia's own search
// interface, which is free to a client that names itself - the same search the Rulith Brain app's chat uses
// (tools/manager.py brain_web_search). The search engines' result pages are not read: they answer a program off topic
// or with a verification page (measured 2026-11-19), and they are not theirs to give. A general web search stays what
// it was: another provider, with an account of the user's own (the profile's web entry names the one to use:
// memory-agent.cordis.yml).
//
// Reading a page (web_fetch) is dsh's own and needs nothing. Both go through the system's proxy when the launcher
// found one (system-proxy.mjs).

export const name = 'rulith-brain-web';
/** dsh's web seam, where a search provider registers. */
export const inject = ['web'];
/** The id this provider registers under (the profile's web entry selects it: searchProvider). */
export const PROVIDER_ID = 'rulith-wikipedia';

const USER_AGENT = 'Mozilla/5.0 (compatible; RulithBrain/1.0; +https://rulith.ai/brain.html)';
const MAX_RESULTS = 8;
const CJK = /[㐀-䶿一-鿿]/;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const plain = (markup) => String(markup ?? '').replace(/<[^>]*>/g, ' ')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  }).replace(/\s+/g, ' ').trim();

const failure = (message) => Object.assign(new Error(message), { code: 'WEB_PROVIDER_ERROR' });

/**
 * What Wikipedia lists for the words: { sources: [{ url, title, snippet? }], truncated: false, content }.
 * A query in Chinese asks the Chinese edition first, then the English one; any other the English one.
 * @param fetch - the fetch to ask with (tests give their own).
 * @param limit - how many results at most (1..8).
 * @throws an Error with code WEB_PROVIDER_ERROR when no edition answered.
 */
export async function wikipediaSearch(query, { fetch: f = globalThis.fetch, signal, limit = MAX_RESULTS, editions } = {}) {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!q) throw failure('a search needs words to search for');
  const n = Math.max(1, Math.min(MAX_RESULTS, Math.round(Number(limit)) || MAX_RESULTS));
  let last = null;
  for (const edition of editions ?? (CJK.test(q) ? ['zh', 'en'] : ['en'])) {
    const url = `https://${edition}.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srlimit: String(n), srprop: 'snippet', format: 'json' })}`;
    try {
      const r = await f(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal });
      if (!r.ok) { last = failure(`Wikipedia (${edition}) answered HTTP ${r.status}`); continue; }
      const found = (await r.json())?.query?.search;
      if (!Array.isArray(found)) { last = failure(`Wikipedia (${edition}) gave an answer that could not be read`); continue; }
      const sources = found.filter((x) => x?.title).map((x) => {
        const snippet = plain(x.snippet);
        return { url: `https://${edition}.wikipedia.org/wiki/${encodeURIComponent(String(x.title).replace(/ /g, '_'))}`, title: String(x.title), ...(snippet ? { snippet } : {}) };
      });
      if (sources.length) {
        return { sources, truncated: false,
          content: `These are Wikipedia articles (${edition}.wikipedia.org). Read one with web_fetch before relying on it; another site is read by its address.` };
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      last = failure(`Wikipedia (${edition}) could not be reached: ${error?.cause?.code ?? error?.message ?? error}`);
    }
  }
  if (last) throw last;
  return { sources: [], truncated: false, content: 'Wikipedia has no article for these words. Try other words, or read a page by its address with web_fetch.' };
}

/** dsh's search provider: { id, available(), search({ query, maxResults }, signal) }. */
export class WikipediaSearchProvider {
  id = PROVIDER_ID;

  constructor({ fetch: f } = {}) { this.fetch = f; }

  available() { return true; }

  search(request, signal) {
    return wikipediaSearch(request?.query, { fetch: this.fetch, signal, limit: request?.maxResults });
  }
}

/** Registers the provider with dsh's web service. */
export function apply(ctx) {
  ctx.web.registerSearchProvider(new WikipediaSearchProvider());
}
