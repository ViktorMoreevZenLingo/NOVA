// Isolated UI recording: all backend responses are fixtures, never live services.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DEMO_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Only local FE recording is supported.');
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
if (spawnSync(ffmpeg, ['-version']).status !== 0) throw new Error('FFmpeg is required for MP4 export.');
const out = path.resolve('demo/output', new Date().toISOString().replaceAll(':', '-'));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } }, serviceWorkers: 'block' });
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', phone: '359888000000', user_metadata: {}, app_metadata: {}, created_at: '2026-10-10T09:00:00Z' };
const pair = (text) => ({ bg: text, en: text });
let done = false;
let activityReads = 0;
const failures = [];
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(base).origin) return route.continue();
  const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  if (url.hostname !== 'demo.supabase.co') { failures.push(`Blocked external request: ${url.origin}${url.pathname}`); return route.abort(); }
  if (url.pathname === '/auth/v1/user') return json(user);
  if (url.pathname === '/rest/v1/profiles') return json({ name: 'Алекс Демо', notes: 'Предпочитам кратки резюмета на български.', photo: '' });
  if (url.pathname === '/rest/v1/connections') return json([{ service: 'gmail' }]);
  if (url.pathname === '/rest/v1/chat_sessions') return json([]);
  if (url.pathname === '/functions/v1/agent' && route.request().postDataJSON()?.action === 'load') return json({ messages: [], pending: null });
  if (url.pathname === '/rest/v1/activity') {
    activityReads++;
    return json([{ id: 'demo-summary', type: 'task', date: new Date().toISOString(), status: done ? 'done' : 'waiting', title: pair('Резюме на важните имейли'), detail: pair(done ? '1. Среща с екипа утре в 10:00.\n2. Изпрати предложението до петък.\n3. Бюлетинът не изисква действие.' : 'Обработва се заявката за последните три дни.') }]);
  }
  failures.push(`Unexpected API request: ${url.pathname}`);
  return route.fulfill({ status: 403, body: 'Not permitted in recording fixture' });
});
await context.addInitScript(({ user }) => {
  localStorage.setItem('sb-demo-auth-token', JSON.stringify({ access_token: 'demo-fixture-not-a-real-token', refresh_token: 'demo', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now()/1000)+86400, user }));
}, { user });
const page = await context.newPage();
page.on('pageerror', error => failures.push(error.message));
const wait = ms => page.waitForTimeout(ms);
let x = 1700, y = 850;
async function move(locator, click = false) {
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Target has no bounding box');
  const tx = box.x + box.width/2, ty = box.y + box.height/2;
  const sx = x, sy = y;
  for (let i=1; i<=40; i++) {
    const t=i/40, eased=t*t*(3-2*t);
    x=sx+(tx-sx)*eased; y=sy+(ty-sy)*eased;
    await page.mouse.move(x,y); await wait(20);
  }
  await wait(350);
  if (click) { await page.mouse.click(x,y); await wait(800); }
}
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.sidebar').waitFor();
  await page.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.innerHTML = '<svg width="32" height="40" viewBox="0 0 32 40"><path d="M3 2 L3 30 L11 23 L17 36 L23 33 L17 21 L28 21 Z" fill="white" stroke="#173e31" stroke-width="2"/></svg>';
    cursor.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px #0005);transform:translate(1700px,850px)';
    document.body.append(cursor);
    addEventListener('mousemove', e => cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`);
    addEventListener('mousedown', () => cursor.animate([{ opacity:1 },{ opacity:.35 },{ opacity:1 }], {duration:400}));
  });
  await wait(2500);
  await move(page.locator('.sidebar .nav-item').filter({ hasText: /Интеграции|Integrations/ }), true);
  await move(page.locator('[data-service="gmail"]'));
  await wait(5000);
  await page.screenshot({ path: path.join(out, 'integrations.png') });
  await move(page.locator('.sidebar .nav-item').filter({ hasText: /История|History/ }), true);
  const row = page.locator('.history-row').filter({ hasText: 'Резюме на важните имейли' });
  await move(row);
  await wait(4500);
  const before = activityReads;
  done = true;
  // The real app refreshes on focus; fixture changes only the response, not UI state.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => [...document.querySelectorAll('.history-row')].some(el => el.textContent.includes('Резюме на важните имейли') && el.querySelector('.history-status.complete')));
  if (activityReads <= before) throw new Error('Expected account refresh');
  await wait(2000);
  await move(row, true);
  await page.getByText(/Среща с екипа утре/).waitFor();
  await wait(6500);
  await page.screenshot({ path: path.join(out, 'summary.png') });
  if (failures.length) throw new Error(failures.join('\n'));
  const video = page.video();
  await context.close();
  const raw = await video.path();
  const target = path.join(out, 'nova-ai-fe-demo.mp4');
  const result = spawnSync(ffmpeg, ['-y','-i',raw,'-an','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-r','30','-movflags','+faststart',target], { encoding:'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  await writeFile(path.join(out,'manifest.json'), JSON.stringify({ simulated:true, audio:false, width:1920, height:1080, activityReads, failures, file:target }, null,2));
  console.log(target);
} finally { await browser.close(); }
