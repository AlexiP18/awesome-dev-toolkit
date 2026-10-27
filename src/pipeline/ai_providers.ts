import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { ClassificationResult, ToolCategory, EntryType } from './types.js';
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
  'Productos Tecnológicos & Hardware',
  'Consejos & Buenas Prácticas',
  'Trabajo & Freelance',
  'Other',
];

export interface ClassifyInput {
  rawText: string;
  urls: string[];
  sourceTweet?: string;
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
${params.sourceTweet ? `- Tweet de origen: ${params.sourceTweet}\n` : ''}- Enlaces detectados y resueltos:
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

7. DISTINCIÓN IMPORTANTE ENTRE CATEGORÍAS (Frontend & UI vs Prompts, Art & Video vs AI & Machine Learning):
   - "Frontend & UI": Asigna esta categoría a herramientas, repositorios, bibliotecas, componentes, design systems, plantillas web, y skills o utilidades para agentes de código dedicadas a diseñar, maquetar, estructurar o mejorar interfaces de usuario y páginas web (ej. "taste-skill", skills de UI/UX, Tailwind, CSS, React, inspectores de frontend). Todo lo enfocado en que el código o la UI web sea atractiva, profesional y funcional pertenece aquí.
   - "Prompts, Art & Video": Reserva esta categoría EXCLUSIVAMENTE para generación de video (ffmpeg, clips cinematográficos como "lemo-opuscar", Sora, Runway, Kling), arte visual 3D procedural/shaders, generadores de música/audio o catálogos de prompts para generadores de imágenes (Midjourney, DALL-E). NUNCA la uses para herramientas de diseño web, interfaces de usuario o componentes frontend.
   - "AI & Machine Learning": Reserva esta categoría estrictamente para modelos de base, motores de inferencia (DeepInfer, vLLM, Ollama), entrenamiento, PyTorch, TensorFlow, embeddings, RAG o infraestructura técnica de ML.

8. DETECCIÓN DE PROMOCIONES ACADÉMICAS O BENEFICIOS PARA ESTUDIANTES:
   - Si el tweet o recurso menciona promociones académicas, beneficios para estudiantes o profesores, licencias gratis con correo universitario (.edu o institucional), inclusión en GitHub Student Developer Pack, o descuentos educativos:
     * 'hasAcademicPromo': true
     * 'academicPromoDetails': Descripción breve del beneficio (ej. "Gratis para estudiantes con correo .edu o GitHub Student Developer Pack", "Descuento del 50% para estudiantes").
     * Añade etiquetas relevantes a 'tags' (ej: "educacion", "estudiantes").
   - Si no hay mención ni evidencia de beneficios académicos, establece 'hasAcademicPromo': false y 'academicPromoDetails': null.

9. REGLA ESTRICTA DE INTEGRIDAD DE ENLACES (PROHIBIDO ALUCINAR O ALTERAR URLs):
   - Si en la sección 'Enlaces detectados y resueltos' arriba se lista una URL de repositorio (ej. "https://github.com/lemomo-ai/lemo-opuscar"):
     * 'canonicalUrl' DEBE SER EXACTAMENTE ESA URL DETECTADA.
     * ESTÁ ESTRICTAMENTE PROHIBIDO modificar, cambiar o abreviar letras del dueño u organización (ej. NUNCA cambies 'lemomo-ai' por 'lemo-ai').
     * Copia la URL exacta de la lista de enlaces detectados carácter por carácter.

10. TWEETS DE CONSEJOS TÉCNICOS, TRUCOS O BUENAS PRÁCTICAS EN DIFERENTES ÁREAS ('tech_tip'):
   - Si el tweet comparte consejos prácticos, trucos o buenas prácticas técnicas (ej: comandos útiles de Docker o Git, trucos de CSS/React, optimización de consultas SQL, patrones de diseño de APIs, atajos de terminal, reglas de arquitectura o tips de debugging):
     * 'name': Título descriptivo y conciso del consejo o técnica (ej: "Optimización de Pools de Conexión en PostgreSQL", "Multi-stage Builds Eficientes en Docker", "Patrón Compound Components en React").
     * 'canonicalUrl': Si el tweet incluye un enlace de referencia técnica o documentación, úsalo. Si NO tiene ningún enlace externo, usa el tweet de origen o déjalo vacío para que se asocie al tweet.
     * 'category': Asigna el área técnica correspondiente (ej: 'DevOps & Cloud' para Docker/K8s/CI, 'Databases & Storage' para SQL/Postgres, 'Frontend & UI' para React/CSS/Tailwind, 'Backend & APIs' para NodeJS/APIs, 'CLI & Terminal' para bash/git). Si es un consejo general de ingeniería de software o no encaja en una específica, usa 'Consejos & Buenas Prácticas'.
     * 'entryType': "tech_tip".
     * 'oneLiner': Resumen conciso y claro en español del consejo y su utilidad práctica.
     * 'keyHighlights': Pasos, comandos clave o puntos esenciales del truco explicados claramente.
     * 'recommendedNotes': Ejemplo práctico de cuándo aplicarlo, consideraciones o advertencias técnicas.
     * 'tags': Incluye etiquetas técnicas relevantes (ej: ["docker", "devops", "tips"], ["postgresql", "sql", "performance"], ["react", "frontend", "patterns"]).

10.1. TWEETS DE HILOS TÉCNICOS, SECUENCIAS DE PROMPTS O GUÍAS PASO A PASO ('tech_tip'):
   - Si el tweet o texto representa un HILO con múltiples pasos, recomendaciones o prompts (ej: '1) El diagnóstico de la conexión...', '2) Los ladrones de ancho de banda...', prompts para Claude/ChatGPT, o guías técnicas secuenciales):
     * 'name': Título conciso del hilo (ej: 'Claude Desktop: 7 Prompts para Diagnosticar y Acelerar tu Red WiFi').
     * 'canonicalUrl': Si el tweet incluye un enlace externo de herramienta o repositorio, úsalo. Si NO tiene link externo, usa el tweet de origen o URL del tweet.
     * 'category': 'Consejos & Buenas Prácticas' o la categoría más afín a la temática.
     * 'entryType': "tech_tip".
     * 'oneLiner': Resumen claro en español del objetivo del hilo y qué problema soluciona.
     * 'keyHighlights': DEBES extraer CADA UNO de los prompts, pasos o recomendaciones del hilo como un elemento independiente dentro de 'keyHighlights', manteniendo el título del paso y el texto del prompt exacto.
     * 'recommendedNotes': Explicación de cómo aplicar estos prompts y requisitos técnicos.
     * 'tags': Incluye etiquetas como 'prompts', 'tips', 'hilo', y las herramientas mencionadas (ej. 'claude', 'wifi', 'networking').

11. TWEETS DE TRABAJO, EMPLEO REMOTO O FREELANCE ('job_remote'):
   - Si el tweet comparte ofertas de trabajo remoto, vacantes, convocatorias de contratación (hiring), oportunidades freelance, bolsas de empleo remoto, plataformas freelance (ej: RemoteOK, We Work Remotely, Torre, Contra, Upwork), guías de tarifas freelance, plantillas de contratos para desarrolladores o consejos específicos para conseguir trabajo remoto:
     * 'name': Título descriptivo de la posición, plataforma o recurso (ej: "Senior Frontend Engineer (Remoto LATAM)", "Remotive - Directorio de Empleos Remotos", "Plantilla de Propuesta Freelance para Desarrolladores").
     * 'canonicalUrl': Enlace directo para postular, web oficial de la plataforma/empresa o documentación. Si el tweet no incluye link externo, usa el enlace del tweet de origen.
     * 'category': "Trabajo & Freelance".
     * 'entryType': "job_remote".
     * 'company': Nombre de la empresa, startup o cliente contratante (si se especifica).
     * 'location': Modalidad y región geográfica (ej: "Remoto (Mundial)", "Remoto (LATAM)", "Remoto (EE.UU.)", "Híbrido").
     * 'salary': Salario o tarifa si se menciona explícitamente (ej: "$50k - $70k USD/año", "$35 - $50 USD/h", o null).
     * 'tags': Etiquetas relevantes como 'remoto', 'freelance', 'trabajo', 'frontend', 'backend', etc.
     * 'oneLiner': Resumen conciso del puesto, plataforma o recurso laboral y a quién va dirigido.
     * 'keyHighlights': Requisitos técnicos clave, stack exigido, beneficios (equity, vacaciones, hardware) o ventajas de la plataforma.
     * 'recommendedNotes': Consejos para aplicar, requisitos de nivel de inglés o recomendaciones para la postulación.

12. TWEETS DE PRODUCTOS TECNOLÓGICOS Y HARDWARE ('tech_product'):
   - Asigna 'tech_product' y la categoría "Productos Tecnológicos & Hardware" ÚNICA Y EXCLUSIVAMENTE si el tweet presenta productos tecnológicos FÍSICOS, hardware tangible, gadgets para desarrolladores, microcontroladores, placas de desarrollo (Raspberry Pi, ESP32, Arduino), laptops/computadoras de desarrollo, periféricos (teclados mecánicos, pantallas), chips/procesadores o dispositivos de IA física.
   - REGLA DE ORO DE HARDWARE VS SOFTWARE: Un repositorio de código en GitHub o GitLab (ej. "https://github.com/..."), biblioteca npm, skill de agente de código, script o software NUNCA es un producto de hardware físico. Todo repositorio de código o software es SIEMPRE 'tool' (Herramienta).
   - Para hardware real:
     * 'name': Nombre del producto tecnológico o dispositivo (ej: "Raspberry Pi 5", "Framework Laptop 16", "Flipper Zero", "ESP32-S3 DevKit", "Keychron Q1 Pro").
     * 'canonicalUrl': Enlace a la tienda oficial, página de producto o documentación técnica. Si no hay link externo, usa el enlace del tweet de origen.
     * 'category': "Productos Tecnológicos & Hardware".
     * 'entryType': "tech_product".
     * 'company': Fabricante, marca o creador (ej: "Raspberry Pi", "Framework", "Apple", "Espressif", "Keychron").
     * 'price': Precio o coste si se menciona (ej: "$80 USD", "€35", etc.) o null.
     * 'tags': Etiquetas relevantes como 'hardware', 'gadgets', 'iot', 'electronics', 'peripherals', etc.
     * 'oneLiner': Resumen claro de qué es el producto, sus especificaciones más llamativas y para qué desarrollador/maker está pensado.
     * 'keyHighlights': Especificaciones técnicas destacadas (procesador, RAM, puertos, conectividad, consumo, compatibilidad).
     * 'recommendedNotes': Casos de uso ideales, disponibilidad o compatibilidad.

Categorías válidas (selecciona EXACTAMENTE una para cada herramienta):
${ALLOWED_CATEGORIES.map((c) => `- "${c}"`).join('\n')}

Debes responder EXCLUSIVAMENTE en formato JSON con la siguiente estructura:
{
  "tools": [
    {
      "name": "Nombre claro y conciso",
      "canonicalUrl": "https://github.com/... (priorizar repo de GitHub/GitLab, o enlace/tweet de referencia/postulación/producto)",
      "websiteUrl": "https://... (web oficial si existe)",
      "category": "Una de las categorías válidas listadas arriba",
      "entryType": "tool, tech_product, tech_tip o job_remote",
      "company": "Nombre del fabricante o empresa si aplica",
      "location": "Modalidad o región (ej: Remoto (Mundial), Remoto (LATAM)) o null",
      "salary": "Compensación o tarifa si se menciona (ej: $60k-$80k USD) o null",
      "price": "Precio o coste del producto/hardware si se menciona o null",
      "tags": ["tag1", "tag2", "tag3"],
      "oneLiner": "Resumen conciso en español de 1-2 oraciones explicando para qué sirve, el puesto o recurso",
      "keyHighlights": ["Punto clave o paso 1", "Punto clave o paso 2"],
      "recommendedNotes": "Una sugerencia técnica o de postulación breve en español",
      "hasAcademicPromo": false,
      "academicPromoDetails": "Detalles del beneficio para estudiantes o null"
    }
  ]
}
`;
}

function normalizeRawOutput(parsedList: any[], urls: string[], sourceTweet?: string): ClassificationResult[] {
  if (!Array.isArray(parsedList) || parsedList.length === 0) {
    return [];
  }

  return parsedList.map((parsed: any, index: number) => {
    let validCategory = ALLOWED_CATEGORIES.includes(parsed.category as ToolCategory)
      ? (parsed.category as ToolCategory)
      : 'Other';

    const isJob = parsed.entryType === 'job_remote' || validCategory === 'Trabajo & Freelance';
    const isTip = !isJob && (parsed.entryType === 'tech_tip' || validCategory === 'Consejos & Buenas Prácticas');

    let url = (parsed.canonicalUrl || urls[index] || urls[0] || ((isJob || isTip) ? sourceTweet : '') || '').trim();
    if (url === 'undefined' || url === 'null') {
      url = (urls[index] || urls[0] || ((isJob || isTip) ? sourceTweet : '') || '').trim();
    }
    url = cleanTrackingParams(url);
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    if (!url || url === 'https://undefined' || url === 'https://null') {
      url = urls[0] || ((isJob || isTip) ? sourceTweet : '') || '';
    }

    // PROTECCIÓN CONTRA ALUCINACIONES DE LA IA EN ENLACES DE GITHUB:
    // Si tenemos URLs detectadas en el tweet (ground truth), reconciliar url con las URLs reales:
    if (urls && urls.length > 0) {
      const ghMatch = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i);
      if (ghMatch) {
        const aiOwner = ghMatch[1].toLowerCase().replace(/[-_]/g, '');
        const aiRepo = ghMatch[2].toLowerCase().replace(/\.git$/, '').replace(/[-_]/g, '');

        // 1. Buscar primero coincidencia exacta del nombre del repositorio (ej. omniroute == omniroute)
        let exactCandidate = urls.find((c) => {
          const cMatch = c.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i);
          if (!cMatch) return false;
          const cRepo = cMatch[2].toLowerCase().replace(/\.git$/, '').replace(/[-_]/g, '');
          return cRepo.length >= 2 && cRepo === aiRepo;
        });

        // 2. Si no hubo coincidencia exacta de repo, buscar variación menor (exigiendo longitud >= 3 para evitar prefijos de 1 letra como "/O")
        if (!exactCandidate && aiRepo.length >= 3) {
          exactCandidate = urls.find((c) => {
            const cMatch = c.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i);
            if (!cMatch) return false;
            const cOwner = cMatch[1].toLowerCase().replace(/[-_]/g, '');
            const cRepo = cMatch[2].toLowerCase().replace(/\.git$/, '').replace(/[-_]/g, '');
            if (cRepo.length < 3) return false;
            if (cRepo.includes(aiRepo) || aiRepo.includes(cRepo)) {
              if (cOwner === aiOwner || cOwner.includes(aiOwner) || aiOwner.includes(cOwner)) return true;
            }
            return false;
          });
        }

        if (exactCandidate) {
          if (exactCandidate !== url) {
            console.log(
              `[Pipeline] 🛡️ Corrigiendo URL alucinada por la IA "${url}" por la URL verificada del tweet: "${exactCandidate}"`
            );
          }
          url = exactCandidate;
        } else if (urls.length === 1 && urls[0].includes('github.com')) {
          // Si solo había 1 URL de GitHub detectada en el tweet y la IA clasificó 1 sola herramienta:
          console.log(
            `[Pipeline] 🛡️ Vinculando con la URL verificada única del tweet: "${urls[0]}" (IA sugirió: "${url}")`
          );
          url = urls[0];
        }
      }
    }

    let websiteUrl = parsed.websiteUrl ? cleanTrackingParams(parsed.websiteUrl.trim()) : undefined;
    if (websiteUrl === 'null' || websiteUrl === 'undefined' || websiteUrl === '') {
      websiteUrl = undefined;
    }
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

    // Nunca guardar un enlace de GitHub/GitLab ni un enlace idéntico a canonicalUrl dentro de websiteUrl
    if (
      websiteUrl &&
      (websiteUrl.toLowerCase() === url.toLowerCase() ||
        websiteUrl.toLowerCase().includes('github.com') ||
        websiteUrl.toLowerCase().includes('gitlab.com') ||
        isIgnoredNonToolUrl(websiteUrl))
    ) {
      websiteUrl = undefined;
    }

    // Auto-corrección si la IA confunde un skill de UI o diseño web con "Prompts, Art & Video":
    if (validCategory === 'Prompts, Art & Video') {
      const allText = `${parsed.name || ''} ${parsed.oneLiner || ''} ${(parsed.tags || []).join(' ')} ${(parsed.keyHighlights || []).join(' ')} ${url}`.toLowerCase();
      if (
        /frontend|ui-design|web-design|design-system|landing-page|css|html|tailwind|interfaz|navegador|browser|taste-skill/i.test(allText) &&
        !/video|cinemat|film|ffmpeg|sora|runway|kling|clip/i.test(allText)
      ) {
        console.log(`[Pipeline] 🎨 Reclasificando "${parsed.name || url}" de "Prompts, Art & Video" a "Frontend & UI"`);
        validCategory = 'Frontend & UI';
      }
    }

    // Regla estricta: Un repositorio de código en GitHub o GitLab NUNCA es un producto de hardware físico, salvo que sea explícitamente hardware/firmware
    const isGhRepo = url.includes('github.com') || url.includes('gitlab.com');
    const isExplicitHardware = /hardware|gadget|placa|sbc|raspberry|esp32|arduino|microcontrolador|pcb|teclado mec[aá]nico|laptop/i.test(
      `${parsed.name || ''} ${parsed.oneLiner || ''} ${(parsed.tags || []).join(' ')}`
    );

    const isProduct = !isJob && !isTip && (!isGhRepo || isExplicitHardware) && (
      parsed.entryType === 'tech_product' ||
      validCategory === 'Productos Tecnológicos & Hardware'
    );

    const isShowcase =
      !isJob &&
      !isTip &&
      !isProduct &&
      (parsed.entryType === 'product_showcase' ||
        validCategory === 'Empresas & Productos' ||
        Boolean(parsed.company && !url.includes('github.com')));

    const entryType: EntryType = isJob
      ? 'job_remote'
      : isTip
      ? 'tech_tip'
      : isProduct
      ? 'tech_product'
      : isShowcase
      ? 'product_showcase'
      : 'tool';

    const hasAcademicPromo = Boolean(
      parsed.hasAcademicPromo === true ||
      parsed.has_academic_promo === true ||
      (Array.isArray(parsed.tags) && parsed.tags.some((t: string) => ['academic', 'academico', 'académico', 'estudiante', 'estudiantes', 'educacion', 'educación', 'student', 'students'].includes(t.toLowerCase())))
    );

    const academicPromoDetails = parsed.academicPromoDetails || parsed.academic_promo_details || undefined;

    return {
      name: parsed.name || (isJob ? 'Oportunidad / Recurso Laboral' : isTip ? 'Consejo Técnico' : isProduct ? 'Producto Tecnológico / Hardware' : 'Nueva Herramienta'),
      canonicalUrl: url,
      websiteUrl,
      category: validCategory,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: string) => t.toLowerCase()) : [],
      oneLiner: parsed.oneLiner || (isJob ? 'Oportunidad o recurso de trabajo remoto/freelance.' : isTip ? 'Consejo técnico guardado de X.' : isProduct ? 'Producto tecnológico o hardware de desarrollo.' : 'Herramienta guardada de X.'),
      keyHighlights: Array.isArray(parsed.keyHighlights) ? parsed.keyHighlights : [],
      recommendedNotes: parsed.recommendedNotes || '',
      entryType,
      company: parsed.company || undefined,
      location: parsed.location || undefined,
      salary: parsed.salary || undefined,
      price: parsed.price || undefined,
      jobType: parsed.jobType || (isJob ? 'remote_job' : undefined),
      hasAcademicPromo,
      academicPromoDetails,
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
  const targetModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const schemaConfig = {
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
          location: { type: Type.STRING },
          salary: { type: Type.STRING },
          price: { type: Type.STRING },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          oneLiner: { type: Type.STRING },
          keyHighlights: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendedNotes: { type: Type.STRING },
          hasAcademicPromo: { type: Type.BOOLEAN },
          academicPromoDetails: { type: Type.STRING },
        },
        required: ['name', 'canonicalUrl', 'category', 'tags', 'oneLiner', 'keyHighlights'],
      },
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: prompt,
      config: schemaConfig,
    });

    const parsed = JSON.parse(response.text || '[]');
    return normalizeRawOutput(parsed, params.urls, params.sourceTweet);
  } catch (err: any) {
    if (targetModel !== 'gemini-2.5-flash') {
      console.warn(`[Gemini] ${targetModel} falló (${err?.message || err}). Intentando respaldo inmediato con gemini-2.5-flash...`);
      const retryRes = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: schemaConfig,
      });
      const parsed = JSON.parse(retryRes.text || '[]');
      return normalizeRawOutput(parsed, params.urls, params.sourceTweet);
    }
    throw err;
  }
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

  return normalizeRawOutput(raw, params.urls, params.sourceTweet);
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

  return normalizeRawOutput(raw, params.urls, params.sourceTweet);
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

  return normalizeRawOutput(raw, params.urls, params.sourceTweet);
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

  return normalizeRawOutput(raw, params.urls, params.sourceTweet);
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

  return normalizeRawOutput(raw, params.urls, params.sourceTweet);
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

  return normalizeRawOutput(raw, params.urls, params.sourceTweet);
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

  return normalizeRawOutput(raw, params.urls, params.sourceTweet);
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

  return normalizeRawOutput(raw, params.urls, params.sourceTweet);
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

  return normalizeRawOutput(raw, params.urls, params.sourceTweet);
}

// -------------------------------------------------------------
// ORQUESTADOR CON CASCADA MULTI-PROVEEDOR
// Orden de prioridad configurado (Gemini por defecto):
// 1º Google Gemini (3.8 Flash)
// 2º DeepSeek (ZenMux o Directo)
// 3º MiniMax 3.1 Flash (ZenMux)
// 4º Claude Haiku / Groq / OpenRouter / OpenAI / Ollama
// -------------------------------------------------------------
export async function classifyWithProviderCascade(
  params: ClassifyInput,
  preferredProvider?: string
): Promise<{ results: ClassificationResult[]; providerUsed: string; switchNotice?: string }> {
  let providers = [
    // 1. Google Gemini (Flash) - Prioridad principal por defecto
    {
      id: 'gemini',
      name: 'Google Gemini (Flash)',
      fn: tryGemini,
      hasKey: () => Boolean(process.env.GEMINI_API_KEY),
    },

    // 2. DeepSeek (ZenMux v4.1 Flash o Directo)
    {
      id: 'deepseek',
      name: `ZenMux (${process.env.ZENMUX_DEEPSEEK_MODEL || 'deepseek/deepseek-v4.1-flash'})`,
      fn: tryZenMuxDeepSeek,
      hasKey: () => Boolean(process.env.ZENMUX_DEEPSEEK_KEY || process.env.ZENMUX_API_KEY),
    },
    {
      id: 'deepseek',
      name: `DeepSeek Directo (${process.env.DEEPSEEK_MODEL || 'deepseek-chat'})`,
      fn: tryDeepSeekDirect,
      hasKey: () => Boolean(process.env.DEEPSEEK_API_KEY),
    },

    // 3. MiniMax (3.1 Flash vía ZenMux)
    {
      id: 'minimax',
      name: `ZenMux (${process.env.ZENMUX_MINIMAX_MODEL || 'minimax/minimax-m3.1-flash'})`,
      fn: tryZenMuxMiniMax,
      hasKey: () => Boolean(process.env.ZENMUX_MINIMAX_KEY || process.env.ZENMUX_API_KEY),
    },

    // 4. ZenMux - Claude Haiku 5.5
    {
      id: 'claude',
      name: `ZenMux (${process.env.ZENMUX_CLAUDE_MODEL || 'anthropic/claude-haiku-5.5'})`,
      fn: tryZenMuxClaude,
      hasKey: () => Boolean(process.env.ZENMUX_CLAUDE_KEY || process.env.ZENMUX_API_KEY),
    },

    // Modelo personalizado de ZenMux (si se especifica ZENMUX_MODEL explícitamente)
    ...(process.env.ZENMUX_MODEL
      ? [
          {
            id: 'zenmux',
            name: `ZenMux (${process.env.ZENMUX_MODEL})`,
            fn: tryZenMuxGeneral,
            hasKey: () => Boolean(process.env.ZENMUX_API_KEY),
          },
        ]
      : []),

    // 5. Groq (Llama 3.3)
    { id: 'groq', name: 'Groq (Llama 3.3)', fn: tryGroq, hasKey: () => Boolean(process.env.GROQ_API_KEY) },

    // 6. OpenRouter
    { id: 'openrouter', name: 'OpenRouter', fn: tryOpenRouter, hasKey: () => Boolean(process.env.OPENROUTER_API_KEY) },

    // 7. OpenAI (GPT-4o-mini)
    { id: 'openai', name: 'OpenAI (GPT-4o-mini)', fn: tryOpenAI, hasKey: () => Boolean(process.env.OPENAI_API_KEY) },

    // 8. Ollama (Local)
    { id: 'ollama', name: 'Ollama (Local)', fn: tryOllama, hasKey: () => Boolean(process.env.OLLAMA_BASE_URL) },
  ];

  if (preferredProvider && preferredProvider !== 'auto') {
    const pref = preferredProvider.toLowerCase().trim();
    const matched = providers.filter(p => p.id === pref || p.name.toLowerCase().includes(pref));
    const others = providers.filter(p => p.id !== pref && !p.name.toLowerCase().includes(pref));
    if (matched.length > 0) {
      console.log(`[IA] 🎯 Usuario seleccionó preferir: ${matched[0].name}`);
      providers = [...matched, ...others];
    }
  }

  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.hasKey()) continue;

    try {
      console.log(`[IA] Intentando clasificar con: ${provider.name}...`);
      const results = await provider.fn(params);
      console.log(`[IA] ✅ Éxito con proveedor: ${provider.name} (${results.length} herramientas identificadas)`);

      let switchNotice: string | undefined = undefined;
      const geminiFailed = errors.find(
        (e) => e.includes('Google Gemini') && (e.includes('503') || e.includes('UNAVAILABLE') || e.includes('high demand'))
      );
      if (geminiFailed && !provider.name.includes('Gemini')) {
        switchNotice = `⚠️ Google Gemini (3.8 Flash) experimentó una sobrecarga temporal (503). Se cambió de API automáticamente a ${provider.name} para completar el análisis.`;
        console.log(`[IA Resiliencia] ${switchNotice}`);
      }

      return { results, providerUsed: provider.name, switchNotice };
    } catch (err: any) {
      console.warn(`[IA] ⚠️ Falló ${provider.name}: ${err?.message || err}. Probando siguiente proveedor...`);
      errors.push(`${provider.name}: ${err?.message || err}`);
    }
  }

  // Si Gemini 3.8 Flash falló específicamente por sobrecarga 503 (servidores de Google saturados)
  // y los otros proveedores contemplados (DeepSeek/MiniMax) no tenían API key configurada en .env o también fallaron:
  const gemini503Error = errors.find(
    (e) => e.includes('Google Gemini') && (e.includes('503') || e.includes('UNAVAILABLE') || e.includes('high demand'))
  );
  if (gemini503Error && process.env.GEMINI_API_KEY) {
    try {
      console.log(`[IA Resiliencia] Gemini 3.8 Flash en 503 y sin otros proveedores disponibles. Probando rescate de emergencia con Gemini 2.5 Flash...`);
      const emergencyAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = buildUserPrompt(params);
      const res = await emergencyAi.models.generateContent({
        model: 'gemini-2.5-flash',
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
                location: { type: Type.STRING },
                salary: { type: Type.STRING },
                price: { type: Type.STRING },
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                oneLiner: { type: Type.STRING },
                keyHighlights: { type: Type.ARRAY, items: { type: Type.STRING } },
                recommendedNotes: { type: Type.STRING },
                hasAcademicPromo: { type: Type.BOOLEAN },
                academicPromoDetails: { type: Type.STRING },
              },
              required: ['name', 'canonicalUrl', 'category', 'tags', 'oneLiner', 'keyHighlights'],
            },
          },
        },
      });
      const parsed = JSON.parse(res.text || '[]');
      const results = normalizeRawOutput(parsed, params.urls, params.sourceTweet);
      const switchNotice = `⚠️ Google Gemini (3.8 Flash) experimentó una sobrecarga temporal (503). Al no haber claves configuradas para DeepSeek o MiniMax en tu .env, se usó temporalmente Gemini 2.5 Flash de emergencia para no perder el análisis.`;
      console.log(`[IA Resiliencia] ${switchNotice}`);
      return {
        results,
        providerUsed: 'Google Gemini (2.5 Flash - Respaldo por sobrecarga 503)',
        switchNotice,
      };
    } catch (e: any) {
      errors.push(`Gemini 2.5 Flash Respaldo: ${e?.message || e}`);
    }
  }

  // Si ninguno estaba configurado o todos fallaron
  console.warn(
    `[IA Fallback] Ningún proveedor de IA tuvo éxito. Errores: ${errors.join(' | ')}. Usando fallback básico.`
  );

  const fallback: ClassificationResult[] = params.urls.length > 0
    ? params.urls.map((u) => ({
        name: params.githubMetas?.[u]?.name || u.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'Herramienta',
        canonicalUrl: u,
        category: (params.githubMetas?.[u]?.topics.includes('cli') ? 'CLI & Terminal' : 'Other') as ToolCategory,
        tags: params.githubMetas?.[u]?.topics.slice(0, 5) || ['dev', 'tool'],
        oneLiner: params.githubMetas?.[u]?.description || params.rawText.slice(0, 140),
        keyHighlights: params.githubMetas?.[u]?.language ? [`Escrito en ${params.githubMetas[u].language}`] : [],
        recommendedNotes: 'Importado en modo de respaldo (sin proveedor de IA activo).',
        entryType: 'tool' as const,
      }))
    : (params.sourceTweet || params.rawText)
    ? (() => {
        const isJobFallback = /remot[oa]|freelance|hiring|vacante|empleo|contrat|trabajo|job/i.test(params.rawText);
        const isProductFallback = !isJobFallback && /hardware|gadget|dispositivo|chip|laptop|teclado|placa|raspberry|esp32|arduino/i.test(params.rawText);
        return [{
          name: isJobFallback ? 'Oportunidad / Recurso Laboral' : isProductFallback ? 'Producto Tecnológico / Hardware' : 'Consejo Técnico',
          canonicalUrl: params.sourceTweet || '',
          category: (isJobFallback ? 'Trabajo & Freelance' : isProductFallback ? 'Productos Tecnológicos & Hardware' : 'Consejos & Buenas Prácticas') as ToolCategory,
          tags: isJobFallback ? ['remoto', 'trabajo', 'freelance', 'dev'] : isProductFallback ? ['hardware', 'gadgets', 'tech', 'dev'] : ['consejos', 'tips', 'dev'],
          oneLiner: params.rawText.slice(0, 140),
          keyHighlights: [params.rawText.slice(0, 200)],
          recommendedNotes: 'Importado en modo de respaldo.',
          entryType: (isJobFallback ? 'job_remote' : isProductFallback ? 'tech_product' : 'tech_tip') as EntryType,
        }];
      })()
    : [];

  return { results: fallback, providerUsed: 'Fallback (Sin IA)' };
}

// =============================================================
// ANÁLISIS DE AUTORES DE X CON IA
// =============================================================
export interface AuthorAnalysisInput {
  name: string;
  handle?: string;
  tools: Array<{
    name: string;
    category?: string;
    oneLiner?: string;
    url?: string;
    tags?: string[];
  }>;
}

export interface AuthorProfileResult {
  name: string;
  handle?: string;
  role: string;
  bio: string;
  specialties: string[];
  whyFollow: string;
  suggestedTags: string[];
  githubUrl?: string;
  websiteUrl?: string;
}

function buildAuthorAnalysisPrompt(input: AuthorAnalysisInput): string {
  const toolsList = input.tools.length > 0
    ? input.tools
        .map(
          (t) =>
            `- "${t.name}" [${t.category || 'General'}]: ${t.oneLiner || 'Herramienta de desarrollo'} (URL: ${t.url || 'n/a'}) Tags: ${(t.tags || []).join(', ')}`
        )
        .join('\n')
    : '- Sin herramientas específicas en el historial aún.';

  return `
Actúa como un experto en ecosistemas de desarrollo de software, código abierto y la comunidad técnica de X (Twitter).
Analiza al siguiente creador / autor de X:

- Nombre del Autor: "${input.name}"
- Usuario de X/Twitter: @${input.handle || 'desconocido'}
- Herramientas o recursos que ha compartido o creado en este catálogo técnico:
${toolsList}

Genera un perfil profesional y técnico estructurado en español sobre este creador, explicando su rol en el mundo del desarrollo, sus áreas de especialización y por qué es valioso seguirlo en X.

Debes responder EXCLUSIVAMENTE en formato JSON con la siguiente estructura:
{
  "name": "${input.name}",
  "handle": "${input.handle || ''}",
  "role": "Rol técnico o especialidad profesional breve (ej. Creador Open Source de Terminal, Desarrollador Backend & Go, Investigador de IA)",
  "bio": "Descripción profesional concisa de 1 a 2 párrafos en español explicando su perfil, proyectos destacados (menciona si creó o impulsó alguna de las herramientas listadas) y el tipo de contenido que comparte.",
  "specialties": ["Especialidad 1", "Especialidad 2", "Especialidad 3"],
  "whyFollow": "1-2 oraciones explicando por qué vale la pena seguir a este creador en X y qué valor técnico aporta.",
  "suggestedTags": ["tag1", "tag2", "tag3"],
  "githubUrl": "Perfil oficial del autor en GitHub estrictamente en formato 'https://github.com/usuario'. REGLAS ESTRICTAS: 1) SOLO debe ser el perfil raíz del autor/creador dueño de la cuenta de X (ej. https://github.com/jesseduffield o https://github.com/astral-sh). 2) NUNCA pongas la URL de un repositorio (ej. NUNCA 'https://github.com/usuario/proyecto'). 3) Si el autor en X es un curador o difusor que comparte herramientas creadas por otros (ej. repositorios de terceros, empresas o proyectos ajenos), pon null. 4) Si no conoces con certeza el perfil personal o de organización del autor en GitHub, pon null.",
  "websiteUrl": "https://... (si tiene sitio web o blog conocido, o null)"
}
`;
}

function normalizeAuthorProfile(raw: any, input: AuthorAnalysisInput): AuthorProfileResult {
  const role = raw.role || `Curador y Creador Técnico en X`;
  const bio =
    raw.bio ||
    `${input.name} es un creador técnico en X que comparte herramientas y recursos para desarrolladores.`;

  const specialties =
    Array.isArray(raw.specialties) && raw.specialties.length > 0
      ? raw.specialties
      : [...new Set(input.tools.map((t) => t.category).filter(Boolean))];

  const whyFollow =
    raw.whyFollow ||
    `Comparte recursos y utilidades prácticas para mejorar el flujo de trabajo de programación.`;

  const suggestedTags = Array.isArray(raw.suggestedTags) ? raw.suggestedTags : [];

  let githubUrl: string | undefined = undefined;
  if (
    raw.githubUrl &&
    typeof raw.githubUrl === 'string' &&
    raw.githubUrl.trim() &&
    raw.githubUrl !== 'null' &&
    raw.githubUrl !== 'undefined'
  ) {
    let clean = raw.githubUrl.trim();
    if (!clean.startsWith('http')) clean = `https://${clean}`;
    try {
      const parsed = new URL(clean);
      if (parsed.hostname.includes('github.com')) {
        const segs = parsed.pathname.split('/').filter(Boolean);
        if (segs.length >= 1) {
          const userOrOrg = segs[0];
          const blacklisted = ['features', 'topics', 'trending', 'collections', 'events', 'readme', 'sponsors', 'orgs'];
          if (!blacklisted.includes(userOrOrg.toLowerCase())) {
            const authorHandle = (input.handle || '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const authorName = input.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const targetClean = userOrOrg.toLowerCase().replace(/[^a-z0-9]/g, '');

            const isMatch =
              (authorHandle && (authorHandle.includes(targetClean) || targetClean.includes(authorHandle))) ||
              (authorName && (authorName.includes(targetClean) || targetClean.includes(authorName)));

            // Si coincide con el autor del tweet, o si no proviene de las herramientas de terceros
            if (isMatch || !input.tools.some((t) => t.url?.toLowerCase().includes(`github.com/${userOrOrg.toLowerCase()}/`))) {
              githubUrl = `https://github.com/${userOrOrg}`;
            } else if (isMatch) {
              githubUrl = `https://github.com/${userOrOrg}`;
            }
          }
        }
      }
    } catch {
      // Ignorar URL inválida
    }
  }

