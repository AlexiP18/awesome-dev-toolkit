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

    const response = await fetch(rawUrl, {
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

    // t.co devuelve HTTP 200 con HTML (<title>URL</title> y META refresh / location.replace) cuando detecta User-Agent de navegador
    if (/^https?:\/\/t\.co\//i.test(finalUrl) && method === 'GET') {
      const html = await response.text();
      const titleMatch = html.match(/<title>\s*(https?:\/\/[^<\s"']+)\s*<\/title>/i);
      const metaMatch = html.match(/URL=(https?:\/\/[^"'>\s]+)/i);
      const jsMatch = html.match(/location\.replace\(["'](https?:[^"']+)["']\)/i);

      const extracted =
        titleMatch?.[1] ||
        metaMatch?.[1] ||
        (jsMatch?.[1] ? jsMatch[1].replace(/\\\//g, '/') : undefined);

      if (extracted) {
        finalUrl = cleanTrackingParams(extracted.trim());
      }
    }
  } catch {
    // If request fails or timeouts, fallback to original URL
    finalUrl = cleanTrackingParams(rawUrl);
  }

  // Normalize GitHub URL
  const ghMatch = finalUrl.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i);
  if (ghMatch) {
    const owner = ghMatch[1];
    const repo = ghMatch[2].replace(/\.git$/, '').replace(/(\.\.\.|…)+$/, '');
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

/**
 * Busca en el texto enlaces de GitHub truncados visualmente por X (ej. "github.com/HKUDS/Vibe-Tra..." o "github.com/The-Swarm-Corp…")
 * y los reemplaza por las URLs completas resueltas desde t.co o buscando en la API de GitHub con el contexto del tweet.
 */
export async function expandTruncatedGitHubUrls(
  text: string,
  knownResolvedUrls: string[],
  githubToken?: string
): Promise<{ cleanedText: string; expandedUrls: string[] }> {
  if (!text) return { cleanedText: text, expandedUrls: [] };

  let cleanedText = text;
  const expandedUrls: string[] = [];

  const truncatedRegex = /\b((?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)(?:\/([a-zA-Z0-9_.-]*))?)(?:\.\.\.|…)/gi;
  const matches = Array.from(text.matchAll(truncatedRegex));

  for (const m of matches) {
    const fullTruncatedToken = m[0]; // ej. "github.com/HKUDS/Vibe-Tra..."
    const rawPrefix = m[1].startsWith('http') ? m[1] : `https://${m[1]}`; // ej. "https://github.com/HKUDS/Vibe-Tra"
    const ownerPart = m[2]; // ej. "HKUDS" o "The-Swarm-Corp"
    const repoPart = m[3] || ''; // ej. "Vibe-Tra" o ""

    // 1. ¿Ya tenemos la URL completa resuelta desde t.co en knownResolvedUrls?
    let resolvedFull = knownResolvedUrls.find((u) =>
      u.toLowerCase().startsWith(rawPrefix.toLowerCase())
    );

    // 2. Si no estaba en knownResolvedUrls, intentar reconstruir con el nombre mencionado justo antes en el texto
    // (ej: "2. vibe-trading -> ...\ngithub.com/HKUDS/Vibe-Tra...")
    if (!resolvedFull) {
      const idx = m.index ?? 0;
      const precedingContext = text.slice(Math.max(0, idx - 180), idx);
      // Buscar el nombre de herramienta en la línea previa (ej: "1. autohedge ->", "2. vibe-trading ->")
      const toolNameMatches = Array.from(
        precedingContext.matchAll(/(?:^|\n)\s*(?:\d+[.)]\s*|[•*-]\s*)?([a-zA-Z0-9_.-]+(?:\s+[a-zA-Z0-9_.-]+)?)\s*(?:→|->|:|-|—)/g)
      );
      const lastToolName = toolNameMatches.length > 0 ? toolNameMatches[toolNameMatches.length - 1][1].trim() : '';

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'awesome-dev-toolkit-bot',
      };
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

      // 2a. Si tenemos owner completo y repoPart es prefijo del nombre de herramienta (ej. owner="HKUDS", repoPart="Vibe-Tra", lastToolName="vibe-trading")
      if (
        repoPart &&
        lastToolName &&
        lastToolName.toLowerCase().replace(/\s+/g, '-').startsWith(repoPart.toLowerCase())
      ) {
        const candidateRepo = lastToolName.replace(/\s+/g, '-');
        try {
          const checkRes = await fetch(`https://api.github.com/repos/${ownerPart}/${candidateRepo}`, { headers });
          if (checkRes.ok) {
            const repoData = (await checkRes.json()) as { html_url?: string };
            if (repoData.html_url) resolvedFull = repoData.html_url;
          }
        } catch {
          // ignore
        }
      }

      // 2b. Buscar en GitHub Search API combinando el prefijo y el nombre de la herramienta
      if (!resolvedFull) {
        const cleanTool = lastToolName.replace(/\s+/g, '-');
        const query = repoPart
          ? `${cleanTool || repoPart} user:${ownerPart}`
          : `${cleanTool || ownerPart} in:name`;
        try {
          const searchRes = await fetch(
            `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`,
            { headers }
          );
          if (searchRes.ok) {
            const searchData = (await searchRes.json()) as { items?: Array<{ html_url: string; full_name: string }> };
            const matchItem =
              searchData.items?.find((item) =>
                item.html_url.toLowerCase().startsWith(rawPrefix.toLowerCase())
              ) || (repoPart ? searchData.items?.[0] : undefined);
            if (matchItem?.html_url) {
              resolvedFull = matchItem.html_url;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    if (resolvedFull) {
      cleanedText = cleanedText.replace(fullTruncatedToken, resolvedFull);
      if (!expandedUrls.some((u) => u.toLowerCase() === resolvedFull!.toLowerCase())) {
        expandedUrls.push(resolvedFull);
      }
    } else {
      // Eliminar el link truncado del texto para que la IA jamás copie la URL cortada
      cleanedText = cleanedText.replace(fullTruncatedToken, '');
    }
  }

  return { cleanedText, expandedUrls };
}
