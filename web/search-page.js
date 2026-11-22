// 画面。検索の中身は search.js にある。
(function () {
  'use strict';

  const { SLOTS, prepare, suggest, search, slotNames, fold } = window.VanaSearch;
  const db = prepare(window.VANARMORY_DATA);
  const data = db.data;
  const PAGE = 200;

  const PRESETS = [
    ['攻撃', ['ストアTP', 'ダブルアタック', 'トリプルアタック', 'クワッドアタック', 'ウェポンスキルのダメージ', 'クリティカルヒット', 'クリティカルヒットダメージ', '物理ダメージ上限', 'TPボーナス', '二刀流', 'ヘイスト', '命中', '攻', '連携ボーナス']],
    ['遠隔', ['飛命', '飛攻', 'スナップショット', 'ラピッドショット', 'トゥルーショット']],
    ['魔法', ['魔攻', '魔命', '魔法ダメージ', 'マジックバーストダメージ', 'マジックバーストダメージII', 'ファストキャスト', 'ケアル回復量', 'コンサーブMP', 'リフレシュ', '強化魔法の効果時間']],
    ['防御', ['被ダメージ', '被物理ダメージ(被ダメージ込み)', '被魔法ダメージ(被ダメージ込み)', '回避', '魔回避', '魔防', '敵対心', 'モクシャ', 'リジェネ', '被ファランクス', 'HP']],
    ['その他', ['トレジャーハンター', '移動速度', 'リゲイン']],
  ];

  const $ = (id) => document.getElementById(id);
  const el = (tag, props, ...children) => {
    const node = Object.assign(document.createElement(tag), props || {});
    node.append(...children);
    return node;
  };

  // 画面の状態。URL の # 以降に保存して、ブックマークや共有ができるようにする
  const initial = () => ({ stats: [], sort: null, mode: 'and', slots: [], job: 0, skill: -1, level: '99', text: '', view: 'list', top: 5 });
  let state = initial();
  let shown = PAGE;

  function loadState() {
    state = initial();
    if (location.hash.length < 2) return;
    try {
      const saved = JSON.parse(decodeURIComponent(location.hash.slice(1)));
      Object.assign(state, saved);
      state.stats = (saved.stats || []).filter((s) => db.statByKey.has(s.k));
    } catch {
      // 壊れた URL は無視して初期状態で開く
    }
  }

  function saveState() {
    const def = initial();
    const diff = {};
    for (const key of Object.keys(def)) {
      if (JSON.stringify(state[key]) !== JSON.stringify(def[key])) diff[key] = state[key];
    }
    const hash = Object.keys(diff).length ? '#' + encodeURIComponent(JSON.stringify(diff)) : ' ';
    history.replaceState(null, '', hash);
  }

  function update() {
    shown = PAGE;
    saveState();
    renderControls();
    renderResults();
  }

  // ---- ステータスの選択 ----

  function addStat(key) {
    const stat = db.statByKey.get(key);
    if (!stat || state.stats.some((s) => s.k === key)) return;
    state.stats.push({ k: key, min: null, dir: stat.neg ? 'asc' : 'desc' });
    if (stat.num) state.sort = key;
    update();
  }

  function removeStat(key) {
    state.stats = state.stats.filter((s) => s.k !== key);
    if (state.sort === key) state.sort = state.stats.find((s) => db.statByKey.get(s.k).num)?.k ?? null;
    update();
  }

  let suggestions = [];
  let active = 0;

  function renderSuggest() {
    const input = $('stat-input');
    const list = $('stat-suggest');
    suggestions = suggest(db, input.value, 40);
    active = Math.min(active, Math.max(suggestions.length - 1, 0));
    list.replaceChildren();
    list.hidden = !input.value.trim();
    if (list.hidden) return;
    if (!suggestions.length) {
      list.append(el('li', { className: 'empty', textContent: '見つからない。下の「名前・説明文」でも探せます' }));
      return;
    }
    suggestions.forEach((s, i) => {
      const li = el('li', { className: i === active ? 'active' : '' }, el('span', { textContent: s.k }), el('span', { className: 'n', textContent: s.n + ' 件' }));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(s.k);
      });
      list.append(li);
    });
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function pick(key) {
    $('stat-input').value = '';
    active = 0;
    renderSuggest();
    addStat(key);
  }

  function renderControls() {
    const selected = $('selected');
    selected.replaceChildren();
    for (const sel of state.stats) {
      const stat = db.statByKey.get(sel.k);
      const li = el('li', null, el('span', { className: 'name', textContent: sel.k }));
      if (stat.num) {
        const min = el('input', { type: 'number', step: 'any', placeholder: sel.dir === 'asc' ? '以下' : '以上', value: sel.min ?? '', title: sel.dir === 'asc' ? 'この値以下のものだけ' : 'この値以上のものだけ' });
        min.addEventListener('change', () => {
          sel.min = min.value === '' ? null : Number(min.value);
          update();
        });
        const dir = el('button', { type: 'button', textContent: sel.dir === 'asc' ? '小さい順' : '大きい順', title: '並べる向きを切り替える' });
        dir.addEventListener('click', () => {
          sel.dir = sel.dir === 'asc' ? 'desc' : 'asc';
          state.sort = sel.k;
          update();
        });
        li.append(min, dir);
      } else {
        li.append(el('span'), el('span', { className: 'n', textContent: '効果あり' }));
      }
      const remove = el('button', { type: 'button', textContent: '×', title: '外す' });
      remove.addEventListener('click', () => removeStat(sel.k));
      li.append(remove);
      selected.append(li);
    }
    $('mode-row').hidden = state.stats.length < 2;
    for (const radio of document.querySelectorAll('input[name="mode"]')) radio.checked = radio.value === state.mode;
    for (const radio of document.querySelectorAll('input[name="view"]')) radio.checked = radio.value === state.view;
    for (const chip of document.querySelectorAll('#preset-groups .chip')) chip.classList.toggle('on', state.stats.some((s) => s.k === chip.dataset.key));
    for (const chip of document.querySelectorAll('#slots .chip')) chip.classList.toggle('on', state.slots.includes(chip.dataset.id));
    $('job').value = state.job;
    $('skill').value = state.skill;
    $('level').value = state.level;
    $('top').value = state.top;
    $('top').hidden = state.view !== 'slots';
    if (document.activeElement !== $('text')) $('text').value = state.text;
  }

  // ---- 結果 ----

  function criteria(slotMask) {
    const sortStat = db.statByKey.get(state.sort);
    return {
      stats: state.stats.map((s) => ({ i: db.statByKey.get(s.k).i, min: s.min, dir: s.dir })),
      mode: state.mode,
      slotMask,
      job: Number(state.job),
      skill: Number(state.skill),
      level: state.level,
      text: state.text,
      sort: sortStat ? sortStat.i : -1,
    };
  }

  const selectedSlots = () => SLOTS.filter((s) => state.slots.includes(s.id));
  const format = (value, stat) => (value === undefined ? '—' : value === null ? '○' : (value > 0 && stat.k !== 'D' && stat.k !== '隔' && stat.k !== '防' ? '+' : '') + value + stat.u);

  function jobsText(mask) {
    const all = data.jobs.filter((j) => Math.floor(mask / 2 ** j.id) % 2 === 1);
    return all.length === data.jobs.length ? 'All Jobs' : all.map((j) => j.s).join('');
  }

  // 説明文のうち、選んだステータスに当たる語に印をつける
  function describe(text, names) {
    const frag = document.createDocumentFragment();
    for (const part of text.split(/(\s+)/)) {
      const token = fold(part);
      const body = token.slice(token.indexOf(':') + 1);
      const hit = names.some((n) => body.startsWith(n) && /^[+\-±]?[\d.~+\-]*%?$/.test(body.slice(n.length)));
      frag.append(hit ? el('mark', { textContent: part }) : part);
    }
    return frag;
  }

  function table(items) {
    const stats = state.stats.map((s) => db.statByKey.get(s.k));
    const names = stats.map((s) => fold(s.k.slice(s.k.lastIndexOf(':') + 1)).replace('(被ダメージ込み)', ''));
    if (names.some((n) => n.startsWith('被物理ダメージ') || n.startsWith('被魔法ダメージ'))) names.push('被ダメージ');

    const head = el('tr', null, el('th', { textContent: '名前' }), el('th', { textContent: '部位' }), el('th', { textContent: 'Lv' }));
    for (const stat of stats) {
      const sel = state.stats.find((s) => s.k === stat.k);
      const sorted = state.sort === stat.k;
      const th = el('th', { className: 'num' + (stat.num ? ' sortable' : '') + (sorted ? ' sorted' : ''), textContent: stat.k + (sorted ? (sel.dir === 'asc' ? ' ▲' : ' ▼') : '') });
      if (stat.num) {
        th.title = 'クリックで並べ替え';
        th.addEventListener('click', () => {
          if (sorted) sel.dir = sel.dir === 'asc' ? 'desc' : 'asc';
          state.sort = stat.k;
          update();
        });
      }
      head.append(th);
    }
    head.append(el('th', { textContent: '説明文' }), el('th', { textContent: 'ジョブ' }));

    const body = el('tbody');
    for (const item of items) {
      const level = item.il ? 'IL' + item.il : 'Lv' + item.lv;
      const slot = slotNames(item.slots).join('・') + (item.skill && data.skills[item.skill] ? ' (' + data.skills[item.skill] + ')' : '');
      const row = el('tr', null,
        el('td', { className: 'name' }, item.ja + (item.rank ? ` [${item.rank}]` : ''), el('span', { className: 'en', textContent: item.en })),
        el('td', { className: 'slot', textContent: slot }),
        el('td', { className: 'lv', textContent: level + (item.su ? ' Su' + item.su : '') }));
      for (const stat of stats) row.append(el('td', { className: 'num', textContent: format(item.m.get(stat.i), stat) }));
      const desc = el('td', { className: 'desc' }, describe(item.desc, names));
      if (item.aug) desc.append(el('span', { className: 'aug' }, 'オーグメント: ', describe(item.aug, names)));
      row.append(desc, el('td', { className: 'jobs', textContent: jobsText(item.jobs) }));
      body.append(row);
    }
    return el('div', { className: 'table-wrap' }, el('table', null, el('thead', null, head), body));
  }

  function renderResults() {
    const results = $('results');
    results.replaceChildren();
    $('more').hidden = true;
    const picked = selectedSlots();

    if (state.view === 'slots') {
      if (!state.sort) {
        $('count').textContent = '';
        results.append(el('p', { className: 'hint', textContent: '数値を持つステータスを選ぶと、部位ごとに上位の装備を並べます。' }));
        return;
      }
      let groups = 0;
      for (const slot of picked.length ? picked : SLOTS) {
        const items = search(db, criteria(slot.mask));
        if (!items.length) continue;
        groups++;
        results.append(el('h3', { className: 'slot-title', textContent: `${slot.ja} (${items.length} 件中 上位 ${Math.min(state.top, items.length)} 件)` }), table(items.slice(0, state.top)));
      }
      $('count').textContent = groups ? `${groups} 部位` : '';
      if (!groups) results.append(el('p', { className: 'hint', textContent: '条件に合う装備がありません。' }));
      return;
    }

    const items = search(db, criteria(picked.reduce((mask, s) => mask | s.mask, 0)));
    $('count').textContent = `${items.length} 件`;
    if (!items.length) {
      results.append(el('p', { className: 'hint', textContent: '条件に合う装備がありません。' }));
      return;
    }
    results.append(table(items.slice(0, shown)));
    $('more').hidden = items.length <= shown;
    $('more').textContent = `さらに表示 (残り ${items.length - shown} 件)`;
  }

  // ---- 初期化 ----

  function init() {
    $('meta').textContent = `装備 ${data.items.length} 件 / データ ${data.generated}`;

    for (const [title, keys] of PRESETS) {
      const chips = el('div', { className: 'chips' });
      for (const key of keys.filter((k) => db.statByKey.has(k))) {
        const chip = el('button', { type: 'button', className: 'chip', textContent: key });
        chip.dataset.key = key;
        chip.addEventListener('click', () => (state.stats.some((s) => s.k === key) ? removeStat(key) : addStat(key)));
        chips.append(chip);
      }
      $('preset-groups').append(el('div', { className: 'group-title', textContent: title }), chips);
    }

    for (const slot of SLOTS) {
      const chip = el('button', { type: 'button', className: 'chip', textContent: slot.ja });
      chip.dataset.id = slot.id;
      chip.addEventListener('click', () => {
        state.slots = state.slots.includes(slot.id) ? state.slots.filter((s) => s !== slot.id) : [...state.slots, slot.id];
        update();
      });
      $('slots').append(chip);
    }
    $('slots-clear').addEventListener('click', () => {
      state.slots = [];
      update();
    });

    for (const job of data.jobs) $('job').append(el('option', { value: job.id, textContent: job.ja }));
    const used = new Set(data.items.map((i) => i.skill));
    for (const [id, name] of Object.entries(data.skills)) {
      if (Number(id) > 0 && used.has(Number(id))) $('skill').append(el('option', { value: id, textContent: name }));
    }

    const input = $('stat-input');
    input.addEventListener('input', () => {
      active = 0;
      renderSuggest();
    });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return; // 変換の確定に使う Enter は拾わない
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % Math.max(suggestions.length, 1);
        renderSuggest();
      } else if (e.key === 'Enter' && suggestions[active]) {
        pick(suggestions[active].k);
      } else if (e.key === 'Escape') {
        input.value = '';
        renderSuggest();
      }
    });
    input.addEventListener('blur', () => ($('stat-suggest').hidden = true));
    input.addEventListener('focus', renderSuggest);

    const bind = (id, key, convert) => $(id).addEventListener('change', () => {
      state[key] = convert($(id).value);
      update();
    });
    bind('job', 'job', Number);
    bind('skill', 'skill', Number);
    bind('level', 'level', String);
    bind('top', 'top', Number);
    $('text').addEventListener('input', () => {
      state.text = $('text').value;
      update();
    });
    for (const name of ['mode', 'view']) {
      for (const radio of document.querySelectorAll(`input[name="${name}"]`)) {
        radio.addEventListener('change', () => {
          state[name] = radio.value;
          update();
        });
      }
    }
    $('reset').addEventListener('click', () => {
      state = initial();
      update();
    });
    $('more').addEventListener('click', () => {
      shown += PAGE;
      renderResults();
    });
    window.addEventListener('hashchange', () => {
      loadState();
      shown = PAGE;
      renderControls();
      renderResults();
    });

    loadState();
    renderControls();
    renderResults();
  }

  init();
})();