  // Si no se proporcionó o fue descartado por ser de terceros, inferir SOLO si el autor es el dueño verificable del repo
  if (!githubUrl) {
    const cleanHandle = (input.handle || '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanName = input.name.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const t of input.tools) {
      if (t.url?.includes('github.com')) {
        const match = t.url.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
        if (match && match[1]) {
          const owner = match[1];
          const ownerClean = owner.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (
            (cleanHandle && (cleanHandle === ownerClean || ownerClean.includes(cleanHandle) || cleanHandle.includes(ownerClean))) ||
            (cleanName && (cleanName === ownerClean || ownerClean.includes(cleanName) || cleanName.includes(ownerClean)))
          ) {
            githubUrl = `https://github.com/${owner}`;
            break;
          }
        }
      }
    }
  }

  let websiteUrl = raw.websiteUrl && typeof raw.websiteUrl === 'string' ? raw.websiteUrl.trim() : undefined;
  if (websiteUrl && (websiteUrl === 'null' || websiteUrl === 'undefined')) websiteUrl = undefined;
  if (websiteUrl && !websiteUrl.startsWith('http')) websiteUrl = `https://${websiteUrl}`;

  return {
    name: raw.name || input.name,
    handle: (raw.handle || input.handle || '').replace(/^@/, ''),
    role,
    bio,
    specialties: specialties.slice(0, 5),
    whyFollow,
    suggestedTags: suggestedTags.slice(0, 6),
    githubUrl,
    websiteUrl,
  };
}

