// 取ってきた WS のページの表 (data/ws-pages.json) を、計算に使う形に直す。
// 表は、ページの先頭にあるものが現在の値 (後ろにあるのは、変更前の値の記録)。
// 用語辞典の表に無い値 (攻撃力の補正など) と、「?」のままの値は、BG-wiki の WS ごとのページの値 (data/ws-bg.json) で埋める。
// 両方に値があって食い違うときは、BG-wiki の値を使い、その旨を note に残す (BG-wiki のほうが新しい WS まで手が入っているため)。
// それでも足りない分と、表に書かれていない性質は data/ws-fix.json で足す。
import fs from 'node:fs';
import path from 'node:path';

const ATTRS = 'STR|DEX|VIT|AGI|INT|MND|CHR';
const numberOf = (text) => {
  const m = String(text).replace(/[＋+]/g, '').replace(/[−－]/g, '-').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const textOf = (cell) => (typeof cell === 'string' ? cell : cell.text);

// 修正項目。「STR73%/76%/79%/82%/85%」はメリポの段階ごとの値で、最大の段階を使う
function modsOf(text) {
  const mods = {};
  let merit = false;
  for (const m of text.matchAll(new RegExp(`(${ATTRS})([\\d./%]+)`, 'g'))) {
    const steps = m[2].split('/').map((v) => parseFloat(v)).filter((v) => !Number.isNaN(v));
    if (steps.length > 1) merit = true;
    mods[m[1]] = steps[steps.length - 1];
  }
  return { mods, merit };
}

export function buildWs(root) {
  const pages = JSON.parse(fs.readFileSync(path.join(root, 'data', 'ws-pages.json'), 'utf8'));
  const fix = JSON.parse(fs.readFileSync(path.join(root, 'data', 'ws-fix.json'), 'utf8'));
  const out = [];
  const seen = new Set();
  for (const page of pages) {
    if (!page.page || !page.tables || !page.tables.length || seen.has(page.ja)) continue;
    seen.add(page.ja);
    const table = page.tables[0];
    const head = table[0].map(textOf);
    const tpHead = table[0].find((c) => typeof c !== 'string'); // TP で変わるものの見出し (3 列ぶん)
    const row = table.find((r, i) => i > 0 && r.some((c) => new RegExp(`(${ATTRS})\\d`).test(textOf(c))));
    if (!row) continue;
    const cells = row.map(textOf);
    const modCell = cells.find((c) => new RegExp(`^(${ATTRS})\\d`).test(c)) || '';
    const hitCell = cells.find((c) => /^×/.test(c)) || '';
    const rest = cells.filter((c) => c !== modCell && c !== hitCell && !/自(INT|MND)|^Lv|^IL/.test(c));
    const { mods, merit } = modsOf(modCell);
    const summary = page.summary || '';
    const magic = head.includes('属性') || head.includes('系統係数');
    const element = /属性ダメージ/.test(summary) && !/無属性ダメージ/.test(summary);
    const ws = {
      id: page.id, ja: page.ja, en: page.en, skill: page.skill, page: page.page,
      kind: magic ? 'magic' : element ? 'hybrid' : 'phys',
      hits: numberOf(hitCell) || 1, mods, ftp: null, rep: false,
      sc: [page.skillchain_a, page.skillchain_b, page.skillchain_c].filter(Boolean),
    };
    if (merit) ws.merit = true;
    // 属性 (魔法 WS と、属性つきの物理 WS) と、系統係数「(自INT-敵INT)×1.0」
    const elementName = (cells.find((c) => /^[火氷風土雷水光闇]$/.test(c)) || (summary.match(/([火氷風土雷水光闇])属性ダメージ/) || [])[1]);
    if (elementName) ws.element = elementName;
    const dstat = cells.map((c) => c.match(new RegExp(`自(${ATTRS})\\s*[-−－]\\s*敵(${ATTRS})\\)\\s*×\\s*([\\d.]+)`))).find(Boolean);
    if (dstat) ws.dstat = { a: dstat[1], b: dstat[2], n: Number(dstat[3]) };
    const unknown = [];
    const three = (values, label) => {
      const numbers = values.map(numberOf);
      if (numbers.some((v) => v === null)) { unknown.push(label); return null; }
      if (values.some((v) => /以上|程度|～|\?/.test(v))) unknown.push(label + ' (おおよそ)');
      return numbers;
    };
    if (/^TP1000/.test(head[0]) || /^TP100/.test(head[0])) {
      ws.ftp = three(rest.slice(0, 3), 'TP による倍率');
      if (rest.slice(0, 3).some((v) => /全段/.test(v))) ws.rep = true;
    } else if (tpHead) {
      const label = tpHead.text;
      const hasBase = head.includes('倍率');
      const base = hasBase ? numberOf(rest[0]) : null;
      if (hasBase && /全段/.test(rest[0])) ws.rep = true;
      const values = rest.slice(hasBase ? 1 : 0, (hasBase ? 1 : 0) + 3);
      if (/ダメージ修正/.test(label)) {
        const v = three(values, 'TP による倍率');
        // 「倍率 1.0、+0.5 / +1.5 / +2.5」の形は、倍率に足した値
        if (v && hasBase && values.every((x) => /^[+＋]/.test(x))) {
          // 「倍率 1.0、+0.5 / +1.5 / +2.5」の形 (属性つきの物理 WS): 物理の分の倍率と、属性の分の倍率
          ws.ftp = [base, base, base];
          ws.mftp = v;
        } else ws.ftp = v;
      } else {
        ws.ftp = base != null ? [base, base, base] : null;
        if (base == null) unknown.push('倍率');
        const key = /クリティカル/.test(label) ? 'crit' : /命中/.test(label) ? 'acc' : /防御力カット/.test(label) ? 'def' : /^攻撃力/.test(label) ? 'atk' : null;
        if (key) {
          const v = three(values, label);
          // 攻撃力は「+100%」の形なので、倍率 (2.0) に直す
          ws[key] = v ? (key === 'atk' ? v.map((x) => 1 + x / 100) : v) : key === 'crit' ? [0, 0, 0] : null;
          if (!ws[key]) delete ws[key];
        }
      }
    }
    if (!ws.ftp) continue;
    if (unknown.length) ws.unknown = unknown;
    out.push(ws);
  }
  // BG-wiki の値で埋める
  const bgFile = path.join(root, 'data', 'ws-bg.json');
  const bg = fs.existsSync(bgFile) ? JSON.parse(fs.readFileSync(bgFile, 'utf8')).ws : [];
  const byEn = new Map(out.map((ws) => [ws.en, ws]));
  const full = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');
  const differs = (a, b) => a.some((x, i) => Math.abs(x - b[i]) > 0.011);
  const UNKNOWN_OF = { crit: /クリティカル/, acc: /命中/, def: /防御力カット/, atk: /^攻撃力/ };
  const keep = new Set(fix.keep || []);
  for (const b of bg) {
    const ws = byEn.get(b.en);
    if (!ws || ws.kind === 'magic') continue;
    const changed = [];
    if (ws.kind === 'hybrid') {
      if (full(b.ftp)) ws.mftp = b.ftp; // BG-wiki の値は、属性の分の倍率
    } else if (full(b.ftp) && differs(b.ftp, ws.ftp) && !keep.has(ws.ja) && !(b.unverified || []).some((u) => /ftp/i.test(u))) {
      changed.push(`TP による倍率 ${ws.ftp.join('/')}`);
      ws.ftp = b.ftp;
      if (ws.unknown) ws.unknown = ws.unknown.filter((u) => !/TP による倍率/.test(u));
    }
    // 修正項目は、倍率と組で変わる (武器の段階で両方が変わる WS がある)。BG-wiki の倍率がそろっていないときは、用語辞典の組のまま使う
    if (full(b.ftp) && !keep.has(ws.ja) && b.wsc && Object.keys(b.wsc).length && JSON.stringify(Object.entries(b.wsc).sort()) !== JSON.stringify(Object.entries(ws.mods).sort())) {
      changed.push(`修正項目 ${Object.entries(ws.mods).map(([k, v]) => k + v + '%').join(' ')}`);
      ws.mods = b.wsc;
    }
    if (b.hits && b.hits !== ws.hits) { changed.push(`${ws.hits} 回攻撃`); ws.hits = b.hits; }
    if (b.rep) ws.rep = true;
    for (const key of ['atk', 'crit', 'acc', 'def']) {
      if (!full(b[key])) continue;
      ws[key] = b[key];
      if (ws.unknown) ws.unknown = ws.unknown.filter((u) => !UNKNOWN_OF[key].test(u));
    }
    if (ws.unknown && !ws.unknown.length) delete ws.unknown;
    if (changed.length) ws.differs = changed.join('、'); // 用語辞典の値 (使わなかったほう)
    ws.bg = b.url;
  }

  // 手で足す分。rep: 倍率が全段に掛かる WS、set: WS ごとの値の上書き (unknown を消すときは unknown: [] を入れる)
  const byName = new Map(out.map((ws) => [ws.ja, ws]));
  for (const name of fix.rep) {
    if (!byName.has(name)) throw new Error(`ws-fix.json の rep にある「${name}」が、WS の一覧に無い`);
    byName.get(name).rep = true;
  }
  for (const [name, values] of Object.entries(fix.set || {})) {
    if (!byName.has(name)) throw new Error(`ws-fix.json の set にある「${name}」が、WS の一覧に無い`);
    const ws = byName.get(name);
    Object.assign(ws, values);
    // 値を足した項目は、「分からない」の一覧から外す
    if (values.crit && ws.unknown) ws.unknown = ws.unknown.filter((u) => !/クリティカル/.test(u));
    if (ws.unknown && !ws.unknown.length) delete ws.unknown;
  }
  return out;
}
