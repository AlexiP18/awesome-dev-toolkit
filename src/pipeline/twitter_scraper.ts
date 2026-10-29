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
  /** ID del tweet al que responde (autorrespuesta del autor con el enlace, hilos, etc.) */
  replyingToStatus?: string;
  /** Tarjeta de enlace (imagen que redirige al recurso) adjunta al tweet */
  cardUrl?: string;
  cardTitle?: string;
  cardDescription?: string;
}

export interface ThreadTweet {
  id: string;
  text: string;
  url: string;
  cardUrl?: string;
  cardTitle?: string;
  cardDescription?: string;
}

export interface ExtractedThread {
  rootTweet: ExtractedTweet | null;
  threadTweets: ThreadTweet[];
}

/**
 * Convierte la tarjeta de enlace de un tweet (imagen/preview que redirige al recurso)
 * en un bloque de texto explícito para que la IA y el extractor de URLs lo detecten.
 */
export function formatTweetCard(t: { cardUrl?: string; cardTitle?: string; cardDescription?: string }): string {
  if (!t.cardUrl) return '';
  const parts = [`[Enlace en tarjeta del tweet: ${t.cardUrl}`];
  if (t.cardTitle) parts.push(`Título: ${t.cardTitle}`);
  if (t.cardDescription) parts.push(`Descripción: ${t.cardDescription}`);
  return parts.join(' | ') + ']';
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
      replyingToStatus: tweet.replying_to_status ? String(tweet.replying_to_status) : undefined,
      cardUrl: tweet.card?.url || undefined,
      cardTitle: tweet.card?.title || undefined,
      cardDescription: tweet.card?.description || undefined,
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
  timeoutMs = 9000
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
    // Usar 'Mozilla/5.0' simple para evitar 403 de Cloudflare/Jina
    const jinaRes = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'text/plain',
      },
    });
    clearTimeout(timer);

    if (!jinaRes.ok) {
      console.warn(`[Twitter API] Jina respondió con status ${jinaRes.status} para ${tweetUrl}`);
      return { rootTweet, threadTweets: [] };
    }

    const mdContent = await jinaRes.text();
    const threadTweets: ThreadTweet[] = [];

    // Estrategia 1: Buscar enlaces de status directos en el contenido markdown
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

    if (threadStatusIds.length > 0) {
      const candidateIds = threadStatusIds.slice(0, 15);
      const fetchedResults = await Promise.allSettled(
        candidateIds.map(async (id) => {
          const single = await fetchTweetDetailsFromX(`https://x.com/i/status/${id}`, 3500);
          return single;
        })
      );

      const fetchedTweets: ExtractedTweet[] = [];
      for (const res of fetchedResults) {
        if (res.status === 'fulfilled' && res.value && (res.value.text || res.value.cardUrl)) {
          fetchedTweets.push(res.value);
        }
      }

      // Conservar solo los tweets que pertenecen a la cadena de respuestas del tweet raíz
      // (autorrespuestas con el enlace, hilos) y descartar tweets sueltos posteriores del autor.
      const chainIds = new Set<string>([rootId]);
      const accepted = new Set<string>();
      let grew = true;
      while (grew) {
        grew = false;
        for (const t of fetchedTweets) {
          if (accepted.has(t.id)) continue;
          const sameAuthor = !targetHandle || !t.authorHandle || t.authorHandle.toLowerCase() === targetHandle;
          const inChain = Boolean(t.replyingToStatus && chainIds.has(t.replyingToStatus));
          if (sameAuthor && inChain) {
            accepted.add(t.id);
            chainIds.add(t.id);
            grew = true;
          }
        }
      }

      for (const t of fetchedTweets) {
        if (!accepted.has(t.id)) continue;
        const tweetText = (t.text || '').trim();
        if (tweetText && isPromoTweet(tweetText)) continue;
        // Descartar comentarios del autor que solo citan/enlazan otro tweet (contenido ajeno al recurso)
        if (!t.cardUrl && /https?:\/\/(?:x|twitter)\.com\/[a-zA-Z0-9_]+\/status\/\d+/i.test(tweetText)) continue;
        threadTweets.push({
          id: t.id,
          text: tweetText,
          url: t.url,
          cardUrl: t.cardUrl,
          cardTitle: t.cardTitle,
          cardDescription: t.cardDescription,
        });
      }
    }

    // Estrategia 2 (Respaldo robusto): Si los IDs de status no aparecieron o fallaron,
    // extraer directamente los bloques de texto de los tweets del autor en el markdown de Jina
    if (threadTweets.length === 0 && targetHandle) {
      const escapedHandle = targetHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const avatarSplitRegex = new RegExp(`\\[\\!\\[Image \\d+:[^\\]]*\\]\\([^)]+\\)\\]\\(https?:\\/\\/x\\.com\\/${escapedHandle}\\)`, 'gi');
      const chunks = mdContent.split(avatarSplitRegex);

      for (let i = 1; i < chunks.length; i++) {
        let chunk = chunks[i];
        // Detener si empieza la respuesta de otro usuario
        chunk = chunk.split(new RegExp(`\\[\\!\\[Image \\d+:[^\\]]*\\]\\([^)]+\\)\\]\\(https?:\\/\\/x\\.com\\/(?!${escapedHandle})[^)]+\\)`, 'i'))[0];
        chunk = chunk.split(/\n\s*[*#]/)[0];
        chunk = chunk.replace(/^[*•\s]+/, '').trim();
        // Limpiar botones de interacción al final del tweet
        chunk = chunk.replace(/\[\d+\]\(https?:\/\/x\.com\/compose\/post[^)]+\)[\s\d.KMkm]+$/i, '').trim();
        chunk = chunk.replace(/Show more$/i, '').trim();

        if (chunk.length > 20 && !isPromoTweet(chunk)) {
          const rootSnippet = (rootTweet?.text || '').slice(0, 45).trim();
          if (!rootSnippet || !chunk.includes(rootSnippet)) {
            if (!threadTweets.some((t) => t.text.includes(chunk.slice(0, 45)))) {
              threadTweets.push({
                id: `${rootId}_step_${threadTweets.length + 1}`,
                text: chunk,
                url: `https://x.com/${targetHandle}/status/${rootId}#step-${threadTweets.length + 1}`,
              });
            }
          }
        }
      }
    }

    console.log(`[Twitter API] 🧵 Total tweets del hilo extraídos para @${targetHandle}: ${threadTweets.length}`);
    return { rootTweet, threadTweets };
  } catch (err: any) {
    console.warn(`[Twitter API] Error al desenrollar hilo de X (${tweetUrl}):`, err?.message || err);
    return { rootTweet, threadTweets: [] };
  }
}
