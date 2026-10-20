import { ClassificationResult } from './types.js';
import { GitHubMetadata } from './github.js';
import { classifyWithProviderCascade, ALLOWED_CATEGORIES } from './ai_providers.js';

export { ALLOWED_CATEGORIES };

export async function classifyToolsWithGemini(params: {
  rawText: string;
  urls: string[];
  githubMetas?: Record<string, GitHubMetadata>;
}): Promise<ClassificationResult[]> {
  const { results, providerUsed } = await classifyWithProviderCascade(params);
  console.log(`[Pipeline] Clasificación finalizada utilizando: ${providerUsed}`);
  return results;
}

export async function classifyToolWithGemini(params: {
  rawText: string;
  url: string;
  githubMeta?: GitHubMetadata | null;
}): Promise<ClassificationResult> {
  const results = await classifyToolsWithGemini({
    rawText: params.rawText,
    urls: params.url ? [params.url] : [],
    githubMetas: params.githubMeta && params.url ? { [params.url]: params.githubMeta } : {},
  });
  return results[0];
}
