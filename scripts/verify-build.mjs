import { readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const worker = manifest.background?.service_worker;
if (!worker || !worker.endsWith('.js')) {
  throw new Error('Built manifest must reference a JavaScript service worker.');
}
const loader = await readFile(new URL(worker, root), 'utf8');
for (const match of loader.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
  await access(new URL(join(dirname(worker), match[1]), root));
}
for (const icon of Object.values(manifest.icons ?? {})) await access(new URL(icon, root));
await access(new URL('editor.html', root));
if (manifest.action?.default_popup) await access(new URL(manifest.action.default_popup, root));
console.log(`Verified installable extension: ${manifest.name} ${manifest.version}`);
