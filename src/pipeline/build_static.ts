import fs from 'fs';
import path from 'path';
import { loadAllTools } from './note_generator.js';
import { generateReadme } from './generate_readme.js';

export function buildStaticSite(): void {
  const rootDir = process.cwd();
  const distDir = path.resolve(rootDir, 'dist');
  const distDataDir = path.resolve(distDir, 'data');

  console.log('[Build] 🏗️ Compilando catálogo estático para GitHub Pages...');

  // 1. Ensure clean dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDataDir, { recursive: true });

  // 2. Load all tools and export static JSON
  const tools = loadAllTools();
  const jsonPath = path.join(distDataDir, 'tools.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ success: true, count: tools.length, tools }, null, 2), 'utf-8');
  console.log(`[Build] 📦 Exportadas ${tools.length} herramientas a ${jsonPath}`);

  // 3. Copy public assets (index.html, bookmarklet)
  const publicDir = path.resolve(rootDir, 'src/web/public');
  if (fs.existsSync(publicDir)) {
    const files = fs.readdirSync(publicDir);
    for (const file of files) {
      fs.copyFileSync(path.join(publicDir, file), path.join(distDir, file));
    }
  }

  // Copy bookmarklet install page as bookmarklet.html
  const bookmarkletInstall = path.resolve(rootDir, 'bookmarklet/install.html');
  if (fs.existsSync(bookmarkletInstall)) {
    fs.copyFileSync(bookmarkletInstall, path.join(distDir, 'bookmarklet.html'));
  }

  // Create .nojekyll for GitHub Pages
  fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf-8');

  // 4. Update README.md
  try {
    const readme = generateReadme();
    fs.writeFileSync(path.resolve(rootDir, 'README.md'), readme, 'utf-8');
    console.log('[Build] 📑 README.md sincronizado.');
  } catch (err) {
    console.warn('[Build] Aviso al actualizar README.md:', err);
  }

  console.log('[Build] ✅ Sitio estático generado con éxito en /dist listo para GitHub Pages!');
}

buildStaticSite();
