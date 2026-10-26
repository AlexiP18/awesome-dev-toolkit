import fs from 'fs';
import path from 'path';
import { loadAllTools } from './note_generator.js';
import { ToolCategory, ToolItem } from './types.js';

const CATEGORY_ICONS: Record<ToolCategory, string> = {
  'CLI & Terminal': '🛠️',
  'Frontend & UI': '🎨',
  'Backend & APIs': '⚙️',
  'DevOps & Cloud': '🐳',
  'AI & Machine Learning': '🤖',
  'Prompts, Art & Video': '🎬',
  'Databases & Storage': '🗄️',
  'Productivity & Tools': '⚡',
  'Documentation & Resources': '📚',
  'Empresas & Productos': '🏢',
  'Productos Tecnológicos & Hardware': '🖥️',
  'Consejos & Buenas Prácticas': '💡',
  'Trabajo & Freelance': '💼',
  'Other': '📦',
};

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

  const companyBadge = item.frontmatter.company ? ` (\`🏢 ${item.frontmatter.company}\`)` : '';
  const authorBadge = item.frontmatter.author && !item.frontmatter.company
    ? ` (\`👤 ${item.frontmatter.author}\`)`
    : '';
  const websiteBadge = item.frontmatter.website_url
    ? ` [🌐 Web](${item.frontmatter.website_url})`
    : '';
  const tweetBadge = item.frontmatter.source_tweet
    ? ` [𝕏 Tweet](${item.frontmatter.source_tweet})`
    : '';
  const isJob = item.frontmatter.entry_type === 'job_remote' || item.frontmatter.category === 'Trabajo & Freelance';
  const isTip = !isJob && (item.frontmatter.entry_type === 'tech_tip' || item.frontmatter.category === 'Consejos & Buenas Prácticas');
  const isProduct = !isJob && !isTip && (
    item.frontmatter.entry_type === 'tech_product' ||
    item.frontmatter.category === 'Productos Tecnológicos & Hardware'
  );
  const locationBadge = item.frontmatter.location ? ` (\`🌍 ${item.frontmatter.location}\`)` : '';
  const salaryBadge = item.frontmatter.salary ? ` (\`💰 ${item.frontmatter.salary}\`)` : '';
  const priceBadge = item.frontmatter.price ? ` (\`💰 ${item.frontmatter.price}\`)` : '';
  const isAcademic = Boolean(
    item.frontmatter.has_academic_promo ||
    (item.frontmatter.tags && item.frontmatter.tags.some((t: string) => ['academic', 'academico', 'académico', 'estudiante', 'estudiantes', 'student', 'students', 'education', 'educacion', 'educación'].includes(t.toLowerCase())))
  );
  const academicBadge = isAcademic ? ' `🎓 Promo Académica`' : '';
  const notePath = isJob
    ? `content/jobs/${item.slug}.md`
    : isTip
    ? `content/tips/${item.slug}.md`
    : isProduct
    ? `content/products/${item.slug}.md`
    : `content/tools/${item.slug}.md`;

  let row = `- **[${item.frontmatter.name}](${item.frontmatter.url})**${companyBadge}${authorBadge}${locationBadge}${salaryBadge}${priceBadge}${starsBadge}${websiteBadge}${tweetBadge}${academicBadge}${statusBadge}  \n`;
  row += `  ${summary} [📝 Ver ficha](${notePath})${tags}\n\n`;
  return row;
}

