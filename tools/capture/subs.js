/**
 * Stage 4 - sub-screens and record views that are reachable from the menu but
 * are not menu entries themselves (single-module billing, imports, profiles,
 * report viewers, returns, discharged list ...).
 *
 * Output: capture/subs/<id>.{jpg,json}  and  capture/detail2/*.{jpg,json}
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { BASE, log, ensure, slug, autocommit, login, clearOverlays, profilePage } = require('./lib');

const OUT = process.env.OUT_DIR || 'capture';
const SUBS = path.join(OUT, 'subs');
const DETAIL = path.join(OUT, 'detail2');
let sinceCommit = 0;

// label, url, note
const TARGETS = [
  ['Billing - Appointment module', '/admin/bill/appointment', 'Single-module billing: appointment charges'],
  ['Billing - OPD module', '/admin/bill/opd', 'Single-module billing: OPD charges'],
  ['Billing - Pathology module', '/admin/bill/pathology', 'Single-module billing: laboratory charges'],
  ['Billing - Radiology module', '/admin/bill/radiology', 'Single-module billing: imaging charges'],
  ['Billing - Issue Blood', '/admin/bill/issueblood', 'Blood issue billing'],
  ['Billing - Issue Component', '/admin/bill/issuecomponent', 'Blood component billing'],
  ['Billing - Bill dashboard', '/admin/bill/dashboard', 'Billing dashboard: module-wise collection, unpaid and overdue'],
  ['Billing - OPD bill screen', '/admin/bill/opd', 'OPD bill: pick case, add charges, take payment'],
  ['Patient import', '/admin/patient/import', 'Bulk patient import'],
  ['Discharged patients', '/admin/patient/discharged_patients', 'Discharged patient register'],
  ['Pharmacy search', '/admin/pharmacy/search', 'Pharmacy sale search'],
  ['Pharmacy sale return bills', '/admin/pharmacy/salereturnbills', 'Sale return / refund register'],
  ['Pathology search', '/admin/pathology/search', 'Laboratory search'],
  ['Radiology search', '/admin/radio/search', 'Imaging search'],
  ['Blood bank status board', '/admin/bloodbankstatus', 'Live blood bank status'],
  ['Staff attendance register', '/admin/qrattendance/attendance/index', 'Staff attendance register'],
  ['Payroll', '/admin/payroll', 'Payroll list'],
  ['Appointment queue', '/admin/appointment/index', 'Appointment queue / doctor-wise view'],
  ['OPD patient view', '/admin/patient/search', 'OPD visit list with the patient view drawer'],
];

async function captureSubs(page) {
  ensure(SUBS);
  const out = [];
  for (let i = 0; i < TARGETS.length; i++) {
    const [label, url] = TARGETS[i];
    const id = String(i + 1).padStart(2, '0') + '-' + slug(label);
    if (fs.existsSync(path.join(SUBS, id + '.json'))) { log('skip', id); continue; }
    try {
      const resp = await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await clearOverlays(page);
      await page.screenshot({ path: path.join(SUBS, id + '.jpg'), type: 'jpeg', quality: 88 });
      const prof = await profilePage(page);
      const rec = { id, label, url, status: resp ? resp.status() : null, profile: prof, file: id + '.jpg' };
      fs.writeFileSync(path.join(SUBS, id + '.json'), JSON.stringify(rec, null, 1));
      out.push(rec);
      log(`[${i + 1}/${TARGETS.length}] ${id} status=${rec.status} title=${(prof.pageTitle || '').slice(0, 40)}`);
    } catch (e) {
      log(`[${i + 1}] ${id} ERROR ${String(e).slice(0, 140)}`);
      fs.writeFileSync(path.join(SUBS, id + '.json'), JSON.stringify({ id, label, url, error: String(e).slice(0, 200) }, null, 1));
    }
    if (++sinceCommit >= 6) { sinceCommit = 0; autocommit(SUBS, `subs ${id}`); }
  }
  autocommit(SUBS, 'sub-screens complete');
  return out;
}

/** Open a record, then walk every tab of that record. */
async function captureRecord(page, listUrl, linkRe, name) {
  ensure(DETAIL);
  const base = path.join(DETAIL, name);
  if (fs.existsSync(base + '.json')) { log('skip record', name); return; }
  try {
    await page.goto(BASE + listUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await clearOverlays(page);
    const href = await page.evaluate((re) => {
      const rx = new RegExp(re, 'i');
      const a = [...document.querySelectorAll('a[href]')].find((x) => rx.test(x.getAttribute('href') || '') && (x.offsetWidth || x.offsetHeight));
      return a ? a.href : '';
    }, linkRe);
    if (!href) { log('no link for', name, linkRe); return; }
    log('record:', name, href);
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await clearOverlays(page);
    await page.screenshot({ path: base + '.jpg', type: 'jpeg', quality: 90 });
    const prof = await profilePage(page);
    fs.writeFileSync(base + '.json', JSON.stringify({ name, listUrl, href, profile: prof, file: name + '.jpg' }, null, 1));
    // walk every tab of the record
    const tabs = await page.$$('.nav-tabs a, .nav-pills a, a[data-toggle="tab"], a[data-bs-toggle="tab"], .nav-link[role="tab"]');
    const seen = new Set();
    for (let i = 0; i < Math.min(tabs.length, 14); i++) {
      try {
        const label = (await tabs[i].innerText()).replace(/\s+/g, ' ').trim();
        if (!label || seen.has(label)) continue;
        seen.add(label);
        await tabs[i].click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(1400);
        await clearOverlays(page);
        const tid = `${name}__tab-${i + 1}-${slug(label)}`;
        if (fs.existsSync(path.join(DETAIL, tid + '.json'))) continue;
        await page.screenshot({ path: path.join(DETAIL, tid + '.jpg'), type: 'jpeg', quality: 88 });
        const p = await profilePage(page);
        fs.writeFileSync(path.join(DETAIL, tid + '.json'), JSON.stringify({ record: name, tab: label, index: i, url: page.url(), profile: p, file: tid + '.jpg' }, null, 1));
        log('  tab:', label);
      } catch (e) { log('  tab failed', String(e).slice(0, 100)); }
    }
    autocommit(DETAIL, `record ${name}`);
  } catch (e) {
    log('record failed', name, String(e).slice(0, 160));
  }
}

/** Visit a record URL discovered by pattern on a list page, then walk its tabs. */
async function captureExplicit(page, urlRe, listUrl, name) {
  ensure(DETAIL);
  const base = path.join(DETAIL, name);
  if (fs.existsSync(base + '.json')) { log('skip record', name); return; }
  try {
    await page.goto(BASE + listUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const href = await page.evaluate((re) => {
      const rx = new RegExp(re, 'i');
      const a = [...document.querySelectorAll('a[href]')].find((x) => rx.test(x.getAttribute('href') || ''));
      return a ? a.href : '';
    }, urlRe);
    if (!href) { log('no explicit link for', name); return; }
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await clearOverlays(page);
    await page.screenshot({ path: base + '.jpg', type: 'jpeg', quality: 90 });
    const prof = await profilePage(page);
    fs.writeFileSync(base + '.json', JSON.stringify({ name, listUrl, href, profile: prof, file: name + '.jpg' }, null, 1));
    const tabs = await page.$$('.nav-tabs a, .nav-pills a, a[data-toggle="tab"], a[data-bs-toggle="tab"], .nav-link[role="tab"]');
    const seen = new Set();
    for (let i = 0; i < Math.min(tabs.length, 14); i++) {
      try {
        const label = (await tabs[i].innerText()).replace(/\s+/g, ' ').trim();
        if (!label || seen.has(label)) continue;
        seen.add(label);
        await tabs[i].click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(1300);
        await clearOverlays(page);
        const tid = `${name}__tab-${i + 1}-${slug(label)}`;
        if (fs.existsSync(path.join(DETAIL, tid + '.json'))) continue;
        await page.screenshot({ path: path.join(DETAIL, tid + '.jpg'), type: 'jpeg', quality: 88 });
        const p = await profilePage(page);
        fs.writeFileSync(path.join(DETAIL, tid + '.json'), JSON.stringify({ record: name, tab: label, index: i, url: page.url(), profile: p, file: tid + '.jpg' }, null, 1));
        log('  tab:', label);
      } catch (e) { log('  tab failed', String(e).slice(0, 100)); }
    }
    autocommit(DETAIL, `record ${name}`);
  } catch (e) { log('explicit record failed', name, String(e).slice(0, 160)); }
}

async function main() {
  ensure(SUBS); ensure(DETAIL);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(40000);
  page.setDefaultNavigationTimeout(70000);
  log('login ->', await login(page, process.env.SH_USER, process.env.SH_PASS));

  await captureSubs(page);

  await captureRecord(page, '/admin/patient/search', '/admin/patient/profile/\\d+', 'opd-profile');
  await captureExplicit(page, '/admin/patient/profile/\\d+/\\d+', '/admin/patient/search', 'opd-profile-2');
  await captureRecord(page, '/admin/patient/ipdsearch', '/admin/patient/ipdprofile/\\d+', 'ipd-profile');
  await captureRecord(page, '/admin/admin/search', '/admin/patient/profile/\\d+', 'patient-profile');
  await captureRecord(page, '/admin/bill/dashboard', '/admin/bill/(opd|appointment|pharmacy)', 'billing-screen');

  log('stage 4 finished');
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  try { fs.writeFileSync(path.join(OUT, 'FATAL-subs.txt'), String((e && e.stack) || e)); } catch (_) {}
  autocommit(OUT, 'subs crashed');
  process.exit(0);
});
