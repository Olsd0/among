// Sheets currently stores image_url only. Fragments never reach the image server.
const MARKER = '#among-artwork=';
const KINDS = new Set(['official_event', 'official_related', 'press_event', 'press_related']);
function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
    return u.href;
  } catch { return ''; }
}
function metadata(value) {
  if (!value || typeof value !== 'object' || !KINDS.has(value.kind)) return null;
  const source = httpsUrl(value.source);
  const date = typeof value.checkedAt === 'string' ? Date.parse(value.checkedAt) : NaN;
  if (!source || !Number.isFinite(date)) return null;
  return { kind: value.kind, source, checkedAt: new Date(date).toISOString(),
    credit: String(value.credit || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 160) };
}
export function decodeArtworkUrl(input) {
  const value = typeof input === 'string' ? input : '';
  const index = value.indexOf(MARKER);
  if (index < 0) return { url: value, meta: null };
  const url = value.slice(0, index);
  if (!httpsUrl(url) || value.length - index > 12000) return { url, meta: null };
  try { return { url, meta: metadata(JSON.parse(decodeURIComponent(value.slice(index + MARKER.length)))) }; }
  catch { return { url, meta: null }; }
}
export function encodeArtworkUrl(input, value) {
  const url = httpsUrl(decodeArtworkUrl(input).url);
  const meta = metadata(value);
  if (!url || !meta) return '';
  return url.split('#')[0] + MARKER + encodeURIComponent(JSON.stringify(meta));
}