async function tryGeminiAuthor(params: AuthorAnalysisInput): Promise<AuthorProfileResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildAuthorAnalysisPrompt(params);
  const targetModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const authorSchemaConfig = {
    responseMimeType: 'application/json',
    responseJsonSchema: {
      type: Type.OBJECT,
      description: 'Perfil y análisis técnico del autor en X',
      properties: {
        name: { type: Type.STRING },
        handle: { type: Type.STRING },
        role: { type: Type.STRING },
        bio: { type: Type.STRING },
        specialties: { type: Type.ARRAY, items: { type: Type.STRING } },
        whyFollow: { type: Type.STRING },
        suggestedTags: { type: Type.ARRAY, items: { type: Type.STRING } },
        githubUrl: { type: Type.STRING },
        websiteUrl: { type: Type.STRING },
      },
      required: ['name', 'role', 'bio', 'specialties', 'whyFollow'],
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: prompt,
      config: authorSchemaConfig,
    });

    const parsed = JSON.parse(response.text || '{}');
    return normalizeAuthorProfile(parsed, params);
  } catch (err: any) {
    if (targetModel !== 'gemini-2.5-flash') {
      console.warn(`[Gemini Author] ${targetModel} falló. Reintentando con gemini-2.5-flash...`);
      const retry = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: authorSchemaConfig,
      });
      const parsed = JSON.parse(retry.text || '{}');
      return normalizeAuthorProfile(parsed, params);
    }
    throw err;
  }
}

