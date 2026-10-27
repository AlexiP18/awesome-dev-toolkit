import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { loadAllTools, updateToolNote, deleteToolNote, deleteToolNotes } from '../pipeline/note_generator.js';
import { ingestResource } from '../pipeline/ingest.js';
import { generateReadme } from '../pipeline/generate_readme.js';
import { loadAllAuthorProfiles, analyzeAuthorWithAI } from '../pipeline/author_manager.js';
import { getActivePrimaryProviderName, getConfiguredProvidersList, structureThreadStepsWithAI } from '../pipeline/ai_providers.js';
import { fetchTweetDetailsFromX, fetchThreadTweetsFromX } from '../pipeline/twitter_scraper.js';
import { classifyToolsWithGemini } from '../pipeline/gemini.js';
import fs from 'fs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve static frontend assets
const publicDir = path.resolve(process.cwd(), 'src/web/public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
app.use(express.static(publicDir));

// Route to install the bookmarklet easily (support both /bookmarklet and /bookmarklet.html)
app.get(['/bookmarklet', '/bookmarklet.html'], (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'bookmarklet/install.html'));
});

// Route for the popup quick-save window (bypasses X/Twitter Content-Security-Policy)
app.get(['/quick-save', '/quick-save.html'], (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'src/web/public/quick-save.html'));
});

