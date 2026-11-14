import fs from 'fs';
import path from 'path';
import { isBlankishString, loadAllTools } from './note_generator.js';
import { ToolItem } from './types.js';
import { getAllCategories } from './category_manager.js';
import { loadTaxonomy } from './taxonomy.js';

function shown(value?: string): string {
  if (!value || isBlankishString(value)) return '';
  return value;
}

function getCategoryIcon(catName: string): string {
  const found = getAllCategories().find((c) => c.name.toLowerCase() === catName.toLowerCase());
  return found?.icon || '📦';
}

function renderItemRow(item: ToolItem): string {
  const starsBadge = item.frontmatter.stars
    ? ` ⭐ **${item.frontmatter.stars.toLocaleString()}**`
    : '';
  const tags = item.frontmatter.tags?.length
    ? ` ${item.frontmatter.tags.map((t: string) => `\`#${t}\``).join(' ')}`
    : '';
  const statusBadge =
    item.frontmatter.status === 'in_use'
      ? ' `🟢 En uso`'
      : item.frontmatter.status === 'archived'
      ? ' `⚪ Archivado`'
      : ' `🟡 Por probar`';

  // Extract one-liner blockquote
  const quoteMatch = item.content.match(/^>\s*(.+)$/m);
  const summary = quoteMatch ? quoteMatch[1] : 'Sin descripción adicional.';

  const company = shown(item.frontmatter.company);
  const author = shown(item.frontmatter.author);
  const companyBadge = company ? ` (\`🏢 ${company}\`)` : '';
  const authorBadge = author && !company
    ? ` (\`👤 ${author}\`)`
    : '';
  const websiteBadge = item.frontmatter.website_url
    ? ` [🌐 Web](${item.frontmatter.website_url})`
    : '';
  const tweetBadge = item.frontmatter.source_tweet
    ? ` [𝕏 Tweet](${item.frontmatter.source_tweet})`
    : '';
  const location = shown(item.frontmatter.location);
  const salary = shown(item.frontmatter.salary);
  const price = shown(item.frontmatter.price);
  const locationBadge = location ? ` (\`🌍 ${location}\`)` : '';
  const salaryBadge = salary ? ` (\`💰 ${salary}\`)` : '';
  const priceBadge = price ? ` (\`💰 ${price}\`)` : '';
  const isAcademic = Boolean(
    item.frontmatter.has_academic_promo ||
    (item.frontmatter.tags && item.frontmatter.tags.some((t: string) => ['academic', 'academico', 'académico', 'estudiante', 'estudiantes', 'student', 'students', 'education', 'educacion', 'educación'].includes(t.toLowerCase())))
  );
  const academicBadge = isAcademic ? ' `🎓 Promo Académica`' : '';
  const notePath = path.relative(process.cwd(), item.filePath).split(path.sep).join('/');

  const conjuntoIcons: Record<string, string> = {
    codigo: '📦 Código',
    app: '🚀 App',
    inspiracion: '💡 Inspiración',
    aprender: '📚 Aprender',
    consejos: '🧠 Consejos',
  };
  const conjuntoBadge = item.frontmatter.conjunto
    ? ` \`${conjuntoIcons[item.frontmatter.conjunto] || item.frontmatter.conjunto}\``
    : '';

  let row = `- **[${item.frontmatter.name}](${item.frontmatter.url})**${conjuntoBadge}${companyBadge}${authorBadge}${locationBadge}${salaryBadge}${priceBadge}${starsBadge}${websiteBadge}${tweetBadge}${academicBadge}${statusBadge}  \n`;
  row += `  ${summary} [📝 Ver ficha](${notePath})${tags}\n\n`;
  return row;
}

