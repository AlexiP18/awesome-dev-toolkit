/**
 * BOOKMARKLET 1-CLIC: GUARDAR EN TOOLKIT (CSP-Safe)
 * -------------------------------------------------------------
 * Usa window.open hacia /quick-save para evitar el bloqueo de
 * Content-Security-Policy (connect-src) que impone X / Twitter.
 */

function sendTweetToToolkit(host = 'https://awesome-dev-toolkit.onrender.com') {
  const currentUrl = window.location.href;
  const isTwitter = currentUrl.includes('x.com') || currentUrl.includes('twitter.com');

  if (!isTwitter) {
    alert('Este bookmarklet está diseñado para usarse mientras navegas en x.com / Twitter.');
    return;
  }

  // Encontrar el tweet enfocado o el primero visible
  const article =
    window.getSelection()?.anchorNode?.parentElement?.closest('article[data-testid="tweet"]') ||
    document.activeElement?.closest('article[data-testid="tweet"]') ||
    document.querySelector('article[data-testid="tweet"]');

  let tweetText = '';
  let author = '';
  let links = [];

  if (article) {
    const textEl = article.querySelector('div[data-testid="tweetText"]');
    const t = textEl ? textEl.innerText : '';

    const card =
      article.querySelector('[data-testid="card.wrapper"]') ||
      article.querySelector('[data-testid*="card"]') ||
      article.querySelector('[data-testid*="media"]');
    const cardText = card ? card.innerText : '';
    tweetText = [t, cardText].filter(Boolean).join('\n');

    const userEl = article.querySelector('div[data-testid="User-Name"]');
    author = userEl ? userEl.innerText.split('\n')[0] : '';

    links = Array.from(article.querySelectorAll('a'))
      .map((a) => a.href)
      .filter((h) => h && !h.includes('x.com') && !h.includes('twitter.com') && !h.startsWith('javascript:'));

    if (card) {
      const cardAnchor = card.tagName === 'A' ? card : card.querySelector('a');
      if (cardAnchor && cardAnchor.href && !cardAnchor.href.includes('x.com') && !cardAnchor.href.includes('twitter.com')) {
        links.unshift(cardAnchor.href);
      }
    }
  }

  const dedupLinks = Array.from(new Set(links));

  const query = new URLSearchParams({
    sourceTweet: currentUrl,
    rawText: tweetText,
    author: author,
    url: dedupLinks.join(','),
  }).toString();

  const w = 440;
  const h = 320;
  const left = screen.width / 2 - w / 2;
  const top = screen.height / 2 - h / 2;

  window.open(
    `${host}/quick-save?${query}`,
    'ToolkitQuickSave',
    `width=${w},height=${h},top=${top},left=${left},menubar=no,toolbar=no,location=no,status=no`
  );
}
