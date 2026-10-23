import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { ClassificationResult, ToolCategory } from './types.js';
import { GitHubMetadata } from './github.js';
import { isIgnoredNonToolUrl, cleanTrackingParams } from './link_resolver.js';

dotenv.config();

export const ALLOWED_CATEGORIES: ToolCategory[] = [
  'CLI & Terminal',
  'Frontend & UI',
  'Backend & APIs',
  'DevOps & Cloud',
  'AI & Machine Learning',
  'Prompts, Art & Video',
  'Databases & Storage',
  'Productivity & Tools',
  'Documentation & Resources',
  'Empresas & Productos',
  'Other',
];

export interface ClassifyInput {
  rawText: string;
  urls: string[];
  githubMetas?: Record<string, GitHubMetadata>;
}

function buildUserPrompt(params: ClassifyInput): string {
  const githubInfoList = Object.entries(params.githubMetas || {})
    .map(
      ([url, meta]) =>
        `  * [${url}] -> Nombre: ${meta.name}, Desc: ${meta.description}, Lenguaje: ${
          meta.language || 'N/A'
        }, Tópicos: ${meta.topics.join(', ')}, Estrellas: ${meta.stars}`
    )
    .join('\n');

  return `
Analiza el siguiente tweet o texto guardado para un Toolkit de Desarrolladores de Software:
- Texto original del Tweet / Guardado:
"""
${params.rawText}
"""
- Enlaces detectados y resueltos:
${params.urls.length > 0 ? params.urls.map((u) => `  * ${u}`).join('\n') : '  (Ninguno explícito, infiérelos del texto si aparecen dominios como sitio.com, herramienta.io, etc.)'}
${githubInfoList ? `- Metadata de GitHub:\n${githubInfoList}` : ''}

GUÍA ESPECÍFICA DE ANÁLISIS SEGÚN EL TIPO DE TWEET:

1. TWEETS TIPO LISTA O RECOPILACIÓN (Múltiples herramientas):
   - Si el tweet numera o agrupa varias herramientas distintas (ej: "1. Superdesign Skill github.com/... 2. Better Design ... 3. Design Taste ..."):
   - DEBES extraer y devolver CADA UNA de las herramientas como un objeto independiente dentro del arreglo JSON 'tools'.
   - Asocia a cada herramienta su URL correspondiente (web oficial o repositorio de GitHub).

2. TWEETS EXPLICATIVOS CON ENLACE (Showcases técnicos):
   - Si el tweet detalla y explica las bondades o arquitectura de un proyecto con su enlace (ej: "DeepSeek acaba de liberar DeepInfer... motor de inferencia de producción... licencia Apache 2.0 -> github.com/..."):
   - Extrae el nombre exacto de la herramienta (ej: "DeepInfer").
   - Aprovecha TODO el contexto técnico del tweet para redactar un 'oneLiner' preciso y 'keyHighlights' con las características técnicas reales descritas (licencia, optimizaciones, casos de uso).

3. TWEETS CON ENLACE DIRECTO O TARJETA SIN APENAS TEXTO:
   - Si el tweet contiene poco o ningún texto y solo comparte una tarjeta/enlace de GitHub o web (ej. tarjeta de "OpenUI"):
   - Apóyate en la 'Metadata de GitHub' provista arriba (descripción, tópicos, lenguaje, estrellas) y en la URL canónica para generar una ficha completa, técnica y profesional.

4. RECHAZO OBLIGATORIO DE ENLACES SOCIALES Y COMUNITARIOS:
   - Si el tweet incluye un enlace a una herramienta Y TAMBIÉN enlaces a canales de Telegram (t.me/...), servidores de Discord (discord.gg/...), grupos de WhatsApp, canales personales de YouTube o enlaces de donación/café:
   - RECHAZA Y DESCARTA por completo los enlaces comunitarios/sociales. La herramienta NUNCA es el canal de Telegram o Discord. Solo debes registrar la herramienta de software o sitio web técnico real.

5. TWEETS DE EMPRESAS O CREADORES ANUNCIANDO UN PRODUCTO SIN ENLACE DIRECTO (Apartado: 'Empresas & Productos'):
   - Si una empresa o creador anuncia un producto técnico, archivo o recurso pero no incluye un link web/repo directo (ej: "Introducing epstein.md A 927,400+ Character .MD File trained to skip vibe coded AI slop..."):
   - Si describe un producto técnico real y utilizable para desarrolladores, regístralo como producto de empresa:
     * 'name': Nombre del producto o archivo (ej: "epstein.md").
     * 'canonicalUrl': Si no hay link web en el texto, usa la URL de la empresa/creador o el enlace del tweet de origen.
     * 'category': "Empresas & Productos".
     * 'entryType': "product_showcase".
     * 'company': Nombre de la empresa o cuenta creadora (ej: "Shipper").
     * 'tags': Incluye etiquetas relevantes como 'showcase', 'design', etc.
   - Si el tweet es simplemente opinión personal, meme, polémica o discusión sin producto técnico concreto detrás, devuelve un arreglo vacío 'tools': [].

6. REGLA DE ORO DE PRIORIDAD: GITHUB/GITLAB SIEMPRE TIENE PRIORIDAD SOBRE LANDING PAGES:
   - Si una herramienta cuenta con un REPOSITORIO DE CÓDIGO (GitHub o GitLab) y TAMBIÉN con una página web promocional o landing page comercial (ej: "voice-pro.ai", lander, etc.):
     * 'canonicalUrl' DEBE SER SIEMPRE EL ENLACE AL REPOSITORIO DE GITHUB/GITLAB (ej: "https://github.com/abus-aikorea/voice-pro"). A los desarrolladores les interesa ver el código fuente, estrellas, issues y documentación del repo.
     * Si además tiene un sitio web oficial, asígnalo en el campo 'websiteUrl' (ej: "https://voice-pro.ai").
     * NUNCA elijas un enlace a una landing page comercial o con redirecciones (/lander) como 'canonicalUrl' si existe un repositorio de código disponible.

7. DISTINCIÓN IMPORTANTE ENTRE CATEGORÍAS DE IA Y CREATIVIDAD:
   - "Prompts, Art & Video": Selecciona esta categoría para catálogos o colecciones de prompts, estilos artísticos o cinematográficos para video/imagen, Claude Code skills de diseño o estilos (ej. "lemo-opuscar"), prompts para agentes creativos, herramientas de arte generativo y animación en código.
   - "AI & Machine Learning": Reserva esta categoría estrictamente para modelos de base, motores de inferencia (DeepInfer, vLLM), entrenamiento, PyTorch, TensorFlow, embeddings, RAG o infraestructura técnica de ML.

Categorías válidas (selecciona EXACTAMENTE una para cada herramienta):
${ALLOWED_CATEGORIES.map((c) => `- "${c}"`).join('\n')}

Debes responder EXCLUSIVAMENTE en formato JSON con la siguiente estructura:
{
  "tools": [
    {
      "name": "Nombre claro y conciso",
      "canonicalUrl": "https://github.com/... (priorizar repo de GitHub/GitLab)",
      "websiteUrl": "https://... (web oficial si existe)",
      "category": "Una de las categorías válidas listadas arriba",
      "entryType": "tool o product_showcase",
      "company": "Nombre de la empresa si aplica",
      "tags": ["tag1", "tag2", "tag3"],
      "oneLiner": "Resumen conciso en español de 1-2 oraciones explicando para qué sirve",
      "keyHighlights": ["Punto clave 1", "Punto clave 2"],
      "recommendedNotes": "Una sugerencia técnica breve en español"
    }
  ]
}
`;
}

