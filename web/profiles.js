// キャラクターと、使う装備の設定。検索条件とは別に保存する。
// 設定画面 (settings.js)、セットを組む画面 (builder.js)、テスト (Node) から使う。
//
// 2 段階になっている:
//   キャラクター (名前は自由。characterA / characterB のように複数持てる)
//     ├ ジョブの育成 … jobs: { ジョブの番号: { jp, master, ml, merit } }
//     │    jp は使ったジョブポイントの合計 (0〜2100)、master はジョブマスター済みか
//     │    (済みなら jp に関わらず 2100 として数える。jp の数値は消さずに残す)、ml はマスターレベル、
//     │    merit はジョブ別のメリポを最大まで振っているか
//     ├ 種族 … race ('hume' / 'elvaan' / 'tarutaru' / 'mithra' / 'galka')。素のステータスの計算に使う
//     ├ 共通のメリポ … merits: { 項目の名前: 段階 }
//     ├ いつもの装備 … pins: { ジョブの番号: { 部位: 装備の id } }
//     ├ 保存したセット … sets: [{ id, name, who: { job, sub, subLevel, food, innate }, equip: { 部位: 装備の id } }]
//     ├ 登録したジョブマント … capes: [{ id, job, name, picks }] (picks は、アイテム 5 種ごとに選んだ項目の番号。-1 は付けない)
//     ├ 保存した条件 … searches: [{ id, name, cond }] (cond は「セットを組む」の条件。固定する装備は含めない)
//     ├ 同じ良さのときの重み … weights: { types: [{ id, name, stats: [{ k, w }] }], jobs: { ジョブの番号: 型の id } }
//     ├ 手入力のオーグメント … augments: { 装備の id: 「STR+8 DEX+8 命中+12」のような文字 }
//     └ 装備の範囲の設定 (「メイン」「復帰直後」のように複数持てる) … list と、選んでいる設定 active
//
// 装備の範囲の設定 1 つの形:
//   { id, name,
//     tiers:    { af, relic, empy }          +いくつまで使うか。-1 は使わない
//     odyssey:  { nyame, sakpata, …, gaea1, … }  RP のランク。0 は無強化、-1 は使わない
//     boosts:   { neck, abjuration, … }      ランクを選べない強化を使うか
//     cape:     true / false                 アンバスマント (オグメ最大) を使うか
//     contents: { コンテンツの id: { on, tier, picks } }
//               tier は段階の上限、picks は選んだもの (バトルフィールド名など)。null はすべて
//     excluded: [装備の id]
//     ownedAugs: true / false               持っている装備を、実物のオーグメントで計算するか
//     ownedOnly: true / false               持っている装備だけを使うか }
//   (下の 2 つは、キャラクターに持っている装備 owned を読み込んであるときだけ効く。形は owned.js)
//
// 保存内容: { activeChar, chars: [{ id, name, jobs, merits, active, list }] }
(function (root) {
  'use strict';

  const STORAGE = 'vanarmory.profiles';
  const ODYSSEY = [['nyame', 'ニャメ'], ['sakpata', 'サクパタ'], ['ikenga', 'イケンガ'], ['mpaca', 'ムパカ'], ['agwu', 'アグゥ'], ['bunzi', 'ブンジ'], ['gleti', 'グレティ']];
  // 系統は、シェオル・ジャイアのアトーンメント 3・4 のボスごと (国光はイケンガ、月桂の太刀はグレティに入る)。
  // アトーンメント 1・2 の装備 (ボスごとに 1 点ずつ) は、段階ごとにまとめてランクを選ぶ (出典に値があるのは 15・20・25・30)。
  // どの装備がどれに入るかは data/augments.json の family
  const GAEA = [
    ['gaea1', '段階1', 'アトーンメント1: ヘスペリデ、エピタフサシェ、Ｎ．ストリンガー、コイストボダー'],
    ['gaea2', '段階2', 'アトーンメント2: アクロンティカ、ベーシルリング、鶴、シェレピアス、テレンベルト、オブシテナサッシュ'],
  ];
  // ランクごとの値が出典に無い強化。使う (上限まで強化した状態) か、使わない (強化していない状態) かだけを選ぶ
  // id、名前、説明、切り替えを置くコンテンツ (data/contents.json の id)
  const BOOSTS = [
    ['limbus', 'リンバス装備', '装束 5 系統とアクセサリ 4 点を、ランク 30 まで強化した状態', ['limbus']],
    ['neck', 'デュナミス〔D〕の首装備', '品質ごとの上限のランクまで強化した状態', ['dynamis_neck']],
    ['geas', 'ギアスフェットの装束', 'エスカイト・デスペア・那伽・ローハイド・パスーア・サイクロス・ヴァニヤを、ランク 15 まで強化した状態 (方針 A〜D)。エスカ-ジ・タとエスカ-ル・オンで共通', ['escha_zitah', 'escha_ruaun']],
    ['abjuration', '免罪装備', 'アーケイン・グリプトをランク 15 まで強化した状態 (方針 A〜D)', ['abjuration']],
    ['wanted', 'ウォンテッド装備 (HQ)', 'ランク 15 まで強化した状態', ['unity']],
    ['inventor', 'メナスインスペクターの装備', 'インベンター・ワークスをランク 15 まで強化した状態 (方針 A〜C)', ['delve']],
  ];
  // 切り替えを持たず、いつも強化した状態を使うもの (高名値の首装備。差は HP+15 か MP+15 だけ)
  const ALWAYS_BOOSTED = new Set(['pledge']);
  // 同じ良さのときの重み。役割の型ごとに、ステータスと重みを持つ。ジョブごとに、初めに使う型を決めておく。
  // 目標と「伸ばす」が同じ良さの組み合わせの中から、この重みの合計 (値 × 重み) が大きいものを選ぶ
  const defaultWeights = () => ({
    types: [
      { id: 'melee', name: '近接', stats: [['攻', 1], ['命中', 1], ['STR', 0.5], ['DEX', 0.5]] },
      { id: 'ranged', name: '遠隔', stats: [['飛攻', 1], ['飛命', 1], ['AGI', 0.5], ['STR', 0.5]] },
      { id: 'magic', name: '魔法', stats: [['魔攻', 1], ['魔命', 1], ['魔法ダメージ', 1], ['INT', 0.5]] },
      { id: 'heal', name: '回復', stats: [['ケアル回復量', 2], ['MND', 0.5], ['魔命', 0.5]] },
      { id: 'support', name: '弱体・支援', stats: [['魔命', 1], ['MND', 0.5], ['INT', 0.5]] },
      { id: 'tank', name: '盾', stats: [['被ダメージ', 3], ['HP', 0.05], ['防', 0.05], ['魔回避', 0.3]] },
      { id: 'pet', name: 'ペット', stats: [['ペット:攻', 1], ['ペット:命中', 1], ['ペット:魔攻', 1], ['ペット:魔命', 1]] },
    ].map((type) => ({ id: type.id, name: type.name, stats: type.stats.map(([k, w]) => ({ k, w })) })),
    // ジョブの番号 -> 型。'none' は使わない
    jobs: { 1: 'melee', 2: 'melee', 3: 'heal', 4: 'magic', 5: 'melee', 6: 'melee', 7: 'tank', 8: 'melee', 9: 'melee', 10: 'support', 11: 'ranged',
      12: 'melee', 13: 'melee', 14: 'melee', 15: 'pet', 16: 'melee', 17: 'ranged', 18: 'pet', 19: 'melee', 20: 'magic', 21: 'magic', 22: 'tank' },
  });
  // 保存してある重みを、足りない項目を埋めて返す
  function normalizeWeights(saved) {
    const base = defaultWeights();
    if (!saved || !Array.isArray(saved.types)) return base;
    const types = saved.types.filter((t) => t && t.id).map((t) => ({
      id: String(t.id), name: String(t.name || '型'),
      stats: (Array.isArray(t.stats) ? t.stats : []).filter((s) => s && s.k).map((s) => ({ k: String(s.k), w: Number(s.w) || 0 })),
    }));
    const jobs = Object.assign(base.jobs, saved.jobs);
    for (const job of Object.keys(jobs)) if (jobs[job] !== 'none' && !types.some((t) => t.id === jobs[job])) jobs[job] = 'none';
    return { types, jobs };
  }
  // そのジョブで使う型。override は「セットを組む」で選び直した型 (空なら設定のまま)。使わないときは null
  function weightType(character, job, override) {
    const id = override || character.weights.jobs[job] || 'none';
    return character.weights.types.find((t) => t.id === id) || null;
  }

  const JOB_SETS = [['af', 'AF', 4], ['relic', 'レリック', 4], ['empy', 'エンピリアン', 3]];

  const newId = () => 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  // すべて使う設定
  function create(name) {
    return {
      id: newId(),
      name,
      tiers: Object.fromEntries(JOB_SETS.map(([id, , max]) => [id, max])),
      odyssey: Object.fromEntries(ODYSSEY.concat(GAEA).map(([id]) => [id, 30])),
      boosts: Object.fromEntries(BOOSTS.map(([id]) => [id, true])),
      cape: true,
      contents: {},
      excluded: [],
      ownedAugs: true,
      ownedOnly: false,
    };
  }

  const MAX_JP = 2100;
  // ジョブ 1 つの育成。何も入れていなければ「ジョブポイント 0 (マスターのチェックなし)、メリポは最大、マスターレベルは 0」。
  // jp は計算に使う値 (マスター済みなら 2100)、raw は入力してある数値 (マスターのチェックを外すと、これに戻る)
  function jobSetting(character, job) {
    const saved = (character.jobs || {})[job] || {};
    const raw = saved.jp != null ? saved.jp : 0;
    const master = saved.master != null ? !!saved.master : saved.jp != null && saved.jp >= MAX_JP;
    return {
      jp: master ? MAX_JP : raw,
      raw,
      master,
      ml: saved.ml != null ? saved.ml : 0,
      merit: saved.merit !== false,
    };
  }

  // 共通のメリポの、1 項目の段階。何も入れていなければ最大。ただし合計に上限のある分類 (その他) は 0
  // (全部は振れないので、どれに振ったかを本人が入れる)
  function sharedLevel(character, group, item) {
    const saved = (character.merits || {})[item.id];
    if (saved != null) return Math.max(0, Math.min(item.max, saved));
    return group.limit == null ? item.max : 0;
  }

  // マスターレベルから決まるサポートジョブのレベル。rule は { base, per_master_levels, master_level_cap }
  function supportLevel(ml, rule) {
    const r = rule || { base: 49, per_master_levels: 5, master_level_cap: 50 };
    return r.base + Math.floor(Math.min(ml, r.master_level_cap) / r.per_master_levels);
  }

  // 足りない項目を埋める (古い保存内容や、項目が増えたときのため)
  function normalize(profile) {
    const base = create(profile.name || '設定');
    return Object.assign(base, profile, {
      tiers: Object.assign(base.tiers, profile.tiers),
      odyssey: Object.assign(base.odyssey, profile.odyssey),
      boosts: Object.assign(base.boosts, profile.boosts),
      contents: Object.assign({}, profile.contents),
      excluded: (profile.excluded || []).slice(),
      ownedAugs: profile.ownedAugs !== false,
      ownedOnly: !!profile.ownedOnly,
    });
  }

  // 最初の装備の範囲の設定を 1 つ持ったキャラクター
  function createCharacter(name) {
    const first = create('メイン');
    return { id: newId(), name, race: 'hume', unity: 'mid', jobs: {}, merits: {}, augments: {}, sets: [], capes: [], owned: null, ownedFix: {}, searches: [], weights: defaultWeights(), active: first.id, list: [first] };
  }

  function normalizeCharacter(character) {
    const list = (Array.isArray(character.list) && character.list.length ? character.list : [create('メイン')]).map(normalize);
    return {
      id: character.id || newId(),
      name: character.name || 'キャラクター',
      race: character.race || 'hume',
      // ユニティランクで変わる装備の値の数え方: 'min' (最小) / 'mid' (中間) / 'max' (最大)
      unity: character.unity === 'min' || character.unity === 'max' ? character.unity : 'mid',
      augments: Object.assign({}, character.augments),
      sets: JSON.parse(JSON.stringify(character.sets || [])),
      capes: JSON.parse(JSON.stringify(character.capes || [])),
      // いつもの装備 (ジョブごとに、いつも固定する装備): { ジョブの番号: { 部位: 装備の id } }
      pins: JSON.parse(JSON.stringify(character.pins || {})),
      // 持っている装備 (Moglist から読み込んだもの)。無ければ null
      owned: character.owned && Array.isArray(character.owned.items) ? JSON.parse(JSON.stringify(character.owned)) : null,
      // 強化の値を読めなかった装備の補正 (形は owned.js)
      ownedFix: JSON.parse(JSON.stringify(character.ownedFix || {})),
      weights: normalizeWeights(character.weights),
      searches: JSON.parse(JSON.stringify(character.searches || [])),
      jobs: JSON.parse(JSON.stringify(character.jobs || {})),
      // 以前はクリティカルヒット +5% の入・切だけを持っていた (crit)。段階に直して引き継ぐ
      merits: Object.assign(character.crit ? { 'クリティカルヒット': 5 } : {}, character.merits),
      active: list.some((p) => p.id === character.active) ? character.active : list[0].id,
      list,
    };
  }

  // 保存内容を読む。無ければキャラクターを 1 人作る。
  // legacy は、設定を分ける前に「セットを組む」の画面が保存していた範囲の内容
  function load(storage, legacy) {
    let saved = null;
    try {
      saved = JSON.parse(storage.getItem(STORAGE) || 'null');
    } catch {
      // 読めない保存内容は捨てて作り直す
    }
    let chars;
    if (saved && Array.isArray(saved.chars) && saved.chars.length) {
      chars = saved.chars;
    } else if (saved && Array.isArray(saved.list) && saved.list.length) {
      // キャラクターを分ける前の保存内容は、1 人目のキャラクターにまとめる
      chars = [{ name: 'キャラクター1', jobs: saved.jobs, crit: saved.crit, active: saved.active, list: saved.list }];
    } else {
      const character = createCharacter('キャラクター1');
      if (legacy) {
        const first = character.list[0];
        Object.assign(first.tiers, legacy.tiers);
        Object.assign(first.odyssey, legacy.odyssey);
        if (typeof legacy.cape === 'boolean') first.cape = legacy.cape;
        if (Array.isArray(legacy.excluded)) first.excluded = legacy.excluded.slice();
      }
      chars = [character];
    }
    const store = { activeChar: saved ? saved.activeChar : null, chars: chars.map(normalizeCharacter) };
    if (!store.chars.some((c) => c.id === store.activeChar)) store.activeChar = store.chars[0].id;
    return store;
  }

  function save(storage, store) {
    try {
      storage.setItem(STORAGE, JSON.stringify(store));
      return true;
    } catch {
      return false; // 保存できない環境でも、開いている間は使える
    }
  }

  // 選んでいるキャラクターと、そのキャラクターで選んでいる装備の範囲の設定
  const character = (store) => store.chars.find((c) => c.id === store.activeChar);
  const active = (store) => {
    const c = character(store);
    return c.list.find((p) => p.id === c.active);
  };

  // 装備の範囲の設定を、別のキャラクターへ写す。同じ名前の設定があれば置き換える
  function copyProfile(profile, target) {
    const copy = normalize(JSON.parse(JSON.stringify(profile)));
    copy.id = newId();
    const same = target.list.findIndex((p) => p.name === copy.name);
    if (same >= 0) {
      if (target.active === target.list[same].id) target.active = copy.id;
      target.list[same] = copy;
    } else {
      target.list.push(copy);
    }
    return copy;
  }

  // コンテンツ 1 つの設定。何も決めていなければ「使う・最後の段階まで・すべて」
  function contentSetting(profile, content) {
    const saved = profile.contents[content.id] || {};
    return {
      on: saved.on !== false,
      tier: saved.tier != null ? saved.tier : content.tiers ? content.tiers.length - 1 : 0,
      picks: saved.picks || null,
    };
  }

  // この設定で、その装備を候補に使ってよいか。contents は data.contents。
  // 装備の src は [コンテンツの番号, 段階, 入手元の番号] の並びで、どれか 1 つでも通れば使える。
  // どのコンテンツにも属さない装備 (店売り・競売・クエスト報酬など) は常に使う
  function allow(profile, item, contents) {
    if (profile.excluded.includes(item.id)) return false;
    if (item.group === 'cape') return profile.cape;
    if (item.fam) return item.rp === profile.odyssey[item.fam] && (item.rp > 0 || !item.rank);
    // ランクを選べない強化 (デュナミス〔D〕の首装備・免罪装備 など) は、設定で「使う」なら上限まで強化した状態だけ、
    // 「使わない」なら強化していない状態だけを使う (もう片方は、固定するときにだけ選べる)
    // 上限より下のランクの状態は、候補に出さない (持っている装備の取り込みと、固定のときだけ使う)
    if (item.low) return false;
    if (ALWAYS_BOOSTED.has(item.plain)) return false;
    if (item.plain && profile.boosts[item.plain] !== undefined) {
      if (profile.boosts[item.plain]) return false;
    } else if (item.rank && profile.boosts[item.group] !== undefined && !profile.boosts[item.group]) return false;
    if (profile.tiers[item.group] !== undefined) return item.plus <= profile.tiers[item.group];
    if (!item.src || !item.src.length) return true;
    return item.src.some(([index, tier, from]) => {
      const content = contents[index];
      const setting = contentSetting(profile, content);
      if (!setting.on) return false;
      if (content.tiers && tier > setting.tier) return false;
      if (content.picks && setting.picks && !setting.picks.includes(content.froms[from])) return false;
      return true;
    });
  }

  const api = { STORAGE, ODYSSEY, GAEA, BOOSTS, defaultWeights, weightType, JOB_SETS, MAX_JP, create, normalize, createCharacter, load, save, character, active, copyProfile, contentSetting, jobSetting, sharedLevel, supportLevel, allow, newId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaProfiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
