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
    // Quitar restos de markdown (]) y descartar enlaces truncados visualmente por X/Twitter ("..." o "…")
    const stripped = match.replace(/[\]\[.,;:!?)]+$/, '');
    if (/\.\.\.|…|%E2%80%A6/i.test(stripped)) continue;
    const cleaned = stripped;
    if (!isIgnoredNonToolUrl(cleaned)) {
      if (!foundUrls.some((u) => u.toLowerCase() === cleaned.toLowerCase())) {
        foundUrls.push(cleaned);
      }
    }
  }

  // 3. Dominios y repositorios sin protocolo (ej: github.com/user/repo, adcode.bluethenics.com, jiro.build, minimal.gallery)
  const domainRegex = /\b(?:github\.com|gitlab\.com|[a-zA-Z0-9-]+\.(?:com|io|dev|app|org|net|co|ai|build|sh|so|tech|tools|site|design|website|gallery|me|xyz|space|cloud|cc|link|page|run|studio|guide|work|pro|network|systems|software|is))\b(?:\/[^\s<>"'()]*)?/gi;
  const domainMatches = text.match(domainRegex) || [];
  for (const match of domainMatches) {
    // Descartar enlaces truncados visualmente por X/Twitter (ej. "github.com/diegosouzapw/O..." o "…")
    const strippedDomain = match.replace(/[\]\[.,;:!?)]+$/, '');
    if (/\.\.\.|…|%E2%80%A6/i.test(strippedDomain)) continue;
    const cleaned = strippedDomain;
    // Ignorar si solo es el dominio "github.com" sin ruta (ej. del pie "From github.com")
    if (/^(?:www\.)?(?:github|gitlab)\.com$/i.test(cleaned)) continue;

    const withProtocol = `https://${cleaned}`;
    if (!isIgnoredNonToolUrl(withProtocol)) {
      // Evitar duplicados y sufijos de un host ya encontrado (ej. "vercel.app" dentro de "dvklab.vercel.app")
      const alreadyHas = foundUrls.some((u) => {
        const bare = u.replace(/^https?:\/\//, '').toLowerCase();
        const c = cleaned.toLowerCase();
        return bare === c || bare.replace(/\/.*$/, '').endsWith(`.${c}`) || bare.startsWith(`${c}/`);
      });
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

export interface WebPageMetadata {
  url: string;
  title?: string;
  description?: string;
}

/**
 * Extrae metadatos esenciales (título HTML y meta description u og:description)
 * de páginas web de herramientas para alimentar a los modelos de IA con contexto rico.
 */
export async function fetchWebPageMetadata(url: string, timeoutMs = 4500): Promise<WebPageMetadata | null> {
  if (!url || !url.startsWith('http')) return null;
  if (url.includes('github.com') || url.includes('gitlab.com') || isIgnoredNonToolUrl(url)) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const html = await res.text();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : undefined;
    if (title && title.length > 120) title = title.slice(0, 120) + '...';

    const descMatch =
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);

    let description = descMatch ? descMatch[1].replace(/\s+/g, ' ').trim() : undefined;
    if (description && description.length > 300) {
      description = description.slice(0, 300) + '...';
    }

    if (!title && !description) return null;
    return { url, title, description };
  } catch {
    return null;
  }
}

/**
 * Busca en el texto enlaces de GitHub truncados visualmente por X (ej. "github.com/HKUDS/Vibe-Tra..." o "github.com/addyosmani/age...")
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
    const fullTruncatedToken = m[0]; // ej. "github.com/addyosmani/age..."
    const rawPrefix = m[1].startsWith('http') ? m[1] : `https://${m[1]}`; // ej. "https://github.com/addyosmani/age"
    const ownerPart = m[2]; // ej. "addyosmani"
    const repoPart = m[3] || ''; // ej. "age"

    // 1. ¿Ya tenemos la URL completa resuelta desde t.co en knownResolvedUrls?
    let resolvedFull = knownResolvedUrls.find((u) =>
      u.toLowerCase().startsWith(rawPrefix.toLowerCase())
    );

    // 2. Si no estaba en knownResolvedUrls, intentar reconstruir analizando el contexto de la línea
    if (!resolvedFull) {
      const idx = m.index ?? 0;
      const precedingContext = text.slice(Math.max(0, idx - 180), idx);
      const afterText = text.slice(idx + fullTruncatedToken.length, idx + fullTruncatedToken.length + 160);
      const sameLineAfter = afterText.split('\n')[0].replace(/^[\s\-–—:→>|•*]+/, '').trim();

      // Buscar nombres de herramienta previos o posteriores en la misma línea
      const toolNameMatches = Array.from(
        precedingContext.matchAll(/(?:^|\n)\s*(?:\d+[.)]\s*|[•*-]\s*)?([a-zA-Z0-9_.-]+(?:\s+[a-zA-Z0-9_.-]+)?)\s*(?:→|->|:|-|—)/g)
      );
      const lastToolName = toolNameMatches.length > 0 ? toolNameMatches[toolNameMatches.length - 1][1].trim() : '';
      const contextKeywords = `${lastToolName} ${sameLineAfter}`.trim();

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'awesome-dev-toolkit-bot',
      };
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

      // 2a. Si tenemos owner completo y repoPart es prefijo del nombre de herramienta
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

      // 2b. Buscar repositorios del usuario en GitHub API combinando el prefijo de repo y keywords
      if (!resolvedFull) {
        const query = repoPart
          ? `user:${ownerPart} ${repoPart}`
          : contextKeywords
          ? `${contextKeywords} user:${ownerPart}`
          : `user:${ownerPart}`;

        try {
          const searchRes = await fetch(
            `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`,
            { headers }
          );
          if (searchRes.ok) {
            const searchData = (await searchRes.json()) as {
              items?: Array<{ html_url: string; full_name: string; name: string; description?: string }>;
            };
            const items = searchData.items || [];

            // Buscar item que empiece exactamente con rawPrefix
            let candidate = items.find((item) =>
              item.html_url.toLowerCase().startsWith(rawPrefix.toLowerCase())
            );

            // Si hay varios candidatos por prefijo, desempatar usando keywords del contexto (ej: "AI coding workflows")
            if (!candidate && repoPart) {
              const prefixMatches = items.filter((i) => i.name.toLowerCase().startsWith(repoPart.toLowerCase()));
              if (prefixMatches.length === 1) {
                candidate = prefixMatches[0];
              } else if (prefixMatches.length > 1 && contextKeywords) {
                const words = contextKeywords.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
                candidate =
                  prefixMatches.find((i) => {
                    const combined = `${i.name} ${i.description || ''}`.toLowerCase();
                    return words.some((w) => combined.includes(w));
                  }) || prefixMatches[0];
              }
            }

            if (candidate?.html_url) {
              resolvedFull = candidate.html_url;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    if (resolvedFull) {
      console.log(`[Pipeline] 🔗 Enlace truncado expandido exitosamente: ${fullTruncatedToken} -> ${resolvedFull}`);
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
