import dotenv from 'dotenv';
import { extractUrlsFromText, resolveUrl } from './link_resolver.js';
import { fetchGitHubRepoMetadata } from './github.js';
import { classifyToolWithGemini } from './gemini.js';
import { createOrUpdateToolNote } from './note_generator.js';
import { ToolStatus } from './types.js';

dotenv.config();

export interface IngestInput {
  rawText?: string;
  url?: string;
  sourceTweet?: string;
  author?: string;
  status?: ToolStatus;
}

export async function ingestResource(input: IngestInput) {
  const text = (input.rawText || '').trim();
  const explicitUrl = (input.url || '').trim();

  // 1. Gather all potential URLs
  const candidateUrls: string[] = [];
  if (explicitUrl) {
    candidateUrls.push(explicitUrl);
  }
  if (text) {
    candidateUrls.push(...extractUrlsFromText(text));
  }

  // Filter out the tweet's own URL if present in candidateUrls
  const nonTweetUrls = candidateUrls.filter(
    (u) => !u.includes('twitter.com') && !u.includes('x.com')
  );

  let targetUrl = nonTweetUrls[0] || candidateUrls[0] || input.sourceTweet || '';

  if (!targetUrl && !text) {
    throw new Error('Debes proporcionar al menos una URL o texto para procesar.');
  }

  console.log(`[Pipeline] Resolviendo enlace: ${targetUrl || 'Texto sin enlace'}`);

  // 2. Resolve redirects (e.g. t.co -> final URL)
  let resolved = targetUrl ? await resolveUrl(targetUrl) : null;
  const canonicalUrl = resolved ? resolved.finalUrl : targetUrl;

  // 3. Fetch GitHub metadata if it is a GitHub repo
  let githubMeta = null;
  if (resolved?.isGitHub && resolved.githubOwner && resolved.githubRepo) {
    console.log(`[Pipeline] Consultando GitHub API para ${resolved.githubOwner}/${resolved.githubRepo}...`);
    githubMeta = await fetchGitHubRepoMetadata(
      resolved.githubOwner,
      resolved.githubRepo,
      process.env.GITHUB_TOKEN
    );
  }

  // 4. Classify and summarize with Gemini
  console.log(`[Pipeline] Clasificando recurso con Gemini 3.8 Flash...`);
  const classification = await classifyToolWithGemini({
    rawText: text || githubMeta?.description || canonicalUrl,
    url: canonicalUrl,
    githubMeta,
  });

  // 5. Generate / Update Obsidian Markdown note
  const result = createOrUpdateToolNote({
    classification,
    githubMeta,
    sourceTweet: input.sourceTweet,
    author: input.author,
    initialStatus: input.status,
  });

  console.log(`[Pipeline] ✅ Nota guardada exitosamente en: ${result.filePath}`);
  return {
    slug: result.slug,
    filePath: result.filePath,
    classification,
    stars: githubMeta?.stars,
  };
}
