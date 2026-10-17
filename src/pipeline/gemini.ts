import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { ClassificationResult, ToolCategory } from './types.js';
import { GitHubMetadata } from './github.js';

dotenv.config();

const ALLOWED_CATEGORIES: ToolCategory[] = [
  'CLI & Terminal',
  'Frontend & UI',
  'Backend & APIs',
  'DevOps & Cloud',
  'AI & Machine Learning',
  'Databases & Storage',
  'Productivity & Tools',
  'Documentation & Resources',
  'Other',
];

export async function classifyToolsWithGemini(params: {
  rawText: string;
  urls: string[];
  githubMetas?: Record<string, GitHubMetadata>;
}): Promise<ClassificationResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[Gemini] GEMINI_API_KEY is not set. Using sensible fallback classification.');
    return params.urls.length > 0
      ? params.urls.map((u) =>
          generateFallbackClassification({
            rawText: params.rawText,
            url: u,
            githubMeta: params.githubMetas?.[u],
          })
        )
      : [generateFallbackClassification({ rawText: params.rawText, url: '' })];
  }

  const ai = new GoogleGenAI({ apiKey });

  const githubInfoList = Object.entries(params.githubMetas || {})
    .map(
      ([url, meta]) =>
        `  * [${url}] -> Nombre: ${meta.name}, Desc: ${meta.description}, Lenguaje: ${
          meta.language || 'N/A'
        }, Tópicos: ${meta.topics.join(', ')}, Estrellas: ${meta.stars}`
    )
    .join('\n');

  const prompt = `
Eres un asistente experto para desarrolladores de software encargado de clasificar recursos técnicos guardados de X/Twitter para un toolkit/segundo cerebro de desarrollo.

Analiza el siguiente tweet o texto guardado:
- Texto original del Tweet / Guardado:
"""
${params.rawText}
"""
- Enlaces detectados y resueltos:
${params.urls.length > 0 ? params.urls.map((u) => `  * ${u}`).join('\n') : '  (Ninguno explícito, infiérelos del texto si aparecen dominios como sitio.com, herramienta.io, etc.)'}
${githubInfoList ? `- Metadata de GitHub:\n${githubInfoList}` : ''}

REGLA MUY IMPORTANTE PARA TWEETS CON MÚLTIPLES HERRAMIENTAS:
- Si el tweet es una lista o menciona MÚLTIPLES herramientas, sitios web o repositorios distintos (por ejemplo: "1. jiro.build ... 2. godly.website ... 3. awwwards.com ..."), DEBES extraer y devolver CADA UNA de las herramientas como un objeto independiente dentro del arreglo JSON.
- Si el texto menciona un dominio sin "https://" (por ejemplo "jiro.build" o "mobbin.com"), asegúrate de que su 'canonicalUrl' incluya el protocolo completo (ej. "https://jiro.build").
- Si el tweet trata sobre UNA SOLA herramienta, devuelve un arreglo con ese único elemento.

Categorías válidas (selecciona EXACTAMENTE una para cada herramienta):
${ALLOWED_CATEGORIES.map((c) => `- "${c}"`).join('\n')}

Genera el resultado en formato JSON (arreglo de herramientas) cumpliendo con el esquema requerido.
Asegúrate de que 'oneLiner', 'keyHighlights' y 'recommendedNotes' estén redactados en ESPAÑOL, con tono técnico, claro y orientado a la utilidad práctica para un desarrollador.
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: Type.ARRAY,
          description: 'Lista de todas las herramientas o recursos técnicos encontrados en el tweet',
          items: {
            type: Type.OBJECT,
            properties: {
              name: {
                type: Type.STRING,
                description: 'Nombre claro y conciso de la herramienta o repositorio',
              },
              canonicalUrl: {
                type: Type.STRING,
                description: 'URL canónica completa comenzando con https://',
              },
              category: {
                type: Type.STRING,
                description: 'Categoría a la que pertenece la herramienta',
              },
              tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 a 6 etiquetas relevantes en minúsculas (ej: ui, design, rust, cli)',
              },
              oneLiner: {
                type: Type.STRING,
                description: 'Resumen conciso en español de 1-2 oraciones explicando para qué sirve',
              },
              keyHighlights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2 a 4 puntos clave o características destacadas en español',
              },
              recommendedNotes: {
                type: Type.STRING,
                description: 'Una sugerencia de uso o nota técnica rápida en español',
              },
            },
            required: ['name', 'canonicalUrl', 'category', 'tags', 'oneLiner', 'keyHighlights'],
          },
        },
      },
    });

    const parsedList = JSON.parse(response.text || '[]');
    if (!Array.isArray(parsedList) || parsedList.length === 0) {
      throw new Error('Gemini returned an empty array');
    }

    return parsedList.map((parsed: any, index: number) => {
      const validCategory = ALLOWED_CATEGORIES.includes(parsed.category as ToolCategory)
        ? (parsed.category as ToolCategory)
        : 'Other';

      let url = (parsed.canonicalUrl || params.urls[index] || params.urls[0] || '').trim();
      if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      return {
        name: parsed.name || 'Nueva Herramienta',
        canonicalUrl: url,
        category: validCategory,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: string) => t.toLowerCase()) : [],
        oneLiner: parsed.oneLiner || 'Herramienta guardada de X.',
        keyHighlights: Array.isArray(parsed.keyHighlights) ? parsed.keyHighlights : [],
        recommendedNotes: parsed.recommendedNotes || '',
      };
    });
  } catch (err) {
    console.error('[Gemini] Error classifying tools, falling back:', err);
    return params.urls.length > 0
      ? params.urls.map((u) =>
          generateFallbackClassification({
            rawText: params.rawText,
            url: u,
            githubMeta: params.githubMetas?.[u],
          })
        )
      : [generateFallbackClassification({ rawText: params.rawText, url: '' })];
  }
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

function generateFallbackClassification(params: {
  rawText: string;
  url: string;
  githubMeta?: GitHubMetadata | null;
}): ClassificationResult {
  const name =
    params.githubMeta?.name ||
    params.url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ||
    'Herramienta';

  return {
    name,
    canonicalUrl: params.url,
    category: params.githubMeta?.topics.includes('cli') ? 'CLI & Terminal' : 'Other',
    tags: params.githubMeta?.topics.slice(0, 5) || ['dev', 'tool'],
    oneLiner: params.githubMeta?.description || params.rawText.slice(0, 140),
    keyHighlights: params.githubMeta?.language ? [`Escrito en ${params.githubMeta.language}`] : [],
    recommendedNotes: 'Importado automáticamente sin IA.',
  };
}
