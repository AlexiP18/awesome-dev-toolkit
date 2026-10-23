/**
 * Link resolver utility: unrolls t.co and other short links,
 * and detects GitHub repositories or project homepages.
 */

export interface ResolvedLink {
  originalUrl: string;
  finalUrl: string;
  isGitHub: boolean;
  githubOwner?: string;
  githubRepo?: string;
}

export const IGNORED_DOMAINS = [
  't.me',
  'telegram.me',
  'discord.gg',
  'discord.com/invite',
  'chat.whatsapp.com',
  'wa.me',
  'youtube.com',
  'youtu.be',
  'instagram.com',
  'tiktok.com',
  'facebook.com',
  'buymeacoffee.com',
  'patreon.com',
  'ko-fi.com',
  'twitter.com',
  'x.com',
];

export function cleanTrackingParams(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const tracking = [
      'oref', 'ref', 'ref_src', 'utm_source', 'utm_medium',
      'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'
    ];
    for (const p of tracking) {
      u.searchParams.delete(p);
    }
    return u.toString().replace(/\?$/, '');
  } catch {
    return rawUrl;
  }
}

export function isIgnoredNonToolUrl(rawUrl: string): boolean {
  const lower = rawUrl.toLowerCase();
  return IGNORED_DOMAINS.some((domain) => lower.includes(domain));
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];

  const foundUrls: string[] = [];

  // 1. Patrones de tarjetas de GitHub en X (ej: "GitHub - diegosouzapw/OmniRoute: ...")
  // Se evalúan primero porque contienen el owner/repo completo sin truncamiento visual
  const ghCardRegex = /GitHub\s*[-–—:]\s*([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/gi;
  let ghCardMatch;
  while ((ghCardMatch = ghCardRegex.exec(text)) !== null) {
    const owner = ghCardMatch[1];
    const repo = ghCardMatch[2].replace(/[.,;:!?…]+$/, '');
    if (owner && repo) {
      const ghUrl = `https://github.com/${owner}/${repo}`;
      if (!foundUrls.some((u) => u.toLowerCase() === ghUrl.toLowerCase())) {
        foundUrls.push(ghUrl);
      }
    }
  }

  // 2. Enlaces estándar con protocolo http(s)://
  const httpRegex = /(https?:\/\/[^\s<>"'()]+)/gi;
  const httpMatches = text.match(httpRegex) || [];
  for (const match of httpMatches) {
    // Descartar enlaces truncados visualmente por X/Twitter (terminan en "..." o "…")
    if (/\.\.\.$|…$/.test(match)) continue;
    const cleaned = match.replace(/[.,;:!?)]+$/, '');
    if (!isIgnoredNonToolUrl(cleaned)) {
      if (!foundUrls.some((u) => u.toLowerCase() === cleaned.toLowerCase())) {
        foundUrls.push(cleaned);
      }
    }
  }

  // 3. Dominios y repositorios sin protocolo (ej: github.com/user/repo, adcode.bluethenics.com, jiro.build)
  const domainRegex = /\b(?:github\.com|gitlab\.com|[a-zA-Z0-9-]+\.(?:com|io|dev|app|org|net|co|ai|build|sh|so|tech|tools|site|design|website))\b(?:\/[^\s<>"'()]*)?/gi;
  const domainMatches = text.match(domainRegex) || [];
  for (const match of domainMatches) {
    // Descartar enlaces truncados visualmente por X/Twitter (ej. "github.com/diegosouzapw/O..." o "…")
    if (/\.\.\.$|…$/.test(match)) continue;
    const cleaned = match.replace(/[.,;:!?)]+$/, '');
    // Ignorar si solo es el dominio "github.com" sin ruta (ej. del pie "From github.com")
    if (/^(?:www\.)?(?:github|gitlab)\.com$/i.test(cleaned)) continue;

    const withProtocol = `https://${cleaned}`;
    if (!isIgnoredNonToolUrl(withProtocol)) {
      const alreadyHas = foundUrls.some(
        (u) => u.replace(/^https?:\/\//, '').toLowerCase() === cleaned.toLowerCase()
      );
      if (!alreadyHas) {
        foundUrls.push(withProtocol);
      }
    }
  }

  // 4. Filtrar URLs de GitHub que sean un prefijo truncado de otra URL de GitHub más completa en el mismo tweet
  // (ej. descartar "https://github.com/diegosouzapw/O" si existe "https://github.com/diegosouzapw/OmniRoute")
  const filteredUrls = foundUrls.filter((url) => {
    const lower = url.toLowerCase();
    if (!lower.includes('github.com/')) return true;
    const isPrefixOfAnother = foundUrls.some(
      (other) => other.toLowerCase() !== lower && other.toLowerCase().startsWith(lower)
    );
    return !isPrefixOfAnother;
  });

  return Array.from(new Set(filteredUrls));
}

export async function resolveUrl(rawUrl: string, timeoutMs = 6000): Promise<ResolvedLink> {
  let finalUrl = rawUrl;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const isShortlink = /t\.co|bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|buff\.ly/i.test(rawUrl);
    // Use GET for shortlinks because t.co often ignores HEAD redirects
    const method = isShortlink ? 'GET' : 'HEAD';

    let response = await fetch(rawUrl, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    clearTimeout(timer);

    if (response.url) {
      finalUrl = cleanTrackingParams(response.url);
    }
  } catch {
    // If request fails or timeouts, fallback to original URL
    finalUrl = cleanTrackingParams(rawUrl);
  }

  // Normalize GitHub URL
  const ghMatch = finalUrl.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i);
  if (ghMatch) {
    const owner = ghMatch[1];
    let repo = ghMatch[2].replace(/\.git$/, '');
    return {
      originalUrl: rawUrl,
      finalUrl: `https://github.com/${owner}/${repo}`,
      isGitHub: true,
      githubOwner: owner,
      githubRepo: repo,
    };
  }

  return {
    originalUrl: rawUrl,
    finalUrl,
    isGitHub: false,
  };
}
