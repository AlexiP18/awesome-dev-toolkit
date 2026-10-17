import dotenv from 'dotenv';
import { extractUrlsFromText, resolveUrl } from './link_resolver.js';
import { fetchGitHubRepoMetadata, GitHubMetadata } from './github.js';
import { classifyToolsWithGemini } from './gemini.js';
import {
  createOrUpdateToolNote,
  findExistingTool,
  loadAllTools,
} from './note_generator.js';
import { ToolStatus } from './types.js';

dotenv.config();

export interface IngestInput {
  rawText?: string;
  url?: string;
  urls?: string[];
  sourceTweet?: string;
  author?: string;
  status?: ToolStatus;
}

export async function ingestResource(input: IngestInput) {
  const text = (input.rawText || '').trim();
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

  // Filter out the tweet's own URL or x.com internal links
  const nonTweetUrls = Array.from(
    new Set(
      candidateUrls.filter(
        (u) => !u.includes('twitter.com') && !u.includes('x.com')
      )
    )
  );

  if (nonTweetUrls.length === 0 && !text && !input.sourceTweet) {
    throw new Error('Debes proporcionar al menos una URL o texto para procesar.');
  }

  console.log(`[Pipeline] Resolviendo ${nonTweetUrls.length} enlace(s)...`);

  // 2. Resolve redirects in parallel (e.g. t.co -> final URL)
  const resolvedList = await Promise.all(
    nonTweetUrls.map((u) => resolveUrl(u))
  );

  const canonicalUrls = Array.from(
    new Set(resolvedList.map((r) => r.finalUrl).filter(Boolean))
  );

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

  // 4. Classify and summarize all tools found in the tweet with Gemini 3.8 Flash
  console.log(`[Pipeline] Analizando y extrayendo herramientas con Gemini 3.8 Flash...`);
  const classifications = await classifyToolsWithGemini({
    rawText: text || canonicalUrls.join('\n') || input.sourceTweet || '',
    urls: canonicalUrls,
    githubMetas,
  });

  console.log(`[Pipeline] Gemini identificó ${classifications.length} herramienta(s).`);

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
    items: savedItems,
    slug: first?.slug,
    filePath: first?.filePath,
    alreadyExisted: first?.alreadyExisted,
    classification: first?.classification,
    stars: first?.stars,
  };
}
