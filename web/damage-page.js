// 「ダメージ」の画面。計算は damage.js、セットの中身 (装備・装備以外の値・スキル) は sets.js にある。
// ジョブ・サポ・食事は、選んだセットが持っているものを使う。条件を変えるたびに、すぐ計算し直す。
(function () {
  'use strict';

  const D = window.VanaDamage;
  const P = window.VanaProfiles;
  const B = window.VanaBase;
  const TP = window.VanaTP;
  const db = window.VanaSearch.prepare(window.VANARMORY_DATA);
  const data = db.data;
  let store = null;
  const S = window.VanaSets.create(db, P, () => store);
  const { SLOTS, totalsOf } = window.VanaSolver;

  const STORAGE = 'vanarmory.damage';
  const BUILDER = 'vanarmory.builder'; // 「セットを組む」の、いまの条件 (固定中の装備を読む)
  const $ = (id) => document.getElementById(id);
  const el = (tag, props, ...children) => {
    const node = Object.assign(document.createElement(tag), props || {});
    node.append(...children.filter((c) => c != null && c !== false));
    return node;
  };
  const help = window.VanaHelp.mark;
  const number = (v) => Math.round(v).toLocaleString('ja-JP');
  const percent = (v) => `${Math.round(v * 1000) / 10}%`;
  const fixed2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + number(Math.abs(v));

  // 敵の一覧。出典の確かな値が集まるまでは、手入力だけ
  const ENEMIES = data.enemies || [];
  const ENEMY_FIELDS = [
    { id: 'def', label: '防御力', value: 1300 }, { id: 'eva', label: '回避', value: 1200 },
    { id: 'vit', label: 'VIT', value: 300 }, { id: 'agi', label: 'AGI', value: 300 },
    { id: 'taken', label: '被物理ダメージ', value: 0, unit: '%', title: '敵の、物理ダメージの増減。−50 なら半分になる' },
    { id: 'int', label: 'INT', value: 300, title: '魔法 WS の系統係数に使う' }, { id: 'mnd', label: 'MND', value: 300, title: '魔法 WS の系統係数に使う' },
    { id: 'mdef', label: '魔防', value: 0, title: '敵の魔法防御力。魔法 WS と、属性つきの物理 WS の属性の分に効く' },
    { id: 'mtaken', label: '被魔法ダメージ', value: 0, unit: '%', title: '敵の、魔法ダメージの増減。魔法 WS・属性の分・連携のダメージに掛かる' },
    { id: 'gap', label: 'レベル差', value: 0, title: '敵のレベル − 自分のレベル。レベル差の補正がある場所のときだけ入れる (新しいコンテンツの多くは補正が無いので 0)' },
  ];
  // 支援・弱体・アビリティ (data/buffs.json)
  const BUFFS = data.buffs || [];
  // 段階をまとめて選ぶもの。歌の楽器、ロールの出目、風水魔法+ は、ふつう全部に同じものが掛かる
  const LEVELS = {
    歌: ['歌+0', '歌+4', '歌+7'],
    ロール: ['ラッキー', '11', 'ラッキー + ジョブボーナス', '11 + ジョブボーナス'],
    風水: ['風水魔法+0', '風水魔法+5', '風水魔法+10 (イドリス)'],
  };
  // いま効く段階の効果
  const optionOf = (buff) => buff.options[Math.min(buff.by ? state.levels[buff.by] || 0 : state.buffs[buff.id] || 0, buff.options.length - 1)];

  // 選んだものの効果をまとめる。who を渡すと、そのジョブ・サポで使えるアビリティも入れる
  function buffsFor(who) {
    const out = { flat: new Map(), atk: 0, ratk: 0, mh: 0, jh: 0, vel: 0, shots: 0, def: 0, eva: 0, names: [] };
    const slots = new Map();
    for (const buff of BUFFS) {
      if (!(buff.id in state.buffs)) continue;
      let e;
      if (buff.group === 'アビリティ') {
        e = !who ? null : who.job === buff.job ? buff.options[0] : who.sub === buff.job ? buff.sub : null;
      } else e = optionOf(buff);
      if (!e) continue;
      out.names.push(buff.ja);
      for (const [key, value] of Object.entries(e.s || {})) {
        const stat = db.statByKey.get(key);
        if (stat) out.flat.set(stat.i, (out.flat.get(stat.i) || 0) + value);
      }
      out.atk += e.atk || 0;
      out.ratk += (e.atk || 0) + (e.ratk || 0);
      out.mh += e.mh || 0;
      out.jh += e.jh || 0;
      out.vel += e.vel || 0;
      out.shots += e.shots || 0;
      out.eva += e.eva || 0;
      // 敵の防御力ダウンは、枠 (slot) ごとに大きいほうだけを取り、枠どうしは足す
      if (e.def) slots.set(buff.slot || buff.id, Math.max(slots.get(buff.slot || buff.id) || 0, e.def));
    }
    for (const value of slots.values()) out.def += value;
    out.def = Math.min(100, out.def);
    return out;
  }

  // 敵の一覧を絞る、レベルの幅
  const RANGES = [[0, 119, 'Lv119 まで'], [120, 129, 'Lv120〜129'], [130, 134, 'Lv130〜134'], [135, 139, 'Lv135〜139'], [140, 144, 'Lv140〜144'], [145, 149, 'Lv145〜149'], [150, 999, 'Lv150 以上']];
  const PAIR_NAMES = ['基準', '比較 1', '比較 2'];
  const PAIR_CLASSES = ['a', 'b', 'c'];

  const initial = () => ({
    pairs: [{ auto: 'fixed', ws: 'same' }],
    ws: 0, tp: 1000, enemy: '',
    values: Object.fromEntries(ENEMY_FIELDS.map((f) => [f.id, f.value])),
    manual: [], // 支援など: [{ k: ステータスの名前, v: 値 }]
    haste: { magic: 0, ability: 0 }, // 魔法とアビリティのヘイスト (%)
    aftermath: 0, // アフターマスの段階 (0 = 無し、1〜3)
    mode: 'melee', // 'melee' = 近接、'ranged' = 遠隔
    sc: { level: 0, every: 1 }, // 連携: 段階 (0 = 入れない、1〜3、4 = 極光・黒闇) と、WS 何回に 1 回 連携になるか
    buffs: {}, // 選んだ支援・弱体・アビリティ: { id: 選んだ段階の番号 }
    levels: { 歌: 2, ロール: 0, 風水: 1 }, // 歌・ロール・風水は、段階をまとめて選ぶ (LEVELS の番号)
    range: '', // 敵の一覧を絞るレベルの幅
  });
  let state = initial();
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
      if (saved) Object.assign(state, saved, { values: Object.assign(state.values, saved.values), haste: Object.assign(state.haste, saved.haste), sc: Object.assign(state.sc, saved.sc), levels: Object.assign(state.levels, saved.levels) });
      if (!Array.isArray(state.pairs) || !state.pairs.length) state.pairs = initial().pairs;
      state.pairs = state.pairs.slice(0, 3);
      state.manual = (state.manual || []).filter((m) => db.statByKey.has(m.k));
      state.buffs = Object.fromEntries(Object.entries(state.buffs || {}).filter(([id]) => BUFFS.some((b) => b.id === id)));
    } catch {
      state = initial();
    }
  }
  function changed() {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch { /* 保存できなくても動く */ }
    render();
  }

  // ---- セットを、計算できる形にする ----
  // key: 'fixed' = 「セットを組む」で固定中の装備、そのほか = 保存したセットの id
  function builderState() {
    try { return JSON.parse(localStorage.getItem(BUILDER) || 'null'); } catch { return null; }
  }
  function sourceOf(key) {
    if (key === 'fixed') {
      const b = builderState();
      if (!b || !b.job) return null;
      const ml = P.jobSetting(P.character(store), b.job).ml;
      const who = {
        job: b.job, sub: b.sub === b.job ? 0 : b.sub || 0,
        subLevel: b.subLevel != null ? b.subLevel : P.supportLevel(ml, data.innate.support),
        food: b.food || '', innate: Object.assign({ trait: true, gift: true, merit: true }, b.innate),
      };
      return { name: '固定中の装備', who, equip: b.fixed || {} };
    }
    const saved = P.character(store).sets.find((x) => x.id === key);
    return saved ? { name: saved.name, who: saved.who, equip: saved.equip } : null;
  }
  // ---- 武器の効果 (アフターマス、倍撃、隠しの WS ダメージ) ----
  // 出典: FF11用語辞典「アフターマス」https://wiki.ffo.jp/html/15869.html 、「ミシックウェポン」https://wiki.ffo.jp/html/15876.html 、
  //       BG-wiki の Relic / Empyrean / Mythic / Prime Aftermath と、各武器 (Level 119 III) のページ
  const ERGON = new Set(['エピオラトリー', 'イドリス']); // アフターマスはミシックと同じ形だが、WS の隠し効果は無い
  function weaponEffects(item, level) {
    const none = { family: null, flat: [], scale: 1, first: 0, twice: 0, thrice: 0, limit: 0, hidden: 0, chain: 0, notes: [] };
    if (!item || item.group !== 'ultimate') return none;
    const keys = [...item.m.keys()].map((i) => data.stats[i].k).filter((k) => k.startsWith('アフターマス'));
    if (!keys.length) return none;
    const has = (re) => keys.some((k) => re.test(k));
    const out = Object.assign({}, none, { flat: [], notes: [] });
    out.family = has(/飛命\+\/飛攻\+\/時々/) ? 'mythic-ranged' : has(/時々[23]倍撃$/) ? 'empyrean' : has(/時々2(-3)?回攻撃/) ? 'mythic' : has(/連携ボーナス|究極連携/) ? 'aeonic' : has(/物理ダメージ上限/) ? 'prime' : 'relic';
    // 対応する WS のダメージ+ (隠し効果)。武器の強化で付く「WS 名:ダメージ」とは別に掛かる
    out.hidden = out.family === 'relic' ? 40 : (out.family === 'mythic' && !ERGON.has(item.ja)) || out.family === 'mythic-ranged' || out.family === 'empyrean' ? 30 : 0;
    // レリックウェポン: メインの 1 発目が 13% で 3 倍撃 (アフターマスに関係なく出る)
    if (out.family === 'relic') { out.first = 0.13 * 2; out.notes.push('レリックウェポン: 13% で 3 倍撃 (近接はメインの 1 発目だけ。WS には乗らない)'); }
    if (!level) return out;
    if (out.family === 'relic') {
      // 「アフターマス:命中+15」のように、値が書いてあるものをそのまま足す
      for (const [i, value] of item.m) {
        const key = data.stats[i].k;
        const target = key.startsWith('アフターマス:') && db.statByKey.get(key.slice('アフターマス:'.length));
        if (target && typeof value === 'number') out.flat.push([target.i, value]);
      }
      out.notes.push('アフターマス: ' + out.flat.map(([i, v]) => `${data.stats[i].k}+${v}`).join(' '));
    } else if (out.family === 'empyrean') {
      const rate = [0.3, 0.4, 0.5][level - 1];
      const times = has(/時々3倍撃/) ? 3 : 2;
      out.scale = 1 + rate * (times - 1);
      out.notes.push(`アフターマス Lv${level}: 通常攻撃が ${rate * 100}% で ${times} 倍撃 (WS には乗らない)`);
    } else if (out.family === 'mythic') {
      if (level === 1) { out.flat.push([db.statByKey.get('命中').i, 30]); out.notes.push('アフターマス Lv1: 命中+30 (TP 1000 で撃ったときの値。TP 1999 で +49)'); }
      if (level === 2) { out.flat.push([db.statByKey.get('攻').i, 40]); out.notes.push('アフターマス Lv2: 攻+40 (TP 2000 で撃ったときの値。TP 2999 で +99)'); }
      if (level === 3) {
        if (has(/時々2-3回攻撃/)) { out.twice = 40; out.thrice = 20; } else out.twice = 60;
        out.notes.push(`アフターマス Lv3: 時々 2 回攻撃 ${out.twice}%` + (out.thrice ? `、3 回攻撃 ${out.thrice}%` : '') + ' (WS の 1 段目にも乗る)');
      }
    } else if (out.family === 'mythic-ranged') {
      if (level === 1) { out.flat.push([db.statByKey.get('飛命').i, 30]); out.notes.push('アフターマス Lv1: 飛命+30 (TP 1000 で撃ったときの値)'); }
      if (level === 2) { out.flat.push([db.statByKey.get('飛攻').i, 40]); out.notes.push('アフターマス Lv2: 飛攻+40 (TP 2000 で撃ったときの値)'); }
      if (level === 3) {
        const triple = has(/時々2-3倍撃/);
        out.scale = triple ? 1 + 0.4 * 1 + 0.2 * 2 : 1 + 0.4;
        out.notes.push(`アフターマス Lv3: 通常の射撃が 40% で 2 倍撃` + (triple ? '、20% で 3 倍撃' : '') + ' (WS には乗らない)');
      }
    } else if (out.family === 'aeonic') {
      out.chain = [3, 5, 10][level - 1];
      out.notes.push(`アフターマス Lv${level}: 連携ボーナス+${out.chain}%`);
    } else if (out.family === 'prime') {
      // 段階ごとに TP 1000〜3000 で 2〜8%、4〜10%、6〜12%。武器に書いてある値を、TP 3000 のときの値として読む
      const top = [...item.m].reduce((v, [i, value]) => (/^アフターマス.*物理ダメージ上限$/.test(data.stats[i].k) && typeof value === 'number' ? value : v), 0);
      out.limit = top ? Math.max(0, top - 3 * (3 - level)) : 0;
      out.notes.push(top ? `アフターマス Lv${level}: 物理ダメージ上限+${out.limit}%` : 'アフターマスの物理ダメージ上限+ の値が分からないため、入れていません');
    }
    return out;
  }

  // who は、通常攻撃用のセットのもの (WS 用のセットも、同じジョブ・サポ・食事で計算する)
  function build(source, who) {
    let equip = {};
    for (const [slot, id] of Object.entries(source.equip)) {
      const item = S.getItem(id);
      if (item) equip[slot] = item;
    }
    equip = S.withBare(equip);
    const effects = weaponEffects(state.mode === 'ranged' ? equip.range : equip.main, Number(state.aftermath) || 0);
    const buffs = buffsFor(who);
    const person = Object.assign({}, who, { manual: [...state.manual.map((m) => [db.statByKey.get(m.k).i, Number(m.v) || 0]), ...effects.flat, ...buffs.flat] });
    const set = Object.assign({ equip }, totalsOf(equip, S.outsideFor(person).base, data.sets));
    return { set, context: S.contextFor(person), who: person, name: source.name, effects, buffs };
  }

  // ---- 手ごとの値 ----
  const stat = (totals, key) => S.totalOf(totals, key);
  const kindOf = (item) => item && data.combat.skills.find((k) => k.id === item.skill);
  const capKind = (kind) => (kind.kind === 'h2h' ? 'h2h' : kind.ja === '両手刀' ? 'gkt' : kind.ja === '両手鎌' ? 'scythe' : kind.kind === 'two' ? 'two' : 'one');

  // セットの、近接の手 (メインと、二刀流のサブ・格闘のもう片方)。メインが近接の武器でなければ null
  // 遠隔: レンジの武器 (無ければ投てきの矢弾) で撃つ。形は近接の handsOf と同じで、ranged の印を付ける
  function shooterOf(built) {
    const { set, context } = built;
    const values = S.combatValues(set, context, true);
    if (!values) return null;
    const sheet = S.sheetValues(set, context);
    const total = (key) => sheet.values[key].white + sheet.values[key].green;
    const range = kindOf(set.equip.range) && kindOf(set.equip.range).kind === 'ranged' ? set.equip.range : null;
    const ammo = set.equip.ammo || null;
    const weapon = range || ammo;
    const trait = context.traits ? D.limitTrait(context.job, context.sub, context.subLevel) : 0;
    const limitPercent = stat(set.totals, '物理ダメージ上限') + built.effects.limit;
    const ammoDamage = ammo && ammo !== weapon ? stat(ammo.m, 'D') : 0;
    const main = {
      weapon, kind: values.kind, skill: values.skill, isSub: false, ranged: true,
      damage: stat(weapon.m, 'D') + ammoDamage, rankDamage: stat(weapon.m, 'D'),
      raw: values.rawAttack, pct: built.buffs.ratk / 100, attack: Math.floor(values.rawAttack * (1 + built.buffs.ratk / 100)), accuracy: values.accuracy.total,
      cap: D.limitOf(values.kind.ja === '射撃' ? 'gun' : 'bow', trait, limitPercent), hitCap: 95,
      // 撃つ速さは武器の隔だけで決まり、得 TP は武器 + 矢弾の隔で決まる
      shotDelay: S.delayOf(weapon), tpDelay: S.delayOf(weapon) + (ammo && ammo !== weapon ? S.delayOf(ammo) : 0),
    };
    return {
      ranged: true, kind: values.kind, main, sub: null, sheet, total, trait, limitPercent,
      crit: stat(set.totals, 'クリティカルヒット'),
      critDamage: stat(set.totals, 'クリティカルヒットダメージ') + stat(set.totals, 'クリティカルヒットダメージアップ'),
      multi: {},
    };
  }

  function handsOf(built) {
    if (state.mode === 'ranged') return shooterOf(built);
    const { set, context } = built;
    const main = set.equip.main;
    const kind = kindOf(main);
    if (!kind || kind.kind === 'ranged') return null;
    const sheet = S.sheetValues(set, context);
    const total = (key) => sheet.values[key].white + sheet.values[key].green;
    const job = sheet.job;
    const smiteOf = (jobId, level) => ((data.innate.smite || {})[jobId] || []).reduce((n, [at, value]) => (at <= level ? value : n), 0);
    const off = kind.kind !== 'h2h' && set.equip.sub && set.equip.sub.skill > 0 && kindOf(set.equip.sub) && kindOf(set.equip.sub).kind === 'one' ? set.equip.sub : null;
    const trait = context.traits ? D.limitTrait(context.job, context.sub, context.subLevel) : 0;
    const limitPercent = stat(set.totals, '物理ダメージ上限') + built.effects.limit;
    const hand = (weapon, other, isSub) => {
      const k = kindOf(weapon);
      const skillStat = db.statByKey.get(k.ja + 'スキル');
      const rating = (data.combat.ratings[job.en] || {})[k.ja];
      // スキル: ジョブの上限 + マスターレベル + 装備・メリポなど。もう片方の手の武器に付いているスキルは除く
      let skill = (rating ? data.combat.caps[rating] + context.ml : 0) + (skillStat ? set.totals.get(skillStat.i) || 0 : 0);
      if (other && other !== weapon && skillStat) skill -= other.m.get(skillStat.i) || 0;
      const weaponDamage = stat(weapon.m, 'D');
      const h2h = k.kind === 'h2h';
      const smite = !isSub && (k.kind === 'two' || h2h) && context.traits
        ? Math.max(smiteOf(context.job, 99), context.sub ? smiteOf(context.sub, context.subLevel) : 0) : 0;
      const raw = B.attack({ skill, str: total('STR'), flat: stat(set.totals, '攻'), hands: h2h ? 'h2h' : isSub ? 'off' : k.kind });
      return {
        weapon, kind: k, skill, isSub,
        damage: h2h ? D.bareDamage(skill) + weaponDamage : weaponDamage,
        rankDamage: h2h ? weaponDamage + 3 : weaponDamage,
        // 攻撃力の % (スマイト、バーサク、カオスロールなど) は、足し合わせてから 1 回だけ掛ける
        raw, pct: smite / 256 + built.buffs.atk / 100, attack: Math.floor(raw * (1 + smite / 256 + built.buffs.atk / 100)),
        accuracy: B.accuracy({ skill, dex: total('DEX'), flat: stat(set.totals, '命中') }),
        cap: D.limitOf(capKind(k), trait, limitPercent),
        hitCap: !isSub && (k.kind === 'one' || h2h) ? 99 : 95,
      };
    };
    const first = hand(main, off, false);
    // 格闘は、左右とも同じ武器・同じ値で殴る
    const second = kind.kind === 'h2h' ? Object.assign({}, first, { isSub: true }) : off ? hand(off, main, true) : null;
    return {
      kind, main: first, sub: second, sheet, total, trait, limitPercent,
      crit: stat(set.totals, 'クリティカルヒット'),
      critDamage: stat(set.totals, 'クリティカルヒットダメージ') + stat(set.totals, 'クリティカルヒットダメージアップ'),
      multi: { doubleAttack: stat(set.totals, 'ダブルアタック'), tripleAttack: stat(set.totals, 'トリプルアタック'), quadAttack: stat(set.totals, 'クワッドアタック') },
    };
  }

  const enemy = () => {
    const v = state.values;
    const n = (id) => Number(v[id]) || 0;
    const down = buffsFor(null);
    return { def: Math.max(1, n('def') * (1 - down.def / 100)), eva: n('eva') - down.eva, down, vit: n('vit'), agi: n('agi'), taken: Math.max(0, 1 + n('taken') / 100), gap: n('gap'), int: n('int'), mnd: n('mnd'), mdef: n('mdef'), mtaken: Math.max(0, 1 + n('mtaken') / 100) };
  };

  // 通常攻撃 (通常攻撃用のセット)
  function autoOf(built) {
    const h = handsOf(built);
    if (!h) return null;
    if (h.ranged) return shotsOf(built, h);
    const foe = enemy();
    const crit = D.critRate(h.total('DEX') - foe.agi, h.crit);
    const one = (hand) => {
      const fstr = D.fstr(h.total('STR') - foe.vit, hand.rankDamage);
      const ratio = D.ratioOf(hand.attack, foe.def, foe.gap);
      return {
        hand, fstr, ratio,
        hitRate: D.hitRate(hand.accuracy, foe.eva, hand.hitCap, foe.gap),
        hit: D.hit({ base: hand.damage + fstr, ratio, cap: hand.cap, crit, critDamage: h.critDamage, taken: foe.taken }),
      };
    };
    const fx = built.effects;
    const hands = [one(h.main), h.sub && one(h.sub)].filter(Boolean);
    // 武器の効果は、その武器で殴る手だけ (格闘は左右とも)
    hands.forEach((hand, i) => {
      if (i > 0 && h.kind.kind !== 'h2h') return;
      hand.scale = fx.scale;
      if (fx.twice || fx.thrice) hand.multi = Object.assign({}, h.multi, { twice: fx.twice, thrice: fx.thrice });
    });
    const round = D.round({ hands, multi: h.multi, first: fx.first });
    const setup = S.tpSetup('melee', built.set.equip, built.set.totals, built.context);
    const storeTp = stat(built.set.totals, 'ストアTP');
    const haste = D.hasteOf({ gear: stat(built.set.totals, 'ヘイスト'), magic: (Number(state.haste.magic) || 0) + built.buffs.mh, ability: (Number(state.haste.ability) || 0) + built.buffs.jh });
    // 縮める前の隔: 二刀流はメイン + サブ、格闘は 480 + 武器、そのほかは武器の隔
    const raw = setup.mode === 'dual' ? S.delayOf(built.set.equip.main) + S.delayOf(built.set.equip.sub) : setup.mode === 'h2h' ? 480 + S.delayOf(built.set.equip.main) : setup.total;
    return {
      h, hands, round, crit, setup, storeTp, haste, tpHit: TP.perHit(setup.delay, storeTp),
      time: D.roundTime(setup.total, raw, haste), hits: D.roundHits(hands, h.multi), fx,
    };
  }

  // 通常の射撃。適正距離で撃つものとする (距離による飛攻・飛命の低下は入れず、トゥルーショットは入れる)
  function shotsOf(built, h) {
    const foe = enemy();
    const totals = built.set.totals;
    const fx = built.effects;
    const crit = D.critRateRanged(h.total('AGI') - foe.agi, h.crit);
    const fstr = D.fstr2(h.total('STR') - foe.vit, h.main.rankDamage);
    const ratio = D.ratioOf(h.main.attack, foe.def, foe.gap, 0.025);
    const trueShot = 1 + stat(totals, 'トゥルーショット') / 100;
    const hand = {
      hand: h.main, fstr, ratio,
      hitRate: D.hitRate(h.main.accuracy, foe.eva, h.main.hitCap, foe.gap),
      hit: D.hit({ base: h.main.damage + fstr, ratio, cap: h.main.cap, crit, critDamage: h.critDamage, taken: foe.taken, ranged: true }),
      // 倍撃は 1 射ごとに判定する (レリックの 3 倍撃 13% も、遠隔では毎回)
      scale: fx.scale * (1 + fx.first) * trueShot,
    };
    // ダブルショット・トリプルショット: 40% で、増える発数ぶんだけ多く撃つ
    const more = built.buffs.shots > 0 ? Math.round(built.buffs.shots / 0.4) : 0;
    hand.scale *= 1 + built.buffs.shots;
    const round = D.round({ hands: [hand], multi: {} });
    const p = hand.hitRate;
    const hits = new Array(more + 2).fill(0);
    for (let k = 0, c = 1; k <= 1 + more; k++) { hits[k] += (more ? 0.4 : 0) * c * p ** k * (1 - p) ** (1 + more - k); c = (c * (1 + more - k)) / (k + 1); }
    hits[0] += (more ? 0.6 : 1) * (1 - p);
    hits[1] += (more ? 0.6 : 1) * p;
    const storeTp = stat(totals, 'ストアTP');
    const snapshot = stat(totals, 'スナップショット') + stat(totals, 'スナップショット効果アップ');
    const rapid = stat(totals, 'ラピッドショット') + stat(totals, 'ラピッドショット発動率アップ');
    return {
      h, hands: [hand], round, crit, storeTp, fx, trueShot, snapshot, rapid,
      tpHit: TP.perHit(h.main.tpDelay, storeTp),
      time: D.shotTime(h.main.shotDelay, { snapshot, rapid, velocity: built.buffs.vel }), hits,
    };
  }

  // WS (WS 用のセット)。ws: data.ws の 1 件
  function wsOf(built, ws, atTp) {
    const h = handsOf(built);
    if (!h || !ws) return null;
    const foe = enemy();
    const totals = built.set.totals;
    const tp = Math.min(3000, Math.max(1000, atTp || Number(state.tp) || 1000) + stat(totals, 'TPボーナス'));
    const stats = Object.fromEntries(window.VanaSets.SHEET_KEYS.map((key) => [key, h.total(key)]));
    const mod = D.wsc(stats, ws.mods);
    const ftp = D.byTp(tp, ws.ftp);
    const attackRate = ws.atk ? D.byTp(tp, ws.atk) : 1;
    const defense = foe.def * (1 - (ws.def ? D.byTp(tp, ws.def) : 0) / 100);
    const canCrit = !!ws.crit;
    const natural = h.ranged ? D.critRateRanged(h.total('AGI') - foe.agi, h.crit) : D.critRate(h.total('DEX') - foe.agi, h.crit);
    const crit = canCrit ? Math.min(1, natural + D.byTp(tp, ws.crit) / 100) : 0;
    const wsAccuracy = stat(totals, 'ウェポンスキルの命中') + (ws.acc ? D.byTp(tp, ws.acc) : 0);
    const one = (hand) => ({
      damage: hand.damage, fstr: (h.ranged ? D.fstr2 : D.fstr)(h.total('STR') - foe.vit, hand.rankDamage), ranged: h.ranged,
      // WS の攻撃力の補正も、ほかの % と足してから掛ける
      attack: Math.floor(hand.raw * (hand.pct + attackRate)),
      ratio: D.ratioOf(Math.floor(hand.raw * (hand.pct + attackRate)), defense, foe.gap, h.ranged ? 0.025 : 0.05), cap: hand.cap,
      // 近接の WS は 1 段目の命中 +100。遠隔の WS には無い
      firstHitRate: D.hitRate(hand.accuracy + wsAccuracy + (h.ranged ? 0 : 100), foe.eva, hand.hitCap, foe.gap),
      hitRate: D.hitRate(hand.accuracy + wsAccuracy, foe.eva, hand.hitCap, foe.gap),
      crit, critDamage: h.critDamage,
    });
    const main = one(h.main);
    const sub = h.sub ? one(h.sub) : null;
    const wsd = stat(totals, 'ウェポンスキルのダメージ') + stat(totals, 'ウェポンスキルのダメージアップ');
    const bonus = stat(totals, `${ws.ja}:ダメージ`);
    const fx = built.effects;
    const hidden = fx.hidden && h.main.weapon.desc.includes(ws.ja) ? fx.hidden : 0;
    const firstMulti = !h.ranged && (fx.twice || fx.thrice) ? Object.assign({}, h.multi, { twice: fx.twice, thrice: fx.thrice }) : null;
    const storeTp = stat(totals, 'ストアTP');
    const tpDelay = h.ranged ? h.main.tpDelay : S.tpSetup('melee', built.set.equip, totals, built.context).delay;
    const magicOf = { magicDamage: stat(totals, '魔法ダメージ'), magicAttack: stat(totals, '魔攻'), magicDefense: foe.mdef, taken: foe.mtaken, wsd, bonus, hidden };
    if (ws.kind === 'magic') {
      // 魔法 WS: 1 回だけ計算し、外れない (レジストは入れていない)。得 TP は 1 発ぶん
      const weapon = h.main.weapon;
      const base = D.magicBase(weapon.lv, weapon.il);
      const diff = ws.dstat ? h.total(ws.dstat.a) - (ws.dstat.b === 'MND' ? foe.mnd : foe.int) : 0;
      const ds = ws.dstat ? D.dstat(diff, ws.dstat.n) : 0;
      const damage = D.magicSkill(Object.assign({ base, wsc: mod, ftp, dstat: ds }, magicOf));
      const hitLike = { min: damage, max: damage, mean: damage, normal: { pdif: { min: 0, max: 0 } } };
      const part = (count) => ({ count, hitRate: 1, hit: hitLike, mean: count * damage });
      const flat = { mean: damage, min: damage, max: damage, attempts: 1, parts: { first: part(1), rest: part(0), multi: part(0), sub: null } };
      return { h, ws, tp, mod, ftp, attackRate: 1, defense: foe.def, crit: 0, main: Object.assign(main, { firstHitRate: 1, hitRate: 1 }), sub: null, wsd, bonus, hidden, result: flat, tpBack: TP.perHit(tpDelay, storeTp), magic: Object.assign({ base, ds, extra: damage }, magicOf) };
    }
    const result = D.weaponSkill({ main, sub, wsc: mod, ftp, replicate: ws.rep, hits: ws.hits, wsd, bonus, hidden, multi: h.multi, firstMulti, canCrit, taken: foe.taken });
    // WS で得る TP: メインの 1 段目とサブの 1 発目は通常の得 TP、そのほかの当たった分は 1 発 10 (ストアTP が掛かる)
    // 属性つきの物理 WS: 物理の分に、属性の分 (物理のダメージ × 属性の倍率に、魔攻などを掛けたもの) を足す
    let magic = null;
    if (ws.kind === 'hybrid' && ws.mftp) {
      const of = (physical) => D.hybridMagic(Object.assign({ physical, mftp: D.byTp(tp, ws.mftp) }, magicOf));
      magic = Object.assign({ mftp: D.byTp(tp, ws.mftp), extra: of(result.mean), physical: result.mean }, magicOf);
      result.max += of(result.max);
      result.min += of(result.min);
      result.mean += magic.extra;
    }
    const parts = result.parts;
    const small = Math.floor((10 * (100 + storeTp)) / 100);
    const others = parts.rest.count * main.hitRate + parts.multi.count * main.hitRate + (parts.sub ? (parts.sub.count - 1) * sub.hitRate : 0);
    const tpBack = TP.perHit(tpDelay, storeTp) * (main.firstHitRate + (sub ? sub.hitRate : 0)) + small * others;
    return { h, ws, tp, mod, ftp, attackRate, defense, crit, main, sub, wsd, bonus, hidden, result, tpBack, magic };
  }

  // ---- 画面 ----
  const setOptions = () => [
    { value: 'fixed', label: '固定中の装備 (セットを組む)' },
    ...P.character(store).sets.map((s) => ({ value: s.id, label: s.name })),
  ];
  function renderPairs() {
    const options = setOptions();
    const select = (value, onChange, extra) => {
      const node = el('select', null, ...[...(extra || []), ...options].map((o) => el('option', { value: o.value, textContent: o.label })));
      node.value = value;
      node.addEventListener('change', () => onChange(node.value));
      return node;
    };
    const boxes = state.pairs.map((pair, index) => {
      const source = sourceOf(pair.auto);
      const other = pair.ws === 'same' ? null : sourceOf(pair.ws);
      const remove = index > 0 && el('button', { type: 'button', textContent: '外す' });
      if (remove) remove.addEventListener('click', () => { state.pairs.splice(index, 1); changed(); });
      const differs = source && other && (other.who.job !== source.who.job || other.who.sub !== source.who.sub || (other.who.food || '') !== (source.who.food || ''));
      return el('div', { className: 'pair ' + PAIR_CLASSES[index] },
        el('div', { className: 'pair-head' }, el('span', { className: 'nb', textContent: PAIR_NAMES[index] }), remove),
        el('label', { className: 'field' }, '通常攻撃用 ', select(pair.auto, (v) => { pair.auto = v; changed(); })),
        el('label', { className: 'field' }, 'WS 用 ', select(pair.ws, (v) => { pair.ws = v; changed(); }, [{ value: 'same', label: '通常攻撃用と同じ' }])),
        el('div', { className: 'who' }, source ? el('b', { textContent: S.whoText ? S.whoText(source.who) : whoText(source.who) }) : 'セットを選んでください'),
        differs && el('div', { className: 'who warn', textContent: `WS 用のセットは「${whoText(other.who)}」で保存されています。通常攻撃用のジョブ・サポ・食事で計算します` }));
    });
    if (state.pairs.length < 3) {
      const add = el('button', { type: 'button', textContent: '＋ 比較を足す' });
      add.addEventListener('click', () => { state.pairs.push(Object.assign({}, state.pairs[state.pairs.length - 1])); changed(); });
      boxes.push(el('div', { className: 'pair empty' }, add));
    }
    $('pairs').replaceChildren(...boxes);
  }
  function whoText(who) {
    const job = data.jobs.find((j) => j.id === who.job);
    const sub = data.jobs.find((j) => j.id === who.sub);
    return `${job ? job.ja : '?'} 99` + (sub ? ` / ${sub.ja} ${who.subLevel}` : '') + (who.food ? `・${who.food}` : '・食事なし');
  }

  function renderEnemy() {
    const select = $('enemy');
    const [low, high] = state.range ? state.range.split('-').map(Number) : [0, 999];
    const shown = ENEMIES.filter((e) => e.lv >= low && e.lv <= high).sort((a, b) => a.lv - b.lv);
    // コンテンツごとにまとめて並べる
    const groups = [...new Set(shown.map((e) => e.group))];
    select.replaceChildren(el('option', { value: '', textContent: `自分で入れる${shown.length ? ` (一覧 ${shown.length} 件)` : ''}` }),
      ...groups.map((g) => el('optgroup', { label: g }, ...shown.filter((e) => e.group === g).map((e) => el('option', { value: e.id, textContent: `Lv${e.lv} ${e.ja}` })))));
    $('enemy-range').replaceChildren(el('option', { value: '', textContent: 'すべてのレベル' }), ...RANGES.filter(([a, b]) => ENEMIES.some((e) => e.lv >= a && e.lv <= b)).map(([a, b, label]) => el('option', { value: `${a}-${b}`, textContent: label })));
    $('enemy-range').value = state.range || '';
    select.value = ENEMIES.some((e) => e.id === state.enemy) ? state.enemy : '';
    $('enemy-values').replaceChildren(...ENEMY_FIELDS.map((f) => {
      const input = el('input', { className: 'input narrow', type: 'number', value: state.values[f.id], title: f.title || '' });
      input.addEventListener('change', () => { state.values[f.id] = Number(input.value) || 0; state.enemy = ''; changed(); });
      return el('label', { className: 'field', title: f.title || '' }, f.label + ' ', input, f.unit ? ' ' + f.unit : null);
    }));
    const picked = ENEMIES.find((e) => e.id === state.enemy);
    const LABEL = { def: '防御力', vit: 'VIT', agi: 'AGI' };
    const about = !picked ? '' : `選んだ敵: 回避は${picked.table ? '、レベルから必要命中の表を引いた値 (必要命中 − 40)' : '検証値'}。`
      + (picked.est.length ? `${picked.est.map((k) => LABEL[k]).join('・')}は、検証値が無いので、Apex モンスターの値をレベルに当てはめた目安です。` : '防御力なども検証値です。')
      + (picked.note ? picked.note + '。' : '') + '\n';
    $('enemy-note').replaceChildren(picked && picked.est.length ? el('span', { textContent: '目安の値あり' }) : '', help(about + '一覧から選ぶと値が入り、あとから手で直せます。\nレベル差は、レベル差の補正がある場所のときだけ入れます (新しいコンテンツの多くは補正が無いので 0)。'));
  }

  // 支援・弱体・アビリティの札。押すと入・切、入のときは段階を選べる
  function renderBuffs() {
    const chip = (buff, usable) => {
      const on = buff.id in state.buffs;
      const values = (e) => [e.atk && `攻 +${e.atk}%`, e.ratk && `飛攻 +${e.ratk}%`, e.mh && `魔法のヘイスト ${e.mh}%`, e.jh && `アビリティのヘイスト ${e.jh}%`, e.def && `敵の防御力 −${e.def}%`, e.eva && `敵の回避 −${e.eva}`, e.vel && `狙う時間 −${e.vel}%`, e.shots && `発数 +${e.shots}`,
        ...Object.entries(e.s || {}).map(([k, v]) => `${k} +${v}`)].filter(Boolean).join('、');
      const e = buff.group === 'アビリティ' ? usable : optionOf(buff);
      const button = el('button', { type: 'button', className: 'toggle' + (on ? ' on' : ''), title: [values(e), buff.note].filter(Boolean).join('\n') }, buff.ja);
      button.addEventListener('click', () => {
        if (on) delete state.buffs[buff.id];
        else {
          // 同じ種類 (ディアとディアII など) は、どれか 1 つだけ
          if (buff.x) for (const other of BUFFS) if (other.x === buff.x) delete state.buffs[other.id];
          state.buffs[buff.id] = 0;
        }
        changed();
      });
      if (!on || buff.by || buff.options.length < 2) return [button];
      const select = el('select', { title: '段階' }, ...buff.options.map((o, i) => el('option', { value: i, textContent: o.label })));
      select.value = String(Math.min(state.buffs[buff.id], buff.options.length - 1));
      select.addEventListener('change', () => { state.buffs[buff.id] = Number(select.value); changed(); });
      return [button, select];
    };
    // 段階をまとめて選ぶ欄 (歌の楽器、ロールの出目、風水魔法+)
    const level = (name) => {
      if (!LEVELS[name]) return null;
      const select = el('select', { title: `${name}の段階 (${name}のすべてに効く)` }, ...LEVELS[name].map((label, i) => el('option', { value: i, textContent: label })));
      select.value = String(state.levels[name] || 0);
      select.addEventListener('change', () => { state.levels[name] = Number(select.value); changed(); });
      return select;
    };
    const group = (name, bare) => el('div', { className: 'group' }, bare ? null : el('b', { textContent: name }), bare ? null : level(name), ...BUFFS.filter((b) => b.group === name).flatMap((b) => chip(b)));
    $('buffs').replaceChildren(...['歌', 'ロール', '風水', '魔法'].map((name) => group(name)));
    $('debuffs').replaceChildren(group('弱体', true));
    // アビリティは、基準のセットのジョブ・サポで使えるものだけ並べる
    const source = sourceOf(state.pairs[0].auto);
    const who = source && source.who;
    const usable = BUFFS.filter((b) => b.group === 'アビリティ').map((b) => [b, !who ? null : who.job === b.job ? b.options[0] : who.sub === b.job ? b.sub : null]).filter(([, e]) => e);
    // 入れたものの効果の合計 (基準のセットのジョブ・サポで)
    const sum = buffsFor(who);
    const pct = (v) => Math.round(v * 100) / 100;
    const parts = [
      ...[...sum.flat].map(([i, v]) => `${data.stats[i].k} +${pct(v)}`),
      sum.atk && `攻 +${pct(sum.atk)}%`, sum.ratk !== sum.atk && sum.ratk && `飛攻 +${pct(sum.ratk)}%`,
      sum.mh && `魔法のヘイスト ${pct(Math.min(43.75, sum.mh + (Number(state.haste.magic) || 0)))}%`, sum.jh && `アビリティのヘイスト ${pct(Math.min(25, sum.jh + (Number(state.haste.ability) || 0)))}%`,
      sum.def && `敵の防御力 −${pct(sum.def)}%`, sum.eva && `敵の回避 −${sum.eva}`, sum.vel && `狙う時間 −${sum.vel}%`, sum.shots && `発数 +${sum.shots}`,
    ].filter(Boolean);
    $('buff-sum').textContent = parts.length ? '効果の合計: ' + parts.join('、') : '';
    $('abilities').replaceChildren(...(usable.length ? [el('div', { className: 'group' }, ...usable.flatMap(([b, e]) => chip(b, e)))] : [el('span', { className: 'field', textContent: who ? 'このジョブ・サポで選べるアビリティはありません' : '' })]));
  }

  function renderManual() {
    const rows = state.manual.map((m, index) => {
      const input = el('input', { className: 'input narrow', type: 'number', value: m.v });
      input.addEventListener('change', () => { m.v = Number(input.value) || 0; changed(); });
      const remove = el('button', { type: 'button', textContent: '×', title: '外す' });
      remove.addEventListener('click', () => { state.manual.splice(index, 1); changed(); });
      return el('span', { className: 'one' }, m.k + ' ', input, remove);
    });
    const name = el('input', { className: 'input', type: 'text', placeholder: 'ステータスの名前 (攻、命中、STR、ダブルアタック…)', size: 30 });
    name.setAttribute('list', 'stat-names');
    const add = el('button', { type: 'button', className: 'add-pair', textContent: '＋ 数値で足す' });
    const push = () => {
      const key = name.value.trim();
      if (!db.statByKey.has(key)) { name.setCustomValidity('その名前のステータスはありません'); name.reportValidity(); return; }
      if (!state.manual.some((m) => m.k === key)) state.manual.push({ k: key, v: 0 });
      changed();
    };
    add.addEventListener('click', push);
    name.addEventListener('input', () => name.setCustomValidity(''));
    name.addEventListener('keydown', (event) => { if (event.key === 'Enter') push(); });
    const hasteInput = (key, label, title) => {
      const input = el('input', { className: 'input narrow', type: 'number', min: 0, step: 'any', value: state.haste[key] });
      input.addEventListener('change', () => { state.haste[key] = Math.max(0, Number(input.value) || 0); changed(); });
      return el('label', { className: 'field', title }, label + ' ', input, ' %');
    };
    $('manual').replaceChildren(
      hasteInput('magic', '魔法のヘイスト', 'ヘイストやマーチなど、魔法と歌のヘイストの合計 (43.75% まで)'),
      hasteInput('ability', 'アビリティのヘイスト', 'ヘイストサンバや八双など、アビリティのヘイストの合計 (25% まで)'),
      ...rows, name, add);
  }

  // 表を作る。columns: 組ごとの計算結果、rows: [{ label, cls, value(c) → 表示, number(c) → 差を出す値, unit }]
  function table(columns, rows, extraHead) {
    const head = el('tr', null, el('th'), ...columns.map((c, i) => el('th', { className: PAIR_CLASSES[i], textContent: `${PAIR_NAMES[i]}` })), extraHead ? el('th', { className: 'why', textContent: extraHead }) : null);
    const body = rows.filter(Boolean).map((row) => {
      if (row.head) return el('tr', { className: 'head' }, el('td', { colSpan: columns.length + (extraHead ? 2 : 1), textContent: row.head }));
      const base = row.number && columns[0] ? row.number(columns[0]) : null;
      return el('tr', { className: row.cls || '' }, el('td', { textContent: row.label }),
        ...columns.map((c, i) => {
          const cell = el('td', null, ...[].concat(row.value(c)));
          if (i > 0 && base != null && row.number) {
            const diff = row.number(c) - base;
            const rate = base ? ` (${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(Math.round((diff / base) * 1000) / 10)}%)` : '';
            const shown = row.unit === 'x' ? `${diff > 0 ? '+' : '−'}${Math.abs(Math.round(diff * 100) / 100)}` : row.unit === '%' ? `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(Math.round(diff * 1000) / 10)}` : signed(diff) + (row.rate && Math.round(diff) ? rate : '');
            cell.append(el('span', { className: 'd ' + (Math.abs(diff) < 1e-9 ? 'same' : diff > 0 ? 'up' : 'down'), textContent: Math.abs(diff) < 1e-9 ? '±0' : shown }));
          }
          return cell;
        }),
        extraHead ? el('td', { className: 'why', textContent: row.why || '' }) : null);
    });
    return el('table', { className: 'cmp' }, el('thead', null, head), el('tbody', null, ...body));
  }
  const range = (hit) => el('span', { className: 'range', textContent: ` ${number(hit.min)} 〜 ${number(hit.max)}` });
  const capMark = (on) => (on ? el('span', { className: 'cap', textContent: '上限' }) : null);

  function render() {
    renderPairs();
    renderEnemy();
    renderManual();
    renderBuffs();
    $('tp').value = state.tp;
    $('aftermath').value = String(state.aftermath || 0);
    $('mode').value = state.mode;
    $('sc-level').value = String(state.sc.level || 0);
    $('sc-every').value = String(state.sc.every || 1);
    $('sc-every').hidden = !state.sc.level;

    const problems = [];
    const columns = state.pairs.map((pair, index) => {
      const autoSource = sourceOf(pair.auto);
      if (!autoSource) { problems.push(`${PAIR_NAMES[index]}: 通常攻撃用のセットがありません (「セットを組む」でジョブを選び、装備を固定するか、セットを保存してください)`); return null; }
      const wsSource = pair.ws === 'same' ? autoSource : sourceOf(pair.ws);
      const autoBuilt = build(autoSource, autoSource.who);
      const wsBuilt = build(wsSource || autoSource, autoSource.who);
      const lack = state.mode === 'ranged' ? 'レンジ (か矢弾) に、撃つ武器がありません' : 'メインに、近接の武器がありません';
      if (!handsOf(autoBuilt)) { problems.push(`${PAIR_NAMES[index]}: 「${autoSource.name}」の${lack}`); return null; }
      if (!handsOf(wsBuilt)) { problems.push(`${PAIR_NAMES[index]}: WS 用のセットの${lack}`); return null; }
      return { autoBuilt, wsBuilt };
    });

    // WS は、基準の WS 用のセットのメインの武器で撃てるもの
    const first = columns[0];
    const skill = first ? handsOf(first.wsBuilt).main.weapon.skill : 0;
    const list = (data.ws || []).filter((w) => w.skill === skill);
    $('ws').replaceChildren(...list.map((w) => el('option', { value: w.id, textContent: w.ja })));
    if (!list.some((w) => w.id === state.ws)) state.ws = list.length ? list[0].id : 0;
    $('ws').value = state.ws;
    const ws = list.find((w) => w.id === state.ws) || null;
    const notes = [];
    if (ws && ws.unknown) notes.push(`「${ws.unknown.join('、')}」は確かな値が分かっていません` + (ws.unknown.some((u) => !/おおよそ/.test(u)) ? ' (分からない補正は、無いものとして計算します)' : ''));
    if (ws && ws.merit) notes.push('修正項目は、メリットポイントを 5 段階まで上げた値です');
    if (ws && ws.note) notes.push(ws.note);
    if (ws && ws.guess) notes.push(ws.guess);
    if (ws && ws.kind !== 'phys') notes.push((ws.kind === 'magic' ? '魔法 WS' : '属性つきの物理 WS') + `${ws.element ? ` (${ws.element})` : ''}: レジスト・天候と曜日・属性の相性は入れていません`);
    if (ws && ws.differs) notes.push(`用語辞典の値 (${ws.differs}) と BG-wiki の値が違うため、BG-wiki の値で計算しています`);
    $('ws-note').replaceChildren(...(ws ? (notes.length ? [el('span', { textContent: '注記あり' }), help(notes.join('\n'))] : []) : [first ? 'この武器で撃てる WS がありません' : '']));

    const out = [];
    for (const p of problems) out.push(el('p', { className: 'problem', textContent: p }));
    const ready = columns.filter(Boolean);
    if (ready.length === columns.length && ready.length) {
      const calc = ready.map((c) => {
        const auto = autoOf(c.autoBuilt);
        if (!ws) return { auto, ws: null, c };
        // WS で得る TP は撃つときの TP でほとんど変わらないので、まず撃つ TP で計算し、サイクルから平均の TP を出して計算し直す
        const threshold = Math.min(3000, Math.max(1000, Number(state.tp) || 1000));
        const first = wsOf(c.wsBuilt, ws, threshold);
        const loop = D.cycle({ start: first.tpBack, threshold, tpHit: auto.tpHit, hits: auto.hits });
        const shot = wsOf(c.wsBuilt, ws, loop.tp);
        const seconds = loop.rounds * auto.time + WS_SECONDS;
        const autoDamage = loop.rounds * auto.round.damage;
        // 連携のダメージ: 閉じた WS のダメージから。every 回に 1 回だけ連携になるものとして、1 回あたりにならす
        const chainBonus = stat(c.wsBuilt.set.totals, '連携ボーナス') + c.wsBuilt.effects.chain;
        const chain = state.sc.level ? D.skillchain(shot.result.mean, state.sc.level, chainBonus, enemy().mtaken) / Math.max(1, state.sc.every) : 0;
        return { auto, ws: shot, c, loop, seconds, autoDamage, chain, chainBonus, perMinute: ((autoDamage + shot.result.mean + chain) / seconds) * 60 };
      });
      if (ws) out.push(timePanel(calc, ws), wsPanel(calc, ws));
      out.push(autoPanel(calc));
      out.push(stepsPanel(calc, ws));
    }
    // 枠の幅の目安: 項目名 + 組の数ぶんの列
    $('out').style.setProperty('--col', `${230 + 200 * state.pairs.length}px`);
    $('out').replaceChildren(...out);
  }

  // WS を撃つのに掛かる時間 (秒)。撃っている間は通常攻撃が止まる
  const WS_SECONDS = 2;
  function timePanel(calc) {
    const all = (c) => c.autoDamage + c.ws.result.mean + c.chain;
    const bar = (c) => el('div', { className: 'bar' }, el('i', { className: 'auto', style: `width:${(c.autoDamage / all(c)) * 100}%` }), el('i', { className: 'ws', style: `width:${(c.ws.result.mean / all(c)) * 100}%` }), el('i', { className: 'sc', style: `width:${(c.chain / all(c)) * 100}%` }));
    const finite = calc.every((c) => Number.isFinite(c.loop.rounds));
    return el('div', { className: 'panel' },
      el('h3', { className: 'sec-title' }, '時間あたりのダメージ', help(`通常攻撃で TP をため、ラウンドの終わりに撃つ TP 以上なら WS 用に着替えて撃つ、を繰り返したときの平均です。WS を撃つのに ${WS_SECONDS} 秒かかるものとし、リゲインや被ダメージで得る TP は入れていません。` + (state.sc.level ? `\n連携のダメージは、閉じた WS のダメージ × ${D.SKILLCHAIN[state.sc.level]} × (1 + 連携ボーナス ${Math.min(50, calc[0].chainBonus)}%) で、敵の属性の耐性は入れていません。` : ''))),
      finite ? table(calc, [
        { label: '1 分あたり', cls: 'big', value: (c) => number(c.perMinute), number: (c) => c.perMinute, rate: true },
        { label: '内訳', value: (c) => bar(c) },
        { label: '通常攻撃', cls: 'sub', value: (c) => number((c.autoDamage / c.seconds) * 60), number: (c) => (c.autoDamage / c.seconds) * 60 },
        { label: 'WS', cls: 'sub', value: (c) => number((c.ws.result.mean / c.seconds) * 60), number: (c) => (c.ws.result.mean / c.seconds) * 60 },
        state.sc.level ? { label: '連携', cls: 'sub', value: (c) => number((c.chain / c.seconds) * 60), number: (c) => (c.chain / c.seconds) * 60 } : null,
        { label: 'WS の間隔', value: (c) => `${(Math.round(c.seconds * 10) / 10).toFixed(1)} 秒 (${(Math.round(c.loop.rounds * 10) / 10).toFixed(1)} ${c.auto.h.ranged ? '射' : 'ラウンド'})`, number: (c) => c.seconds, unit: 'x' },
        { label: state.mode === 'ranged' ? '1 射の時間' : '1 ラウンドの時間', value: (c) => (c.auto.h.ranged ? [`${fixed2(c.auto.time)} 秒 `, el('span', { className: 'range', textContent: `スナップショット ${c.auto.snapshot}%` }), capMark(c.auto.snapshot >= 70)] : [`${fixed2(c.auto.time)} 秒 `, el('span', { className: 'range', textContent: `ヘイスト ${Math.round(c.auto.haste * 1000) / 10}%` }), capMark(c.auto.haste >= 0.8)]), number: (c) => c.auto.time, unit: 'x' },
        { label: '撃つときの TP (平均)', value: (c) => number(c.ws.tp), number: (c) => c.ws.tp },
        { label: 'WS で得る TP', value: (c) => number(c.ws.tpBack), number: (c) => c.ws.tpBack },
      ]) : el('p', { className: 'problem', textContent: '通常攻撃で TP がたまりません (得 TP が 0 か、命中率が 0 です)' }),
      el('div', { className: 'keys' }, el('span', null, el('i', { className: 'auto' }), '通常攻撃'), el('span', null, el('i'), 'WS'), state.sc.level ? el('span', null, el('i', { className: 'sc' }), '連携') : null));
  }

  function wsPanel(calc, ws) {
    const r = (c) => c.ws.result;
    return el('div', { className: 'panel' },
      el('h3', { className: 'sec-title' }, `WS: ${ws.ja}`, help('WS 用のセットで、撃つときの TP (平均) に TP ボーナスを足した TP で計算します。\n平均は、外れた分も入れた 1 回あたりの値です。最小は、段数ぶんがすべて当たって複数回攻撃が出ず、乱数が最小のとき。最大は、複数回攻撃が最大まで出て、乱数が最大のとき。')),
      table(calc, [
        { label: '平均', cls: 'big', value: (c) => number(r(c).mean), number: (c) => r(c).mean, rate: true },
        { label: '最小〜最大', value: (c) => el('span', { className: 'range', textContent: `${number(r(c).min)} 〜 ${number(r(c).max)}` }) },
        { label: '命中率 (1 段目)', value: (c) => [percent(c.ws.main.firstHitRate), capMark(c.ws.main.firstHitRate * 100 >= c.ws.h.main.hitCap)], number: (c) => c.ws.main.firstHitRate, unit: '%' },
        { label: '命中率 (2 段目以降)', value: (c) => [percent(c.ws.main.hitRate), capMark(c.ws.main.hitRate * 100 >= c.ws.h.main.hitCap)], number: (c) => c.ws.main.hitRate, unit: '%' },
        ws.crit && { label: 'クリティカル率', value: (c) => percent(c.ws.crit), number: (c) => c.ws.crit, unit: '%' },
        { label: '1 段目', cls: 'sub', value: (c) => [number(r(c).parts.first.mean), range(r(c).parts.first.hit)], number: (c) => r(c).parts.first.mean },
        ws.hits > 1 && { label: `2〜${ws.hits} 段目`, cls: 'sub', value: (c) => number(r(c).parts.rest.mean), number: (c) => r(c).parts.rest.mean },
        calc.some((c) => r(c).parts.sub) && { label: 'サブ (もう片方の手)', cls: 'sub', value: (c) => (r(c).parts.sub ? number(r(c).parts.sub.mean) : '—'), number: (c) => (r(c).parts.sub ? r(c).parts.sub.mean : 0) },
        { label: '複数回攻撃の分', cls: 'sub', value: (c) => number(r(c).parts.multi.mean), number: (c) => r(c).parts.multi.mean },
      ]));
  }

  function autoPanel(calc) {
    const a = (c) => c.auto;
    const hit = (c) => a(c).hands[0].hit;
    const ranged = state.mode === 'ranged';
    return el('div', { className: 'panel' },
      el('h3', { className: 'sec-title' }, ranged ? '通常の射撃' : '通常攻撃', help('通常攻撃用のセットで計算します。' + (ranged ? '適正距離で撃つものとし、距離による飛攻・飛命の低下は入れていません。' : '1 ラウンドの平均は、外れた分と複数回攻撃を入れた値です。'))),
      table(calc, [
        { label: ranged ? '1 射の平均' : '1 ラウンドの平均', cls: 'big', value: (c) => number(a(c).round.damage), number: (c) => a(c).round.damage, rate: true },
        { label: '1 発 (当たったとき)', value: (c) => [number(hit(c).mean), range(hit(c))], number: (c) => hit(c).mean },
        { label: 'クリティカルでないとき', cls: 'sub', value: (c) => [number(hit(c).normal.mean), range(hit(c).normal)], number: (c) => hit(c).normal.mean },
        { label: 'クリティカルのとき', cls: 'sub', value: (c) => [number(hit(c).critical.mean), range(hit(c).critical)], number: (c) => hit(c).critical.mean },
        calc.some((c) => a(c).hands[1]) && { label: 'サブ (もう片方の手) の 1 発', value: (c) => (a(c).hands[1] ? [number(a(c).hands[1].hit.mean), range(a(c).hands[1].hit)] : '—'), number: (c) => (a(c).hands[1] ? a(c).hands[1].hit.mean : 0) },
        { label: '命中率', value: (c) => [percent(a(c).hands[0].hitRate), capMark(a(c).hands[0].hitRate * 100 >= a(c).h.main.hitCap)], number: (c) => a(c).hands[0].hitRate, unit: '%' },
        { label: 'クリティカル率', value: (c) => percent(a(c).crit), number: (c) => a(c).crit, unit: '%' },
        !ranged && { label: '1 ラウンドの攻撃回数', value: (c) => fixed2(a(c).round.swings), number: (c) => a(c).round.swings, unit: 'x' },
        { label: '1 発の得 TP', value: (c) => number(a(c).tpHit), number: (c) => a(c).tpHit },
      ]));
  }

  function stepsPanel(calc, ws) {
    const w = (c) => c.ws;
    const a = (c) => c.auto;
    const foe = enemy();
    const mods = ws ? Object.entries(ws.mods).map(([k, v]) => `${k} ${v}%`).join(' + ') : '';
    const pd = (h) => `${fixed2(h.normal.pdif.min)} 〜 ${fixed2(h.normal.pdif.max)}`;
    const rows = [];
    if (ws) {
      rows.push({ head: 'WS (WS 用のセット)' },
        { label: '攻撃力', value: (c) => number(w(c).main.attack), number: (c) => w(c).main.attack, why: ws.atk ? `WS の攻撃力の補正 ×${fixed2(calc[0].ws.attackRate)} を掛けたあと` : state.mode === 'ranged' ? 'スキル + STR + 飛攻' : 'スキル + STR + 攻 (両手武器・格闘はスマイトを掛ける)' },
        { label: '攻防比', value: (c) => fixed2(w(c).main.ratio), why: `攻撃力 ÷ 敵の防御力 ${number(calc[0].ws.defense)}` + (foe.down.def ? ` (弱体で −${Math.round(foe.down.def * 100) / 100}%)` : '') + (foe.gap > 0 ? ` − レベル差 ${foe.gap} × ${state.mode === 'ranged' ? 0.025 : 0.05}` : '') },
        { label: '倍率 (クリティカルでないとき)', value: (c) => pd(w(c).result.parts.first.hit), why: state.mode === 'ranged' ? '攻防比から決まる幅の中の乱数' : '攻防比から決まる幅。この中の乱数に、さらに 1.00〜1.05 を掛ける' },
        { label: '倍率の上限', value: (c) => fixed2(w(c).h.main.cap), why: '武器種の上限 + 特性「ダメージ上限アップ」に、物理ダメージ上限+ を掛けたもの。' + (state.mode === 'ranged' ? 'クリティカルは、上限のあとに 1.25 倍' : 'クリティカルは +1.0') },
        { label: '武器のＤ', value: (c) => number(w(c).main.damage), why: state.mode === 'ranged' ? '弓や銃のＤ + 矢弾のＤ' : '格闘は、スキルから決まる素手のＤを足したもの' },
        { label: 'STR の補正', value: (c) => fixed2(w(c).main.fstr), why: `自分の STR − 敵の VIT ${number(foe.vit)} から。上限は、近接が 8 + Ｄ÷9、遠隔がその 2 倍` },
        { label: 'ステータス修正', value: (c) => number(w(c).mod), number: (c) => w(c).mod, why: mods },
        { label: 'TP による倍率', value: (c) => fixed2(w(c).ftp) + (ws.rep ? ' (全段)' : ''), why: `TP 1000 / 2000 / 3000 で ${ws.ftp.join(' / ')}。間は直線でつなぐ` },
        { label: 'WS のダメージ +% (1 段目だけ)', value: (c) => `+${w(c).wsd}%`, why: '装備・特性・ギフトの「ウェポンスキルのダメージ」の合計' },
        { label: `${ws.ja} のダメージ +% (全段)`, value: (c) => `+${w(c).bonus}%` + (w(c).hidden ? ` × +${w(c).hidden}%` : ''), why: `装備の「${ws.ja}:ダメージ」と、武器の隠し効果 (レリック +40%、ミシック・エンピリアン +30%)。別々に掛ける` },
        calc.some((c) => w(c).magic) && { label: ws.kind === 'magic' ? '魔法 WS のダメージ' : '属性の分のダメージ', value: (c) => (w(c).magic ? number(w(c).magic.extra) : '—'), number: (c) => (w(c).magic ? w(c).magic.extra : 0),
          why: ws.kind === 'magic' ? `(武器の基本の値 ${calc[0].ws.magic ? calc[0].ws.magic.base : ''} + ステータス修正) × TP による倍率 + 系統係数 + 魔法ダメージ、に魔攻 ÷ 魔防などを掛ける` : '物理の分 × 属性の倍率 + 魔法ダメージ、に魔攻 ÷ 魔防などを掛ける' },
        calc.some((c) => w(c).magic) && { label: '魔攻 / 魔法ダメージ / 系統係数', value: (c) => (w(c).magic ? `${w(c).magic.magicAttack} / ${w(c).magic.magicDamage} / ${w(c).magic.ds != null ? fixed2(w(c).magic.ds) : '—'}` : '—'), why: `敵の魔防 ${foe.mdef}、被魔法ダメージ ×${fixed2(foe.mtaken)}` + (ws.kind === 'hybrid' ? `。属性の倍率は TP で ${ws.mftp.join(' / ')}` : '') },
        { label: '複数回攻撃を入れた攻撃回数', value: (c) => fixed2(w(c).result.attempts), why: `${ws.hits} 段。全部で 8 回まで` });
    }
    rows.push({ head: '通常攻撃 (通常攻撃用のセット)' },
      { label: '攻撃力', value: (c) => number(a(c).h.main.attack), number: (c) => a(c).h.main.attack, why: 'スキル + STR + 攻 (両手武器・格闘はスマイトを掛ける)' },
      { label: '攻防比', value: (c) => fixed2(a(c).hands[0].ratio), why: `攻撃力 ÷ 敵の防御力 ${number(foe.def)}` },
      { label: '倍率 (クリティカルでないとき)', value: (c) => pd(a(c).hands[0].hit), why: '' },
      { label: '命中', value: (c) => number(a(c).h.main.accuracy), number: (c) => a(c).h.main.accuracy, why: `敵の回避 ${number(foe.eva)}。差 2 ごとに命中率 1%` },
      { label: 'スキル', value: (c) => `${a(c).h.kind.ja} ${number(a(c).h.main.skill)}`, why: 'ジョブの上限 + マスターレベル + 装備・メリポ' },
      { label: 'STR / DEX / AGI', value: (c) => `${number(a(c).h.total('STR'))} / ${number(a(c).h.total('DEX'))} / ${number(a(c).h.total('AGI'))}`, why: `敵の VIT ${number(foe.vit)}、AGI ${number(foe.agi)}` },
      state.mode === 'ranged'
        ? { label: 'トゥルーショット', value: (c) => `×${fixed2(a(c).trueShot)}`, why: '適正距離で撃ったときのダメージ+。通常の射撃に掛けている' }
        : { label: 'ダブル / トリプル / クワッド', value: (c) => `${a(c).h.multi.doubleAttack}% / ${a(c).h.multi.tripleAttack}% / ${a(c).h.multi.quadAttack}%`, why: '装備 + 特性・ギフト・メリポ + 支援' },
      { label: 'クリティカルヒットダメージ', value: (c) => `+${a(c).h.critDamage}%`, why: '+100% まで' },
      { label: '攻撃力の %', value: (c) => `+${Math.round(a(c).h.main.pct * 1000) / 10}%`, why: 'スマイト・バーサク・カオスロール・フューリーなど。足し合わせてから 1 回だけ掛ける' },
      { label: '入っている支援・アビリティ', value: (c) => c.c.autoBuilt.buffs.names.join('、') || 'なし', why: 'アビリティは、そのセットのジョブ・サポで使えるものだけが入る' },
      { label: '武器の効果', value: (c) => a(c).fx.notes.join(' / ') || 'なし', why: 'アフターマスの段階は、上の「アフターマス」で選ぶ' });
    const details = el('details', { className: 'steps', open: true }, el('summary', { textContent: '計算の途中の値' }), table(calc, rows, '計算のしかた'));
    return el('div', { className: 'panel' }, details);
  }

  function init() {
    $('meta').textContent = `装備 ${data.items.length} 件 / データ ${data.generated}`;
    load();
    store = P.load(localStorage, null);
    window.VanaAugment.apply(db, P.character(store).augments);
    $('chara').replaceChildren(...store.chars.map((c) => el('option', { value: c.id, textContent: c.name })));
    $('chara').value = store.activeChar;
    $('chara').addEventListener('change', () => {
      store.activeChar = $('chara').value;
      P.save(localStorage, store);
      S.ownedReset();
      window.VanaAugment.apply(db, P.character(store).augments);
      changed();
    });
    $('ws').addEventListener('change', () => { state.ws = Number($('ws').value); changed(); });
    $('sc-level').addEventListener('change', () => { state.sc.level = Number($('sc-level').value); changed(); });
    $('sc-every').addEventListener('change', () => { state.sc.every = Number($('sc-every').value); changed(); });
    $('mode').addEventListener('change', () => { state.mode = $('mode').value; changed(); });
    $('aftermath').addEventListener('change', () => { state.aftermath = Number($('aftermath').value); changed(); });
    $('tp').addEventListener('change', () => { state.tp = Math.min(3000, Math.max(1000, Number($('tp').value) || 1000)); changed(); });
    $('enemy-range').addEventListener('change', () => { state.range = $('enemy-range').value; changed(); });
    $('enemy').addEventListener('change', () => {
      state.enemy = $('enemy').value;
      const found = ENEMIES.find((e) => e.id === state.enemy);
      if (found) Object.assign(state.values, found.values);
      changed();
    });
    document.body.append(el('datalist', { id: 'stat-names' }, ...data.stats.filter((s) => s.num && s.n > 20 && !/[:(]/.test(s.k)).map((s) => el('option', { value: s.k }))));
    render();
  }
  init();
})();
