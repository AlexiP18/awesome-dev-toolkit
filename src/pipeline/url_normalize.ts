/**
 * Identidad canónica de una URL para deduplicar fichas.
 * Ignora protocolo, www, barra final, parámetros de seguimiento y la caja de owner/repo en GitHub.
 */

export const TRACKING_PARAMS = [
  'oref',
  'ref',
  'ref_src',
  'ref_url',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'si',
  'usp',
  'mkt_tok',
  'clid',
];

const GENERIC_HOST_SUFFIXES = [
  'github.io',
  'gitlab.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'herokuapp.com',
  'web.app',
  'firebaseapp.com',
  'workers.dev',
];

export function alnum(value: string): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isBlankUrl(raw: string): boolean {
  return !raw || /^(null|undefined|#|none)$/i.test(raw);
}

export function ensureProtocol(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/\//, '')}`;
}

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return TRACKING_PARAMS.includes(key) || key.startsWith('utm_');
}

export function canonicalUrlKey(raw?: string | null): string {
  if (raw == null) return '';
  const compact = String(raw).trim().replace(/\s+/g, '');
  if (isBlankUrl(compact)) return '';

  let parsed: URL;
  try {
    parsed = new URL(ensureProtocol(compact));
  } catch {
    return '';
  }

  let host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'twitter.com' || host === 'mobile.twitter.com' || host === 'm.twitter.com') {
    host = 'x.com';
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingParam(key)) parsed.searchParams.delete(key);
  }

  let path = parsed.pathname.replace(/\/+$/, '').replace(/\/index\.html?$/i, '');

  if (host === 'github.com' || host === 'gitlab.com') {
    const match = path.match(/^\/([^/]+)\/([^/]+)/);
    if (match) {
      const owner = decodeURIComponent(match[1]).toLowerCase();
      const repo = decodeURIComponent(match[2]).toLowerCase().replace(/\.git$/, '');
      return `${host}/${owner}/${repo}`;
    }
  }

  if (host === 'x.com' && !/\/status\/\d+/.test(path)) return '';

  const params = [...parsed.searchParams.entries()]
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const qs = params.length ? `?${params.map(([key, value]) => `${key}=${value}`).join('&')}` : '';
  return `${host}${path}${qs}`;
}

/** URL lista para guardar: https, sin www, sin tracking, repo de GitHub en minúsculas. */
export function displayUrl(raw?: string | null): string {
  if (raw == null) return '';
  const compact = String(raw).trim().replace(/\s+/g, '');
  if (isBlankUrl(compact)) return '';
  let parsed: URL;
  try {
    parsed = new URL(ensureProtocol(compact));
  } catch {
    return '';
  }
  parsed.protocol = 'https:';
  parsed.hostname = parsed.hostname.replace(/^www\./i, '');
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingParam(key)) parsed.searchParams.delete(key);
  }
  if ((parsed.hostname === 'github.com' || parsed.hostname === 'gitlab.com')) {
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)/i);
    if (match) {
      const owner = match[1];
      const repo = match[2].replace(/\.git$/i, '');
      return `https://${parsed.hostname}/${owner}/${repo}`;
    }
  }
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  return parsed.toString().replace(/\?$/, '');
}

export function preferredDisplayUrl(candidates: Array<string | null | undefined>): string {
  const cleaned = candidates.map((item) => displayUrl(item)).filter((item): item is string => Boolean(item));
  const repo = cleaned.find((item) => /https:\/\/(?:github|gitlab)\.com\/[^/]+\/[^/]+/i.test(item));
  return repo || cleaned[0] || '';
}

