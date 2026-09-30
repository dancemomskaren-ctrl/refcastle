import type { Reference, SourceKey } from './types';
import { RequestError } from './decision';
import { imageIdentity, referenceKeys, ReferenceIdentity } from './reference-identity';

export const SOURCE_KEYS: SourceKey[] = ['met', 'cosmos', 'nasa', 'unsplash', 'pexels', 'openverse', 'flickr', 'pinterest'];
export const REFERENCES_PER_SOURCE = 20;
export const CREATOR_TARGET = 100;
export const DEFAULT_SEARCHES: Record<SourceKey, string> = {
  met: 'Anna Atkins',
  cosmos: 'botanical exhibition typography',
  nasa: 'spacecraft interior',
  unsplash: 'botanical still life',
  pexels: 'greenhouse plants light',
  openverse: 'browser observation illustration',
  flickr: 'botanical garden macro',
  pinterest: 'botanical cyanotype',
};
export const SOURCE_NAMES: Record<SourceKey, string> = { met: 'The Met', cosmos: 'Cosmos', nasa: 'NASA', unsplash: 'Unsplash', pexels: 'Pexels', openverse: 'Openverse', flickr: 'Flickr', pinterest: 'Pinterest' };
export const SOURCE_METHODS: Record<SourceKey, string> = {
  met: 'Met Open Access API',
  cosmos: 'Cosmos public search page',
  nasa: 'NASA Image and Video Library API',
  unsplash: 'Unsplash API',
  pexels: 'Pexels API',
  openverse: 'Openverse API',
  flickr: 'Flickr API',
  pinterest: 'Pinterest public search response',
};
export const SOURCE_BADGES: Record<SourceKey, string> = { met: 'Met', cosmos: '✳', nasa: 'N', unsplash: 'U', pexels: 'P', openverse: 'O', flickr: 'F', pinterest: 'P' };
export const SOURCE_DESCRIPTIONS: Record<SourceKey, string> = {
  met: 'Historical artwork, objects, prints and photographs',
  cosmos: 'Contemporary visual references and design',
  nasa: 'Scientific space and Earth imagery',
  unsplash: 'Open-license community photography',
  pexels: 'Free stock photography',
  openverse: 'Openly licensed images across the web',
  flickr: 'Community photography under open licenses',
  pinterest: 'Community-saved visual references',
};

/** Optional provider keys are supplied by the local server from .env; the hosted bundle never reads the environment. */
const providerKeys: Record<string, string | undefined> = {};
export function configureSourceKeys(keys: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(keys)) providerKeys[name] = typeof value === 'string' ? value.trim() : undefined;
}
export function providerKeyValue(name: string) { return providerKeys[name] || ''; }

export type SourceCollector = (query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number, page: number) => Promise<number>;

export interface SourceDefinition {
  key: SourceKey;
  /** Environment variable that must hold a valid key before this source activates. */
  requiresKey?: string;
  /** Plentiful community sources are held back while institutional ones run short. */
  guarded?: boolean;
  /** Shorter retry phrases make sense for this collection. */
  canShorten: boolean;
  searchUrl: (query: string) => string;
  collect: SourceCollector;
}

const clean = (value: unknown, max = 1200) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export function safeImage(value: unknown) {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value);
    const hosts = ['images-assets.nasa.gov', 'images.nasa.gov', 'www.nasa.gov', 'images.metmuseum.org', 'collectionapi.metmuseum.org', 'cdn.cosmos.so', 'images.unsplash.com', 'images.pexels.com', 'api.openverse.org', 'live.staticflickr.com', 'i.pinimg.com'];
    return u.protocol === 'https:' && hosts.includes(u.hostname) ? value : '';
  } catch { return ''; }
}
async function get(url: string, signal: AbortSignal, headers: Record<string, string> = {}) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(22_000)]), headers: { Accept: 'application/json, text/html', 'User-Agent': 'JevCurator/0.3 (visual reference explorer)', ...headers } });
  if (!response.ok) throw new Error(`The source returned HTTP ${response.status}.`);
  return response;
}
const stamp = (ref: Omit<Reference, 'retrievedAt'>): Reference => ({ ...ref, retrievedAt: new Date().toISOString() });

