// BoardUI の theme.css（Tailwind v4 形式）から、ダーク固定の素の CSS 変数を書き出す。
// BoardUI のリポジトリ（https://github.com/BoardUI/boardui）と tailwindcss v4 の theme.css を
// 手元に用意して実行する。このアプリ自体は Tailwind も BoardUI もビルドに使わない。
// usage: node scripts/gen-boardui-theme.js <tailwindcss/theme.css> <boardui/styles/theme.css> public/css/boardui-theme.css
const fs = require('fs');
const [twPath, buPath, outPath] = process.argv.slice(2);
const tw = fs.readFileSync(twPath, 'utf8');
const bu = fs.readFileSync(buPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// 最上位ブロックを切り出す（selector → body）
function blocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out.push({ sel, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}
// 宣言（--name: value;）を順番どおり取り出す。値は複数行を許す
function decls(body) {
  const m = new Map();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let r;
  while ((r = re.exec(body))) m.set(r[1], r[2].replace(/\s+/g, ' ').trim());
  return m;
}

const twDecls = decls(blocks(tw.replace(/\/\*[\s\S]*?\*\//g, '')).find(b => b.sel.startsWith('@theme')).body);
const buBlocks = blocks(bu);
const buTheme = new Map();
buBlocks.filter(b => b.sel === '@theme').forEach(b => decls(b.body).forEach((v, k) => buTheme.set(k, v)));
const light = decls(buBlocks.find(b => b.sel === ':root').body);
const dark = decls(buBlocks.find(b => b.sel === '.dark').body);

const SEMANTIC = [
  '--color-foreground-', '--color-text-', '--color-background-full', '--color-background-primary-',
  '--color-background-inner-', '--color-background-secondary-', '--color-background-tertiary-',
  '--color-background-quaternary-', '--color-input-disabled-', '--color-icon-button-disabled-',
  '--color-button-', '--color-border-button-', '--color-border-error-', '--color-border-checkbox-',
  '--color-border-focus-ring', '--color-border-table', '--color-separator-', '--color-control-indicator-',
  '--color-switch-', '--color-segmented-control-', '--color-dropdown-item-', '--color-kbd-',
  '--color-badge-', '--color-tab-count-', '--color-notification-', '--color-status-',
  '--color-avatar-neutral-', '--color-state-', '--color-pill-tab-', '--gradient-button-',
];
const keep = k => SEMANTIC.some(p => k.startsWith(p));

// ライト → ダークの順に重ねる（このアプリはダーク固定）
const semantic = new Map();
light.forEach((v, k) => keep(k) && semantic.set(k, v));
dark.forEach((v, k) => keep(k) && semantic.set(k, v));

// BoardUI @theme のうち色以外で使うもの（角丸・影・モーション）。影はダーク用の値で上書き
const extras = new Map();
twDecls.forEach((v, k) => { if (/^--radius-/.test(k)) extras.set(k, v); });
buTheme.forEach((v, k) => {
  if (/^--(radius|shadow|inset-shadow|button-transition|input-transition)/.test(k)) extras.set(k, v);
});
dark.forEach((v, k) => { if (k.startsWith('--shadow-')) extras.set(k, v); });

// 参照されているプリミティブを集める（accent → blue のように連鎖をたどる）
const primSrc = new Map(twDecls);
buTheme.forEach((v, k) => { if (k.startsWith('--color-')) primSrc.set(k, v); });
const prims = new Map();
const visit = val => {
  for (const [, name] of val.matchAll(/var\((--color-[\w-]+)\)/g)) {
    if (semantic.has(name) || prims.has(name) || !primSrc.has(name)) continue;
    prims.set(name, primSrc.get(name));
    visit(primSrc.get(name));
  }
};
[...semantic.values(), ...extras.values()].forEach(visit);
// アプリ側で直接使うプリミティブ（同期ボタンのステータスドット）
['green-500']
  .forEach(n => { const k = `--color-${n}`; if (primSrc.has(k)) prims.set(k, primSrc.get(k)); });
// 意図せず漏れた参照がないか確認
const missing = new Set();
[...semantic.values(), ...extras.values(), ...prims.values()].forEach(v => {
  for (const [, n] of v.matchAll(/var\((--[\w-]+)\)/g)) if (!semantic.has(n) && !prims.has(n) && !extras.has(n)) missing.add(n);
});
if (missing.size) console.error('unresolved:', [...missing].join(', '));

const famOrder = ['white', 'black', 'neutral', 'accent', 'blue', 'red', 'rose', 'lime', 'green', 'yellow', 'orange', 'cyan', 'purple', 'pink', 'amber', 'stone', 'indigo', 'zinc'];
const fam = k => k.replace(/^--color-/, '').replace(/-\d+$/, '');
const sortedPrims = [...prims].sort((a, b) => {
  const fa = famOrder.indexOf(fam(a[0])), fb = famOrder.indexOf(fam(b[0]));
  if (fa !== fb) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
  return (parseInt(a[0].match(/(\d+)$/)?.[1] || 0)) - (parseInt(b[0].match(/(\d+)$/)?.[1] || 0));
});
const line = ([k, v]) => `  ${k}: ${v};`;

const out = `/* ══════════════════════════════════════════════════════════════
   BoardUI theme (dark) — generated from BoardUI styles/theme.css (MIT)
   https://github.com/BoardUI/boardui

   BoardUI は Tailwind v4 の @theme / :root / .dark で色を定義している。このアプリは
   ビルドなし・ダーク固定なので、ライトの値にダークの上書きを重ねた結果を :root に
   そのまま書き出している（値は var() / color-mix() のまま。手で書き換えない）。
   ══════════════════════════════════════════════════════════════ */
:root {
  color-scheme: dark;

  /* ── color primitives (Tailwind v4 defaults + BoardUI overrides) ── */
${sortedPrims.map(line).join('\n')}

  /* ── radii / shadows / motion ── */
${[...extras].map(line).join('\n')}

  /* ── semantic tokens ── */
${[...semantic].map(line).join('\n')}
}
`;
fs.writeFileSync(outPath, out);
console.log(`primitives ${prims.size}, extras ${extras.size}, semantic ${semantic.size}`);
