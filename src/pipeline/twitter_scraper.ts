/**
 * Extractor ligero y resiliente para publicaciones e hilos de X (Twitter).
 * Utiliza api.fxtwitter.com con timeout rápido y r.jina.ai para desenrollar hilos completos.
 */

export interface ExtractedTweet {
  id: string;
  url: string;
  text: string;
  authorName?: string;
  authorHandle?: string;
  avatarUrl?: string;
}

export interface ExtractedThread {
  rootTweet: ExtractedTweet | null;
  threadTweets: Array<{
    id: string;
    text: string;
    url: string;
  }>;
}

/**
 * Patrón para identificar y descartar tweets de autopromoción, patrocinios,
 * venta de bases de datos/cursos o CTAs de cierre en hilos.
 */
export const PROMO_TWEET_PATTERN = /(?:antes de seguir|con @\w+.*hemos reunido|hemos reunido.*herramientas|base.*3000.*herramientas|consíguela gratis|aquí la tienes\s*→|newsletter|patrocinado|sponsor|patrocinador|¡esto es todo amigos!|gracias por acompañarme|sígueme para más|sigueme para mas|rt y me gusta|repost y me gusta|dale rt y like)/i;

export function isPromoTweet(text: string): boolean {
  if (!text) return false;
  return PROMO_TWEET_PATTERN.test(text);
}

/**
 * Obtiene los detalles de un único tweet raíz desde api.fxtwitter.com.
 */
export async function fetchTweetDetailsFromX(tweetUrl: string, timeoutMs = 4500): Promise<ExtractedTweet | null> {
  if (!tweetUrl) return null;
  const match = tweetUrl.match(/https?:\/\/(?:x|twitter)\.com\/(?:[a-zA-Z0-9_]+\/)?status\/(\d+)/i);
  if (!match) return null;
  const tweetId = match[1];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!data.tweet) return null;

    const tweet = data.tweet;
    return {
      id: tweetId,
      url: tweet.url || `https://x.com/i/status/${tweetId}`,
      text: tweet.text || '',
      authorName: tweet.author?.name,
      authorHandle: tweet.author?.screen_name,
      avatarUrl: tweet.author?.avatar_url,
    };
  } catch (err: any) {
    console.warn(`[Twitter API] No se pudo obtener contenido automático de X (${tweetUrl}):`, err?.message || err);
    return null;
  }
}

/**
 * Obtiene el tweet raíz y desenrolla todos los tweets del hilo pertenecientes al autor,
 * filtrando automáticamente publicidad intermedia y cierres promocionales.
 */
export async function fetchThreadTweetsFromX(
  tweetUrl: string,
  authorHandle?: string,
  timeoutMs = 8000
): Promise<ExtractedThread> {
  const rootTweet = await fetchTweetDetailsFromX(tweetUrl, 4000);
  const match = tweetUrl.match(/https?:\/\/(?:x|twitter)\.com\/(?:([a-zA-Z0-9_]+)\/)?status\/(\d+)/i);
  if (!match) {
    return { rootTweet, threadTweets: [] };
  }

  const rootId = rootTweet?.id || match[2];
  const targetHandle = (
    authorHandle ||
    rootTweet?.authorHandle ||
    (match[1] && !['i', 'status'].includes(match[1].toLowerCase()) ? match[1] : '')
  ).toLowerCase();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const jinaUrl = `https://r.jina.ai/${tweetUrl}`;
    const jinaRes = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timer);

    if (!jinaRes.ok) {
      return { rootTweet, threadTweets: [] };
    }

    const mdContent = await jinaRes.text();
    const statusRegex = /https:\/\/(?:x|twitter)\.com\/([a-zA-Z0-9_]+)\/status\/(\d+)/gi;
    const threadStatusIds: string[] = [];

    let m: RegExpExecArray | null;
    while ((m = statusRegex.exec(mdContent)) !== null) {
      const tweetAuthor = m[1].toLowerCase();
      const statusId = m[2];

      const matchesAuthor = targetHandle ? tweetAuthor === targetHandle : true;
      if (matchesAuthor && statusId !== rootId && !threadStatusIds.includes(statusId)) {
        threadStatusIds.push(statusId);
      }
    }

    // Limitar para evitar sobrecargas accidentales (un hilo técnico estándar rara vez pasa de 15)
    const candidateIds = threadStatusIds.slice(0, 15);
    if (candidateIds.length === 0) {
      return { rootTweet, threadTweets: [] };
    }

    // Traer en paralelo los tweets vía fxtwitter
    const fetchedResults = await Promise.allSettled(
      candidateIds.map(async (id) => {
        const single = await fetchTweetDetailsFromX(`https://x.com/i/status/${id}`, 3500);
        return single;
      })
    );

    const threadTweets: Array<{ id: string; text: string; url: string }> = [];
    for (const res of fetchedResults) {
      if (res.status === 'fulfilled' && res.value && res.value.text) {
        const tweetText = res.value.text.trim();
        if (!isPromoTweet(tweetText)) {
          threadTweets.push({
            id: res.value.id,
            text: tweetText,
            url: res.value.url,
          });
        }
      }
    }

    return { rootTweet, threadTweets };
  } catch (err: any) {
    console.warn(`[Twitter API] Error al desenrollar hilo de X (${tweetUrl}):`, err?.message || err);
    return { rootTweet, threadTweets: [] };
  }
}
