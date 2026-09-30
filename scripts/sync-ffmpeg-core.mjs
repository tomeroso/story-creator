// Copies the @ffmpeg/core single-thread build into public/ffmpeg so the app
// can load FFmpeg from same-origin static files instead of a CDN. Runs
// automatically after `npm install`; safe to re-run any time.
//
// (A multi-thread core was tried here and reverted - its own worker threads
// need to load the engine themselves, and that path turned out to be an
// unreliable source of silent hangs. Simpler and predictable wins for now.)
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const dest = join(root, 'public', 'ffmpeg');

const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!existsSync(src)) {
  console.warn('[sync-ffmpeg-core] @ffmpeg/core not found in node_modules - skipping copy.');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const file of files) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log(`[sync-ffmpeg-core] Copied ${files.join(', ')} (ESM build) to public/ffmpeg/`);
