/**
 * Shared helpers for the Smart Hospital capture toolkit.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.env.SH_BASE || 'https://demo.smart-hospital.in';
const BRANCH = 'arena/ac321db7-dizihospital';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const ensure = (d) => fs.mkdirSync(d, { recursive: true });
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45);

function autocommit(dir, msg) {
  try {
    execFileSync('git', ['add', '-A', dir], { stdio: 'inherit' });
    const status = execFileSync('git', ['status', '--porcelain', dir], { encoding: 'utf8' });
    if (!status.trim()) return;
    execFileSync('git', ['config', 'user.name', 'capture-bot']);
    execFileSync('git', ['config', 'user.email', 'capture-bot@users.noreply.github.com']);
    execFileSync('git', ['commit', '-q', '-m', `chore(capture): ${msg} [skip ci]`]);
    execFileSync('git', ['push', '-q', 'origin', `HEAD:${BRANCH}`]);
    log('autocommit pushed:', msg);
  } catch (e) {
    log('autocommit failed (continuing):', String(e).slice(0, 200));
  }
}

async function login(page, user, pass) {
  await page.goto(BASE + '/site/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  return page.url();
}

async function clearOverlays(page) {
  await page.evaluate(() => {
    ['.modal.show', '.modal-backdrop', '.swal2-container', '.bootbox', '.jq-toast-wrap',
      '.toast-container', '#shQuickAddWrap.show', '.offcanvas.show', '.daterangepicker.show'].forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    });
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

async function profilePage(page) {
  return await page.evaluate(() => {
    const txt = (el, n = 200) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const attr = (el, a) => el.getAttribute(a) || '';
    const labelFor = (i) => {
      if (i.id) {
        const l = document.querySelector(`label[for="${CSS.escape(i.id)}"]`);
        if (l) return txt(l, 90);
      }
      const wrap = i.closest('.form-group, .mb-3, .form-row, td, div');
      const l2 = wrap ? wrap.querySelector('label') : null;
      if (l2) return txt(l2, 90);
      return attr(i, 'placeholder') || attr(i, 'title') || attr(i, 'name');
    };
    return {
      url: location.href, title: document.title,
      pageTitle: (() => {
        for (const c of ['.page-title h3', '.page-title h4', '.page-title', '.card-title', 'h1', 'h2', 'h3']) {
          const el = document.querySelector(c);
          if (el && txt(el)) return txt(el, 140);
        }
        return document.title;
      })(),
      breadcrumb: (() => {
        const b = document.querySelector('.breadcrumb, .page-breadcrumb, ol.breadcrumb');
        return b ? txt(b, 300) : '';
      })(),
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5')].map((h) => txt(h, 140)).filter(Boolean).slice(0, 30),
      forms: [...document.querySelectorAll('form')].map((f) => ({
        action: attr(f, 'action'), method: (attr(f, 'method') || 'get').toLowerCase(),
        name: attr(f, 'name') || attr(f, 'id'), visible: !!(f.offsetWidth || f.offsetHeight),
        fields: [...f.querySelectorAll('input,select,textarea')].map((i) => ({
          label: labelFor(i), name: attr(i, 'name'), type: attr(i, 'type') || i.tagName.toLowerCase(),
          required: !!i.required,
          options: i.tagName === 'SELECT' ? [...i.options].slice(0, 30).map((o) => txt(o, 40)) : undefined,
        })).filter((x) => x.type !== 'hidden'),
      })).filter((f) => f.fields.length),
      tables: [...document.querySelectorAll('table')].map((t) => ({
        id: attr(t, 'id'), rows: t.rows.length,
        columns: t.tHead && t.tHead.rows[0] ? [...t.tHead.rows[0].cells].map((c) => txt(c, 60)) : [],
      })),
      tabs: [...document.querySelectorAll('[data-toggle="tab"],[data-bs-toggle="tab"],.nav-tabs a,.nav-pills a,.nav-link[role="tab"]')]
        .map((t) => txt(t, 60)).filter(Boolean).slice(0, 30),
      sections: [...document.querySelectorAll('.box-header,.card-header,.panel-heading,.box-title')]
        .map((s) => txt(s, 90)).filter(Boolean).slice(0, 40),
      buttons: [...document.querySelectorAll('a.btn, button, input[type="submit"], .btn')]
        .filter((b) => b.offsetWidth || b.offsetHeight)
        .map((b) => ({ text: txt(b, 60) || attr(b, 'value'), href: attr(b, 'href'), target: attr(b, 'data-target') || attr(b, 'data-bs-target') }))
        .filter((b) => b.text).slice(0, 60),
      anchors: [...document.querySelectorAll('table a[href], .card a[href], .box a[href]')]
        .map((a) => ({ t: txt(a, 40), h: a.getAttribute('href') })).slice(0, 80),
    };
  }).catch((e) => ({ error: String(e).slice(0, 300) }));
}

module.exports = { BASE, BRANCH, log, ensure, slug, autocommit, login, clearOverlays, profilePage };