async function callOpenAICompatibleAuthor(options: {
  providerName: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  prompt: string;
  headers?: Record<string, string>;
}): Promise<any> {
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
          'Eres un analista experto en la comunidad de desarrolladores y creadores de software en X/Twitter. Responde SIEMPRE en formato JSON válido con el perfil del autor. No incluyas texto fuera del JSON.',
      },
      { role: 'user', content: options.prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  };

  const res = await fetch(options.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`[${options.providerName}] HTTP ${res.status}: ${errorBody.slice(0, 180)}`);
  }

  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content?.trim();
  if (!rawText) throw new Error(`[${options.providerName}] Respuesta vacía`);

  return parseJsonSafely(rawText);
}

export async function analyzeAuthorWithCascade(
  params: AuthorAnalysisInput,
  preferredProvider?: string
): Promise<{ result: AuthorProfileResult; providerUsed: string; switchNotice?: string }> {
  const prompt = buildAuthorAnalysisPrompt(params);

  let providers = [
    // 1. Google Gemini (Flash) - Prioridad principal por defecto
    {
      id: 'gemini',
      name: 'Google Gemini (Flash)',
      fn: () => tryGeminiAuthor(params),
      hasKey: () => Boolean(process.env.GEMINI_API_KEY),
    },

    // 2. DeepSeek Flash (ZenMux)
    {
      id: 'deepseek',
      name: `ZenMux (${process.env.ZENMUX_DEEPSEEK_MODEL || 'deepseek/deepseek-v4.1-flash'})`,
      fn: async () => {
        const apiKey = process.env.ZENMUX_DEEPSEEK_KEY || process.env.ZENMUX_API_KEY;
        const model = process.env.ZENMUX_DEEPSEEK_MODEL || 'deepseek/deepseek-v4.1-flash';
        const raw = await callOpenAICompatibleAuthor({
          providerName: `ZenMux (${model})`,
          endpoint: getZenMuxEndpoint(),
          apiKey,
          model,
          prompt,
        });
        return normalizeAuthorProfile(raw, params);
      },
      hasKey: () => Boolean(process.env.ZENMUX_DEEPSEEK_KEY || process.env.ZENMUX_API_KEY),
    },

    // 3. MiniMax 3.1 Flash (ZenMux)
    {
      id: 'minimax',
      name: `ZenMux (${process.env.ZENMUX_MINIMAX_MODEL || 'minimax/minimax-m3.1-flash'})`,
      fn: async () => {
        const apiKey = process.env.ZENMUX_MINIMAX_KEY || process.env.ZENMUX_API_KEY;
        const model = process.env.ZENMUX_MINIMAX_MODEL || 'minimax/minimax-m3.1-flash';
        const raw = await callOpenAICompatibleAuthor({
          providerName: `ZenMux (${model})`,
          endpoint: getZenMuxEndpoint(),
          apiKey,
          model,
          prompt,
        });
        return normalizeAuthorProfile(raw, params);
      },
      hasKey: () => Boolean(process.env.ZENMUX_MINIMAX_KEY || process.env.ZENMUX_API_KEY),
    },

    // 4. Claude Haiku 5.5 (ZenMux)
    {
      id: 'claude',
      name: `ZenMux (${process.env.ZENMUX_CLAUDE_MODEL || 'anthropic/claude-haiku-5.5'})`,
      fn: async () => {
        const apiKey = process.env.ZENMUX_CLAUDE_KEY || process.env.ZENMUX_API_KEY;
        const model = process.env.ZENMUX_CLAUDE_MODEL || 'anthropic/claude-haiku-5.5';
        const raw = await callOpenAICompatibleAuthor({
          providerName: `ZenMux (${model})`,
          endpoint: getZenMuxEndpoint(),
          apiKey,
          model,
          prompt,
        });
        return normalizeAuthorProfile(raw, params);
      },
      hasKey: () => Boolean(process.env.ZENMUX_CLAUDE_KEY || process.env.ZENMUX_API_KEY),
    },

    // ZenMux - Modelo personalizado (si se especificó ZENMUX_MODEL explícitamente)
    ...(process.env.ZENMUX_MODEL
      ? [
          {
            id: 'zenmux',
            name: `ZenMux (${process.env.ZENMUX_MODEL})`,
            fn: async () => {
              const raw = await callOpenAICompatibleAuthor({
                providerName: `ZenMux (${process.env.ZENMUX_MODEL})`,
                endpoint: getZenMuxEndpoint(),
                apiKey: process.env.ZENMUX_API_KEY,
                model: process.env.ZENMUX_MODEL!,
                prompt,
              });
              return normalizeAuthorProfile(raw, params);
            },
            hasKey: () => Boolean(process.env.ZENMUX_API_KEY),
          },
        ]
      : []),
  ];

  if (preferredProvider && preferredProvider !== 'auto') {
    const pref = preferredProvider.toLowerCase().trim();
    const matched = providers.filter(p => p.id === pref || p.name.toLowerCase().includes(pref));
    const others = providers.filter(p => p.id !== pref && !p.name.toLowerCase().includes(pref));
    if (matched.length > 0) {
      console.log(`[AuthorManager] 🎯 Analizando autor con motor elegido: ${matched[0].name}`);
      providers = [...matched, ...others];
    }
  }

  const authorErrors: string[] = [];

  for (const provider of providers) {
    if (!provider.hasKey()) continue;

    try {
      console.log(`[Author IA] Analizando autor "${params.name}" con: ${provider.name}...`);
      const result = await provider.fn();
      console.log(`[Author IA] ✅ Éxito analizando autor con: ${provider.name}`);

      let switchNotice: string | undefined = undefined;
      const geminiFailed = authorErrors.find(
        (e) => e.includes('Google Gemini') && (e.includes('503') || e.includes('UNAVAILABLE') || e.includes('high demand'))
      );
      if (geminiFailed && !provider.name.includes('Gemini')) {
        switchNotice = `⚠️ Google Gemini (3.8 Flash) experimentó una sobrecarga temporal (503). Se cambió automáticamente a ${provider.name} para analizar el perfil de autor.`;
        console.log(`[Author Resiliencia] ${switchNotice}`);
      }

      return { result, providerUsed: provider.name, switchNotice };
    } catch (err: any) {
      console.warn(`[Author IA] ⚠️ Falló ${provider.name}: ${err?.message || err}. Probando siguiente proveedor...`);
      authorErrors.push(`${provider.name}: ${err?.message || err}`);
    }
  }

  // Si Gemini 3.8 Flash falló con 503 y no hay claves de DeepSeek/MiniMax configuradas:
  const gemini503Author = authorErrors.find(
    (e) => e.includes('Google Gemini') && (e.includes('503') || e.includes('UNAVAILABLE') || e.includes('high demand'))
  );
  if (gemini503Author && process.env.GEMINI_API_KEY) {
    try {
      console.log(`[Author Resiliencia] Gemini 3.8 Flash en 503. Rescatando análisis de autor con Gemini 2.5 Flash...`);
      const emergencyAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const res = await emergencyAi.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: Type.OBJECT,
            description: 'Perfil y análisis técnico del autor en X',
            properties: {
              name: { type: Type.STRING },
              handle: { type: Type.STRING },
              role: { type: Type.STRING },
              bio: { type: Type.STRING },
              specialties: { type: Type.ARRAY, items: { type: Type.STRING } },
              whyFollow: { type: Type.STRING },
              suggestedTags: { type: Type.ARRAY, items: { type: Type.STRING } },
              githubUrl: { type: Type.STRING },
              websiteUrl: { type: Type.STRING },
            },
            required: ['name', 'role', 'bio', 'specialties', 'whyFollow'],
          },
        },
      });
      const parsed = JSON.parse(res.text || '{}');
      const result = normalizeAuthorProfile(parsed, params);
      const switchNotice = `⚠️ Google Gemini (3.8 Flash) experimentó sobrecarga temporal (503). El perfil de autor se analizó exitosamente con Gemini 2.5 Flash como rescate de emergencia.`;
      return {
        result,
        providerUsed: 'Google Gemini (2.5 Flash - Respaldo por sobrecarga 503)',
        switchNotice,
      };
    } catch (e: any) {
      authorErrors.push(`Gemini 2.5 Flash Author Respaldo: ${e?.message || e}`);
    }
  }

  // Fallback si no hay API de IA o todas fallaron
  console.log(`[Author IA] Usando análisis heurístico de respaldo para "${params.name}"`);
  const cats = [...new Set(params.tools.map((t) => t.category).filter(Boolean))];
  const tags = [...new Set(params.tools.flatMap((t) => t.tags || []))].slice(0, 5);

  // Resolver si hay un perfil de GitHub directamente asociado al autor (no a herramientas de terceros)
  let fallbackGithub: string | undefined = undefined;
  const cleanHandle = (params.handle || '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanName = params.name.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const t of params.tools) {
    if (t.url?.includes('github.com')) {
      const match = t.url.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
      if (match && match[1]) {
        const owner = match[1];
        const ownerClean = owner.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (
          (cleanHandle && (cleanHandle === ownerClean || ownerClean.includes(cleanHandle) || cleanHandle.includes(ownerClean))) ||
          (cleanName && (cleanName === ownerClean || ownerClean.includes(cleanName) || cleanName.includes(ownerClean)))
        ) {
          fallbackGithub = `https://github.com/${owner}`;
          break;
        }
      }
    }
  }

  const fallback: AuthorProfileResult = {
    name: params.name,
    handle: (params.handle || '').replace(/^@/, ''),
    role: `Curador técnico en ${cats.slice(0, 2).join(' & ') || 'desarrollo de software'}`,
    bio: `${params.name} ha compartido ${params.tools.length} recurso${params.tools.length > 1 ? 's' : ''} en tu catálogo técnico de X, destacando en ${cats.join(', ') || 'tecnología'}.`,
    specialties: cats.length > 0 ? (cats as string[]) : ['Herramientas de Desarrollo'],
    whyFollow: `Comparte y recomienda herramientas prácticas para el flujo de trabajo de programación en X.`,
    suggestedTags: tags,
    githubUrl: fallbackGithub,
    websiteUrl: undefined,
  };

  return { result: fallback, providerUsed: 'Fallback (Sin IA)' };
}

