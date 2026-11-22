// 検索の中身。画面 (app.js) とテスト (Node) の両方から使う。
(function (root) {
  'use strict';

  // 装備欄の並び。mask は装備データの slots (ビットの並びは Windower のリソースに合わせる)
  const SLOTS = [
    { id: 'main', ja: 'メイン', mask: 1 << 0 },
    { id: 'sub', ja: 'サブ', mask: 1 << 1 },
    { id: 'range', ja: 'レンジ', mask: 1 << 2 },
    { id: 'ammo', ja: '矢弾', mask: 1 << 3 },
    { id: 'head', ja: '頭', mask: 1 << 4 },
    { id: 'neck', ja: '首', mask: 1 << 9 },
    { id: 'ear', ja: '耳', mask: (1 << 11) | (1 << 12) },
    { id: 'body', ja: '胴', mask: 1 << 5 },
    { id: 'hands', ja: '両手', mask: 1 << 6 },
    { id: 'ring', ja: '指', mask: (1 << 13) | (1 << 14) },
    { id: 'back', ja: '背', mask: 1 << 15 },
    { id: 'waist', ja: '腰', mask: 1 << 10 },
    { id: 'legs', ja: '両脚', mask: 1 << 7 },
    { id: 'feet', ja: '両足', mask: 1 << 8 },
  ];

  // 略称や言い換えから正式な表記を引けるようにする
  const ALIASES = {
    'ストアTP': ['STP', 'ストア'],
    'ウェポンスキルのダメージ': ['WSダメージ', 'WSダメ', 'WSD'],
    'ウェポンスキルの命中': ['WS命中'],
    'ダブルアタック': ['DA', 'ダブル'],
    'トリプルアタック': ['TA', 'トリプル'],
    'クワッドアタック': ['QA', 'クワッド'],
    'クリティカルヒット': ['クリ', 'クリティカル率'],
    'クリティカルヒットダメージ': ['クリダメ'],
    '物理ダメージ上限': ['PDL', 'ダメージ上限'],
    'ファストキャスト': ['FC'],
    'マジックバーストダメージ': ['MB', 'MBダメージ'],
    'マジックバーストダメージII': ['MB2', 'MBII'],
    '被ダメージ': ['DT', 'カット', '被ダメ'],
    '被物理ダメージ': ['PDT', '物理カット'],
    '被魔法ダメージ': ['MDT', '魔法カット'],
    '被物理ダメージ(被ダメージ込み)': ['PDT', '物理カット'],
    '被魔法ダメージ(被ダメージ込み)': ['MDT', '魔法カット'],
    'トレジャーハンター': ['TH', 'トレハン'],
    '二刀流': ['DW'],
    'モクシャ': ['SB'],
    '敵対心': ['ヘイト'],
    '攻': ['攻撃力', '攻撃'],
    '防': ['防御力', '防御'],
    '魔攻': ['魔法攻撃力', 'MAB'],
    '魔命': ['魔法命中', 'MACC'],
    '魔回避': ['魔法回避', 'MEVA'],
    '魔防': ['魔法防御'],
    '飛攻': ['飛び道具攻撃', '遠隔攻撃'],
    '飛命': ['飛び道具命中', '遠隔命中'],
    '連携ボーナス': ['連携ダメージ'],
    'ケアル回復量': ['ケアル'],
    '移動速度': ['移動', 'スピード'],
    'D': ['D値', 'ダメージ'],
    '隔': ['間隔', 'ディレイ'],
  };

  // 検索で比べる形にそろえる: 全角・半角と大文字・小文字の違いをなくし、ひらがなはカタカナにする
  // (「ぼい」で「ボイイピアス」、「すとあ」で「ストアTP」が見つかる)
  const fold = (s) => s.normalize('NFKC').toLowerCase().replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

  function prepare(data) {
    const statByKey = new Map();
    data.stats.forEach((s, i) => {
      s.i = i;
      s.search = fold([s.k, ...(ALIASES[s.k] || [])].join('\n'));
      // 「ペット:命中」なら「命中」。条件つきは無印より後ろに並べる
      s.scoped = s.k.includes(':');
      statByKey.set(s.k, s);
    });
    for (const item of data.items) {
      item.m = new Map();
      for (let i = 0; i < item.s.length; i += 2) item.m.set(item.s[i], item.s[i + 1]);
      item.text = fold([item.ja, item.en, item.yomi, item.desc, item.aug].join('\n'));
      // 名前で探すときに比べる文字: 日本語名・英語名・読み
      item.names = fold([item.ja, item.en, item.yomi].join('\n'));
    }
    return { data, statByKey };
  }

  // 候補: 完全一致 → 前方一致 → 部分一致。同じ順位なら持つ装備が多い順
  function suggest(db, query, limit) {
    const q = fold(query.trim());
    if (!q) return [];
    const scored = [];
    for (const s of db.data.stats) {
      let best = 9;
      for (const word of s.search.split('\n')) {
        const rank = word === q ? 0 : word.startsWith(q) ? 1 : word.includes(q) ? 2 : 9;
        if (rank < best) best = rank;
      }
      if (best < 9) scored.push([best + (s.scoped ? 0.5 : 0), s]);
    }
    // 同じ順位なら、分類に挙げた順 (被ダメージ → 被物理 → 被魔法 など) を先に、あとは持つ装備が多い順
    const listed = (s) => (LISTED.has(s.k) ? LISTED.get(s.k) : Infinity);
    scored.sort((a, b) => a[0] - b[0] || listed(a[1]) - listed(b[1]) || b[1].n - a[1].n);
    return scored.slice(0, limit).map((e) => e[1]);
  }

  // dir: 'desc' は大きいほど良い、'asc' は小さいほど良い
  function passes(value, sel) {
    if (value === undefined) return false;
    if (sel.min === null || sel.min === undefined || value === null) return true;
    return sel.dir === 'asc' ? value <= sel.min : value >= sel.min;
  }

  // criteria: { stats: [{ i, min, dir }], mode, slotMask, job, skill, level, text, sort }
  function search(db, c) {
    const words = fold(c.text || '').split(/\s+/).filter(Boolean);
    const jobBit = c.job ? 2 ** c.job : 0;
    const result = [];
    for (const item of db.data.items) {
      if (c.slotMask && !(item.slots & c.slotMask)) continue;
      if (jobBit && Math.floor(item.jobs / jobBit) % 2 === 0) continue;
      if (c.skill >= 0 && item.skill !== c.skill) continue;
      if (c.level === 'il119' && item.il !== 119) continue;
      if (c.level === '99' && item.lv < 99) continue;
      if (words.length && !words.every((w) => item.text.includes(w))) continue;
      if (c.stats.length) {
        const hit = (sel) => passes(item.m.get(sel.i), sel);
        if (!(c.mode === 'or' ? c.stats.some(hit) : c.stats.every(hit))) continue;
      }
      result.push(item);
    }
    result.sort(comparator(c));
    return result;
  }

  function comparator(c) {
    const sel = c.stats.find((s) => s.i === c.sort);
    const fallback = (a, b) => b.il - a.il || b.lv - a.lv || b.su - a.su || a.ja.localeCompare(b.ja, 'ja');
    if (!sel) return fallback;
    const sign = sel.dir === 'asc' ? 1 : -1;
    return (a, b) => {
      const x = a.m.get(sel.i);
      const y = b.m.get(sel.i);
      // 値を持たないもの、数値でないものは後ろへ
      const xn = typeof x === 'number';
      const yn = typeof y === 'number';
      if (xn !== yn) return xn ? -1 : 1;
      if (xn && x !== y) return (x - y) * sign;
      if ((x === undefined) !== (y === undefined)) return x === undefined ? 1 : -1;
      return fallback(a, b);
    };
  }

  // 「ステータスを追加」で使う分類。keys に挙げたものを先に並べ、rule に合う残りを件数の多い順に続ける。
  // 分類名は仮置き
  const CATEGORIES = [
    { name: '基本ステータス', keys: ['HP', 'MP', 'STR', 'DEX', 'VIT', 'AGI', 'INT', 'MND', 'CHR', 'HP(%)', 'MP(%)'] },
    { name: '物理攻撃', keys: ['命中', '攻', 'ダブルアタック', 'トリプルアタック', 'クワッドアタック', 'クリティカルヒット', 'クリティカルヒットダメージ', '物理ダメージ上限', 'D', '隔', 'ダブルアタックダメージ', 'トリプルアタックダメージ', '残心', '蹴撃', 'カウンター'] },
    { name: 'TP・攻撃間隔', keys: ['ストアTP', 'ヘイスト', '二刀流', 'マーシャルアーツ', 'モクシャ', 'モクシャII', 'リゲイン', 'セーブTP', 'コンサーブTP'] },
    { name: 'ウェポンスキル', keys: ['ウェポンスキルのダメージ', 'ウェポンスキルの命中', 'TPボーナス', '連携ボーナス'], rule: /^ウェポンスキル/ },
    { name: '遠隔攻撃', keys: ['飛命', '飛攻', 'スナップショット', 'ラピッドショット', 'トゥルーショット', 'リサイクル', 'ダブルショット', 'トリプルショット'], rule: /ショット|乱れ撃ち/ },
    { name: '魔法攻撃', keys: ['魔攻', '魔命', '魔法ダメージ', 'マジックバーストダメージ', 'マジックバーストダメージII', '魔法クリティカルヒット', '魔法クリティカルヒットダメージ'], rule: /属性魔攻|属性魔命/ },
    { name: '詠唱・MP', keys: ['ファストキャスト', '詠唱中断率', 'コンサーブMP', 'リフレシュ', 'クイックマジック', 'ヒーリングMP'], rule: /詠唱|使用間隔/ },
    { name: '回復・強化', keys: ['ケアル回復量', 'ケアル回復量II', '被ケアル回復量', '強化魔法の効果時間', 'リジェネ回復量', '被ファランクス'], rule: /回復量|効果時間/ },
    { name: '防御・カット', keys: ['被ダメージ', '被物理ダメージ', '被魔法ダメージ', '被物理ダメージ(被ダメージ込み)', '被魔法ダメージ(被ダメージ込み)', '防', '回避', '魔回避', '魔防', '敵対心', 'リジェネ', '盾発動率', '全状態異常のレジスト'], rule: /^耐|^レジスト|^被/ },
    { name: 'スキル', keys: [], rule: /スキル$/ },
    { name: 'ペット', keys: [], rule: /^(ペット|召喚獣|オートマトン|飛竜|羅盤):|契約の履行/ },
    { name: 'その他', keys: ['トレジャーハンター', '移動速度'], rule: /^[^:]+$/ },
  ];
  const LISTED = new Map(CATEGORIES.flatMap((c) => c.keys).map((key, index) => [key, index]));
  const CATEGORY_LIMIT = 48; // 1 つの分類に並べる数。これより多い分は検索で探す

  // [{ name, stats: [ステータス], more: 並べきれなかった数 }]。数値を持つステータスだけ
  function categorize(db) {
    const taken = new Set();
    return CATEGORIES.map((category) => {
      const listed = category.keys.map((k) => db.statByKey.get(k)).filter((s) => s && s.num && s.n > 0);
      listed.forEach((s) => taken.add(s));
      return { category, listed };
    }).map(({ category, listed }) => {
      const rest = [];
      if (category.rule) {
        for (const s of db.data.stats) {
          // 「潜在能力:」などの条件つきは、ペット以外の分類には並べない (検索では出る)
          if (!s.num || s.n < 3 || taken.has(s) || !category.rule.test(s.k)) continue;
          if (s.scoped && category.name !== 'ペット') continue;
          taken.add(s);
          rest.push(s);
        }
      }
      const stats = listed.concat(rest);
      return { name: category.name, stats: stats.slice(0, CATEGORY_LIMIT), more: Math.max(0, stats.length - CATEGORY_LIMIT) };
    });
  }

  // ステータスの名前から分類を引く (セットの合計を分類ごとに見せるのに使う)。
  // 「潜在能力:」のような条件つきは、ペット以外は「条件つき」にまとめる
  const LISTED_IN = new Map(CATEGORIES.flatMap((c) => c.keys.map((key) => [key, c.name])));
  function categoryOf(key) {
    if (LISTED_IN.has(key)) return LISTED_IN.get(key);
    if (key.includes(':')) return CATEGORIES.find((c) => c.name === 'ペット').rule.test(key) ? 'ペット' : '条件つき';
    const found = CATEGORIES.find((c) => c.rule && c.rule.test(key));
    return found ? found.name : 'その他';
  }
  const CATEGORY_ORDER = CATEGORIES.map((c) => c.name).concat('条件つき');
  // 分類の中での並び。分類に挙げた順 (HP → MP → STR … など) を先に、あとは持つ装備が多い順
  const listedOrder = (stat) => (LISTED.has(stat.k) ? LISTED.get(stat.k) : 1000 + stat.i);

  function slotNames(mask) {
    return SLOTS.filter((s) => s.mask & mask).map((s) => s.ja);
  }

  // 装備の、FF11用語辞典のページを開くリンクマーク (ページが分かっている装備だけ)。画面で使う
  const WIKI_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9.5 2.5h4v4M13.5 2.5 7.5 8.5"/></svg>';
  function wikiLink(item) {
    if (!item || !item.page || typeof document === 'undefined') return null;
    const a = document.createElement('a');
    Object.assign(a, { className: 'wiki', href: `https://wiki.ffo.jp/html/${item.page}.html`, target: '_blank', rel: 'noopener', title: `${item.ja} のページを開く (FF11用語辞典)` });
    a.innerHTML = WIKI_ICON;
    a.addEventListener('click', (e) => e.stopPropagation()); // リンクを押しても、行やマスの選択は変えない
    return a;
  }

  const api = { SLOTS, ALIASES, prepare, wikiLink, suggest, search, slotNames, fold, categorize, categoryOf, CATEGORY_ORDER, listedOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
