import dotenv from 'dotenv';
import { extractUrlsFromText, resolveUrl } from './link_resolver.js';
import { fetchGitHubRepoMetadata, GitHubMetadata } from './github.js';
import { classifyToolsWithGemini } from './gemini.js';
import { createOrUpdateToolNote } from './note_generator.js';
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
    // Support comma-separated list of URLs passed from bookmarklet query params
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

  console.log(
    `[Pipeline] Resolviendo ${nonTweetUrls.length} enlace(s)...`
  );

  // 2. Resolve redirects in parallel (e.g. t.co -> final URL)
  const resolvedList = await Promise.all(
    nonTweetUrls.map((u) => resolveUrl(u))
  );

  const canonicalUrls = Array.from(
    new Set(resolvedList.map((r) => r.finalUrl).filter(Boolean))
  );

  // 3. Fetch GitHub metadata for any GitHub repos in parallel
  const githubMetas: Record<string, GitHubMetadata> = {};
  await Promise.all(
    resolvedList.map(async (res) => {
      if (res.isGitHub && res.githubOwner && res.githubRepo) {
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

  // 5. Generate / Update Obsidian Markdown note for EACH tool
  const savedItems = classifications.map((classification) => {
    const ghMeta = githubMetas[classification.canonicalUrl] || null;
    const result = createOrUpdateToolNote({
      classification,
      githubMeta: ghMeta,
      sourceTweet: input.sourceTweet,
      author: input.author,
      initialStatus: input.status,
    });

    console.log(`[Pipeline] ✅ Nota guardada: ${result.filePath}`);
    return {
      slug: result.slug,
      filePath: result.filePath,
      classification,
      stars: ghMeta?.stars,
    };
  });

  const first = savedItems[0];
  return {
    count: savedItems.length,
    items: savedItems,
    slug: first?.slug,
    filePath: first?.filePath,
    classification: first?.classification,
    stars: first?.stars,
  };
}
