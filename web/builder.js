// 「セットを組む」の画面。計算は solver.js、ステータスの候補と分類は search.js にある。
(function () {
  'use strict';

  const { prepare, suggest, fold, categorize, categoryOf, CATEGORY_ORDER, listedOrder } = window.VanaSearch;
  const { SLOTS, solve } = window.VanaSolver;
  const P = window.VanaProfiles;
  const db = prepare(window.VANARMORY_DATA);
  const data = db.data;
  const itemById = new Map(data.items.map((i) => [i.id, i]));

  // メイン・頭・胴・両手・両脚・両足は IL119 の装備だけを扱う
  const SLOT_LIST = window.VanaSolver.SLOTS;
  const IL119_ONLY = new Set(['main', 'head', 'body', 'hands', 'legs', 'feet']);
  const IL119_MASK = SLOT_LIST.filter((slot) => IL119_ONLY.has(slot.id)).reduce((mask, slot) => mask | slot.mask, 0);

  // 候補になり得る装備か。上の部位は IL119 だけ。ほか (アクセサリなど) はレベルを問わない
  const eligible = (item) => !(item.slots & IL119_MASK) || item.il === 119;

  // 「ステータスを追加」に並べるのは、候補になり得る装備にあるステータスだけ。件数もその範囲で数える
  for (const stat of data.stats) stat.n = 0;
  for (const item of data.items) {
    if (!item.rank && eligible(item)) for (const i of item.m.keys()) data.stats[i].n++;
  }
  const categories = categorize(db);
  const STORAGE = 'vanarmory.builder';

  const $ = (id) => document.getElementById(id);
  const el = (tag, props, ...children) => {
    const node = Object.assign(document.createElement(tag), props || {});
    node.append(...children.filter((c) => c != null));
    return node;
  };
  const signed = (v, unit) => (v > 0 ? '+' : '') + v + (unit || '');

  // 装備以外で得る分の選択肢
  const INNATE = [
    { id: 'trait', label: 'ジョブ特性', short: '特性', kinds: ['trait'] },
    { id: 'gift', label: 'ギフト', short: 'ギフト', kinds: ['gift', 'jp'], title: 'ジョブポイント 2100 のギフトと、ジョブポイントの項目' },
    { id: 'merit', label: 'メリポ', short: 'メリポ', kinds: ['merit'], title: '設定の「ジョブの育成」で入れたメリポ' },
  ];

  // 候補のマスに出す、目標への寄与の短い呼び名
  const SHORT = {
    'ストアTP': 'STP', 'ダブルアタック': 'DA', 'トリプルアタック': 'TA', 'クワッドアタック': 'QA', '被ダメージ': '被ダメ',
    '被物理ダメージ': '被物', '被魔法ダメージ': '被魔', '被物理ダメージ(被ダメージ込み)': '物理カット', '被魔法ダメージ(被ダメージ込み)': '魔法カット',
    'ウェポンスキルのダメージ': 'WSD', 'クリティカルヒット': 'クリ', 'クリティカルヒットダメージ': 'クリダメ', 'ファストキャスト': 'FC',
    'マジックバーストダメージ': 'MB', 'マジックバーストダメージII': 'MB2', '物理ダメージ上限': 'PDL', 'トレジャーハンター': 'TH', '二刀流': 'DW',
  };
  const shortName = (key) => SHORT[key] || (key.length <= 5 ? key : key.slice(0, 5) + '…');

  // ---- アンバスケードのマント ----
  // 付与は 5 種類のアイテムにつき 1 項目ずつ。選んだ項目の番号を id に入れておき、
  // 固定や除外を保存したあとでも同じマントを作り直せるようにする (-1 は「付けない」)
  const capeId = (job, picks) => `cape:${job}:${picks.join(',')}`;

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
    return Object.assign({}, plain, { id: capeId(job, picks), m, rank: 'オグメ最大', aug: texts.join(' '), group: 'cape', plain: '' });
  }

  // 目標や伸ばすステータスに効く項目だけを組み合わせる。効く項目が無いアイテムは付けない
  function capeVariants(job, wanted) {
    let combos = [[]];
    for (const group of data.capes.augments) {
      const useful = [];
      group.options.forEach((option, index) => {
        for (let k = 0; k < option.s.length; k += 2) {
          const sign = wanted.get(option.s[k]);
          if (sign && sign * option.s[k + 1] > 0) return void useful.push(index);
        }
      });
      if (!useful.length) useful.push(-1);
      combos = combos.flatMap((c) => useful.map((u) => [...c, u]));
    }
    return combos.filter((c) => c.some((u) => u >= 0)).map((c) => makeCape(job, c)).filter(Boolean);
  }

  function getItem(id) {
    if (itemById.has(id)) return itemById.get(id);
    const m = /^cape:(\d+):([-\d,]+)$/.exec(id);
    return m ? makeCape(Number(m[1]), m[2].split(',').map(Number)) : undefined;
  }
  const nameOf = (item) => item.ja + (item.rank ? ` [${item.rank}]` : '') + (item.manual ? ' ✎' : '');

  // ---- 状態 ----
  // tp: 得TP・振り数の条件。近接と遠隔で別々に持つ
  //   mode: 'value' (WS後TP を数値で入れる) | 'hits' (WS の段数から計算)、goal: 目標の振り数 (無ければ null)
  const TP_KINDS = [{ id: 'melee', label: '近接', hit: 'ヒット' }, { id: 'ranged', label: '遠隔', hit: '発' }];
  const tpInitial = () => Object.fromEntries(TP_KINDS.map((kind) => [kind.id, { mode: 'value', value: 0, hits: 1, goal: null }]));
  // targets: [{ k, goal, base }]  fixed: { 部位: 装備の id }  excluded: [装備の id]
  const initial = () => ({
    job: 0, sub: 0, subLevel: null, targets: [], objective: 'min', maximize: [], avoidMinus: false, fixed: {}, food: '',
    innate: { trait: true, gift: true, merit: true },
    tp: tpInitial(),
  });

  // 使う装備の範囲は「設定」として別に保存してあり、ここではどれを使うかを選ぶだけ
  let store = null;
  const profile = () => P.active(store);
  let state = initial();
  let lastResult = null;
  let editing = null; // 固定する装備を選んでいる部位
  let selected = null; // 候補の中で選んでいるマス { set, slot }
  let compare = []; // 比較に並べるもの。'c0' は候補の 1 番目、's…' は保存したセット (3 つまで)
  let compareMode = 'diff'; // 'diff' = 違うところだけ、'all' = すべて
  let saving = null; // 名前を入れて保存しようとしている候補の番号
  const COMPARE_MAX = 3;
  const manualOpen = new Set(); // 「手で足す」の欄を開いている目標
  let restOpen = false; // 候補の「そのほかのステータス」を開いているか

  // URL の # 以降に条件があればそれを使う (「条件の URL をコピー」で作ったもの)。無ければ前回の条件
  let fromUrl = false;
  let legacy = null;
  function load() {
    try {
      fromUrl = location.hash.length > 1;
      const saved = JSON.parse(fromUrl ? decodeURIComponent(location.hash.slice(1)) : localStorage.getItem(STORAGE) || 'null');
      if (!saved) return;
      Object.assign(state, saved, { innate: Object.assign(state.innate, saved.innate) });
      const tp = tpInitial();
      for (const kind of TP_KINDS) Object.assign(tp[kind.id], (saved.tp || {})[kind.id]);
      state.tp = tp;
      // 設定を分ける前に保存していた範囲の内容は、最初の設定に引き継ぐ
      legacy = saved;
      state.targets = state.targets.filter((t) => db.statByKey.has(t.k));
      // 伸ばすステータスは [{ k, weight }] の並び。以前は 1 つだけ (名前) を持っていた
      if (typeof state.maximize === 'string') state.maximize = [{ k: state.maximize, weight: 1 }];
      state.maximize = (Array.isArray(state.maximize) ? state.maximize : []).filter((m) => m && db.statByKey.has(m.k));
      for (const [slot, id] of Object.entries(state.fixed)) if (!getItem(id)) delete state.fixed[slot];
    } catch {
      // 保存できない環境 (プライベートウィンドウなど) や壊れた保存内容は無視する
      state = initial();
      fromUrl = false;
    }
  }

  // いまの条件を保存する (次に開いたときのため)
  function persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(state));
    } catch {
      // 保存できなくても動作には影響しない
    }
  }
  function changed() {
    persist();
    P.save(localStorage, store);
    version++;
    render();
    if (lastResult) $('status').textContent = '条件が変わりました。「セットを探す」で更新します。';
  }

  const usable = (item) => !state.job || Math.floor(item.jobs / 2 ** state.job) % 2 === 1;

  // ジョブ特性。サポートジョブの特性は、サポのレベルで覚えている段階までを数える。
  // メインと同じ特性は足さず、高いほうだけが効く
  // サポのレベル。入力していなければ、設定に入れたメインジョブのマスターレベルから決まる値
  const autoSubLevel = () => P.supportLevel(P.jobSetting(P.character(store), state.job).ml, data.innate.support);
  const subLevel = () => (state.subLevel != null ? state.subLevel : autoSubLevel());

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

  // いまの画面の条件 (ジョブ・サポ・食事・装備以外の入・切)。保存したセットは、保存したときのこれを持っている
  const currentWho = () => ({
    job: state.job, sub: state.sub === state.job ? 0 : state.sub, subLevel: subLevel(), food: state.food,
    innate: Object.assign({}, state.innate),
    manual: state.targets.filter((t) => t.base).map((t) => [db.statByKey.get(t.k).i, t.base]),
  });

  // 装備以外で得ている値。base は合計 (ステータスの番号 -> 値)、parts は内訳 (表示用)
  const outside = () => outsideFor(currentWho());
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
    const grown = P.jobSetting(P.character(store), who.job); // 設定の「ジョブの育成」に入れた値
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
          const level = P.sharedLevel(P.character(store), group, item);
          if (level && item.i >= 0) add('メリポ', [item.i, level * item.per]);
        }
      }
    }
    const food = data.foods.find((f) => f.ja === who.food);
    if (food) add('食事', food.s);
    for (const pair of who.manual || []) add('支援など', pair);
    return { base, parts };
  }

  // ---- 上限 ----
  // そのステータスの、向き (sign: 1 = 大きいほど良い、-1 = 小さいほど良い) に当たる上限。無ければ null。
  // 敵対心のように正負の両方に上限があるものや、ジョブで値が変わるもの (トレジャーハンター) がある
  function capOf(stat, sign) {
    const found = (stat.caps || []).find((c) => (c.cap < 0 ? -1 : 1) === sign);
    if (!found) return null;
    const value = found.jobs && found.jobs[state.job] != null ? found.jobs[state.job] : found.cap;
    return { value, note: found.note };
  }
  const directionOf = (stat, goal) => (goal != null && goal !== 0 ? (goal < 0 ? -1 : 1) : stat.neg ? -1 : 1);
  const beyond = (cap, value) => cap != null && (cap.value < 0 ? value < cap.value : value > cap.value);
  // 目標値が上限を超えていたら、上限に合わせて計算する
  const effectiveGoal = (stat, goal) => {
    const cap = capOf(stat, directionOf(stat, goal));
    return beyond(cap, goal) ? cap.value : goal;
  };

  // ---- ステータスを選ぶメニュー: 分類 → ステータス ----
  let menuPick = null; // 選んだときに呼ぶ関数
  let menuAdded = () => false; // すでに選んであるステータスか
  let menuSwings = null; // 振り数を選んだときに呼ぶ関数 (目標を選ぶときだけ)

  function openMenu(adder, onPick, isAdded, onSwings) {
    const menu = $('menu');
    if (!menu.hidden && menu.parentNode === adder) return closeMenu();
    menuPick = onPick;
    menuSwings = onSwings || null;
    menuAdded = isAdded;
    adder.append(menu);
    menu.hidden = false;
    // 右端からはみ出すときは、収まるところまで左へずらす
    menu.style.left = '0px';
    const over = menu.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
    if (over > 0) menu.style.left = `${-over}px`;
    $('menu-find').value = '';
    showCategory(currentCategory);
    $('menu-find').focus();
  }
  function closeMenu() {
    $('menu').hidden = true;
  }

  let currentCategory = 2; // よく使う「TP・攻撃間隔」から開く
  function statButton(stat) {
    const added = menuAdded(stat.k);
    const b = el('button', { type: 'button', className: added ? 'added' : '', textContent: stat.k, title: `${stat.n} 件の装備にある` });
    if (!added) b.addEventListener('click', () => {
      closeMenu();
      menuPick(stat.k);
    });
    return b;
  }
  function showCategory(index) {
    currentCategory = index;
    [...$('cats').children].forEach((b, i) => b.classList.toggle('on', i === index));
    const category = categories[index];
    $('menu-step').textContent = '② ステータス';
    $('stats').replaceChildren(...category.stats.map(statButton));
    // 振り数は装備のステータスではないが、目標に選べる (必要なストアTP に直して探す)
    if (menuSwings && /TP/.test(category.name)) {
      $('stats').prepend(...TP_KINDS.map((kind) => {
        const added = state.tp[kind.id].goal != null;
        const b = el('button', { type: 'button', className: added ? 'added' : '', textContent: `${kind.label}の振り数`, title: 'WS後TP から TP1000 に届くまでの回数。武器の隔から、必要なストアTP を計算して探します' });
        if (!added) b.addEventListener('click', () => {
          closeMenu();
          menuSwings(kind.id);
        });
        return b;
      }));
    }
    if (category.more) $('stats').append(el('span', { className: 'more', textContent: `ほか ${category.more} 種は上の欄で検索` }));
  }
  function showFound(query) {
    const found = suggest(db, query, 80).filter((s) => s.num && s.n > 0).slice(0, 40);
    [...$('cats').children].forEach((b) => b.classList.remove('on'));
    $('menu-step').textContent = '検索結果';
    $('stats').replaceChildren(...found.map(statButton));
    if (!found.length) $('stats').append(el('span', { className: 'none', textContent: '見つかりません' }));
  }

  // 分類から右のステータスへ斜めにマウスを動かすと、途中で別の分類の上を通ってしまう。
  // 直前の位置と右のパネルの上端・下端を結ぶ三角形の中を進んでいる間は「右へ向かっている」
  // とみなして切り替えを待ち、同じ分類の上で止まったときだけ切り替える
  const AIM_WAIT = 300;
  let aimTimer = 0;
  let trail = []; // 直近のマウスの位置
  function headingToStats() {
    if (trail.length < 2) return false;
    const now = trail[trail.length - 1];
    const before = trail[0];
    const box = $('stats').getBoundingClientRect();
    if (now.x <= before.x) return false; // 右へ進んでいない
    // 上端への傾きが緩くなり、下端への傾きが急になっていれば、三角形の内側へ進んでいる
    const slope = (from, cornerY) => (cornerY - from.y) / (box.left - from.x);
    return slope(now, box.top) < slope(before, box.top) && slope(now, box.bottom) > slope(before, box.bottom);
  }
  function enterCategory(index) {
    clearTimeout(aimTimer);
    if ($('menu-find').value.trim()) return; // 検索中は、押したときだけ分類に戻る
    if (headingToStats()) aimTimer = setTimeout(() => showCategory(index), AIM_WAIT);
    else showCategory(index);
  }

  function initMenu() {
    categories.forEach((category, i) => {
      const b = el('button', { type: 'button' }, category.name, el('span', { textContent: '›' }));
      b.addEventListener('mouseenter', () => enterCategory(i));
      b.addEventListener('mouseleave', () => clearTimeout(aimTimer));
      b.addEventListener('click', () => {
        clearTimeout(aimTimer);
        $('menu-find').value = '';
        showCategory(i);
      });
      $('cats').append(b);
    });
    $('cats').addEventListener('mousemove', (e) => {
      trail.push({ x: e.clientX, y: e.clientY });
      if (trail.length > 3) trail.shift();
    });
    $('menu-find').addEventListener('input', () => {
      const query = $('menu-find').value.trim();
      if (query) showFound(query);
      else showCategory(currentCategory);
    });
    $('menu-find').addEventListener('keydown', (e) => {
      if (e.isComposing) return; // 変換の確定に使う Enter は拾わない
      if (e.key === 'Escape') closeMenu();
      if (e.key === 'Enter') $('stats').querySelector('button:not(.added)')?.click();
    });
    // メニューの外を押したら閉じる
    document.addEventListener('mousedown', (e) => {
      if (!$('menu').hidden && !e.target.closest('.adder')) closeMenu();
    });
  }

  // ---- 上段の描画 ----

  function renderConditions() {
    $('job').value = state.job;
    $('sub').value = state.sub;
    $('sub-level').value = state.subLevel ?? '';
    $('sub-level').placeholder = autoSubLevel();
    $('sub-level').disabled = !state.sub;
    $('chara').replaceChildren(...store.chars.map((c) => el('option', { value: c.id, textContent: c.name })));
    $('chara').value = store.activeChar;
    $('profile').replaceChildren(...P.character(store).list.map((p) => el('option', { value: p.id, textContent: p.name })));
    $('profile').value = P.character(store).active;
    $('food').value = state.food;
    $('food').title = data.foods.find((f) => f.ja === state.food)?.help ?? '';
    for (const source of INNATE) {
      const toggle = $('innate-' + source.id);
      toggle.classList.toggle('on', state.innate[source.id]);
      const grown = P.jobSetting(P.character(store), state.job);
      const detail = source.id === 'gift' ? (grown.master ? ' (マスター)' : ` (JP ${grown.jp})`) : '';
      toggle.textContent = (state.innate[source.id] ? '✓ ' : '') + source.label + (state.job ? detail : '');
    }

    // 目標。枠の 2 行目に、装備以外で得ている分・上限・読み替えた結果を出す
    const { parts } = outside();
    const dot = () => el('span', { className: 'dot', textContent: '・' });
    const subLine = (notes) => el('span', { className: 'sub' }, ...notes.flatMap((note, index) => (index ? [dot(), note] : [note])));
    const removeButton = (onClick) => {
      const remove = el('button', { type: 'button', className: 'x', textContent: '×', title: '外す' });
      remove.addEventListener('click', onClick);
      return remove;
    };
    for (const old of $('goals').querySelectorAll('.goal')) old.remove();
    for (const target of state.targets) {
      const stat = db.statByKey.get(target.k);
      // 負の値を入れたら「その値以下」。入れる前は、ステータスの性質から向きを示す
      const below = directionOf(stat, target.goal) < 0;
      const cap = capOf(stat, below ? -1 : 1);
      const input = el('input', { type: 'number', step: 'any', placeholder: stat.neg ? '-40' : '50', title: below ? 'この値以下にする' : 'この値以上にする', value: target.goal ?? '' });
      input.addEventListener('change', () => {
        target.goal = input.value === '' ? null : Number(input.value);
        changed();
      });
      const notes = [];
      // 装備以外で得ている分 (特性・ギフト・メリポ・食事と、手で足した支援の分)
      const mine = parts.filter((part) => part.i === stat.i);
      if (mine.length) {
        const sum = mine.reduce((total, part) => total + part.value, 0);
        notes.push(el('span', { title: mine.map((part) => `${part.label} ${signed(part.value, stat.u)}`).join('\n') },
          'うち装備以外 ', el('b', { textContent: signed(sum, stat.u) }), ` (${[...new Set(mine.map((part) => part.label))].join('・')})`));
      }
      if (cap) {
        // 上限を超えた目標は、上限に合わせて計算する
        const over = target.goal != null && effectiveGoal(stat, target.goal) !== target.goal;
        notes.push(el('span', { className: over ? 'caution' : '', title: cap.note, textContent: `上限 ${signed(cap.value, stat.u)}` + (over ? ' として計算' : '') }));
      }
      // ロールや歌など、上の「装備以外」に無い支援の分は手で足せる。2 行目の右端に置く
      const buffTitle = 'ロールや歌などの支援効果で得る分を足す (上の「装備以外」に無い分)';
      let buff;
      if (target.base != null || manualOpen.has(target.k)) {
        const manual = el('input', { type: 'number', step: 'any', className: 'extra', placeholder: '0', title: buffTitle, value: target.base ?? '' });
        const close = () => {
          target.base = manual.value === '' ? null : Number(manual.value);
          if (!target.base) {
            target.base = null;
            manualOpen.delete(target.k);
          }
          changed();
        };
        manual.addEventListener('change', close);
        // 何も入れずに離れたら、ボタンに戻す
        manual.addEventListener('blur', () => {
          if (manual.value === '' && target.base == null && manualOpen.delete(target.k)) renderConditions();
        });
        buff = el('label', { className: 'buff' }, '支援など ', manual, removeButton(() => {
          manual.value = '';
          close();
        }));
      } else {
        buff = el('button', { type: 'button', className: 'buff-add', textContent: '＋ 支援など', title: buffTitle });
        buff.addEventListener('click', () => {
          manualOpen.add(target.k);
          renderConditions();
          [...$('goals').querySelectorAll('.goal')].find((g) => g.dataset.key === target.k)?.querySelector('.extra')?.focus();
        });
      }
      const sub = subLine(notes);
      sub.classList.add('split');
      sub.replaceChildren(el('span', null, ...sub.childNodes), buff);
      const goal = el('span', { className: 'goal' },
        el('span', { className: 'main' }, target.k + ' ', el('span', { className: 'op', textContent: below ? '≤' : '≥' }), input,
          stat.u ? el('span', { className: 'unit', textContent: stat.u }) : null,
          removeButton(() => {
            state.targets = state.targets.filter((t) => t !== target);
            changed();
          })),
        sub);
      goal.dataset.key = target.k;
      $('goal-adder').before(goal);
    }

    // 振り数の目標。必要なストアTP に直した内容を 2 行目に出す
    const swingGoals = swingTargets();
    for (const kind of TP_KINDS) {
      const setting = state.tp[kind.id];
      if (setting.goal == null) continue;
      const input = el('input', { type: 'number', min: 1, step: 1, value: setting.goal, title: 'WS後TP から、この回数以内で TP1000 に届くようにする' });
      input.addEventListener('change', () => {
        setting.goal = Math.max(1, Math.floor(Number(input.value) || 1));
        changed();
      });
      const found = swingGoals.find((g) => g.kind === kind);
      const note = found.error
        ? el('span', { className: 'caution', textContent: found.error })
        : el('span', { title: `1 ${kind.hit} ${found.hit} 以上の得TP が要る` }, `${found.setup.label}・${found.wsText} → `, el('b', { textContent: `ストアTP ${signed(found.need)} 以上` }));
      const goal = el('span', { className: 'goal' },
        el('span', { className: 'main' }, `${kind.label}の振り数 `, el('span', { className: 'op', textContent: '≤' }), input, el('span', { className: 'unit', textContent: '振り' }),
          removeButton(() => {
            setting.goal = null;
            changed();
          })),
        subLine([note]));
      goal.dataset.key = 'swings-' + kind.id;
      $('goal-adder').before(goal);
    }

    // WS後TP の欄: 近接と遠隔で別々。数値で入れるか、WS の段数から計算するか。
    // 武器を固定している側と、振り数を目標にした側だけ出す
    const setups = fixedSetups();
    const tpRow = $('tp-row');
    tpRow.replaceChildren();
    const unused = [];
    for (const kind of TP_KINDS) {
      const setting = state.tp[kind.id];
      if (!setups[kind.id] && setting.goal == null) {
        unused.push(kind);
        continue;
      }
      const seg = el('span', { className: 'seg small' }, ...[['value', '数値'], ['hits', 'WS の段数']].map(([mode, label]) => {
        const b = el('button', { type: 'button', className: setting.mode === mode ? 'on' : '', textContent: label });
        b.addEventListener('click', () => {
          setting.mode = mode;
          changed();
        });
        return b;
      }));
      const key = setting.mode === 'hits' ? 'hits' : 'value';
      const input = el('input', { type: 'number', min: key === 'hits' ? 1 : 0, step: 1, className: 'input narrow', value: setting[key] ?? '',
        title: key === 'hits' ? 'WS の段数。初段は通常の 1 ヒットぶん、2 段目以降は 1 段につき 10 として、全段命中で計算します' : 'WS を撃った直後の TP' });
      input.addEventListener('change', () => {
        setting[key] = Math.max(key === 'hits' ? 1 : 0, Math.floor(Number(input.value) || 0));
        changed();
      });
      tpRow.append(el('span', { className: 'tp-entry' }, el('b', { textContent: kind.label }), seg, input, key === 'hits' ? '段' : null));
    }
    if (unused.length) {
      tpRow.append(el('span', { className: 'hint', textContent: unused.length === TP_KINDS.length ? 'メインの武器かレンジを固定すると、得TP と振り数を計算します'
        : unused[0].id === 'ranged' ? '遠隔は、レンジを固定するか「遠隔の振り数」を目標にすると出ます'
        : '近接は、メインの武器を固定するか「近接の振り数」を目標にすると出ます' }));
    }

    for (const b of $('objective').children) b.classList.toggle('on', b.dataset.value === state.objective);
    $('avoid-minus').checked = !!state.avoidMinus;
    $('maximize-adder').hidden = state.objective !== 'max';
    $('maximize').textContent = state.maximize.length ? '＋ 伸ばすステータスを追加' : '伸ばすステータスを選ぶ';
    // 伸ばすステータスは複数選べる。「値 × 重み」の合計が最大になるように組む
    for (const old of $('objective-row').querySelectorAll('.goal')) old.remove();
    for (const m of state.objective === 'max' ? state.maximize : []) {
      const stat = db.statByKey.get(m.k);
      const weight = el('input', { type: 'number', step: 'any', min: 0, className: 'weight', value: m.weight, title: '重み。大きいほど、このステータスを優先します (ほかとの比率で効きます)' });
      weight.addEventListener('change', () => {
        m.weight = Math.max(0, Number(weight.value) || 0);
        changed();
      });
      const cap = capOf(stat, stat.neg ? -1 : 1);
      $('maximize-adder').before(el('span', { className: 'goal grow' },
        el('span', { className: 'main' }, stat.k + ' ', el('span', { className: 'op', textContent: '×' }), weight,
          removeButton(() => {
            state.maximize = state.maximize.filter((x) => x !== m);
            changed();
          })),
        // 上限に届いたら、それ以上は伸ばさない
        subLine([cap ? el('span', { title: cap.note, textContent: `重み・上限 ${signed(cap.value, stat.u)} まで` }) : el('span', { textContent: '重み' })])));
    }
  }

  // ---- 左: 固定する装備と、使う装備の範囲 ----

  function findItems(slot, query) {
    const q = fold(query.trim());
    const found = data.items.filter((i) => i.slots & slot.mask && usable(i) && (!IL119_ONLY.has(slot.id) || i.il === 119) && i.names.includes(q));
    found.sort((a, b) => b.il - a.il || b.lv - a.lv || a.ja.localeCompare(b.ja, 'ja'));
    return found.slice(0, 40);
  }

  function fix(slotId, id) {
    // 耳・指で、同じ装備をもう片方に固定しているときは付け替える
    for (const [other, otherId] of Object.entries(state.fixed)) if (otherId === id) delete state.fixed[other];
    // 同時に持てない装備 (報酬リングなど) を固定していたら、そちらを外す
    const only = getItem(id)?.only;
    if (only != null) {
      for (const [other, otherId] of Object.entries(state.fixed)) if (other !== slotId && getItem(otherId)?.only === only) delete state.fixed[other];
    }
    state.fixed[slotId] = id;
    editing = null;
    changed();
  }

  function cell(slot, item, options) {
    const c = el('div', { className: 'cell' + (slot.weapon ? ' weapon' : '') + (options.fixed ? ' fixed' : '') + (item ? '' : slot.weapon ? ' off' : ' free') + (options.selected ? ' sel' : '') + (options.diff ? ' diff' : '') });
    c.append(el('div', { className: 'slot', textContent: slot.ja }));
    // 空のマスは、言葉 (未設定・自由) があればそれを、無ければ部位の名前だけを出す
    if (item || options.empty) c.append(el('div', { className: 'name', textContent: item ? nameOf(item) : options.empty }));
    else c.classList.add('blank');
    if (item && options.gain) c.append(el('div', { className: 'gain', textContent: options.gain }));
    if (item) c.title = item.desc + (item.aug ? '\nオーグメント: ' + item.aug : '') + (item.manual ? '\n手入力のオーグメント: ' + item.manual : '');
    return c;
  }

  function renderSide() {
    const grid = $('mine');
    grid.replaceChildren();
    for (const slot of SLOTS) {
      const item = getItem(state.fixed[slot.id]);
      const c = cell(slot, item, { fixed: !!item, selected: editing === slot.id, empty: slot.weapon ? '未設定' : '' });
      if (!item && !slot.weapon) c.title = '空のマスは自動で選びます。押すと装備を固定できます';
      c.addEventListener('click', () => {
        editing = editing === slot.id ? null : slot.id;
        renderSide();
        $('editor').querySelector('input')?.focus();
      });
      grid.append(c);
    }

    const editor = $('editor');
    editor.hidden = !editing;
    editor.replaceChildren();
    if (editing) {
      const slot = SLOTS.find((s) => s.id === editing);
      const item = getItem(state.fixed[slot.id]);
      const title = el('div', { className: 'title' }, item ? `${slot.ja}: ${nameOf(item)}` : `${slot.ja} を固定する`);
      if (item) {
        const clear = el('button', { type: 'button', className: 'ghost', textContent: '固定を解除' });
        clear.addEventListener('click', () => {
          delete state.fixed[slot.id];
          editing = null;
          changed();
        });
        title.append(clear);
      }
      const input = el('input', { type: 'search', autocomplete: 'off', placeholder: '装備の名前 (日本語・英語)' });
      const list = el('ul');
      const draw = () => {
        list.replaceChildren();
        if (!input.value.trim()) return;
        const found = findItems(slot, input.value);
        if (!found.length) list.append(el('li', { textContent: '見つかりません' }));
        for (const i of found) {
          const li = el('li', null,
            el('span', null, nameOf(i), el('span', { className: 'sub', textContent: (i.aug || i.desc).replace(/\s+/g, ' ').slice(0, 44) })),
            el('span', { className: 'lv', textContent: i.il ? 'IL' + i.il : 'Lv' + i.lv }));
          li.addEventListener('click', () => fix(slot.id, i.id));
          list.append(li);
        }
      };
      input.addEventListener('input', draw);
      input.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        if (e.key === 'Escape') {
          editing = null;
          renderSide();
        }
      });
      editor.append(title, input, list);
    }

    const excluded = profile().excluded.filter((id) => getItem(id));
    $('excluded-box').hidden = !excluded.length;
    $('excluded-title').textContent = `除外中 (${excluded.length})`;
    $('excluded').replaceChildren(...excluded.map((id) => {
      const chip = el('button', { type: 'button', className: 'chip', textContent: nameOf(getItem(id)) + ' ×', title: '候補に戻す' });
      chip.addEventListener('click', () => {
        profile().excluded = profile().excluded.filter((x) => x !== id);
        changed();
      });
      return chip;
    }));
  }

  function render() {
    renderConditions();
    renderSide();
    renderSaved();
  }

  // ---- 計算 ----

  function request() {
    const targets = state.targets.filter((t) => t.goal != null && t.goal !== 0).map((t) => ({ k: t.k, goal: t.goal }));
    // 振り数の目標は、必要なストアTP として足す (ストアTP の目標があれば、高いほうを使う)
    for (const goal of swingTargets()) {
      if (goal.error || goal.need <= 0) continue;
      const mine = targets.find((t) => t.k === 'ストアTP');
      if (mine) mine.goal = Math.max(mine.goal, goal.need);
      else targets.push({ k: 'ストアTP', goal: goal.need });
    }
    const fixed = {};
    for (const [slot, id] of Object.entries(state.fixed)) fixed[slot] = getItem(id);

    // マントは、目標と伸ばすステータスに合わせて構成を作る
    const wanted = new Map(targets.map((t) => [db.statByKey.get(t.k).i, t.goal < 0 ? -1 : 1]));
    const growing = state.objective === 'max' ? state.maximize.filter((m) => m.weight > 0) : [];
    for (const m of growing) {
      const stat = db.statByKey.get(m.k);
      if (!wanted.has(stat.i)) wanted.set(stat.i, stat.neg ? -1 : 1);
    }
    // 頭・胴・両手・両脚・両足は IL119 だけ。そのうえで、選んだ設定の範囲にある装備だけを使う
    // 「マイナスのある装備を使わない」: 命中-10 のように、普通は増える性能が減る装備を自動の候補から外す
    // (被ダメージや敵対心のように、もともと小さいほど良いものは対象外。条件つきの効果も見ない)
    const hasMinus = (item) => {
      for (const [i, v] of item.m) if (typeof v === 'number' && v < 0 && !data.stats[i].neg && !data.stats[i].scoped) return true;
      return false;
    };
    const allow = (item) => (item.group === 'cape' || eligible(item)) && P.allow(profile(), item, data.contents) && !(state.avoidMinus && hasMinus(item));
    return {
      job: state.job,
      level: 'all', // 部位ごとの条件は allow で見ている
      targets: targets.map((t) => ({ i: db.statByKey.get(t.k).i, goal: effectiveGoal(db.statByKey.get(t.k), t.goal) })),
      objective: state.objective,
      // 伸ばすステータス: 番号、重み、上限 (あれば)
      maximize: growing.map((m) => {
        const stat = db.statByKey.get(m.k);
        return { i: stat.i, weight: m.weight, cap: capOf(stat, stat.neg ? -1 : 1)?.value ?? null };
      }),
      fixed,
      excluded: new Set(profile().excluded),
      base: outside().base,
      extra: profile().cape ? { back: capeVariants(state.job, wanted) } : {},
      allow,
      sets: data.sets,
    };
  }

  // 計算は HiGHS (整数計画法のソルバー) に解かせる。5 MB あるので、画面を出したあとで読み込む。
  // 読み込めなかったときと、index.html?dp=1 で開いたとき (比べる用) は、以前の計算 (solver.js) を使う
  const forceOld = new URLSearchParams(location.search).has('dp');
  const loadScript = (src) => new Promise((ok, ng) => {
    document.head.append(Object.assign(document.createElement('script'), { src, onload: ok, onerror: () => ng(new Error(src)) }));
  });
  const scriptsReady = forceOld ? Promise.resolve(false)
    : Promise.all([loadScript('vendor/highs.js'), loadScript('vendor/highs-wasm.js'), loadScript('solver-ilp.js')]).then(() => true, () => false);
  // HiGHS は別のスレッド (Web Worker) で動かす。画面のスレッドで解くと、答えが出るまで画面が固まるため。
  // Worker を作れない環境では、画面のスレッドで動かす。計算に失敗した Worker は捨てて、次の計算で作り直す
  let highsPromise = null;
  function highsReady() {
    if (!highsPromise) {
      highsPromise = scriptsReady.then((ok) => {
        if (!ok) return null;
        const ILP = window.VanaSolverILP;
        return ILP.worker(window.Module, window.HIGHS_WASM_BASE64)
          .catch(() => ILP.load(window.Module, window.HIGHS_WASM_BASE64))
          .catch(() => null);
      });
    }
    return highsPromise;
  }
  highsReady();
  let version = 0; // 条件が変わるたびに増える (計算中に条件が変わったことを知るため)

  function run() {
    const problem = !state.job ? 'ジョブを選んでください。'
      : !state.targets.some((t) => t.goal) && !swingTargets().some((g) => !g.error) ? '目標のステータスと値を入れてください。'
      : state.objective === 'max' && !state.maximize.some((m) => m.weight > 0) ? '伸ばすステータスを選んでください。' : '';
    if (problem) {
      $('status').textContent = problem;
      return;
    }
    $('solve').disabled = true;
    $('status').textContent = '計算中…';
    // 「計算中」を先に画面へ出してから計算する (HiGHS の読み込みがまだなら、終わるのを待つ)
    setTimeout(async () => {
      const highs = await highsReady();
      const started = performance.now();
      const startedVersion = version;
      const req = request();
      // 結果を出したときの条件 (ステータスの表示に使う)
      const who = currentWho();
      let result = null;
      if (highs) {
        try {
          result = await window.VanaSolverILP.solve(highs, db, req, { onProgress: (found) => ($('status').textContent = `計算中… 候補 ${found} 件`) });
        } catch (error) {
          console.error(error); // 解けなかったときは、以前の計算に任せる
          if (highs.alive && !highs.alive()) highsPromise = null;
        }
      }
      const old = !result;
      if (old) result = solve(db, req);
      lastResult = { req, who, context: contextFor(who), result };
      // 前の候補を比較に入れていたら外す (候補の番号が変わるため)
      compare = compare.filter((key) => !key.startsWith('c'));
      saving = null;
      selected = null;
      $('solve').disabled = false;
      const sure = !result.sets.length ? '' : !result.reached ? '・目標に届かず' : result.exact ? '・最良と確認済み' : '・途中で打ち切り';
      $('status').textContent = `${result.sets.length} 件・${((performance.now() - started) / 1000).toFixed(2)} 秒${sure}` + (old ? ' (以前の計算)' : '')
        // 計算している間も画面は動くので、その間に条件を変えられる
        + (version !== startedVersion ? '。計算中に条件が変わりました。「セットを探す」で更新します' : '');
      renderResults();
    }, 30);
  }

  // ---- 右: 候補 ----

  function setText(set) {
    return SLOTS.filter((s) => set.equip[s.id]).map((s) => `${s.ja}: ${nameOf(set.equip[s.id])}`).join('\n');
  }

  // ステータスの計算に使う条件 (ジョブ・サポ・種族・マスターレベルと、装備以外の分の内訳)
  function contextFor(who) {
    return {
      job: who.job, sub: who.sub, subLevel: who.subLevel,
      race: P.character(store).race, ml: P.jobSetting(P.character(store), who.job).ml,
      parts: outsideFor(who).parts,
      traits: who.innate.trait, // ジョブ特性を数えるか (スマイトにも効く)
      gifts: who.innate.gift, jp: P.jobSetting(P.character(store), who.job).jp, // マーシャルアーツのギフトに使う
    };
  }

  // ---- セットのステータス ----
  // ゲーム内のステータス画面のように、素の値 (白) と、装備などで増える分 (緑) を分けて出す。
  // 素の値は、種族・ジョブ・サポートジョブ・マスターレベルで決まる分に、ジョブ特性とメリポの分を足したもの
  // (ゲーム内でも、メリポや HPmax アップは白い数字に入る)。緑は装備・食事・手入力の分
  const SHEET_KEYS = ['HP', 'MP', 'STR', 'DEX', 'VIT', 'AGI', 'INT', 'MND', 'CHR'];
  const ATTACK_KEYS = ['攻', '命中', '飛攻', '飛命'];
  const WHITE_SOURCES = new Set(['特性', 'サポ特性', 'ギフト', 'メリポ']);
  const number = (v) => v.toLocaleString('ja-JP');
  const plus = (v, unit) => (v < 0 ? '' : '+') + number(v) + (unit || '');

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

  // 左の枠: HP・MP・STR〜CHR を「素の値 +増える分 合計」で並べる
  function statSheet(set, context) {
    const { job, sub, values } = sheetValues(set, context);
    const rows = SHEET_KEYS.map((key) => {
      const v = values[key];
      return el('tr', { className: key === 'STR' ? 'gap' : '', title: `種族・ジョブ・サポ・マスターレベル ${number(v.base)} / 特性・メリポ ${plus(v.extra)} / 装備・食事など ${plus(v.green)}` },
        el('td', { className: 'k', textContent: key }),
        el('td', { className: 'base', textContent: number(v.white) }),
        el('td', { className: 'plus' + (v.green < 0 ? ' minus' : ''), textContent: plus(v.green) }),
        el('td', { className: 'total', textContent: number(v.white + v.green) }));
    });
    const raceName = data.base.races[context.race] ? data.base.races[context.race].ja : '';
    return el('div', { className: 'sheet' },
      el('div', { className: 'who' }, `${job.ja} 99` + (sub ? ` / ${sub.ja} ${context.subLevel}` : ''),
        el('span', { textContent: `${raceName}・マスターレベル ${context.ml}` })),
      el('table', null, ...rows));
  }

  // 攻撃・命中 (メインの武器) と、飛攻・飛命 (レンジの武器、無ければ矢弾) の計算。
  // 武器が決まっていないと計算できないので null を返す。white は装備なしの値、total は装備込みの値
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
      };
    }
    const acc = flatOf('命中');
    const atk = flatOf('攻');
    return {
      kind, skill: skillTotal,
      accuracy: pair(B.accuracy({ skill: skillWhite, dex: values.DEX.white, flat: acc.white }), B.accuracy({ skill: skillTotal, dex: total('DEX'), flat: acc.total })),
      attack: pair(boost(B.attack({ skill: skillWhite, str: values.STR.white, flat: atk.white, hands: kind.kind })), boost(B.attack({ skill: skillTotal, str: total('STR'), flat: atk.total, hands: kind.kind }))),
      smite,
    };
  }

  // 下の枠: 攻撃・命中・飛攻・飛命。武器を固定していれば「装備なしの値 +増える分 合計」、
  // 固定していなければ、装備などで増える分だけを出す
  function attackTiles(set, req, context) {
    const melee = combatValues(set, context, false);
    const ranged = combatValues(set, context, true);
    const tiles = [['攻', '攻撃', melee, 'attack'], ['命中', '命中', melee, 'accuracy']];
    if (ranged) tiles.push(['飛攻', '飛攻', ranged, 'attack'], ['飛命', '飛命', ranged, 'accuracy']);
    return el('div', { className: 'tiles' }, ...tiles.map(([key, label, computed, field]) => {
      const stat = db.statByKey.get(key);
      const flat = set.totals.get(stat.i) || 0;
      const other = req.base[stat.i] || 0;
      const detail = `装備の${key} ${plus(flat - other)} / 装備以外の${key} ${plus(other)}`;
      if (!computed) {
        return el('div', { className: 'tile off', title: `${detail}\nメインの武器を固定すると、合計を計算します` },
          el('div', { className: 'k', textContent: `${label} (増える分)` }),
          el('div', { className: 'v' }, el('span', { className: 'sum plus', textContent: plus(flat) })));
      }
      const v = computed[field];
      const smiteNote = field === 'attack' && computed.smite ? `\nスマイト: 攻撃力 +${computed.smite}/256 (約 ${((computed.smite / 256) * 100).toFixed(1)}%)` : '';
      return el('div', { className: 'tile', title: `${computed.kind.ja}スキル ${number(computed.skill)} (ジョブの上限・マスターレベル・メリポ・装備の合計)\n${detail}${smiteNote}` },
        el('div', { className: 'k', textContent: `${label} (${computed.kind.ja})` }),
        el('div', { className: 'v' },
          el('span', { className: 'base', textContent: number(v.white) }),
          el('span', { className: 'plus', textContent: plus(v.total - v.white) }),
          el('span', { className: 'sum', textContent: number(v.total) })));
    }));
  }

  // ---- 得TP・振り数 ----
  const TP = window.VanaTP;
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

  // セットの得TP と振り数。計算できなければ null
  function tpValues(kindId, set, context) {
    const setup = tpSetup(kindId, set.equip, set.totals, context);
    if (!setup) return null;
    const setting = state.tp[kindId];
    const storeTp = totalOf(set.totals, 'ストアTP');
    const hit = TP.perHit(setup.delay, storeTp);
    const start = TP.afterWs(setting, hit);
    const swings = TP.swings(start, hit);
    const perRound = kindId === 'ranged' ? 1 : TP.hitsPerRound({
      doubleAttack: totalOf(set.totals, 'ダブルアタック'), tripleAttack: totalOf(set.totals, 'トリプルアタック'), quadAttack: totalOf(set.totals, 'クワッドアタック'), hands: setup.hands,
    });
    // 1 振り減らすのに要るストアTP
    const next = swings > 1 && Number.isFinite(swings) ? TP.storeTpFor(setup.delay, setting, swings - 1) : null;
    return { setup, setting, storeTp, hit, start, swings, perRound, rounds: TP.rounds(start, hit, perRound), next, ladder: TP.ladder(start, hit) };
  }

  // 固定した武器での、1 発ぶんの隔と手数 (近接・遠隔)。武器を固定していない側は null
  function fixedSetups() {
    const equip = {};
    for (const [slot, id] of Object.entries(state.fixed)) if (getItem(id)) equip[slot] = getItem(id);
    const who = currentWho();
    const totals = window.VanaSolver.totalsOf(equip, outsideFor(who).base, data.sets).totals;
    const context = contextFor(who);
    return Object.fromEntries(TP_KINDS.map((kind) => [kind.id, tpSetup(kind.id, equip, totals, context)]));
  }
  // 振り数の目標を、必要なストアTP に直す。隔が要るので、固定した武器で計算する。
  // 二刀流やマーシャルアーツは、装備以外の分と固定した装備の分だけを見る (自動で選ぶ装備の分は入らない)
  function swingTargets() {
    const out = [];
    const setups = fixedSetups();
    for (const kind of TP_KINDS) {
      const setting = state.tp[kind.id];
      if (setting.goal == null) continue;
      const setup = setups[kind.id];
      if (!setup) {
        out.push({ kind, error: kind.id === 'ranged' ? 'レンジ (と矢弾) の武器を固定すると計算できます' : 'メインの武器を固定すると計算できます' });
        continue;
      }
      const need = TP.storeTpFor(setup.delay, setting, setting.goal);
      if (need == null) {
        out.push({ kind, error: `${setting.goal} 振りには、ストアTP をいくら積んでも届きません (${setup.label})` });
        continue;
      }
      const hit = TP.perHit(setup.delay, need);
      const wsText = setting.mode === 'hits' ? `${setting.hits} 段の WS (WS後TP ${TP.afterWs(setting, hit)})` : `WS後TP ${setting.value || 0}`;
      out.push({ kind, n: setting.goal, setup, need, hit, wsText });
    }
    return out;
  }

  // 候補のカードに出す枠。武器が決まっている側だけ
  function tpBoxes(set, context) {
    const boxes = [];
    for (const kind of TP_KINDS) {
      const v = tpValues(kind.id, set, context);
      if (!v) continue;
      const reachable = Number.isFinite(v.swings);
      const pair = (k, value, note) => el('span', null, k, el('b', { textContent: value }), note || null);
      const steps = el('div', { className: 'steps' });
      v.ladder.forEach((tp, index) => {
        if (index) steps.append(el('em', { textContent: '›' }));
        steps.append(el('span', { className: tp >= 1000 ? 'hit' : '', textContent: tp, title: index ? `${index} 振り後` : 'WS後' }));
      });
      boxes.push(el('div', { className: 'tpbox' },
        el('div', { className: 'k', textContent: `${kind.label}の TP・${v.setup.label}` }),
        el('div', { className: 'head' },
          el('span', { className: 'swings' }, reachable ? String(v.swings) : '—', el('small', { textContent: ' 振り' })),
          el('span', { className: 'avg', textContent: kind.id === 'ranged' ? '1 回 1 発で数える'
            : reachable ? `平均 ${v.rounds.toFixed(1)} ラウンド (1 ラウンド ${v.perRound.toFixed(2)} 回)` : '',
            title: 'ダブルアタック・トリプルアタック・クワッドアタックを入れた、平均の攻撃ラウンド数 (命中 100% として)。二刀流・格闘は左右で 2 回ぶん' })),
        el('div', { className: 'kv' },
          pair('ストアTP', signed(v.storeTp)),
          pair(`1 ${kind.hit}の得TP`, String(v.hit)),
          pair('WS後TP', String(v.start), v.setting.mode === 'hits' ? ` (${v.setting.hits} 段の WS)` : ' (入力)'),
          v.next != null ? pair(`${v.swings - 1} 振りにするには`, `ストアTP ${signed(v.next)}`, ` (あと ${signed(v.next - v.storeTp)})`) : null),
        steps));
    }
    return boxes.length ? el('div', { className: 'tp' }, ...boxes) : null;
  }

  // そのほかのステータス。分類ごとに、0 でない値をすべて並べる
  const THIN = new Set(['スキル', 'ペット', 'その他', '条件つき', '特殊効果']); // 目標が無ければ畳んでおく分類
  function statsPanel(set, req, wanted) {
    const groups = new Map(CATEGORY_ORDER.map((name) => [name, []]));
    const shown = new Set([...SHEET_KEYS, ...ATTACK_KEYS]); // 上の枠に出したものは、ここには出さない
    for (const [i, value] of set.totals) {
      const stat = data.stats[i];
      // 武器の D と隔は、足し合わせても意味が無いので出さない
      if (!value || stat.k === 'D' || stat.k === '隔' || shown.has(stat.k)) continue;
      const other = req.base[i] || 0; // 特性・ギフト・メリポ・食事など、装備以外の分
      const cap = capOf(stat, value < 0 ? -1 : 1);
      groups.get(categoryOf(stat.k)).push({ stat, value, other, over: beyond(cap, value) ? cap : null });
    }
    // 数値を持たない特殊効果 (「リエモン範囲化」など) は、名前だけ並べる
    const effects = new Set();
    for (const item of Object.values(set.equip)) {
      for (const [i, value] of item.m) if (value === null) effects.add(data.stats[i].k);
    }
    const panel = el('div', { className: 'stats-panel' });
    const folded = [];
    const place = (name, group, hasGoal) => (THIN.has(name) && !hasGoal ? folded.push({ name, group }) : panel.append(group));
    for (const [name, list] of groups) {
      if (!list.length) continue;
      list.sort((a, b) => listedOrder(a.stat) - listedOrder(b.stat));
      const box = el('div', { className: 'stat-list' });
      // スキルは、共通のメリポだけで全種類に値が付く。装備が絡まないものは 1 つにまとめる
      const quiet = name === 'スキル' ? list.filter((entry) => entry.value === entry.other) : [];
      for (const entry of list) {
        if (quiet.includes(entry)) continue;
        const gear = entry.value - entry.other;
        const detail = entry.other ? `装備 ${signed(gear, entry.stat.u)} / 装備以外 ${signed(entry.other, entry.stat.u)}` : '装備のみ';
        box.append(el('span', { className: 'stat' + (entry.over ? ' over' : '') + (wanted.has(entry.stat.i) ? ' wanted' : ''), title: detail + (entry.over ? `\n上限 ${signed(entry.over.value, entry.stat.u)} (${entry.over.note})。超えた分は効果がありません` : '') },
          entry.stat.k + ' ', el('b', { textContent: signed(entry.value, entry.stat.u) }),
          entry.over ? el('span', { className: 'cap-mark', textContent: ` 上限 ${signed(entry.over.value, entry.stat.u)}` }) : null));
      }
      if (quiet.length) {
        box.append(el('span', { className: 'stat effect', textContent: `ほか ${quiet.length} 種 (装備以外の分のみ)`, title: quiet.map((entry) => `${entry.stat.k} ${signed(entry.value, entry.stat.u)}`).join('\n') }));
      }
      place(name, el('div', { className: 'stat-group' }, el('div', { className: 'stat-title', textContent: name }), box), list.some((entry) => wanted.has(entry.stat.i)));
    }
    if (effects.size) {
      place('特殊効果', el('div', { className: 'stat-group' }, el('div', { className: 'stat-title', textContent: '特殊効果' }),
        el('div', { className: 'stat-list' }, ...[...effects].map((name) => el('span', { className: 'stat effect', textContent: name })))), false);
    }
    if (folded.length) {
      // 開け閉めは、すべての候補でそろえる
      const rest = el('details', { className: 'rest', open: restOpen },
        el('summary', { textContent: `そのほか ${folded.length} 分類 (${folded.map((f) => f.name).join('・')})` }),
        el('div', { className: 'stats-panel' }, ...folded.map((f) => f.group)));
      rest.addEventListener('toggle', () => {
        if (rest.open === restOpen) return;
        restOpen = rest.open;
        for (const other of document.querySelectorAll('details.rest')) other.open = restOpen;
      });
      panel.append(rest);
    }
    return panel;
  }

  // 手入力のオーグメント。ランダムで付くもの (ソーティの耳装備など) を、ゲーム内の表記で入力する
  function manualField(item) {
    if (String(item.id).startsWith('cape:')) return null; // マントは構成を自動で選ぶ
    const input = el('input', { type: 'text', className: 'manual-input', placeholder: '例: STR+8 DEX+8 命中+12', value: P.character(store).augments[item.id] || '', spellcheck: false });
    const note = el('span', { className: 'manual-note' });
    const check = () => {
      const { unknown } = window.VanaAugment.read(db, input.value);
      note.textContent = unknown.length ? `読めない項目: ${unknown.join('、')}` : '';
    };
    input.addEventListener('input', check);
    input.addEventListener('change', () => {
      const text = input.value.trim();
      if (text) P.character(store).augments[item.id] = text;
      else delete P.character(store).augments[item.id];
      window.VanaAugment.apply(db, P.character(store).augments);
      changed();
    });
    check();
    return el('label', { className: 'manual', title: 'ランダムで付くオーグメントなど、説明文に無い分を入力します。このキャラクターに保存され、次の計算から使われます' },
      el('span', { textContent: '手入力のオーグメント' }), input,
      item.roll ? el('span', { className: 'manual-roll', textContent: `この装備に付く幅: ${item.roll}` }) : null, note);
  }

  // ---- セットの保存と比較 ----
  const savedSets = () => P.character(store).sets;

  // 比較や保存の対象を、計算できる形にする。key が 'c0' なら候補、's…' なら保存したセット
  function entryOf(key) {
    if (key.startsWith('c')) {
      const index = Number(key.slice(1));
      const set = lastResult && lastResult.result.sets[index];
      if (!set) return null;
      return { key, label: `候補 ${index + 1}`, set, context: lastResult.context, base: lastResult.req.base, who: lastResult.who };
    }
    const saved = savedSets().find((x) => x.id === key);
    if (!saved) return null;
    const equip = {};
    for (const [slot, id] of Object.entries(saved.equip)) {
      const item = getItem(id);
      if (item) equip[slot] = item;
    }
    // 保存したときのジョブ・サポ・食事で、いまの育成とオーグメントを使って計算し直す
    const base = outsideFor(saved.who).base;
    const set = Object.assign({ equip }, window.VanaSolver.totalsOf(equip, base, data.sets));
    return { key, label: saved.name, set, context: contextFor(saved.who), base, who: saved.who, saved };
  }

  const whoText = (who) => {
    const job = data.jobs.find((j) => j.id === who.job);
    const sub = data.jobs.find((j) => j.id === who.sub);
    return `${job ? job.ja : '?'} 99` + (sub ? ` / ${sub.ja} ${who.subLevel}` : '') + (who.food ? `・${who.food}` : '・食事なし');
  };

  function saveSet(name, who, equipItems) {
    const equip = {};
    for (const [slot, item] of Object.entries(equipItems)) if (item) equip[slot] = item.id;
    savedSets().push({ id: 's' + P.newId(), name, who: JSON.parse(JSON.stringify(who)), equip });
  }

  function toggleCompare(key) {
    if (compare.includes(key)) compare = compare.filter((k) => k !== key);
    else if (compare.length < COMPARE_MAX) compare.push(key);
    else $('status').textContent = `比較に並べられるのは ${COMPARE_MAX} つまでです。`;
    renderSaved();
    if (lastResult) renderResults();
    else renderCompare();
  }

  // 比較に出す行: 分類、名前、値。値は合計 (基本ステータスと攻撃・命中はゲーム内の値)
  function rowsOf(entry) {
    const rows = [];
    const { values } = sheetValues(entry.set, entry.context);
    for (const key of SHEET_KEYS) rows.push({ group: '基本ステータス', name: key, value: values[key].white + values[key].green, unit: '' });
    const melee = combatValues(entry.set, entry.context, false);
    const ranged = combatValues(entry.set, entry.context, true);
    for (const [key, label, computed, field] of [['攻', '攻撃', melee, 'attack'], ['命中', '命中', melee, 'accuracy'], ['飛攻', '飛攻', ranged, 'attack'], ['飛命', '飛命', ranged, 'accuracy']]) {
      const flat = entry.set.totals.get(db.statByKey.get(key).i) || 0;
      if (computed) rows.push({ group: '攻撃・命中', name: `${label} (${computed.kind.ja})`, value: computed[field].total, unit: '' });
      else if (flat) rows.push({ group: '攻撃・命中', name: `${label} (増える分)`, value: flat, unit: '', signed: true });
    }
    for (const kind of TP_KINDS) {
      const v = tpValues(kind.id, entry.set, entry.context);
      if (!v) continue;
      rows.push({ group: 'TP・振り数', name: `${kind.label}の 1 ${kind.hit}の得TP`, value: v.hit, unit: '' });
      if (Number.isFinite(v.swings)) rows.push({ group: 'TP・振り数', name: `${kind.label}の振り数`, value: v.swings, unit: '' });
    }
    const shown = new Set([...SHEET_KEYS, ...ATTACK_KEYS]);
    const rest = [];
    for (const [i, value] of entry.set.totals) {
      const stat = data.stats[i];
      if (!value || stat.k === 'D' || stat.k === '隔' || shown.has(stat.k)) continue;
      rest.push({ group: categoryOf(stat.k), name: stat.k, value, unit: stat.u, signed: true, stat });
    }
    rest.sort((a, b) => CATEGORY_ORDER.indexOf(a.group) - CATEGORY_ORDER.indexOf(b.group) || listedOrder(a.stat) - listedOrder(b.stat));
    return rows.concat(rest);
  }

  function renderCompare() {
    const box = $('compare');
    const entries = compare.map(entryOf).filter(Boolean);
    compare = entries.map((e) => e.key); // 消えたもの (削除したセットなど) は外す
    box.hidden = entries.length < 2;
    box.replaceChildren();
    if (entries.length < 2) return;

    const tables = entries.map(rowsOf);
    // 行の並びは、最初に出てきた順 (基準のセットを先に、ほかにしか無い行を後ろに)
    const order = [];
    for (const rows of tables) for (const row of rows) if (!order.some((o) => o.group === row.group && o.name === row.name)) order.push(row);
    const groupOrder = ['基本ステータス', '攻撃・命中', 'TP・振り数', ...CATEGORY_ORDER];
    order.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group));
    const valueOf = (rows, row) => rows.find((r) => r.group === row.group && r.name === row.name);
    const show = (row, value) => (row.signed ? signed(value, row.unit) : number(value) + row.unit);

    const head = el('tr', null, el('th'));
    entries.forEach((entry, k) => {
      const remove = el('button', { type: 'button', className: 'x', textContent: '×', title: '比較から外す' });
      remove.addEventListener('click', () => toggleCompare(entry.key));
      head.append(el('th', null, el('b', null, entry.label, ' ', remove), (k === 0 ? '基準・' : '') + whoText(entry.who)));
      if (k > 0) head.append(el('th', { textContent: '差' }));
    });
    const body = el('tbody');
    let group = '';
    let any = false;
    for (const row of order) {
      const cells = tables.map((rows) => valueOf(rows, row));
      const values = cells.map((c) => (c ? c.value : 0));
      if (compareMode === 'diff' && values.every((v) => v === values[0])) continue;
      if (row.group !== group) body.append(el('tr', { className: 'group' }, el('td', { colSpan: entries.length * 2, textContent: (group = row.group) })));
      any = true;
      const tr = el('tr', null, el('td', { textContent: row.name }));
      values.forEach((value, k) => {
        tr.append(el('td', { className: k === 0 ? 'base' : '', textContent: cells[k] || value ? show(row, value) : '—' }));
        if (k > 0) {
          const diff = value - values[0];
          // 小さいほど良いステータス (被ダメージなど) は、減ったほうを良い色にする
          const good = row.stat && row.stat.neg ? diff < 0 : diff > 0;
          tr.append(el('td', { className: diff === 0 ? 'same' : good ? 'up' : 'down', textContent: diff === 0 ? '±0' : signed(diff, row.unit) }));
        }
      });
      body.append(tr);
    }
    // 装備の違い
    const slots = SLOTS.filter((slot) => entries.some((e) => e.set.equip[slot.id]));
    const differing = slots.filter((slot) => entries.some((e) => (e.set.equip[slot.id] || {}).id !== (entries[0].set.equip[slot.id] || {}).id));
    const listed = compareMode === 'diff' ? differing : slots;
    if (listed.length) {
      body.append(el('tr', { className: 'group' }, el('td', { colSpan: entries.length * 2, textContent: compareMode === 'diff' ? '装備の違い' : '装備' })));
      for (const slot of listed) {
        const tr = el('tr', { className: differing.includes(slot) ? 'diff' : 'eq' }, el('td', { className: 'slot', textContent: slot.ja }));
        entries.forEach((entry, k) => {
          const item = entry.set.equip[slot.id];
          tr.append(el('td', { className: 'item', textContent: item ? nameOf(item) : '—', title: item ? item.desc : '' }));
          if (k > 0) tr.append(el('td'));
        });
        body.append(tr);
      }
    }
    if (!any && !listed.length) body.append(el('tr', null, el('td', { colSpan: entries.length * 2, className: 'same', textContent: '違いはありません。' })));

    const modes = el('div', { className: 'cmp-tabs' });
    for (const [mode, label] of [['diff', '違うところだけ'], ['all', 'すべて']]) {
      const b = el('button', { type: 'button', className: 'copy' + (compareMode === mode ? ' on' : ''), textContent: label });
      b.addEventListener('click', () => {
        compareMode = mode;
        renderCompare();
      });
      modes.append(b);
    }
    const close = el('button', { type: 'button', className: 'copy', textContent: '比較を閉じる' });
    close.addEventListener('click', () => {
      compare = [];
      renderSaved();
      if (lastResult) renderResults();
      else renderCompare();
    });
    modes.append(el('span', { className: 'hint', textContent: '左を基準に、良くなった値は緑、悪くなった値は赤' }), close);
    box.append(el('div', { className: 'card compare-card' }, el('div', { className: 'card-head' }, el('h3', { textContent: '比較' })), modes,
      el('div', { className: 'cmp-wrap' }, el('table', { className: 'cmp' }, el('thead', null, head), body))));
  }

  // 左の欄: 保存したセットの一覧
  function renderSaved() {
    const box = $('saved');
    box.replaceChildren();
    for (const saved of savedSets()) {
      const check = el('input', { type: 'checkbox', checked: compare.includes(saved.id), title: '比較に並べる' });
      check.addEventListener('change', () => toggleCompare(saved.id));
      const names = SLOTS.map((slot) => getItem(saved.equip[slot.id])).filter(Boolean).map(nameOf).join(' / ');
      const load = el('button', { type: 'button', className: 'small', textContent: '読み込む', title: 'このセットを「固定する装備」に入れる (ジョブ・サポ・食事も合わせる)' });
      load.addEventListener('click', () => {
        Object.assign(state, { job: saved.who.job, sub: saved.who.sub, subLevel: saved.who.subLevel, food: saved.who.food, innate: Object.assign({}, saved.who.innate), fixed: Object.assign({}, saved.equip) });
        for (const [slot, id] of Object.entries(state.fixed)) if (!getItem(id)) delete state.fixed[slot];
        editing = null;
        changed();
      });
      const rename = el('button', { type: 'button', className: 'small', textContent: '名前' });
      rename.addEventListener('click', () => {
        const name = (prompt('セットの名前', saved.name) || '').trim();
        if (!name) return;
        saved.name = name;
        changed();
        renderCompare();
      });
      const remove = el('button', { type: 'button', className: 'small danger', textContent: '削除' });
      remove.addEventListener('click', () => {
        if (!confirm(`保存したセット「${saved.name}」を削除します。元に戻せません。`)) return;
        P.character(store).sets = savedSets().filter((x) => x !== saved);
        compare = compare.filter((k) => k !== saved.id);
        changed();
        renderCompare();
      });
      box.append(el('div', { className: 'saved-set' + (compare.includes(saved.id) ? ' picked' : '') },
        el('label', { className: 'saved-head' }, check, el('span', { className: 'saved-name', textContent: saved.name })),
        el('div', { className: 'saved-meta', textContent: whoText(saved.who) }),
        el('div', { className: 'saved-gear', textContent: names, title: names.replace(/ \/ /g, '\n') }),
        el('div', { className: 'saved-acts' }, load, rename, remove)));
    }
    if (!savedSets().length) box.append(el('p', { className: 'hint', textContent: 'まだありません。' }));
  }

  function renderResults() {
    const { req, result, context } = lastResult;
    const cards = $('cards');
    cards.replaceChildren();
    $('notice').replaceChildren();
    $('overview').replaceChildren();
    $('overview').hidden = true;
    renderCompare();
    $('results-title').textContent = `候補 ${result.sets.length} 件`;
    $('results-hint').textContent = result.sets.length ? 'マスを押すと、その装備の説明と「固定」「除外」が出ます' : '';
    if (!result.sets.length) {
      cards.append(el('p', { className: 'empty', textContent: '候補を作れませんでした。' }));
      return;
    }
    if (!result.exact && result.reached) {
      $('notice').append(el('p', { className: 'warn', textContent: '計算に時間がかかるため、途中で打ち切りました。ここに出ている候補は目標を満たしますが、いちばん良い組み合わせとは限りません。部位を固定するか、目標を減らすと確実になります。' }));
    }
    if (!result.reached) {
      $('notice').append(el('p', { className: 'warn', textContent: '目標のすべてには届きませんでした。いちばん近い組み合わせを表示しています。目標を下げるか、固定・除外・装備の範囲を緩めてください。' }));
    }

    // 達成度と寄与を出す列: 目標のステータスと、伸ばすステータス
    const columns = req.targets.map((t) => ({ stat: data.stats[t.i], goal: t.goal }));
    for (const m of req.objective === 'max' ? req.maximize : []) if (!columns.some((c) => c.stat.i === m.i)) columns.push({ stat: data.stats[m.i], weight: m.weight });
    const wanted = new Set(columns.map((c) => c.stat.i));
    // 目標や伸ばすステータスの向きに当たる上限。超えた分は効果が無いので、比べるときは上限までで見る
    const capFor = (c) => capOf(c.stat, c.goal != null ? directionOf(c.stat, c.goal) : c.stat.neg ? -1 : 1);
    const lower = (c) => (c.goal != null ? c.goal < 0 : !!c.stat.neg); // 小さいほど良いか
    const effective = (c, value) => {
      const cap = capFor(c);
      return beyond(cap, value) ? cap.value : value;
    };
    // 振り数: 目標にしている側と、武器が決まっている側
    const swingColumns = TP_KINDS.filter((kind) => tpValues(kind.id, result.sets[0], context)).map((kind) => ({ kind, goal: state.tp[kind.id].goal }));
    const swingsOf = (kind, set) => (tpValues(kind.id, set, context) || {}).swings;
    const differing = (set) => SLOTS.filter((slot) => (set.equip[slot.id] || {}).id !== (result.sets[0].equip[slot.id] || {}).id);

    // 見比べの表: 候補を 1 行ずつ。列ごとにいちばん良い値に色を付け、候補 1 と違う部位を言葉で出す
    if (result.sets.length > 1) {
      const head = el('tr', null, el('th', { textContent: '見比べ' }));
      for (const c of columns) head.append(el('th', null, c.stat.k, el('small', { textContent: c.goal != null ? `${c.goal < 0 ? '≤' : '≥'} ${signed(c.goal, c.stat.u)}` : `伸ばす ×${c.weight}` })));
      for (const c of swingColumns) head.append(el('th', null, c.kind.label, el('small', { textContent: c.goal != null ? `≤ ${c.goal} 振り` : '振り数' })));
      head.append(el('th', { className: 'changed', textContent: '候補 1 と違う部位' }), el('th'));
      const bestOf = (values, low) => {
        const usable = values.filter((v) => Number.isFinite(v));
        if (!usable.length || usable.every((v) => v === usable[0])) return null; // みな同じなら色を付けない
        return low ? Math.min(...usable) : Math.max(...usable);
      };
      const best = columns.map((c) => bestOf(result.sets.map((set) => effective(c, set.totals.get(c.stat.i) || 0)), lower(c)));
      const bestSwings = swingColumns.map((c) => bestOf(result.sets.map((set) => swingsOf(c.kind, set)), true));
      const body = el('tbody');
      result.sets.forEach((set, index) => {
        const tr = el('tr', { title: 'この候補へ移動' }, el('td', { textContent: '候補 ' + (index + 1) }));
        columns.forEach((c, k) => {
          const value = set.totals.get(c.stat.i) || 0;
          const short = c.goal != null && (c.goal < 0 ? value > c.goal : value < c.goal);
          tr.append(el('td', { className: short ? 'short' : effective(c, value) === best[k] ? 'best' : '', textContent: signed(value, c.stat.u) }));
        });
        swingColumns.forEach((c, k) => {
          const swings = swingsOf(c.kind, set);
          const short = c.goal != null && !(swings <= c.goal);
          tr.append(el('td', { className: short ? 'short' : swings === bestSwings[k] ? 'best' : '', textContent: Number.isFinite(swings) ? `${swings} 振り` : '—' }));
        });
        tr.append(el('td', { className: 'changed', textContent: index ? differing(set).map((slot) => slot.ja).join('・') || '同じ' : '—' }),
          el('td', { className: 'go', textContent: '見る ↓' }));
        tr.addEventListener('click', () => document.getElementById('candidate-' + index)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        body.append(tr);
      });
      $('overview').append(el('div', { className: 'panel overview' }, el('table', { className: 'ov' }, el('thead', null, head), body)));
      $('overview').hidden = false;
    }

    result.sets.forEach((set, index) => {
      const auto = SLOTS.filter((s) => set.equip[s.id] && !req.fixed[s.id]).length;
      const free = SLOTS.filter((s) => !s.weapon && !set.equip[s.id]).length;
      const copy = el('button', { type: 'button', className: 'copy', textContent: 'テキストでコピー', title: '部位と装備名の一覧をコピーする' });
      copy.addEventListener('click', () => navigator.clipboard.writeText(setText(set)).then(
        () => (copy.textContent = 'コピーしました'),
        () => (copy.textContent = 'コピーできませんでした')));

      // 比較に並べる / 名前を付けて保存する
      const key = 'c' + index;
      const compareButton = el('button', { type: 'button', className: 'copy stats-toggle' + (compare.includes(key) ? ' on' : ''), textContent: compare.includes(key) ? '比較中' : '比較', title: 'この候補を比較に並べる (保存したセットと合わせて 3 つまで)' });
      compareButton.addEventListener('click', () => toggleCompare(key));
      const saveButton = el('button', { type: 'button', className: 'copy' + (saving === index ? ' on' : ''), textContent: '保存', title: 'この候補に名前を付けて保存する' });
      saveButton.addEventListener('click', () => {
        saving = saving === index ? null : index;
        renderResults();
        document.querySelector('.save-box input')?.focus();
      });
      const nameInput = el('input', { type: 'text', value: `${data.jobs.find((j) => j.id === lastResult.who.job).ja} ${savedSets().length + 1}`, spellcheck: false });
      const confirmSave = el('button', { type: 'button', className: 'primary small-primary', textContent: 'このセットを保存' });
      const doSave = () => {
        const name = nameInput.value.trim();
        if (!name) return;
        saveSet(name, lastResult.who, set.equip);
        saving = null;
        changed();
        $('status').textContent = `「${name}」を保存しました。`;
        renderResults();
      };
      confirmSave.addEventListener('click', doSave);
      nameInput.addEventListener('keydown', (e) => {
        if (!e.isComposing && e.key === 'Enter') doSave();
      });
      const saveBox = el('div', { className: 'save-box' }, el('span', { textContent: '名前' }), nameInput, confirmSave);

      // 目標の達成: 届いていれば 1 行の札。届かないものだけ、棒で不足を見せる
      const checks = el('div', { className: 'checks' });
      const growing = []; // 伸ばすステータスは、目標のあとに並べる
      for (const c of columns) {
        const value = set.totals.get(c.stat.i) || 0;
        const cap = capFor(c);
        const over = beyond(cap, value); // 上限を超えて積んでいる分は効果が無い
        const overNote = over ? el('span', { title: `${cap.note}。超えた分は効果がありません`, textContent: `上限 (合計は ${signed(value, c.stat.u)})` }) : null;
        const shown = el('b', { textContent: signed(over ? cap.value : value, c.stat.u) });
        if (c.goal == null) {
          growing.push(el('span', { className: 'chk grow', title: '伸ばすステータス' }, c.stat.k + ' ', shown, overNote));
          continue;
        }
        const ok = c.goal < 0 ? value <= c.goal : value >= c.goal;
        const fill = el('i');
        fill.style.width = Math.max(0, Math.min(100, (value / c.goal) * 100)) + '%';
        checks.append(el('span', { className: 'chk' + (ok ? '' : ' short') }, c.stat.k + ' ', shown, el('span', { textContent: '/ ' + signed(c.goal, c.stat.u) }), overNote,
          ok ? null : el('span', { className: 'bar' }, fill),
          ok ? null : el('span', { textContent: `あと ${Math.abs(Math.round((c.goal - value) * 100) / 100)}${c.stat.u || ''}` })));
      }
      for (const c of swingColumns) {
        if (c.goal == null) continue;
        const swings = swingsOf(c.kind, set);
        checks.append(el('span', { className: 'chk' + (swings <= c.goal ? '' : ' short') }, c.kind.label + ' ',
          el('b', { textContent: Number.isFinite(swings) ? `${swings} 振り` : '届かない' }), el('span', { textContent: `/ ${c.goal} 振り` })));
      }
      checks.append(...growing);
      // 候補 1 と違うマスに印を付ける
      const changedSlots = index ? differing(set) : [];

      const grid = el('div', { className: 'grid' });
      for (const slot of SLOTS) {
        const item = set.equip[slot.id];
        const gain = item ? columns.map((c) => {
          const v = item.m.get(c.stat.i);
          return v ? shortName(c.stat.k) + signed(v) : '';
        }).filter(Boolean).join(' ') : '';
        const isSelected = selected && selected.set === index && selected.slot === slot.id;
        const c = cell(slot, item, { fixed: !!req.fixed[slot.id], gain, selected: isSelected, diff: changedSlots.includes(slot), empty: slot.weapon ? '未設定' : '自由' });
        if (item) c.addEventListener('click', () => {
          selected = isSelected ? null : { set: index, slot: slot.id };
          renderResults();
        });
        grid.append(c);
      }

      const bonus = set.bonuses.map((b) => `${data.sets[b.index].label} ${b.count} 部位`).join('、');
      const card = el('div', { className: 'card', id: 'candidate-' + index },
        el('div', { className: 'card-head' },
          el('h3', { textContent: '候補 ' + (index + 1) }),
          el('span', { className: 'used' }, `${auto} 部位を自動で選択` + (free ? `・自由枠 ${free}` : ''),
            changedSlots.length ? el('b', { textContent: `・候補 1 と ${changedSlots.length} 部位が違う` }) : null),
          compareButton, saveButton, copy),
        saving === index ? saveBox : null,
        checks,
        bonus ? el('div', { className: 'bonus', textContent: `セット効果: ${bonus} (合計に含む)` }) : null,
        // 装備欄の左に、基本ステータスの枠を並べる
        el('div', { className: 'top' }, statSheet(set, context), grid));

      if (selected && selected.set === index) {
        const slot = SLOTS.find((s) => s.id === selected.slot);
        const item = set.equip[slot.id];
        const info = el('div', null,
          el('div', { className: 'title' }, `${slot.ja}: ${nameOf(item)}`, el('span', { className: 'en', textContent: item.en })),
          el('pre', { textContent: item.desc }),
          item.aug ? el('div', { className: 'aug', textContent: 'オーグメント: ' + item.aug.replace(/\s+/g, ' ') }) : null,
          manualField(item));
        const acts = el('div', { className: 'acts' });
        if (req.fixed[slot.id]) {
          const release = el('button', { type: 'button', className: 'plain', textContent: '固定を解除' });
          release.addEventListener('click', () => {
            delete state.fixed[slot.id];
            changed();
          });
          acts.append(release);
        } else {
          const keep = el('button', { type: 'button', textContent: 'この装備で固定' });
          keep.addEventListener('click', () => fix(slot.id, item.id));
          const drop = el('button', { type: 'button', textContent: '候補から除外', title: '持っていない装備など' });
          drop.addEventListener('click', () => {
            if (!profile().excluded.includes(item.id)) profile().excluded.push(item.id);
            changed();
          });
          acts.append(keep, drop);
        }
        card.append(el('div', { className: 'detail' }, info, acts));
      }
      // 攻撃・命中と TP を 1 段に並べる
      const tp = tpBoxes(set, context);
      card.append(el('div', { className: 'combat' + (tp ? ' with-tp' : '') }, attackTiles(set, req, context), tp), statsPanel(set, req, wanted));
      cards.append(card);
    });
  }

  // ---- 初期化 ----

  function init() {
    $('meta').textContent = `装備 ${data.items.length} 件 / データ ${data.generated}`;
    for (const job of data.jobs) $('job').append(el('option', { value: job.id, textContent: job.ja }));
    for (const job of data.jobs) $('sub').append(el('option', { value: job.id, textContent: job.ja }));
    for (const group of new Set(data.foods.map((f) => f.group))) {
      $('food').append(el('optgroup', { label: group }, ...data.foods.filter((f) => f.group === group).map((f) => el('option', { value: f.ja, textContent: f.ja }))));
    }
    for (const source of INNATE) {
      const toggle = el('button', { type: 'button', className: 'toggle', id: 'innate-' + source.id, title: source.title || '' });
      toggle.addEventListener('click', () => {
        state.innate[source.id] = !state.innate[source.id];
        changed();
      });
      $('innate').append(toggle);
    }
    load();
    store = P.load(localStorage, legacy);
    P.save(localStorage, store);
    window.VanaAugment.apply(db, P.character(store).augments);
    initMenu();

    $('job').addEventListener('change', () => {
      state.job = Number($('job').value);
      // ジョブを変えたら、装備できなくなった固定は外す
      for (const [slot, id] of Object.entries(state.fixed)) if (!usable(getItem(id))) delete state.fixed[slot];
      changed();
    });
    $('food').addEventListener('change', () => {
      state.food = $('food').value;
      changed();
    });
    $('sub').addEventListener('change', () => {
      state.sub = Number($('sub').value);
      changed();
    });
    $('sub-level').addEventListener('change', () => {
      // 空にすると、設定のマスターレベルから決まる値に戻る
      const typed = $('sub-level').value.trim();
      state.subLevel = typed === '' ? null : Math.max(1, Math.min(99, Math.round(Number(typed))));
      changed();
    });
    $('sub-level').title = 'サポートジョブのレベル。空にすると、設定の「ジョブの育成」に入れたマスターレベルから決まる値 (49 + マスターレベル ÷ 5、最大 59) を使います';
    $('chara').addEventListener('change', () => {
      store.activeChar = $('chara').value;
      // キャラクターごとに、手入力のオーグメントが違う
      window.VanaAugment.apply(db, P.character(store).augments);
      compare = compare.filter((k) => k.startsWith('c'));
      changed();
      renderCompare();
    });
    $('profile').addEventListener('change', () => {
      P.character(store).active = $('profile').value;
      changed();
    });
    $('add').addEventListener('click', () => openMenu($('goal-adder'), (key) => {
      state.targets.push({ k: key, goal: null, base: null });
      changed();
      // 追加したらすぐ目標値を打てるようにする
      [...$('goals').querySelectorAll('.goal')].find((g) => g.dataset.key === key)?.querySelector('input')?.focus();
    }, (key) => state.targets.some((t) => t.k === key), (kindId) => {
      state.tp[kindId].goal = 5;
      changed();
      [...$('goals').querySelectorAll('.goal')].find((g) => g.dataset.key === 'swings-' + kindId)?.querySelector('input')?.focus();
    }));
    $('maximize').addEventListener('click', () => openMenu($('maximize-adder'), (key) => {
      state.maximize.push({ k: key, weight: 1 });
      changed();
    }, (key) => state.maximize.some((m) => m.k === key)));
    for (const b of $('objective').children) {
      b.addEventListener('click', () => {
        state.objective = b.dataset.value;
        changed();
      });
    }
    $('fixed-clear').addEventListener('click', () => {
      state.fixed = {};
      editing = null;
      changed();
    });
    $('excluded-clear').addEventListener('click', () => {
      profile().excluded = [];
      changed();
    });
    $('solve').addEventListener('click', run);
    $('avoid-minus').addEventListener('change', () => {
      state.avoidMinus = $('avoid-minus').checked;
      changed();
    });
    $('save-fixed').addEventListener('click', () => {
      const equip = {};
      for (const [slot, id] of Object.entries(state.fixed)) equip[slot] = getItem(id);
      if (!state.job || !Object.values(equip).some(Boolean)) {
        $('status').textContent = 'ジョブを選び、「固定する装備」に装備を入れてから保存してください。';
        return;
      }
      const name = (prompt('セットの名前', `${data.jobs.find((j) => j.id === state.job).ja} ${savedSets().length + 1}`) || '').trim();
      if (!name) return;
      saveSet(name, currentWho(), equip);
      changed();
      $('status').textContent = `「${name}」を保存しました。`;
    });
    $('share').addEventListener('click', () => {
      const url = location.href.split('#')[0] + '#' + encodeURIComponent(JSON.stringify(state));
      navigator.clipboard.writeText(url).then(
        () => ($('status').textContent = '条件の URL をコピーしました。'),
        () => ($('status').textContent = 'コピーできませんでした。'));
    });

    render();
    $('cards').append(el('p', { className: 'empty', textContent: 'ジョブと目標を選んで「セットを探す」を押すと、目標を満たす装備セットの候補を並べます。' }));
    // 数値を打った直後 (欄から出る前) にページを更新したり閉じたりしても、打った値を保存する。
    // 欄の値は、欄から出たときの change で条件に入るので、ページを離れる前にそれを起こす
    const flush = () => {
      const field = document.activeElement;
      if (field && field.matches('.conditions input, .conditions select')) field.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    if (fromUrl) {
      // 「条件の URL」で開いた条件も保存する (保存しないと、ページを更新したときに前の条件に戻ってしまう)
      persist();
      history.replaceState(null, '', ' ');
      run();
    }
  }

  init();
})();
