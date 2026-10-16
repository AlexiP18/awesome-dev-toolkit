import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { loadAllTools, updateToolNote } from '../pipeline/note_generator.js';
import { ingestResource } from '../pipeline/ingest.js';
import { generateReadme } from '../pipeline/generate_readme.js';
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

// Route to install the bookmarklet easily
app.get('/bookmarklet', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'bookmarklet/install.html'));
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

// POST ingest a new tool from X / URL
app.post('/api/ingest', async (req, res) => {
  try {
    const { url, rawText, sourceTweet, author, status } = req.body;
    console.log(`[API] Ingest request received for: ${url || sourceTweet || rawText}`);

    const result = await ingestResource({
      url,
      rawText,
      sourceTweet,
      author,
      status,
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
    const { status, notes, category, tags } = req.body;

    const ok = updateToolNote(slug, { status, notes, category, tags });
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
