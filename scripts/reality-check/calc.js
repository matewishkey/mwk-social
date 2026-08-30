#!/usr/bin/env node
/*
 * The calculation cards — the working, shown.
 *
 * This is the half a fact-check actually rests on: a conclusion nobody can
 * follow is just another claim. Each line is one step, the running subtotals
 * are marked, and the answer sits under a rule at the bottom.
 *
 *   node calc.js calc.json out/ [portrait|landscape]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const kit = require('./brandkit.js');

const SIZES = { portrait: [1080, 1350], landscape: [1536, 820] };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function html(c, shape) {
  const [W, H] = SIZES[shape];
  const p = shape === 'portrait';
  /*
   * A card with six steps cannot use the type size of one with three. The scale
   * is derived from the step count rather than hand-tuned per card, so a new
   * episode with a longer sum shrinks instead of overflowing — and the overflow
   * check below stays the backstop rather than the thing that catches it.
   */
  const k = c.lines.length > 4 ? (p ? 0.84 : 0.74) : 1;
  const r = (n) => Math.round(n * k * 10) / 10;
  const lines = c.lines.map(([k, v, kind]) =>
    `<div class="ln ${kind || ''}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  return `<!doctype html><meta charset="utf-8">
<style>
${kit.FONTS}
${kit.TOKENS}
*{box-sizing:border-box;margin:0;padding:0}
${kit.BLOCK_CSS}
${kit.SIGNOFF_CSS}
.card{width:${W}px;height:${H}px;background:var(--paper);color:var(--ink);display:flex;
  flex-direction:column;padding:${p ? '64px 68px 44px' : '52px 64px 38px'};
  font-family:Manrope,sans-serif;overflow:hidden}
.kicker{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:${p ? 20 : 18}px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--redDeep)}
h2{font-family:Fraunces,serif;font-weight:700;font-size:${r(p ? 60 : 52)}px;line-height:1.04;
  margin-top:20px;letter-spacing:-.014em}
.calc{margin-top:${r(p ? 40 : 30)}px}
.ln{display:flex;justify-content:space-between;align-items:baseline;gap:24px;
  padding:${r(p ? 15 : 12)}px 0;border-bottom:2px solid var(--line)}
.ln span{font-weight:500;font-size:${r(p ? 34 : 28)}px;line-height:1.2;color:var(--mute)}
.ln b{font-family:Fraunces,serif;font-weight:700;font-size:${r(p ? 40 : 34)}px;
  white-space:nowrap;color:var(--mute)}
/* A subtotal is where a step ends. It is the only thing that goes to full ink. */
.ln.sum span{color:var(--ink);font-weight:800}
.ln.sum b{color:var(--ink)}
.ln.sum{border-bottom:3px solid var(--ink)}
.total{margin-top:auto;padding-top:${r(p ? 26 : 20)}px;border-top:4px solid var(--red);
  display:flex;justify-content:space-between;align-items:baseline;gap:24px}
.total span{font-weight:800;font-size:${r(p ? 34 : 30)}px;line-height:1.2;max-width:${p ? 540 : 740}px}
.total b{font-family:Fraunces,serif;font-weight:700;font-size:${r(p ? 84 : 72)}px;
  line-height:1;white-space:nowrap;letter-spacing:-.02em}
.total.bad b{color:var(--redDeep)}
.fine{font-weight:400;font-size:${p ? 19 : 17}px;line-height:1.35;color:var(--faint);
  margin-top:${p ? 18 : 14}px}
.ft{margin-top:${p ? 26 : 20}px;padding-top:${p ? 20 : 16}px;border-top:2px solid var(--line)}
</style>
<div class="card">
  <div class="kicker">${esc(c.kicker)}</div>
  <h2>${esc(c.title)}</h2>
  <div class="calc">${lines}</div>
  <div class="total ${esc(c.total[2] || '')}"><span>${esc(c.total[0])}</span><b>${esc(c.total[1])}</b></div>
  <p class="fine">${esc(c.fine)}</p>
  <div class="ft">${kit.signoff({ size: p ? 56 : 50 })}</div>
</div>`;
}

(async () => {
  const [jsonPath, outDir, shape = 'portrait'] = process.argv.slice(2);
  if (!SIZES[shape]) { console.error('shape: portrait | landscape'); process.exit(64); }
  const d = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const [W, H] = SIZES[shape];
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const c of d.cards) {
    await page.setContent(html(c, shape), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(outDir, `${d.episode}-${c.n}-${shape}.png`);
    await page.locator('.card').screenshot({ path: file });
    const over = await page.evaluate(() => {
      const el = document.querySelector('.card');
      return el.scrollHeight - el.clientHeight;
    });
    console.log(`${path.basename(file)}  ${over > 0 ? `OVERFLOW ${over}px` : 'fits'}  ${c.kicker}`);
  }
  await b.close();
})();
