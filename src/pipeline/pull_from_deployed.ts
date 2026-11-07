import fs from 'fs';
import path from 'path';
import { restoreToolNotes, loadAllTools } from './note_generator.js';
import { generateReadme } from './generate_readme.js';

/**
 * Descarga todas las fichas guardadas en la web desplegada (Render) y las escribe
 * como archivos .md en el repositorio local (content/...), para poder hacer commit.
 *
 * Uso:
 *   npm run pull:deployed -- https://TU-APP.onrender.com
 */
async function main() {
  const base = (process.argv[2] || process.env.DEPLOYED_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    console.error('Uso: npm run pull:deployed -- https://TU-APP.onrender.com');
    process.exit(1);
  }

  console.log(`[Pull] Descargando fichas desde ${base}/api/tools ...`);
  // Render Free puede tardar ~1 min en despertar
  const res = await fetch(`${base}/api/tools`, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    console.error(`[Pull] Error HTTP ${res.status} al consultar la web desplegada.`);
    process.exit(1);
  }

  const data = (await res.json()) as { tools?: any[]; count?: number };
  const remoteTools = Array.isArray(data.tools) ? data.tools : [];
  console.log(`[Pull] La web desplegada tiene ${remoteTools.length} ficha(s).`);

  const before = loadAllTools().length;
  const { restoredCount, updatedCount } = restoreToolNotes(remoteTools);
  const after = loadAllTools().length;

  fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), generateReadme(), 'utf-8');

  console.log(`[Pull] ✅ Nuevas: ${restoredCount} · Actualizadas: ${updatedCount} · Local antes: ${before} → ahora: ${after}`);
  console.log('[Pull] Siguiente paso: git add content README.md && git commit -m "chore: importar fichas" && git push');
}

main().catch((err) => {
  console.error('[Pull] Falló:', err?.message || err);
  process.exit(1);
});
