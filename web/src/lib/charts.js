/*
 * The stats page's charts, drawn as inline SVG on the server (design 07,
 * 2026-09-25). No chart library: the page is one response, works with
 * JavaScript off, and every number in a chart is also in its label, so a chart
 * is never the only place a figure lives.
 *
 * One chart grammar everywhere, so once he can read one he can read the page:
 *   - a pale BAND is the normal range, lowest to highest of the 4 baseline weeks
 *   - a DASHED line is their mean
 *   - this week is the big dot: green above the band, grey inside, red below
 *   - a DASHED RING and last segment mean still growing (publish-date series)
 *   - a grey block is a week that was not tracked yet, never drawn as zero
 */
import { esc, num } from './html.js';
import { baseline, status, pctVs, THIS, WEEKS, BASE_WEEKS } from './weekly.js';

const BASE_IDX = Array.from({ length: BASE_WEEKS }, (_, i) => THIS - BASE_WEEKS + i);
const r1 = (v) => Math.round(v * 10) / 10;
const f1 = (v) => (v == null ? '—' : Number.isInteger(v) ? num(v) : r1(v).toLocaleString('en-US'));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayShort = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)} ${MON[Number(m) - 1]}`; };

export const STATUS_WORD = { above: 'above normal', inside: 'normal', below: 'below normal', none: 'no baseline yet' };

export function chip(v, bl, { rate = false } = {}) {
  const p = pctVs(v, bl, rate ? 0 : undefined);
  const st = status(v, bl);
  if (!bl) return '<span class="chip c-none">no baseline yet</span>';
  if (p == null) return `<span class="chip c-none">usual ${esc(f1(bl.mean))}</span>`;
  return `<span class="chip c-${st}">${p > 0 ? '+' : ''}${p}% vs usual</span>`;
}

function niceStep(span) {
  const e = 10 ** Math.floor(Math.log10(span / 3 || 1));
  for (const m of [1, 2, 2.5, 5, 10, 20]) if (span / (m * e) <= 3.0001) return m * e;
  return 20 * e;
}
const axFmt = (v) => (v >= 1000 ? `${r1(v / 1000)}k` : f1(v));

/*
 * 8 weeks, the band, the mean, this week's dot. `weeks` gives the x labels.
 * spark: a small version with no axes, for inside a card.
 */
export function trendChart(series, { weeks, young = false, approx = false, spark = false, suffix = '', W = spark ? 220 : 400, H = spark ? 64 : 190 } = {}) {
  const bl = baseline(series);
  const v = series[THIS];
  const st = status(v, bl);
  const [padL, padR, padT, padB] = spark ? [6, 12, 10, 6] : [40, 20, 24, 34];
  const vals = series.filter((x) => x != null);
  const top = Math.max(1, ...vals, bl ? bl.max : 0);
  const step = niceStep(top);
  const hi = step * Math.max(1, Math.ceil(top / step - 1e-9));
  const iw = W - padL - padR; const ih = H - padT - padB;
  const X = (i) => padL + iw * (i / (WEEKS - 1));
  const Y = (y) => padT + ih * (1 - y / hi);
  const label = `8 weeks, this week ${v == null ? 'not tracked' : `${approx ? 'about ' : ''}${f1(v)}${suffix}`}, ${STATUS_WORD[st]}`;
  const o = [`<svg class="cc${spark ? ' spark' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`];
  if (!spark) {
    for (let y = 0; y <= hi + 1e-9; y += step) {
      o.push(`<line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(y).toFixed(1)}" y2="${Y(y).toFixed(1)}"/>`,
        `<text class="ax" x="${padL - 6}" y="${(Y(y) + 4).toFixed(1)}" text-anchor="end">${axFmt(y)}</text>`);
    }
  }
  const bx0 = X(BASE_IDX[0]) - iw / 14; const bx1 = X(BASE_IDX[BASE_IDX.length - 1]) + iw / 14;
  o.push(`<rect class="bweeks" x="${bx0.toFixed(1)}" y="${padT}" width="${(bx1 - bx0).toFixed(1)}" height="${ih}"/>`);
  if (bl) {
    let y0 = Y(bl.max); let y1 = Y(bl.min);
    if (y1 - y0 < 2) { y0 -= 1; y1 += 1; }
    o.push(`<rect class="band" x="${padL}" y="${y0.toFixed(1)}" width="${iw}" height="${(y1 - y0).toFixed(1)}"/>`,
      `<line class="mean" x1="${padL}" x2="${W - padR}" y1="${Y(bl.mean).toFixed(1)}" y2="${Y(bl.mean).toFixed(1)}"/>`);
  }
  const gaps = series.map((x, i) => (x == null ? i : -1)).filter((i) => i >= 0);
  if (gaps.length) {
    const gx0 = Math.max(padL, X(gaps[0]) - iw / 14); const gx1 = Math.min(W - padR, X(gaps[gaps.length - 1]) + iw / 14);
    o.push(`<rect class="gap" x="${gx0.toFixed(1)}" y="${padT}" width="${(gx1 - gx0).toFixed(1)}" height="${ih}"/>`);
    if (!spark && gx1 - gx0 > 40) o.push(`<text class="gapt" x="${((gx0 + gx1) / 2).toFixed(1)}" y="${padT + 14}" text-anchor="middle">not tracked</text>`);
  }
  for (let i = 0; i < WEEKS - 1; i++) {
    const a = series[i]; const b = series[i + 1];
    if (a == null || b == null) continue;
    o.push(`<line class="ln${young && i + 1 === THIS ? ' young' : ''}" x1="${X(i).toFixed(1)}" y1="${Y(a).toFixed(1)}" x2="${X(i + 1).toFixed(1)}" y2="${Y(b).toFixed(1)}"/>`);
  }
  series.slice(0, THIS).forEach((x, i) => {
    if (x != null) o.push(`<circle class="pt" cx="${X(i).toFixed(1)}" cy="${Y(x).toFixed(1)}" r="${spark ? 2.2 : 3}"/>`);
  });
  if (v != null) {
    const r = spark ? 4.5 : 7;
    if (young) o.push(`<circle class="ring" cx="${X(THIS).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${r + 4}"/>`);
    o.push(`<circle class="dot d-${st}" cx="${X(THIS).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${r}"/>`);
    if (!spark) {
      let ly = Y(v) - r - 7; if (ly < 11) ly = Y(v) + r + 15;
      o.push(`<text class="vlab t-${st}" x="${(X(THIS) - 2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end">${approx ? '~' : ''}${f1(v)}${esc(suffix)}</text>`);
    }
  }
  if (!spark && weeks) {
    weeks.forEach((w, i) => {
      const last = i === THIS;
      o.push(`<text class="ax${last ? ' axb' : ''}${[1, 3, 5].includes(i) ? ' xodd' : ''}" x="${(X(i) + (last ? padR - 2 : 0)).toFixed(1)}" y="${H - padB + 16}" text-anchor="${last ? 'end' : 'middle'}">${last ? 'this wk' : dayShort(w.from)}</text>`);
    });
    o.push(`<text class="axs" x="${((bx0 + bx1) / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">usual weeks</text>`);
  }
  o.push('</svg>');
  return o.join('');
}

