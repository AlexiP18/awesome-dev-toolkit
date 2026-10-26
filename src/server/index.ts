import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { loadAllTools, updateToolNote } from '../pipeline/note_generator.js';
import { ingestResource } from '../pipeline/ingest.js';
import { generateReadme } from '../pipeline/generate_readme.js';
import { loadAllAuthorProfiles, analyzeAuthorWithAI } from '../pipeline/author_manager.js';
import { getActivePrimaryProviderName, getConfiguredProvidersList } from '../pipeline/ai_providers.js';
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

// PATCH update status or personal notes for a tool
app.patch('/api/tools/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const { status, notes, category, tags, has_academic_promo, academic_promo_details } = req.body;

    const ok = updateToolNote(slug, { status, notes, category, tags, has_academic_promo, academic_promo_details });
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Herramienta no encontrada' });
    }

    // Auto-update README.md
    try {
      const readme = generateReadme();
      fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), readme, 'utf-8');
    } catch {}

    res.json({ success: true, message: 'Nota actualizada correctamente' });
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
