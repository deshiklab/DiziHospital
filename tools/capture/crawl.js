/**
 * Full application crawl for the Smart Hospital demo.
 *
 *  - logs in as superadmin
 *  - reads the sidebar menu tree (sections -> items -> sub items)
 *  - visits every distinct menu target, screenshots it and extracts a
 *    structural profile (headings, breadcrumb, forms, tables, tabs, filters,
 *    buttons, modal triggers)
 *  - autocommits every N pages so a job kill never loses the whole run
 *
 * Output:
 *   capture/pages/<id>.jpg        viewport screenshot
 *   capture/pages/<id>.json       structural profile
 *   capture/nav.json              menu tree as seen in the sidebar
 *   capture/index.json            manifest of everything captured
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.env.SH_BASE || 'https://demo.smart-hospital.in';
const USER = process.env.SH_USER || 'superadmin@gmail.com';
const PASS = process.env.SH_PASS || 'password';
const OUT = process.env.OUT_DIR || 'capture';
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '150', 10);
const PAGE_BUDGET_MS = parseInt(process.env.PAGE_BUDGET_MS || String(42 * 60 * 1000), 10);

const PAGES_DIR = path.join(OUT, 'pages');
const START = Date.now();
let sinceCommit = 0;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const ensure = (d) => fs.mkdirSync(d, { recursive: true });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45);

function autocommit(msg) {
  try {
    execFileSync('git', ['add', '-A', OUT], { stdio: 'inherit' });
    const status = execFileSync('git', ['status', '--porcelain', OUT], { encoding: 'utf8' });
    if (!status.trim()) return;
    execFileSync('git', ['config', 'user.name', 'capture-bot']);
    execFileSync('git', ['config', 'user.email', 'capture-bot@users.noreply.github.com']);
    execFileSync('git', ['commit', '-q', '-m', `chore(capture): ${msg} [skip ci]`]);
    execFileSync('git', ['push', '-q', 'origin', 'HEAD:arena/ac321db7-dizihospital']);
    log('autocommit pushed:', msg);
  } catch (e) {
    log('autocommit failed (continuing):', String(e).slice(0, 300));
  }
}

/** Remove anything that overlays the page: modals, backdrops, toasts, drawers. */
async function clearOverlays(page) {
  await page.evaluate(() => {
    const kill = ['.modal.show', '.modal-backdrop', '.swal2-container', '.bootbox', '.jq-toast-wrap',
      '.toast-container', '#shQuickAddWrap.show', '.offcanvas.show', '.daterangepicker.show', '.select2-container'];
    kill.forEach((sel) => document.querySelectorAll(sel).forEach((el) => el.remove()));
    document.querySelectorAll('body > .modal-backdrop').forEach((el) => el.remove());
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');
    document.querySelectorAll('.sh-subnav').forEach((ul) => { ul.style.display = 'block'; });
  }).catch(() => {});
}

/** Click through tabs on the page so tabbed panels get screenshotted as well. */
async function profilePage(page) {
  return await page.evaluate(() => {
    const txt = (el, n = 160) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const attr = (el, a) => el.getAttribute(a) || '';

    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5')].map((h) => txt(h, 120)).filter(Boolean);
    const breadcrumb = (() => {
      const b = document.querySelector('.breadcrumb, .page-breadcrumb, nav[aria-label="breadcrumb"], ol.breadcrumb');
      return b ? txt(b, 300) : '';
    })();
    const pageTitle = (() => {
      const candidates = ['.page-title h3', '.page-title h4', '.page-title', '.card-title', 'h1', 'h2'];
      for (const c of candidates) { const el = document.querySelector(c); if (el && txt(el)) return txt(el, 140); }
      return document.title;
    })();

    const forms = [...document.querySelectorAll('form')].map((f) => ({
      action: attr(f, 'action'),
      method: (attr(f, 'method') || 'get').toLowerCase(),
      name: attr(f, 'name') || attr(f, 'id'),
      fields: [...f.querySelectorAll('input,select,textarea')].map((i) => {
        let label = '';
        if (i.id) {
          const l = document.querySelector(`label[for="${CSS.escape(i.id)}"]`);
          if (l) label = txt(l, 90);
        }
        if (!label) {
          const wrap = i.closest('.form-group, .mb-3, .form-row, td, div');
          const l2 = wrap ? wrap.querySelector('label') : null;
          if (l2) label = txt(l2, 90);
        }
        if (!label) label = attr(i, 'placeholder') || attr(i, 'title') || attr(i, 'name');
        return {
          label, name: attr(i, 'name'), type: attr(i, 'type') || i.tagName.toLowerCase(),
          required: i.required || false,
          options: i.tagName === 'SELECT' ? [...i.options].slice(0, 25).map((o) => txt(o, 40)) : undefined,
        };
      }).filter((f) => f.type !== 'hidden'),
    })).filter((f) => f.fields.length);

    const tables = [...document.querySelectorAll('table')].map((t) => ({
      id: attr(t, 'id'), cls: attr(t, 'class').slice(0, 80),
      rows: t.rows.length,
      columns: t.tHead ? [...t.tHead.rows[0].cells].map((c) => txt(c, 60)) : [],
      sample: [...t.rows].slice(1, 3).map((r) => [...r.cells].map((c) => txt(c, 40))),
    }));

    const buttons = [...document.querySelectorAll('a.btn, button, input[type="submit"], .btn')].map((b) => ({
      text: txt(b, 60) || attr(b, 'value'), href: attr(b, 'href'),
      target: attr(b, 'data-target') || attr(b, 'data-bs-target'),
      onclick: attr(b, 'onclick').slice(0, 80),
    })).filter((b) => b.text).slice(0, 60);

    const tabs = [...document.querySelectorAll('[data-toggle="tab"],[data-bs-toggle="tab"],.nav-tabs a,.nav-pills a')]
      .map((t) => txt(t, 50)).filter(Boolean);

    const filters = [...document.querySelectorAll('input[type="date"], input[type="text"], select')]
      .map((i) => attr(i, 'placeholder') || attr(i, 'name')).filter(Boolean).slice(0, 25);

    const sections = [...document.querySelectorAll('.box-header,.card-header,.panel-heading,.box-title')]
      .map((s) => txt(s, 90)).filter(Boolean).slice(0, 40);

    const stats = [...document.querySelectorAll('.sh-stat,.small-box,.info-box,.stat-card')]
      .map((s) => txt(s, 120)).filter(Boolean).slice(0, 20);

    const addLinks = [...document.querySelectorAll('a')]
      .filter((a) => /add|new|create|register/i.test(txt(a, 40)))
      .map((a) => ({ text: txt(a, 40), href: attr(a, 'href') }))
      .filter((a) => a.href && a.href !== '#').slice(0, 15);

    return {
      url: location.href, title: document.title, pageTitle, breadcrumb, headings: headings.slice(0, 25),
      forms, tables, buttons, tabs, filters, sections, stats, addLinks,
      hasChart: !!document.querySelector('canvas, svg.chart, .chart, .apexcharts-canvas'),
    };
  }).catch((e) => ({ error: String(e).slice(0, 300) }));
}

