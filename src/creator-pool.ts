import type { Reference, SourceKey, MediaSourceKey } from './types';
import { sourceQuotas, emptyCounts } from './source-balance';
import { ReferenceIdentity } from './reference-identity';
import { SOURCE_KEYS } from './sources';

type ImageReference = Reference & { sourceKey: SourceKey };
const IMAGE_KEYS = new Set<string>(SOURCE_KEYS);
const isImageSource = (key: MediaSourceKey | undefined): key is SourceKey => key !== undefined && IMAGE_KEYS.has(key);

/** Release a balanced stream, holding faster sources until slower ones can contribute. */
export function createCreatorPool(target: number, receive: (ref: ImageReference) => void, previous: Record<SourceKey, number> = emptyCounts(), keys: SourceKey[] = SOURCE_KEYS, guards: SourceKey[] = ['cosmos']) {
  const quota = sourceQuotas(target, previous, keys);
  const counts = emptyCounts();
  const accepted = emptyCounts();
  const waiting = Object.fromEntries(keys.map(key => [key, [] as ImageReference[]])) as Record<SourceKey, ImageReference[]>;
  const finished = new Set<SourceKey>();
  const identity = new ReferenceIdentity();
  let count = 0;
  // A guarded plentiful source may only hold one third of what the other sources deliver.
  const guardRoom = (source: SourceKey) => {
    if (!guards.includes(source)) return Number.POSITIVE_INFINITY;
    const others = keys.filter(key => key !== source).reduce((sum, key) => sum + previous[key] + counts[key], 0);
    return Math.floor(others / 2) - previous[source] - counts[source];
  };
  const drain = () => {
    while (count < target) {
      let active = keys.filter(key => counts[key] < quota[key] && (!finished.has(key) || waiting[key].length));
      if (!active.length) return;
      let lowest = Math.min(...active.map(key => previous[key] + counts[key]));
      let group = active.filter(key => previous[key] + counts[key] === lowest);
      // A missing institutional source must not turn its empty share into a flood from the guarded source.
      // Let the other sources advance until their actual results fund another guarded slot.
      if (group.length === 1 && guards.includes(group[0]) && guardRoom(group[0]) <= 0) {
        active = active.filter(key => key !== group[0]);
        if (!active.length) return;
        lowest = Math.min(...active.map(key => previous[key] + counts[key]));
        group = active.filter(key => previous[key] + counts[key] === lowest);
      }
      if (group.some(key => !waiting[key].length)) return;
      for (const key of group) {
        if (guards.includes(key) && guardRoom(key) <= 0) continue;
        const ref = waiting[key].shift()!; count++; counts[key]++; receive(ref);
      }
    }
  };
  return {
    get count() { return count; },
    limit(key: SourceKey) { return quota[key]; },
    available(key: SourceKey) { return accepted[key]; },
    held(key: SourceKey) { return waiting[key].length; },
    offer(ref: Reference) {
      // Video-only lanes (archive, Pexels clips, Commons clips) stream outside the balanced image pool.
      if (!isImageSource(ref.sourceKey) || finished.has(ref.sourceKey) || accepted[ref.sourceKey] >= quota[ref.sourceKey] || count >= target || !identity.add(ref)) return;
      accepted[ref.sourceKey]++; waiting[ref.sourceKey].push({ ...ref, sourceKey: ref.sourceKey }); drain();
    },
    finish(key: SourceKey) { finished.add(key); drain(); },
  };
}
