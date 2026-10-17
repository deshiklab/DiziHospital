/**
 * Stage 3 - role based capture + public site capture.
 *
 *  - logs in with each of the 9 demo roles, records its dashboard, its menu
 *    tree and its first screens (proves the RBAC model)
 *  - captures the patient portal login
 *  - captures the public front site (home, doctors, appointment, news, ...)
 *
 * Output: capture/roles/<role>/*, capture/frontsite/*
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { BASE, log, ensure, slug, autocommit, login, clearOverlays, profilePage } = require('./lib');

const OUT = process.env.OUT_DIR || 'capture';
const ROLES_DIR = path.join(OUT, 'roles');
const FRONT_DIR = path.join(OUT, 'frontsite');

const ROLES = [
  ['superadmin', 'superadmin@gmail.com', 'Super Admin'],
  ['admin', 'jason@gmail.com', 'Admin'],
  ['doctor', 'sonia@gmail.com', 'Doctor'],
  ['pharmacist', 'harry@gmail.com', 'Pharmacist'],
  ['pathologist', 'belinat@gmail.com', 'Pathologist'],
  ['radiologist', 'johnhook@gmail.com', 'Radiologist'],
  ['accountant', 'bradf@gmail.com', 'Accountant'],
  ['receptionist', 'maria@gmail.com', 'Receptionist'],
  ['nurse', 'april@gmail.com', 'Nurse'],
];

const readNav = (page) => page.evaluate(() => {
  const txt = (el, n = 120) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const root = document.querySelector('#sh-sidenav, .sh-nav, .sidebar-menu');
  const out = { sections: [], topbar: [] };
  out.topbar = [...document.querySelectorAll('.sh-topbar a, .sh-topbar button, nav .dropdown-toggle, .navbar-nav a')]
    .map((a) => txt(a, 40)).filter(Boolean).slice(0, 40);
  if (!root) return out;
  let cur = null;
  for (const li of [...root.children]) {
    const cls = (li.className || '').toString();
    if (cls.includes('section') || li.tagName === 'H4') { cur = { name: txt(li, 60), items: [] }; out.sections.push(cur); continue; }
    const a = li.querySelector(':scope > a');
    if (!a) continue;
    const sub = li.querySelector(':scope > ul');
    const item = { label: txt(a, 70), href: a.getAttribute('href') || '', children: sub ? [...sub.querySelectorAll(':scope > li > a')].map((c) => ({ label: txt(c, 70), href: c.getAttribute('href') || '' })) : [] };
    if (!cur) { cur = { name: 'Main', items: [] }; out.sections.push(cur); }
    cur.items.push(item);
  }
  return out;
});

async function captureRole(browser, [role, user, label]) {
  ensure(path.join(ROLES_DIR, role));
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(35000);
  const rec = { role, label, user, ok: false };
  try {
    const url = await login(page, user, 'password');
    rec.landing = url;
    rec.loggedIn = !/site\/login/.test(url);
    if (!rec.loggedIn) { rec.error = 'login failed'; }
    await clearOverlays(page);
    await page.screenshot({ path: path.join(ROLES_DIR, role, 'dashboard.jpg'), type: 'jpeg', quality: 88 });
    rec.dashboard = await profilePage(page);
    const nav = await readNav(page);
    rec.nav = nav;
    fs.writeFileSync(path.join(ROLES_DIR, role, 'nav.json'), JSON.stringify(nav, null, 1));
    // first few screens reachable by this role
    const links = [];
    for (const sec of nav.sections) {
      for (const it of sec.items) {
        if (it.children && it.children.length) { it.children.forEach((c) => c.href && links.push({ label: `${it.label} › ${c.label}`, url: c.href })); }
        else if (it.href) links.push({ label: it.label, url: it.href });
      }
    }
    const uniq = []; const seen = new Set();
    for (const l of links) { const u = (l.url || '').split('?')[0]; if (!u || u === '#' || !u.includes('/admin/') || seen.has(u)) continue; seen.add(u); uniq.push({ ...l, url: u }); }
    rec.pageCount = uniq.length;
    const picked = uniq.slice(0, 6);
    rec.pages = [];
    for (let i = 0; i < picked.length; i++) {
      const p = picked[i];
      try {
        await page.goto(p.url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(900);
        await clearOverlays(page);
        const id = `${String(i + 1).padStart(2, '0')}-${slug(p.label)}`;
        await page.screenshot({ path: path.join(ROLES_DIR, role, id + '.jpg'), type: 'jpeg', quality: 86 });
        const prof = await profilePage(page);
        rec.pages.push({ label: p.label, url: p.url, file: `${id}.jpg`, title: prof.pageTitle, tables: (prof.tables || []).length, forms: (prof.forms || []).length });
      } catch (e) { rec.pages.push({ label: p.label, url: p.url, error: String(e).slice(0, 120) }); }
    }
    rec.ok = true;
    log(`role ${role}: ${rec.pageCount} menu pages, captured ${rec.pages.length}`);
  } catch (e) {
    rec.error = String(e).slice(0, 250);
    log(`role ${role} failed: ${rec.error}`);
  }
  fs.writeFileSync(path.join(ROLES_DIR, role + '.json'), JSON.stringify(rec, null, 1));
  await ctx.close();
  return rec;
}

async function captureFrontSite(browser) {
  ensure(FRONT_DIR);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(35000);
  const rec = { pages: [] };
  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(FRONT_DIR, '00-home.jpg'), type: 'jpeg', quality: 88, fullPage: true });
    rec.home = await profilePage(page);
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
      .map((a) => ({ t: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), h: a.href }))
      .filter((l) => l.h && l.h.startsWith('https://demo.smart-hospital.in/') && !l.h.includes('/admin/')));
    const navLinks = [];
    const seen = new Set();
    for (const l of links) {
      const key = l.h.split('?')[0];
      if (seen.has(key) || key.endsWith('/site/login') || key.endsWith('/site/userlogin')) continue;
      seen.add(key); navLinks.push({ label: l.t || key, url: key });
    }
    rec.links = navLinks;
    const picked = navLinks.slice(0, 14);
    for (let i = 0; i < picked.length; i++) {
      const p = picked[i];
      try {
        await page.goto(p.url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const id = `${String(i + 1).padStart(2, '0')}-${slug(p.label)}`;
        await page.screenshot({ path: path.join(FRONT_DIR, id + '.jpg'), type: 'jpeg', quality: 86, fullPage: true });
        const prof = await profilePage(page);
        rec.pages.push({ label: p.label, url: p.url, file: `${id}.jpg`, title: prof.pageTitle, headings: (prof.headings || []).slice(0, 8) });
        log(`frontsite ${p.url}`);
      } catch (e) { rec.pages.push({ label: p.label, url: p.url, error: String(e).slice(0, 120) }); }
    }
    // patient portal login
    await page.goto(BASE + '/site/userlogin', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(FRONT_DIR, 'patient-portal-login.jpg'), type: 'jpeg', quality: 88 });
  } catch (e) { rec.error = String(e).slice(0, 250); }
  fs.writeFileSync(path.join(FRONT_DIR, 'index.json'), JSON.stringify(rec, null, 1));
  await ctx.close();
  return rec;
}

async function main() {
  ensure(ROLES_DIR);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const r of ROLES) {
    if (fs.existsSync(path.join(ROLES_DIR, r[0] + '.json'))) { log('role already captured:', r[0]); continue; }
    await captureRole(browser, r);
    autocommit(ROLES_DIR, `role ${r[0]}`);
  }
  if (!fs.existsSync(path.join(FRONT_DIR, 'index.json'))) {
    await captureFrontSite(browser);
    autocommit(FRONT_DIR, 'front site');
  }
  log('stage 3 finished');
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  try { fs.writeFileSync(path.join(OUT, 'FATAL-roles.txt'), String((e && e.stack) || e)); } catch (_) {}
  autocommit(OUT, 'roles crashed');
  process.exit(0);
});