export function githubRepoParts(raw?: string | null): { owner: string; repo: string } | null {
  const key = canonicalUrlKey(raw);
  const match = key.match(/^(?:github|gitlab)\.com\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export function isCodeHostKey(key: string): boolean {
  return key.startsWith('github.com/') || key.startsWith('gitlab.com/');
}

/**
 * Clave de la URL principal. El website solo se suma si de verdad es la landing de ESE repo
 * (el host coincide con el nombre del repositorio), no la web de la marca.
 */
export function productKeys(url?: string | null, website?: string | null): Set<string> {
  const keys = new Set<string>();
  const urlKey = canonicalUrlKey(url);
  const websiteKey = canonicalUrlKey(website);
  if (urlKey) keys.add(urlKey);
  if (
    websiteKey &&
    websiteKey !== urlKey &&
    isCodeHostKey(urlKey) &&
    !isCodeHostKey(websiteKey) &&
    repoMatchesLanding(url, '', website, '')
  ) {
    keys.add(websiteKey);
  }
  return keys;
}

function hostOf(raw?: string | null): string {
  if (!raw) return '';
  try {
    return new URL(ensureProtocol(String(raw).trim())).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function namesCompatible(repoToken: string, repoName: string, landingName: string): boolean {
  const nameRepo = alnum(repoName);
  const nameLand = alnum(landingName);
  if (!nameRepo || !nameLand) return true;
  if (nameRepo === nameLand) return true;
  const extra = (longer: string, shorter: string) => longer.startsWith(shorter) && longer.length - shorter.length <= 4;
  return extra(nameLand, repoToken) || extra(nameRepo, repoToken) || extra(nameLand, nameRepo) || extra(nameRepo, nameLand);
}

/**
 * Une github.com/owner/repo con la landing del mismo producto.
 * El host tiene que coincidir con el repo, o el nombre tiene que ser el mismo y el dominio casi igual
 * (t3code ↔ t3.codes). No alcanza con que un nombre contenga al otro ("motion" no es "motionkit").
 */
export function repoMatchesLanding(
  repoUrl?: string | null,
  repoNoteName?: string | null,
  landingUrl?: string | null,
  landingName?: string | null
): boolean {
  const parts = githubRepoParts(repoUrl);
  if (!parts || !landingUrl) return false;
  const repoToken = alnum(parts.repo);
  if (repoToken.length < 4) return false;

  const host = hostOf(landingUrl);
  if (!host || host === 'github.com' || host === 'gitlab.com') return false;
  if (GENERIC_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return false;

  const label = alnum(host.split('.')[0] || '');
  const flat = alnum(host);
  const namesOk = namesCompatible(repoToken, repoNoteName || '', landingName || '');

  if (label.length >= 4 && label === repoToken) return namesOk;

  const nameRepo = alnum(repoNoteName || '');
  const nameLand = alnum(landingName || '');
  const namesEqual = nameRepo.length >= 4 && nameRepo === nameLand;
  return namesEqual && (flat === repoToken || (flat.startsWith(repoToken) && flat.length - repoToken.length <= 2));
}

export interface ProductRef {
  url?: string | null;
  website?: string | null;
  name?: string | null;
}

function explicitRepoLanding(repoSide: ProductRef, landingSide: ProductRef): boolean {
  const repoKey = canonicalUrlKey(repoSide.url);
  const websiteKey = canonicalUrlKey(repoSide.website);
  const landingKey = canonicalUrlKey(landingSide.url);
  if (!repoKey || !websiteKey || !landingKey || websiteKey !== landingKey) return false;
  if (!isCodeHostKey(repoKey) || isCodeHostKey(landingKey)) return false;
  return repoMatchesLanding(repoSide.url, repoSide.name, landingSide.url, landingSide.name);
}

export function sameProduct(a: ProductRef, b: ProductRef): boolean {
  const aUrl = canonicalUrlKey(a.url);
  const bUrl = canonicalUrlKey(b.url);
  if (aUrl && bUrl && aUrl === bUrl) return true;
  if (a.url && b.url && repoMatchesLanding(a.url, a.name, b.url, b.name)) return true;
  if (b.url && a.url && repoMatchesLanding(b.url, b.name, a.url, a.name)) return true;
  if (explicitRepoLanding(a, b) || explicitRepoLanding(b, a)) return true;
  return false;
}
