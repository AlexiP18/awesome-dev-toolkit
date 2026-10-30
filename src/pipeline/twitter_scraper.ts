/**
 * Scraper especializado y resiliente para publicaciones e hilos de X (Twitter).
 * Arquitectura multi-nivel en cascada:
 *   1. FxTwitter v2 Thread API (nativo de hilos y tarjetas con URLs expandidas)
 *   2. FxTwitter v1 Status API (detalles de tweet individual)
 *   3. Twitter Syndication API (CDN oficial de Twitter sin autenticación)
 *   4. Fallback de emergencia con Jina Reader
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
  providerUsed?: 'fxtwitter_v2' | 'fxtwitter_v1' | 'syndication' | 'jina';
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

/** Normaliza texto para comparar tweets ignorando markdown, enlaces, emojis y espacios. */
export function normalizeForCompare(text: string): string {
  return (text || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function isPromoTweet(text: string): boolean {
  if (!text) return false;
  return PROMO_TWEET_PATTERN.test(text);
}

/**
 * Extrae el ID numérico de cualquier variante de enlace a un tweet en X / Twitter.
 */
export function extractTweetId(tweetUrl: string): string | null {
  if (!tweetUrl) return null;
  const match = tweetUrl.match(/https?:\/\/(?:x|twitter)\.com\/(?:[a-zA-Z0-9_]+\/)?status(?:es)?\/(\d+)/i);
  if (match) return match[1];
  const digitsOnly = tweetUrl.trim().match(/^(\d{15,25})$/);
  return digitsOnly ? digitsOnly[1] : null;
}

/**
 * Nivel 3: Obtiene el tweet directamente desde la CDN oficial de sindicación de Twitter.
 * Ultra rápido (<200 ms), público y sin autenticación requerida.
 */
export async function fetchTweetFromSyndication(tweetId: string, timeoutMs = 3500): Promise<ExtractedTweet | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=a`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!data || !data.text) return null;

    return {
      id: data.id_str || tweetId,
      url: `https://x.com/${data.user?.screen_name || 'i'}/status/${tweetId}`,
      text: data.text,
      authorName: data.user?.name,
      authorHandle: data.user?.screen_name,
      avatarUrl: data.user?.profile_image_url_https,
    };
  } catch {
    return null;
  }
}

/**
 * Nivel 2: Obtiene los detalles de un único tweet raíz desde api.fxtwitter.com/status/{id}.
 */
export async function fetchTweetFromFxTwitterV1(tweetId: string, timeoutMs = 4000): Promise<ExtractedTweet | null> {
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
  } catch {
    return null;
  }
}

/**
 * Nivel 1: Scraper Especializado de Hilos y Tarjetas vía FxTwitter v2 Thread API.
 * Devuelve el tweet raíz, todas las autorrespuestas con enlaces/tarjetas y los pasos cronológicos del hilo.
 */
export async function fetchThreadFromFxTwitterV2(
  tweetId: string,
  authorHandle?: string,
  timeoutMs = 6000
): Promise<ExtractedThread | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`https://api.fxtwitter.com/2/thread/${tweetId}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (data.code !== 200 || !Array.isArray(data.thread) || data.thread.length === 0) {
      return null;
    }

    const threadItems = data.thread;
    const rootRaw = threadItems[0];
    if (!rootRaw || !rootRaw.text) return null;

    const rootTweet: ExtractedTweet = {
      id: String(rootRaw.id || tweetId),
      url: rootRaw.url || `https://x.com/i/status/${tweetId}`,
      text: rootRaw.text || '',
      authorName: rootRaw.author?.name,
      authorHandle: rootRaw.author?.screen_name,
      avatarUrl: rootRaw.author?.avatar_url,
      cardUrl: rootRaw.card?.url || undefined,
      cardTitle: rootRaw.card?.title || undefined,
      cardDescription: rootRaw.card?.description || undefined,
    };

    const targetHandle = (authorHandle || rootTweet.authorHandle || '').toLowerCase();
    const threadTweets: ThreadTweet[] = [];

    // Procesar autorrespuestas o pasos subsecuentes del hilo
    for (let i = 1; i < threadItems.length; i++) {
      const item = threadItems[i];
      if (!item) continue;

      const itemAuthor = (item.author?.screen_name || '').toLowerCase();
      // Descartar respuestas de otros usuarios que no sean el autor original
      if (targetHandle && itemAuthor && itemAuthor !== targetHandle) {
        continue;
      }

      const itemText = (item.text || '').trim();
      // Filtrar tweets publicitarios, patrocinios o llamadas a acción
      if (itemText && isPromoTweet(itemText)) {
        continue;
      }

      // Descartar comentarios que solo citan otro tweet ajeno sin tarjeta de recurso
      if (!item.card?.url && /https?:\/\/(?:x|twitter)\.com\/[a-zA-Z0-9_]+\/status\/\d+/i.test(itemText)) {
        continue;
      }

      threadTweets.push({
        id: String(item.id),
        text: itemText,
        url: item.url || `https://x.com/${itemAuthor || targetHandle || 'i'}/status/${item.id}`,
        cardUrl: item.card?.url || undefined,
        cardTitle: item.card?.title || undefined,
        cardDescription: item.card?.description || undefined,
      });
    }

    console.log(
      `[Twitter Scraper] ⚡ Hilo obtenido con éxito vía FxTwitter v2: ${threadTweets.length} respuesta(s)/paso(s) para @${targetHandle || 'autor'}`
    );

    return {
      rootTweet,
      threadTweets,
      providerUsed: 'fxtwitter_v2',
    };
  } catch (err: any) {
    console.warn(`[Twitter Scraper] FxTwitter v2 no disponible para tweet ${tweetId}:`, err?.message || err);
    return null;
  }
}