/** A chart card: title, this week's number, the chip, the range, the chart. */
export function metricCard({ title, sub = '', series, weeks, young = false, approx = false, suffix = '', note = '', rate = false }) {
  const bl = baseline(series);
  const v = series[THIS];
  const st = status(v, bl);
  const range = bl ? `normal ${approx ? '~' : ''}${f1(bl.min)} to ${f1(bl.max)}${suffix}, usual ${f1(bl.mean)}${suffix}` : '';
  return `<article class="mc">
  <header><h3>${esc(title)}</h3>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</header>
  <div class="big"><b class="t-${st}">${v == null ? '—' : `${approx ? '~' : ''}${f1(v)}${esc(suffix)}`}</b>${chip(v, bl, { rate })}${young ? '<span class="grow">still growing</span>' : ''}</div>
  ${range ? `<div class="rng">${esc(range)}</div>` : ''}
  ${trendChart(series, { weeks, young, approx, suffix })}
  ${note ? `<p class="cap">${esc(note)}</p>` : ''}
</article>`;
}

/*
 * THE JOURNEY, one picture: stages as bars on a LOG scale (they run from
 * thousands seen to a handful of presses, and on a straight scale everything
 * after "seen" is a line of pixels), ribbons between them, and the rate above
 * each ribbon with its colour against the usual week. Drawn twice, across for
 * a wide screen and down for a phone; CSS shows one.
 */