// Extract a JSON object from the public search response without evaluating page scripts.
export function publicSearchResults(html: string): any[] {
  const marker = '"searchElements":';
  const start = html.indexOf(marker);
  if (start < 0) return [];
  let depth = 0, quoted = false, escaped = false;
  const from = start + marker.length;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      const data = JSON.parse(html.slice(from, i + 1));
      return Array.isArray(data.results) ? data.results : [];
    }
  }
  return [];
}

export function cosmosReferences(html: string): Reference[] {
  return publicSearchResults(html).flatMap(row => {
    const e = row?.element;
    const img = safeImage(e?.media?.url);
    if (!e || !Number.isSafeInteger(e.id) || !img || e.contentAccessibility !== 'ACCESSIBLE' || e.media?.__typename !== 'StaticImage' || e.media?.notSafeForWorkStatus !== 'SAFE') return [];
    const caption = clean(e.generatedCaption?.text);
    return [stamp({ id: `cosmos-${e.id}`, title: caption.slice(0, 110) || 'Untitled Cosmos reference', description: caption || 'No descriptive caption was supplied.', credit: `Saved by ${clean(e.owner?.username, 80) || 'a Cosmos member'}. Original attribution: ${clean(e.source?.author?.fullName, 120) || clean(e.source?.author?.username, 120) || 'not supplied'}.`, date: clean(e.createdAt, 30), image: `${img}?format=webp&w=800`, source: `https://www.cosmos.so/e/${e.id}`, collection: 'Contemporary references', sourceName: 'Cosmos', sourceKey: 'cosmos' as const, descriptionOrigin: 'Cosmos generated caption; author and subject claims have not been independently verified.' })];
  });
}

// Unsplash: official API; each result carries photographer attribution and a stable photo page.
const unsplashSearchUrl = (query: string) => `https://unsplash.com/s/photos/${encodeURIComponent(query)}`;
async function collectUnsplash(query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number, page: number) {
  const key = providerKeyValue('UNSPLASH_ACCESS_KEY');
  const perPage = Math.max(1, Math.min(30, limit));
  const payload = await (await get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&content_filter=high`, signal, { Authorization: `Client-ID ${key}` })).json() as any;
  for (const photo of payload?.results || []) {
    const img = safeImage(photo?.urls?.small || photo?.urls?.regular);
    if (!photo?.id || !img) continue;
    const text = clean(photo.alt_description || photo.description, 600);
    receive(stamp({ id: `unsplash-${photo.id}`, title: text.slice(0, 110) || 'Untitled Unsplash photograph', description: text || 'No description was supplied by the photographer.', credit: `${clean(photo.user?.name, 120) || 'Unknown photographer'} / Unsplash`, date: clean(photo.created_at, 40), image: img, source: clean(photo.links?.html, 300) || `https://unsplash.com/photos/${photo.id}`, collection: 'Community photography', sourceName: 'Unsplash', sourceKey: 'unsplash', descriptionOrigin: 'Unsplash photographer alt text; verify the original page before reuse.' }));
  }
  return payload?.results?.length || 0;
}