function normalizeRawOutput(parsedList: any[], urls: string[]): ClassificationResult[] {
  if (!Array.isArray(parsedList) || parsedList.length === 0) {
    return [];
  }

  return parsedList.map((parsed: any, index: number) => {
    const validCategory = ALLOWED_CATEGORIES.includes(parsed.category as ToolCategory)
      ? (parsed.category as ToolCategory)
      : 'Other';

    let url = (parsed.canonicalUrl || urls[index] || urls[0] || '').trim();
    if (url === 'undefined' || url === 'null') {
      url = (urls[index] || urls[0] || '').trim();
    }
    url = cleanTrackingParams(url);
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    if (!url || url === 'https://undefined' || url === 'https://null') {
      url = urls[0] || '';
    }

    let websiteUrl = parsed.websiteUrl ? cleanTrackingParams(parsed.websiteUrl.trim()) : undefined;
    if (websiteUrl && !websiteUrl.startsWith('http://') && !websiteUrl.startsWith('https://')) {
      websiteUrl = `https://${websiteUrl}`;
    }

    // Doble validación: Si la URL resultante es un enlace social/comunitario ignorado (ej. Telegram), reemplazarlo
    if (isIgnoredNonToolUrl(url)) {
      const validCandidate = urls.find((u) => !isIgnoredNonToolUrl(u));
      url = validCandidate || '';
    }

    // Si la URL elegida no es GitHub pero el websiteUrl sí es GitHub, invertirlos para que GitHub sea canonicalUrl
    if (!url.includes('github.com') && websiteUrl?.includes('github.com')) {
      const temp = url;
      url = websiteUrl;
      websiteUrl = temp;
    }

    const isShowcase =
      parsed.entryType === 'product_showcase' ||
      validCategory === 'Empresas & Productos' ||
      Boolean(parsed.company && !url.includes('github.com'));

    return {
      name: parsed.name || 'Nueva Herramienta',
      canonicalUrl: url,
      websiteUrl,
      category: validCategory,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: string) => t.toLowerCase()) : [],
      oneLiner: parsed.oneLiner || 'Herramienta guardada de X.',
      keyHighlights: Array.isArray(parsed.keyHighlights) ? parsed.keyHighlights : [],
      recommendedNotes: parsed.recommendedNotes || '',
      entryType: isShowcase ? 'product_showcase' : 'tool',
      company: parsed.company || undefined,
    };
  });
}

