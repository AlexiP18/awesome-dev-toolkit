import fs from 'fs';
import path from 'path';
import { loadAllTools } from './note_generator.js';
import { ToolCategory } from './types.js';

const CATEGORY_ICONS: Record<ToolCategory, string> = {
  'CLI & Terminal': '🛠️',
  'Frontend & UI': '🎨',
  'Backend & APIs': '⚙️',
  'DevOps & Cloud': '🐳',
  'AI & Machine Learning': '🤖',
  'Databases & Storage': '🗄️',
  'Productivity & Tools': '⚡',
  'Documentation & Resources': '📚',
  'Empresas & Productos': '🏢',
  'Other': '📦',
};

export function generateReadme(): string {
  const tools = loadAllTools();

  // Group by category
  const groups: Partial<Record<ToolCategory, typeof tools>> = {};

  for (const tool of tools) {
    const cat = tool.frontmatter.category || 'Other';
    if (!groups[cat]) {
      groups[cat] = [];
    }
    groups[cat]!.push(tool);
  }

  const categoryKeys = Object.keys(CATEGORY_ICONS) as ToolCategory[];

  let toc = '## 📑 Tabla de Contenidos\n\n';
  let body = '';

  for (const cat of categoryKeys) {
    const items = groups[cat];
    if (!items || items.length === 0) continue;

    const icon = CATEGORY_ICONS[cat];
    const anchor = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    toc += `- [${icon} ${cat}](#${anchor}) (${items.length})\n`;

    body += `\n### ${icon} ${cat}\n\n`;

    for (const item of items) {
      const starsBadge = item.frontmatter.stars
        ? ` ⭐ **${item.frontmatter.stars.toLocaleString()}**`
        : '';
      const tags = item.frontmatter.tags?.length
        ? ` ${item.frontmatter.tags.map((t) => `\`#${t}\``).join(' ')}`
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

      const companyBadge = item.frontmatter.company ? ` (\`🏢 ${item.frontmatter.company}\`)` : '';
      const websiteBadge = item.frontmatter.website_url
        ? ` [🌐 Web](${item.frontmatter.website_url})`
        : '';
      const notePath = item.frontmatter.entry_type === 'product_showcase'
        ? `content/products/${item.slug}.md`
        : `content/tools/${item.slug}.md`;

      body += `- **[${item.frontmatter.name}](${item.frontmatter.url})**${companyBadge}${starsBadge}${websiteBadge}${statusBadge}  \n`;
      body += `  ${summary} [📝 Ver ficha](${notePath})${tags}\n\n`;
    }
  }

  const totalTools = tools.length;

  return `# 🚀 Awesome Dev Toolkit & Segundo Cerebro

> Colección curada y categorizada de herramientas, bibliotecas y repositorios técnicos descubiertos en **X/Twitter**, sincronizados automáticamente con notas individuales de **Obsidian** y un catálogo interactivo con IA (Gemini 3.8 Flash).

[![Total Tools](https://img.shields.io/badge/Herramientas_guardadas-${totalTools}-blue?style=for-the-badge&logo=bookmark)]()
[![Gemini Powered](https://img.shields.io/badge/Clasificado_con-Gemini_3.8_Flash-8E75C2?style=for-the-badge&logo=google)]()
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
Abre \`http://localhost:4000\` en tu navegador para ver el catálogo con buscador instantáneo (\`Cmd+K\`), filtros por tecnología y notas personales.

### 2. Añadir un recurso rápidamente desde la terminal
\`\`\`bash
npm run add "https://github.com/astral-sh/uv"
\`\`\`

### 3. Usar como Segundo Cerebro en Obsidian
Abre la carpeta \`content/tools\` directamente como un **Vault en Obsidian** (o añade esta carpeta a tu Vault existente). Cada herramienta tiene su propio archivo \`.md\` con frontmatter YAML compatible con Dataview y notas de uso personal.

### 4. Guardado en 1-Clic desde X (Bookmarklet)
Arrastra el enlace desde la carpeta \`bookmarklet/\` a tu barra de favoritos de Chrome/Brave/Firefox. Al ver un tweet interesante en X, haz clic en el botón y se enviará directo a tu toolkit local.
`;
}

function main() {
  const content = generateReadme();
  fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), content, 'utf-8');
  console.log('[README] ✅ README.md actualizado con éxito.');
}

main();
