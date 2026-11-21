/**
 * GitHub API enricher: fetches stars, description, primary language, and topics.
 */

import { envInt, fetchWithRetry, safeErrorMessage } from './http_util.js';

export interface GitHubMetadata {
  name: string;
  fullName: string;
  description: string;
  stars: number;
  language?: string;
  topics: string[];
  homepage?: string;
  license?: string;
}

export async function fetchGitHubRepoMetadata(
  owner: string,
  repo: string,
  token?: string
): Promise<GitHubMetadata | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'awesome-dev-toolkit',
  };

  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  try {
    const res = await fetchWithRetry(url, {
      headers,
      timeoutMs: envInt('HTTP_TIMEOUT_MS', 8000),
    }, { retries: envInt('HTTP_RETRIES', 2), label: `GitHub ${owner}/${repo}` });
    if (!res.ok) {
      console.warn(`[GitHub Enricher] ${owner}/${repo} HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    return {
      name: data.name,
      fullName: data.full_name,
      description: data.description || '',
      stars: data.stargazers_count || 0,
      language: data.language || undefined,
      topics: Array.isArray(data.topics) ? data.topics : [],
      homepage: data.homepage || undefined,
      license: data.license?.spdx_id || undefined,
    };
  } catch (error) {
    console.error(`[GitHub Enricher] Error fetching ${owner}/${repo}: ${safeErrorMessage(error)}`);
    return null;
  }
}
