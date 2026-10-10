// Renders demo/pitch/page.html frame by frame (deterministic sync of video, audio and subtitles).
//   node demo/pitch/render.mjs <workdir>   (workdir holds timeline.json, media/, audio.wav)
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const work = path.resolve(process.argv[2]);
const tl = JSON.parse(await readFile(path.join(work, 'timeline.json'), 'utf8'));
await copyFile(new URL('./page.html', import.meta.url), path.join(work, 'page.html'));
await mkdir(path.join(work, 'frames'), { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}), args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((tl) => { window.TL = tl; }, tl);
await page.goto(pathToFileURL(path.join(work, 'page.html')).href);
await page.evaluate(() => window.ready());
const frames = Math.round(tl.total * tl.fps);
const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null; // preview: seconds
for (let i = 0; i < frames; i++) {
  const t = i / tl.fps;
  if (only && !only.some((s) => Math.abs(s - t) < 0.5 / tl.fps)) continue;
  await page.evaluate((t) => window.render(t), t);
  await page.screenshot({ path: path.join(work, 'frames', `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 });
  if (i % 300 === 0) console.log(`frame ${i}/${frames}`);
}
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
console.log(`rendered ${only ? only.length : frames} frames`);
