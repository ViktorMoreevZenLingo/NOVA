// NOVA Coach demo recording against the LOCAL stack only (local Next dev + local Supabase
// seeded by NOVA_VOICE/scripts/seed-coach-demo.ts). Requests to any other host are blocked.
// The phone conversation itself is not recorded: its result (a draft for the manager) is
// created through the real coach-tools endpoint exactly as Vapi would call it.
//
//   supabase start && supabase functions serve --env-file <file with VAPI_TOOL_SECRET=...>
//   (cd NOVA_FE && NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon> npx next dev -p 3100)
//   deno run ... NOVA_VOICE/scripts/seed-coach-demo.ts   (DEMO_COACH_HISTORY=1)
//   DEMO_URL=http://localhost:3100 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   VAPI_TOOL_SECRET=... DEMO_EMPLOYEE_PHONE=+3598... DEMO_MANAGER_PHONE=+3598... DEMO_LEADER_PHONE=+3598... \
//   node demo/record-coach.mjs
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const env = (name) => { const v = process.env[name]; if (!v) throw new Error(`Missing ${name}`); return v; };
const base = process.env.DEMO_URL || 'http://localhost:3100';
const api = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), service = env('SUPABASE_SERVICE_ROLE_KEY');
const local = (u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname);
if (!local(base) || !local(api)) throw new Error('Only the local FE and local Supabase are supported.');
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
if (spawnSync(ffmpeg, ['-version']).status !== 0) throw new Error('FFmpeg is required for MP4 export.');
const out = path.resolve('demo/output', `coach-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(out, { recursive: true });

// ---- Local setup: sessions for the three demo roles and the coach call's result -------------
const admin = (p, init = {}) => fetch(api + p, { ...init, headers: { apikey: service, Authorization: `Bearer ${service}`, 'content-type': 'application/json', ...init.headers } });
async function userId(phone) {
  const r = await admin('/rest/v1/rpc/nova_user_id_by_phone', { method: 'POST', body: JSON.stringify({ p_phone: phone }) });
  const id = await r.json();
  if (typeof id !== 'string') throw new Error(`No local account for ${phone}; run the seed first.`);
  return id;
}
async function session(phone) {
  const id = await userId(phone), email = `demo-${phone.slice(1)}@example.invalid`, password = randomUUID();
  // Local stack only: a throwaway password so the recorder can sign in as this demo account.
  const r = await admin(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ email, email_confirm: true, password }) });
  if (!r.ok) throw new Error(`Could not prepare ${phone}: HTTP ${r.status}`);
  const s = await fetch(`${api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!s.ok) throw new Error(`Sign-in failed for ${phone}`);
  return { id, session: await s.json() };
}
const employeePhone = env('DEMO_EMPLOYEE_PHONE');
const employee = await session(employeePhone), manager = await session(env('DEMO_MANAGER_PHONE')), leader = await session(env('DEMO_LEADER_PHONE'));
// Fresh slate for the share part of the story (the seed resets everything else).
await admin(`/rest/v1/coach_shares?user_id=eq.${employee.id}`, { method: 'DELETE' });
const callId = `demo-call-${randomUUID()}`;
const vapi = await fetch(`${api}/functions/v1/coach-tools`, {
  method: 'POST',
  headers: { 'x-vapi-secret': env('VAPI_TOOL_SECRET'), 'content-type': 'application/json' },
  body: JSON.stringify({ message: { type: 'tool-calls', call: { id: callId, type: 'inboundPhoneCall', customer: { number: employeePhone } },
    toolCallList: [{ id: `${callId}-1`, function: { name: 'coach_propose_share', arguments: { text: 'I would like to take on a small project, for example leading the next client proposal.' } } }] } }),
});
const vapiResult = (await vapi.json()).results?.[0];
if (!vapiResult?.result?.includes('NOT sent')) throw new Error(`Coach draft was not created: ${JSON.stringify(vapiResult)}`);

