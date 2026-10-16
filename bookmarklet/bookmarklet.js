/**
 * BOOKMARKLET 1-CLIC: GUARDAR EN TOOLKIT
 * -------------------------------------------------------------
 * Código JavaScript comprimido en URI para arrastrar a los marcadores de tu navegador.
 */

// Código legible:
function sendTweetToToolkit() {
  const currentUrl = window.location.href;
  const isTwitter = currentUrl.includes('x.com') || currentUrl.includes('twitter.com');

  if (!isTwitter) {
    alert('Este bookmarklet está diseñado para usarse mientras navegas en x.com / Twitter.');
    return;
  }

  // Encontrar el tweet enfocado o el primero visible
  const article = document.querySelector('article[data-testid="tweet"]');
  let tweetText = '';
  let author = '';
  let links = [];

  if (article) {
    const textEl = article.querySelector('div[data-testid="tweetText"]');
    tweetText = textEl ? textEl.innerText : '';
    const userEl = article.querySelector('div[data-testid="User-Name"]');
    author = userEl ? userEl.innerText.split('\n')[0] : '';
    links = Array.from(article.querySelectorAll('a'))
      .map((a) => a.href)
      .filter((h) => h && !h.includes('x.com') && !h.includes('twitter.com') && !h.startsWith('javascript:'));
  }

  // Notificación flotante tipo Toast en X
  const toast = document.createElement('div');
  toast.style.cssText =
    'position:fixed;bottom:24px;right:24px;z-index:999999;background:#1e293b;color:#f8fafc;padding:12px 20px;border-radius:12px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);border:1px solid #334155;transition:all 0.3s;';
  toast.innerText = '⚡ Enviando a Dev Toolkit...';
  document.body.appendChild(toast);

  fetch('http://localhost:4000/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceTweet: currentUrl,
      rawText: tweetText,
      author: author,
      url: links[0] || undefined,
    }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        toast.style.background = '#065f46';
        toast.innerText = `✅ ¡Guardado! ${data.data?.classification?.name || 'Recurso añadido'}`;
      } else {
        toast.style.background = '#991b1b';
        toast.innerText = `❌ Error: ${data.error || 'Ocurrió un problema'}`;
      }
      setTimeout(() => toast.remove(), 4000);
    })
    .catch(() => {
      toast.style.background = '#991b1b';
      toast.innerText = '❌ Error de conexión: ¿Tienes corriendo "npm run dev"?';
      setTimeout(() => toast.remove(), 4500);
    });
}
