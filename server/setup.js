import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * First-run helper: create dashboard/.env from .env.example and inject a random
 * OUTREACH_TOKEN. Run with `npm run setup`. Safe to run repeatedly — it won't
 * overwrite an existing .env.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const envPath = path.join(ROOT, '.env');
const examplePath = path.join(ROOT, '.env.example');

if (fs.existsSync(envPath)) {
  console.log('.env already exists — leaving it untouched.');
  console.log('Your import token (OUTREACH_TOKEN) is in dashboard/.env.');
  process.exit(0);
}

let text = fs.readFileSync(examplePath, 'utf8');
const token = crypto.randomBytes(18).toString('base64url');
text = text.replace(/^OUTREACH_TOKEN=.*$/m, `OUTREACH_TOKEN=${token}`);

fs.writeFileSync(envPath, text);
console.log('✓ Created dashboard/.env');
console.log('✓ Generated import token:\n');
console.log('    ' + token + '\n');
console.log('Next:');
console.log('  1. Open dashboard/.env and fill in RESEND_API_KEY, FROM_EMAIL, FROM_NAME, PHYSICAL_ADDRESS.');
console.log('     (You can also do this later in the dashboard Settings page.)');
console.log('  2. Paste the token above into the extension when it asks (or in the panel settings).');
console.log('  3. Run `npm run dev`.');
