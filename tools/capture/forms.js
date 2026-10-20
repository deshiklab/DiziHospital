/**
 * Stage 2 - deep capture.
 *
 *  A. For every page captured in stage 1, open the page-specific add/edit form
 *     (modal or inline) and record it field by field.
 *  B. Click through the tabs of every page that has them.
 *  C. Open a real record (patient / staff / case) and walk its detail tabs.
 *
 * Output: capture/forms/<pageid>__<slug>.{jpg,json}, capture/detail/*.{jpg,json}
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { BASE, log, ensure, slug, autocommit, login, clearOverlays, profilePage } = require('./lib');

const OUT = process.env.OUT_DIR || 'capture';
const FORMS_DIR = path.join(OUT, 'forms');
const DETAIL_DIR = path.join(OUT, 'detail');
const BUDGET_MS = parseInt(process.env.BUDGET_MS || String(40 * 60 * 1000), 10);
const START = Date.now();
let sinceCommit = 0;

/** Page-specific form triggers, ignoring the global quick-add panel and vendor modals. */
async function discoverTriggers(page) {
  return await page.evaluate(() => {
    const txt = (el, n = 50) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const isGlobal = (el) => !!el.closest('#sidebar, .sh-sidebar, #shQuickAddPanel, #shQuickAddWrap, .sh-topbar, nav');
    const out = [];
    const push = (label, kind, sel, idx) => out.push({ label, kind, sel, idx });
    document.querySelectorAll('a[href]').forEach((a, i) => {
      if (isGlobal(a) || !(a.offsetWidth || a.offsetHeight)) return;
      const h = a.getAttribute('href') || '';
      const t = txt(a);
      if (/action=add|action=edit|\/add$|\/add\/|new-|_add/i.test(h + ' ' + a.getAttribute('data-target'))) {
        push(t || 'link', 'link', 'a[href]', i);
      }
    });
    document.querySelectorAll('button[data-target], button[data-bs-target], a[data-target], a[data-bs-toggle="modal"], .btn[data-target]').forEach((b, i) => {
      if (isGlobal(b) || !(b.offsetWidth || b.offsetHeight)) return;
      const target = b.getAttribute('data-target') || b.getAttribute('data-bs-target') || '';
      if (/purchase|addon|SwitchBranch|bedStatus|activelic|beddata/i.test(target)) return;
      push(txt(b) || 'button', 'modal', '[data-target]', i);
    });
    // de-duplicate
    const seen = new Set();
    return out.filter((o) => { const k = o.label + o.kind; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  }).catch(() => []);
}

async function captureFormTrigger(page, rec, trig, out) {
  const before = page.url();
  // resolve the handle
  let handle = null;
  if (trig.kind === 'link') {
    const all = await page.$$('a[href]');
    handle = all[trig.idx] || null;
  } else {
    const all = await page.$$('button[data-target], button[data-bs-target], a[data-target], a[data-bs-toggle="modal"], .btn[data-target]');
    handle = all[trig.idx] || null;
  }
  if (!handle) return null;
  await handle.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1400);
  const modalVisible = await page.evaluate(() => !![...document.querySelectorAll('.modal.show, .modal[style*="display: block"]')].find((m) => m.offsetHeight));
  const id = `${rec.id}__${slug(trig.label || trig.kind)}`;
  const shot = path.join(FORMS_DIR, id + '.jpg');
  await page.screenshot({ path: shot, type: 'jpeg', quality: 88 }).catch(() => {});
  const profile = await profilePage(page);
  const body = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.modal.show, .modal[style*="display: block"]')].find((x) => x.offsetHeight);
    const root = m || document;
    const t = (el, n = 200) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n) : '');
    return {
      modalTitle: t(root.querySelector('.modal-title, .modal-header, h4, h3'), 120),
      bodyText: t(root, 800),
      required: [...root.querySelectorAll('[required]')].length,
      fieldCount: root.querySelectorAll('input:not([type=hidden]),select,textarea').length,
      errors: [...root.querySelectorAll('.text-danger, .invalid-feedback, .error')].map((e) => t(e, 80)).filter(Boolean).slice(0, 10),
    };
  }).catch(() => ({}));
  const res = { pageId: rec.id, pageLabel: rec.label, trigger: trig, modalVisible, url: page.url(), from: before, profile, form: body, file: path.basename(shot) };
  fs.writeFileSync(path.join(FORMS_DIR, id + '.json'), JSON.stringify(res, null, 1));
  // close whatever opened
  await page.evaluate(() => {
    const m = [...document.querySelectorAll('.modal.show, .modal[style*="display: block"]')].find((x) => x.offsetHeight);
    if (m) {
      const btn = m.querySelector('[data-dismiss="modal"], [data-bs-dismiss="modal"], .btn-secondary, .close');
      if (btn) btn.click();
    }
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  if (page.url() !== before) { await page.goto(before, { waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(800); }
  await clearOverlays(page);
  return res;
}

/** Click each tab of the current page and screenshot the panel. */
async function captureTabs(page, rec, out, prefix = '') {
  const tabs = await page.$$('.nav-tabs a, .nav-pills a, a[data-toggle="tab"], a[data-bs-toggle="tab"]');
  const results = [];
  for (let i = 0; i < Math.min(tabs.length, 8); i++) {
    try {
      const label = (await tabs[i].innerText()).replace(/\s+/g, ' ').trim();
      if (!label) continue;
      await tabs[i].click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await clearOverlays(page);
      const id = `${prefix}${rec.id}__tab-${i + 1}-${slug(label)}`;
      const shot = path.join(out, id + '.jpg');
      await page.screenshot({ path: shot, type: 'jpeg', quality: 88 });
      const profile = await profilePage(page);
      const res = { pageId: rec.id, pageLabel: rec.label, tab: label, index: i, url: page.url(), profile, file: path.basename(shot) };
      fs.writeFileSync(path.join(out, id + '.json'), JSON.stringify(res, null, 1));
      results.push(res);
      log(`  tab captured: ${label}`);
    } catch (e) { log('  tab failed:', String(e).slice(0, 120)); }
  }
  return results;
}

/** Open the first record of a list page and walk its detail tabs. */
async function captureDetail(page, rec, listUrl, linkRe, prefix) {
  const out = [];
  try {
    await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await clearOverlays(page);
    const href = await page.evaluate((re) => {
      const rx = new RegExp(re, 'i');
      const a = [...document.querySelectorAll('table a[href], .card a[href], .box a[href]')]
        .find((x) => rx.test(x.getAttribute('href') || '') && (x.offsetWidth || x.offsetHeight));
      return a ? a.href : '';
    }, linkRe);
    if (!href) { log(`detail: no link matching ${linkRe} on ${listUrl}`); return out; }
    log(`detail: opening ${href}`);
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await clearOverlays(page);
    const id = `${prefix}-detail`;
    await page.screenshot({ path: path.join(DETAIL_DIR, id + '.jpg'), type: 'jpeg', quality: 88 });
    let profile = await profilePage(page);
    fs.writeFileSync(path.join(DETAIL_DIR, id + '.json'), JSON.stringify({ listUrl, href, id, profile }, null, 1));
    out.push({ id, href });
    const tabbed = await captureTabs(page, { id, label: id }, DETAIL_DIR, '');
    out.push(...tabbed);
  } catch (e) { log('detail failed:', String(e).slice(0, 160)); }
  return out;
}

async function main() {
  ensure(FORMS_DIR); ensure(DETAIL_DIR);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(35000);
  page.setDefaultNavigationTimeout(60000);

  log('login ->', await login(page, process.env.SH_USER, process.env.SH_PASS));

  const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));

  // ---------- A + B: forms and tabs for every page ----------
  for (const rec of index) {
    if (Date.now() - START > BUDGET_MS * 0.75) { log('form budget exhausted'); break; }
    const marks = path.join(FORMS_DIR, rec.id + '.done');
    if (fs.existsSync(marks)) { continue; }
    try {
      await page.goto(rec.url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await clearOverlays(page);
      const triggers = await discoverTriggers(page);
      log(`[${rec.id}] ${rec.label} - ${triggers.length} triggers: ${triggers.map((t) => t.label).join(', ').slice(0, 140)}`);
      for (const trig of triggers.slice(0, 3)) {
        if (Date.now() - START > BUDGET_MS * 0.85) break;
        await captureFormTrigger(page, rec, trig, FORMS_DIR);
      }
      await captureTabs(page, rec, FORMS_DIR, '');
      fs.writeFileSync(marks, new Date().toISOString());
    } catch (e) {
      log(`[${rec.id}] failed: ${String(e).slice(0, 160)}`);
      try { fs.writeFileSync(marks, 'error: ' + String(e).slice(0, 200)); } catch (_) {}
    }
    if (++sinceCommit >= 8) { sinceCommit = 0; autocommit(FORMS_DIR, `forms ${rec.id}`); }
  }
  autocommit(FORMS_DIR, 'forms pass complete');

  // ---------- C: real-record detail walks ----------
  const details = [
    ['opd', `${BASE}/admin/patient/search`, 'action=profile|/patient/view/|/patient/profile', 'opd'],
    ['ipd', `${BASE}/admin/patient/ipdsearch`, 'ipdprofile|/ipdview/|/patient/ipdview|/patient/profile', 'ipd'],
    ['appointment', `${BASE}/admin/appointment/index`, 'appointment/edit|/appointment/view', 'appointment'],
    ['staff', `${BASE}/admin/staff`, '/staff/view/', 'staff'],
    ['patient-master', `${BASE}/admin/admin/search`, '/patient/view/|/admin/patient', 'patient-master'],
    ['billing', `${BASE}/admin/bill/dashboard`, '/bill/view/|action=edit', 'billing'],
    ['pharmacy', `${BASE}/admin/pharmacy/bill`, '/pharmacy/bill/view|pdf|print', 'pharmacy'],
    ['pathology', `${BASE}/admin/pathology/gettestreportbatch`, 'view|report', 'pathology'],
    ['bloodbank', `${BASE}/admin/bloodbankstatus/`, 'view|detail', 'bloodbank'],
    ['ambulance', `${BASE}/admin/vehicle/getcallambulance`, 'view|edit', 'ambulance'],
  ];
  for (const [name, url, re, prefix] of details) {
    if (Date.now() - START > BUDGET_MS) break;
    log('detail walk:', name);
    await captureDetail(page, { id: name, label: name }, url, re, prefix);
  }
  autocommit(DETAIL_DIR, 'detail walk complete');
  log('stage 2 finished');
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  try { fs.writeFileSync(path.join(OUT, 'FATAL-forms.txt'), String((e && e.stack) || e)); } catch (_) {}
  autocommit(OUT, 'forms crashed');
  process.exit(0);
});
