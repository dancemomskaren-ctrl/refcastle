import { expect, test } from 'bun:test';
import { sourceQuotas, imageSourceShares, emptyCounts } from '../src/source-balance';
import type { SourceKey } from '../src/types';

const legacy: SourceKey[] = ['met', 'nasa', 'cosmos'];

const none = () => ({ ...emptyCounts(), archive: 0, pexelsvideo: 0, commonsvideo: 0 });

test('batch budgets close accumulated source deficits and preserve the target', () => {
  expect(sourceQuotas(30, { ...none(), met: 0, nasa: 10, cosmos: 33 }, legacy)).toEqual({ ...emptyCounts(), met: 20, nasa: 10, cosmos: 0 });
  expect(sourceQuotas(30, { ...none(), met: 34, nasa: 33, cosmos: 33 }, legacy)).toEqual({ ...emptyCounts(), met: 10, nasa: 10, cosmos: 10 });
  expect(sourceQuotas(30, { ...none(), met: 100, nasa: 0, cosmos: 100 }, legacy)).toEqual({ ...emptyCounts(), met: 0, nasa: 30, cosmos: 0 });
});

test('seven sources split capacity evenly and catch up deficits', () => {
  const keys = ['met', 'cosmos', 'nasa', 'unsplash', 'pexels', 'openverse', 'flickr', 'pinterest'] as SourceKey[];
  const quota = sourceQuotas(80, none(), keys);
  expect(Object.values(quota).reduce((a, b) => a + b, 0)).toBe(80);
  expect(Object.values(quota).every(count => count === 10)).toBe(true);
  const catchUp = sourceQuotas(30, { ...none(), met: 60, nasa: 10 }, keys);
  expect(catchUp.cosmos).toBeGreaterThanOrEqual(catchUp.met);
});

test('displayed image shares total 100 and exclude separate video counts', () => {
  const zero = imageSourceShares(none());
  expect(Object.values(zero).reduce((a, b) => a + b, 0)).toBe(0);
  const shares = imageSourceShares({ ...none(), met: 7, nasa: 0, cosmos: 3 });
  expect(shares).toEqual({ ...emptyCounts(), met: 70, nasa: 0, cosmos: 30 });
  const mixed = imageSourceShares({ ...none(), archive: 7, met: 36, nasa: 17, cosmos: 26 });
  expect(Object.values(mixed).reduce((a, b) => a + b, 0)).toBe(100);
  expect(mixed.met).toBe(46);
});
