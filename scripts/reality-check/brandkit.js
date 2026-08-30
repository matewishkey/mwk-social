/*
 * The brand layer, read from the published design system rather than guessed.
 *
 * Source of truth is mwk-og-image-generator/brand (matewishkey.com/design). Three
 * rules that are easy to get wrong and are wrong in every early draft of these
 * cards:
 *
 *   - The RedBlock is the ONLY logo: a red #e2342b square, square corners, white
 *     mark centred at 64%. Never a bare mark.
 *   - Fraunces 700 sets display headings, JetBrains Mono 700 uppercase at 0.16em
 *     sets kickers, Manrope is body only.
 *   - redDeep #f0524a is the only red permitted at BODY size. Plain red is a
 *     surface colour — the block and the accent rule, nothing else.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'brand');
const b64 = (f) => fs.readFileSync(path.join(DIR, f)).toString('base64');
const svg64 = (f) => Buffer.from(fs.readFileSync(path.join(DIR, f))).toString('base64');

const C = JSON.parse(fs.readFileSync(path.join(DIR, 'brand.json'), 'utf8')).colors;

// The dark tokens ship in brand.json because the OG band is always a dark ground.
// These cards are light, so paper and ink swap and the reds stay exactly as they are
// — "brand colours don't change with theme" is the generator's own note.
const LIGHT = { paper:'#FCFAFA', ink:'#151318', mute:'#6d6673', faint:'#8e8896', line:'#e6e1e8' };

const FONTS = `
@font-face{font-family:Fraunces;src:url(data:font/ttf;base64,${b64('fonts/Fraunces.ttf')}) format('truetype');font-weight:100 900;font-display:block}
@font-face{font-family:'JetBrains Mono';src:url(data:font/ttf;base64,${b64('fonts/JetBrainsMono.ttf')}) format('truetype');font-weight:100 900;font-display:block}
@font-face{font-family:Manrope;src:url(data:font/ttf;base64,${b64('fonts/Manrope.ttf')}) format('truetype');font-weight:200 800;font-display:block}
`;

const TOKENS = `:root{
  --paper:${LIGHT.paper};--ink:${LIGHT.ink};--mute:${LIGHT.mute};--faint:${LIGHT.faint};
  --line:${LIGHT.line};--red:${C.red};--redField:${C.redField};--redDeep:${C.redDeep};
  --dark:${C.paper};--onDark:${C.ink};--darkMute:${C.mute};--darkLine:${C.line};
}`;

/** The one logo. Square corners, white mark at 64% — never a bare mark. */
function redBlock(size = 72) {
  const mark = Math.round(size * 0.64);
  return `<span class="redblock" style="width:${size}px;height:${size}px">
    <img src="data:image/svg+xml;base64,${svg64('mwk-mark-white.svg')}" style="width:${mark}px;height:${mark}px" alt="">
  </span>`;
}

const BLOCK_CSS = `
.redblock{display:inline-flex;align-items:center;justify-content:center;background:var(--red);
  border-radius:0;flex:none}
`;

/*
 * The sign-off, on every card of every episode. It is the thing that has to be
 * identical from one to the next, so it is built here and never per card.
 */
function signoff({ size = 72, note = '' } = {}) {
  return `<div class="signoff">${redBlock(size)}
    <div class="sotext"><b>Check reality with AI.</b><em>Prompt it yourself!</em></div>
    ${note ? `<p class="sonote">${note}</p>` : ''}</div>`;
}

const SIGNOFF_CSS = `
.signoff{display:flex;align-items:center;gap:20px}
.sotext{font-family:Fraunces,serif;line-height:1.02}
.sotext b{display:block;font-weight:700;font-size:30px;color:var(--ink)}
.sotext em{display:block;font-weight:700;font-style:normal;font-size:30px;color:var(--red)}
.sonote{font-family:Manrope,sans-serif;font-weight:400;font-size:11px;line-height:1.34;
  color:var(--faint);flex:1}
.dark .sotext b{color:var(--onDark)}
`;

module.exports = { FONTS, TOKENS, BLOCK_CSS, SIGNOFF_CSS, redBlock, signoff, C, LIGHT };