// ---- Recording ------------------------------------------------------------------------------
const browser = await chromium.launch({ ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } }, serviceWorkers: 'block' });
const failures = [];
await context.route('**/*', (route) => {
  const url = route.request().url();
  if (local(url)) return route.continue();
  failures.push(`Blocked external request: ${new URL(url).origin}`);
  return route.abort();
});
// Simulated cursor, re-created after every reload (role switches), at its last position.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const [x, y] = JSON.parse(sessionStorage.getItem('demo.cursor') || '[1700,850]');
    const cursor = document.createElement('div');
    cursor.innerHTML = '<svg width="32" height="40" viewBox="0 0 32 40"><path d="M3 2 L3 30 L11 23 L17 36 L23 33 L17 21 L28 21 Z" fill="white" stroke="#173e31" stroke-width="2"/></svg>';
    cursor.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px #0005);transform:translate(${x}px,${y}px)`;
    document.body.append(cursor);
    addEventListener('mousemove', (e) => { cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; sessionStorage.setItem('demo.cursor', JSON.stringify([e.clientX, e.clientY])); });
    addEventListener('mousedown', () => cursor.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 400 }));
  });
});
const page = await context.newPage();
page.on('pageerror', (error) => failures.push(error.message));
const wait = (ms) => page.waitForTimeout(ms);
let x = 1700, y = 850;
async function move(locator, click = false) {
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Target has no bounding box');
  const tx = box.x + box.width / 2, ty = box.y + box.height / 2, sx = x, sy = y;
  for (let i = 1; i <= 40; i++) {
    const t = i / 40, eased = t * t * (3 - 2 * t);
    x = sx + (tx - sx) * eased; y = sy + (ty - sy) * eased;
    await page.mouse.move(x, y); await wait(20);
  }
  await wait(350);
  if (click) { await page.mouse.click(x, y); await wait(800); }
}
async function type(locator, text) {
  await move(locator, true);
  await locator.pressSequentially(text, { delay: 35 });
  await wait(400);
}
async function smoothScroll(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  await wait(1400);
}
const nav = (name) => page.locator('.sidebar .nav-item').filter({ hasText: name });
const card = (title) => page.locator('.coach-card, section').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first();
async function signInAs(who) {
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('sb-127-auth-token', JSON.stringify(s)); }, who.session);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.sidebar').waitFor();
  await wait(1500);
}
const shots = [];
async function shot(name) { const file = path.join(out, `${name}.png`); await page.screenshot({ path: file }); shots.push(file); }

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  // 1. Employee: home → anonymous check-in → private growth space → approve the coach's draft.
  await signInAs(employee);
  await page.getByRole('heading', { name: 'Your growth' }).waitFor();
  await move(page.locator('.coach-home-tile').first());
  await wait(2500);
  await move(nav('My voice'), true);
  await page.getByRole('heading', { name: 'You said, we did' }).waitFor();
  await move(page.getByRole('button', { name: /Answer in browser/ }));
  await wait(2000);
  await move(page.locator('.coach-said li').first());
  await wait(3000);
  await shot('1-my-voice');
  await move(nav('My growth'), true);
  await page.getByRole('heading', { name: 'Your next step' }).waitFor();
  await wait(1500);
  await move(page.locator('.coach-step strong').first());
  await wait(2000);
  await move(page.locator('.coach-list strong').filter({ hasText: 'Take on more responsibility' }));
  await wait(1500);
  await smoothScroll(card('Shared with your company'));
  await move(page.locator('.coach-share.draft p'));
  await wait(2500);
  await shot('2-draft-for-manager');
  await move(page.getByRole('button', { name: 'Share this' }), true);
  await page.locator('.coach-chip.done').filter({ hasText: 'Shared' }).waitFor();
  await move(page.locator('.coach-private').first());
  await wait(3000);

  // 2. Manager: team results (≥5 people), the request, a reply and a published action.
  await signInAs(manager);
  await move(nav('My team'), true);
  await page.getByRole('heading', { name: 'Engagement by week' }).waitFor();
  await wait(2000);
  await move(page.locator('.coach-stat').first());
  await wait(1200);
  const chart = page.locator('.coach-chart svg').first();
  const cb = await chart.boundingBox();
  for (const fx of [0.15, 0.45, 0.6, 0.95]) {
    await move(chart); await page.mouse.move(cb.x + cb.width * fx, cb.y + cb.height * 0.5); x = cb.x + cb.width * fx; await wait(900);
  }
  await shot('3-team-trend');
  await smoothScroll(card('Top concerns'));
  await move(page.locator('.coach-bars li').first());
  await wait(1500);
  await move(card('Bring to your 1:1s').locator('li').first());
  await wait(2500);
  await smoothScroll(card('Requests from your team'));
  const request = page.locator('.coach-request').first();
  await move(request.locator('p'));
  await wait(2000);
  await type(request.locator('input'), "Great idea - let's pick the project in our 1:1 on Thursday.");
  await move(request.getByRole('button', { name: 'Will act' }), true);
  await page.locator('.coach-request .secondary.on').filter({ hasText: 'Will act' }).waitFor();
  await wait(1500);
  await shot('4-request-reply');
  await smoothScroll(card('Suggested actions'));
  await move(page.locator('.coach-recs li').first());
  await wait(2000);
  await move(page.locator('.coach-recs li').first().getByRole('button', { name: 'Create action' }), true);
  await move(page.locator('.coach-action-form textarea'));
  await move(page.locator('.coach-action-form input[type="checkbox"]'), true);
  await move(page.getByRole('button', { name: 'Save action' }), true);
  await page.locator('.coach-actions li').first().waitFor();
  await wait(2500);

  // 3. Employee: the manager's reply closes the loop.
  await signInAs(employee);
  await move(nav('My growth'), true);
  await smoothScroll(card('Shared with your company'));
  await move(page.locator('.coach-reply').first());
  await wait(3500);
  await shot('5-manager-reply');

  // 4. Leadership: org view, small teams hidden, effect of actions.
  await signInAs(leader);
  await move(nav('Insights'), true);
  await page.getByRole('heading', { name: 'Concerns by department' }).waitFor();
  await wait(2000);
  await smoothScroll(card('Concerns by department'));
  await move(page.locator('.coach-heat-hidden'));
  await wait(2000);
  await move(page.locator('.coach-heat tbody tr').filter({ hasText: 'Customer Success' }).locator('th'));
  await wait(1500);
  await shot('6-heatmap');
  await move(page.locator('.coach-filter').filter({ hasText: 'Sales' }), true);
  await wait(2500);
  await smoothScroll(card('Actions and their effect'));
  await move(page.locator('.coach-impact').first());
  await wait(4000);
  await shot('7-action-effect');

  if (failures.length) throw new Error(failures.join('\n'));
  const video = page.video();
  await context.close();
  const raw = await video.path();
  const target = path.join(out, 'nova-coach-demo.mp4');
  const result = spawnSync(ffmpeg, ['-y', '-i', raw, '-an', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', target], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify({
    simulated: false,
    backend: 'local Supabase (seeded demo org), external requests blocked',
    phoneCall: 'not recorded; its result (draft for the manager) created via the local coach-tools endpoint',
    audio: false, width: 1920, height: 1080, failures, screenshots: shots, file: target,
  }, null, 2));
  console.log(target);
} finally { await browser.close(); }