const LOGMAX = 4; // 10,000
export function journeyFlow({ stages, links }) {
  const across = flowAcross(stages, links);
  const down = flowDown(stages, links);
  return `${across}${down}`;
}

const rateText = (l) => (l.v == null ? '—' : `${l.share ? '~' : ''}${f1(l.v)}${l.share ? '%' : ''}`);
const rateChip = (l) => { const p = pctVs(l.v, l.bl, 0); const st = status(l.v, l.bl);
  return p == null ? (l.bl ? `usual ${f1(l.bl.mean)}${l.share ? '%' : ''}` : 'no baseline yet') : `${p > 0 ? '+' : ''}${p}% vs usual · ${STATUS_WORD[st]}`; };

function flowAcross(stages, links) {
  const W = 1040; const H = 430; const cy = 245; const HMAX = 240; const nw = 30;
  const hgt = (v) => Math.max(4, (Math.log10(Math.max(v || 0, 1)) / LOGMAX) * HMAX);
  const xs = stages.map((_, i) => 130 + i * ((W - 220) / (stages.length - 1)));
  const o = [`<svg class="flow flow-h" viewBox="0 0 ${W} ${H}" role="img" aria-label="The journey this week">`,
    '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatchl"/></pattern></defs>'];
  const rx = 34;
  o.push(`<line class="ruler" x1="${rx}" x2="${rx}" y1="${cy - HMAX / 2}" y2="${cy + HMAX / 2}"/>`);
  for (let p = 0; p <= LOGMAX; p++) {
    const y = cy + HMAX / 2 - (p / LOGMAX) * HMAX;
    o.push(`<line class="ruler" x1="${rx - 4}" x2="${rx + 4}" y1="${y}" y2="${y}"/><text class="ax" x="${rx + 8}" y="${y + 4}">${num(10 ** p)}</text>`);
  }
  o.push(`<text class="axs" x="${rx - 12}" y="${cy - HMAX / 2 - 18}">log scale, each step 10x</text>`);
  links.forEach((l, i) => {
    const h0 = hgt(stages[i].v); const h1 = hgt(stages[i + 1].v); const hr = Math.min(h0, h1);
    const xa = xs[i] + nw / 2; const xb = xs[i + 1] - nw / 2; const mx = (xa + xb) / 2;
    const ya0 = cy + h0 / 2 - hr; const ya1 = cy + h0 / 2; const yb0 = cy + h1 / 2 - hr; const yb1 = cy + h1 / 2;
    o.push(`<path class="rib" d="M${xa},${ya0} C${mx},${ya0} ${mx},${yb0} ${xb},${yb0} L${xb},${yb1} C${mx},${yb1} ${mx},${ya1} ${xa},${ya1} Z"/>`);
    const st = status(l.v, l.bl);
    o.push(`<text class="rate t-${st}" x="${mx}" y="24" text-anchor="middle">${esc(rateText(l))}</text>`,
      `<text class="ratel" x="${mx}" y="44" text-anchor="middle">${esc(l.label)}</text>`,
      `<text class="ratec t-${st}" x="${mx}" y="62" text-anchor="middle">${esc(rateChip(l))}</text>`);
  });
  stages.forEach((s, i) => {
    const h = hgt(s.v);
    o.push(`<rect class="node${s.v == null ? ' nnone' : ''}" x="${xs[i] - nw / 2}" y="${(cy - h / 2).toFixed(1)}" width="${nw}" height="${h.toFixed(1)}" rx="3"/>`);
    if (s.young) o.push(`<rect fill="url(#hatch)" x="${xs[i] - nw / 2}" y="${(cy - h / 2).toFixed(1)}" width="${nw}" height="${Math.min(h, 40).toFixed(1)}" rx="3"/>`);
    const ly = cy + Math.max(h / 2, 30) + 24;
    o.push(`<text class="nval" x="${xs[i]}" y="${ly}" text-anchor="middle">${s.v == null ? '—' : `${s.approx ? '~' : ''}${f1(s.v)}`}</text>`,
      `<text class="nname" x="${xs[i]}" y="${ly + 20}" text-anchor="middle">${esc(s.name)}</text>`,
      `<text class="nsub" x="${xs[i]}" y="${ly + 36}" text-anchor="middle">${esc(s.sub)}${s.young ? ', still growing' : ''}</text>`);
  });
  o.push('</svg>');
  return o.join('');
}

