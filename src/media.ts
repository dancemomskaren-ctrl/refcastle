import { RequestError } from './decision';
import type { MediaMode, Reference } from './types';

export const MAX_VIDEO_SECONDS = 180;
export function validateMedia(value: unknown): MediaMode {
  if (value === undefined) return 'images';
  if (value === 'images' || value === 'videos' || value === 'both') return value;
  throw new RequestError('Choose Images, Short videos, or both.');
}

/** Video hosts the player is allowed to stream from. Each maps to a vetted source adapter. */
const VIDEO_HOSTS = new Set(['archive.org', 'videos.pexels.com', 'upload.wikimedia.org', 'cdn.pixabay.com', 'images-assets.nasa.gov']);

export function safeVideo(video: Reference['video']): boolean {
  if (!video || !Number.isFinite(video.durationSeconds) || video.durationSeconds <= 0 || video.durationSeconds > MAX_VIDEO_SECONDS) return false;
  try {
    const url = new URL(video.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (!VIDEO_HOSTS.has(url.hostname)) return false;
    if (url.hostname === 'archive.org') return url.pathname.startsWith('/download/') && url.pathname.endsWith('.mp4');
    if (url.hostname === 'upload.wikimedia.org') return /\.(webm|ogg|ogv)$/i.test(url.pathname);
    return url.pathname.endsWith('.mp4');
  } catch { return false; }
}

/** Kept name for existing callers; validation is now shared across video sources. */
export const safeArchiveVideo = safeVideo;

export function durationLabel(seconds: number): string {
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
