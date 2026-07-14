import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, settingsHealth, ROOT } from './config.js';
import { router } from './routes.js';
import { authRouter } from './authRoutes.js';
import { llmHealthCheck } from './llm.js';
import { runMigration } from './migrate.js';
import { db } from './db.js';

// Count real (non-owner) registered accounts, for the startup banner.
function countUsers() {
  return db.prepare(`SELECT COUNT(*) AS c FROM users WHERE id != 'owner'`).get().c;
}

// Import legacy JSON data into SQLite on first boot (idempotent, non-destructive).
const migration = runMigration();
if (migration.ran) {
  console.log(`[migrate] imported ${migration.leads} leads, ${migration.campaigns} campaigns, ${migration.sends} sends, settings: ${migration.settings}`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '4mb' }));

// CORS: the extension pushes leads with an `Authorization: Bearer <api_key>`
// from its service worker (no cookies), so we echo the Origin and allow that
// header. The website is same-origin (prod) or proxied (dev), so its session
// cookie needs Allow-Credentials with a concrete origin (never "*").
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Vary', 'Origin');
  } else {
    res.set('Access-Control-Allow-Origin', '*');
  }
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.set('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, name: 'leadextractor-dashboard', version: '1.0.0' });
});

// Auth + account + connect endpoints (public / cookie-based). Mounted before
// the tenant-scoped data router so /api/auth/* isn't caught by requireUser.
app.use('/api', authRouter);
app.use('/api', router);

// In production, serve the built React client from dist/.
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

function banner(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  const bar = '─'.repeat(width);
  console.log('┌' + bar + '┐');
  for (const l of lines) console.log('│ ' + l.padEnd(width - 1) + '│');
  console.log('└' + bar + '┘');
}

const server = app.listen(config.port, '127.0.0.1', async () => {
  const health = settingsHealth();
  const llm = await llmHealthCheck();
  const userCount = countUsers();

  banner([
    'LeadExtractor Dashboard — API running',
    `http://127.0.0.1:${config.port}`,
    '',
    llm.ok ? `DeepSeek: OK (${llm.model})` : `DeepSeek: NOT WORKING — ${llm.error}`,
    health.ok ? 'owner settings: complete' : `owner settings: missing ${health.missing.join(', ')}`,
    `accounts: ${userCount} registered`
  ]);

  if (!llm.ok) {
    console.log('  → Email generation needs DeepSeek. Set DEEPSEEK_API_KEY in dashboard/.env.');
  }
  if (!health.ok) {
    console.log('  → Open the dashboard Settings page to finish configuration before sending.');
  }
  console.log(`\n  Dev UI: run \`npm run dev\` and open http://localhost:5173`);
  console.log(`  (or after \`npm run build\`, the UI is served right here.)\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖ Port ${config.port} is already in use.`);
    console.error(`  Change PORT in dashboard/.env, or stop whatever is using it.\n`);
    process.exit(1);
  }
  throw err;
});
