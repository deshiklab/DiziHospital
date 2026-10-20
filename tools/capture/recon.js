/**
 * Recon pass: log into the Smart Hospital demo, dump the login/dashboard HTML,
 * enumerate the sidebar menu, all links, and screengrab the first screens.
 *
 * Output: capture/recon/*  (committed back to the repo by the workflow)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.SH_BASE || 'https://demo.smart-hospital.in';
const USER = process.env.SH_USER || 'superadmin@gmail.com';
const PASS = process.env.SH_PASS || 'password';
const OUT = process.env.OUT_DIR || 'capture/recon';

const log = (...a) => { console.log(new Date().toISOString(), ...a); };
const ensure = (d) => fs.mkdirSync(d, { recursive: true });

async function main() {
  ensure(OUT);
  const notes = [];
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(60000);

  // ---------- 1. login page ----------
  log('goto login');
  const resp = await page.goto(BASE + '/site/login', { waitUntil: 'domcontentloaded' });
  notes.push(`login status=${resp && resp.status()} url=${page.url()}`);
  await page.waitForTimeout(2500);
  fs.writeFileSync(path.join(OUT, 'login.html'), await page.content());
  await page.screenshot({ path: path.join(OUT, '01-login.png'), fullPage: true });

  // ---------- 2. log in ----------
  const inputs = await page.$$eval('input', (els) =>
    els.map((e) => ({ name: e.name, id: e.id, type: e.type, ph: e.placeholder, cls: e.className }))
  );
  fs.writeFileSync(path.join(OUT, 'login-inputs.json'), JSON.stringify(inputs, null, 2));
  notes.push('inputs=' + JSON.stringify(inputs));

  const userSel = 'input[name="username"], input#username, input[name="email"], input[type="text"]';
  const passSel = 'input[name="password"], input#password, input[type="password"]';
  await page.fill(userSel, USER);
  await page.fill(passSel, PASS);

  let submitted = false;
  for (const sel of ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Sign In")', '[type="submit"]']) {
    const el = await page.$(sel);
    if (el) { await el.click().catch(() => {}); submitted = true; notes.push('clicked ' + sel); break; }
  }
  if (!submitted) { await page.press(passSel, 'Enter'); notes.push('pressed Enter'); }

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);
  notes.push('url-after-login=' + page.url());
  fs.writeFileSync(path.join(OUT, 'after-login.html'), await page.content());
  await page.screenshot({ path: path.join(OUT, '02-after-login.png'), fullPage: true });

  // ---------- 3. menu / link inventory ----------
  const links = await page.$$eval('a', (els) =>
    els.map((e) => ({
      text: (e.innerText || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      href: e.getAttribute('href') || '',
      cls: (e.className || '').toString().slice(0, 120),
      inSidebar: !!e.closest('.sidebar, .side-menu, #sidebar, .navbar-nav, .main-sidebar, aside'),
      visible: !!(e.offsetWidth || e.offsetHeight),
    })).filter((l) => l.text || l.href)
  );
  fs.writeFileSync(path.join(OUT, 'links.json'), JSON.stringify(links, null, 2));

  // structural dump of the layout so selectors can be derived offline
  const struct = await page.evaluate(() => {
    const out = {};
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id).slice(0, 400);
    out.ids = ids;
    out.bodyClasses = document.body.className;
    const sidebars = [...document.querySelectorAll('.sidebar, .side-menu, aside, .main-sidebar, #sidebar, #sidebar-wrapper, .app-sidebar')];
    out.sidebarCandidates = sidebars.map((s) => ({
      sel: s.tagName + '.' + (s.className || '').toString().split(/\s+/).join('.'),
      id: s.id,
      html: s.outerHTML.slice(0, 60000),
    }));
    out.title = document.title;
    out.h1 = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => h.innerText.trim()).slice(0, 40);
    out.forms = [...document.querySelectorAll('form')].map((f) => ({ action: f.getAttribute('action'), method: f.method, inputs: f.querySelectorAll('input,select,textarea').length }));
    out.tables = [...document.querySelectorAll('table')].map((t) => ({ cls: t.className, rows: t.rows.length, head: (t.tHead && t.tHead.innerText ? t.tHead.innerText.replace(/\s+/g, ' ').trim().slice(0, 500) : '') }));
    return out;
  });
  fs.writeFileSync(path.join(OUT, 'dashboard-structure.json'), JSON.stringify(struct, null, 2));
  fs.writeFileSync(path.join(OUT, 'sidebar.html'), (struct.sidebarCandidates[0] || {}).html || '');

  fs.writeFileSync(path.join(OUT, 'notes.txt'), notes.join('\n'));
  fs.writeFileSync(path.join(OUT, 'cookies.json'), JSON.stringify(await ctx.cookies(), null, 2));
  await ctx.storageState({ path: path.join(OUT, 'storage-state.json') }).catch(() => {});

  log('done');
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  try { require('fs').writeFileSync(path.join(OUT, 'FATAL.txt'), String(e && e.stack || e)); } catch (_) {}
  process.exit(0);
});
