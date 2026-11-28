// 「セットを組む」の画面。計算は solver.js、ステータスの候補と分類は search.js にある。
(function () {
  'use strict';

  const { prepare, suggest, fold, categorize, categoryOf, CATEGORY_ORDER, listedOrder } = window.VanaSearch;
  const { SLOTS, solve } = window.VanaSolver;
  const P = window.VanaProfiles;
  const db = prepare(window.VANARMORY_DATA);
  const data = db.data;
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  // 装備の引き方や、装備以外の値・攻撃・命中の計算は sets.js (ダメージの画面と共通)
  const { capeId, NO_PICKS, myCapes, capeName, isCapeName, makeCape, BARE, withBare, getItem, ownedReset, ownedNow, supportTraits, addTraits, outsideFor, contextFor, WHITE_SOURCES, innateOf, sheetValues, combatValues, totalOf, delayOf, skillKind, tpSetup } = window.VanaSets.create(db, P, () => store);

  // 合計値の目標 (命中 1400 以上 など)。ゲーム内のステータス画面に出る値で、スキルや DEX の分を含む。
  // 装備のステータスではないので、この画面でだけ、目標に選べるステータスとして足す (武器を固定すると使える)
  const TOTALS = [
    { k: '命中 (合計)', flat: '命中', ranged: false, field: 'accuracy', category: '物理攻撃' },
    { k: '攻撃 (合計)', flat: '攻', ranged: false, field: 'attack', category: '物理攻撃' },
    { k: '飛命 (合計)', flat: '飛命', ranged: true, field: 'accuracy', category: '遠隔攻撃' },
    { k: '飛攻 (合計)', flat: '飛攻', ranged: true, field: 'attack', category: '遠隔攻撃' },
  ];
  for (const total of TOTALS) {
    const stat = { k: total.k, n: 0, num: 1, neg: 0, u: '', i: data.stats.length, total, search: '' };
    data.stats.push(stat);
    db.statByKey.set(total.k, stat);
  }

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
    // 登録していない構成には made の印を付ける (同じ良さなら、実際にある装備のほうを選ばせる)
    return combos.filter((c) => c.some((u) => u >= 0)).map((c) => makeCape(job, c)).filter(Boolean).map((cape) => Object.assign(cape, { made: !capeName(job, cape.picks) }));
  }

  // メインに武器を持たない「素手」。固定する装備のメインに入れられる (格闘の武器として扱う)
  // いまの設定での使い方。読み込んでいなければ null。
  //   augs: 持っている装備を、実物のオーグメントの候補に置き換える  only: 持っている装備だけを使う
  const ownedMode = () => {
    const mine = ownedNow();
    return mine ? { mine, augs: profile().ownedAugs !== false, only: !!profile().ownedOnly } : null;
  };
  // 装備の、元になるアイテム番号 (マントは、何も付けていないマントの番号)
  const baseOf = (item) => (item.group === 'cape' && item.capePlain != null ? item.capePlain : window.VanaOwned.baseOf(item));
  const isOwned = (item) => { const mine = ownedNow(); return !!mine && (item.owned || mine.baseIds.has(baseOf(item))); };

  const nameOf = (item) => item.ja + (item.rank || item.tag ? ` [${item.rank || item.tag}]` : '') + (item.manual ? ' ✎' : '');

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
    tieType: '', // 同じ良さのときに使う重みの型。空なら、設定でそのジョブに決めた型
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
  let viewing = null; // 左の欄でステータスを開いているもの。'fixed' は固定中の装備、's…' は保存したセット
  let saving = null; // 名前を入れて保存しようとしている候補の番号
  const COMPARE_MAX = 3;
  let activePreset = ''; // 最後に読み込んだ (か保存した) 条件の id
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

  // いまの画面の条件 (ジョブ・サポ・食事・装備以外の入・切)。保存したセットは、保存したときのこれを持っている
  const currentWho = () => ({
    job: state.job, sub: state.sub === state.job ? 0 : state.sub, subLevel: subLevel(), food: state.food,
    innate: Object.assign({}, state.innate),
    // 合計値の目標に足した支援の分は、元のステータス (命中 (合計) なら命中) に足す
    manual: state.targets.filter((t) => t.base).map((t) => [(db.statByKey.get(t.k).total ? db.statByKey.get(db.statByKey.get(t.k).total.flat) : db.statByKey.get(t.k)).i, t.base]),
  });

  // 装備以外で得ている値。base は合計 (ステータスの番号 -> 値)、parts は内訳 (表示用)
  const outside = () => outsideFor(currentWho());
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
    // 合計値 (命中 (合計) など) も、目標に選べる
    if (menuSwings) {
      $('stats').prepend(...TOTALS.filter((total) => total.category === category.name).map((total) => {
        const b = statButton(db.statByKey.get(total.k));
        b.title = 'ステータス画面に出る合計の値 (スキルや DEX などの分を含む)。武器を固定すると使えます';
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
    // 合計値 (命中 (合計) など) は、目標を選ぶときだけ出す
    if (menuSwings) $('stats').prepend(...TOTALS.filter((total) => fold(total.k).includes(fold(query))).map((total) => statButton(db.statByKey.get(total.k))));
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

  // ---- 条件の保存 ----
  // 保存するのは、固定する装備を除いた条件 (ジョブ・サポ・装備以外・目標・WS後TP・選び方・同点のときの型)
  const PRESET_KEYS = ['job', 'sub', 'subLevel', 'targets', 'objective', 'maximize', 'avoidMinus', 'food', 'innate', 'tp', 'tieType'];
  const snapshot = () => JSON.parse(JSON.stringify(Object.fromEntries(PRESET_KEYS.map((key) => [key, state[key]]))));
  const presetSummary = (cond) => {
    const job = (id) => (data.jobs.find((j) => j.id === id) || {}).ja || '';
    const goals = (cond.targets || []).filter((t) => t.goal).map((t) => `${t.k} ${t.goal}`);
    for (const kind of TP_KINDS) if (cond.tp && cond.tp[kind.id] && cond.tp[kind.id].goal != null) goals.push(`${kind.label} ${cond.tp[kind.id].goal} 振り`);
    const grow = cond.objective === 'max' ? (cond.maximize || []).map((m) => m.k) : [];
    return `${job(cond.job)}${cond.sub ? ' / ' + job(cond.sub) : ''}\n目標: ${goals.join('、') || 'なし'}` + (grow.length ? `\n伸ばす: ${grow.join('、')}` : '\n少ない部位で満たす');
  };
  function renderPresets() {
    const list = P.character(store).searches;
    const now = JSON.stringify(snapshot());
    const active = list.find((p) => p.id === activePreset);
    const edited = !!active && JSON.stringify(active.cond) !== now;
    const chips = list.map((preset) => {
      const b = el('button', { type: 'button', className: 'preset' + (preset === active ? ' on' : ''), title: presetSummary(preset.cond) + '\n(押すと、この条件を読み込む)' },
        preset.name, preset === active && edited ? el('span', { className: 'edited', textContent: ' 変更あり', title: '読み込んだあとで条件を変えています' }) : null);
      b.addEventListener('click', () => {
        Object.assign(state, JSON.parse(JSON.stringify(preset.cond)));
        // ジョブが変わって装備できなくなった固定は外す
        for (const [slot, id] of Object.entries(state.fixed)) if (!getItem(id) || !usable(getItem(id))) delete state.fixed[slot];
        activePreset = preset.id;
        changed();
      });
      return b;
    });
    const act = (label, title, onClick) => {
      const b = el('button', { type: 'button', className: 'ghost', textContent: label, title });
      b.addEventListener('click', onClick);
      return b;
    };
    const save = act('＋ いまの条件を保存', 'いまの条件に名前を付けて保存する (固定する装備は含まない)', () => {
      if (!state.job) return void ($('status').textContent = 'ジョブを選んでから保存してください。');
      const jobName = data.jobs.find((j) => j.id === state.job).ja;
      const name = (prompt('条件の名前', `${jobName} ${list.filter((p) => p.cond.job === state.job).length + 1}`) || '').trim();
      if (!name) return;
      const preset = { id: P.newId(), name, cond: snapshot() };
      list.push(preset);
      activePreset = preset.id;
      changed();
      $('status').textContent = `条件「${name}」を保存しました。`;
    });
    const tools = active ? [
      edited ? act('上書き', `「${active.name}」を、いまの条件で上書きする`, () => {
        active.cond = snapshot();
        changed();
        $('status').textContent = `条件「${active.name}」を上書きしました。`;
      }) : null,
      act('名前', `「${active.name}」の名前を変える`, () => {
        const name = (prompt('条件の名前', active.name) || '').trim();
        if (!name) return;
        active.name = name;
        changed();
      }),
      act('削除', `「${active.name}」を削除する`, () => {
        if (!confirm(`保存した条件「${active.name}」を削除します。元に戻せません。`)) return;
        P.character(store).searches = list.filter((p) => p !== active);
        activePreset = '';
        changed();
      }),
    ] : [];
    const empty = list.length ? [] : [el('span', { className: 'hint', textContent: 'まだありません' })];
    $('presets').replaceChildren(...chips, ...empty, el('span', { className: 'preset-tools' }, ...tools.filter(Boolean), save));
  }

  function renderConditions() {
    renderPresets();
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
      const input = el('input', { type: 'number', step: 'any', placeholder: stat.total ? '1400' : stat.neg ? '-40' : '50', title: below ? 'この値以下にする' : 'この値以上にする', value: target.goal ?? '' });
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
      if (stat.total) {
        // 合計値の目標: 固定した装備だけでの値を出す。武器が無いときは、その旨を出す
        const made = totalTarget(stat, 0);
        notes.push(made.error
          ? el('span', { className: 'caution', textContent: `${stat.total.ranged ? 'レンジ' : 'メイン'}の武器を固定すると使えます` })
          : el('span', { title: 'スキル・DEX などの分と、装備以外・固定した装備の分を含む、ステータス画面の値' }, '固定した装備で ', el('b', { textContent: number(made.now) }), ` (${made.kind.ja})`));
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

    // 同じ良さのときの重み: いま使う型を見せる。型はここで選び直せる (重みの中身は設定で変える)
    const weights = P.character(store).weights;
    const usual = state.job ? weights.jobs[state.job] || 'none' : 'none';
    const typeSelect = el('select', { title: '同じ良さのときに使う重みの型。初めは、設定でこのジョブに決めた型' },
      ...weights.types.map((t) => el('option', { value: t.id, textContent: t.name + (t.id === usual ? ' (設定)' : '') })),
      el('option', { value: 'none', textContent: '使わない' + (usual === 'none' ? ' (設定)' : '') }));
    typeSelect.value = state.tieType || usual;
    typeSelect.disabled = !state.job;
    typeSelect.addEventListener('change', () => {
      state.tieType = typeSelect.value === usual ? '' : typeSelect.value;
      changed();
    });
    const type = tieType();
    $('tie-row').replaceChildren(typeSelect,
      el('span', { className: 'hint', textContent: !state.job ? 'ジョブを選ぶと決まります' : type ? type.stats.filter((s) => s.w > 0).map((s) => `${s.k} ×${s.w}`).join('・') || '重みが入っていません' : '重みを使いません' }),
      el('a', { className: 'link', href: 'settings.html', textContent: '設定で変える' }));

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
    // 持っている装備を実物のオーグメントで計算するときは、その候補も探す (持っているものを先に出す)
    const own = ownedMode();
    const all = own && own.augs ? own.mine.items.concat(data.items) : data.items;
    const found = all.filter((i) => i.slots & slot.mask && usable(i) && (!IL119_ONLY.has(slot.id) || i.il === 119) && i.names.includes(q));
    // 同じ名前の段階違いは、強いほう (Ｄ の大きいほう) を先に出す
    const damage = (item) => Number(/Ｄ(\d+)/.exec(item.desc)?.[1] ?? 0);
    found.sort((a, b) => (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || b.il - a.il || b.lv - a.lv || a.ja.localeCompare(b.ja, 'ja') || damage(b) - damage(a) || (b.rp || 0) - (a.rp || 0));
    return found.slice(0, 40);
  }

  // ---- いつもの装備 (ジョブごとに、いつも固定する装備) ----
  // state.fixed には、いつもの装備も今回だけの固定も入っている。いつもの装備かどうかは、キャラクターの pins と一致するかで見分ける。
  // いつもの装備は、ジョブを変えると入れ替わり、「解除」やセットの読み込みでは消えない
  const pinsOf = (job) => {
    const c = P.character(store);
    if (!c.pins) c.pins = {};
    if (!job) return {};
    if (!c.pins[job]) c.pins[job] = {};
    return c.pins[job];
  };
  const isPinned = (slotId) => !!state.job && state.fixed[slotId] != null && pinsOf(state.job)[slotId] === state.fixed[slotId];
  // いまのジョブのいつもの装備を、固定に入れる
  function applyPins() {
    if (!state.job) return;
    for (const [slot, id] of Object.entries(pinsOf(state.job))) {
      if (getItem(id) && usable(getItem(id))) state.fixed[slot] = id;
      else delete pinsOf(state.job)[slot];
    }
  }
  // いまのジョブのいつもの装備を、固定から抜く (ジョブを変える前に呼ぶ)
  function dropPins() {
    for (const slot of Object.keys(pinsOf(state.job))) if (isPinned(slot)) delete state.fixed[slot];
  }
  // 固定を入れ替える・外す。いつもの装備だった部位は、いつもの装備のまま中身を入れ替える (id が無ければ外す)
  function setFixed(slotId, id, pin) {
    const pinned = pin != null ? pin : isPinned(slotId);
    if (id == null) delete state.fixed[slotId];
    else state.fixed[slotId] = id;
    if (pinned && id != null && state.job) pinsOf(state.job)[slotId] = id;
    else if (state.job) delete pinsOf(state.job)[slotId];
  }
  const ARMOR = ['head', 'body', 'hands', 'legs', 'feet'];
  const ACCESSORIES = ['neck', 'ear1', 'ear2', 'ring1', 'ring2', 'back', 'waist'];
  const WEAPONS = ['main', 'sub', 'range', 'ammo'];
  let pinMode = false; // 装備を選ぶ欄で、「いつも固定」を選んでいるか

  function fix(slotId, picked) {
    // ジョブマントを名前で選んだときは、何も付けていない構成として固定する (あとで項目を選べる)
    const chosen = getItem(picked);
    const capeJob = isCapeName(chosen) ? Number(Object.keys(data.capes.names).find((job) => data.capes.names[job] === chosen.ja)) : 0;
    const id = capeJob ? capeId(capeJob, NO_PICKS()) : picked;
    const keepOpen = !!capeJob;
    // 耳・指で、同じ装備をもう片方に固定しているときは付け替える
    for (const [other, otherId] of Object.entries(state.fixed)) if (otherId === id) setFixed(other, null);
    // 同時に持てない装備 (報酬リングなど) を固定していたら、そちらを外す
    const only = getItem(id)?.only;
    if (only != null) {
      for (const [other, otherId] of Object.entries(state.fixed)) if (other !== slotId && getItem(otherId)?.only === only) setFixed(other, null);
    }
    setFixed(slotId, id, pinMode);
    editing = keepOpen ? slotId : null;
    changed();
  }

  // いまの目標と伸ばすステータス (ステータスの番号 -> 向き)。マントの項目に「目標」の印を付けるのに使う
  // 目標のステータスに効くステータスの番号。合計値の目標は、元になるステータス (命中・DEX など) に読み替える
  function wantedKeys(key) {
    const stat = db.statByKey.get(key);
    if (!stat.total) return [stat.i];
    const { flat, ranged, field } = stat.total;
    return [flat, field === 'attack' ? 'STR' : ranged ? 'AGI' : 'DEX'].map((k) => db.statByKey.get(k).i);
  }
  function wantedNow() {
    const wanted = new Map();
    for (const t of state.targets) if (t.goal) for (const i of wantedKeys(t.k)) wanted.set(i, t.goal < 0 ? -1 : 1);
    if (swingTargets().some((g) => !g.error)) wanted.set(db.statByKey.get('ストアTP').i, 1);
    for (const m of state.objective === 'max' ? state.maximize : []) {
      const stat = db.statByKey.get(m.k);
      if (m.weight > 0 && !wanted.has(stat.i)) wanted.set(stat.i, stat.neg ? -1 : 1);
    }
    return wanted;
  }

  // ジョブマントの構成を選ぶ欄。アイテム 5 種 (糸・金粉・染料・水油・樹脂) につき 1 項目ずつ。
  // onPick(新しい構成) は、選び直すたびに呼ばれる
  function capeEditor(cape, onPick, wide) {
    const wanted = wantedNow();
    const useful = (option) => {
      for (let k = 0; k < option.s.length; k += 2) {
        const sign = wanted.get(option.s[k]);
        if (sign && sign * option.s[k + 1] > 0) return true;
      }
      return false;
    };
    const box = el('div', { className: 'cape' + (wide ? ' wide' : '') });
    data.capes.augments.forEach((group, g) => {
      // 目標に効く項目を上に寄せる
      const order = group.options.map((option, index) => ({ option, index, hit: useful(option) })).sort((a, b) => b.hit - a.hit || a.index - b.index);
      const select = el('select', { className: cape.picks[g] < 0 ? 'none' : '' },
        el('option', { value: -1, textContent: 'なし' }),
        ...order.map(({ option, index, hit }) => el('option', { value: index, textContent: option.text + (hit ? '　← 目標' : '') })));
      select.value = cape.picks[g];
      select.addEventListener('change', () => {
        const picks = cape.picks.slice();
        picks[g] = Number(select.value);
        onPick(picks);
      });
      const picked = group.options[cape.picks[g]];
      box.append(el('label', { className: 'cape-row' + (picked && useful(picked) ? ' hit' : '') }, group.item, select));
    });
    return el('div', null, box, el('div', { className: 'cape-sum' }, '合計: ', el('b', { textContent: cape.aug || '(何も付けていない)' })));
  }

  // その構成を、名前を付けて登録する / 登録を消す
  function capeRegister(cape, after) {
    const list = P.character(store).capes;
    const found = list.find((c) => c.job === cape.capeJob && c.picks.join() === cape.picks.join());
    if (found) {
      const remove = el('button', { type: 'button', className: 'ghost', textContent: '登録を消す' });
      remove.addEventListener('click', () => {
        P.character(store).capes = list.filter((c) => c !== found);
        after();
      });
      return el('div', { className: 'cape-acts' }, el('span', { className: 'hint', textContent: `「${found.name}」として登録済み` }), remove);
    }
    const add = el('button', { type: 'button', className: 'ghost', textContent: 'この構成を登録', title: '名前を付けて登録する。登録したマントがあるジョブでは、自動で選ぶときに、登録した中から選びます' });
    add.addEventListener('click', () => {
      if (!cape.picks.some((pick) => pick >= 0)) return void ($('status').textContent = '項目を 1 つ以上選んでから登録してください。');
      const name = (prompt('マントの名前 (例: TP用、WS用)', '') || '').trim();
      if (!name) return;
      list.push({ id: P.newId(), job: cape.capeJob, name, picks: cape.picks.slice() });
      after();
    });
    return el('div', { className: 'cape-acts' }, add);
  }

  function cell(slot, item, options) {
    const c = el('div', { className: 'cell' + (slot.weapon ? ' weapon' : '') + (options.fixed ? ' fixed' : '') + (item ? '' : slot.weapon ? ' off' : ' free') + (options.selected ? ' sel' : '') + (options.diff ? ' diff' : '') });
    c.append(el('div', { className: 'slot', textContent: slot.ja }));
    // 空のマスは、言葉 (未設定・自由) があればそれを、無ければ部位の名前だけを出す
    if (item || options.empty) c.append(el('div', { className: 'name', textContent: item ? nameOf(item) : options.empty }));
    else c.classList.add('blank');
    if (item && options.gain) c.append(el('div', { className: 'gain', textContent: options.gain }));
    // 持っている装備を読み込んであるときは、持っていない装備に印を付ける (素手と、固定しただけの武器にも付く)
    if (item && item.id !== 'bare' && ownedNow() && !isOwned(item)) c.append(el('div', { className: 'unowned', textContent: '未所持' }));
    if (item) c.title = item.desc + (item.aug ? '\nオーグメント: ' + item.aug : '') + (item.manual ? '\n手入力のオーグメント: ' + item.manual : '');
    return c;
  }

  function renderSide() {
    const grid = $('mine');
    grid.replaceChildren();
    for (const slot of SLOTS) {
      const item = getItem(state.fixed[slot.id]);
      const c = cell(slot, item, { fixed: !!item, selected: editing === slot.id, empty: slot.weapon ? '未設定' : '' });
      if (isPinned(slot.id)) { c.classList.remove('fixed'); c.classList.add('pinned'); c.title = `いつもの装備 (${data.jobs.find((j) => j.id === state.job).ja})`; }
      if (!item && !slot.weapon) c.title = '空 = 自動で選ぶ。押すと固定できる';
      c.dataset.slot = slot.id;
      c.addEventListener('click', () => {
        editing = editing === slot.id ? null : slot.id;
        pinMode = isPinned(slot.id);
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
      const title = el('div', { className: 'title' }, item ? el('span', null, `${slot.ja}: ${nameOf(item)}`, window.VanaSearch.wikiLink(item)) : `${slot.ja} を固定する`);
      if (item) {
        const clear = el('button', { type: 'button', className: 'ghost', textContent: '固定を解除' });
        clear.addEventListener('click', () => {
          setFixed(slot.id, null);
          editing = null;
          changed();
        });
        title.append(clear);
      }
      const close = el('button', { type: 'button', className: 'ghost', textContent: '閉じる' });
      close.addEventListener('click', () => { editing = null; renderSide(); });
      title.append(close);
      const input = el('input', { type: 'search', autocomplete: 'off', placeholder: '装備の名前 (日本語・英語)' });
      const list = el('ul');
      const draw = () => {
        list.replaceChildren();
        if (!input.value.trim()) return;
        const found = findItems(slot, input.value);
        if (!found.length) list.append(el('li', { textContent: '見つかりません' }));
        for (const i of found) {
          const li = el('li', null,
            // 説明文の頭と、強化した装備ならオーグメントで増える分を、行を分けて出す
            el('span', null, nameOf(i), el('span', { className: 'sub', textContent: i.desc.replace(/\s+/g, ' ').slice(0, 44) }),
              i.aug ? el('span', { className: 'sub plus', textContent: '＋ ' + i.aug.replace(/\s+/g, ' ').slice(0, 44) }) : null),
            el('span', { className: 'lv' }, i.il ? 'IL' + i.il : 'Lv' + i.lv, window.VanaSearch.wikiLink(i)));
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
      // 固定のしかた: 今回だけ / いつも (このジョブ)。固定してある装備は、選び直すとその場で切り替わる
      const jobName = state.job ? data.jobs.find((j) => j.id === state.job).ja : '';
      const how = (pin, label, note) => {
        const radio = el('input', { type: 'radio', name: 'pin-mode', checked: pinMode === pin, disabled: pin && !state.job });
        radio.addEventListener('change', () => {
          pinMode = pin;
          if (item) { setFixed(slot.id, state.fixed[slot.id], pin); changed(); }
        });
        return el('label', null, radio, label, el('small', { textContent: note }));
      };
      editor.append(title, input, list, el('div', { className: 'how' },
        how(false, '今回だけ固定', 'ジョブを変えても、装備できれば残る'),
        how(true, `いつも固定${jobName ? ` (${jobName})` : ''}`, 'ジョブごとに覚える。解除や読み込みで消えない')));
      if (slot.id === 'main' && !(item && item.hands)) {
        // 武器を持たない。サブも空にする (「素手:」の効果は、メインもサブも空のときに効く扱い)
        const bare = el('button', { type: 'button', className: 'copy', textContent: '素手にする' });
        bare.addEventListener('click', () => {
          setFixed('sub', null);
          fix('main', 'bare');
        });
        editor.append(el('div', { className: 'bare-row' }, bare, el('span', { textContent: 'サブも空になる' })));
      }
      if (slot.id === 'sub' && getItem(state.fixed.main) === BARE) {
        editor.append(el('p', { className: 'hint', textContent: 'メインが素手のときにサブを固定すると、「素手:」の効果は付きません。' }));
      }
      if (slot.id === 'back' && state.job) {
        // 固定してあるマントの構成を選び直す
        if (item && item.group === 'cape') {
          editor.append(capeEditor(item, (picks) => {
            setFixed('back', capeId(item.capeJob, picks));
            changed();
          }), capeRegister(item, changed));
        }
        // 登録したマント (このジョブの分)。押すと、その構成で固定する
        const mine = myCapes(state.job);
        if (!mine.length) editor.append(el('p', { className: 'hint' }, 'ジョブマントは、', el('a', { href: 'settings.html', textContent: '設定の「ジョブマント」' }), 'で登録できます。'));
        if (mine.length) {
          editor.append(el('div', { className: 'cape-list' }, el('span', { className: 'hint', textContent: '登録したマント' }), ...mine.map((c) => {
            const id = capeId(c.job, c.picks);
            const b = el('button', { type: 'button', className: 'chip' + (state.fixed.back === id ? ' on' : ''), textContent: c.name, title: makeCape(c.job, c.picks)?.aug || '' });
            b.addEventListener('click', () => {
              setFixed('back', id, pinMode);
              changed();
            });
            return b;
          })));
        }
      }
    }

    placeEditor();

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

  // 装備を選ぶ欄は、押した部位の右隣に重ねて出す (左の欄の高さを変えない)。狭い画面では、画面の幅に合わせる
  function placeEditor() {
    const editor = $('editor');
    if (!editing) return;
    const target = $('mine').querySelector(`[data-slot="${editing}"]`);
    if (!target) return;
    const grid = $('mine').getBoundingClientRect();
    const at = target.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const beside = grid.right + 14 + width <= window.innerWidth;
    editor.style.width = width + 'px';
    editor.style.left = (beside ? grid.right + 14 : Math.max(8, window.innerWidth - width - 8)) + 'px';
    const height = editor.offsetHeight;
    const top = beside ? at.top - 40 : at.bottom + 6;
    editor.style.top = Math.max(8, Math.min(top, window.innerHeight - height - 8)) + 'px';
  }

  function render() {
    renderConditions();
    renderSide();
    renderFixedView();
    renderSaved();
  }

  // ---- 計算 ----

  // 同じ良さのときに使う重み。設定でそのジョブに決めた型 (この画面で選び直していれば、その型) のステータスと重み
  const tieType = () => (state.job ? P.weightType(P.character(store), state.job, state.tieType) : null);
  function tieWeights() {
    const type = tieType();
    return (type ? type.stats : []).filter((s) => s.w > 0 && db.statByKey.has(s.k)).map((s) => {
      const stat = db.statByKey.get(s.k);
      const sign = stat.neg ? -1 : 1;
      return { i: stat.i, weight: s.w, sign, cap: capOf(stat, sign)?.value ?? null };
    });
  }

  // generate = true のときは、登録したマントに加えて、目標に合う構成のマントも作って候補にする
  function request(generate) {
    const targets = state.targets.filter((t) => t.goal != null && t.goal !== 0).map((t) => ({ k: t.k, goal: t.goal }));
    // 振り数の目標は、必要なストアTP として足す (ストアTP の目標があれば、高いほうを使う)
    for (const goal of swingTargets()) {
      if (goal.error || goal.need <= 0) continue;
      const mine = targets.find((t) => t.k === 'ストアTP');
      if (mine) mine.goal = Math.max(mine.goal, goal.need);
      else targets.push({ k: 'ストアTP', goal: goal.need });
    }
    let fixed = {};
    for (const [slot, id] of Object.entries(state.fixed)) fixed[slot] = getItem(id);
    fixed = withBare(fixed);

    // マントは、目標と伸ばすステータスに合わせて構成を作る
    const wanted = new Map(targets.flatMap((t) => wantedKeys(t.k).map((i) => [i, t.goal < 0 ? -1 : 1])));
    const growing = state.objective === 'max' ? state.maximize.filter((m) => m.weight > 0) : [];
    for (const m of growing) {
      const stat = db.statByKey.get(m.k);
      if (!wanted.has(stat.i)) wanted.set(stat.i, stat.neg ? -1 : 1);
    }
    // 登録したマントが、この目標に「合う」か。アイテム 5 種のうち、目標や伸ばすステータスに効く項目を付けられる
    // ものの数を数え、その半分以上で実際に効く項目を付けていれば、合うとみなす
    // (TP 用のマントを、WS 向けの目標に使わないようにする。効く項目が 1 つも無い目標では、どれも合うとみなす)
    const helps = (option) => {
      if (!option) return false;
      for (let k = 0; k < option.s.length; k += 2) {
        const sign = wanted.get(option.s[k]);
        if (sign && sign * option.s[k + 1] > 0) return true;
      }
      return false;
    };
    const possible = data.capes.augments.filter((group) => group.options.some(helps)).length;
    const registered = myCapes(state.job);
    const fitting = registered
      .filter((c) => c.picks.filter((pick, g) => helps(data.capes.augments[g].options[pick])).length >= Math.ceil(possible / 2))
      .map((c) => makeCape(state.job, c.picks)).filter(Boolean);
    // 頭・胴・両手・両脚・両足は IL119 だけ。そのうえで、選んだ設定の範囲にある装備だけを使う
    // 「マイナスのある装備を使わない」: 命中-10 のように、普通は増える性能が減る装備を自動の候補から外す
    // (被ダメージや敵対心のように、もともと小さいほど良いものは対象外。条件つきの効果も見ない)
    const hasMinus = (item) => {
      for (const [i, v] of item.m) if (typeof v === 'number' && v < 0 && !data.stats[i].neg && !data.stats[i].scoped) return true;
      return false;
    };
    // 持っている装備の使い方 (設定で Moglist の書き出しを読み込んであるとき):
    //   実物のオーグメントで計算する … 持っている装備は、実物から作った候補 (item.owned) だけを使い、元の装備は使わない
    //   持っている装備だけを使う     … 持っていない装備は使わない。コンテンツとジョブ専用装束の範囲は見ない
    const own = ownedMode();
    const range = own && own.only
      ? Object.assign({}, profile(), { contents: {}, tiers: Object.fromEntries(P.JOB_SETS.map(([id, , max]) => [id, max])) })
      : profile();
    const inRange = (item) => {
      if (!own) return P.allow(range, item, data.contents);
      if (item.owned) return own.augs;
      const mine = own.mine.baseIds.has(baseOf(item));
      if (mine && own.augs) return false;
      if (own.only && !mine) return false;
      return P.allow(range, item, data.contents);
    };
    const allow = (item) => (item.group === 'cape' || eligible(item)) && inRange(item) && !(state.avoidMinus && hasMinus(item));
    // 背: 持っているジョブマントを実物で計算するとき、または持っている装備だけのときは、マントの構成を作らない
    const capePlain = data.items.find((i) => i.ja === data.capes.names[state.job] && !i.rank);
    const realCape = !!own && (own.only || (own.augs && !!capePlain && own.mine.baseIds.has(capePlain.id)));
    const back = !profile().cape || (realCape && own.augs) ? [] : fitting.length && !generate ? fitting : fitting.concat(capeVariants(state.job, wanted));
    const extra = back.length ? { back } : {};
    if (own && own.augs) for (const slot of SLOT_LIST) extra[slot.id] = (extra[slot.id] || []).concat(own.mine.items);
    return {
      job: state.job,
      level: 'all', // 部位ごとの条件は allow で見ている
      // 合計値の目標は、固定した武器から、元になるステータスを重み付きで足した目標に直す (武器が無ければ外す)
      targets: targets.map((t) => {
        const stat = db.statByKey.get(t.k);
        if (!stat.total) return { i: stat.i, goal: effectiveGoal(stat, t.goal) };
        const made = totalTarget(stat, t.goal);
        return made.error ? null : { mix: made.mix, goal: made.goal, k: t.k, shown: t.goal };
      }).filter(Boolean),
      objective: state.objective,
      // 伸ばすステータス: 番号、重み、上限 (あれば)
      maximize: growing.map((m) => {
        const stat = db.statByKey.get(m.k);
        return { i: stat.i, weight: m.weight, cap: capOf(stat, stat.neg ? -1 : 1)?.value ?? null };
      }),
      fixed,
      excluded: new Set(profile().excluded),
      base: outside().base,
      // 登録したマントのうち、この目標に合うものがあれば、まずその中から選ぶ。合うものが無いときと、
      // 合うマントでは目標に届かないとき (run が generate を付けて呼び直す) は、目標に合う構成を作る
      extra,
      ownCapes: !realCape && fitting.length > 0 && !generate,
      // 同じ良さの組み合わせの中から選ぶための重み
      tie: tieWeights(),
      noFit: !realCape && registered.length > 0 && !fitting.length, // 登録はあるが、合うものが無かった
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
      : state.objective === 'max' && !state.maximize.some((m) => m.weight > 0) ? '伸ばすステータスを選んでください。'
      : state.targets.filter((t) => t.goal && db.statByKey.get(t.k).total).map((t) => totalTarget(db.statByKey.get(t.k), t.goal).error).find(Boolean) || '';
    if (problem) {
      // 目標が無くても、固定した装備があれば、そのままカードで出す
      if (state.job && Object.keys(fixedEquip()).length && /目標のステータス/.test(problem)) {
        viewing = 'fixed';
        renderFixedView();
        renderSaved();
        $('status').textContent = '目標が無いので、固定中の装備をそのまま出しました。';
        if (viewCard) viewCard.scrollIntoView({ block: 'nearest' });
        return;
      }
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
      // 結果を出したときの条件 (ステータスの表示に使う)
      const who = currentWho();
      let old = false;
      const solveWith = async (request) => {
        let found = null;
        if (highs) {
          try {
            found = await window.VanaSolverILP.solve(highs, db, request, { onProgress: (count) => ($('status').textContent = `計算中… 候補 ${count} 件`) });
          } catch (error) {
            console.error(error); // 解けなかったときは、以前の計算に任せる
            if (highs.alive && !highs.alive()) highsPromise = null;
          }
        }
        if (!found) {
          old = true;
          found = solve(db, request);
        }
        return found;
      };
      let req = request(false);
      let result = await solveWith(req);
      // 登録したマントでは目標に届かないときは、目標に合う構成のマントを作って探し直す
      let madeCape = req.noFit ? '登録したマントに、この目標に合うものが無かったので' : '';
      if (req.ownCapes && !result.reached) {
        req = request(true);
        result = await solveWith(req);
        madeCape = '登録したマントでは目標に届かなかったので';
      }
      lastResult = { req, who, context: contextFor(who), result, madeCape };
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

  // ---- セットのステータス ----
  // ゲーム内のステータス画面のように、素の値 (白) と、装備などで増える分 (緑) を分けて出す。
  // 素の値は、種族・ジョブ・サポートジョブ・マスターレベルで決まる分に、ジョブ特性とメリポの分を足したもの
  // (ゲーム内でも、メリポや HPmax アップは白い数字に入る)。緑は装備・食事・手入力の分
  const { SHEET_KEYS } = window.VanaSets;
  const ATTACK_KEYS = ['攻', '命中', '飛攻', '飛命'];
  const number = (v) => v.toLocaleString('ja-JP');
  const plus = (v, unit) => (v < 0 ? '' : '+') + number(v) + (unit || '');

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
  // セットの中での、ステータスの値。合計値 (命中 (合計) など) は、武器から計算した値 (武器が無ければ 0)
  function valueAt(set, stat, context) {
    if (!stat.total) return set.totals.get(stat.i) || 0;
    const computed = combatValues(set, context, stat.total.ranged);
    return computed ? computed[stat.total.field].total : 0;
  }
  const showValue = (stat, value) => (stat.total ? number(value) : signed(value, stat.u));

  // 合計値の目標を、探すときの目標に直す。固定した装備だけの合計値 (now) から、あといくつ要るかを出し、
  // 自動で選ぶ装備の 命中・DEX・スキル などを重み付きで足した値が、それ以上になるようにする。
  //   命中 = スキルからの換算 + DEX × 0.75 (切り捨て) + 命中。スキル 1 あたりは 0.9 (スキル 600 未満なら少なめに 0.8 と見る)
  //   攻撃 = (8 + スキル + STR (格闘は × 0.75) + 攻) × スマイト
  // 切り捨てで足りなくならないように、端数の分 (命中は 1.75、格闘の攻撃は 0.75) を多めに求める
  function totalTarget(stat, goal) {
    const { flat, ranged, field } = stat.total;
    const equip = fixedEquip();
    const who = currentWho();
    const set = Object.assign({ equip }, window.VanaSolver.totalsOf(equip, outsideFor(who).base, data.sets));
    const now = combatValues(set, contextFor(who), ranged);
    if (!now) return { error: `「${stat.k}」の目標は、${ranged ? 'レンジ' : 'メイン'}の武器を固定すると使えます。` };
    const index = (key) => db.statByKey.get(key).i;
    const skill = db.statByKey.get(now.kind.ja + 'スキル');
    let mix;
    let need;
    if (field === 'accuracy') {
      mix = [[index(flat), 20], [index(ranged ? 'AGI' : 'DEX'), 15]];
      if (skill) mix.push([skill.i, now.skill >= 600 ? 18 : 16]);
      need = Math.ceil(20 * (goal - now.accuracy.total + 1.75) - 1e-9);
    } else {
      const h2h = now.kind.kind === 'h2h';
      mix = [[index(flat), 4], [index('STR'), h2h ? 3 : 4]];
      if (skill) mix.push([skill.i, 4]);
      const raw = Math.ceil((goal * 256) / (256 + (now.smite || 0)) - 1e-9); // スマイトを掛ける前に要る値
      need = Math.ceil(4 * (raw - now.rawAttack + (h2h ? 0.75 : 0)) - 1e-9);
    }
    // 探す側は、装備以外の分と固定した装備の分も同じ重みで数えるので、その分を目標に足しておく
    return { mix, goal: need + window.VanaSolver.valueOf({ mix }, (i) => set.totals.get(i)), now: now[field].total, kind: now.kind };
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
  // 固定している装備 (素手の分を入れた形)
  function fixedEquip() {
    const equip = {};
    for (const [slot, id] of Object.entries(state.fixed)) if (getItem(id)) equip[slot] = getItem(id);
    return withBare(equip);
  }
  function fixedSetups() {
    const equip = fixedEquip();
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
  // compact: 左の欄で開くとき。幅が狭いので、長い名前を縮め、上限を超えた値は上限の値で出す
  function statsPanel(set, req, wanted, compact) {
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
        const name = compact ? entry.stat.k.replace('(被ダメージ込み)', '(込)') : entry.stat.k;
        const capped = compact && entry.over; // 上限の値を出し、もとの合計は説明に回す
        box.append(el('span', { className: 'stat' + (entry.over ? ' over' : '') + (wanted.has(entry.stat.i) ? ' wanted' : ''),
          title: (compact ? `${entry.stat.k} ${signed(entry.value, entry.stat.u)}\n` : '') + detail + (entry.over ? `\n上限 ${signed(entry.over.value, entry.stat.u)} (${entry.over.note})。超えた分は効果がありません` : '') },
          name + ' ', el('b', { textContent: signed(capped ? entry.over.value : entry.value, entry.stat.u) }),
          entry.over ? el('span', { className: 'cap-mark', textContent: capped ? ' 上限' : ` 上限 ${signed(entry.over.value, entry.stat.u)}` }) : null));
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
    // 持っている装備の候補: 実物のオーグメントが分かっていれば入力させない。分からなければ、元の装備に入力する
    const key = item.owned ? item.manualKey : item.id;
    if (key == null) return null;
    const input = el('input', { type: 'text', className: 'manual-input', placeholder: '例: STR+8 DEX+8 命中+12', value: P.character(store).augments[key] || '', spellcheck: false });
    const note = el('span', { className: 'manual-note' });
    const check = () => {
      const { unknown } = window.VanaAugment.read(db, input.value);
      note.textContent = unknown.length ? `読めない項目: ${unknown.join('、')}` : '';
    };
    input.addEventListener('input', check);
    input.addEventListener('change', () => {
      const text = input.value.trim();
      if (text) P.character(store).augments[key] = text;
      else delete P.character(store).augments[key];
      window.VanaAugment.apply(db, P.character(store).augments);
      ownedReset();
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
    let equip = {};
    for (const [slot, id] of Object.entries(saved.equip)) {
      const item = getItem(id);
      if (item) equip[slot] = item;
    }
    equip = withBare(equip);
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

  // 左の欄で開く、セットのステータス。目標への届き具合 (いま画面で選んでいる目標と比べる)、基本ステータス、
  // 攻撃・命中、TP、すべてのステータス、装備ごとの説明
  function setView(entry) {
    const { set, context, base } = entry;
    const columns = state.targets.filter((t) => t.goal != null && t.goal !== 0).map((t) => ({ stat: db.statByKey.get(t.k), goal: effectiveGoal(db.statByKey.get(t.k), t.goal) }));
    for (const m of state.objective === 'max' ? state.maximize.filter((x) => x.weight > 0) : []) {
      const stat = db.statByKey.get(m.k);
      if (!columns.some((c) => c.stat === stat)) columns.push({ stat });
    }
    const checks = el('div', { className: 'checks' });
    for (const c of columns) {
      const value = valueAt(set, c.stat, context);
      const shown = el('b', { textContent: showValue(c.stat, value) });
      if (c.goal == null) {
        checks.append(el('span', { className: 'chk grow', title: '伸ばすステータス' }, c.stat.k + ' ', shown));
        continue;
      }
      const ok = c.goal < 0 ? value <= c.goal : value >= c.goal;
      checks.append(el('span', { className: 'chk' + (ok ? '' : ' short') }, c.stat.k + ' ', shown, el('span', { textContent: '/ ' + showValue(c.stat, c.goal) }),
        ok ? null : el('span', { textContent: `あと ${Math.abs(Math.round((c.goal - value) * 100) / 100)}${c.stat.u || ''}` })));
    }
    const req = { base };
    const gear = el('div', { className: 'view-gear' });
    const rows = [];
    for (const slot of SLOTS) {
      const item = set.equip[slot.id];
      if (!item) continue;
      const row = el('details', null,
        el('summary', null, el('span', { className: 'slot', textContent: slot.ja }), nameOf(item), window.VanaSearch.wikiLink(item)),
        el('pre', { textContent: item.desc }),
        item.aug ? el('div', { className: 'aug', textContent: 'オーグメント: ' + item.aug.replace(/\s+/g, ' ') }) : null,
        item.manual ? el('div', { className: 'aug', textContent: '手入力のオーグメント: ' + item.manual }) : null,
        item.bareOn ? el('div', { className: 'aug', textContent: '「素手:」の分を合計に入れています' }) : null);
      rows.push(row);
      gear.append(row);
    }
    const all = el('button', { type: 'button', className: 'small', textContent: '説明をすべて開く' });
    all.addEventListener('click', () => {
      const open = rows.some((r) => !r.open);
      for (const r of rows) r.open = open;
      all.textContent = open ? '説明をすべて閉じる' : '説明をすべて開く';
    });
    const bonus = set.bonuses.map((b) => `${data.sets[b.index].label} ${b.count} 部位`).join('、');
    const tp = tpBoxes(set, context);
    return el('div', { className: 'set-view' },
      columns.length ? checks : null,
      bonus ? el('div', { className: 'bonus', textContent: `セット効果: ${bonus} (合計に含む)` }) : null,
      statSheet(set, context),
      el('div', { className: 'combat' }, attackTiles(set, req, context)),
      tp,
      statsPanel(set, req, new Set(columns.map((c) => c.stat.i)), true),
      el('div', { className: 'view-head' }, el('span', { textContent: `装備 (${rows.length} 部位)` }), all),
      gear);
  }

  // 固定中の装備のステータス (固定する装備の枠の下に開く)
  // 「見る」: 固定中の装備や保存したセットを、右の候補の並びの先頭に、候補と同じ大きさのカードで出す
  // (候補を押し下げて隠さないように、候補の隣に並べる)
  let viewCard = null;
  function renderFixedView() {
    const equip = fixedEquip();
    const any = Object.keys(equip).length > 0 && !!state.job;
    $('fixed-view').hidden = !any;
    if (viewing === 'fixed' && !any) viewing = null;
    $('fixed-view').classList.toggle('on', viewing === 'fixed');
    $('fixed-view').textContent = viewing === 'fixed' ? 'ステータスを閉じる' : 'ステータスを見る';
    if (viewCard) viewCard.remove();
    viewCard = null;
    let entry = null;
    let name = '';
    let meta = '';
    if (viewing === 'fixed') {
      const who = currentWho();
      const base = outsideFor(who).base;
      entry = { set: Object.assign({ equip }, window.VanaSolver.totalsOf(equip, base, data.sets)), context: contextFor(who), base };
      name = '固定中の装備';
      meta = whoText(who);
    } else if (viewing) {
      entry = entryOf(viewing);
      if (entry) { name = entry.label; meta = whoText(entry.who) + '・保存したセット'; }
    }
    if (!entry) return;
    const close = el('button', { type: 'button', className: 'copy', textContent: '閉じる' });
    close.addEventListener('click', () => { viewing = null; renderFixedView(); renderSaved(); });
    viewCard = el('div', { className: 'card view-card' },
      el('div', { className: 'card-head' }, el('h3', { textContent: name }), el('span', { className: 'used', textContent: meta }), close),
      setView(entry));
    $('cards').prepend(viewCard);
  }

  // 保存したセットの「読み込む」: どこまで固定するかを選ぶ。ジョブ・サポ・食事は、どれを選んでも合わせる。
  // いつもの装備は消えず、読み込んだセットより優先する
  let loading = null;
  function loadMenu(saved) {
    const choices = [
      ['すべて固定する', null, ''],
      ['武器だけ固定する', WEAPONS, 'メイン・サブ・レンジ・矢弾'],
      ['武器とアクセを固定する', [...WEAPONS, ...ACCESSORIES], '防具だけ探し直す'],
      ['固定しない', [], 'ジョブ・サポ・食事だけ合わせる'],
    ];
    return el('div', { className: 'load-menu' }, ...choices.map(([label, slots, note]) => {
      const button = el('button', { type: 'button' }, label, note ? el('small', { textContent: note }) : null);
      button.addEventListener('click', () => {
        dropPins();
        const fixed = {};
        for (const [slot, id] of Object.entries(saved.equip)) if ((!slots || slots.includes(slot)) && getItem(id)) fixed[slot] = id;
        Object.assign(state, { job: saved.who.job, sub: saved.who.sub, subLevel: saved.who.subLevel, food: saved.who.food, innate: Object.assign({}, saved.who.innate), fixed });
        applyPins();
        editing = null;
        loading = null;
        changed();
      });
      return button;
    }));
  }

  // 左の欄: 保存したセットの一覧
  function renderSaved() {
    const box = $('saved');
    box.replaceChildren();
    for (const saved of savedSets()) {
      const check = el('input', { type: 'checkbox', checked: compare.includes(saved.id), title: '比較に並べる' });
      check.addEventListener('change', () => toggleCompare(saved.id));
      const names = SLOTS.map((slot) => getItem(saved.equip[slot.id])).filter(Boolean).map(nameOf).join(' / ');
      const open = viewing === saved.id;
      const view = el('button', { type: 'button', className: 'small view' + (open ? ' on' : ''), textContent: open ? '閉じる' : '見る', title: 'このセットの合計・攻撃や命中・TP と、装備の説明を見る (保存したときのジョブ・サポ・食事で計算)' });
      view.addEventListener('click', () => {
        viewing = open ? null : saved.id;
        renderFixedView();
        renderSaved();
      });
      const load = el('button', { type: 'button', className: 'small', textContent: '読み込む', title: 'このセットを「固定する装備」に入れる (ジョブ・サポ・食事も合わせる)' });
      load.addEventListener('click', () => {
        loading = loading === saved.id ? null : saved.id;
        renderSaved();
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
      box.append(el('div', { className: 'saved-set' + (compare.includes(saved.id) ? ' picked' : '') + (open ? ' viewing' : '') },
        el('label', { className: 'saved-head' }, check, el('span', { className: 'saved-name', textContent: saved.name })),
        el('div', { className: 'saved-meta', textContent: whoText(saved.who) }),
        el('div', { className: 'saved-gear', textContent: names, title: names.replace(/ \/ /g, '\n') }),
        el('div', { className: 'saved-acts' }, view, load, rename, remove),
        loading === saved.id ? loadMenu(saved) : null));
    }
    if (!savedSets().length) box.append(el('p', { className: 'hint', textContent: 'まだありません。' }));
  }

  function renderResults() {
    const { req, result, context } = lastResult;
    const cards = $('cards');
    cards.replaceChildren();
    if (viewCard) cards.append(viewCard);
    $('notice').replaceChildren();
    $('overview').replaceChildren();
    $('overview').hidden = true;
    renderCompare();
    $('results-title').textContent = `候補 ${result.sets.length} 件`;
    $('results-hint').textContent = result.sets.length ? 'マスを押すと、説明と「固定」「除外」' : '';
    if (!result.sets.length) {
      cards.append(el('p', { className: 'empty', textContent: '候補を作れませんでした。' }));
      return;
    }
    if (!result.exact && result.reached) {
      $('notice').append(el('p', { className: 'warn', textContent: '計算に時間がかかるため、途中で打ち切りました。ここに出ている候補は目標を満たしますが、いちばん良い組み合わせとは限りません。部位を固定するか、目標を減らすと確実になります。' }));
    }
    if (lastResult.madeCape) {
      $('notice').append(el('p', { className: 'warn', textContent: `${lastResult.madeCape}、目標に合う構成のマントを作って探しました (候補の背に [オグメ最大] と出ているものが、作った構成です)。` }));
    }
    if (!result.reached) {
      $('notice').append(el('p', { className: 'warn', textContent: '目標のすべてには届きませんでした。いちばん近い組み合わせを表示しています。目標を下げるか、固定・除外・装備の範囲を緩めてください。' }));
    }

    // 達成度と寄与を出す列: 目標のステータスと、伸ばすステータス
    const columns = req.targets.map((t) => (t.mix ? { stat: db.statByKey.get(t.k), goal: t.shown } : { stat: data.stats[t.i], goal: t.goal }));
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
      for (const c of columns) head.append(el('th', null, c.stat.k, el('small', { textContent: c.goal != null ? `${c.goal < 0 ? '≤' : '≥'} ${showValue(c.stat, c.goal)}` : `伸ばす ×${c.weight}` })));
      for (const c of swingColumns) head.append(el('th', null, c.kind.label, el('small', { textContent: c.goal != null ? `≤ ${c.goal} 振り` : '振り数' })));
      head.append(el('th', { className: 'changed', textContent: '候補 1 と違う部位' }), el('th'));
      const bestOf = (values, low) => {
        const usable = values.filter((v) => Number.isFinite(v));
        if (!usable.length || usable.every((v) => v === usable[0])) return null; // みな同じなら色を付けない
        return low ? Math.min(...usable) : Math.max(...usable);
      };
      const best = columns.map((c) => bestOf(result.sets.map((set) => effective(c, valueAt(set, c.stat, context))), lower(c)));
      const bestSwings = swingColumns.map((c) => bestOf(result.sets.map((set) => swingsOf(c.kind, set)), true));
      const body = el('tbody');
      result.sets.forEach((set, index) => {
        const tr = el('tr', { title: 'この候補へ移動' }, el('td', { textContent: '候補 ' + (index + 1) }));
        columns.forEach((c, k) => {
          const value = valueAt(set, c.stat, context);
          const short = c.goal != null && (c.goal < 0 ? value > c.goal : value < c.goal);
          tr.append(el('td', { className: short ? 'short' : effective(c, value) === best[k] ? 'best' : '', textContent: showValue(c.stat, value) }));
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
        const value = valueAt(set, c.stat, context);
        const cap = capFor(c);
        const over = beyond(cap, value); // 上限を超えて積んでいる分は効果が無い
        const overNote = over ? el('span', { title: `${cap.note}。超えた分は効果がありません`, textContent: `上限 (合計は ${signed(value, c.stat.u)})` }) : null;
        const shown = el('b', { textContent: showValue(c.stat, over ? cap.value : value) });
        if (c.goal == null) {
          growing.push(el('span', { className: 'chk grow', title: '伸ばすステータス' }, c.stat.k + ' ', shown, overNote));
          continue;
        }
        const ok = c.goal < 0 ? value <= c.goal : value >= c.goal;
        const fill = el('i');
        fill.style.width = Math.max(0, Math.min(100, (value / c.goal) * 100)) + '%';
        checks.append(el('span', { className: 'chk' + (ok ? '' : ' short') }, c.stat.k + ' ', shown, el('span', { textContent: '/ ' + showValue(c.stat, c.goal) }), overNote,
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
          el('div', { className: 'title' }, `${slot.ja}: ${nameOf(item)}`, window.VanaSearch.wikiLink(item), el('span', { className: 'en', textContent: item.en })),
          el('pre', { textContent: item.desc }),
          item.group === 'cape' ? null : item.aug ? el('div', { className: 'aug', textContent: 'オーグメント: ' + item.aug.replace(/\s+/g, ' ') }) : null,
          // ジョブマントは、構成を選び直せる。選び直すと、この候補の合計も変わる
          item.group === 'cape' ? capeEditor(item, (picks) => {
            set.equip[slot.id] = makeCape(item.capeJob, picks);
            Object.assign(set, window.VanaSolver.totalsOf(set.equip, req.base, data.sets));
            renderResults();
          }, true) : null,
          item.group === 'cape' ? capeRegister(item, () => {
            P.save(localStorage, store);
            set.equip[slot.id] = makeCape(item.capeJob, item.picks); // 名前の表示を直す
            render();
            renderResults();
          }) : null,
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
      // いつもの装備は、ジョブごとに入れ替える。今回だけの固定は、装備できるものを残す
      dropPins();
      state.job = Number($('job').value);
      state.tieType = ''; // 重みの型は、そのジョブの設定に戻す
      for (const [slot, id] of Object.entries(state.fixed)) if (!usable(getItem(id))) delete state.fixed[slot];
      applyPins();
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
      dropPins(); // いつもの装備は、キャラクターごと
      store.activeChar = $('chara').value;
      activePreset = ''; // 保存した条件は、キャラクターごと
      // キャラクターごとに、手入力のオーグメントと、持っている装備が違う
      window.VanaAugment.apply(db, P.character(store).augments);
      ownedReset();
      applyPins();
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
      // レベル (飛竜:Lv など) は 1 の価値が大きいので、初めの重みを大きくしておく
      state.maximize.push({ k: key, weight: /:Lv$/.test(key) ? 100 : 1 });
      changed();
    }, (key) => state.maximize.some((m) => m.k === key)));
    for (const b of $('objective').children) {
      b.addEventListener('click', () => {
        state.objective = b.dataset.value;
        changed();
      });
    }
    // 外す: いつもの装備は残す
    const unfix = (slots) => {
      for (const slot of Object.keys(state.fixed)) if ((!slots || slots.includes(slot)) && !isPinned(slot)) delete state.fixed[slot];
      editing = null;
      changed();
    };
    $('fixed-clear').addEventListener('click', () => unfix(null));
    $('unfix-armor').addEventListener('click', () => unfix(ARMOR));
    $('unfix-acc').addEventListener('click', () => unfix(ACCESSORIES));
    // 装備を選ぶ欄: 外を押すか Esc で閉じる。画面を動かしたら、位置を合わせ直す
    document.addEventListener('mousedown', (event) => {
      if (!editing || $('editor').contains(event.target) || $('mine').contains(event.target)) return;
      editing = null;
      renderSide();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !editing || event.isComposing) return;
      editing = null;
      renderSide();
    });
    window.addEventListener('scroll', placeEditor, true);
    window.addEventListener('resize', placeEditor);
    $('excluded-clear').addEventListener('click', () => {
      profile().excluded = [];
      changed();
    });
    $('solve').addEventListener('click', run);
    $('fixed-view').addEventListener('click', () => {
      viewing = viewing === 'fixed' ? null : 'fixed';
      renderFixedView();
      renderSaved();
    });
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
