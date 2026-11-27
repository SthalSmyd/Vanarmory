// WS の一覧と、FF11用語辞典の WS ごとのページの表を取ってきて data/ws-pages.json にまとめる。
//   node tools/fetch-ws.mjs [--refresh]
// 名前・武器種・連携属性は Windower の resources、段数・修正項目・倍率は用語辞典のページから。
// 取ったページは data/cache/ws/ に置き、2 回目からはそれを読む。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data', 'cache', 'ws');
const RESOURCES = 'https://raw.githubusercontent.com/Windower/Resources/master/resources_data/weapon_skills.lua';
const WIKI = 'https://wiki.ffo.jp/html/';
const refresh = process.argv.includes('--refresh');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url, file) {
  if (!refresh && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  process.stderr.write(`取得: ${url}\n`);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (data-fetch)' } });
  if (!res.ok) throw new Error(`${url} を取得できない (HTTP ${res.status})`);
  const text = await res.text();
  fs.writeFileSync(file, text);
  await sleep(1200);
  return text;
}

const strip = (html) => html.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
// ページの中のリンク: 記事名 → 番号
function linksOf(html, into) {
  for (const m of html.matchAll(/<a href="\/html\/(\d+)\.html" title="([^"]+)"/g)) if (!into.has(m[2])) into.set(m[2], Number(m[1]));
  return into;
}
const tablesOf = (html) => [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((t) =>
  [...t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)].map((c) => {
    const span = c[1].match(/colspan="?(\d+)/);
    return span ? { text: strip(c[2]), span: Number(span[1]) } : strip(c[2]);
  })));

fs.mkdirSync(CACHE, { recursive: true });
const lua = await get(RESOURCES, path.join(CACHE, 'weapon_skills.lua'));
const skills = [];
for (const line of lua.split('\n')) {
  const m = line.match(/^\s*\[(\d+)\] = \{(.*)\},\s*$/);
  if (!m) continue;
  const record = { id: Number(m[1]) };
  for (const f of m[2].matchAll(/(\w+)=(?:"((?:[^"\\]|\\.)*)"|(-?[\d.]+))/g)) record[f[1]] = f[2] != null ? f[2] : Number(f[3]);
  skills.push(record);
}

// 記事の番号は、「ウェポンスキル」の記事と、そこから辿れる武器種ごとの記事のリンクから拾う
const links = new Map();
const top = await get(WIKI + '307.html', path.join(CACHE, '307.html'));
linksOf(top, links);
const TYPES = ['格闘', '短剣', '片手剣', '両手剣', '片手斧', '両手斧', '両手鎌', '両手槍', '片手刀', '両手刀', '片手棍', '両手棍', '弓術', '射撃'];
for (const type of TYPES) {
  const id = links.get(type);
  if (!id) { process.stderr.write(`武器種の記事が見つからない: ${type}\n`); continue; }
  linksOf(await get(`${WIKI}${id}.html`, path.join(CACHE, `${id}.html`)), links);
}

const out = [];
const missing = [];
for (const skill of skills) {
  const page = links.get(skill.ja);
  if (!page) { missing.push(skill.ja); out.push({ ...skill, page: 0 }); continue; }
  const html = await get(`${WIKI}${page}.html`, path.join(CACHE, `${page}.html`));
  const body = html.slice(html.indexOf('<div class="col">'));
  const callout = (body.match(/<div class="bd-callout[^"]*">([\s\S]*?)<\/div>/) || [])[1];
  const title = strip((html.match(/<h1 class="title">([\s\S]*?)<i /) || [])[1] || '');
  out.push({ ...skill, page, title, summary: callout ? strip(callout) : '', tables: tablesOf(body).slice(0, 3) });
}
fs.writeFileSync(path.join(ROOT, 'data', 'ws-pages.json'), JSON.stringify(out, null, 1));
process.stderr.write(`WS ${out.length} 件。記事が見つからないもの ${missing.length} 件: ${missing.join('、')}\n`);
