import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await mkdir('dist/icons');

await build({
  entryPoints: {
    background: resolve('src/background.ts'),
    content: resolve('src/content.ts'),
    popup: resolve('src/popup.ts'),
    review: resolve('src/review.ts')
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome120',
  minify: true,
  sourcemap: true,
  logLevel: 'info'
});

await Promise.all([
  cp('src/manifest.json', 'dist/manifest.json'),
  cp('src/popup.html', 'dist/popup.html'),
  cp('src/popup.css', 'dist/popup.css'),
  cp('src/review.html', 'dist/review.html'),
  cp('src/review.css', 'dist/review.css'),
  ...[16, 32, 48, 128].map((size) => cp(`assets/icon-${size}.png`, `dist/icons/icon-${size}.png`))
]);