// -------------------------------------------------------------
// 1. Google Gemini (Proveedor Principal)
// -------------------------------------------------------------
async function tryGemini(params: ClassifyInput): Promise<ClassificationResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildUserPrompt(params);

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: Type.ARRAY,
        description: 'Lista de herramientas técnicas encontradas',
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            canonicalUrl: { type: Type.STRING },
            websiteUrl: { type: Type.STRING },
            category: { type: Type.STRING },
            entryType: { type: Type.STRING },
            company: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            oneLiner: { type: Type.STRING },
            keyHighlights: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedNotes: { type: Type.STRING },
          },
          required: ['name', 'canonicalUrl', 'category', 'tags', 'oneLiner', 'keyHighlights'],
        },
      },
    },
  });

  const parsed = JSON.parse(response.text || '[]');
  return normalizeRawOutput(parsed, params.urls);
}

// -------------------------------------------------------------
// Utilidad para extraer y parsear JSON de forma robusta
// (maneja bloques ```json ... ``` y texto envolvente)
// -------------------------------------------------------------
function parseJsonSafely(text: string): any {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');

    if (firstBrace !== -1 && lastBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } else if (firstBracket !== -1 && lastBracket !== -1) {
      return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
    }
    throw err;
  }
}

// -------------------------------------------------------------
// Función genérica para proveedores compatibles con OpenAI
// (ZenMux, Groq, OpenRouter, OpenAI, DeepSeek, Ollama)
// -------------------------------------------------------------
async function callOpenAICompatible(options: {
  providerName: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  prompt: string;
  headers?: Record<string, string>;
}): Promise<any[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (options.apiKey) {
    headers['Authorization'] = `Bearer ${options.apiKey}`;
  }

  const payload: any = {
    model: options.model,
    messages: [
      {
        role: 'system',
        content:
          'Eres un clasificador experto de herramientas de desarrollo. Responde SIEMPRE en formato JSON válido con la propiedad "tools": []. No incluyas explicaciones ni texto fuera del JSON.',
      },
      { role: 'user', content: options.prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  };

  let res = await fetch(options.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  // Si el proxy o modelo no soporta response_format: { type: 'json_object' } (ej. ciertos modelos Claude/MiniMax)
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    const errorBody = await res.text();
    if (
      errorBody.toLowerCase().includes('response_format') ||
      errorBody.toLowerCase().includes('json_object')
    ) {
      delete payload.response_format;
      res = await fetch(options.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } else {
      throw new Error(`[${options.providerName}] HTTP ${res.status}: ${errorBody.slice(0, 180)}`);
    }
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`[${options.providerName}] HTTP ${res.status}: ${errorBody.slice(0, 180)}`);
  }

  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content?.trim();
  if (!rawText) throw new Error(`[${options.providerName}] Respuesta vacía`);

  const parsed = parseJsonSafely(rawText);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.tools)) return parsed.tools;
  if (Array.isArray(parsed.items)) return parsed.items;
  return [parsed];
}