async function main() {
  ensure(PAGES_DIR);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(40000);
  page.setDefaultNavigationTimeout(60000);

  // ---------- login ----------
  await page.goto(BASE + '/site/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[name="username"]', USER);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  log('logged in ->', page.url());

  // ---------- read nav tree ----------
  const nav = await page.evaluate(() => {
    const txt = (el, n = 120) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const out = { sections: [] };
    const root = document.querySelector('#sh-sidenav, .sh-nav, .sidebar-menu, #sidebar ul');
    if (!root) return out;
    const items = [...root.children];
    let cur = null;
    for (const li of items) {
      const cls = (li.className || '').toString();
      if (cls.includes('section') || li.tagName === 'H4' || cls.includes('header')) {
        cur = { name: txt(li, 60), items: [] };
        out.sections.push(cur);
        continue;
      }
      const a = li.querySelector(':scope > a');
      if (!a) continue;
      const sub = li.querySelector(':scope > ul.sh-subnav, :scope > ul.submenu, :scope > ul');
      const item = {
        label: txt(a, 70),
        href: a.getAttribute('href') || '',
        children: sub ? [...sub.querySelectorAll(':scope > li > a')].map((c) => ({
          label: txt(c, 70), href: c.getAttribute('href') || '',
        })) : [],
      };
      if (!cur) { cur = { name: 'Main', items: [] }; out.sections.push(cur); }
      cur.items.push(item);
    }
    return out;
  });
  fs.writeFileSync(path.join(OUT, 'nav.json'), JSON.stringify(nav, null, 2));
  log('nav read');

  // ---------- build crawl queue ----------
  const queue = [];
  const seen = new Set();
  const add = (label, href, section, parent) => {
    if (!href || href === '#' || href.startsWith('javascript')) return;
    const url = href.startsWith('http') ? href : BASE + href;
    if (!url.includes('/admin/')) return;
    const clean = url.split('?')[0];
    if (seen.has(clean)) return;
    seen.add(clean);
    queue.push({ label, url, section, parent });
  };
  for (const sec of nav.sections) {
    for (const it of sec.items) {
      if (it.children && it.children.length) {
        for (const c of it.children) add(`${it.label} › ${c.label}`, c.href, sec.name, it.label);
        add(it.label, it.href, sec.name, '(parent)');
      } else {
        add(it.label, it.href, sec.name, '');
      }
    }
  }
  log('queue size', queue.length);

  // ---------- crawl ----------
  const index = [];
  for (let n = 0; n < Math.min(queue.length, MAX_PAGES); n++) {
    if (Date.now() - START > PAGE_BUDGET_MS) { log('page budget exhausted'); break; }
    const item = queue[n];
    const id = String(n + 1).padStart(3, '0') + '-' + slug(item.label);
    const rec = { id, ...item, ok: false };
    try {
      const resp = await page.goto(item.url, { waitUntil: 'domcontentloaded' });
      rec.status = resp ? resp.status() : null;
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(900);
      await clearOverlays(page);
      await page.screenshot({ path: path.join(PAGES_DIR, id + '.jpg'), type: 'jpeg', quality: 88 });
      rec.profile = await profilePage(page);
      rec.ok = true;
      log(`[${n + 1}/${queue.length}] ${id} status=${rec.status}`);
    } catch (e) {
      rec.error = String(e).split('\n')[0].slice(0, 250);
      log(`[${n + 1}/${queue.length}] ${id} ERROR ${rec.error}`);
      try { await page.screenshot({ path: path.join(PAGES_DIR, id + '.jpg'), type: 'jpeg', quality: 80 }); } catch (_) {}
    }
    index.push(rec);
    fs.writeFileSync(path.join(PAGES_DIR, id + '.json'), JSON.stringify(rec, null, 1));
    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
    if (++sinceCommit >= 15) { sinceCommit = 0; autocommit(`crawl ${n + 1}/${queue.length}`); }
  }

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  autocommit('final crawl state');
  log('crawl finished; pages captured:', index.filter((i) => i.ok).length, '/', index.length);
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  try { fs.writeFileSync(path.join(OUT, 'FATAL-crawl.txt'), String((e && e.stack) || e)); } catch (_) {}
  autocommit('crawl crashed');
  process.exit(0);
});