function flowDown(stages, links) {
  const W = 360; const rowH = 128; const top = 8; const H = top + rowH * (stages.length - 1) + 92;
  const WMAX = 190; const x0 = 8;
  const wid = (v) => Math.max(4, (Math.log10(Math.max(v || 0, 1)) / LOGMAX) * WMAX);
  const o = [`<svg class="flow flow-v" viewBox="0 0 ${W} ${H}" role="img" aria-label="The journey this week">`];
  stages.forEach((s, i) => {
    const y = top + i * rowH; const w = wid(s.v);
    o.push(`<text class="nname" x="${x0}" y="${y + 14}">${esc(s.name)}</text>`,
      `<text class="nsub" x="${x0}" y="${y + 29}">${esc(s.sub)}${s.young ? ', still growing' : ''}</text>`,
      `<rect class="node" x="${x0}" y="${y + 36}" width="${w.toFixed(1)}" height="22" rx="3"/>`,
      `<text class="nval" x="${(x0 + w + 8).toFixed(1)}" y="${y + 53}">${s.v == null ? '—' : `${s.approx ? '~' : ''}${f1(s.v)}`}</text>`);
    const l = links[i];
    if (!l) return;
    const cw = Math.min(w, wid(stages[i + 1].v)); const ya = y + 58; const yb = y + rowH;
    const st = status(l.v, l.bl);
    o.push(`<path class="rib" d="M${x0},${ya} L${(x0 + cw).toFixed(1)},${ya} L${(x0 + cw).toFixed(1)},${yb} L${x0},${yb} Z"/>`,
      `<text class="rate t-${st}" x="${W - 6}" y="${ya + 24}" text-anchor="end">${esc(rateText(l))}</text>`,
      `<text class="ratel" x="${W - 6}" y="${ya + 40}" text-anchor="end">${esc(l.label)}</text>`,
      `<text class="ratec t-${st}" x="${W - 6}" y="${ya + 55}" text-anchor="end">${esc(rateChip(l))}</text>`);
  });
  o.push(`<text class="axs" x="${x0}" y="${H - 6}">bar length: log scale, each step 10x</text></svg>`);
  return o.join('');
}

/** Horizontal bars for a ranked list: [{name, v, note?}]. */
export function hbars(rows, { cls = 'f-acc', approx = false, fmt = f1 } = {}) {
  const mx = Math.max(1, ...rows.map((r) => r.v || 0));
  return rows.map((r) => `<div class="hb"><span class="hbl">${esc(r.name)}${r.note ? ` <i>${esc(r.note)}</i>` : ''}</span>`
    + `<span class="hbt"><span class="hbf ${r.cls || cls}" style="width:${(((r.v || 0) / mx) * 100).toFixed(1)}%"></span></span>`
    + `<b>${approx ? '~' : ''}${esc(fmt(r.v))}</b></div>`).join('');
}

