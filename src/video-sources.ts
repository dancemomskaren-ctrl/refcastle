import { providerKeyValue } from './sources';
import { RequestError } from './decision';
import { MAX_VIDEO_SECONDS } from './media';
import type { Reference } from './types';

/** Additional short-video lanes beside the Prelinger archive. Each returns verified, bounded clips. */

const clean = (value: unknown, max = 800) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';

async function getJson(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { Accept: 'application/json', 'User-Agent': 'RefCastle/1.0 (short-video reference search)', ...headers } });
  if (!response.ok) throw new RequestError(response.status === 429 ? 'A video source is rate limiting this search. Try again shortly.' : 'A video source request failed. Other sources are unaffected.', response.status === 429 ? 429 : 502);
  return response.json();
}

const bounded = (duration: unknown, size?: unknown): boolean => Number.isFinite(Number(duration)) && Number(duration) > 0 && Number(duration) <= MAX_VIDEO_SECONDS && (size === undefined || (Number.isFinite(Number(size)) && Number(size) > 0 && Number(size) <= 80_000_000));

// Pexels Videos: same free API key as the Pexels image source; mp4 links ship with durations.
const PEXELS_SIZES = new Set(['sd', 'hd', 'uhd']);
export function pexelsVideoReference(video: any): Reference | undefined {
  if (!video || !Number.isSafeInteger(video.id)) return;
  const files = (video.video_files || []).filter((file: any) => file?.file_type === 'video/mp4' && typeof file.link === 'string' && PEXELS_SIZES.has(file.quality) && Number(file.width) >= 640 && Number(file.width) <= 1920);
  files.sort((a: any, b: any) => Number(a.width) - Number(b.width));
  const file = files[files.length - 1] || files[0];
  const duration = video.duration;
  if (!file || !bounded(duration)) return;
  return {
    id: `pexelsvideo-${video.id}`,
    title: clean(video.user?.name) ? `${clean(video.user?.name, 80)} on Pexels` : `Pexels clip ${video.id}`,
    description: 'A short stock clip from Pexels. Open the original page for license terms.',
    credit: `${clean(video.user?.name) || 'Pexels contributor'} / Pexels`,
    date: '',
    image: typeof video.image === 'string' && video.image.startsWith('https://images.pexels.com/') ? video.image : '',
    source: `https://www.pexels.com/video/${video.id}/`,
    collection: 'Stock footage',
    sourceName: 'Pexels',
    sourceKey: 'pexelsvideo' as const,
    descriptionOrigin: 'Pexels clip metadata; check the Pexels license terms before reuse.',
    video: { url: file.link, durationSeconds: Number(duration) },
  };
}

export async function collectPexelsVideos(query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number): Promise<number> {
  const key = providerKeyValue('PEXELS_API_KEY');
  const payload = await getJson(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${Math.min(15, Math.max(1, limit))}`, signal, { Authorization: key });
  let count = 0;
  for (const video of payload?.videos || []) {
    if (count >= limit) break;
    const ref = pexelsVideoReference(video);
    if (!ref?.image) continue;
    receive(ref);
    count++;
  }
  return count;
}

// Wikimedia Commons: openly licensed webm/ogg clips with real durations and poster thumbs. No key.
const COMMONS_VIDEO_MIME = new Set(['video/webm', 'video/ogg', 'application/ogg']);
export function commonsVideoReference(page: any): Reference | undefined {
  const info = (page?.imageinfo || [])[0];
  const title = typeof page?.title === 'string' ? page.title.replace(/^File:/, '') : '';
  if (!title || !info || !COMMONS_VIDEO_MIME.has(info.mime)) return;
  const duration = Number(info?.duration);
  const direct = typeof info?.url === 'string' ? info.url : '';
  const poster = typeof info?.thumburl === 'string' ? info.thumburl : '';
  if (!bounded(duration) || !direct || !poster) return;
  return {
    id: `commonsvideo-${page.pageid}`,
    title: title.replace(/\.[a-z0-9]+$/i, '').slice(0, 110),
    description: `${title} on Wikimedia Commons.`,
    credit: 'Wikimedia Commons contributors · see the file page for the license',
    date: '',
    image: poster,
    source: `https://commons.wikimedia.org/wiki/${encodeURIComponent('File:' + title)}`,
    collection: 'Openly licensed clips',
    sourceName: 'Wikimedia',
    sourceKey: 'commonsvideo' as const,
    descriptionOrigin: 'Commons file metadata; check the file page license before reuse.',
    video: { url: direct, durationSeconds: duration },
  };
}

export async function collectCommonsVideos(query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number, page = 1): Promise<number> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search',
    gsrsearch: `filetype:video ${query}`, gsrnamespace: '6', gsrlimit: String(Math.min(25, Math.max(1, limit * 2))), gsroffset: String((Math.max(1, page) - 1) * 25),
    prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: '640',
  });
  const payload = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`, signal);
  const pages = Object.values(payload?.query?.pages || {}) as any[];
  let count = 0;
  for (const row of pages.sort((a, b) => Number(a.index) - Number(b.index))) {
    if (count >= limit) break;
    const ref = commonsVideoReference(row);
    if (!ref) continue;
    receive(ref);
    count++;
  }
  return count;
}