// GET all tools
app.get('/api/tools', (req, res) => {
  try {
    const tools = loadAllTools();
    res.json({ success: true, count: tools.length, tools });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET all author profiles
app.get('/api/authors', (req, res) => {
  try {
    const authors = loadAllAuthorProfiles();
    res.json({ success: true, count: Object.keys(authors).length, authors });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET active AI provider status
app.get('/api/ai/status', (req, res) => {
  try {
    const activeProvider = getActivePrimaryProviderName();
    const allConfigured = getConfiguredProvidersList();
    res.json({ success: true, activeProvider, allConfigured });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST analyze author profile with AI
app.post('/api/authors/analyze', async (req, res) => {
  try {
    const { authorName, authorHandle, aiProvider } = req.body;
    if (!authorName) {
      return res.status(400).json({ success: false, error: 'authorName es requerido' });
    }

    const { profile, providerUsed, switchNotice } = await analyzeAuthorWithAI(authorName, authorHandle, aiProvider);
    res.json({ success: true, profile, providerUsed, switchNotice });
  } catch (error: any) {
    console.error('[API Author Analyze Error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST ingest a new tool from X / URL
app.post('/api/ingest', async (req, res) => {
  try {
    const { url, urls, rawText, sourceTweet, author, status, entryType, aiProvider } = req.body;
    console.log(`[API] Ingest request received for: ${url || (urls && urls.join(', ')) || sourceTweet || rawText} [IA solicitada: ${aiProvider || 'auto'}]`);

    const result = await ingestResource({
      url,
      urls,
      rawText,
      sourceTweet,
      author,
      status,
      entryType,
      aiProvider,
    });

    // Auto-update README.md
    try {
      const readme = generateReadme();
      fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), readme, 'utf-8');
    } catch (e) {
      console.warn('[API] Could not update README.md:', e);
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[API Ingest Error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH update tool metadata and personal notes
app.patch('/api/tools/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const { 
      name,
      url,
      status, 
      notes, 
      category, 
      tags, 
      author,
      author_handle,
      source_tweet,
      location,
      salary,
      price,
      company,
      has_academic_promo, 
      academic_promo_details 
    } = req.body;

    const ok = updateToolNote(slug, { 
      name,
      url,
      status, 
      notes, 
      category, 
      tags, 
      author,
      author_handle,
      source_tweet,
      location,
      salary,
      price,
      company,
      has_academic_promo, 
      academic_promo_details 
    });
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Herramienta no encontrada' });
    }

    // Auto-update README.md
    try {
      const readme = generateReadme();
      fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), readme, 'utf-8');
    } catch {}

    const allTools = loadAllTools();
    const updated = allTools.find((t) => t.slug === slug);

    res.json({ success: true, message: 'Nota actualizada correctamente', tool: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE a single tool / card by slug
app.delete('/api/tools/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const ok = deleteToolNote(slug);
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Ficha no encontrada para eliminar' });
    }

    try {
      const readme = generateReadme();
      fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), readme, 'utf-8');
    } catch {}

    res.json({ success: true, message: `Ficha "${slug}" eliminada correctamente` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST batch delete tools
app.post('/api/tools/batch-delete', (req, res) => {
  try {
    const { slugs } = req.body;
    if (!Array.isArray(slugs) || slugs.length === 0) {
      return res.status(400).json({ success: false, error: 'slugs debe ser un array con al menos 1 elemento' });
    }

    const result = deleteToolNotes(slugs);

    try {
      const readme = generateReadme();
      fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), readme, 'utf-8');
    } catch {}

    res.json({ 
      success: true, 
      deletedCount: result.deleted.length, 
      deleted: result.deleted,
      notFound: result.notFound 
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST append or structure thread tweets into an existing tool / tip
app.post('/api/tools/:slug/thread', async (req, res) => {
  try {
    const { slug } = req.params;
    const { rawText, aiProvider } = req.body;
    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ success: false, error: 'rawText es requerido' });
    }

    const allTools = loadAllTools();
    const tool = allTools.find((t) => t.slug === slug);
    if (!tool) {
      return res.status(404).json({ success: false, error: 'Recurso no encontrado' });
    }

    let inputContent = rawText.trim();
    // Si el usuario pegó una URL de X o tweet, desenrollar automáticamente el hilo completo sin publicidad
    const xMatch = inputContent.match(/https?:\/\/(?:x|twitter)\.com\/(?:[a-zA-Z0-9_]+\/)?status\/\d+/i);
    if (xMatch) {
      console.log(`[Thread API] 🐦 Obteniendo hilo completo de X: ${xMatch[0]}...`);
      const threadRes = await fetchThreadTweetsFromX(xMatch[0], tool.frontmatter.author_handle);
      if (threadRes && (threadRes.rootTweet || threadRes.threadTweets.length > 0)) {
        const parts: string[] = [];
        if (threadRes.rootTweet && !inputContent.includes(threadRes.rootTweet.text)) {
          parts.push(threadRes.rootTweet.text);
        }
        for (const t of threadRes.threadTweets) {
          parts.push(t.text);
        }
        inputContent = parts.join('\n\n');
        console.log(`[Thread API] 🧵 Total tweets recopilados del hilo: ${parts.length}`);
      }
    }

    let updatedContent = tool.content;
    let providerUsed = 'Google Gemini (Flash)';

    try {
      const steps = await structureThreadStepsWithAI(tool.frontmatter.name, inputContent);
      if (steps && steps.length > 0) {
        const formattedMarkdown = steps
          .map((s, idx) => {
            let block = `### ${s.title || `Paso adicional ${idx + 1}`}\n`;
            if (s.prompt) {
              block += `\`\`\`text\n${s.prompt}\n\`\`\`\n`;
            }
            if (s.description) {
              block += `${s.description}\n`;
            }
            return block;
          })
          .join('\n');

        updatedContent = updatedContent + `\n\n## 🧵 Tweets Adicionales del Hilo\n${formattedMarkdown}\n`;
      } else {
        updatedContent = updatedContent + `\n\n## 🧵 Tweets Adicionales del Hilo\n${inputContent}\n`;
      }
    } catch (e: any) {
      console.warn('[Thread API] Error al procesar hilo con IA, adjuntando directamente:', e?.message || e);
      updatedContent = updatedContent + `\n\n## 🧵 Tweets Adicionales del Hilo\n${inputContent}\n`;
    }

    updateToolNote(slug, { notes: updatedContent });

    try {
      const readme = generateReadme();
      fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), readme, 'utf-8');
    } catch {}

    const updatedTools = loadAllTools();
    const updated = updatedTools.find((t) => t.slug === slug);
    res.json({ success: true, tool: updated, providerUsed });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Awesome Dev Toolkit Dashboard corriendo en:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`👉 Bookmarklet instalador: http://localhost:${PORT}/bookmarklet`);
  console.log(`======================================================\n`);
});
