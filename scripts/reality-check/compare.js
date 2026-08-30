#!/usr/bin/env node
/*
 * The comparison card, in two shapes from one description.
 *
 * Typography, colour and the logo come from brandkit.js, which reads the published
 * design system rather than approximating it. Colour is a signal, not decoration:
 * ink and mute carry the card, redDeep marks the numbers that decide it, and the
 * four columns are told apart by ICON — four colours would mean none of them said
 * anything.
 *
 *   node compare.js compare.json out/ landscape|portrait
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const kit = require('./brandkit.js');
const { validate } = require('./validate.js');

const SIZES = { landscape: [1536, 1470], portrait: [1080, 1350] };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/*
 * 24px grid, stroke only, and each sits in a square chip so the icon language
 * echoes the RedBlock rather than competing with it.
 */
const ICONS = {
  bank:  '<path d="M3 21h18M4 21V10m4 11V10m4 11V10m4 11V10m4 11V10M2.5 10h19L12 3.5z"/>',
  card:  '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9.5h19M6 15h3.5"/>',
  rise:  '<path d="M3 20V4M3 20h18"/><path d="M7 16l4-5 3 3 5-7"/><path d="M15.5 7H19v3.5"/>',
  glass: '<path d="M7 3h10M7 21h10M8 3v3.2c0 1.6 1.2 2.6 2.4 3.6L12 11l1.6-1.2C14.8 8.8 16 7.8 16 6.2V3M8 21v-3.2c0-1.6 1.2-2.6 2.4-3.6L12 13l1.6 1.2c1.2 1 2.4 2 2.4 3.6V21"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3M8 17.5h8"/>',
};
const chip = (n, s) => {
  // An unknown name used to render an empty square in silence — two of the four
  // did exactly that after a rename. It is a throw now.
  if (!ICONS[n]) throw new Error(`no icon called "${n}" — have ${Object.keys(ICONS).join(', ')}`);
  return `<span class="chip" style="width:${s}px;height:${s}px">
  <svg viewBox="0 0 24 24" width="${Math.round(s * 0.62)}" height="${Math.round(s * 0.62)}" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg></span>`;
};


/*
 * The ranking chart. A column of numbers says what each option costs; only a bar
 * says which is best at a glance, and that was the thing missing.
 *
 * The two groups get their OWN scale and say so, because $126 and $3,600 answer
 * different questions — 50 days against a year — and one axis across both would
 * flatten the near options into nothing and imply they are comparable.
 */
function charts(d, p) {
  return d.charts.map((g) => {
    const max = Math.max(...g.bars.map((b) => b.value)) || 1;
    const bars = g.bars.map((b) => {
      const w = b.value === 0 ? 0 : Math.max(3, (b.value / max) * 100);
      return `<div class="bar ${b.tone}">
        <span class="blab">${esc(b.label)}<u>${esc(b.period)}</u>${b.rank ? `<i>${esc(b.rank)}</i>` : ''}</span>
        <span class="btrack"><span class="bfill" style="width:${w}%"></span></span>
        <span class="bval">${esc(b.show)}</span></div>`;
    }).join('');
    return `<div class="cgroup"><h4>${esc(g.head)}<em>${esc(g.note)}</em></h4>${bars}</div>`;
  }).join('');
}