// -------------------------------------------------------------
// ZenMux Gateway (https://zenmux.ai)
// Admite Claude Haiku, MiniMax 3.1, DeepSeek Flash, etc.
// -------------------------------------------------------------
function getZenMuxEndpoint(): string {
  const base = (process.env.ZENMUX_BASE_URL || 'https://zenmux.ai/api/v1').replace(/\/$/, '');
  return `${base}/chat/completions`;
}

// ZenMux - DeepSeek Flash
async function tryZenMuxDeepSeek(params: ClassifyInput): Promise<ClassificationResult[]> {
  const apiKey = process.env.ZENMUX_DEEPSEEK_KEY || process.env.ZENMUX_API_KEY;
  if (!apiKey) throw new Error('ZENMUX_API_KEY / ZENMUX_DEEPSEEK_KEY no configurada');

  const model = process.env.ZENMUX_DEEPSEEK_MODEL || 'deepseek/deepseek-v4.1-flash';
  const raw = await callOpenAICompatible({
    providerName: `ZenMux (${model})`,
    endpoint: getZenMuxEndpoint(),
    apiKey,
    model,
    prompt: buildUserPrompt(params),
  });

  return normalizeRawOutput(raw, params.urls);
}

// ZenMux - Claude Haiku (5.5)
async function tryZenMuxClaude(params: ClassifyInput): Promise<ClassificationResult[]> {
  const apiKey = process.env.ZENMUX_CLAUDE_KEY || process.env.ZENMUX_API_KEY;
  if (!apiKey) throw new Error('ZENMUX_API_KEY / ZENMUX_CLAUDE_KEY no configurada');

  const model = process.env.ZENMUX_CLAUDE_MODEL || 'anthropic/claude-haiku-5.5';
  const raw = await callOpenAICompatible({
    providerName: `ZenMux (${model})`,
    endpoint: getZenMuxEndpoint(),
    apiKey,
    model,
    prompt: buildUserPrompt(params),
  });

  return normalizeRawOutput(raw, params.urls);
}

// ZenMux - MiniMax (3.1 Flash)
async function tryZenMuxMiniMax(params: ClassifyInput): Promise<ClassificationResult[]> {
  const apiKey = process.env.ZENMUX_MINIMAX_KEY || process.env.ZENMUX_API_KEY;
  if (!apiKey) throw new Error('ZENMUX_API_KEY / ZENMUX_MINIMAX_KEY no configurada');

  const model = process.env.ZENMUX_MINIMAX_MODEL || 'minimax/minimax-m3.1-flash';
  const raw = await callOpenAICompatible({
    providerName: `ZenMux (${model})`,
    endpoint: getZenMuxEndpoint(),
    apiKey,
    model,
    prompt: buildUserPrompt(params),
  });

  return normalizeRawOutput(raw, params.urls);
}

