import { createApp } from './app.js';
import { flushGitHubSync, startGitHubMaintenance, syncFromGitHubRepoOnStartup } from '../pipeline/github_sync.js';
import { logEvent } from '../pipeline/log.js';

const app = createApp();
const PORT = Number(process.env.PORT) || 4000;

const server = app.listen(PORT, () => {
  logEvent('info', 'servidor escuchando', { port: PORT });
  console.log(`Awesome Dev Toolkit en http://localhost:${PORT} (salud: /health, bookmarklet: /bookmarklet)`);
  if (process.env.GITHUB_SYNC_ON_START === '0') return;
  void syncFromGitHubRepoOnStartup()
    .catch((err) => {
      logEvent('warn', 'La sincronización inicial con GitHub falló', {
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => startGitHubMaintenance());
});

function shutdown(signal: string): void {
  logEvent('info', 'apagando servidor', { signal });
  server.close(() => undefined);
  void flushGitHubSync().finally(() => process.exit(0));
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