function html(d, shape, page = 0) {
  const [W, H] = SIZES[shape];
  const p = shape === 'portrait';
  const one = page === 1, two = page === 2, three = page === 3;  // portrait is three cards
  const cols = d.columns.map((c) => `
    <section class="col ${c.mark}">
      <header>${chip(c.icon, p ? 40 : 38)}<h3>${esc(c.name)}</h3></header>
      <div class="lead"><b>${esc(c.lead)}</b><em>${esc(c.leadNote)}</em></div>
      <dl>${c.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <p class="verdict">${esc(c.verdict)}</p>
    </section>`).join('');

  return `<!doctype html><meta charset="utf-8"><style>
${kit.FONTS}
${kit.TOKENS}
*{box-sizing:border-box;margin:0;padding:0}
${kit.BLOCK_CSS}
${kit.SIGNOFF_CSS}
.card{width:${W}px;height:${H}px;background:var(--paper);color:var(--ink);display:flex;
  flex-direction:column;font-family:Manrope,sans-serif;overflow:hidden}
.hd{padding:${p ? '34px 36px 16px' : '30px 38px 16px'};border-bottom:3px solid var(--red)}
h1{font-family:Fraunces,serif;font-weight:700;font-size:${p ? 46 : 52}px;line-height:1.02;
  letter-spacing:-.012em}
.hd p{font-family:Manrope,sans-serif;font-weight:500;font-size:${p ? 19 : 20}px;color:var(--mute);margin-top:9px}
.cols{display:grid;gap:${p ? 13 : 12}px;padding:${p ? '17px 24px 0' : '18px 24px 0'};
  grid-template-columns:repeat(${p ? 2 : 5},1fr)}
.col{border:2px solid var(--line);border-radius:10px;padding:${p ? '12px 13px' : '16px 16px'};
  display:flex;flex-direction:column;background:#fff}
.col header{display:flex;gap:12px;align-items:center}
.chip{display:inline-flex;align-items:center;justify-content:center;border:2px solid var(--ink);
  color:var(--ink);flex:none;border-radius:0}
.col h3{font-family:Manrope,sans-serif;font-weight:800;font-size:${p ? 16.5 : 19}px;line-height:1.14}
.lead{display:flex;align-items:baseline;gap:9px;margin:${p ? 10 : 16}px 0 2px}
.lead b{font-family:Fraunces,serif;font-weight:700;font-size:${p ? 40 : 52}px;line-height:1;
  letter-spacing:-.02em}
.lead em{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:${p ? 13 : 13}px;
  font-style:normal;color:var(--mute);text-transform:uppercase;letter-spacing:.16em}
/* redDeep is the only red allowed at body size; the plain red is the rule and the block. */
/* One rule, everywhere: a cost is redDeep, nothing to pay is green, and the
   last row of every column is the answer. Nothing is left in plain ink by
   accident — that was the inconsistency. */
.col.bad .lead b,.col.warn .lead b{color:var(--redDeep)}
.col.good .lead b{color:#1A7F4B}
.col.bad{border-color:#f2cdca}
.col.good{border-color:#bfe0cd}
dl{margin-top:12px;border-top:2px solid var(--line)}
dl>div{display:flex;justify-content:space-between;gap:10px;align-items:baseline;
  padding:${p ? 6 : 8.5}px 0;border-bottom:2px solid var(--line)}
dt{font-weight:500;font-size:${p ? 14 : 16.5}px;line-height:1.2;color:var(--mute)}
dd{font-family:Fraunces,serif;font-weight:700;font-size:${p ? 17 : 20.5}px;white-space:nowrap}
dl>div:last-child dt{color:var(--ink);font-weight:800}
.col.bad dl>div:last-child dd,.col.warn dl>div:last-child dd{color:var(--redDeep)}
.col.good dl>div:last-child dd{color:#1A7F4B}
.verdict{margin-top:10px;font-weight:500;font-size:${p ? 13.5 : 16}px;line-height:1.32;color:var(--mute)}
.charts{display:flex;gap:${p ? 16 : 22}px;padding:${p ? '16px 24px 0' : '18px 26px 0'};
  ${p ? 'flex-direction:column;' : ''}}
.cgroup{flex:1}
.cgroup h4{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:${p ? 13.5 : 14}px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--ink);margin-bottom:11px;
  display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.cgroup h4 em{font-style:normal;letter-spacing:.1em;color:var(--faint);font-size:${p ? 11.5 : 12}px}
.bar{display:flex;align-items:center;gap:14px;padding:5px 0}
.blab{flex:0 0 ${p ? 250 : 300}px;font-weight:600;font-size:${p ? 15.5 : 16}px;line-height:1.2;color:var(--mute)}
.blab u{text-decoration:none;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:10.5px;
  letter-spacing:.13em;text-transform:uppercase;color:var(--faint);margin-left:8px}
.blab i{font-style:normal;display:inline-block;font-family:'JetBrains Mono',monospace;font-weight:700;
  font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-left:7px;padding:1px 5px;
  background:var(--ink);color:var(--paper);vertical-align:1px}
.btrack{flex:1;height:${p ? 22 : 24}px;background:var(--line);border-radius:0;position:relative}
.bfill{position:absolute;left:0;top:0;bottom:0;background:var(--faint)}
.bar.good .bfill{background:#1A7F4B} .bar.good .blab i{background:#1A7F4B}
.bar.warn .bfill{background:var(--redDeep)}
.bar.bad .bfill{background:var(--red)} .bar.bad .blab i{background:var(--red)}
.bval{flex:0 0 ${p ? 92 : 96}px;text-align:right;font-family:Fraunces,serif;font-weight:700;
  font-size:${p ? 26 : 27}px;line-height:1}
.bar.good .bval{color:#1A7F4B}
.bar.warn .bval,.bar.bad .bval{color:var(--redDeep)}
.cnote{margin:${p ? '14px 24px 0' : '15px 26px 0'};padding:8px 12px;font-size:${p ? 13.5 : 14}px;
  color:var(--ink);font-weight:700;line-height:1.3;background:#fdecea;border-left:4px solid var(--red)}
.bit.warn b{color:var(--redDeep)} .bit.good b{color:#7ee0a8}
.lodge{margin:${p ? '14px 24px 0' : '15px 26px 0'};padding:${p ? '11px 15px' : '12px 16px'};
  background:var(--ink);color:var(--paper);display:flex;gap:14px;align-items:baseline;
  ${p ? 'flex-direction:column;gap:5px;' : ''}}
.lodge b{font-family:Fraunces,serif;font-weight:700;font-size:${p ? 21 : 22}px;flex:none;line-height:1.1}
.lodge span{font-weight:500;font-size:${p ? 14 : 14.5}px;line-height:1.32;color:rgba(252,250,250,.75)}
.mid{display:flex;gap:${p ? 13 : 12}px;padding:${p ? '14px 24px 0' : '15px 24px 0'};
  ${p ? 'flex-direction:column;' : 'align-items:stretch;'}}
.gen{flex:${p ? 'none' : '1'};border:2px solid var(--line);border-left:5px solid var(--red);
  border-radius:10px;padding:${p ? '14px 17px' : '15px 18px'};background:#fff}
.gen h4{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:${p ? 13.5 : 14}px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--redDeep);margin-bottom:10px}
.gen ul{list-style:none}
.gen li{font-weight:500;font-size:${p ? 15 : 15.5}px;line-height:1.3;color:var(--mute);
  padding:4px 0 4px 18px;position:relative}
.gen li::before{content:"";position:absolute;left:0;top:${p ? 12 : 12.5}px;width:9px;height:2px;background:var(--faint)}
.gen .close{margin-top:10px;font-family:Fraunces,serif;font-weight:700;
  font-size:${p ? 20 : 21}px;line-height:1.2;color:var(--ink)}
.gen .close b{color:var(--redDeep)}
.box{flex:${p ? 'none' : '1.1'};border-radius:10px;background:var(--dark);color:var(--onDark);
  padding:${p ? '15px 18px' : '15px 19px'}}
.box h4{font-family:Fraunces,serif;font-weight:700;font-size:${p ? 24 : 24}px;line-height:1.08}
.box h4 span{color:var(--redDeep)}
.box .bits{display:flex;gap:${p ? 14 : 15}px;margin-top:12px}
.bit{flex:1}
.bit .q{display:block;font-weight:700;font-size:${p ? 14 : 14.5}px;line-height:1.28;
  color:var(--onDark);margin-bottom:6px}
.bit b{display:block;font-family:Fraunces,serif;font-weight:700;font-size:${p ? 30 : 32}px;line-height:1}
.bit span{display:block;font-weight:500;font-size:${p ? 12.5 : 12.5}px;line-height:1.25;
  color:var(--darkMute);margin-top:5px}
.box .note{font-weight:500;font-size:${p ? 12.5 : 12.5}px;line-height:1.32;color:var(--darkMute);margin-top:11px}
.stamp{margin:${p ? '13px 24px 0' : '14px 26px 0'};font-family:'JetBrains Mono',monospace;
  font-weight:700;font-size:${p ? 12 : 12.5}px;line-height:1.4;color:var(--mute);letter-spacing:.02em}
.ft{margin:auto 24px 0;padding:${p ? '16px 0 20px' : '16px 0 20px'};border-top:2px solid var(--line)}
</style>
<div class="card">
  <div class="hd"><h1>${esc(two ? d.title2 : three ? d.title3 : d.title)}</h1>
    <p>${esc(two ? d.sub2 : three ? d.sub3 : d.sub)}</p></div>
  ${two || three ? '' : `<p class="cnote">${esc(d.chartNote)}</p>
  <div class="charts">${charts(d, p)}</div>`}
  ${one || three ? '' : `<div class="cols">${cols}</div>`}
  ${two || three ? '' : `<div class="lodge"><b>${esc(d.lodge.title)}</b><span>${esc(d.lodge.text)}</span></div>`}
  ${one || two ? '' : `<div class="mid">
    <div class="gen">
      <h4>${esc(d.generous.title)}</h4>
      <ul>${d.generous.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="close">${esc(d.generous.close).replace(/\$126/, '<b>$126</b>')}</p>
    </div>
    <div class="box">
      <h4>${esc(d.box.title).replace('a trap', 'a <span>trap</span>')}</h4>
      <div class="bits">${d.box.rows.filter((r) => r[1]).map((r) => {
        const under = (d.box.rows[d.box.rows.indexOf(r) + 1] || [])[0] || '';
        return `<div class="bit ${esc(r[2] || '')}"><span class="q">${esc(r[0])}</span>
          <b>${esc(r[1])}</b><span>${esc(under)}</span></div>`;
      }).join('')}</div>
      <p class="note">${esc(d.box.note)}</p>
    </div>
  </div>`}
  <p class="stamp">${esc(d.stamp)}</p>
  <div class="ft">${kit.signoff({ size: p ? 60 : 66, note: three || !p ? esc(d.fine) : '' })}</div>
</div>`;
}

(async () => {
  const [jsonPath, outDir, shape = 'landscape'] = process.argv.slice(2);
  if (!SIZES[shape]) { console.error('shape: landscape | portrait'); process.exit(64); }
  const d = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const problems = validate(d);
  if (problems.length) {
    console.error(`${jsonPath} will not render:\n  ${problems.join('\n  ')}`);
    process.exit(65);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const [W, H] = SIZES[shape];
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  // Portrait is two cards, not a cut-down: Instagram will not take an image taller
  // than 4:3, and everything on the landscape card does not fit inside that. Page one
  // is the answer, page two is the working. A two-image carousel carries both.
  const pages = shape === 'portrait' ? [1, 2, 3] : [0];
  for (const pg of pages) {
    await page.setContent(html(d, shape, pg), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const name = pg ? `compare-${shape}-${pg}.png` : `compare-${shape}.png`;
    const file = path.join(outDir, name);
    await page.locator('.card').screenshot({ path: file });
    const over = await page.evaluate(() => {
      const c = document.querySelector('.card');
      return c.scrollHeight - c.clientHeight;
    });
    console.log(`${name}  ${W}x${H}${over > 0 ? `  OVERFLOW ${over}px` : '  fits'}`);
  }
  await b.close();
})();
