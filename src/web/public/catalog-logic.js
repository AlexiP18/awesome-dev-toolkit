/**
 * Filtros puros del catálogo, compartidos por la UI y los tests.
 * La revisión manual replica groupsNeedingReview: misma URL canónica,
 * nombres que no son el mismo producto.
 */

const TRACKING_PARAMS = [
  'oref', 'ref', 'ref_src', 'ref_url',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', 'si', 'usp', 'mkt_tok', 'clid',
];

const GENERIC_NAME_TOKENS = new Set([
  'app', 'web', 'dev', 'design', 'styles', 'style', 'tool', 'tools', 'software',
  'platform', 'studio', 'pro', 'kit', 'the', 'and', 'for', 'con', 'para', 'open',
  'source', 'video', 'videos', 'free', 'oficial', 'library', 'libreria',
]);

export function alnum(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isBlankUrl(raw) {
  return !raw || /^(null|undefined|#|none)$/i.test(raw);
}

function ensureProtocol(raw) {
  const trimmed = String(raw).trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/\//, '')}`;
}

function isTrackingParam(name) {
  const key = name.toLowerCase();
  return TRACKING_PARAMS.includes(key) || key.startsWith('utm_');
}

export function canonicalUrlKey(raw) {
  if (raw == null) return '';
  const compact = String(raw).trim().replace(/\s+/g, '');
  if (isBlankUrl(compact)) return '';

  let parsed;
  try {
    parsed = new URL(ensureProtocol(compact));
  } catch {
    return '';
  }

  let host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'twitter.com' || host === 'mobile.twitter.com' || host === 'm.twitter.com') {
    host = 'x.com';
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingParam(key)) parsed.searchParams.delete(key);
  }

  let path = parsed.pathname.replace(/\/+$/, '').replace(/\/index\.html?$/i, '');

  if (host === 'github.com' || host === 'gitlab.com') {
    const match = path.match(/^\/([^/]+)\/([^/]+)/);
    if (match) {
      const owner = decodeURIComponent(match[1]).toLowerCase();
      const repo = decodeURIComponent(match[2]).toLowerCase().replace(/\.git$/, '');
      return `${host}/${owner}/${repo}`;
    }
  }

  if (host === 'x.com' && !/\/status\/\d+/.test(path)) return '';

  const params = [...parsed.searchParams.entries()]
    .map(([key, value]) => [key.toLowerCase(), value])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const qs = params.length ? `?${params.map(([key, value]) => `${key}=${value}`).join('&')}` : '';
  return `${host}${path}${qs}`;
}

function withoutParenthetical(name) {
  return name.replace(/\s*[([].*?[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

function nameTokens(name) {
  const spaced = name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token));
}

function tokensNear(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.startsWith(short) && long.length - short.length <= 3;
}

export function namesLookLikeSameProduct(a, b) {
  const left = withoutParenthetical((a || '').trim());
  const right = withoutParenthetical((b || '').trim());
  if (!left || !right) return true;

  const aa = alnum(left);
  const bb = alnum(right);
  if (!aa || !bb) return true;
  if (aa === bb) return true;

  const [short, long] = aa.length <= bb.length ? [aa, bb] : [bb, aa];
  if (short.length >= 4 && long.startsWith(short) && long.length - short.length <= 8) return true;

  const ta = nameTokens(left);
  const tb = nameTokens(right);
  if (ta.length === 0 || tb.length === 0) return false;
  const share = ta.some((token) => tb.some((other) => tokensNear(token, other)));
  if (!share) return false;

  const exclusive = (tokens, other) =>
    tokens.filter((token) => token.length >= 5 && !other.some((candidate) => tokensNear(token, candidate)));
  return exclusive(ta, tb).length === 0 || exclusive(tb, ta).length === 0;
}

export function entryTypeOf(tool) {
  const fm = tool?.frontmatter || {};
  if (fm.entry_type) return fm.entry_type;
  if (fm.category === 'Trabajo & Freelance') return 'job_remote';
  if (fm.category === 'Consejos & Buenas Prácticas') return 'tech_tip';
  return 'tool';
}

/**
 * @param {Array<{ slug: string, content?: string, frontmatter?: object }>} tools
 * @returns {Record<string, string>}
 */
export function flagToolsNeedingReview(tools) {
  const reasons = {};
  const byUrl = new Map();

  for (const tool of tools || []) {
    if (!tool?.slug) continue;
    const fm = tool.frontmatter || {};
    const explicit = fm.needs_review === true
      || fm.needs_review === 'true'
      || /REVISI[ÓO]N MANUAL/i.test(String(tool.content || ''));
    if (explicit) {
      reasons[tool.slug] = 'Marcada para revisión manual.';
    }
    const key = canonicalUrlKey(fm.url);
    if (!key) continue;
    const list = byUrl.get(key) || [];
    list.push(tool);
    byUrl.set(key, list);
  }

  for (const [key, group] of byUrl) {
    if (group.length < 2) continue;
    let distinct = false;
    for (let i = 0; i < group.length && !distinct; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (!namesLookLikeSameProduct(group[i].frontmatter?.name, group[j].frontmatter?.name)) {
          distinct = true;
          break;
        }
      }
    }
    if (!distinct) continue;
    const names = group.map((tool) => tool.frontmatter?.name || tool.slug).join(', ');
    const reason = `Comparte ${key} con fichas de productos distintos: ${names}.`;
    for (const tool of group) reasons[tool.slug] = reason;
  }

  return reasons;
}

export function sortTools(tools, mode) {
  const list = [...(tools || [])];
  const recency = (tool) => {
    const fm = tool?.frontmatter || {};
    const created = fm.created_at ? new Date(fm.created_at).getTime() : 0;
    if (created) return created;
    if (tool?.mtimeMs) return tool.mtimeMs;
    const added = fm.date_added ? new Date(fm.date_added).getTime() : 0;
    return Number.isNaN(added) ? 0 : added;
  };
  if (mode === 'name') {
    list.sort((a, b) => (a.frontmatter?.name || '').localeCompare(b.frontmatter?.name || '', 'es', { sensitivity: 'base' }));
  } else if (mode === 'stars') {
    list.sort((a, b) => (b.frontmatter?.stars || 0) - (a.frontmatter?.stars || 0)
      || (a.frontmatter?.name || '').localeCompare(b.frontmatter?.name || '', 'es', { sensitivity: 'base' }));
  } else {
    list.sort((a, b) => {
      const delta = recency(b) - recency(a);
      if (delta) return delta;
      return (b.frontmatter?.stars || 0) - (a.frontmatter?.stars || 0);
    });
  }
  return list;
}

export function pageWindow(total, page, size) {
  const safeSize = Math.max(1, size || 1);
  const pages = Math.max(1, Math.ceil((total || 0) / safeSize));
  const current = Math.min(Math.max(1, page || 1), pages);
  const start = (current - 1) * safeSize;
  return { pages, page: current, start, end: Math.min(total || 0, start + safeSize) };
}
