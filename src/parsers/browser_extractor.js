/**
 * SCRIPT PARA LA CONSOLA DEL NAVEGADOR (Opción Inmediata para extraer Bookmarks de X)
 * ------------------------------------------------------------------------------------
 * Si no quieres esperar 24-48 horas a que Twitter envíe el correo con tu archivo .zip,
 * puedes usar este script para extraer todos tus guardados en 1 minuto:
 *
 * INSTRUCCIONES:
 * 1. Abre https://x.com/i/bookmarks en Google Chrome, Brave, Firefox o Edge.
 * 2. Abre las herramientas de desarrollador (F12 o Ctrl+Shift+I / Cmd+Option+I).
 * 3. Ve a la pestaña 'Console' (Consola).
 * 4. Pega todo el código de este archivo y presiona Enter.
 * 5. Verás en pantalla el progreso del scroll. Al terminar (o al presionar 'Detener'),
 *    se descargará automáticamente un archivo 'x_bookmarks.json'.
 * 6. Mueve ese archivo a este repositorio y ejecuta:
 *    npm run parse:archive x_bookmarks.json
 */

(async function extractXBookmarks() {
  console.log('%c🚀 Iniciando extractor de guardados de X...', 'color: #00ba7c; font-weight: bold; font-size: 14px;');

  const bookmarks = new Map();
  let noNewTweetsCount = 0;
  const maxScrollAttempts = 60; // Ajusta según la cantidad de guardados
  let previousHeight = 0;

  for (let i = 0; i < maxScrollAttempts; i++) {
    // Buscar todos los artículos de tweets en la vista actual
    const articles = document.querySelectorAll('article[data-testid="tweet"]');

    articles.forEach((article) => {
      try {
        // Enlace al tweet
        const timeLink = article.querySelector('time')?.closest('a');
        const tweetUrl = timeLink ? timeLink.href : null;

        if (!tweetUrl || bookmarks.has(tweetUrl)) return;

        // Texto del tweet
        const textElement = article.querySelector('div[data-testid="tweetText"]');
        const text = textElement ? textElement.innerText : '';

        // Autor
        const userElement = article.querySelector('div[data-testid="User-Name"]');
        const author = userElement ? userElement.innerText.split('\n')[0] : '';

        // Enlaces externos dentro del tweet
        const links = Array.from(article.querySelectorAll('a'))
          .map((a) => a.href)
          .filter((href) => {
            return (
              href &&
              !href.includes('x.com') &&
              !href.includes('twitter.com') &&
              !href.startsWith('javascript:')
            );
          });

        bookmarks.set(tweetUrl, {
          tweetUrl,
          author,
          text,
          externalUrls: Array.from(new Set(links)),
        });
      } catch (err) {
        console.warn('Error extrayendo tweet individual:', err);
      }
    });

    console.log(`[Progreso] Guardados detectados hasta ahora: ${bookmarks.size}`);

    // Scroll hacia abajo
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1500));

    // Verificar si ya no hay más contenido
    const currentHeight = document.body.scrollHeight;
    if (currentHeight === previousHeight) {
      noNewTweetsCount++;
      if (noNewTweetsCount >= 3) {
        console.log('Se alcanzó el final de la lista de guardados.');
        break;
      }
    } else {
      noNewTweetsCount = 0;
      previousHeight = currentHeight;
    }
  }

  const results = Array.from(bookmarks.values());
  console.log(`%c✅ Extracción completada: ${results.length} guardados recopilados.`, 'color: #00ba7c; font-weight: bold;');

  // Descargar archivo JSON
  const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = 'x_bookmarks.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);

  console.log('%c📁 Archivo x_bookmarks.json descargado en tu carpeta de descargas.', 'color: #1d9bf0;');
})();
