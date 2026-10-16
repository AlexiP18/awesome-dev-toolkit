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

export function extractUrlsFromText(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s<>"'()]+)/gi;
  const matches = text.match(urlRegex) || [];
  // Clean trailing punctuation often caught in regex
  return matches.map((url) => url.replace(/[.,;:!?)]+$/, ''));
}

export async function resolveUrl(rawUrl: string, timeoutMs = 6000): Promise<ResolvedLink> {
  let finalUrl = rawUrl;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Try HEAD first to avoid downloading large bodies
    let response = await fetch(rawUrl, {
      method: 'HEAD',
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
    // If HEAD fails or timeouts, fallback to original URL
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