export function generateReadme(): string {
  const allTools = loadAllTools();

  // Partición exacta en los 4 apartados
  const isJobItem = (t: ToolItem) => t.frontmatter.entry_type === 'job_remote' || t.frontmatter.category === 'Trabajo & Freelance';
  const isTipItem = (t: ToolItem) => !isJobItem(t) && (t.frontmatter.entry_type === 'tech_tip' || t.frontmatter.category === 'Consejos & Buenas Prácticas');
  const isProductItem = (t: ToolItem) => !isJobItem(t) && !isTipItem(t) && (
    t.frontmatter.entry_type === 'tech_product' ||
    t.frontmatter.category === 'Productos Tecnológicos & Hardware'
  );

  const jobItems = allTools.filter(isJobItem);
  const tipItems = allTools.filter(isTipItem);
  const productItems = allTools.filter(isProductItem);
  const toolItems = allTools.filter(t => !isJobItem(t) && !isTipItem(t) && !isProductItem(t));

  let body = '';

  // ---------------------------------------------------------
  // APARTADO 1: HERRAMIENTAS
  // ---------------------------------------------------------
  body += `## 🛠️ Apartado 1: Herramientas & Repositorios de Software (${toolItems.length})\n\n`;
  body += `> Bibliotecas, utilidades CLI, herramientas de desarrollo, devtools y productos técnicos guardados desde X.\n\n`;

  if (toolItems.length === 0) {
    body += `*Aún no has guardado herramientas. Utiliza el botón o el comando \`npm run add\` para añadir una.*\n\n`;
  } else {
    // Agrupar herramientas por categoría
    const toolGroups: Partial<Record<ToolCategory, typeof toolItems>> = {};
    for (const t of toolItems) {
      const cat = t.frontmatter.category || 'Other';
      if (!toolGroups[cat]) toolGroups[cat] = [];
      toolGroups[cat]!.push(t);
    }

    const categories = Object.keys(CATEGORY_ICONS) as ToolCategory[];
    for (const cat of categories) {
      const items = toolGroups[cat];
      if (!items || items.length === 0) continue;
      const icon = CATEGORY_ICONS[cat];
      body += `### ${icon} ${cat} (${items.length})\n\n`;
      for (const item of items) {
        body += renderItemRow(item);
      }
    }
  }

  // ---------------------------------------------------------
  // APARTADO 2: CONSEJOS
  // ---------------------------------------------------------
  body += `---\n\n## 💡 Apartado 2: Consejos Técnicos & Buenas Prácticas (${tipItems.length})\n\n`;
  body += `> Trucos prácticos, comandos, snippets de código y lecciones de arquitectura e ingeniería de software.\n\n`;

  if (tipItems.length === 0) {
    body += `*Aún no has guardado consejos técnicos. Agrega tweets con trucos prácticos para verlos aquí.*\n\n`;
  } else {
    const tipGroups: Partial<Record<ToolCategory, typeof tipItems>> = {};
    for (const t of tipItems) {
      const cat = t.frontmatter.category || 'Consejos & Buenas Prácticas';
      if (!tipGroups[cat]) tipGroups[cat] = [];
      tipGroups[cat]!.push(t);
    }

    const categories = Object.keys(CATEGORY_ICONS) as ToolCategory[];
    for (const cat of categories) {
      const items = tipGroups[cat];
      if (!items || items.length === 0) continue;
      const icon = CATEGORY_ICONS[cat];
      body += `### ${icon} ${cat} (${items.length})\n\n`;
      for (const item of items) {
        body += renderItemRow(item);
      }
    }
  }

  // ---------------------------------------------------------
  // APARTADO 3: TRABAJO Y FREELANCE
  // ---------------------------------------------------------
  body += `---\n\n## 💼 Apartado 3: Trabajo Remoto & Oportunidades Freelance (${jobItems.length})\n\n`;
  body += `> Ofertas de empleo remoto (Mundial / LATAM), proyectos freelance, bolsas de trabajo y plataformas para devs.\n\n`;

  if (jobItems.length === 0) {
    body += `*Aún no has guardado oportunidades de trabajo remoto o freelance. Agrega ofertas o convocatorias para gestionarlas aquí.*\n\n`;
  } else {
    for (const item of jobItems) {
      body += renderItemRow(item);
    }
  }

  // ---------------------------------------------------------
  // APARTADO 4: PRODUCTOS TECNOLÓGICOS & HARDWARE
  // ---------------------------------------------------------
  body += `---\n\n## 🖥️ Apartado 4: Productos Tecnológicos & Hardware (${productItems.length})\n\n`;
  body += `> Dispositivos para devs, placas de desarrollo (Raspberry Pi, ESP32, Arduino), laptops, periféricos, gadgets y hardware técnico.\n\n`;

  if (productItems.length === 0) {
    body += `*Aún no has guardado productos tecnológicos o hardware. Agrega dispositivos, gadgets o periféricos técnicos para verlos aquí.*\n\n`;
  } else {
    for (const item of productItems) {
      body += renderItemRow(item);
    }
  }

  const toc = `## 📑 Los 4 Apartados del Toolkit

- [🛠️ Apartado 1: Herramientas de Desarrollo](#-apartado-1-herramientas--repositorios-de-software-${toolItems.length}) (${toolItems.length})
- [💡 Apartado 2: Consejos Técnicos & Buenas Prácticas](#-apartado-2-consejos-técnicos--buenas-prácticas-${tipItems.length}) (${tipItems.length})
- [💼 Apartado 3: Trabajo Remoto & Freelance](#-apartado-3-trabajo-remoto--oportunidades-freelance-${jobItems.length}) (${jobItems.length})
- [🖥️ Apartado 4: Productos Tecnológicos & Hardware](#-apartado-4-productos-tecnológicos--hardware-${productItems.length}) (${productItems.length})
`;

  return `# 🚀 Awesome Dev Toolkit & Segundo Cerebro

> Colección curada en **4 apartados esenciales** (Herramientas, Consejos Técnicos, Trabajo Remoto/Freelance y Productos Tech/Hardware) descubiertos en **X/Twitter**, sincronizados automáticamente con notas individuales de **Obsidian** y un catálogo interactivo con IA (Gemini 3.8 Flash).

[![Herramientas](https://img.shields.io/badge/🛠️_Herramientas-${toolItems.length}-blue?style=for-the-badge)]()
[![Consejos](https://img.shields.io/badge/💡_Consejos-${tipItems.length}-8E75C2?style=for-the-badge)]()
[![Trabajo Remoto](https://img.shields.io/badge/💼_Trabajo_Remoto-${jobItems.length}-0284C7?style=for-the-badge)]()
[![Productos Tech](https://img.shields.io/badge/🖥️_Productos_Tech-${productItems.length}-D97706?style=for-the-badge)]()
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
Abre \`http://localhost:4000\` en tu navegador para ver el catálogo con buscador instantáneo (\`Cmd+K\`), selector de los 4 apartados y notas personales.

### 2. Añadir un recurso rápidamente desde la terminal
\`\`\`bash
npm run add "https://github.com/astral-sh/uv"
\`\`\`

### 3. Usar como Segundo Cerebro en Obsidian
Abre las carpetas directamente como un **Vault en Obsidian**:
- \`content/tools/\`: Herramientas y bibliotecas.
- \`content/tips/\`: Consejos técnicos y trucos.
- \`content/jobs/\`: Oportunidades de trabajo remoto y freelance.
- \`content/products/\`: Productos tecnológicos y hardware.

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
