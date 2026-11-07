import fs from 'fs';
import path from 'path';
import { restoreToolNotes, loadAllTools } from './note_generator.js';
import { generateReadme } from './generate_readme.js';

/**
 * Importa fichas desde un archivo JSON (exportado del navegador o localStorage)
 * y las escribe como archivos Markdown (.md) en las carpetas de content/
 * para que queden guardadas en el repositorio Git.
 *
 * Uso:
 *   npm run import:backup [ruta/al/archivo.json]
 */
async function main() {
  const fileArg = process.argv[2];
  let targetPath = '';

  if (fileArg) {
    targetPath = path.resolve(process.cwd(), fileArg);
  } else {
    // Buscar archivos JSON típicos en la raíz
    const candidates = ['toolkit-backup.json', 'backup.json'];
    const found = candidates.find((c) => fs.existsSync(path.resolve(process.cwd(), c)));
    if (found) {
      targetPath = path.resolve(process.cwd(), found);
    } else {
      // Buscar cualquier archivo que empiece con toolkit-backup
      const files = fs.readdirSync(process.cwd());
      const match = files.find((f) => f.startsWith('toolkit-backup') && f.endsWith('.json'));
      if (match) {
        targetPath = path.resolve(process.cwd(), match);
      }
    }
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    console.error('❌ Error: Archivo de respaldo no encontrado.');
    console.log('\nUso:');
    console.log('  npm run import:backup -- ruta/al/toolkit-backup.json\n');
    console.log('O coloca el archivo descargado como "toolkit-backup.json" en la carpeta del proyecto.');
    process.exit(1);
  }

  console.log(`[Import] 📦 Leyendo archivo: ${targetPath}`);
  const rawText = fs.readFileSync(targetPath, 'utf-8');
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch (err: any) {
    console.error(`❌ Error parseando JSON: ${err.message}`);
    process.exit(1);
  }

  let items: any[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && Array.isArray(data.tools)) {
    items = data.tools;
  } else if (data && typeof data === 'object') {
    // Si es un objeto tipo mapa { slug: tool }
    items = Object.values(data);
  }

  if (items.length === 0) {
    console.warn('⚠️ No se encontraron herramientas en el archivo JSON.');
    process.exit(0);
  }

  console.log(`[Import] Procesando ${items.length} herramienta(s)...`);
  const beforeCount = loadAllTools().length;

  const { restoredCount, updatedCount } = restoreToolNotes(items);

  // Actualizar README.md
  try {
    const readme = generateReadme();
    fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), readme, 'utf-8');
    console.log('[Import] 📑 README.md actualizado con las nuevas herramientas.');
  } catch (readmeErr: any) {
    console.warn('[Import] Aviso actualizando README:', readmeErr.message);
  }

  const afterCount = loadAllTools().length;
  console.log(`\n🎉 ¡Importación completada con éxito!`);
  console.log(`   - Nuevas fichas creadas: ${restoredCount}`);
  console.log(`   - Fichas actualizadas: ${updatedCount}`);
  console.log(`   - Total en tu catálogo local: ${beforeCount} ➔ ${afterCount}`);
  console.log(`\n📌 Siguientes pasos para guardar todo permanentemente en GitHub:`);
  console.log(`   git add content/ README.md`);
  console.log(`   git commit -m "chore(catalog): guardar ${restoredCount} herramientas recuperadas"`);
  console.log(`   git push origin main`);
  console.log(`   npm run deploy  # (Para actualizar tu GitHub Pages)\n`);
}

main().catch((e) => {
  console.error('[Import] Error inesperado:', e);
  process.exit(1);
});
