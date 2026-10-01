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

// Pixabay Videos: same style of free key as Pexels; per-rendition mp4s ship with durations and posters.
const PIXABAY_SIZES = ['large', 'medium', 'small', 'tiny'] as const;
export function pixabayVideoReference(hit: any): Reference | undefined {
  if (!hit || !Number.isSafeInteger(hit.id)) return;
  const duration = Number(hit.duration);
  if (!bounded(duration)) return;
  const renditions = PIXABAY_SIZES.map(size => ({ size, ...(hit.videos?.[size] || {}) })).filter((file: any) => typeof file.url === 'string' && file.url.startsWith('https://cdn.pixabay.com/') && file.url.endsWith('.mp4') && bounded(duration, file.size) && Number(file.width) >= 640 && Number(file.width) <= 1920);
  const file = renditions[0];
  const poster = typeof file?.thumbnail === 'string' && file.thumbnail.startsWith('https://cdn.pixabay.com/') ? file.thumbnail : '';
  if (!file || !poster) return;
  const tags = clean(hit.tags, 110);
  return {
    id: `pixabayvideo-${hit.id}`,
    title: tags ? tags.split(',').slice(0, 3).join(' · ') : `Pixabay clip ${hit.id}`,
    description: 'A royalty-free clip from Pixabay. Open the original page for the Content License terms.',
    credit: `${clean(hit.user) || 'Pixabay contributor'} / Pixabay`,
    date: '',
    image: poster,
    source: clean(hit.pageURL, 300) || `https://pixabay.com/videos/id-${hit.id}/`,
    collection: 'Stock footage',
    sourceName: 'Pixabay',
    sourceKey: 'pixabayvideo' as const,
    descriptionOrigin: 'Pixabay clip metadata; the Content License applies, attribution is appreciated but not required.',
    video: { url: file.url, durationSeconds: duration },
  };
}

export async function collectPixabayVideos(query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number): Promise<number> {
  const key = providerKeyValue('PIXABAY_API_KEY');
  const payload = await getJson(`https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&safesearch=true&per_page=${Math.min(15, Math.max(3, limit))}`, signal);
  let count = 0;
  for (const hit of payload?.hits || []) {
    if (count >= limit) break;
    const ref = pixabayVideoReference(hit);
    if (!ref) continue;
    receive(ref);
    count++;
  }
  return count;
}

// NASA video: keyless. Durations live in a per-item metadata.json (QuickTime:Duration),
// playable mp4 renditions in the asset list. Two extra bounded requests per accepted item.
export function nasaVideoDuration(metadata: any): number | undefined {
  const raw = metadata?.['QuickTime:Duration'] ?? metadata?.['QuickTime:MediaDuration'];
  if (raw === undefined || raw === null) return;
  const text = String(raw).trim();
  // Metadata stores clock values such as '0:02:08' as well as plain seconds.
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  const seconds = clock ? Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : Number(text.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  return seconds;
}

// Small renditions stream quickly in previews; orig is the last resort.
const NASA_RENDITIONS = ['small', 'medium', 'preview', 'mobile', 'large', 'orig'];
export function nasaVideoAssetUrl(assets: string[]): string | undefined {
  const mp4 = assets.filter(url => /^https?:\/\/images-assets\.nasa\.gov\/.+\.mp4$/.test(url));
  for (const name of NASA_RENDITIONS) {
    const found = mp4.find(url => url.endsWith(`~${name}.mp4`));
    if (found) return found.replace(/^http:\/\//, 'https://');
  }
  return mp4[0]?.replace(/^http:\/\//, 'https://');
}

export async function collectNasaVideos(query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit: number, page = 1): Promise<number> {
  const payload = await getJson(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=video&year_start=1920&page_size=${Math.min(30, Math.max(2, limit * 3))}&page=${Math.max(1, page)}`, signal);
  const items: any[] = payload?.collection?.items || [];
  let count = 0;
  for (const item of items) {
    if (count >= limit) break;
    const data = item?.data?.[0];
    const nasaId = data?.nasa_id;
    if (!nasaId) continue;
    try {
      const meta = await getJson(`https://images-api.nasa.gov/metadata/${encodeURIComponent(nasaId)}`, signal).then(body => getJson(body.location, signal));
      const duration = nasaVideoDuration(meta);
      if (!duration || !bounded(duration)) continue;
      const assets = await getJson(`https://images-api.nasa.gov/asset/${encodeURIComponent(nasaId)}`, signal).then(body => (body?.collection?.items || []).map((row: any) => row?.href).filter((href: unknown) => typeof href === 'string'));
      const mp4 = nasaVideoAssetUrl(assets);
      if (!mp4) continue;
      const poster = item?.links?.find((link: any) => link?.render === 'image' && typeof link.href === 'string' && link.href.startsWith('https://images-assets.nasa.gov/'))?.href;
      receive({
        id: `nasavideo-${nasaId}`,
        title: clean(data.title, 110) || 'NASA clip',
        description: clean(data.description, 600) || 'A short video from the NASA image and video library.',
        credit: clean(data.photographer || data.secondary_creator || data.center || 'NASA', 180),
        date: clean(data.date_created, 40),
        image: poster || '',
        source: `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`,
        collection: 'NASA video library',
        sourceName: 'NASA',
        sourceKey: 'nasavideo' as const,
        descriptionOrigin: 'NASA catalog metadata, retrieved during this run. Check NASA media use rules before reuse.',
        video: { url: mp4, durationSeconds: duration },
      });
      count++;
    } catch { /* One unavailable item does not discard the rest. */ }
  }
  return count;
}
