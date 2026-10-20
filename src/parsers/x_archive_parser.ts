import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ingestResource } from '../pipeline/ingest.js';
import { generateReadme } from '../pipeline/generate_readme.js';

export interface XItem {
  url?: string;
  urls?: string[];
  rawText?: string;
  sourceTweet?: string;
  author?: string;
}

/**
 * Normalizes content from X archive files (strips window.YTD.* prefix)
 */
function parseYTDJson(filePath: string): any {
  if (!fs.existsSync(filePath)) return null;
  let content = fs.readFileSync(filePath, 'utf-8').trim();
  if (content.startsWith('window.YTD.')) {
    content = content.replace(/^window\.YTD\.[^=]+=\s*/, '');
    content = content.replace(/;\s*$/, '');
  }
  try {
    return JSON.parse(content);
  } catch (e) {
    console.warn(`[Aviso] Error al parsear JSON de ${filePath}:`, e);
    return null;
  }
}

/**
 * Extracts relevant data files from an X archive .zip if necessary
 */
export function extractXArchiveZip(zipPath: string, targetDir = 'data'): string[] {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`El archivo ZIP no existe: ${zipPath}`);
  }
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  console.log(`📦 Descomprimiendo archivos clave desde: ${zipPath}...`);
  try {
    execSync(`unzip -o "${zipPath}" "data/like.js" "data/tweets.js" "data/account-bookmark.js" -d .`, {
      stdio: 'pipe',
    });
  } catch (err: any) {
    // Some zips might not have all 3 files, ignore warnings if at least one extracted
  }

  const extractedFiles: string[] = [];
  ['data/like.js', 'data/account-bookmark.js', 'data/tweets.js'].forEach((f) => {
    if (fs.existsSync(f)) extractedFiles.push(f);
  });

  return extractedFiles;
}

/**
 * Parses X/Twitter data files (like.js, account-bookmark.js, tweets.js, or x_bookmarks.json)
 */
