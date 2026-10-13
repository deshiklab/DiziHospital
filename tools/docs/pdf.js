/**
 * Convert docs/build/guide.html into the printable PDF with headless Chromium.
 * Run from the repository root:  node tools/docs/pdf.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'docs', 'build', 'guide.html');
const OUT = path.join(ROOT, 'docs', 'Smart-Hospital-Complete-Guide.pdf');

(async () => {
  if (!fs.existsSync(SRC)) { console.error('missing', SRC); process.exit(1); }
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file://' + SRC, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  // give charts/images/fonts a moment
  await page.waitForTimeout(2500);
  await page.evaluate(() => new Promise((r) => {
    const imgs = [...document.images].filter((i) => !i.complete);
    if (!imgs.length) return r();
    let n = imgs.length;
    imgs.forEach((i) => { i.onload = i.onerror = () => { if (--n === 0) r(); }; });
    setTimeout(r, 20000);
  }));

  // confirm in the browser that every screenshot actually decoded
  const browserCheck = await page.evaluate(() => {
    const imgs = [...document.images];
    const broken = imgs
      .filter((i) => !i.complete || i.naturalWidth === 0)
      .map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth }));
    return { total: imgs.length, broken, ok: imgs.length - broken.length };
  });
  fs.writeFileSync(path.join(ROOT, 'docs', 'build', 'image-report-browser.json'), JSON.stringify(browserCheck, null, 1));
  console.log('browser image check: ' + browserCheck.ok + '/' + browserCheck.total + ' decoded');
  browserCheck.broken.slice(0, 25).forEach((x) => console.error('   BROKEN IMAGE:', x.src));
  await page.pdf({
    path: OUT,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size:7pt;color:#93a5b3;width:100%;padding:0 14mm;">Smart Hospital — Complete Guide · Feature Catalogue &amp; Wiki</div>',
    footerTemplate: '<div style="font-size:7pt;color:#93a5b3;width:100%;padding:0 14mm;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: '20mm', bottom: '16mm', left: '14mm', right: '14mm' },
  });
  await browser.close();
  const kb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log('pdf written:', OUT, kb + ' MB');
  process.exit(browserCheck.broken.length ? 2 : 0);
})();
