import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { slugify, loadAllTools } from './note_generator.js';
import { analyzeAuthorWithCascade, AuthorProfileResult } from './ai_providers.js';

export const AUTHORS_DIR = path.resolve(process.cwd(), 'content/authors');

export function ensureAuthorsDirExists(): void {
  if (!fs.existsSync(AUTHORS_DIR)) {
    fs.mkdirSync(AUTHORS_DIR, { recursive: true });
  }
}

export interface AuthorProfile extends AuthorProfileResult {
  slug: string;
  twitterUrl?: string;
  dateAnalyzed?: string;
  providerUsed?: string;
}

function cleanFrontmatter(obj: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export function saveAuthorProfile(profile: AuthorProfileResult, providerUsed?: string): AuthorProfile {
  ensureAuthorsDirExists();

  const slug = slugify(profile.handle || profile.name);
  const filePath = path.join(AUTHORS_DIR, `${slug}.md`);
  const today = new Date().toISOString().split('T')[0];
  const twitterUrl = profile.handle ? `https://x.com/${profile.handle.replace(/^@/, '')}` : undefined;

  const frontmatter = {
    name: profile.name,
    handle: profile.handle ? profile.handle.replace(/^@/, '') : undefined,
    role: profile.role,
    bio: profile.bio,
    specialties: profile.specialties,
    why_follow: profile.whyFollow,
    suggested_tags: profile.suggestedTags,
    github_url: profile.githubUrl,
    website_url: profile.websiteUrl,
    twitter_url: twitterUrl,
    date_analyzed: today,
    provider_used: providerUsed,
  };

  const specialtiesMd = (profile.specialties || []).map((s) => `- ${s}`).join('\n');
  const tagsMd = (profile.suggestedTags || []).map((t) => `\`#${t}\``).join(' ');

  const linksMd = [
    twitterUrl ? `- Perfil en X: [${twitterUrl}](${twitterUrl})` : '',
    profile.githubUrl ? `- GitHub: [${profile.githubUrl}](${profile.githubUrl})` : '',
    profile.websiteUrl ? `- Web Oficial: [${profile.websiteUrl}](${profile.websiteUrl})` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const markdownBody = `
# ${profile.name} ${profile.handle ? `(@${profile.handle.replace(/^@/, '')})` : ''}

> ${profile.bio}

## 💼 Rol & Enfoque
**${profile.role}**

## 🎯 Especialidades Técnicas
${specialtiesMd}

## 💡 ¿Por qué seguirlo en X?
${profile.whyFollow}

${tagsMd ? `## 🏷️ Etiquetas Relevantes\n${tagsMd}\n` : ''}
${linksMd ? `## 🔗 Enlaces\n${linksMd}\n` : ''}
`;

  const fileContent = matter.stringify(markdownBody.trim() + '\n', cleanFrontmatter(frontmatter));
  fs.writeFileSync(filePath, fileContent, 'utf-8');

  return {
    ...profile,
    slug,
    twitterUrl,
    dateAnalyzed: today,
    providerUsed,
  };
}

export function loadAllAuthorProfiles(): Record<string, AuthorProfile> {
  ensureAuthorsDirExists();
  const map: Record<string, AuthorProfile> = {};

  if (!fs.existsSync(AUTHORS_DIR)) return map;

  const files = fs.readdirSync(AUTHORS_DIR).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    try {
      const filePath = path.join(AUTHORS_DIR, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(raw);
      const data = parsed.data as any;
      const slug = path.basename(file, '.md');

      let cleanGh = data.github_url;
      if (cleanGh && typeof cleanGh === 'string' && cleanGh.includes('github.com')) {
        try {
          const u = new URL(cleanGh.startsWith('http') ? cleanGh : `https://${cleanGh}`);
          const segs = u.pathname.split('/').filter(Boolean);
          if (segs.length >= 1) {
            cleanGh = `https://github.com/${segs[0]}`;
          }
        } catch {
          // ignore error
        }
      }

      const profile: AuthorProfile = {
        slug,
        name: data.name || slug,
        handle: data.handle,
        role: data.role || 'Curador Técnico',
        bio: data.bio || '',
        specialties: data.specialties || [],
        whyFollow: data.why_follow || '',
        suggestedTags: data.suggested_tags || [],
        githubUrl: cleanGh,
        websiteUrl: data.website_url,
        twitterUrl: data.twitter_url || (data.handle ? `https://x.com/${data.handle}` : undefined),
        dateAnalyzed: data.date_analyzed,
        providerUsed: data.provider_used,
      };

      // Index by slug, name (lowercase) and handle (lowercase)
      map[slug] = profile;
      if (profile.name) map[profile.name.toLowerCase()] = profile;
      if (profile.handle) map[profile.handle.toLowerCase()] = profile;
    } catch (err) {
      console.warn(`[AuthorManager] Error leyendo perfil ${file}:`, err);
    }
  }

  return map;
}

export async function analyzeAuthorWithAI(
  authorName: string,
  authorHandle?: string,
  aiProvider?: string
): Promise<{ profile: AuthorProfile; providerUsed: string; switchNotice?: string }> {
  const allTools = loadAllTools();

  // Find all tools associated with this author
  const authorTools = allTools.filter((t) => {
    const fm = t.frontmatter;
    if (fm.author && fm.author.toLowerCase() === authorName.toLowerCase()) return true;
    if (authorHandle && fm.author_handle && fm.author_handle.toLowerCase() === authorHandle.toLowerCase()) return true;
    if (authorHandle && fm.source_tweet && fm.source_tweet.toLowerCase().includes(`/${authorHandle.toLowerCase()}/`)) return true;
    return false;
  });

  const toolsSummary = authorTools.map((t) => ({
    name: t.frontmatter.name,
    category: t.frontmatter.category,
    oneLiner: t.content.match(/^>\s*(.+)$/m)?.[1] || '',
    url: t.frontmatter.url,
    tags: t.frontmatter.tags || [],
  }));

  console.log(`[AuthorManager] 🤖 Analizando autor "${authorName}" (@${authorHandle || 'n/a'}) con IA (${toolsSummary.length} herramientas)...`);

  const { result, providerUsed, switchNotice } = await analyzeAuthorWithCascade(
    {
      name: authorName,
      handle: authorHandle,
      tools: toolsSummary,
    },
    aiProvider
  );

  const savedProfile = saveAuthorProfile(result, providerUsed);
  console.log(`[AuthorManager] ✅ Perfil de "${authorName}" guardado en content/authors/${savedProfile.slug}.md`);

  return { profile: savedProfile, providerUsed, switchNotice };
}
