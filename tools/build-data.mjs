#!/usr/bin/env node
// Windower/Resources の装備データを取得して、検索画面が読む web/data.js を作る。
//
//   node tools/build-data.mjs            取得済みのファイルがあればそれを使う
//   node tools/build-data.mjs --refresh  取得し直す (バージョンアップ後)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDescription } from './parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const AUGMENTS = path.join(ROOT, 'data', 'augments.json');
const CAPES = path.join(ROOT, 'data', 'capes.json');
const SETS = path.join(ROOT, 'data', 'sets.json');
const FOODS = path.join(ROOT, 'data', 'foods.json');
const SETBONUS = path.join(ROOT, 'data', 'setbonus.json');
const JOBS = path.join(ROOT, 'data', 'jobs.json');
const CONTENTS = path.join(ROOT, 'data', 'contents.json');
const SOURCES = path.join(ROOT, 'data', 'sources');
const BATTLEFIELDS = path.join(ROOT, 'data', 'battlefields.json');
const CAPS = path.join(ROOT, 'data', 'caps.json');
const TRAITS = path.join(ROOT, 'data', 'traits.json');
const BASE = path.join(ROOT, 'data', 'base.json');
const COMBAT = path.join(ROOT, 'data', 'combat.json');
const OUTPUT = path.join(ROOT, 'web', 'data.js');
const SOURCE = 'https://raw.githubusercontent.com/Windower/Resources/master/resources_data/';
const FILES = ['items', 'item_descriptions', 'jobs', 'skills'];

// 合算して見たいステータス。被ダメージは物理と魔法の両方に効く
const DERIVED = [
  { key: '被物理ダメージ(被ダメージ込み)', parts: ['被ダメージ', '被物理ダメージ'], unit: '%' },
  { key: '被魔法ダメージ(被ダメージ込み)', parts: ['被ダメージ', '被魔法ダメージ'], unit: '%' },
];

// 「両手両脚両足装備不可」のように、着けると他の部位が使えなくなる装備がある
const BLOCKABLE = [['頭', 1 << 4], ['両手', 1 << 6], ['両脚', 1 << 7], ['両足', 1 << 8]];
function blockedSlots(desc) {
  const m = desc.match(/(\S+?)装備不可/);
  if (!m) return 0;
  return BLOCKABLE.reduce((mask, [name, bit]) => (m[1].includes(name) ? mask | bit : mask), 0);
}

// ジョブ専用装束の系統 (af / relic / empy) と強化段階 (+N) を、英語名から見分ける
const ARMOR_SLOTS = (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8);
function makeFamilyFinder() {
  const sets = JSON.parse(fs.readFileSync(SETS, 'utf8'));
  return (item) => {
    const job = Math.log2(item.jobs);
    const stems = sets.jobs[job];
    if (!stems || !(item.slots & ARMOR_SLOTS) || (item.level ?? 0) < 99 || !item.item_level) return null;
    const m = item.en.match(/^([A-Za-z]+)(?:\.|'s)? .*?(?: \+(\d))?$/);
    if (!m || m[1].length < 2) return null;
    const index = stems.findIndex((stem) => stem.startsWith(m[1]));
    return index < 0 ? null : { family: sets.families[index], plus: Number(m[2] ?? 0) };
  };
}

async function fetchResources(refresh) {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const name of FILES) {
    const file = path.join(CACHE, name + '.lua');
    if (!refresh && fs.existsSync(file)) continue;
    process.stderr.write(`取得: ${name}.lua\n`);
    const res = await fetch(SOURCE + name + '.lua');
    if (!res.ok) throw new Error(`${name}.lua を取得できない (HTTP ${res.status})`);
    fs.writeFileSync(file, await res.text());
  }
}

// リソースは 1 行 1 レコードの Lua テーブル。必要な形だけ読む
function loadLua(name) {
  const records = new Map();
  const field = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|(-?[\d.]+)|(true|false))/g;
  for (const line of fs.readFileSync(path.join(CACHE, name + '.lua'), 'utf8').split('\n')) {
    const m = line.match(/^\s*\[(\d+)\] = \{(.*)\},\s*$/);
    if (!m) continue;
    const record = {};
    for (const f of m[2].matchAll(field)) {
      record[f[1]] =
        f[2] !== undefined
          ? f[2].replace(/\\(n|.)/g, (_, c) => (c === 'n' ? '\n' : c))
          : f[3] !== undefined
            ? Number(f[3])
            : f[4] === 'true';
    }
    records.set(Number(m[1]), record);
  }
  if (records.size === 0) throw new Error(`${name}.lua を読めない (形式が変わった可能性)`);
  return records;
}

