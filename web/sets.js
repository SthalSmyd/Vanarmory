// セットの計算で、画面をまたいで使うもの: 装備の id から装備を引く (マント・素手・持っている装備)、
// 装備以外で得ている値 (特性・ギフト・メリポ・食事)、基本ステータス、攻撃・命中、1 発ぶんの隔。
// 「セットを組む」(builder.js) と「ダメージ」(damage-page.js) から使う。
(function () {
  'use strict';

  const SHEET_KEYS = ['HP', 'MP', 'STR', 'DEX', 'VIT', 'AGI', 'INT', 'MND', 'CHR'];

  // db: VanaSearch.prepare の結果、P: VanaProfiles、getStore: 設定 (キャラクターと育成) を返す関数
  function create(db, P, getStore) {
  const data = db.data;
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  const TP = window.VanaTP;

  const capeId = (job, picks) => `cape:${job}:${picks.join(',')}`;

  // 登録したジョブマント (キャラクターごと)。自動で選ぶときは、登録があればその中から選び、無ければ構成を作る
  const NO_PICKS = () => data.capes.augments.map(() => -1);
  const myCapes = (job) => (getStore() ? P.character(getStore()).capes || [] : []).filter((c) => c.job === job);
  const capeName = (job, picks) => (myCapes(job).find((c) => c.picks.join() === picks.join()) || {}).name || '';
  const isCapeName = (item) => !!item && !item.rank && Object.values(data.capes.names).includes(item.ja);

  function makeCape(job, picks) {
    const plain = data.items.find((i) => i.ja === data.capes.names[job] && !i.rank);
    if (!plain) return null;
    const m = new Map(plain.m);
    const texts = [];
    picks.forEach((pick, g) => {
      const option = data.capes.augments[g].options[pick];
      if (!option) return;
      texts.push(option.text);
      for (let k = 0; k < option.s.length; k += 2) {
        if (option.s[k] >= 0) m.set(option.s[k], (m.get(option.s[k]) || 0) + option.s[k + 1]);
      }
    });
    // 「被物理ダメージ(被ダメージ込み)」のような合算を作り直す
    for (const d of data.derived) {
      const parts = d.parts.map((p) => m.get(db.statByKey.get(p).i)).filter((v) => typeof v === 'number');
      if (parts.length) m.set(db.statByKey.get(d.k).i, parts.reduce((a, b) => a + b, 0));
    }
    // 登録してある構成なら、その名前を出す
    const rank = capeName(job, picks) || (texts.length ? 'オグメ最大' : '');
    return Object.assign({}, plain, { id: capeId(job, picks), m, rank, aug: texts.join(' '), group: 'cape', plain: '', picks: picks.slice(), capeJob: job, capePlain: plain.id });
  }


  const BARE = { id: 'bare', ja: '素手', en: 'Barehanded', lv: 1, il: 0, slots: 1, jobs: 2 ** 23 - 2, skill: 1, desc: '武器を持たない。「素手:」の効果は、サブも空のときに効く', aug: '', s: [], m: new Map(), hands: true };
  // 素手 (メインが素手で、サブも空) のとき、「素手:」の分を元のステータスに足した装備に差し替える
  function withBare(equip) {
    if (!equip.main || !equip.main.hands || equip.sub) return equip;
    const out = {};
    for (const [slot, item] of Object.entries(equip)) {
      if (!item || !item.bare || item.bareOn) { out[slot] = item; continue; }
      const m = new Map(item.m);
      for (const [i, v] of item.bare) m.set(i, (m.get(i) || 0) + v);
      out[slot] = Object.assign({}, item, { m, bareOn: true });
    }
    return out;
  }
  function getItem(id) {
    if (id === 'bare') return BARE;
    if (itemById.has(id)) return itemById.get(id);
    if (String(id).startsWith('own:')) {
      // 持っている装備の候補。読み込み直して無くなっていたら、元の装備として扱う
      const mine = ownedNow();
      return (mine && mine.byId.get(id)) || itemById.get(Number(String(id).split(':')[1]));
    }
    const m = /^cape:(\d+):([-\d,]+)$/.exec(id);
    return m ? makeCape(Number(m[1]), m[2].split(',').map(Number)) : undefined;
  }
  // ---- 持っている装備 (設定で、Moglist の書き出しを読み込んだもの) ----
  // 候補は、手入力のオーグメントを写して作るので、手入力やキャラクターが変わったら作り直す (ownedReset)
  let ownedCache = null;
  const ownedReset = () => { ownedCache = null; };
  function ownedNow() {
    const c = getStore() && P.character(getStore());
    if (!c || !c.owned) return null;
    if (!ownedCache) ownedCache = window.VanaOwned.build(db, c.owned, c.ownedFix);
    return ownedCache;
  }

  function supportTraits(who) {
    const tiers = (data.innate.tiers || {})[who.sub];
    const out = new Map();
    if (!tiers || who.sub === who.job) return out;
    for (const [i, steps] of Object.entries(tiers)) {
      let value = 0;
      for (const [level, v] of steps) if (level <= who.subLevel) value = v;
      if (value) out.set(Number(i), value);
    }
    return out;
  }
  function addTraits(add, job, who) {
    const main = new Map();
    const pairs = job ? job.trait : [];
    for (let k = 0; k < pairs.length; k += 2) main.set(pairs[k], pairs[k + 1]);
    const sub = supportTraits(who);
    for (const i of new Set([...main.keys(), ...sub.keys()])) {
      const m = main.get(i) || 0;
      const s = sub.get(i) || 0;
      if (s > m) add('サポ特性', [i, s]);
      else add('特性', [i, m]);
    }
  }


  function outsideFor(who) {
    const base = {};
    const parts = [];
    const add = (label, pairs) => {
      for (let k = 0; k < pairs.length; k += 2) {
        base[pairs[k]] = (base[pairs[k]] || 0) + pairs[k + 1];
        parts.push({ label, i: pairs[k], value: pairs[k + 1] });
      }
    };
    const job = data.innate.jobs[who.job];
    const grown = P.jobSetting(P.character(getStore()), who.job); // 設定の「ジョブの育成」に入れた値
    if (who.innate.trait) addTraits(add, job, who);
    if (who.innate.gift && job) {
      // ギフトは、使ったジョブポイントの合計がその段階に届いている分だけ
      const pairs = [];
      for (const [i, steps] of Object.entries(job.gift)) {
        const value = steps.reduce((sum, [jp, v]) => (jp <= grown.jp ? sum + v : sum), 0);
        if (value) pairs.push(Number(i), value);
      }
      add('ギフト', pairs);
      // ジョブポイントの項目は、すべて使い切ったときだけ数える
      if (grown.jp >= P.MAX_JP) add('ギフト', job.jp);
    }
    if (who.innate.merit) {
      if (job && grown.merit) add('メリポ', job.merit);
      // 共通のメリポは、入れた段階の分だけ
      for (const group of data.innate.shared) {
        for (const item of group.items) {
          const level = P.sharedLevel(P.character(getStore()), group, item);
          if (level && item.i >= 0) add('メリポ', [item.i, level * item.per]);
        }
      }
    }
    const food = data.foods.find((f) => f.ja === who.food);
    if (food) add('食事', food.s);
    for (const pair of who.manual || []) add('支援など', pair);
    return { base, parts };
  }


  // ステータスの計算に使う条件 (ジョブ・サポ・種族・マスターレベルと、装備以外の分の内訳)
  function contextFor(who) {
    return {
      job: who.job, sub: who.sub, subLevel: who.subLevel,
      race: P.character(getStore()).race, ml: P.jobSetting(P.character(getStore()), who.job).ml,
      parts: outsideFor(who).parts,
      traits: who.innate.trait, // ジョブ特性を数えるか (スマイトにも効く)
      gifts: who.innate.gift, jp: P.jobSetting(P.character(getStore()), who.job).jp, // マーシャルアーツのギフトに使う
    };
  }


  const WHITE_SOURCES = new Set(['特性', 'サポ特性', 'ギフト', 'メリポ']);

  // 装備以外の分のうち、白い数字に入る分 (ステータスの番号 -> 値)
  function innateOf(context) {
    const out = new Map();
    for (const part of context.parts) if (WHITE_SOURCES.has(part.label)) out.set(part.i, (out.get(part.i) || 0) + part.value);
    return out;
  }

  // HP・MP・STR〜CHR の、素の値 (white) と増える分 (green)。base は種族・ジョブ・サポ・マスターレベルで決まる分
  function sheetValues(set, context) {
    const job = data.jobs.find((j) => j.id === context.job);
    const sub = data.jobs.find((j) => j.id === context.sub);
    const base = window.VanaBase.baseStats(data.base, context.race, job.en, sub ? sub.en : null, context.subLevel, context.ml) || {};
    const innate = innateOf(context);
    const values = {};
    for (const key of SHEET_KEYS) {
      const stat = db.statByKey.get(key);
      const extra = innate.get(stat.i) || 0;
      values[key] = { base: base[key] || 0, extra, white: (base[key] || 0) + extra, green: (set.totals.get(stat.i) || 0) - extra };
    }
    return { job, sub, innate, values };
  }


  function combatValues(set, context, ranged) {
    const B = window.VanaBase;
    const weapon = ranged
      ? [set.equip.range, set.equip.ammo].find((item) => item && data.combat.skills.some((k) => k.id === item.skill && k.kind === 'ranged'))
      : set.equip.main;
    const kind = weapon && data.combat.skills.find((k) => k.id === weapon.skill);
    if (!kind || (ranged ? kind.kind !== 'ranged' : kind.kind === 'ranged')) return null;
    const { job, innate, values } = sheetValues(set, context);
    // スキル: ジョブの上限 + マスターレベル (そのジョブが元々持つスキルだけ) + メリポ + 装備や武器のスキル
    const rating = (data.combat.ratings[job.en] || {})[kind.ja];
    const native = rating ? data.combat.caps[rating] + context.ml : 0;
    const skillStat = db.statByKey.get(kind.ja + 'スキル');
    const innateSkill = skillStat ? innate.get(skillStat.i) || 0 : 0;
    let gearSkill = skillStat ? (set.totals.get(skillStat.i) || 0) - innateSkill : 0;
    // 武器に付いているスキルは、その武器を持つ手にしか効かない。もう片方の手の武器の分は除く
    for (const other of ranged ? [] : [set.equip.sub]) {
      if (other && other !== weapon && skillStat) gearSkill -= other.m.get(skillStat.i) || 0;
    }
    const flatOf = (key) => {
      const stat = db.statByKey.get(key);
      const white = innate.get(stat.i) || 0;
      return { white, total: set.totals.get(stat.i) || 0 };
    };
    const total = (key) => values[key].white + values[key].green;
    const skillWhite = native + innateSkill;
    const skillTotal = skillWhite + gearSkill;
    // スマイト: 両手武器か格闘武器をメインに持っていると、攻撃力が n/256 上がる。
    // メインジョブは Lv99、サポートジョブはサポのレベルで覚えている段階までで、高いほうが効く
    const smiteOf = (jobId, level) => ((data.innate.smite || {})[jobId] || []).reduce((n, [at, value]) => (at <= level ? value : n), 0);
    const smite = !ranged && (kind.kind === 'two' || kind.kind === 'h2h') && context.traits
      ? Math.max(smiteOf(context.job, 99), context.sub ? smiteOf(context.sub, context.subLevel) : 0) : 0;
    const boost = (value) => Math.floor((value * (256 + smite)) / 256);
    const pair = (white, all) => ({ white, total: all });
    if (ranged) {
      const acc = flatOf('飛命');
      const atk = flatOf('飛攻');
      return {
        kind, skill: skillTotal,
        accuracy: pair(B.rangedAccuracy({ skill: skillWhite, agi: values.AGI.white, flat: acc.white }), B.rangedAccuracy({ skill: skillTotal, agi: total('AGI'), flat: acc.total })),
        attack: pair(B.rangedAttack({ skill: skillWhite, str: values.STR.white, flat: atk.white }), B.rangedAttack({ skill: skillTotal, str: total('STR'), flat: atk.total })),
        rawAttack: B.rangedAttack({ skill: skillTotal, str: total('STR'), flat: atk.total }),
      };
    }
    const acc = flatOf('命中');
    const atk = flatOf('攻');
    return {
      kind, skill: skillTotal,
      accuracy: pair(B.accuracy({ skill: skillWhite, dex: values.DEX.white, flat: acc.white }), B.accuracy({ skill: skillTotal, dex: total('DEX'), flat: acc.total })),
      attack: pair(boost(B.attack({ skill: skillWhite, str: values.STR.white, flat: atk.white, hands: kind.kind })), boost(B.attack({ skill: skillTotal, str: total('STR'), flat: atk.total, hands: kind.kind }))),
      rawAttack: B.attack({ skill: skillTotal, str: total('STR'), flat: atk.total, hands: kind.kind }), // スマイトを掛ける前
      smite,
    };
  }


  const totalOf = (totals, key) => {
    const stat = db.statByKey.get(key);
    return stat ? totals.get(stat.i) || 0 : 0;
  };
  const delayOf = (item) => (item ? totalOf(item.m, '隔') : 0);
  const skillKind = (item) => (item && data.combat.skills.find((k) => k.id === item.skill) || {}).kind;

  // 1 発ぶんの隔と手数。武器が決まっていないと計算できないので null
  function tpSetup(kindId, equip, totals, context) {
    if (kindId === 'ranged') {
      const range = skillKind(equip.range) === 'ranged' ? equip.range : null;
      const ammo = equip.ammo && delayOf(equip.ammo) ? equip.ammo : null;
      // レンジの武器 + 矢弾。投てきなど、矢弾だけで撃つものは矢弾の隔
      const thrown = !equip.range && ammo && skillKind(ammo) === 'ranged';
      if (!range && !thrown) return null;
      const delay = delayOf(range) + delayOf(ammo);
      const names = [range, ammo].filter(Boolean).map((item) => item.ja).join('+');
      return { mode: 'ranged', delay, hands: 1, total: delay, label: `${names}・隔 ${delay}` };
    }
    const kind = skillKind(equip.main);
    if (!kind || kind === 'ranged') return null;
    const sub = equip.sub && equip.sub.skill > 0 && skillKind(equip.sub) !== 'ranged' ? delayOf(equip.sub) : 0;
    const dualWield = totalOf(totals, '二刀流') + totalOf(totals, '二刀流効果アップ');
    const martialArts = TP.martialArts({ job: context.job, sub: context.sub, subLevel: context.subLevel, jp: context.jp, maxJp: P.MAX_JP, trait: context.traits, gift: context.gifts })
      + totalOf(totals, 'マーシャルアーツ') + totalOf(totals, 'マーシャルアーツ効果アップ');
    const setup = TP.melee({ kind, main: delayOf(equip.main), sub, dualWield, martialArts });
    const round = (v) => Math.round(v * 10) / 10;
    setup.label = setup.mode === 'dual' ? `二刀流 ${round(setup.dualWield)}%・1 発の隔 ${round(setup.delay)}`
      : setup.mode === 'h2h' ? `格闘 (マーシャルアーツ −${martialArts})・1 発の隔 ${round(setup.delay)}`
      : `${equip.main.ja}・隔 ${setup.delay}`;
    return setup;
  }


  return { capeId, NO_PICKS, myCapes, capeName, isCapeName, makeCape, BARE, withBare, getItem, ownedReset, ownedNow, supportTraits, addTraits, outsideFor, contextFor, WHITE_SOURCES, innateOf, sheetValues, combatValues, totalOf, delayOf, skillKind, tpSetup };
  }

  window.VanaSets = { create, SHEET_KEYS };
})();