// -------------------------------------------------------------
// Utilidades de consulta para la interfaz y ventanas de análisis
// -------------------------------------------------------------
export function getActivePrimaryProviderName(): string {
  // 1. Google Gemini (3.8 Flash) - Proveedor Principal por defecto
  if (process.env.GEMINI_API_KEY) {
    return 'Google Gemini (3.8 Flash)';
  }

  // 2. DeepSeek (ZenMux o Directo)
  if (process.env.ZENMUX_DEEPSEEK_KEY || (process.env.ZENMUX_API_KEY && (!process.env.ZENMUX_MODEL || process.env.ZENMUX_MODEL.includes('deepseek')))) {
    const model = process.env.ZENMUX_DEEPSEEK_MODEL || 'deepseek/deepseek-v4.1-flash';
    return `ZenMux (${model})`;
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return `DeepSeek Directo (${process.env.DEEPSEEK_MODEL || 'deepseek-chat'})`;
  }

  // 3. MiniMax (ZenMux 3.1 Flash)
  if (process.env.ZENMUX_MINIMAX_KEY || (process.env.ZENMUX_API_KEY && process.env.ZENMUX_MODEL?.includes('minimax'))) {
    const model = process.env.ZENMUX_MINIMAX_MODEL || 'minimax/minimax-m3.1-flash';
    return `ZenMux (${model})`;
  }

  // Si tiene ZENMUX_API_KEY general (por defecto modelo DeepSeek en ZenMux)
  if (process.env.ZENMUX_API_KEY) {
    const model = process.env.ZENMUX_MODEL || process.env.ZENMUX_DEEPSEEK_MODEL || 'deepseek/deepseek-v4.1-flash';
    return `ZenMux (${model})`;
  }

  // 4. Claude Haiku
  if (process.env.ZENMUX_CLAUDE_KEY) {
    const model = process.env.ZENMUX_CLAUDE_MODEL || 'anthropic/claude-haiku-5.5';
    return `ZenMux (${model})`;
  }

  // 5. Groq
  if (process.env.GROQ_API_KEY) {
    return `Groq (${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'})`;
  }

  // 6. OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    return `OpenRouter (${process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'})`;
  }

  // 7. OpenAI
  if (process.env.OPENAI_API_KEY) {
    return `OpenAI (${process.env.OPENAI_MODEL || 'gpt-4o-mini'})`;
  }

  // 8. Ollama
  if (process.env.OLLAMA_BASE_URL) {
    return `Ollama (${process.env.OLLAMA_MODEL || 'llama3.2'})`;
  }

  return 'Modo Respaldo Local (Sin API Key)';
}

