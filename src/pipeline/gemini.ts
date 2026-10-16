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

export async function classifyToolWithGemini(params: {
  rawText: string;
  url: string;
  githubMeta?: GitHubMetadata | null;
}): Promise<ClassificationResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // Graceful fallback if user has not yet configured GEMINI_API_KEY
    console.warn('[Gemini] GEMINI_API_KEY is not set. Using sensible fallback classification.');
    return generateFallbackClassification(params);
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
Eres un asistente experto para desarrolladores de software encargado de clasificar recursos técnicos guardados de X/Twitter para un toolkit/segundo cerebro de desarrollo.

Analiza el siguiente recurso y clasifícalo con precisión:
- Texto original del Tweet / Guardado: "${params.rawText}"
- URL canónica: "${params.url}"
${
  params.githubMeta
    ? `- Metadata de GitHub:
       * Nombre: ${params.githubMeta.name}
       * Descripción: ${params.githubMeta.description}
       * Lenguaje: ${params.githubMeta.language || 'N/A'}
       * Tópicos: ${params.githubMeta.topics.join(', ')}
       * Estrellas: ${params.githubMeta.stars}`
    : ''
}

Categorías válidas (debes seleccionar EXACTAMENTE una de estas):
${ALLOWED_CATEGORIES.map((c) => `- "${c}"`).join('\n')}

Genera el resultado en formato JSON cumpliendo con el esquema requerido.
Asegúrate de que 'oneLiner', 'keyHighlights' y 'recommendedNotes' estén redactados en ESPAÑOL, con tono técnico, claro y orientado a la utilidad práctica para un programador.
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Nombre claro y conciso de la herramienta o repositorio',
            },
            canonicalUrl: {
              type: Type.STRING,
              description: 'URL canónica o principal',
            },
            category: {
              type: Type.STRING,
              description: 'Categoría a la que pertenece la herramienta',
            },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 a 6 etiquetas relevantes en minúsculas (ej: rust, terminal, react)',
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
    });

    const parsed = JSON.parse(response.text || '{}');

    const validCategory = ALLOWED_CATEGORIES.includes(parsed.category as ToolCategory)
      ? (parsed.category as ToolCategory)
      : 'Other';

    return {
      name: parsed.name || (params.githubMeta?.name ?? 'Nueva Herramienta'),
      canonicalUrl: parsed.canonicalUrl || params.url,
      category: validCategory,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: string) => t.toLowerCase()) : [],
      oneLiner: parsed.oneLiner || params.githubMeta?.description || 'Herramienta guardada de X.',
      keyHighlights: Array.isArray(parsed.keyHighlights) ? parsed.keyHighlights : [],
      recommendedNotes: parsed.recommendedNotes || '',
    };
  } catch (err) {
    console.error('[Gemini] Error classifying tool, falling back:', err);
    return generateFallbackClassification(params);
  }
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