// Pexels: official API; Authorization header carries the key directly.
const pexelsSearchUrl = (query: string) => `https://www.pexels.com/search/${encodeURIComponent(query)}/`;
async function collectPexels(query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number, page: number) {
  const key = providerKeyValue('PEXELS_API_KEY');
  const perPage = Math.max(1, Math.min(30, limit));
  const payload = await (await get(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`, signal, { Authorization: key })).json() as any;
  for (const photo of payload?.photos || []) {
    const img = safeImage(photo?.src?.large || photo?.src?.medium);
    if (!photo?.id || !img) continue;
    const text = clean(photo.alt, 600);
    receive(stamp({ id: `pexels-${photo.id}`, title: text.slice(0, 110) || `Pexels photograph ${photo.id}`, description: text || 'No description was supplied by the photographer.', credit: `${clean(photo.photographer, 120) || 'Unknown photographer'} / Pexels`, date: '', image: img, source: clean(photo.url, 300) || pexelsSearchUrl(query), collection: 'Stock photography', sourceName: 'Pexels', sourceKey: 'pexels', descriptionOrigin: 'Pexels photographer alt text; verify the original page before reuse.' }));
  }
  return payload?.photos?.length || 0;
}

// Openverse: WordPress's openly licensed index; anonymous access needs no key.
const openverseSearchUrl = (query: string) => `https://openverse.org/search/?q=${encodeURIComponent(query)}`;
async function collectOpenverse(query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number, page: number) {
  const perPage = Math.max(1, Math.min(20, limit));
  const payload = await (await get(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${perPage}&page=${page}`, signal)).json() as any;
  for (const item of payload?.results || []) {
    const img = safeImage(item?.thumbnail);
    if (!item?.id || !img) continue;
    const license = clean(item.license, 40).toUpperCase();
    receive(stamp({ id: `openverse-${item.id}`, title: clean(item.title, 110) || 'Untitled open-license image', description: clean(item.title, 600) || 'No description was supplied by the provider.', credit: `${clean(item.creator, 120) || 'Unknown creator'} · ${license || 'See original'} license via ${clean(item.provider, 60) || 'Openverse'}`, date: '', image: img, source: clean(item.foreign_landing_url, 300) || openverseSearchUrl(query), collection: 'Openly licensed media', sourceName: 'Openverse', sourceKey: 'openverse', descriptionOrigin: 'Openverse provider metadata; check the license terms at the original page before reuse.' }));
  }
  return payload?.results?.length || 0;
}

// Pinterest: unofficial public search endpoint. Unauthenticated requests work but are rate limited;
// PINTEREST_COOKIE (your browser's Pinterest cookie header) enables the authenticated rate tier.
const pinterestSearchUrl = (query: string) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
async function collectPinterest(query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number, page: number) {
  const cookie = providerKeyValue('PINTEREST_COOKIE');
  const options = {
    article: null, boards: '', auto_correction_disabled: false, corrupted_pins: null,
    appliedProductFilters: '---', filters: null, query, page_size: 25,
    bookmarks: page > 1 && page <= 10 ? [String(page - 1)] : [],
    redux_normalize_feed: true, rs: 'typed_search', scope: 'pins',
    source_module_base_name: 'baseSearchResult', no_fetch_context_on_resource: false,
  };
  const headers: Record<string, string> = {
    Accept: 'application/json, text/javascript, */*, q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Pinterest-AppState': 'active',
    'X-Pinterest-PWS-Handler': 'www/search/[scope].js',
    'X-Pinterest-Source-URL': `/search/pins/?q=${encodeURIComponent(query)}`,
    Referer: pinterestSearchUrl(query),
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };
  if (cookie) headers.Cookie = cookie;
  const payload = await (await get(`https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(`/search/pins/?q=${query}`)}&data=${encodeURIComponent(JSON.stringify({ options, context: {} }))}`, signal, headers)).json() as any;
  const rows: any[] = payload?.resource_response?.data?.results || [];
  for (const row of rows) {
    if (!row || row.type !== 'pin' || !row.id) continue;
    const img = safeImage(row.images?.['736x']?.url || row.images?.['474x']?.url || row.images?.['236x']?.url);
    if (!img) continue;
    const text = clean(typeof row.title === 'string' ? row.title : row.grid_title, 600);
    const description = clean(row.description, 600);
    receive(stamp({
      id: `pinterest-${row.id}`, title: text.slice(0, 110) || 'Saved visual reference',
      description: description || text || 'No description was supplied by the saver.',
      credit: `Saved by ${clean(row.pinner?.username, 80) || 'a Pinterest member'}. Original attribution: ${clean(row.attribution?.author_name, 120) || clean(row.link, 120) || 'not supplied'}.`,
      date: clean(row.created_at, 40), image: img,
      source: `https://www.pinterest.com/pin/${row.id}/`, collection: 'Community references',
      sourceName: 'Pinterest', sourceKey: 'pinterest',
      descriptionOrigin: 'Pinterest saver metadata; claims are unverified. Check the original link before reuse.',
    }));
  }
  return rows.filter((row: any) => row?.type === 'pin').length;
}

