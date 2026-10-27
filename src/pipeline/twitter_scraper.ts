/**
 * Extractor ligero para publicaciones e hilos de X (Twitter).
 * Utiliza api.fxtwitter.com con timeout rápido de resiliencia.
 */

export interface ExtractedTweet {
  id: string;
  url: string;
  text: string;
  authorName?: string;
  authorHandle?: string;
  avatarUrl?: string;
}

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
