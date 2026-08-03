import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('built manifest stays MV3 and narrowly scoped to TikTok', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dist/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
  assert.deepEqual(manifest.host_permissions, ['https://www.tiktok.com/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.tiktok.com/*']);
  assert.equal(manifest.homepage_url, 'https://github.com/yiitxyz/tiktokRepostRemover');
  assert.equal(manifest.icons['128'], 'icons/icon-128.png');
});

test('content script has separate collection, deletion, and verification paths', async () => {
  const [script, source] = await Promise.all([
    readFile(new URL('../dist/content.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/content.ts', import.meta.url), 'utf8')
  ]);
  assert.match(script, /\/api\/repost\/item_list\//);
  assert.match(script, /\/tiktok\/v1\/upvote\/delete/);
  assert.match(source, /REQUESTED_PAGE_SIZE = 50/);
  assert.match(source, /FALLBACK_PAGE_SIZE = 30/);
  assert.match(source, /error\.status !== 400/);
  assert.match(source, /randomBetween\(35, 45\)/);
  assert.match(source, /randomBetween\(300, 600\)/);
  assert.match(source, /randomBetween\(4_000, 7_000\)/);
  assert.match(source, /page >= pageLimit/);
  assert.match(source, /VERIFY_PROGRESS/);
  assert.match(script, /count:String\(/);
  assert.match(script, /verification start/);
  assert.match(script, /safety shutdown/);
  assert.match(script, /TikTok Repost Remover/);
});

test('review page exposes persistent selection and deletion controls', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../dist/review.html', import.meta.url), 'utf8'),
    readFile(new URL('../dist/review.js', import.meta.url), 'utf8')
  ]);
  for (const id of ['all', 'none', 'invert', 'delete', 'pause', 'resume', 'stop', 'retry']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(script, /indexedDB/);
  assert.match(script, /Only checked items will be removed/);
  assert.doesNotMatch(html, /<script[^>]*>\s*[^<]/);
});

test('all declared extension files exist after build', async () => {
  await Promise.all(['background.js', 'content.js', 'popup.js', 'popup.html', 'popup.css', 'review.js', 'review.html', 'review.css', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png']
    .map((file) => readFile(new URL(`../dist/${file}`, import.meta.url))));
});

test('popup exposes scan, stop, and review without inline scripts', async () => {
  const html = await readFile(new URL('../dist/popup.html', import.meta.url), 'utf8');
  assert.match(html, /id="scan"/);
  assert.match(html, /id="stop-scan"/);
  assert.match(html, /id="review"/);
  assert.doesNotMatch(html, /<script[^>]*>\s*[^<]/);
});
