import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { ToolConjunto, ToolFrontmatter } from './types.js';

export function classifyToolConjunto(data: ToolFrontmatter, content: string, dirName: string): { conjunto: ToolConjunto; category?: string } {
  const tags = (data.tags || []).map((x) => String(x).toLowerCase().trim());
  const name = String(data.name || '').toLowerCase();
  const summary = (content.match(/^>\s*(.+)$/m)?.[1] || '').toLowerCase();
  const cat = String(data.category || '').trim();
  const entryType = data.entry_type || '';

  // 1. Corregir categorías 'Other' o ausentes si es posible
  let fixedCategory = cat;
  if (!cat || cat === 'Other') {
    if (name.includes('blender')) fixedCategory = 'Prompts, Art & Video';
    else if (name.includes('claude code') || name.includes('mcp')) fixedCategory = 'Agentes & Protocolo MCP';
    else if (name.includes('polyhaven')) fixedCategory = 'Prompts, Art & Video';
    else if (name.includes('yoinks')) fixedCategory = 'CLI & Terminal';
    else fixedCategory = 'Productivity & Tools';
  }

  // 2. CONSEJOS (Guías, tutoriales, cursos, colecciones de prompts, trucos, buenas prácticas, cheatsheets)
  const isConsejo =
    dirName === 'tips' ||
    entryType === 'tech_tip' ||
    fixedCategory.toLowerCase().includes('consejos') ||
    tags.includes('tips') ||
    tags.includes('consejos') ||
    tags.includes('buenas-practicas') ||
    tags.includes('trucos') ||
    tags.includes('prompt-engineering') ||
    tags.includes('cheatsheet') ||
    tags.includes('cheat-sheet') ||
    tags.includes('tutorial') ||
    tags.includes('curso') ||
    name.includes('curso') ||
    name.includes('guía') ||
    name.includes('guia') ||
    name.includes('prompts para') ||
    name.includes('prompts de') ||
    summary.includes('curso sobre') ||
    summary.includes('curso avanzado') ||
    summary.includes('guía completa') ||
    summary.includes('guia completa') ||
    summary.includes('guía interactiva') ||
    summary.includes('guia interactiva') ||
    summary.includes('guía de prompts') ||
    summary.includes('guia de prompts') ||
    summary.includes('colección de prompts') ||
    summary.includes('coleccion de prompts') ||
    summary.includes('currículo gratuito') ||
    summary.includes('lecciones para aprender') ||
    summary.includes('aprender a construir') ||
    summary.includes('aprender cómo funcionan') ||
    summary.includes('aprender como funcionan') ||
    summary.includes('buenas prácticas para') ||
    summary.includes('recopilación de los system prompts') ||
    summary.includes('biblioteca con miles de prompts listos') ||
    summary.includes('consejos de ingeniería') ||
    name.includes('build-your-own-x') ||
    name.includes('system-design-primer') ||
    name.includes('the-art-of-command-line') ||
    name.includes('python-100-days');

  if (isConsejo) {
    return { conjunto: 'consejos', category: fixedCategory !== cat ? fixedCategory : undefined };
  }

  // 3. INSPIRACION (Galerías de diseño, showcases, capturas de UI/UX, portfolios curados, referencias visuales, tendencias)
  const isInspiracion =
    tags.includes('inspiracion') ||
    tags.includes('inspiration') ||
    tags.includes('galeria') ||
    tags.includes('gallery') ||
    tags.includes('showcase') ||
    tags.includes('showcases') ||
    tags.includes('app-screens') ||
    tags.includes('referencia') ||
    tags.includes('referencias') ||
    tags.includes('ui-inspiration') ||
    tags.includes('design-inspiration') ||
    tags.includes('landing-page') ||
    tags.includes('portfolios') ||
    tags.includes('curated') ||
    summary.includes('galería curada') ||
    summary.includes('galeria curada') ||
    summary.includes('galería de') ||
    summary.includes('galeria de') ||
    summary.includes('galería con') ||
    summary.includes('galeria con') ||
    summary.includes('galería interactiva') ||
    summary.includes('colección de diseños') ||
    summary.includes('coleccion de disenos') ||
    summary.includes('colección de publicaciones') ||
    summary.includes('colección de sitios') ||
    summary.includes('directorio de sitios') ||
    summary.includes('directorio de diseño') ||
    summary.includes('repositorio de pies de página') ||
    summary.includes('biblioteca de capturas de pantalla') ||
    summary.includes('para inspirar rediseños') ||
    summary.includes('para inspirar') ||
    summary.includes('para inspiración') ||
    summary.includes('referencia de ux') ||
    summary.includes('referencia de producto') ||
    summary.includes('referencias visuales') ||
    summary.includes('directorio de manuales de marca') ||
    summary.includes('detectar tendencias de layout') ||
    name.includes('designforb2b') ||
    name.includes('mobbin') ||
    name.includes('posts design') ||
    name.includes('recent') ||
    name.includes('footer') ||
    name.includes('awwwards') ||
    name.includes('godly') ||
    name.includes('calltoinspiration');

  if (isInspiracion) {
    return { conjunto: 'inspiracion', category: fixedCategory !== cat ? fixedCategory : undefined };
  }

  // 4. PRODUCTO (SaaS, software comercial, apps web/desktop, plataformas de servicios, hardware/gadgets)
  const isHardware =
    dirName === 'products' ||
    entryType === 'tech_product' ||
    fixedCategory.toLowerCase().includes('productos tecnológicos') ||
    fixedCategory.toLowerCase().includes('empresas & productos') ||
    tags.includes('hardware') ||
    tags.includes('gadgets') ||
    tags.includes('dispositivo') ||
    tags.includes('device') ||
    summary.includes('dispositivo') ||
    summary.includes('placa de desarrollo') ||
    summary.includes('microcontrolador');

  const isSaaSOrSoftwareProduct =
    entryType === 'product_showcase' ||
    tags.includes('saas') ||
    tags.includes('desktop-app') ||
    tags.includes('electron') ||
    tags.includes('tauri') ||
    summary.includes('plataforma saas') ||
    summary.includes('servicio comercial') ||
    summary.includes('servicio de pago') ||
    summary.includes('servicio web que') ||
    summary.includes('aplicación web que') ||
    summary.includes('aplicación de escritorio') ||
    summary.includes('grabador de pantalla') ||
    summary.includes('visor de logs en tiempo real') ||
    summary.includes('editor de video open source') ||
    summary.includes('editor online de') ||
    summary.includes('editor online gratuito') ||
    summary.includes('gestor de marcadores multiplataforma') ||
    summary.includes('generador instantáneo de') ||
    summary.includes('servicio para saltar paywalls') ||
    summary.includes('lector de paywalls') ||
    summary.includes('generador de animaciones con inteligencia artificial') ||
    summary.includes('gateway unificado que expone cientos de modelos') ||
    summary.includes('api de envío de sms') ||
    summary.includes('herramienta de \'vibecoding\'') ||
    summary.includes('generador que convierte un único prompt en un sitio web') ||
    summary.includes('guía de streaming que indica') ||
    name.includes('10 minute mail') ||
    name.includes('12ft') ||
    name.includes('sent') ||
    name.includes('openrouter') ||
    name.includes('modulify') ||
    name.includes('motionin') ||
    name.includes('cobalt') ||
    name.includes('notchlive') ||
    name.includes('orca') ||
    name.includes('raindrop') ||
    name.includes('ship studio') ||
    name.includes('svgator') ||
    name.includes('storyset') ||
    name.includes('cap') ||
    name.includes('recordly') ||
    name.includes('opencut') ||
    name.includes('fincept terminal') ||
    name.includes('autoclip') ||
    name.includes('autosubs') ||
    name.includes('justwatch') ||
    name.includes('paper animation') ||
    name.includes('blender') ||
    name.includes('clipdrop') ||
    name.includes('elevenlabs');

  if (isHardware || isSaaSOrSoftwareProduct) {
    return { conjunto: 'producto', category: fixedCategory !== cat ? fixedCategory : undefined };
  }

  // 5. RECURSOS (Librerías, componentes, paquetes, UI kits, repositorios de código, plantillas, utilidades CLI, bolsas de empleo)
  return { conjunto: 'recursos', category: fixedCategory !== cat ? fixedCategory : undefined };
}