// 装備名 -> { group, family, ids, variants: [{ label, rank, path, text }] }。強化した状態を、元の装備とは別の候補として持つ。
// ids があるときは、その id の装備だけが対象 (同じ名前で強化段階の違う武器があるため)
function loadAugments() {
  const byName = new Map();
  for (const group of JSON.parse(fs.readFileSync(AUGMENTS, 'utf8')).groups) {
    for (const [name, entry] of Object.entries(group.items)) byName.set(name, { group: group.id, family: entry.family, ids: entry.ids, variants: entry.variants });
  }
  return byName;
}
// その装備が、強化できる対象か
const augmentOf = (augments, item) => {
  const entry = augments.get(item.ja);
  return entry && (!entry.ids || entry.ids.includes(item.id)) ? entry : null;
};

// 合成・錬成・釣り・採集のための装備は、戦闘用のセットには使わないので載せない
const CRAFT = /(木工|鍛冶|彫金|裁縫|革細工|骨細工|錬金術|調理)スキル|合成|錬成|釣|採掘|伐採|収穫|掘り/;

function build() {
  const items = loadLua('items');
  const descriptions = loadLua('item_descriptions');
  const jobs = loadLua('jobs');
  const skills = loadLua('skills');
  const augments = loadAugments();
  const rolls = JSON.parse(fs.readFileSync(AUGMENTS, 'utf8')).rolls?.items ?? {};
  const unusedAugments = new Set(augments.keys());

  const statIndex = new Map(); // key -> { k, n, neg, pct, plain, flag }
  const statOf = (key) => {
    let s = statIndex.get(key);
    if (!s) statIndex.set(key, (s = { k: key, n: 0, neg: 0, pct: 0, numeric: 0 }));
    return s;
  };

  // 「HP+91」と「HP+3%」のように同じ名前で単位が違うものは足し合わせられないので、
  // 少ない方の単位を別の名前 (「HP(%)」) に分ける
  const unitCount = new Map();
  const parsed = new Map();
  let crafting = 0;
  const seen = new Set();
  for (const item of items.values()) {
    if (item.category !== 'Armor' && item.category !== 'Weapon') continue;
    if (!item.slots || !item.jobs || !item.ja) continue;
    const desc = descriptions.get(item.id)?.ja ?? '';
    if (CRAFT.test(desc.normalize('NFKC'))) {
      crafting++;
      continue;
    }
    const identity = [item.ja, item.slots, item.jobs, desc].join('\u0000');
    if (seen.has(identity)) continue;
    seen.add(identity);
    const list = parseDescription(desc);
    for (const s of list) {
      if (s.value === null) continue;
      const count = unitCount.get(s.key) ?? unitCount.set(s.key, { pct: 0, flat: 0 }).get(s.key);
      count[s.unit === '%' ? 'pct' : 'flat']++;
    }
    // 元の装備に続けて、強化した状態を並べる
    parsed.set(item.id, { item, desc, augment: null, list });
    const entry = augmentOf(augments, item);
    for (const variant of entry?.variants ?? []) {
      unusedAugments.delete(item.ja);
      parsed.set(`${item.id}#${variant.label}`, { item, desc, augment: { ...variant, group: entry.group }, list: [...list, ...parseDescription(variant.text)] });
    }
  }
  const keyOf = (s) => {
    const count = unitCount.get(s.key);
    if (s.value === null || !count || !count.pct || !count.flat) return s.key;
    const minority = count.pct < count.flat ? '%' : '';
    if (s.unit !== minority) return s.key;
    return s.key + (minority === '%' ? '(%)' : '(実数)');
  };

  const familyOf = makeFamilyFinder();
  const familyCount = {};
  const out = [];
  for (const [id, { item, desc, augment, list }] of parsed) {
    const family = familyOf(item);
    if (family) familyCount[family.family] = (familyCount[family.family] ?? 0) + 1;
    // 「右耳:ダブルアタック+8%」は、右耳に着けたときの性能。条件つきにはせず、着けられる耳を右だけにする
    let earOnly = 0;
    // 同じ名前は合算する (オーグメントの上乗せ、ユニティランクの上乗せ)
    const totals = new Map();
    for (const raw of list) {
      const ear = raw.key.match(/^(右耳|左耳):(.+)$/);
      if (ear) earOnly = ear[1] === '右耳' ? 1 << 12 : 1 << 11;
      const s = { ...raw, key: keyOf(ear ? { ...raw, key: ear[2] } : raw) };
      const prev = totals.get(s.key);
      if (!prev) totals.set(s.key, s);
      else if (s.value !== null) {
        prev.value = (prev.value ?? 0) + s.value;
        prev.unit ||= s.unit;
      }
    }
    for (const d of DERIVED) {
      const parts = d.parts.map((p) => totals.get(p)?.value).filter((v) => v != null);
      if (parts.length) totals.set(d.key, { key: d.key, value: parts.reduce((a, b) => a + b, 0), unit: d.unit });
    }

    const stats = [];
    for (const s of totals.values()) {
      const stat = statOf(s.key);
      stat.n++;
      if (s.value !== null) {
        stat.numeric++;
        if (s.value < 0) stat.neg++;
        if (s.unit === '%') stat.pct++;
      }
      stats.push([stat, s.value]);
    }

    out.push({
      id,
      ja: item.ja,
      en: item.en,
      lv: item.level ?? 0,
      il: item.item_level ?? 0,
      su: item.superior_level ?? 0,
      slots: earOnly || item.slots,
      jobs: item.jobs,
      skill: item.category === 'Weapon' ? (item.skill ?? 0) : 0,
      block: blockedSlots(desc),
      desc,
      // 強化した状態のとき: どの系統か (画面で使う・使わないを選ぶ)、表示名、オーグメントの内容
      group: augment ? augment.group : family ? family.family : '',
      plus: family ? family.plus : 0,
      rank: augment ? augment.label : '',
      aug: augment ? augment.text : '',
      // 強化できる装備の、強化していない状態
      plain: !augment && augmentOf(augments, item) ? augmentOf(augments, item).group : '',
      // 強化できる装備の系統 (ニャメ、サクパタ…) と、強化のランク
      fam: augmentOf(augments, item)?.family ?? '',
      // ランダムで付くオーグメントの幅 (手入力の目安)
      roll: rolls[item.id] ?? '',
      rp: augment ? augment.rank : 0,
      stats,
    });
  }

  process.stderr.write(`合成・錬成・釣り・採集用として載せなかった装備: ${crafting} 件\n`);
  process.stderr.write(`ジョブ専用装束: ${Object.entries(familyCount).map(([k, v]) => `${k} ${v} 件`).join('、')}\n`);
  for (const name of unusedAugments) process.stderr.write(`警告: augments.json の「${name}」に一致する装備がない\n`);

  const stats = [...statIndex.values()].sort((a, b) => b.n - a.n || a.k.localeCompare(b.k, 'ja'));
  stats.forEach((s, i) => (s.i = i));
  for (const item of out) item.s = item.stats.flatMap(([stat, value]) => [stat.i, value]);

  // アンバスケードのマント。付与項目をステータスの番号に直しておく (画面側で組み合わせを作る)
  const capeData = JSON.parse(fs.readFileSync(CAPES, 'utf8'));
  const capes = {
    names: capeData.capes,
    augments: capeData.augments.map((group) => ({
      item: group.item,
      options: group.options.map((text) => {
        const list = parseDescription(text).map((s) => ({ ...s, key: keyOf(s) }));
        for (const s of list) {
          if (!statIndex.has(s.key)) process.stderr.write(`注意: マントの「${text}」の「${s.key}」は、他の装備に無いステータス\n`);
        }
        return { text, s: list.flatMap((s) => [statOf(s.key).i ?? -1, s.value]), keys: list.map((s) => s.key) };
      }),
    })),
  };
  for (const name of Object.values(capes.names)) {
    if (!out.some((item) => item.ja === name)) process.stderr.write(`警告: マント「${name}」が装備データに無い\n`);
  }

  // 同時に持てない装備の組 (報酬リングなど)。同じ組の装備に同じ番号 (only) を付ける
  const exclusive = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'exclusive.json'), 'utf8')).groups;
  exclusive.forEach((group, index) => {
    const names = new Set(group.names);
    let members = 0;
    for (const item of out) {
      if (!names.has(item.ja)) continue;
      item.only = index;
      members++;
    }
    if (members < 2) process.stderr.write(`警告: 同時に持てない組「${group.label}」に当たる装備が ${members} 件しかない\n`);
  });
  // 同じ装備の強化違い (ランク違い・方針違い) も、同時には持てない。耳や指に、同じ装備のランク 25 と 30 を
  // 並べて着けるような候補を出さないように、元の装備ごとに組を作る
  const sameItem = new Map(); // 元の装備の id -> 組の番号
  let nextGroup = exclusive.length;
  for (const item of out) {
    if (item.only != null || !(item.rank || item.plain)) continue;
    const baseId = String(item.id).split('#')[0];
    if (!sameItem.has(baseId)) sameItem.set(baseId, nextGroup++);
    item.only = sameItem.get(baseId);
  }

  // セット効果。どの装備がどのセットに数えられるかを決め、効果をステータスの番号に直す
  const firstWord = (en) => en.match(/^([A-Za-z]+(?:'[a-z]+)?)(?:\.|'s|')? /)?.[1].replace(/'s$/, '') ?? '';
  const plusOf = (en) => Number(en.match(/ \+(\d)$/)?.[1] ?? 0);
  const sets = JSON.parse(fs.readFileSync(SETBONUS, 'utf8')).sets.map((set, index) => {
    let members = 0;
    for (const item of out) {
      const job = Math.log2(item.jobs);
      const word = firstWord(item.en);
      const hit =
        (set.extra ?? []).includes(item.en) || (set.names ?? []).includes(item.en) ||
        (set.family && item.group === set.family && item.plus >= set.minPlus && !(set.exceptJobs ?? []).includes(job)) ||
        // 英語名は「Meg. Cuirie +2」のように省略されることがある。セット効果の表記がある防具に限る
        (set.en && item.slots & ARMOR_SLOTS && word.length >= 3 && set.en.startsWith(word) && plusOf(item.en) === set.plus &&
          /コンビネーション/.test(item.desc));
      if (!hit || (item.rank && !set.family)) continue;
      (item.set ??= []).push(index);
      members++;
    }
    if (members < 2) process.stderr.write(`警告: セット「${set.label}」に当たる装備が ${members} 件しかない\n`);
    const by = {};
    for (const [key, values] of Object.entries(set.stats)) {
      if (!statIndex.has(key)) process.stderr.write(`警告: セット「${set.label}」のステータス「${key}」が無い\n`);
      else by[statIndex.get(key).i] = values;
      // 被ダメージは「被物理ダメージ(被ダメージ込み)」などの合算にも効く
      for (const d of DERIVED) if (d.parts.includes(key)) by[statIndex.get(d.key).i] = values;
    }
    process.stderr.write(`セット ${set.label}: ${members} 件\n`);
    return { id: set.id, label: set.label, by };
  });

  // 入手先。設定画面の行ごとに、どの装備が属するか (装備の src) と、段階や入手元の一覧を作る
  const sourceItems = new Map(); // コンテンツの id -> [{ en, tier, from, nm_tier }]
  const sourceLabels = new Map();
  for (const file of fs.readdirSync(SOURCES).filter((f) => f.endsWith('.json')).sort()) {
    for (const content of JSON.parse(fs.readFileSync(path.join(SOURCES, file), 'utf8')).contents) {
      sourceItems.set(content.id, (sourceItems.get(content.id) ?? []).concat(content.items));
      sourceLabels.set(content.id, { label: content.label_ja, tiers: content.nm_tiers, url: (content.source ?? [])[0] ?? '' });
    }
  }
  const battlefields = fs.existsSync(BATTLEFIELDS) ? JSON.parse(fs.readFileSync(BATTLEFIELDS, 'utf8')) : {};
  const fromNames = battlefields.names ?? {};
  const fromPages = battlefields.pages ?? {};
  const byEnglish = new Map();
  for (const item of out) byEnglish.set(item.en, (byEnglish.get(item.en) ?? []).concat(item));
  const WEAPON_SLOTS = 0b111; // メイン・サブ・レンジ。固定したものだけを使うので、入手先では絞らない
  const contentConfig = JSON.parse(fs.readFileSync(CONTENTS, 'utf8'));
  const rows = contentConfig.rows.slice();
  const usedSources = new Set(rows.map((row) => row.source).concat(contentConfig.ignore ?? []));
  // 行の定義が無いコンテンツは、「そのほか」に入・切だけの行として足す
  for (const [id, info] of sourceLabels) if (!usedSources.has(id)) rows.push({ id, group: 'そのほか', label: info.label ?? id, source: id });
  const contents = [];
  for (const row of rows) {
    const filter = row.from ? new RegExp(row.from) : null;
    const listed = (sourceItems.get(row.source) ?? []).filter((it) => !filter || filter.test(it.from ?? ''));
    const index = contents.length;
    const froms = [];
    const names = new Set();
    let maxTier = 0;
    for (const entry of listed) {
      const matches = (byEnglish.get(entry.en) ?? []).filter((item) => item.slots & ~WEAPON_SLOTS);
      if (!byEnglish.has(entry.en)) process.stderr.write(`注意: 入手先「${row.label}」の ${entry.en} が装備データに無い (合成用などで載せていない装備の可能性)\n`);
      const tier = row.nm ? Math.max(0, (entry.nm_tier ?? 0) - 1) : row.tiers ? entry.tier ?? 0 : 0;
      if (matches.length) maxTier = Math.max(maxTier, tier);
      const sources = (entry.from ?? '').split(' / ');
      for (const item of matches) {
        names.add(item.ja);
        for (const from of sources) {
          if (!froms.includes(from)) froms.push(from);
          (item.src ??= []).push([index, tier, froms.indexOf(from)]);
        }
      }
    }
    if (!names.size) continue; // まだ一覧が無いコンテンツは行を出さない
    if (row.picks) {
      // 入手元を対応表の順に並べ直し、装備の側の番号も付け替える
      const known = Object.keys(fromNames);
      const rank = (from) => (known.includes(from) ? known.indexOf(from) : known.length);
      const sorted = froms.slice().sort((a, b) => rank(a) - rank(b));
      for (const item of out) for (const src of item.src ?? []) if (src[0] === index) src[2] = sorted.indexOf(froms[src[2]]);
      froms.splice(0, froms.length, ...sorted);
    }
    const tiers = row.tiers;
    if (tiers && maxTier >= tiers.length) process.stderr.write(`警告: 入手先「${row.label}」に、段階の名前が足りない装備がある (段階 ${maxTier})\n`);
    contents.push({
      id: row.id, group: row.group, label: row.label, note: row.note ?? '', n: names.size,
      tiers: tiers ?? null,
      // 入手元 (バトルフィールド、NM、系統など)。名前は、対応表があれば日本語にする。
      // picks が true のコンテンツは、設定で入手元ごとに選べる
      froms: froms.map((from) => fromNames[from] ?? from),
      fromKeys: froms,
      picks: !!row.picks,
      // Wiki のページ: コンテンツそのものと、分かっている入手元
      url: row.url ?? '',
      pages: froms.map((from) => fromPages[from] ?? ''),
    });
    process.stderr.write(`入手先 ${row.label}: ${names.size} 点${tiers ? `、段階 ${tiers.length}` : ''}${row.picks ? `、入手元 ${froms.length}` : ''}\n`);
  }

  // 説明文と同じ書き方の文字列を、[ステータスの番号, 値, …] に直す。他の装備に無いステータスは捨てる
  const encode = (text) => parseDescription(text)
    .map((s) => [statIndex.get(keyOf(s))?.i, s.value])
    .filter(([i, value]) => i !== undefined && value !== null)
    .flat();
  const foods = JSON.parse(fs.readFileSync(FOODS, 'utf8')).foods.map((f) => ({ group: f.group, ja: f.ja, help: f.help, s: encode(f.text) }));

  // ジョブ特性・ギフト・メリポ。{ ジョブ: { trait: [番号, 値, …], gift, jp, merit } }
  const jobData = JSON.parse(fs.readFileSync(JOBS, 'utf8'));
  const encodeStats = (stats, where) => Object.entries(stats ?? {}).flatMap(([key, value]) => {
    if (statIndex.has(key)) return [statIndex.get(key).i, value];
    process.stderr.write(`警告: ${where} の「${key}」が装備のステータスに無い\n`);
    return [];
  });
  // 共通のメリポ。id は保存に使う名前、i は効くステータスの番号 (装備に無いステータスは -1 で、計算には入らない)
  const innate = {
    jobs: {},
    shared: jobData.shared.groups.map((group) => ({
      label: group.label,
      limit: group.limit ?? null,
      items: group.items.map((item) => ({
        id: item.label ?? item.key, label: item.label ?? item.key, per: item.per, max: item.max,
        i: statIndex.has(item.key) ? statIndex.get(item.key).i : -1,
      })),
    })),
  };
  const missing = innate.shared.flatMap((g) => g.items).filter((item) => item.i < 0).map((item) => item.label);
  if (missing.length) process.stderr.write(`注意: 共通のメリポのうち、装備に無いステータスなので計算に入らないもの: ${missing.join('、')}\n`);
  for (const [job, sources] of Object.entries(jobData.jobs)) {
    innate.jobs[job] = Object.fromEntries(['trait', 'jp', 'merit'].map((kind) => [kind, encodeStats(sources[kind], `jobs.json ${job} ${kind}`)]));
    // ギフトは { ステータスの番号: [[使ったジョブポイントの合計, そこで増える値], …] }
    innate.jobs[job].gift = {};
    for (const [key, steps] of Object.entries(sources.gift ?? {})) {
      if (statIndex.has(key)) innate.jobs[job].gift[statIndex.get(key).i] = steps;
      else process.stderr.write(`警告: jobs.json ${job} gift の「${key}」が装備のステータスに無い\n`);
    }
  }

  const caps = new Map(); // ステータス名 -> [上限]。正と負の両方に上限があるものは 2 つ
  for (const c of JSON.parse(fs.readFileSync(CAPS, 'utf8')).caps) caps.set(c.key, (caps.get(c.key) ?? []).concat(c));
  for (const key of caps.keys()) if (!statIndex.has(key)) process.stderr.write(`警告: caps.json の「${key}」が装備のステータスに無い\n`);

  innate.smite = Object.fromEntries(Object.entries(jobData.smite.jobs).map(([code, steps]) => [[...jobs.values()].find((j) => j.ens === code).id, steps]));

  // ジョブ特性を覚えるレベル。サポートジョブの特性を、サポのレベルに応じて数えるのに使う。
  // { ジョブ: { ステータスの番号: [[レベル, その段階での値], …] } }
  innate.tiers = {};
  innate.support = null;
  if (fs.existsSync(TRAITS)) {
    const traitData = JSON.parse(fs.readFileSync(TRAITS, 'utf8'));
    const jobIds = Object.fromEntries([...jobs.values()].map((j) => [j.ens, j.id]));
    for (const [code, traits] of Object.entries(traitData.jobs)) {
      const byStat = {};
      for (const [key, tiers] of Object.entries(traits)) {
        if (!statIndex.has(key)) process.stderr.write(`警告: traits.json ${code} の「${key}」が装備のステータスに無い\n`);
        else byStat[statIndex.get(key).i] = tiers;
      }
      innate.tiers[jobIds[code]] = byStat;
    }
    innate.support = traitData.support_level ?? null;
  }

  const baseData = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  const baseTables = { races: baseData.races, jobs: baseData.jobs, scales: baseData.scales };
  const combatData = JSON.parse(fs.readFileSync(COMBAT, 'utf8'));
  const combatTables = { skills: combatData.skills, caps: combatData.caps, ratings: combatData.ratings };

  return {
    generated: new Date().toISOString().slice(0, 10),
    innate,
    foods,
    sets,
    exclusive: exclusive.map((group) => group.label),
    contents,
    links: contentConfig.links ?? {},
    derived: DERIVED.map((d) => ({ k: d.key, parts: d.parts })),
    capes,
    jobs: [...jobs.values()].filter((j) => j.id >= 1 && j.id <= 22).map((j) => ({ id: j.id, ja: j.ja, s: j.jas, en: j.ens })),
    // 素のステータスの計算に使う表 (種族・ジョブの成長)
    base: baseTables,
    // 攻撃・命中の計算に使う表 (武器の種類、ジョブごとのスキル上限)
    combat: combatTables,
    skills: Object.fromEntries([...skills.values()].filter((s) => s.ja).map((s) => [s.id, s.ja])),
    stats: stats.map((s) => ({
      k: s.k,
      n: s.n,
      num: s.numeric > 0 ? 1 : 0,
      // 「被ダメージ-7%」のように、小さいほど良いもの
      neg: s.neg * 2 > s.numeric ? 1 : 0,
      u: s.pct * 2 > s.numeric ? '%' : '',
      // 上限 (これを超えて積んでも効果が無い値) と、その説明
      ...(caps.has(s.k) ? { caps: caps.get(s.k).map((c) => ({ cap: c.cap, note: c.note, ...(c.jobs ? { jobs: c.jobs } : {}) })) } : {}),
    })),
    items: out.map(({ stats: _, ...rest }) => rest),
  };
}

await fetchResources(process.argv.includes('--refresh'));
const data = build();
fs.writeFileSync(OUTPUT, 'window.VANARMORY_DATA = ' + JSON.stringify(data) + ';\n');
const size = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
console.log(`装備 ${data.items.length} 件、ステータス ${data.stats.length} 種を ${path.relative(ROOT, OUTPUT)} に書き出した (${size} MB)`);