/**
 * Obtiene los detalles de un único tweet raíz con cascada FxTwitter -> Twitter Syndication.
 */
export async function fetchTweetDetailsFromX(tweetUrl: string, timeoutMs = 4500): Promise<ExtractedTweet | null> {
  const tweetId = extractTweetId(tweetUrl);
  if (!tweetId) return null;

  // 1. Probar FxTwitter v1
  const fxResult = await fetchTweetFromFxTwitterV1(tweetId, timeoutMs);
  if (fxResult) return fxResult;

  // 2. Probar Twitter Syndication CDN
  console.log(`[Twitter Scraper] Usando fallback a Twitter Syndication CDN para ${tweetId}...`);
  const synResult = await fetchTweetFromSyndication(tweetId, timeoutMs);
  if (synResult) return synResult;

  return null;
}

/**
 * Obtiene el tweet raíz y desenrolla todos los tweets del hilo pertenecientes al autor.
 * Aplica la cascada:
 *   1. FxTwitter v2 (Hilo nativo + Tarjetas)
 *   2. FxTwitter v1 / Syndication (Tweet raíz) + Jina Reader (Respaldo para hilos extensos)
 */
export async function fetchThreadTweetsFromX(
  tweetUrl: string,
  authorHandle?: string,
  timeoutMs = 9000
): Promise<ExtractedThread> {
  const tweetId = extractTweetId(tweetUrl);
  if (!tweetId) {
    return { rootTweet: null, threadTweets: [] };
  }

  // Nivel 1: Intentar FxTwitter v2 Thread API (ultra rápido, nativo y exacto)
  const v2Thread = await fetchThreadFromFxTwitterV2(tweetId, authorHandle, 5500);
  if (v2Thread && v2Thread.rootTweet) {
    return v2Thread;
  }

  // Nivel 2: Obtener tweet raíz vía FxTwitter v1 o Syndication CDN
  console.log(`[Twitter Scraper] FxTwitter v2 no respondió; usando cascada de respaldo para ${tweetUrl}...`);
  const rootTweet = await fetchTweetDetailsFromX(tweetUrl, 4000);

  const targetHandle = (
    authorHandle ||
    rootTweet?.authorHandle ||
    ''
  ).toLowerCase();

  // Nivel 4: Si no tenemos hilo directo de la API, usar Jina Reader como respaldo de emergencia
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const jinaUrl = `https://r.jina.ai/${tweetUrl}`;
    const jinaRes = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'text/plain',
      },
    });
    clearTimeout(timer);

    if (!jinaRes.ok) {
      console.warn(`[Twitter Scraper] Jina respondió con status ${jinaRes.status} para ${tweetUrl}`);
      return { rootTweet, threadTweets: [], providerUsed: rootTweet ? 'fxtwitter_v1' : undefined };
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
      if (matchesAuthor && statusId !== tweetId && !threadStatusIds.includes(statusId)) {
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
      const chainIds = new Set<string>([tweetId]);
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

    // Estrategia 2: Respaldo por bloques de autor si los IDs no aparecieron
    if (threadTweets.length === 0 && targetHandle) {
      const escapedHandle = targetHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const avatarSplitRegex = new RegExp(`\\[\\!\\[Image \\d+:[^\\]]*\\]\\([^)]+\\)\\]\\(https?:\\/\\/x\\.com\\/${escapedHandle}\\)`, 'gi');
      const chunks = mdContent.split(avatarSplitRegex);

      for (let i = 1; i < chunks.length; i++) {
        let chunk = chunks[i];
        chunk = chunk.split(new RegExp(`\\[\\!\\[Image \\d+:[^\\]]*\\]\\([^)]+\\)\\]\\(https?:\\/\\/x\\.com\\/(?!${escapedHandle})[^)]+\\)`, 'i'))[0];
        chunk = chunk.split(/\n\s*[*#]/)[0];
        chunk = chunk.replace(/^[*•\s]+/, '').trim();
        chunk = chunk.replace(/\[\d+\]\(https?:\/\/x\.com\/compose\/post[^)]+\)[\s\d.KMkm]+$/i, '').trim();
        chunk = chunk.replace(/Show more$/i, '').trim();

        if (chunk.length > 20 && !isPromoTweet(chunk)) {
          const rootNorm = normalizeForCompare(rootTweet?.text || '');
          const chunkNorm = normalizeForCompare(chunk);
          const rootProbe = rootNorm.slice(0, 20);
          const isRootItself = rootProbe.length >= 10 && chunkNorm.includes(rootProbe);
          if (!isRootItself) {
            if (!threadTweets.some((t) => t.text.includes(chunk.slice(0, 45)))) {
              threadTweets.push({
                id: `${tweetId}_step_${threadTweets.length + 1}`,
                text: chunk,
                url: `https://x.com/${targetHandle}/status/${tweetId}#step-${threadTweets.length + 1}`,
              });
            }
          }
        }
      }
    }

    if (threadStatusIds.length === 0 && threadTweets.length === 1) {
      threadTweets.length = 0;
    }

    console.log(`[Twitter Scraper] 🧵 Total tweets del hilo extraídos para @${targetHandle}: ${threadTweets.length} (vía Jina)`);
    return { rootTweet, threadTweets, providerUsed: 'jina' };
  } catch (err: any) {
    console.warn(`[Twitter Scraper] Error en respaldo Jina (${tweetUrl}):`, err?.message || err);
    return { rootTweet, threadTweets: [], providerUsed: rootTweet ? 'fxtwitter_v1' : undefined };
  }
}
