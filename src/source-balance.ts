import { SOURCE_KEYS } from './sources';
import type { Reference, SourceKey, MediaSourceKey } from './types';

/** Round displayed shares together so the source labels always total 100%. */
export function imageSourceShares(counts: Record<MediaSourceKey, number>): Record<SourceKey, number> {
  const keys = SOURCE_KEYS;
  const total = keys.reduce((sum, key) => sum + (counts[key] || 0), 0);
  const shares = Object.fromEntries(keys.map(key => [key, 0])) as Record<SourceKey, number>;
  if (!total) return shares;
  for (const key of keys) shares[key] = Math.floor((counts[key] || 0) / total * 100);
  const remainder = 100 - keys.reduce((sum, key) => sum + shares[key], 0);
  const ranked = [...keys].sort((a, b) => ((counts[b] || 0) / total * 100 - shares[b]) - ((counts[a] || 0) / total * 100 - shares[a]));
  for (const key of ranked.slice(0, remainder)) shares[key]++;
  return shares;
}

export function emptyCounts(): Record<SourceKey, number> {
  return Object.fromEntries(SOURCE_KEYS.map(key => [key, 0])) as Record<SourceKey, number>;
}

export function sourceQuotas(capacity: number, previous: Record<SourceKey, number> = emptyCounts(), keys: SourceKey[] = SOURCE_KEYS): Record<SourceKey, number> {
  const quota = emptyCounts();
  for (let slot = 0; slot < capacity; slot++) {
    const source = keys.reduce((least, key) => previous[key] + quota[key] < previous[least] + quota[least] ? key : least);
    quota[source]++;
  }
  return quota;
}

export function referenceSource(ref: Reference): MediaSourceKey | undefined {
  if (ref.sourceKey) return ref.sourceKey;
  // Older saved references predate sourceKey.
  return ({ 'The Met': 'met', NASA: 'nasa', Cosmos: 'cosmos', Unsplash: 'unsplash', Pexels: 'pexels', Openverse: 'openverse', Flickr: 'flickr', Pinterest: 'pinterest' } as const)[ref.sourceName as 'The Met' | 'NASA' | 'Cosmos' | 'Unsplash' | 'Pexels' | 'Openverse' | 'Flickr' | 'Pinterest'];
}