// ZenMux - General (con ZENMUX_API_KEY y modelo personalizado)
async function tryZenMuxGeneral(params: ClassifyInput): Promise<ClassificationResult[]> {
  const apiKey = process.env.ZENMUX_API_KEY;
  if (!apiKey) throw new Error('ZENMUX_API_KEY no configurada');

  const model = process.env.ZENMUX_MODEL || 'deepseek/deepseek-v4.1-flash';
  const raw = await callOpenAICompatible({
    providerName: `ZenMux (${model})`,
    endpoint: getZenMuxEndpoint(),
    apiKey,
    model,
    prompt: buildUserPrompt(params),
  });

  return normalizeRawOutput(raw, params.urls);
}

// DeepSeek Directo (api.deepseek.com)
async function tryDeepSeekDirect(params: ClassifyInput): Promise<ClassificationResult[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY no configurada');

  const raw = await callOpenAICompatible({
    providerName: 'DeepSeek Directo',
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKey,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    prompt: buildUserPrompt(params),
  });

  return normalizeRawOutput(raw, params.urls);
}

// -------------------------------------------------------------
// 2. Groq (Llama 3.3 70B - Nivel gratuito ultra rápido)
// -------------------------------------------------------------
async function tryGroq(params: ClassifyInput): Promise<ClassificationResult[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY no configurada');

  const raw = await callOpenAICompatible({
    providerName: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    prompt: buildUserPrompt(params),
  });

  return normalizeRawOutput(raw, params.urls);
}

// -------------------------------------------------------------
// 3. OpenRouter (Cientos de modelos / Modelos libres)
// -------------------------------------------------------------
async function tryOpenRouter(params: ClassifyInput): Promise<ClassificationResult[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY no configurada');

  const raw = await callOpenAICompatible({
    providerName: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey,
    model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
    prompt: buildUserPrompt(params),
    headers: {
      'HTTP-Referer': 'https://github.com/AlexiP18/awesome-dev-toolkit',
      'X-Title': 'Awesome Dev Toolkit',
    },
  });

  return normalizeRawOutput(raw, params.urls);
}

// -------------------------------------------------------------
// 4. OpenAI (GPT-4o-mini)
// -------------------------------------------------------------
async function tryOpenAI(params: ClassifyInput): Promise<ClassificationResult[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada');

  const raw = await callOpenAICompatible({
    providerName: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    prompt: buildUserPrompt(params),
  });

  return normalizeRawOutput(raw, params.urls);
}

// -------------------------------------------------------------
// 5. Ollama (Modelos Locales - 100% offline y sin cuotas)
// -------------------------------------------------------------
async function tryOllama(params: ClassifyInput): Promise<ClassificationResult[]> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  const raw = await callOpenAICompatible({
    providerName: 'Ollama',
    endpoint: `${baseUrl}/v1/chat/completions`,
    model: process.env.OLLAMA_MODEL || 'llama3.2',
    prompt: buildUserPrompt(params),
  });

  return normalizeRawOutput(raw, params.urls);
}

