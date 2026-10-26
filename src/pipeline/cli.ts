import { ingestResource } from './ingest.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Uso de la herramienta CLI:
  npm run add <URL o Enlace de GitHub o Tweet> [--ai <gemini|deepseek|minimax|claude|groq|openrouter|openai|ollama|auto>]
  npm run add "https://github.com/jesseduffield/lazygit"
  npm run add "https://github.com/Leonxlnx/taste-skill" --ai deepseek
  npm run add -- "https://x.com/.../status/..." "Texto descriptivo de la herramienta"
`);
    process.exit(1);
  }

  const aiIndex = args.indexOf('--ai');
  let aiProvider: string | undefined = undefined;
  if (aiIndex !== -1 && args[aiIndex + 1]) {
    aiProvider = args[aiIndex + 1];
    args.splice(aiIndex, 2);
  }

  const firstArg = args[0] || '';
  const secondArg = args[1] || '';

  const isUrl = firstArg.startsWith('http://') || firstArg.startsWith('https://');

  try {
    const result = await ingestResource({
      url: isUrl ? firstArg : undefined,
      rawText: isUrl ? secondArg : firstArg,
      sourceTweet: firstArg.includes('x.com') || firstArg.includes('twitter.com') ? firstArg : undefined,
      aiProvider,
    });

    console.log('\n=======================================');
    console.log(`🎉 Herramienta agregada: ${result.classification.name}`);
    console.log(`📁 Categoría: ${result.classification.category}`);
    console.log(`🏷️ Tags: ${result.classification.tags.join(', ')}`);
    console.log(`🔗 URL: ${result.classification.canonicalUrl}`);
    console.log(`📄 Archivo: ${result.filePath}`);
    console.log('=======================================\n');
  } catch (error) {
    console.error('❌ Error procesando el recurso:', error);
    process.exit(1);
  }
}

main();
