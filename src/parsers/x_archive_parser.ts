import fs from 'fs';
import path from 'path';
import { ingestResource } from '../pipeline/ingest.js';
import { generateReadme } from '../pipeline/generate_readme.js';

/**
 * Parser for X/Twitter data export (account-bookmark.js or custom bookmarks.json).
 * Usage:
 *   npx tsx src/parsers/x_archive_parser.ts [ruta-al-archivo]
 */

export function parseXBookmarkFile(filePath: string): Array<{
  url?: string;
  urls?: string[];
  rawText?: string;
  sourceTweet?: string;
  author?: string;
}> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo no existe: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf-8').trim();

  // Strip window.YTD.account_bookmark.part0 = prefix if present in standard X archive
  if (content.startsWith('window.YTD.')) {
    content = content.replace(/^window\.YTD\.[^=]+=\s*/, '');
    content = content.replace(/;\s*$/, '');
  }

  const data = JSON.parse(content);

  const items: Array<{
    url?: string;
    urls?: string[];
    rawText?: string;
    sourceTweet?: string;
    author?: string;
  }> = [];

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
          urls: entry.externalUrls || [],
          rawText: entry.text || '',
          author: entry.author || '',
        });
      }
    }
  }

  return items;
}

async function main() {
  const args = process.argv.slice(2);
  const targetFile = args[0] || 'x_bookmarks.json';

  console.log(`\n==================================================`);
  console.log(`📦 Procesando archivo de guardados de X: ${targetFile}`);
  console.log(`==================================================\n`);

  try {
    const items = parseXBookmarkFile(targetFile);
    console.log(`Se encontraron ${items.length} guardados en el archivo.`);

    let count = 0;
    let totalAdded = 0;
    let totalSkipped = 0;

    for (const item of items) {
      count++;
      console.log(`\n[${count}/${items.length}] Procesando guardado...`);
      try {
        const res = await ingestResource({
          url: item.url,
          urls: item.urls,
          rawText: item.rawText,
          sourceTweet: item.sourceTweet,
          author: item.author,
        });

        totalAdded += res.addedCount ?? (res.alreadyExisted ? 0 : 1);
        totalSkipped += res.skippedCount ?? (res.alreadyExisted ? 1 : 0);
      } catch (err) {
        console.warn(`[Aviso] No se pudo procesar el item ${count}:`, err);
      }

      // Small delay between items to respect Gemini / GitHub rate limits
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    console.log(`\n==================================================`);
    console.log(`🎉 Ingesta masiva completada!`);
    console.log(`✅ Nuevas herramientas guardadas: ${totalAdded}`);
    console.log(`⏭️ Omitidas por duplicado: ${totalSkipped}`);
    console.log(`==================================================\n`);

    try {
      const readme = generateReadme();
      fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), readme, 'utf-8');
      console.log('📑 README.md actualizado automáticamente con los nuevos recursos.');
    } catch (e) {
      console.warn('No se pudo actualizar el README.md:', e);
    }
  } catch (error) {
    console.error('❌ Error al procesar el archivo de guardados:', error);
    console.log(`
Instrucciones:
1. Coloca tu archivo 'x_bookmarks.json' o 'account-bookmark.js' en la raíz del proyecto.
2. Ejecuta: npm run parse:archive nombre_del_archivo.json
`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('x_archive_parser.ts')) {
  main();
}