export function getConfiguredProvidersList(): Array<{ id: string; name: string; priority: number; configured: boolean; shortName: string }> {
  return [
    {
      id: 'gemini',
      name: 'Google Gemini (Flash)',
      shortName: 'Gemini Flash',
      priority: 1,
      configured: Boolean(process.env.GEMINI_API_KEY),
    },
    {
      id: 'deepseek',
      name: `ZenMux DeepSeek (${process.env.ZENMUX_DEEPSEEK_MODEL || 'v4.1-flash'})`,
      shortName: 'DeepSeek v4.1',
      priority: 2,
      configured: Boolean(process.env.ZENMUX_DEEPSEEK_KEY || process.env.ZENMUX_API_KEY || process.env.DEEPSEEK_API_KEY),
    },
    {
      id: 'minimax',
      name: `ZenMux MiniMax (${process.env.ZENMUX_MINIMAX_MODEL || '3.1-flash'})`,
      shortName: 'MiniMax 3.1',
      priority: 3,
      configured: Boolean(process.env.ZENMUX_MINIMAX_KEY || process.env.ZENMUX_API_KEY),
    },
  ];
}

export async function structureThreadStepsWithAI(
  toolName: string,
  rawText: string
): Promise<Array<{ title: string; prompt?: string; description?: string }>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return rawText
      .split(/\n\s*\n/)
      .map((chunk, idx) => ({ title: `Paso ${idx + 1}`, prompt: chunk.trim() }))
      .filter((s) => Boolean(s.prompt));
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Analiza los siguientes tweets adicionales o prompts de un hilo en X sobre "${toolName}":
"""
${rawText}
"""
Extrae de manera estructurada cada uno de los pasos, prompts o recomendaciones encontrados.
Devuelve un array JSON de objetos donde cada elemento tenga:
- "title": Título breve y numerado del paso (ej: "1) El diagnóstico de la conexión", "2) Los ladrones de ancho de banda", etc.)
- "prompt": El texto exacto del prompt o comando entre comillas para copiar y pegar. Si no es un prompt exacto, el contenido central.
- "description": Explicación breve de lo que hace o requisitos (opcional)`;

    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              prompt: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ['title', 'prompt'],
          },
        },
      },
    });

    const parsed = JSON.parse(res.text || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err: any) {
    console.warn('[Thread AI] Error al estructurar hilo con IA, usando fallback estructurado:', err?.message || err);
  }

  return rawText
    .split(/\n\s*\n/)
    .map((chunk, idx) => ({ title: `Paso ${idx + 1}`, prompt: chunk.trim() }))
    .filter((s) => Boolean(s.prompt));
}