// Flickr: official API restricted to open license families so reuse terms are checkable.
const FLICKR_OPEN_LICENSES = '1,2,3,4,5,6,9,10';
const flickrSearchUrl = (query: string) => `https://www.flickr.com/search/?text=${encodeURIComponent(query)}&license=${encodeURIComponent(FLICKR_OPEN_LICENSES)}`;
async function collectFlickr(query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number, page: number) {
  const key = providerKeyValue('FLICKR_API_KEY');
  const perPage = Math.max(1, Math.min(30, limit));
  const params = new URLSearchParams({ method: 'flickr.photos.search', api_key: key, text: query, per_page: String(perPage), page: String(page), format: 'json', nojsoncallback: '1', safe_search: '1', media: 'photos', sort: 'relevance', license: FLICKR_OPEN_LICENSES });
  const payload = await (await get(`https://www.flickr.com/services/rest/?${params}`, signal)).json() as any;
  if (payload?.stat === 'fail') throw new Error(`Flickr rejected the search: ${clean(payload.message, 120) || 'unknown API error'}.`);
  for (const photo of payload?.photos?.photo || []) {
    if (!photo?.id || !photo?.secret || !photo?.server) continue;
    const img = safeImage(`https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_n.jpg`);
    if (!img) continue;
    receive(stamp({ id: `flickr-${photo.id}`, title: clean(photo.title, 110) || 'Untitled Flickr photograph', description: clean(photo.title, 600) || 'No description was supplied by the photographer.', credit: `Flickr photographer · open license; verify at the original page`, date: '', image: img, source: `https://www.flickr.com/photo.gne?id=${photo.id}`, collection: 'Community photography', sourceName: 'Flickr', sourceKey: 'flickr', descriptionOrigin: 'Flickr search metadata; the license and full title live on the original photo page.' }));
  }
  return payload?.photos?.photo?.length || 0;
}

export const SOURCES: SourceDefinition[] = [
  { key: 'met', canShorten: true, searchUrl: q => `https://www.metmuseum.org/art/collection/search?q=${encodeURIComponent(q)}&showOnly=openAccess`, collect: () => { throw new Error('The Met uses its dedicated collection path.'); } },
  { key: 'cosmos', guarded: true, canShorten: false, searchUrl: q => `https://www.cosmos.so/search/elements/${encodeURIComponent(q)}`, collect: () => { throw new Error('Cosmos uses its dedicated public-page path.'); } },
  { key: 'nasa', canShorten: true, searchUrl: q => `https://images.nasa.gov/search?q=${encodeURIComponent(q)}&page=1&media=image&yearStart=1920&yearEnd=${new Date().getFullYear()}`, collect: () => { throw new Error('NASA uses its dedicated collection path.'); } },
  { key: 'unsplash', requiresKey: 'UNSPLASH_ACCESS_KEY', canShorten: true, searchUrl: unsplashSearchUrl, collect: collectUnsplash },
  { key: 'pexels', requiresKey: 'PEXELS_API_KEY', canShorten: true, searchUrl: pexelsSearchUrl, collect: collectPexels },
  { key: 'openverse', canShorten: true, searchUrl: openverseSearchUrl, collect: collectOpenverse },
  { key: 'flickr', requiresKey: 'FLICKR_API_KEY', canShorten: true, searchUrl: flickrSearchUrl, collect: collectFlickr },
  { key: 'pinterest', guarded: true, canShorten: false, searchUrl: pinterestSearchUrl, collect: collectPinterest },
];
const SOURCES_BY_KEY = new Map(SOURCES.map(source => [source.key, source]));

export function sourceDefinition(key: SourceKey) { return SOURCES_BY_KEY.get(key); }
/** Sources that can actually serve requests right now. Provider keys come only from the local server. */
export function activeSources(): SourceDefinition[] { return SOURCES.filter(source => !source.requiresKey || providerKeyValue(source.requiresKey)); }
export function activeSourceKeys(): SourceKey[] { return activeSources().map(source => source.key); }
export function emptyQuerySets(): Record<SourceKey, Set<string>> {
  return Object.fromEntries(SOURCE_KEYS.map(key => [key, new Set<string>()])) as Record<SourceKey, Set<string>>;
}