// -------------------------------------------------------------
// ORQUESTADOR CON CASCADA MULTI-PROVEEDOR
// -------------------------------------------------------------
export async function classifyWithProviderCascade(
  params: ClassifyInput
): Promise<{ results: ClassificationResult[]; providerUsed: string }> {
  const providers = [
    // 1. Google Gemini (Principal)
    { name: 'Google Gemini (3.8 Flash)', fn: tryGemini, hasKey: () => Boolean(process.env.GEMINI_API_KEY) },

    // Modelo personalizado de ZenMux (si se especifica ZENMUX_MODEL explícitamente)
    ...(process.env.ZENMUX_MODEL
      ? [
          {
            name: `ZenMux (${process.env.ZENMUX_MODEL})`,
            fn: tryZenMuxGeneral,
            hasKey: () => Boolean(process.env.ZENMUX_API_KEY),
          },
        ]
      : []),

    // 2. ZenMux - DeepSeek v4.1 Flash
    {
      name: 'ZenMux (DeepSeek v4.1 Flash)',
      fn: tryZenMuxDeepSeek,
      hasKey: () => Boolean(process.env.ZENMUX_DEEPSEEK_KEY || process.env.ZENMUX_API_KEY),
    },

    // 3. ZenMux - Claude Haiku 5.5
    {
      name: 'ZenMux (Claude Haiku 5.5)',
      fn: tryZenMuxClaude,
      hasKey: () => Boolean(process.env.ZENMUX_CLAUDE_KEY || process.env.ZENMUX_API_KEY),
    },

    // 4. ZenMux - MiniMax 3.1 Flash
    {
      name: 'ZenMux (MiniMax 3.1 Flash)',
      fn: tryZenMuxMiniMax,
      hasKey: () => Boolean(process.env.ZENMUX_MINIMAX_KEY || process.env.ZENMUX_API_KEY),
    },

    // 6. DeepSeek Directo
    { name: 'DeepSeek Directo', fn: tryDeepSeekDirect, hasKey: () => Boolean(process.env.DEEPSEEK_API_KEY) },

    // 7. Groq (Llama 3.3)
    { name: 'Groq (Llama 3.3)', fn: tryGroq, hasKey: () => Boolean(process.env.GROQ_API_KEY) },

    // 8. OpenRouter
    { name: 'OpenRouter', fn: tryOpenRouter, hasKey: () => Boolean(process.env.OPENROUTER_API_KEY) },

    // 9. OpenAI (GPT-4o-mini)
    { name: 'OpenAI (GPT-4o-mini)', fn: tryOpenAI, hasKey: () => Boolean(process.env.OPENAI_API_KEY) },

    // 10. Ollama (Local)
    { name: 'Ollama (Local)', fn: tryOllama, hasKey: () => Boolean(process.env.OLLAMA_BASE_URL) },
  ];

  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.hasKey()) continue;

    try {
      console.log(`[IA] Intentando clasificar con: ${provider.name}...`);
      const results = await provider.fn(params);
      console.log(`[IA] ✅ Éxito con proveedor: ${provider.name} (${results.length} herramientas identificadas)`);
      return { results, providerUsed: provider.name };
    } catch (err: any) {
      console.warn(`[IA] ⚠️ Falló ${provider.name}: ${err?.message || err}. Probando siguiente proveedor...`);
      errors.push(`${provider.name}: ${err?.message || err}`);
    }
  }

  // Si ninguno estaba configurado o todos fallaron
  console.warn(
    `[IA Fallback] Ningún proveedor de IA tuvo éxito. Errores: ${errors.join(' | ')}. Usando fallback básico.`
  );

  const fallback = params.urls.length > 0
    ? params.urls.map((u) => ({
        name: params.githubMetas?.[u]?.name || u.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'Herramienta',
        canonicalUrl: u,
        category: (params.githubMetas?.[u]?.topics.includes('cli') ? 'CLI & Terminal' : 'Other') as ToolCategory,
        tags: params.githubMetas?.[u]?.topics.slice(0, 5) || ['dev', 'tool'],
        oneLiner: params.githubMetas?.[u]?.description || params.rawText.slice(0, 140),
        keyHighlights: params.githubMetas?.[u]?.language ? [`Escrito en ${params.githubMetas[u].language}`] : [],
        recommendedNotes: 'Importado en modo de respaldo (sin proveedor de IA activo).',
      }))
    : [];

  return { results: fallback, providerUsed: 'Fallback (Sin IA)' };
}
