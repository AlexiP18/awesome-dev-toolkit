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

export function isIgnoredNonToolUrl(rawUrl: string): boolean {
  const lower = rawUrl.toLowerCase();
  return IGNORED_DOMAINS.some((domain) => lower.includes(domain));
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];

  const foundUrls: string[] = [];

  // 1. Enlaces estándar con protocolo http(s)://
  const httpRegex = /(https?:\/\/[^\s<>"'()]+)/gi;
  const httpMatches = text.match(httpRegex) || [];
  for (const match of httpMatches) {
    const cleaned = match.replace(/[.,;:!?)]+$/, '');
    if (!isIgnoredNonToolUrl(cleaned)) {
      foundUrls.push(cleaned);
    }
  }

  // 2. Dominios y repositorios sin protocolo (ej: github.com/user/repo, adcode.bluethenics.com, jiro.build)
  const domainRegex = /\b(?:github\.com|gitlab\.com|[a-zA-Z0-9-]+\.(?:com|io|dev|app|org|net|co|ai|build|sh|so|tech|tools|site|design|website))\b(?:\/[^\s<>"'()]*)?/gi;
  const domainMatches = text.match(domainRegex) || [];
  for (const match of domainMatches) {
    const cleaned = match.replace(/[.,;:!?)]+$/, '');
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

  return Array.from(new Set(foundUrls));
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
      finalUrl = response.url;
    }
  } catch {
    // If request fails or timeouts, fallback to original URL
    finalUrl = rawUrl;
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
