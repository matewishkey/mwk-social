# reality-check

Renders one episode of "Check reality with AI" to cards: a comparison card in
landscape and as a three-card portrait carousel, plus calculation cards.

    node scripts/reality-check/compare.js <episode>.json <out-dir> landscape
    node scripts/reality-check/compare.js <episode>.json <out-dir> portrait
    node scripts/reality-check/calc.js    <calc>.json    <out-dir> portrait

**The episode is the json; the design is the code.** A new episode is a new json
and no design work. `example.json` shows the shape — the real ones live on the
share with their rendered output, not here.

Brand comes from `brand/`, vendored from `matewishkey/mwk-og-image-generator`,
which encodes matewishkey.com/design. The RedBlock is the only logo, Fraunces
sets display, JetBrains Mono sets kickers, Manrope is body, and `redDeep` is the
only red allowed at body size. Fonts are OFL with their licences beside them.
