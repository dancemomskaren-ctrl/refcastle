import { collectSource, CREATOR_TARGET, SOURCE_KEYS, SOURCE_NAMES, searchUrl, activeSourceKeys, sourceDefinition } from './sources';
import { createCreatorPool } from './creator-pool';
import type { Reference, ResearchEvent, SourceKey, SourceProgress } from './types';
import { imageIdentity, referenceKeys, ReferenceIdentity } from './reference-identity';

type Unstamped<T> = T extends { atMs: number } ? Omit<T, 'atMs'> : never;
export type SourceEmitter = (event: Unstamped<ResearchEvent>) => void;
export type DiscoveryContext = { round: number; target: number; seenIds: Set<string>; seenImages: Set<string>; seenKeys?: Set<string>; queries: Record<SourceKey, Set<string>>; pages: Map<string, number> };

export function shorterSearches(query: string): string[] {
  const words = query.trim().split(/\s+/);
  return [...new Set([words.slice(0, 2).join(' '), words[0]])].filter(value => value && value !== query && value.length >= 2);
}

/** Public source fetching only. No model clients or credentials belong in this module. */
export async function collectCreatorSources(searches: Record<SourceKey, string>, signal: AbortSignal, emit: SourceEmitter, discovery?: DiscoveryContext, storage?: { add: (ref: Reference) => void }, collect = collectSource, sourceKeys: SourceKey[] = activeSourceKeys()) {
  const pool: Reference[] = [];
  const seenKeys = discovery ? (discovery.seenKeys ??= new Set()) : new Set<string>();
  for (const image of discovery?.seenImages || []) seenKeys.add(`image:${imageIdentity(image)}`);
  const active = sourceKeys;
  emit({ type: 'stage', stage: 'sources', message: active.length > 3 ? `Finding fresh assets across ${active.length} collections.` : 'Finding fresh assets across The Met, Cosmos and NASA.' });
  const collectionAbort = new AbortController();
  const collectionSignal = AbortSignal.any([signal, collectionAbort.signal, AbortSignal.timeout(12_000)]);
  const progress = new Map<SourceKey, { source: SourceProgress; start: number; update: () => void }>();
  const target = discovery?.target || CREATOR_TARGET;
  const previous = Object.fromEntries(SOURCE_KEYS.map(key => [key, 0])) as Record<SourceKey, number>;
  for (const id of discovery?.seenIds || []) {
    const source = SOURCE_KEYS.find(key => id.startsWith(`${key}-`));
    if (source) previous[source]++;
  }
  const collector = createCreatorPool(target, ref => {
    signal.throwIfAborted();
    discovery?.seenIds.add(ref.id); discovery?.seenImages.add(ref.image);
    for (const key of referenceKeys(ref)) seenKeys.add(key);
    pool.push(ref); storage?.add(ref);
    const entry = progress.get(ref.sourceKey as SourceKey)!;
    entry.source.found++; entry.source.firstResultMs ??= Math.round(performance.now() - entry.start);
    emit({ type: 'candidate', source: ref.sourceKey!, reference: ref }); entry.update();
    if (pool.length >= target) collectionAbort.abort();
  }, previous, active, active.filter(key => key === 'cosmos' || sourceDefinition(key)?.guarded === true));
  await Promise.all(SOURCE_KEYS.map(async key => {
    const definition = sourceDefinition(key);
    const start = performance.now();
    const source: SourceProgress = { key, query: searches![key], url: searchUrl(key, searches![key]), status: 'searching', found: 0, elapsedMs: 0 };
    const update = () => { source.elapsedMs = Math.round(performance.now() - start); emit({ type: 'source', source: { ...source } }); };
    progress.set(key, { source, start, update });
    const limit = collector.limit(key);
    // Sources without a configured key, or with no share this round, stay out of the run.
    if (!active.includes(key) || !limit) { source.status = 'ready'; collector.finish(key); update(); return; }
    update();
    const queries = [searches[key], ...(definition?.canShorten ? shorterSearches(searches[key]) : [])];
    const offeredIds = new Set(discovery?.seenIds), offeredImages = new Set(discovery?.seenImages);
    const offeredKeys = new Set(seenKeys), identity = new ReferenceIdentity(seenKeys);
    let failed = false;
    for (const query of queries) {
      if (collector.available(key) >= limit || collectionSignal.aborted) break;
      const pageKey = `${key}:${query}`;
      const page = (discovery?.pages.get(pageKey) || 0) + 1;
      discovery?.pages.set(pageKey, page); discovery?.queries[key].add(query);
      source.query = query; source.url = searchUrl(key, query); update();
      try {
        await collect(key, query, collectionSignal, ref => {
          if (signal.aborted || offeredIds.has(ref.id) || !identity.add(ref)) return;
          for (const key of referenceKeys(ref)) offeredKeys.add(key);
          offeredIds.add(ref.id); offeredImages.add(ref.image); collector.offer(ref);
        }, limit - collector.available(key), { page, excludeIds: offeredIds, excludeImages: offeredImages, excludeKeys: offeredKeys });
        failed = false;
      } catch { signal.throwIfAborted(); failed = true; }
    }
    source.status = failed && !collector.available(key) && !collectionAbort.signal.aborted ? 'error' : 'ready';
    if (source.status === 'error') source.error = 'This source returned no images in time. Try a broader subject.';
    signal.throwIfAborted();
    if (collector.available(key) < limit) emit({ type: 'notice', message: `${SOURCE_NAMES[key]} returned ${collector.available(key)} of ${limit} requested references.` });
    collector.finish(key);
    update();
  }));
  signal.throwIfAborted();
  if (collector.held('cosmos')) emit({ type: 'notice', message: `Held back ${collector.held('cosmos')} Cosmos references to keep space for the other collections.` });
  return pool;
}