export const CHART_CSS = `
:root{--in:#6b7482;--in-soft:#eef0f3;--band:rgba(61,90,254,.13);--bweeks:rgba(20,23,28,.035);--gap:rgba(20,23,28,.05);--ln:#9aa3b0;--node:#3d5afe;--rib:rgba(61,90,254,.18)}
@media (prefers-color-scheme:dark){:root{--in:#a3acb9;--in-soft:#222831;--band:rgba(142,161,255,.16);--bweeks:rgba(255,255,255,.03);--gap:rgba(255,255,255,.05);--ln:#5d6673;--node:#8ea1ff;--rib:rgba(142,161,255,.2)}}
.tabs{display:none}
.js .tabs{display:flex;gap:.25rem;overflow-x:auto;border-bottom:1px solid var(--line);margin:0 0 1rem;scrollbar-width:none}
.tabs a{padding:.6rem .9rem;text-decoration:none;color:var(--muted);font-weight:600;font-size:.92rem;white-space:nowrap;border-bottom:3px solid transparent;margin-bottom:-1px}
.tabs a.on{color:var(--accent);border-bottom-color:var(--accent)}
.panel{margin:0 0 2rem}
.panel>h2.tabtitle{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:1.2rem 0 .6rem}
.js .panel{display:none}.js .panel.on{display:block}.js .panel>h2.tabtitle{display:none}
.sec{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:1.4rem 0 .6rem}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem 1rem;font-size:.8rem;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:.55rem .8rem;margin:0 0 1rem}
.legend svg{flex:none;width:90px;height:22px}
.lgd{display:inline-flex;align-items:center;gap:.3rem}.lgd .d{width:12px;height:12px;border-radius:50%;display:inline-block}
.d-above{background:var(--ok)}.d-inside{background:var(--in)}.d-below{background:var(--bad)}.ringd{outline:1.5px dashed var(--in);outline-offset:2px}
.hls{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin:0 0 1rem}
.hl{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:.6rem .8rem;display:flex;flex-wrap:wrap;align-items:baseline;gap:.2rem .5rem}
.hl span.l{width:100%;font-size:.76rem;color:var(--muted)}.hl b{font-size:1.5rem;letter-spacing:-.02em}
.box{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:1rem;margin:0 0 1rem;min-width:0}
.box>h3{margin:0 0 .2rem;font-size:.95rem}.box>.sub{display:block;margin:0 0 .6rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem}
.mc{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:.85rem .9rem .7rem;min-width:0}
.mc header{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;flex-wrap:wrap}.mc h3{margin:0;font-size:.95rem}
.sub{font-size:.76rem;color:var(--faint)}
.big{display:flex;align-items:center;flex-wrap:wrap;gap:.3rem .5rem;margin:.25rem 0 0}.big b{font-size:1.7rem;letter-spacing:-.03em;line-height:1.1}
.rng{font-size:.76rem;color:var(--muted);margin:.1rem 0 .2rem}.cap{font-size:.76rem;color:var(--faint);margin:.25rem 0 0}
.grow{font-size:.72rem;color:var(--muted);border:1px dashed var(--line);border-radius:99px;padding:.05rem .5rem}
.chip{display:inline-block;font-size:.72rem;font-weight:650;padding:.12rem .5rem;border-radius:99px;white-space:nowrap}
.c-above{background:var(--ok-soft);color:var(--ok)}.c-inside{background:var(--in-soft);color:var(--in)}.c-below{background:var(--bad-soft);color:var(--bad)}.c-none{background:var(--line2);color:var(--faint)}
.t-above{color:var(--ok);fill:var(--ok)}.t-below{color:var(--bad);fill:var(--bad)}.t-inside{color:var(--fg);fill:var(--fg)}.t-none{color:var(--faint);fill:var(--faint)}
svg.cc{width:100%;height:auto;display:block}svg text{font-family:inherit}
svg .gl{stroke:var(--line2);stroke-width:1}svg .ax{fill:var(--faint);font-size:11px}svg .axb{fill:var(--fg);font-weight:650}svg .axs{fill:var(--faint);font-size:10px}
svg .bweeks{fill:var(--bweeks)}svg .band{fill:var(--band)}svg .mean{stroke:var(--accent);stroke-width:1.2;stroke-dasharray:4 3;opacity:.8}
svg .gap{fill:var(--gap)}svg .gapt{fill:var(--faint);font-size:10px}
svg .ln{stroke:var(--ln);stroke-width:2}svg .ln.young{stroke-dasharray:4 3}svg .pt{fill:var(--ln)}
svg .dot.d-above{fill:var(--ok)}svg .dot.d-inside{fill:var(--in)}svg .dot.d-below{fill:var(--bad)}svg .dot.d-none{fill:var(--faint)}
svg .ring{fill:none;stroke:var(--in);stroke-width:1.5;stroke-dasharray:3 2}svg .vlab{font-size:13px;font-weight:700}
svg.spark{max-width:260px}
.flow{width:100%;height:auto;display:block}.flow-v{display:none}
@media (max-width:720px){.flow-h{display:none}.flow-v{display:block;max-width:420px;margin:0 auto}.xodd{display:none}}
svg .ruler{stroke:var(--line);stroke-width:1}svg .rib{fill:var(--rib)}svg .node{fill:var(--node)}svg .nnone{fill:var(--line)}svg .hatchl{stroke:rgba(255,255,255,.55);stroke-width:2}
svg .nval{font-size:19px;font-weight:750;fill:var(--fg)}svg .nname{font-size:13px;font-weight:650;fill:var(--fg)}svg .nsub{font-size:11px;fill:var(--faint)}
svg .rate{font-size:24px;font-weight:750}svg .ratel{font-size:12px;fill:var(--muted)}svg .ratec{font-size:11px;font-weight:600}
.rcs{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.7rem;margin-top:.8rem}
.rc{border:1px solid var(--line2);border-radius:10px;padding:.6rem .7rem}.rch{display:flex;justify-content:space-between;gap:.4rem;font-size:.78rem;color:var(--muted);margin-bottom:.2rem;flex-wrap:wrap}
.rcf{font-size:.8rem}.rcf b{font-size:1.05rem}
.hb{display:grid;grid-template-columns:minmax(7rem,38%) 1fr auto;align-items:center;gap:.6rem;font-size:.84rem;margin:.28rem 0}
.hbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hbl i{font-style:normal;color:var(--faint);font-size:.76rem}
.hbt{height:.6rem;background:var(--line2);border-radius:99px;overflow:hidden}.hbf{display:block;height:100%;border-radius:99px;background:var(--accent)}
.hb b{font-variant-numeric:tabular-nums;min-width:2.5rem;text-align:right}
.mss{display:flex;flex-wrap:wrap;gap:.3rem .9rem;font-size:.8rem;margin-top:.3rem}
.tracks{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}
.pr{padding:.55rem 0;border-bottom:1px solid var(--line2)}.prh{display:flex;justify-content:space-between;gap:.6rem;font-size:.86rem}
.prt{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pra{color:var(--faint);font-size:.78rem;white-space:nowrap}
.prb{display:grid;grid-template-columns:1fr auto auto;gap:.6rem;align-items:center;margin-top:.3rem;font-size:.84rem}
.stk{display:flex;height:.8rem;border-radius:99px;overflow:hidden;background:var(--line2)}.stk .none{font-size:.72rem;color:var(--faint);padding-left:.4rem;line-height:.8rem}
.prc{color:var(--muted);font-size:.78rem;white-space:nowrap}
.lgs{display:flex;flex-wrap:wrap;gap:.3rem .8rem;font-size:.76rem;color:var(--muted);margin:.2rem 0 .6rem}.lgs i{display:inline-block;width:.7rem;height:.7rem;border-radius:3px;margin-right:.25rem;vertical-align:-1px}
.s-facebook{background:#3867d6}.s-tiktok{background:#12a08a}.s-youtube{background:#e8772e}.s-instagram{background:#c2459a}
.s-linkedin{background:#6a4fc8}.s-threads{background:#8d96a3}.s-twitter{background:#2d3440}.s-pinterest{background:#caa01a}
@media (prefers-color-scheme:dark){.s-twitter{background:#cfd6df}}
details.more{margin-top:.8rem}details.more summary{cursor:pointer;color:var(--accent);font-size:.86rem}
`;