export function runClassificationMigration(): void {
  const rootDir = process.cwd();
  const dirs = [
    { name: 'tools', path: path.resolve(rootDir, 'content/tools') },
    { name: 'tips', path: path.resolve(rootDir, 'content/tips') },
    { name: 'jobs', path: path.resolve(rootDir, 'content/jobs') },
  ];

  let totalUpdated = 0;
  const stats = { recursos: 0, inspiracion: 0, producto: 0, consejos: 0 };
  let fixedCategoriesCount = 0;

  for (const dirObj of dirs) {
    if (!fs.existsSync(dirObj.path)) continue;
    const files = fs.readdirSync(dirObj.path).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(dirObj.path, file);
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(fileContent);

      const data = parsed.data as ToolFrontmatter;
      const res = classifyToolConjunto(data, parsed.content, dirObj.name);

      data.conjunto = res.conjunto;
      if (res.category) {
        data.category = res.category;
        fixedCategoriesCount++;
      }

      stats[res.conjunto]++;

      const newContent = matter.stringify(parsed.content, data);
      fs.writeFileSync(filePath, newContent, 'utf-8');
      totalUpdated++;
    }
  }

  console.log(`[Classify] ✅ ${totalUpdated} herramientas clasificadas con éxito:`);
  console.log(`  📦 Recursos: ${stats.recursos}`);
  console.log(`  💡 Inspiración: ${stats.inspiracion}`);
  console.log(`  🚀 Producto: ${stats.producto}`);
  console.log(`  🧠 Consejos: ${stats.consejos}`);
  console.log(`  🏷️ Categorías 'Other' reclasificadas: ${fixedCategoriesCount}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runClassificationMigration();
}
