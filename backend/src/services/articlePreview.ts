import { isIP } from 'node:net';
import { LINK_PREVIEW_HEADERS, PAGE_FETCH_TIMEOUT_MS } from '../helpers/constants';
import { fetchErrorMessage } from '../helpers/errors';

/**
 * Article previews (issue #11 addendum): the image and intro a publisher puts in its page's
 * <head> for social sharing (og:*, twitter:*, description). Never the article body.
 */

export interface Preview {
  image_url: string | null;
  summary: string | null;
}

const SUMMARY_MAX = 300;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', euro: '€',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â',
  auml: 'ä', iuml: 'ï', icirc: 'î', oacute: 'ó', ocirc: 'ô', ouml: 'ö', uuml: 'ü', ucirc: 'û',
  ccedil: 'ç', Eacute: 'É',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const n = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

// Quote-aware, so a '>' inside a quoted value doesn't end the tag. Linear: the alternatives
// start with disjoint characters, and an unquoted '<' ends a start that can never match, so
// a page made of unterminated `<meta ` can't make every start rescan the rest of the input.
const META_TAG = /<meta\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
// Real meta tags are far shorter; a longer match is junk and not worth running ATTR on.
const META_TAG_MAX = 4096;
// The lookbehind keeps a long run of name characters from being rescanned from every position.
const ATTR = /(?<![a-zA-Z_:.-])([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** property/name → content of every <meta> in the head; the first occurrence wins. */
function metaTags(html: string): Map<string, string> {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html;
  const out = new Map<string, string>();
  for (const [tag] of head.matchAll(META_TAG)) {
    if (tag.length > META_TAG_MAX) continue;
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(ATTR)) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
    // Yahoo writes `name="ogImg" property="og:image"`: property is the meaningful one.
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase();
    const content = attrs.get('content');
    if (key && content != null && !out.has(key)) out.set(key, content);
  }
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Decode, then strip tags some publishers double-escape into the attribute. */
function cleanText(s: string): string {
  return decodeEntities(s).replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** At most `max` characters including the ellipsis, cut at the last space when there is one. */
export function truncate(s: string, max = SUMMARY_MAX): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

function resolveHttpUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function extractPreview(html: string, title: string, baseUrl: string): Preview {
  const meta = metaTags(html);
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)?.trim()).find((v) => v);
  const rawImage = pick('og:image', 'twitter:image');
  const rawText = pick('og:description', 'twitter:description', 'description');

  // The browser hot-links a stored image, so it passes the same guard as a fetched page.
  const resolved = rawImage ? resolveHttpUrl(decodeEntities(rawImage), baseUrl) : null;
  const image_url = resolved && isAllowedUrl(resolved) ? resolved : null;
  let summary = rawText ? cleanText(rawText) : '';
  // Boilerplate like `Lees "<title>" op Bloovi.` adds nothing next to the title itself.
  const t = normalize(title);
  if (t && normalize(summary).includes(t)) summary = '';
  return { image_url, summary: summary ? truncate(summary) : null };
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true;
  // IPv4-mapped (WHATWG URL normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1): never a publisher.
  if (/^::ffff:/i.test(ip)) return true;
  return /^(fc|fd|fe[89ab])/i.test(ip);
}

/**
 * Only http(s), and never this machine or the local network: the URLs come from third
 * parties (Yahoo, Google, a decoded redirect). A cheap SSRF guard — DNS isn't resolved and
 * redirects aren't re-checked, which is acceptable for a single-user local app.
 */
export function isAllowedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // A trailing dot is a valid FQDN (`localhost.`) that WHATWG URL keeps as is.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (isIP(host) === 4) return !isPrivateIPv4(host);
  if (isIP(host) === 6) return !isPrivateIPv6(host);
  return true;
}

export type PreviewOutcome =
  | ({ kind: 'ok' } & Preview)
  | { kind: 'none'; reason: string }
  | { kind: 'retry'; reason: string };

const MAX_BYTES = 512 * 1024;

/** Cookie walls answer 200 with their own og tags; storing those would be worse than nothing. */
const CONSENT_HOST = /^(consent|guce|myprivacy)\./i;

/** Read at most `max` bytes of the body, then drop the connection. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, max));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.length - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.length) break;
  }
  return out;
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Fetch one article page and read its preview. Never throws: `none` settles the article
 * (a 4xx, not HTML, a consent wall, a refused URL), `retry` leaves it for the next round
 * (network, timeout, 429, 5xx).
 */
export async function fetchPreview(url: string, title: string): Promise<PreviewOutcome> {
  if (!isAllowedUrl(url)) return { kind: 'none', reason: 'url not allowed' };
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { ...LINK_PREVIEW_HEADERS, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: 'retry', reason: fetchErrorMessage(err) };
  }
  const finalUrl = res.url || url;
  const drop = () => res.body?.cancel().catch(() => {});
  if (res.status === 429 || res.status >= 500) {
    await drop();
    return { kind: 'retry', reason: String(res.status) };
  }
  if (!res.ok) {
    await drop();
    return { kind: 'none', reason: String(res.status) };
  }
  if (CONSENT_HOST.test(hostOf(finalUrl))) {
    await drop();
    return { kind: 'none', reason: 'consent wall' };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
    await drop();
    return { kind: 'none', reason: 'not html' };
  }
  try {
    const html = decodeBody(await readCapped(res, MAX_BYTES), type);
    return { kind: 'ok', ...extractPreview(html, title, finalUrl) };
  } catch (err) {
    return { kind: 'retry', reason: fetchErrorMessage(err) };
  }
}
