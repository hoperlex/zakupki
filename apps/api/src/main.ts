import { env } from './config/env';
import { buildApp } from './server';
import { startScheduler } from './lib/scheduler';

async function main() {
  const app = await buildApp();
  startScheduler(app);
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

main().catch((err) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
