import dotenv from 'dotenv';
import {
  extractUrlsFromText,
  resolveUrl,
  isIgnoredNonToolUrl,
  expandTruncatedGitHubUrls,
} from './link_resolver.js';
import { fetchGitHubRepoMetadata, GitHubMetadata } from './github.js';
import { classifyToolsWithGemini } from './gemini.js';
import {
  createOrUpdateToolNote,
  findExistingTool,
  loadAllTools,
} from './note_generator.js';
import { ToolStatus, EntryType } from './types.js';

dotenv.config();

export interface IngestInput {
  rawText?: string;
  url?: string;
  urls?: string[];
  sourceTweet?: string;
  author?: string;
  status?: ToolStatus;
  entryType?: EntryType;
  aiProvider?: string;
}

export async function ingestResource(input: IngestInput) {
  let text = (input.rawText || '').trim();
  const explicitUrl = (input.url || '').trim();
  const explicitUrls = Array.isArray(input.urls) ? input.urls : [];

  // 1. Gather all potential URLs
  const candidateUrls: string[] = [];
  for (const u of explicitUrls) {
    if (u && u.trim()) candidateUrls.push(u.trim());
  }
  if (explicitUrl) {
    for (const part of explicitUrl.split(',')) {
      if (part.trim()) candidateUrls.push(part.trim());
    }
  }
  if (text) {
    candidateUrls.push(...extractUrlsFromText(text));
  }

  // Filtrar enlaces de Twitter/X y enlaces sociales/comunitarios no técnicos (Telegram, Discord, etc.)
  const nonTweetUrls = Array.from(
    new Set(
      candidateUrls
        .map((u) => u.trim())
        .filter((u) => Boolean(u) && !isIgnoredNonToolUrl(u))
    )
  );

  if (nonTweetUrls.length === 0 && !text && !input.sourceTweet) {
    throw new Error('Debes proporcionar al menos una URL o texto para procesar.');
  }

  console.log(`[Pipeline] Resolviendo ${nonTweetUrls.length} enlace(s)...`);

  // 2. Resolve redirects in parallel (e.g. t.co -> final URL)
  const rawResolvedList = (await Promise.all(
    nonTweetUrls.map((u) => resolveUrl(u))
  )).filter((r) => !isIgnoredNonToolUrl(r.finalUrl));

  // 2.5. Expandir o limpiar enlaces truncados en el texto (ej. "github.com/HKUDS/Vibe-Tra..." -> "https://github.com/HKUDS/Vibe-Trading")
  if (text) {
    const { cleanedText, expandedUrls } = await expandTruncatedGitHubUrls(
      text,
      rawResolvedList.map((r) => r.finalUrl),
      process.env.GITHUB_TOKEN
    );
    text = cleanedText;
    for (const expUrl of expandedUrls) {
      if (!rawResolvedList.some((r) => r.finalUrl.toLowerCase() === expUrl.toLowerCase())) {
        const resExp = await resolveUrl(expUrl);
        if (!isIgnoredNonToolUrl(resExp.finalUrl)) {
          rawResolvedList.push(resExp);
        }
      }
    }
  }

  // Filtrar URLs de GitHub que sean un prefijo truncado de otra URL de GitHub resuelta
  // (ej. descartar "https://github.com/diegosouzapw/O" si existe "https://github.com/diegosouzapw/OmniRoute")
  const resolvedList = rawResolvedList.filter((item) => {
    const lower = item.finalUrl.toLowerCase();
    if (!item.isGitHub) return true;
    const isTruncatedPrefix = rawResolvedList.some(
      (other) =>
        other.isGitHub &&
        other.finalUrl.toLowerCase() !== lower &&
        other.finalUrl.toLowerCase().startsWith(lower)
    );
    return !isTruncatedPrefix;
  });

  const canonicalUrls = Array.from(
    new Set(resolvedList.map((r) => r.finalUrl).filter(Boolean))
  );

  // Si no se detectaron URLs externas pero se proporcionó el tweet de origen, usarlo como enlace de respaldo
  if (canonicalUrls.length === 0 && input.sourceTweet) {
    canonicalUrls.push(input.sourceTweet);
  }

  // Priorizar repositorios de GitHub al inicio de los candidatos (y los de nombre más completo primero)
  canonicalUrls.sort((a, b) => {
    const aGh = a.includes('github.com') ? 1 : 0;
    const bGh = b.includes('github.com') ? 1 : 0;
    if (bGh !== aGh) return bGh - aGh;
    return b.length - a.length;
  });

  // Load current catalog to check duplicates
  const existingTools = loadAllTools();

  // Fast-path: if there is no tweet text (or just a single direct URL added manually)
  // and the resolved URL already exists in the catalog, skip Gemini call completely!
  if (!text && canonicalUrls.length === 1) {
    const existing = findExistingTool({ url: canonicalUrls[0] }, existingTools);
    if (existing) {
      console.log(
        `[Pipeline] ⏭️ Recurso ya existente detectado antes de llamar a IA: ${existing.frontmatter.name}`
      );
      const item = {
        slug: existing.slug,
        filePath: existing.filePath,
        alreadyExisted: true,
        classification: {
          name: existing.frontmatter.name,
          canonicalUrl: existing.frontmatter.url,
          category: existing.frontmatter.category,
          tags: existing.frontmatter.tags || [],
          oneLiner: 'Ya registrado previamente en tu Toolkit.',
          keyHighlights: [],
          recommendedNotes: '',
        },
        stars: existing.frontmatter.stars,
      };
      return {
        count: 1,
        addedCount: 0,
        skippedCount: 1,
        items: [item],
        slug: item.slug,
        filePath: item.filePath,
        alreadyExisted: true,
        classification: item.classification,
        stars: item.stars,
      };
    }
  }

  // 3. Fetch GitHub metadata for any GitHub repos in parallel (only for non-existing URLs)
  const githubMetas: Record<string, GitHubMetadata> = {};
  await Promise.all(
    resolvedList.map(async (res) => {
      if (res.isGitHub && res.githubOwner && res.githubRepo) {
        const alreadyThere = findExistingTool({ url: res.finalUrl }, existingTools);
        if (alreadyThere) return;

        console.log(
          `[Pipeline] Consultando GitHub API para ${res.githubOwner}/${res.githubRepo}...`
        );
        const meta = await fetchGitHubRepoMetadata(
          res.githubOwner,
          res.githubRepo,
          process.env.GITHUB_TOKEN
        );
        if (meta) {
          githubMetas[res.finalUrl] = meta;
        }
      }
    })
  );

  // 4. Classify and summarize all tools found in the tweet with AI Cascade
  console.log(`[Pipeline] Analizando y extrayendo herramientas con IA en cascada...`);
  const { results: classifications, providerUsed, switchNotice } = await classifyToolsWithGemini(
    {
      rawText: text || canonicalUrls.join('\n') || input.sourceTweet || '',
      urls: canonicalUrls,
      sourceTweet: input.sourceTweet,
      githubMetas,
    },
    input.aiProvider
  );

  console.log(`[Pipeline] IA (${providerUsed}) identificó ${classifications.length} herramienta(s).`);

  // 4.5. Prioridad Determinística y Reconciliación con Repositorios Reales:
  // Si la IA devolvió una landing page o una URL de GitHub con variaciones tipográficas/alucinadas (ej. cheaper-inference/OmniRoute o lemo-ai),
  // reconciliar con los repositorios reales detectados y verificados en resolvedList.
  const ghRepos = resolvedList
    .filter((r) => r.isGitHub && r.finalUrl)
    .sort((a, b) => {
      // Priorizar repos que sí devolvieron metadata válida en GitHub API (existen realmente)
      const aHasMeta = githubMetas[a.finalUrl] ? 1 : 0;
      const bHasMeta = githubMetas[b.finalUrl] ? 1 : 0;
      if (bHasMeta !== aHasMeta) return bHasMeta - aHasMeta;
      return (b.githubRepo || '').length - (a.githubRepo || '').length;
    });

  for (const classification of classifications) {
    if (ghRepos.length > 0) {
      const toolName = classification.name.toLowerCase().replace(/[-_\s]/g, '');
      const aiGhMatch = classification.canonicalUrl.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i);
      const aiRepoName = aiGhMatch ? aiGhMatch[2].toLowerCase().replace(/[-_]/g, '') : '';

      // 1. Buscar coincidencia exacta de nombre de repositorio
      let matchingGh = ghRepos.find((r) => {
        const rName = (r.githubRepo || '').toLowerCase().replace(/[-_]/g, '');
        return rName.length >= 2 && (rName === aiRepoName || rName === toolName);
      });

      // 2. Si no hubo exacta, buscar coincidencia parcial exigiendo longitud >= 3 (evita falsos positivos como "/O")
      if (!matchingGh) {
        matchingGh = ghRepos.find((r) => {
          const rName = (r.githubRepo || '').toLowerCase().replace(/[-_]/g, '');
          if (rName.length < 3) return false;
          if (aiRepoName && aiRepoName.length >= 3 && (rName.includes(aiRepoName) || aiRepoName.includes(rName))) {
            return true;
          }
          return toolName.length >= 3 && (rName.includes(toolName) || toolName.includes(rName));
        });
      }

      // 3. Si solo hay 1 repo válido en el tweet y 1 herramienta clasificada
      if (!matchingGh && ghRepos.length === 1 && classifications.length === 1) {
        matchingGh = ghRepos[0];
      }

      if (matchingGh && matchingGh.finalUrl) {
        if (classification.canonicalUrl !== matchingGh.finalUrl) {
          console.log(
            `[Pipeline] 🔄 Reconciliando canonicalUrl con repositorio real de GitHub: ${matchingGh.finalUrl} (Antes: ${classification.canonicalUrl})`
          );
          if (!classification.websiteUrl && !classification.canonicalUrl.includes('github.com')) {
            classification.websiteUrl = classification.canonicalUrl;
          }
          classification.canonicalUrl = matchingGh.finalUrl;
        }
      }
    }

    // Limpiar websiteUrl si por error apunta a un repositorio de GitHub/GitLab o es idéntico a canonicalUrl
    if (
      classification.websiteUrl &&
      (classification.websiteUrl.toLowerCase() === classification.canonicalUrl.toLowerCase() ||
        classification.websiteUrl.toLowerCase().includes('github.com') ||
        classification.websiteUrl.toLowerCase().includes('gitlab.com'))
    ) {
      classification.websiteUrl = undefined;
    }

    if (!classification.canonicalUrl && input.sourceTweet) {
      classification.canonicalUrl = input.sourceTweet;
    }

    if (input.entryType) {
      classification.entryType = input.entryType;
      if (input.entryType === 'job_remote') {
        classification.category = 'Trabajo & Freelance';
      } else if (input.entryType === 'tech_tip' && (!classification.category || classification.category === 'Other')) {
        classification.category = 'Consejos & Buenas Prácticas';
      } else if (input.entryType === 'tech_product' && (!classification.category || classification.category === 'Other')) {
        classification.category = 'Productos Tecnológicos & Hardware';
      } else if (input.entryType === 'product_showcase' && (!classification.category || classification.category === 'Other')) {
        classification.category = 'Empresas & Productos';
      }
    }
  }

  // 5. Generate Obsidian Markdown note for EACH tool (skipping duplicates)
  const savedItems = [];
  for (const classification of classifications) {
    const ghMeta = githubMetas[classification.canonicalUrl] || null;
    const result = createOrUpdateToolNote(
      {
        classification,
        githubMeta: ghMeta,
        sourceTweet: input.sourceTweet,
        author: input.author,
        initialStatus: input.status,
        providerUsed,
      },
      existingTools
    );

    if (!result.alreadyExisted) {
      console.log(`[Pipeline] ✅ Nueva nota guardada: ${result.filePath}`);
      // Add to in-memory existingTools list so duplicates within the same tweet are also caught
      existingTools.push({
        slug: result.slug,
        filePath: result.filePath,
        frontmatter: {
          name: classification.name,
          url: classification.canonicalUrl,
          category: classification.category,
          tags: classification.tags,
          status: input.status || 'to_try',
          date_added: new Date().toISOString().split('T')[0],
        },
        content: '',
      });
    }

    savedItems.push({
      slug: result.slug,
      filePath: result.filePath,
      alreadyExisted: result.alreadyExisted,
      classification,
      stars: ghMeta?.stars,
    });
  }

  const addedCount = savedItems.filter((i) => !i.alreadyExisted).length;
  const skippedCount = savedItems.filter((i) => i.alreadyExisted).length;
  const first = savedItems[0];

  return {
    count: savedItems.length,
    addedCount,
    skippedCount,
    providerUsed,
    switchNotice,
    items: savedItems,
    slug: first?.slug,
    filePath: first?.filePath,
    alreadyExisted: first?.alreadyExisted,
    classification: first?.classification,
    stars: first?.stars,
  };
}