export function generateReadme(): string {
  const allTools = loadAllTools();
  const taxonomy = loadTaxonomy();
  const areaIcons: Record<string, string> = {
    'desarrollo-software': '🛠️',
    'inteligencia-artificial': '🤖',
    'diseno-creatividad': '🎨',
    'productividad-utilidades': '⚡',
    aprendizaje: '📚',
    'trabajo-oportunidades': '💼',
  };

  let body = '';
  const tocLines: string[] = [];
  const badges: string[] = [];

  for (const area of taxonomy.areas) {
    const icon = areaIcons[area.id] || '📁';
    const items = allTools.filter((tool) => (tool.frontmatter.area || '') === area.id);
    const anchor = `${icon}-${area.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    tocLines.push(`- [${icon} ${area.name}](#${anchor}-${items.length}) (${items.length})`);
    badges.push(`[![${area.name}](https://img.shields.io/badge/${encodeURIComponent(icon + ' ' + area.name)}-${items.length}-444?style=for-the-badge)]()`);
    body += `## ${icon} ${area.name} (${items.length})\n\n`;
    body += `> ${area.definition}\n\n`;
    const names = taxonomy.categories.filter((category) => category.area === area.id).map((category) => category.name);
    if (items.length === 0) {
      body += `*Sin fichas en esta área.*\n\n`;
      continue;
    }
    for (const cat of names) {
      const group = items.filter((tool) => tool.frontmatter.category === cat);
      if (group.length === 0) continue;
      body += `### ${getCategoryIcon(cat)} ${cat} (${group.length})\n\n`;
      for (const item of group) body += renderItemRow(item);
    }
  }

  const toc = `## 📑 Las 6 áreas\n\n${tocLines.join('\n')}\n`;

  return `# 🚀 Awesome Dev Toolkit & Segundo Cerebro

> Colección curada en **6 áreas** y **5 conjuntos** (\`codigo\`, \`app\`, \`inspiracion\`, \`aprender\`, \`consejos\`), compartida con el segundo cerebro. La fuente de las categorías es \`data/taxonomy.json\`.

${badges.join('\n')}
[![Obsidian Ready](https://img.shields.io/badge/Obsidian-Segundo_Cerebro-7C3AED?style=for-the-badge&logo=obsidian)]()

---

${toc}
---

${body}

---

## 🛠️ Cómo Usar Este Proyecto

### 1. Iniciar el Dashboard Web y Servidor de Ingesta
\`\`\`bash
npm run dev
\`\`\`
Abre \`http://localhost:4000\` en tu navegador para ver el catálogo con buscador instantáneo (\`Cmd+K\`), selector de apartados, conjuntos y notas personales.

### 2. Añadir un recurso rápidamente desde la terminal
\`\`\`bash
npm run add "https://github.com/astral-sh/uv"
\`\`\`

### 3. Usar como Segundo Cerebro en Obsidian
Abre las carpetas directamente como un **Vault en Obsidian**:
- \`content/tools/\`: Herramientas, bibliotecas, apps y hardware.
- \`content/tips/\`: Consejos técnicos y trucos.
- \`content/jobs/\`: Oportunidades de trabajo remoto y freelance.

### 4. Guardado en 1-Clic desde X (Bookmarklet)
Arrastra el enlace desde la carpeta \`bookmarklet/\` a tu barra de favoritos de Chrome/Brave/Firefox. Al ver un tweet interesante en X, haz clic en el botón y se enviará directo a tu toolkit local.

### 5. Exportar al segundo cerebro (vault de Obsidian)
El vault consume un JSON por día en \`inbox/x-bookmarks/YYYY-MM-DD.json\`: un arreglo de bookmarks. Cada bookmark agrupa las fichas que salieron del mismo tweet.

\`\`\`bash
# Todo lo nuevo o editado desde una fecha (inclusive)
npm run export:vault -- --since 2026-11-01 --out inbox-x-bookmarks.json
\`\`\`

También está el endpoint del servidor (local o el de Render):

\`\`\`bash
curl "http://localhost:4000/api/export/vault?since=2026-11-01" -o inbox-x-bookmarks.json
\`\`\`

Copia ese archivo a \`inbox/x-bookmarks/\` del vault. El campo \`text\` es el resumen que quedó guardado en la ficha (el texto crudo del tweet no se almacena aparte). \`items[].summary\` va en español. \`note_tweet\` trae las notas personales si las hay y, si no, \`null\`.

### 6. Importar un lote del vault
Operación inversa: un JSON ya clasificado (el mismo arreglo de bookmarks) vuelve a \`content/\` sin llamar a la IA ni scrapear. Una categoría de la taxonomía se copia tal cual. Un nombre legacy se traduce con su alias. Si no hay alias, la ficha queda en la bandeja de revisión y no se le inventa categoría. Si la URL ya existe y el nombre es otro producto, no se escribe.

\`\`\`bash
npm run import:vault -- inbox-x-bookmarks.json
npm run import:vault -- inbox-x-bookmarks.json --dry-run
\`\`\`

La salida es:

\`\`\`text
[Import vault] escritura inbox-x-bookmarks.json
created: 0
updated: 0
skipped: 0
needs-review: 0
\`\`\`

En simulación el prefijo es \`[Import vault] simulación\`. Repetir el mismo archivo no crea fichas: lo ya importado sale en \`skipped\`. Un tweet nuevo de un producto que ya estaba se anexa (\`updated\`).

### 7. Servidor, salud y acceso de escritura
\`GET /health\` responde \`{ "ok": true }\` para el health check de Render. El catálogo se lee de memoria y se invalida al guardar o al traer \`content/\` desde GitHub.

Si \`ADMIN_TOKEN\` está vacío, los \`POST\`, \`PATCH\` y \`DELETE\` siguen abiertos. Si lo defines, esas rutas exigen la cabecera \`x-admin-token\` (o \`Authorization: Bearer\`). Las páginas que sirve el propio servidor —catálogo, \`/quick-save\` y \`/bookmarklet\`— inyectan ese token en \`fetch\`, así que el bookmarklet no hay que reinstalarlo. \`GET\` del catálogo sigue siendo público. CORS solo refleja el mismo host y los orígenes de \`CORS_ORIGINS\`.

\`/api/ingest\`, \`/api/authors/analyze\` y \`/api/tools/:slug/thread\` tienen un límite por IP (\`AI_RATE_LIMIT_MAX\`, por defecto 30 cada 10 minutos).

La sincronización con GitHub va en una cola: reintenta 409, 422 y rate limit, no borra un cambio local si el push falla, y al apagarse intenta vaciar la cola. Al arrancar, y cada \`GITHUB_PULL_INTERVAL_MS\` (5 minutos), trae commits nuevos de \`content/\` sin reiniciar. Un webhook \`POST /api/github/webhook\` (secreto \`GITHUB_WEBHOOK_SECRET\`, evento push) hace lo mismo. Los archivos locales aún no subidos no se pisan.
`;
}

function isDirectRun(): boolean {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry.endsWith(`${path.sep}generate_readme.ts`) || entry.endsWith(`${path.sep}generate_readme.js`);
}

function main() {
  const content = generateReadme();
  fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), content, 'utf-8');
  console.log('[README] ✅ README.md actualizado con éxito.');
}

if (isDirectRun()) {
  main();
}