export function validateSearches(value: unknown): Record<SourceKey, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('Enter a search phrase for each source.');
  const data = value as Record<string, unknown>;
  const searches = {} as Record<SourceKey, string>;
  for (const key of SOURCE_KEYS) {
    if (typeof data[key] !== 'string' || data[key].trim().length < 2 || data[key].length > 100) throw new RequestError('Each source search needs between 2 and 100 characters.');
    searches[key] = data[key].trim();
  }
  return searches;
}
export function searchUrl(key: SourceKey, query: string) { return SOURCES_BY_KEY.get(key)!.searchUrl(query); }

export async function collectSource(key: SourceKey, query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit = REFERENCES_PER_SOURCE, options: { page?: number; excludeIds?: Set<string>; excludeImages?: Set<string>; excludeKeys?: Set<string> } = {}) {
  limit = Math.max(1, Math.min(CREATOR_TARGET, Math.floor(limit)));
  const identity = new ReferenceIdentity([...(options.excludeKeys || []), ...[...(options.excludeImages || [])].map(image => `image:${imageIdentity(image)}`)]);
  let count = 0;
  const emit = (ref: Reference) => {
    if (count >= limit || options.excludeIds?.has(ref.id) || referenceKeys(ref).some(key => options.excludeKeys?.has(key)) || !identity.add(ref)) return;
    count++; receive(ref);
  };
  const page = Math.max(1, options.page || 1);
  if (key === 'nasa') {
    const payload = await (await get(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image&page_size=${CREATOR_TARGET}&page=${page}`, signal)).json() as any;
    for (const item of payload.collection?.items || []) {
      const d = item.data?.[0]; const img = safeImage(item.links?.find((x: any) => x.render === 'image')?.href);
      if (!d?.nasa_id || !img) continue;
      emit(stamp({ id: `nasa-${d.nasa_id}`, title: clean(d.title, 180), description: clean(d.description), credit: clean(d.photographer || d.secondary_creator || d.center || 'NASA', 180), date: clean(d.date_created, 40), image: img, source: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, collection: 'Space archive', sourceName: 'NASA', sourceKey: key, descriptionOrigin: 'NASA catalog metadata, retrieved during this run.' }));
    }
  } else if (key === 'cosmos') {
    const html = await (await get(searchUrl(key, query), signal)).text();
    for (const ref of cosmosReferences(html)) emit(ref);
  } else if (key === 'met') {
    const data = await (await get(`https://collectionapi.metmuseum.org/public/collection/v1/search?isPublicDomain=true&hasImages=true&q=${encodeURIComponent(query)}`, signal)).json() as any;
    const ids: number[] = (data.objectIDs || []).filter(Number.isSafeInteger).slice((page - 1) * 100, (page - 1) * 100 + limit * 4);
    let index = 0;
    await Promise.all(Array.from({ length: limit > REFERENCES_PER_SOURCE ? 8 : 4 }, async () => {
      while (index < ids.length && count < limit && !signal.aborted) {
        const id = ids[index++];
        try {
          const d = await (await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, signal)).json() as any;
          const img = safeImage(d.primaryImageSmall || d.primaryImage);
          if (!d.isPublicDomain || !img) continue;
          emit(stamp({ id: `met-${id}`, title: clean(d.title, 180), description: clean([d.title, d.artistDisplayName, d.medium, d.objectDate, ...(d.tags || []).map((t: any) => t.term)].filter(Boolean).join('. ')), credit: clean(`${d.artistDisplayName || 'Artist not identified'}. ${d.creditLine || 'The Metropolitan Museum of Art'}`, 300), date: clean(d.objectDate, 80), image: img, source: `https://www.metmuseum.org/art/collection/search/${id}`, collection: clean(d.department || 'Open Access', 80), sourceName: 'The Met', sourceKey: key, descriptionOrigin: 'The Met Open Access catalog metadata, retrieved during this run.' }));
        } catch (error) { if (signal.aborted) throw error; }
      }
    }));
  } else {
    const source = SOURCES_BY_KEY.get(key);
    if (!source) throw new Error('This source does not exist.');
    await source.collect(query, signal, emit, limit, page);
  }
  if (signal.aborted) throw new Error('Search stopped.');
  if (!count) throw new Error('No usable images returned. Try a broader search phrase.');
  return count;
}
