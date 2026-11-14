import { ClassificationResult } from './types.js';
import { GitHubMetadata } from './github.js';
import { WebPageMetadata } from './link_resolver.js';
import { classifyWithProviderCascade, ALLOWED_CATEGORIES } from './ai_providers.js';

export { ALLOWED_CATEGORIES };

export async function classifyToolsWithGemini(
  params: {
    rawText: string;
    urls: string[];
    sourceTweet?: string;
    githubMetas?: Record<string, GitHubMetadata>;
    websiteMetas?: Record<string, WebPageMetadata>;
  },
  preferredProvider?: string
): Promise<{ results: ClassificationResult[]; providerUsed: string; switchNotice?: string }> {
  const { results, providerUsed, switchNotice } = await classifyWithProviderCascade(params, preferredProvider);
  console.log(`[Pipeline] Clasificación finalizada utilizando: ${providerUsed}`);
  return { results, providerUsed, switchNotice };
}

