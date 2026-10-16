import fs from 'fs';
import path from 'path';
import { ingestResource } from '../pipeline/ingest.js';

/**
 * Parser for X/Twitter data export (account-bookmark.js or custom bookmarks.json).
 * Usage:
 *   npx tsx src/parsers/x_archive_parser.ts [ruta-al-archivo]
 */

export function parseXBookmarkFile(filePath: string): Array<{
  url?: string;
  rawText?: string;
  sourceTweet?: string;
}> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo no existe: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf-8').trim();

  // Strip window.YTD.account_bookmark.part0 = prefix if present in standard X archive
  if (content.startsWith('window.YTD.')) {
    content = content.replace(/^window\.YTD\.[^=]+=\s*/, '');
    // Also remove trailing semicolon if present
    content = content.replace(/;\s*$/, '');
  }

  const data = JSON.parse(content);

  const items: Array<{ url?: string; rawText?: string; sourceTweet?: string }> = [];

  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry.bookmark) {
        // Standard X archive structure
        const tweetId = entry.bookmark.tweetId;
        const expandedUrl = entry.bookmark.expandedUrl || `https://x.com/i/status/${tweetId}`;
        items.push({
          sourceTweet: expandedUrl,
          url: expandedUrl,
          rawText: '',
        });
      } else if (entry.tweetUrl || entry.text || entry.url) {
        // Format from our browser console script
        items.push({
          sourceTweet: entry.tweetUrl,
          url: entry.url || (entry.externalUrls && entry.externalUrls[0]) || entry.tweetUrl,
          rawText: entry.text || '',
        });
      }
    }
  }

  return items;
}

async function main() {
  const args = process.argv.slice(2);
  const targetFile = args[0] || 'data/account-bookmark.js';

  console.log(`\n==================================================`);
  console.log(`📦 Procesando archivo de guardados de X: ${targetFile}`);
  console.log(`==================================================\n`);

  try {
    const items = parseXBookmarkFile(targetFile);
    console.log(`Se encontraron ${items.length} guardados en el archivo.`);

    let count = 0;
    for (const item of items) {
      count++;
      console.log(`\n[${count}/${items.length}] Procesando guardado...`);
      try {
        await ingestResource({
          url: item.url,
          rawText: item.rawText,
          sourceTweet: item.sourceTweet,
        });
      } catch (err) {
        console.warn(`[Aviso] No se pudo procesar el item ${count}:`, err);
      }

      // Small delay between items to respect Gemini / GitHub rate limits
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    console.log(`\n🎉 Ingesta masiva completada! ${count} elementos procesados.`);
  } catch (error) {
    console.error('❌ Error al procesar el archivo de guardados:', error);
    console.log(`
Instrucciones:
1. Copia tu archivo 'account-bookmark.js' (de tu descarga de X) en la carpeta del proyecto.
2. Ejecuta: npm run parse:archive nombre_del_archivo.js
`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('x_archive_parser.ts')) {
  main();
}