export function parseXBookmarkFile(filePath: string): XItem[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo no existe: ${filePath}`);
  }

  // If user passed a ZIP file directly, extract it
  if (filePath.endsWith('.zip')) {
    const files = extractXArchiveZip(filePath);
    const combinedItems: XItem[] = [];
    for (const file of files) {
      combinedItems.push(...parseXBookmarkFile(file));
    }
    return combinedItems;
  }

  const data = parseYTDJson(filePath);
  if (!data || !Array.isArray(data)) return [];

  const items: XItem[] = [];

  for (const entry of data) {
    // 1. Likes (data/like.js)
    if (entry.like) {
      const tweetId = entry.like.tweetId;
      const expandedUrl = entry.like.expandedUrl || `https://x.com/i/status/${tweetId}`;
      const text = entry.like.fullText || '';

      // Prioritize items that have links or relevant tool mentions
      if (text.includes('http') || text.includes('t.co')) {
        items.push({
          sourceTweet: expandedUrl,
          url: expandedUrl,
          rawText: text,
        });
      }
    }
    // 2. Bookmarks (data/account-bookmark.js)
    else if (entry.bookmark) {
      const tweetId = entry.bookmark.tweetId;
      const expandedUrl = entry.bookmark.expandedUrl || `https://x.com/i/status/${tweetId}`;
      items.push({
        sourceTweet: expandedUrl,
        url: expandedUrl,
        rawText: '',
      });
    }
    // 3. User's own tweets or threads (data/tweets.js)
    else if (entry.tweet) {
      const tweetId = entry.tweet.id_str || entry.tweet.id;
      const expandedUrl = `https://x.com/i/status/${tweetId}`;
      const text = entry.tweet.full_text || entry.tweet.text || '';

      if (text.includes('http') || text.includes('t.co')) {
        items.push({
          sourceTweet: expandedUrl,
          url: expandedUrl,
          rawText: text,
        });
      }
    }
    // 4. Browser extractor format (x_bookmarks.json)
    else if (entry.tweetUrl || entry.text || entry.url) {
      items.push({
        sourceTweet: entry.tweetUrl,
        url: entry.url || (entry.externalUrls && entry.externalUrls[0]) || entry.tweetUrl,
        urls: entry.externalUrls || [],
        rawText: entry.text || '',
        author: entry.author || '',
      });
    }
  }

  return items;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArgIndex = args.indexOf('--limit');
  const limit = limitArgIndex !== -1 ? parseInt(args[limitArgIndex + 1], 10) : undefined;
  
  // Find the file argument (not --limit and not the limit value)
  let targetFile = args.find((a, i) => !a.startsWith('--') && (limitArgIndex === -1 || i !== limitArgIndex + 1));

  // Auto-detect file if none provided
  if (!targetFile) {
    if (fs.existsSync('data/like.js')) {
      targetFile = 'data/like.js';
    } else if (fs.existsSync('x_bookmarks.json')) {
      targetFile = 'x_bookmarks.json';
    } else {
      // Check Descargas
      const home = process.env.HOME || '';
      try {
        const descargasZip = execSync(`ls -t "${home}/Descargas"/twitter-*.zip 2>/dev/null | head -n 1`, {
          encoding: 'utf-8',
        }).trim();
        if (descargasZip && fs.existsSync(descargasZip)) {
          targetFile = descargasZip;
        }
      } catch {}
    }
  }

  if (!targetFile || !fs.existsSync(targetFile)) {
    console.error(`❌ No se encontró ningún archivo de guardados ni .zip de X.`);
    console.log(`\nUso:`);
    console.log(`  npx tsx src/parsers/x_archive_parser.ts [ruta/archivo.zip o data/like.js]\n`);
    return;
  }

  console.log(`\n==================================================`);
  console.log(`📦 Procesando archivo de X: ${targetFile}`);
  console.log(`==================================================\n`);

  try {
    const rawItems = parseXBookmarkFile(targetFile);
    
    // Deduplicate items by sourceTweet
    const seen = new Set<string>();
    const items = rawItems.filter((item) => {
      const key = item.sourceTweet || item.url || item.rawText?.slice(0, 40);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Se identificaron ${items.length} publicaciones con enlaces/herramientas relevantes.`);

    // Optional limit via arg e.g. --limit 10
    const limitArgIndex = args.indexOf('--limit');
    const limit = limitArgIndex !== -1 ? parseInt(args[limitArgIndex + 1], 10) : undefined;
    const itemsToProcess = limit ? items.slice(0, limit) : items;

    if (limit) {
      console.log(`⚙️ Modo prueba: procesando solo los primeros ${limit} elementos.`);
    }

    let count = 0;
    let totalAdded = 0;
    let totalSkipped = 0;

    for (const item of itemsToProcess) {
      count++;
      console.log(`\n[${count}/${itemsToProcess.length}] Procesando recurso...`);
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
      } catch (err: any) {
        console.warn(`[Aviso] No se pudo procesar el item ${count}:`, err?.message || err);
      }

      // Small delay between items to respect Gemini / GitHub rate limits
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    console.log(`\n==================================================`);
    console.log(`🎉 Ingesta completada con éxito!`);
    console.log(`✅ Nuevas herramientas catalogadas y etiquetadas: ${totalAdded}`);
    console.log(`⏭️ Omitidas por ya existir en tu colección: ${totalSkipped}`);
    console.log(`==================================================\n`);

    try {
      const readme = generateReadme();
      fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), readme, 'utf-8');
      console.log('📑 README.md actualizado automáticamente con los nuevos recursos y categorías.');
    } catch (e) {
      console.warn('No se pudo actualizar el README.md:', e);
    }
  } catch (error: any) {
    console.error('❌ Error al procesar el archivo:', error?.message || error);
  }
}

if (process.argv[1] && process.argv[1].endsWith('x_archive_parser.ts')) {
  main();
}
