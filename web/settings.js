// 「設定」の画面。使う装備の範囲を、名前を付けた設定ごとに決める。保存と判定は profiles.js にある。
(function () {
  'use strict';

  const P = window.VanaProfiles;
  const { prepare, fold, suggest } = window.VanaSearch;
  const db = prepare(window.VANARMORY_DATA);
  const data = db.data;
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  const contents = data.contents || [];

  const $ = (id) => document.getElementById(id);
  const el = (tag, props, ...children) => {
    const node = Object.assign(document.createElement(tag), props || {});
    node.append(...children.filter((c) => c != null));
    return node;
  };
  const nameOf = (item) => item.ja + (item.rank ? ` [${item.rank}]` : '');

  // 「セットを組む」で設定を分ける前に保存していた内容があれば、最初の設定に引き継ぐ
  let legacy = null;
  try {
    legacy = JSON.parse(localStorage.getItem('vanarmory.builder') || 'null');
  } catch {
    // 読めなければ引き継がない
  }
  const store = P.load(localStorage, legacy);
  const chara = () => P.character(store);
  const profile = () => P.active(store);

  let savedTimer = 0;
  function changed() {
    const ok = P.save(localStorage, store);
    $('saved').textContent = ok ? '保存しました' : '保存できませんでした (このブラウザでは保存が使えません)';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => ($('saved').textContent = ''), 1500);
    render();
  }

  const plusOptions = (max) => [...Array(max).keys()].map((n) => [max - n, `+${max - n} まで`]).concat([[0, '無印まで'], [-1, '使わない']]);
  const RP_OPTIONS = [[30, 'RP30'], [25, 'RP25'], [20, 'RP20'], [15, 'RP15'], [10, 'RP10'], [5, 'RP5'], [0, '無強化'], [-1, '使わない']];
  // 系統に入る、名前の違う装備
  const FAMILY_NOTE = { ikenga: 'イケンガ装束・イケンガの武器と、国光', gleti: 'グレティ装束・グレティの武器と、月桂の太刀' };
  const GAEA_OPTIONS = [[30, 'R30'], [25, 'R25'], [20, 'R20'], [15, 'R15'], [10, 'R10'], [5, 'R5'], [0, '無強化'], [-1, '使わない']];
  const select = (options, value, onChange) => {
    const node = el('select', null, ...options.map(([v, label]) => el('option', { value: v, textContent: label })));
    node.value = value;
    node.addEventListener('change', () => onChange(node.value));
    return node;
  };
  const tierRow = (label, control) => el('label', { className: 'tier' }, label, control);

  // 1 段目: キャラクター
  function renderCharacters() {
    $('chars').replaceChildren(...store.chars.map((c) => {
      const b = el('button', { type: 'button', className: 'profile' + (c.id === store.activeChar ? ' on' : ''), textContent: c.name });
      b.addEventListener('click', () => {
        store.activeChar = c.id;
        changed();
      });
      return b;
    }));
    $('char-delete').disabled = store.chars.length < 2;
    // 装備の範囲の設定を写す先 (ほかのキャラクター)
    const others = store.chars.filter((c) => c.id !== store.activeChar);
    $('copy-box').hidden = !others.length;
    const chosen = $('copy-target').value;
    $('copy-target').replaceChildren(...others.map((c) => el('option', { value: c.id, textContent: c.name })));
    if (others.some((c) => c.id === chosen)) $('copy-target').value = chosen;
  }

  // 2 段目: そのキャラクターの、装備の範囲の設定
  function renderProfiles() {
    $('profiles').replaceChildren(...chara().list.map((p) => {
      const b = el('button', { type: 'button', className: 'profile' + (p.id === chara().active ? ' on' : ''), textContent: p.name });
      b.addEventListener('click', () => {
        chara().active = p.id;
        changed();
      });
      return b;
    }));
    $('profile-delete').disabled = chara().list.length < 2;
  }

  function renderJobSets() {
    $('job-sets').replaceChildren(...P.JOB_SETS.map(([id, label, max]) =>
      tierRow(el('span', null, label, wiki((data.links || {})[id], label)), select(plusOptions(max), profile().tiers[id], (v) => {
        profile().tiers[id] = Number(v);
        changed();
      }))));

    // オデシー装備: 2 列に詰めて並べる
    const pair = (label, control, title) => {
      const name = el('span', { textContent: label });
      if (title) Object.assign(name, { className: 'help', title });
      return el('label', { className: 'pair' }, name, control);
    };
    const rankSelect = (options, id) => select(options, profile().odyssey[id], (v) => {
      profile().odyssey[id] = Number(v);
      changed();
    });
    const ranks = new Set(P.ODYSSEY.map(([id]) => profile().odyssey[id]));
    const all = select([['', '系統ごとに設定'], ...RP_OPTIONS], ranks.size === 1 ? [...ranks][0] : '', (v) => {
      if (v === '') return;
      for (const [id] of P.ODYSSEY) profile().odyssey[id] = Number(v);
      changed();
    });
    const together = pair('まとめて', all);
    together.classList.add('wide');
    $('odyssey').replaceChildren(
      el('div', { className: 'pairs' }, together, ...P.ODYSSEY.map(([id, label]) => pair(label, rankSelect(RP_OPTIONS, id), FAMILY_NOTE[id]))),
      // アトーンメント 1・2 の装備は、段階ごと
      el('div', { className: 'sub-head' }, el('span', { textContent: 'アトーンメント 1・2 の装備' }), el('span', { textContent: '名前に合わせると対象が出ます' })),
      el('div', { className: 'pairs' }, ...P.GAEA.map(([id, label, members]) => pair(label, rankSelect(GAEA_OPTIONS, id), members))));
  }

  // FF11用語辞典のページを開くリンクマーク
  const ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9.5 2.5h4v4M13.5 2.5 7.5 8.5"/></svg>';
  const wiki = (href, what) => {
    if (!href) return null;
    const a = el('a', { className: 'wiki', href, target: '_blank', rel: 'noopener', title: `${what} のページを開く (FF11用語辞典)` });
    a.innerHTML = ICON;
    a.addEventListener('click', (e) => e.stopPropagation()); // リンクを押しても、行やボタンの切り替えは起こさない
    return a;
  };

  // コンテンツ 1 行。スイッチ、名前、段階の選択、点数。入手元を選べるものは下に一覧を出す
  function contentRow({ label, note, url, count, on, tiers, tier, onToggle, onTier, boost }) {
    const sw = el('button', { type: 'button', className: 'switch' + (on ? ' on' : ''), title: on ? '使う' : '使わない' });
    sw.addEventListener('click', onToggle);
    const name = el('div', { className: 'name' }, el('b', { textContent: label }), wiki(url, label), note ? el('span', { className: 'hint', textContent: note }) : null);
    let control = el('span');
    if (tiers) {
      // 上の段階ほど先に並べる
      control = select(tiers.map((t, i) => [i, t]).reverse(), tier, (v) => onTier(Number(v)));
      control.disabled = !on;
    }
    // 強化 (ランクを選べないもの): 上限まで強化した状態を使うか、強化していない状態を使うか
    let chip = el('span');
    if (boost) {
      const [id, , detail] = boost;
      const boosted = profile().boosts[id];
      chip = el('button', { type: 'button', className: 'boost-chip' + (boosted ? ' on' : ''), textContent: boosted ? '強化 最大' : '強化 なし', disabled: !on,
        title: `${detail}\n「強化 最大」ならその状態を、「強化 なし」なら強化していない状態を使います` });
      chip.addEventListener('click', () => {
        profile().boosts[id] = !boosted;
        changed();
      });
    }
    return el('div', { className: 'row' + (on ? '' : ' off') }, sw, name, control, chip, el('div', { className: 'count', textContent: count + ' 点' }));
  }

  const openPicks = new Set(); // 入手元の一覧を開いているコンテンツ
  function renderContents() {
    const box = $('contents');
    box.replaceChildren();
    let group = '';
    const rows = [
      // アンバスマントは入手先の一覧ではなく、構成を自動で選ぶ特別な装備
      { id: 'cape', label: 'アンバスマント', group: '継続コンテンツ', note: 'オーグメントは最大で、項目は目標に合わせて自動で選びます', n: Object.keys(data.capes.names).length, cape: true },
      ...contents,
    ];
    // グループの並びは、最初に出てきた順
    const order = [...new Set(rows.map((r) => r.group))];
    rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    for (const content of rows) {
      if (content.group !== group) box.append(el('div', { className: 'group-title', textContent: (group = content.group) }));
      if (content.cape) {
        box.append(contentRow({ label: content.label, note: content.note, url: (data.links || {}).cape, count: content.n, on: profile().cape, onToggle: () => {
          profile().cape = !profile().cape;
          changed();
        } }));
        continue;
      }
      const setting = P.contentSetting(profile(), content);
      const update = (patch) => {
        profile().contents[content.id] = Object.assign({}, setting, patch);
        changed();
      };
      box.append(contentRow({
        label: content.label, note: content.note, url: content.url, count: content.n, on: setting.on, tiers: content.tiers, tier: setting.tier,
        onToggle: () => update({ on: !setting.on }),
        onTier: (tier) => update({ tier }),
        boost: P.BOOSTS.find((b) => b[3].includes(content.id)),
      }));
      if (content.picks && setting.on) {
        const picked = setting.picks || content.froms;
        // 一覧は畳んでおく (開け閉めは、選び直している間も保つ)
        const sub = el('div', { className: 'sub' });
        const folded = el('details', { className: 'picks-line', open: openPicks.has(content.id) },
          el('summary', { textContent: `${content.froms.length} 個のうち ${picked.length} 個を使う — 選び直す` }), sub);
        folded.addEventListener('toggle', () => (folded.open ? openPicks.add(content.id) : openPicks.delete(content.id)));
        for (const from of content.froms) {
          const pick = el('button', { type: 'button', className: 'pick' + (picked.includes(from) ? ' on' : ''), textContent: from });
          pick.addEventListener('click', () => {
            const next = picked.includes(from) ? picked.filter((f) => f !== from) : content.froms.filter((f) => f === from || picked.includes(f));
            update({ picks: next.length === content.froms.length ? null : next });
          });
          // バトルフィールド名の後ろに、そのページへのリンクマーク
          const page = wiki(content.pages[content.froms.indexOf(from)], from);
          sub.append(page ? el('span', { className: 'pick-wrap' }, pick, page) : pick);
        }
        const all = el('button', { type: 'button', className: 'ghost', textContent: 'すべて選ぶ' });
        all.addEventListener('click', () => update({ picks: null }));
        const none = el('button', { type: 'button', className: 'ghost', textContent: 'すべて外す' });
        none.addEventListener('click', () => update({ picks: [] }));
        sub.append(all, none);
        box.append(folded);
      }
    }
    if (!contents.length) box.append(el('p', { className: 'hint', textContent: 'コンテンツごとの一覧はまだありません。' }));
  }

  function renderExcluded() {
    const list = profile().excluded.filter((id) => itemById.has(id) || String(id).startsWith('cape:'));
    $('excluded-count').textContent = `${list.length} 点`;
    $('excluded').replaceChildren(...list.map((id) => {
      const item = itemById.get(id);
      const chip = el('button', { type: 'button', className: 'chip', textContent: (item ? nameOf(item) : 'アンバスマント (構成指定)') + ' ×', title: '候補に戻す' });
      chip.addEventListener('click', () => {
        profile().excluded = profile().excluded.filter((x) => x !== id);
        changed();
      });
      return chip;
    }));
  }

  function renderFinder() {
    const q = fold($('exclude-find').value.trim());
    const list = $('exclude-list');
    list.replaceChildren();
    if (!q) return;
    const found = data.items.filter((i) => !profile().excluded.includes(i.id) && i.names.includes(q))
      .sort((a, b) => b.il - a.il || b.lv - a.lv || a.ja.localeCompare(b.ja, 'ja')).slice(0, 30);
    if (!found.length) list.append(el('li', { textContent: '見つかりません' }));
    for (const item of found) {
      const li = el('li', null, el('span', { textContent: nameOf(item) }), el('span', { className: 'lv', textContent: item.il ? 'IL' + item.il : 'Lv' + item.lv }));
      li.addEventListener('click', () => {
        profile().excluded.push(item.id);
        changed();
      });
      list.append(li);
    }
  }

  // ---- ジョブの育成 ----
  const signed = (v, unit) => (v > 0 ? '+' : '') + v + (unit || '');
  // そのジョブが、いまの育成で得る値 (ギフトとメリポ) を短く並べる
  function gainsOf(job, grown) {
    const info = data.innate.jobs[job];
    if (!info) return '';
    const totals = new Map();
    const add = (i, v) => totals.set(i, (totals.get(i) || 0) + v);
    for (const [i, steps] of Object.entries(info.gift)) for (const [jp, v] of steps) if (jp <= grown.jp) add(Number(i), v);
    if (grown.jp >= P.MAX_JP) for (let k = 0; k < info.jp.length; k += 2) add(info.jp[k], info.jp[k + 1]);
    if (grown.merit) for (let k = 0; k < info.merit.length; k += 2) add(info.merit[k], info.merit[k + 1]);
    // 攻・命中のような、どのジョブにもある基本の値は分けて返す (表ではそのジョブらしい値を主に見せる)
    const common = new Set(['攻', '飛攻', '命中', '飛命', '防', '回避', '魔回避', '魔命']);
    const named = [...totals].filter(([, v]) => v).map(([i, v]) => ({ key: data.stats[i].k, value: v, unit: data.stats[i].u }));
    // 値が同じ「攻と飛攻」「命中と飛命」は 1 つにまとめて短くする
    for (const [a, b] of [['攻', '飛攻'], ['命中', '飛命']]) {
      const first = named.find((n) => n.key === a);
      const second = named.find((n) => n.key === b);
      if (first && second && first.value === second.value) {
        first.label = `${a}・${b}`;
        named.splice(named.indexOf(second), 1);
      }
    }
    const order = ['攻', '命中', '防', '回避', '魔命', '魔回避', '飛攻', '飛命'];
    const text = (list) => list.map((n) => `${n.label || n.key} ${signed(n.value, n.unit)}`).join(' / ');
    return {
      main: text(named.filter((n) => !common.has(n.key))),
      basic: text(named.filter((n) => common.has(n.key)).sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key))),
    };
  }

  // 共通のメリポ。項目ごとに、振った段階を入れる
  function renderShared() {
    const levelOf = (group, item) => P.sharedLevel(chara(), group, item);
    $('shared').replaceChildren(...data.innate.shared.map((group) => {
      const used = group.items.reduce((sum, item) => sum + levelOf(group, item), 0);
      const over = group.limit != null && used > group.limit;
      const head = el('div', { className: 'shared-label' }, group.label,
        group.limit != null ? el('span', { className: 'limit' + (over ? ' over' : ''), textContent: ` 合計 ${used} / ${group.limit} 段階` + (over ? ' (振れる数を超えています)' : '') }) : null);
      const fields = group.items.map((item) => {
        const input = el('input', { type: 'number', min: 0, max: item.max, step: 1, value: levelOf(group, item) });
        input.addEventListener('change', () => {
          const level = Math.max(0, Math.min(item.max, Math.round(Number(input.value) || 0)));
          chara().merits[item.id] = level; // 0 も「振っていない」として残す (初期値の最大に戻さない)
          changed();
        });
        const level = levelOf(group, item);
        const total = level * item.per;
        const gain = level ? `${total > 0 ? '+' : ''}${total}${item.i >= 0 ? data.stats[item.i].u : ''}` : '';
        return el('label', { className: 'merit-field' + (level ? ' set' : ''), title: `1 段階あたり ${item.per > 0 ? '+' : ''}${item.per}、最大 ${item.max} 段階` + (item.i < 0 ? '。装備に無いステータスのため、計算には入りません' : '') },
          el('span', { className: 'merit-name', textContent: item.label }), input, el('span', { className: 'merit-gain', textContent: gain }));
      });
      return el('div', { className: 'shared-group' }, head, el('div', { className: 'merit-fields' }, ...fields));
    }));
  }

  function renderJobs() {
    const body = $('jobs');
    body.replaceChildren();
    for (const job of data.jobs) {
      const grown = P.jobSetting(chara(), job.id);
      const update = (patch) => {
        // 保存するのは入力してある数値。マスター済みかどうかは別に持つ
        chara().jobs[job.id] = Object.assign({ jp: grown.raw, master: grown.master, ml: grown.ml, merit: grown.merit }, patch);
        changed();
      };
      const number = (value, max, step, onChange) => {
        const input = el('input', { type: 'number', min: 0, max, step, value });
        input.addEventListener('change', () => onChange(Math.max(0, Math.min(max, Math.round(Number(input.value) || 0)))));
        return input;
      };
      const master = el('input', { type: 'checkbox', checked: grown.master });
      master.addEventListener('change', () => update({ master: master.checked }));
      const merit = el('input', { type: 'checkbox', checked: grown.merit });
      merit.addEventListener('change', () => update({ merit: merit.checked }));
      const hasMerit = data.innate.jobs[job.id] && data.innate.jobs[job.id].merit.length;
      const gains = gainsOf(job.id, grown) || { main: '', basic: '' };
      // そのジョブらしい値を濃い字で、攻・命中などの基本の値を薄い字で、すべて出す。
      // 行の高さを揃えるため 2 行までにし、狭い画面で入りきらない分は「…」にしてマウスを乗せると出す
      const gainText = el('div', { className: 'gain-text', title: [gains.main, gains.basic].filter(Boolean).join(' / ') });
      if (gains.main) gainText.append(el('b', { textContent: gains.main }));
      if (gains.main && gains.basic) gainText.append(' / ');
      if (gains.basic) gainText.append(gains.basic);
      if (!gains.main && !gains.basic) gainText.textContent = '—';
      const gainCell = el('td', { className: 'gain' }, gainText);
      body.append(el('tr', { className: grown.jp || grown.ml ? '' : 'idle' },
        el('td', { className: 'name', textContent: job.ja }),
        // マスター済みのときは数値の代わりに ★ を出す。数値は裏に残してあり、チェックを外すと戻る
        el('td', { className: 'jp' },
          grown.master
            ? el('span', { className: 'stars', textContent: '★★★', title: `ジョブマスター (ジョブポイント ${P.MAX_JP} として数えます)` })
            : number(grown.raw, P.MAX_JP, 5, (jp) => update({ jp })),
          el('label', { className: 'master', title: 'ジョブマスター済みならチェック。入力した数値は消えません' }, master, ' マスター')),
        el('td', null, number(grown.ml, 50, 1, (ml) => update({ ml }))),
        el('td', { className: 'sublv', textContent: P.supportLevel(grown.ml, data.innate.support) }),
        el('td', { className: 'merit' }, hasMerit ? el('label', null, merit, ' 最大まで') : el('span', { className: 'none', textContent: '—', title: 'このジョブには、常に効くジョブ別メリポがありません' })),
        gainCell));
    }
    renderShared();
    $('race').value = chara().race;
  }

  // ---- タブ ----
  let tab = 'gear';
  try {
    tab = sessionStorage.getItem('vanarmory.settings.tab') || 'gear';
  } catch {
    // 覚えておけなくても支障はない
  }
  function renderTabs() {
    for (const button of document.querySelectorAll('.tab')) button.classList.toggle('on', button.dataset.tab === tab);
    $('tab-gear').hidden = tab !== 'gear';
    $('tab-jobs').hidden = tab !== 'jobs';
    $('tab-manual').hidden = tab !== 'manual';
    $('tab-capes').hidden = tab !== 'capes';
    $('tab-weights').hidden = tab !== 'weights';
  }

  // ---- オーグメントの手入力 ----
  let manualAdding = []; // 追加したばかりで、まだ何も入力していない装備
  // ---- ジョブマント: 持っている構成を登録する ----
  // 登録は { id, job, name, picks }。picks は、アイテム 5 種ごとに選んだ項目の番号 (-1 は付けない)
  const capeDraft = { job: 0, name: '', picks: null };
  const capeText = (picks) => picks.map((pick, g) => (data.capes.augments[g].options[pick] || {}).text).filter(Boolean).join(' ') || '(何も付けていない)';
  // アイテム 5 種の欄。onPick(何番目のアイテムか, 選んだ項目) を呼ぶ
  function capeSelects(picks, onPick) {
    return el('div', { className: 'cape-picks' }, ...data.capes.augments.map((group, g) => {
      const node = el('select', { className: picks[g] < 0 ? 'none' : '' }, el('option', { value: -1, textContent: 'なし' }),
        ...group.options.map((option, index) => el('option', { value: index, textContent: option.text })));
      node.value = picks[g];
      node.addEventListener('change', () => onPick(g, Number(node.value)));
      return el('label', { className: 'cape-pick' }, group.item, node);
    }));
  }
  function renderCapes() {
    const list = chara().capes;
    if (!capeDraft.picks) capeDraft.picks = data.capes.augments.map(() => -1);
    // 登録する欄
    const job = el('select', null, el('option', { value: 0, textContent: 'ジョブを選ぶ' }),
      ...data.jobs.filter((j) => data.capes.names[j.id]).map((j) => el('option', { value: j.id, textContent: `${j.ja} (${data.capes.names[j.id]})` })));
    job.value = capeDraft.job;
    job.addEventListener('change', () => {
      capeDraft.job = Number(job.value);
      renderCapes();
    });
    const name = el('input', { type: 'text', className: 'input', placeholder: '名前 (例: TP用、WS用)', value: capeDraft.name, spellcheck: false });
    name.addEventListener('input', () => (capeDraft.name = name.value));
    const add = el('button', { type: 'button', className: 'profile on', textContent: '登録する' });
    const note = el('span', { className: 'hint' });
    add.addEventListener('click', () => {
      const label = capeDraft.name.trim();
      const problem = !capeDraft.job ? 'ジョブを選んでください。' : !capeDraft.picks.some((pick) => pick >= 0) ? '項目を 1 つ以上選んでください。' : !label ? '名前を入れてください。' : '';
      if (problem) return void (note.textContent = problem);
      list.push({ id: P.newId(), job: capeDraft.job, name: label, picks: capeDraft.picks.slice() });
      Object.assign(capeDraft, { name: '', picks: null });
      changed();
    });
    $('cape-form').replaceChildren(
      el('div', { className: 'cape-head' }, job, name),
      capeSelects(capeDraft.picks, (g, pick) => {
        capeDraft.picks[g] = pick;
        renderCapes();
      }),
      el('div', { className: 'cape-foot' }, el('span', { className: 'hint' }, '合計: ', el('b', { textContent: capeText(capeDraft.picks) })), add, note));

    // 登録した一覧 (ジョブの順)。名前と構成は、その場で直せる
    $('cape-count').textContent = `${list.length} 枚`;
    const sorted = list.slice().sort((a, b) => a.job - b.job);
    $('cape-list').replaceChildren(...sorted.map((cape) => {
      const jobName = (data.jobs.find((j) => j.id === cape.job) || {}).ja || '';
      const rename = el('input', { type: 'text', className: 'input', value: cape.name, spellcheck: false, title: '名前' });
      rename.addEventListener('change', () => {
        cape.name = rename.value.trim() || cape.name;
        changed();
      });
      const remove = el('button', { type: 'button', className: 'ghost danger', textContent: '消す' });
      remove.addEventListener('click', () => {
        chara().capes = list.filter((c) => c !== cape);
        changed();
      });
      return el('div', { className: 'cape-item' },
        el('div', { className: 'cape-head' }, el('b', { textContent: `${jobName}・${data.capes.names[cape.job] || ''}` }), rename, remove),
        capeSelects(cape.picks, (g, pick) => {
          cape.picks[g] = pick;
          changed();
        }),
        el('div', { className: 'hint' }, '合計: ', el('b', { textContent: capeText(cape.picks) })));
    }));
    if (!list.length) $('cape-list').append(el('p', { className: 'hint', textContent: 'まだありません。上の欄から登録します。「セットを組む」で、候補や固定した背のマスを押したところからも登録できます。' }));
  }

  // ---- 同じ良さのときの重み: 役割の型と、ジョブごとの型 ----
  let addingTo = ''; // ステータスを足そうとしている型
  function renderWeights() {
    const weights = chara().weights;
    const initial = P.defaultWeights();

    // ジョブごとの型
    $('job-types').replaceChildren(...data.jobs.map((job) => {
      const node = el('select', null, ...weights.types.map((t) => el('option', { value: t.id, textContent: t.name })), el('option', { value: 'none', textContent: '使わない' }));
      node.value = weights.jobs[job.id] || 'none';
      node.addEventListener('change', () => {
        weights.jobs[job.id] = node.value;
        changed();
      });
      // 初めの状態から変えたジョブは、枠の色を変える
      return el('label', { className: 'job-type' + (node.value !== initial.jobs[job.id] ? ' changed' : '') }, job.ja, node);
    }));

    // 型ごとの重み
    const cards = weights.types.map((type) => {
      const first = initial.types.find((t) => t.id === type.id); // 初めからある型か
      const users = data.jobs.filter((job) => weights.jobs[job.id] === type.id).map((job) => (job.ja === '魔導剣士' ? '剣' : job.ja === 'からくり士' ? 'か' : job.ja.slice(0, 1)));
      const name = el('input', { type: 'text', className: 'input', value: type.name, spellcheck: false, title: '型の名前' });
      name.addEventListener('change', () => {
        type.name = name.value.trim() || type.name;
        changed();
      });
      const reset = el('button', { type: 'button', className: 'ghost', textContent: first ? '初めの状態に戻す' : 'この型を消す' });
      reset.addEventListener('click', () => {
        if (first) Object.assign(type, JSON.parse(JSON.stringify(first)));
        else {
          if (!confirm(`型「${type.name}」を消します。この型を使っているジョブは「使わない」になります。`)) return;
          weights.types = weights.types.filter((t) => t !== type);
          for (const job of Object.keys(weights.jobs)) if (weights.jobs[job] === type.id) weights.jobs[job] = 'none';
        }
        changed();
      });
      const chips = type.stats.map((stat) => {
        const input = el('input', { type: 'number', step: 'any', min: 0, value: stat.w, title: '重み' });
        input.addEventListener('change', () => {
          stat.w = Math.max(0, Number(input.value) || 0);
          changed();
        });
        const remove = el('button', { type: 'button', className: 'x', textContent: '×', title: '外す' });
        remove.addEventListener('click', () => {
          type.stats = type.stats.filter((s) => s !== stat);
          changed();
        });
        return el('span', { className: 'weight' + (db.statByKey.has(stat.k) ? '' : ' unknown'), title: db.statByKey.has(stat.k) ? '' : 'この名前のステータスは、いまのデータにありません' },
          stat.k + ' ', el('span', { className: 'op', textContent: '×' }), input, remove);
      });
      // ステータスを足す: 名前を打って、出てきた候補を押す
      let adder;
      if (addingTo === type.id) {
        const find = el('input', { type: 'search', className: 'input', placeholder: '名前や略称 (STP、DA など)', autocomplete: 'off' });
        const found = el('span', { className: 'weight-found' });
        find.addEventListener('input', () => {
          found.replaceChildren(...suggest(db, find.value, 40).filter((s) => s.num && !type.stats.some((x) => x.k === s.k)).slice(0, 8).map((s) => {
            const b = el('button', { type: 'button', className: 'chip', textContent: s.k });
            b.addEventListener('click', () => {
              type.stats.push({ k: s.k, w: 1 });
              addingTo = '';
              changed();
            });
            return b;
          }));
        });
        find.addEventListener('keydown', (e) => {
          if (e.isComposing) return;
          if (e.key === 'Escape') {
            addingTo = '';
            renderWeights();
          }
          if (e.key === 'Enter') found.querySelector('button')?.click();
        });
        adder = el('span', { className: 'weight-adder' }, find, found);
        setTimeout(() => find.focus(), 0);
      } else {
        adder = el('button', { type: 'button', className: 'add-weight', textContent: '＋ ステータスを追加' });
        adder.addEventListener('click', () => {
          addingTo = type.id;
          renderWeights();
        });
      }
      return el('div', { className: 'type' },
        el('div', { className: 'type-head' }, name, el('span', { className: 'used', textContent: users.length ? `${users.join('・')} で使用` : '使っているジョブなし' }), el('span', { className: 'right' }, reset)),
        el('div', { className: 'weights' }, ...chips, adder));
    });
    const add = el('button', { type: 'button', className: 'profile new', textContent: '＋ 新しい型' });
    add.addEventListener('click', () => {
      const label = (prompt('型の名前', '') || '').trim();
      if (!label) return;
      weights.types.push({ id: P.newId(), name: label, stats: [] });
      changed();
    });
    $('weight-types').replaceChildren(...cards, add);
  }

  function renderManual() {
    const saved = chara().augments;
    const ids = [...new Set([...Object.keys(saved), ...manualAdding.map(String)])].filter((id) => itemById.has(id) || itemById.has(Number(id)));
    $('manual-count').textContent = `${Object.keys(saved).length} 点`;
    $('manual-list').replaceChildren(...ids.map((id) => {
      const item = itemById.get(id) || itemById.get(Number(id));
      const input = el('input', { type: 'text', className: 'input', placeholder: '例: STR+8 DEX+8 命中+12', value: saved[id] || '', spellcheck: false });
      const note = el('span', { className: 'manual-note' });
      const check = () => {
        const { unknown } = window.VanaAugment.read(db, input.value);
        note.textContent = unknown.length ? `読めない項目: ${unknown.join('、')}` : '';
      };
      input.addEventListener('input', check);
      input.addEventListener('change', () => {
        const text = input.value.trim();
        if (text) chara().augments[id] = text;
        else delete chara().augments[id];
        changed();
      });
      const remove = el('button', { type: 'button', className: 'ghost', textContent: '消す' });
      remove.addEventListener('click', () => {
        delete chara().augments[id];
        manualAdding = manualAdding.filter((x) => String(x) !== String(id));
        changed();
      });
      check();
      return el('div', { className: 'manual-row' }, el('span', { className: 'manual-name', textContent: nameOf(item), title: item.desc }), input, remove,
        item.roll ? el('span', { className: 'manual-roll', textContent: `この装備に付く幅: ${item.roll}` }) : null, note);
    }));
    if (!ids.length) $('manual-list').append(el('p', { className: 'hint', textContent: 'まだ何も入力していません。下の欄で装備を探して追加します。' }));

    const q = fold($('manual-find').value.trim());
    const list = $('manual-found');
    list.replaceChildren();
    if (!q) return;
    const found = data.items.filter((i) => !ids.includes(String(i.id)) && i.names.includes(q))
      .sort((a, b) => b.il - a.il || b.lv - a.lv || a.ja.localeCompare(b.ja, 'ja')).slice(0, 30);
    if (!found.length) list.append(el('li', { textContent: '見つかりません' }));
    for (const item of found) {
      const li = el('li', null, el('span', { textContent: nameOf(item) }), el('span', { className: 'lv', textContent: item.il ? 'IL' + item.il : 'Lv' + item.lv }));
      li.addEventListener('click', () => {
        manualAdding.push(String(item.id));
        $('manual-find').value = '';
        renderManual();
        $('manual-list').lastElementChild.querySelector('input').focus();
      });
      list.append(li);
    }
  }

  function render() {
    renderTabs();
    renderManual();
    renderCapes();
    renderWeights();
    renderCharacters();
    renderJobs();
    renderProfiles();
    renderJobSets();
    renderContents();
    renderExcluded();
    renderFinder();
  }

  function init() {
    $('meta').textContent = `装備 ${data.items.length} 件 / データ ${data.generated}`;
    $('odyssey-title').append(wiki((data.links || {}).odyssey, 'オデシー') || '');
    $('char-new').addEventListener('click', () => {
      const name = (prompt('新しいキャラクターの名前', '') || '').trim();
      if (!name) return;
      const created = P.createCharacter(name);
      store.chars.push(created);
      store.activeChar = created.id;
      changed();
    });
    $('char-rename').addEventListener('click', () => {
      const name = (prompt('キャラクターの名前', chara().name) || '').trim();
      if (!name) return;
      chara().name = name;
      changed();
    });
    $('char-copy').addEventListener('click', () => {
      // 育成も装備の範囲もまとめて写す
      const copy = JSON.parse(JSON.stringify(chara()));
      const fresh = P.createCharacter(chara().name + ' のコピー');
      copy.id = fresh.id;
      copy.name = fresh.name;
      store.chars.push(copy);
      store.activeChar = copy.id;
      changed();
    });
    $('char-delete').addEventListener('click', () => {
      if (store.chars.length < 2 || !confirm(`キャラクター「${chara().name}」を、育成と装備の範囲の設定ごと削除します。元に戻せません。`)) return;
      store.chars = store.chars.filter((c) => c.id !== store.activeChar);
      store.activeChar = store.chars[0].id;
      changed();
    });
    $('copy-go').addEventListener('click', () => {
      const target = store.chars.find((c) => c.id === $('copy-target').value);
      if (!target) return;
      const same = target.list.some((p) => p.name === profile().name);
      if (same && !confirm(`「${target.name}」には、同じ名前の設定「${profile().name}」があります。上書きしますか?`)) return;
      P.copyProfile(profile(), target);
      changed();
      $('saved').textContent = `「${profile().name}」を「${target.name}」へコピーしました`;
    });
    $('profile-new').addEventListener('click', () => {
      const name = (prompt('新しい設定の名前', '') || '').trim();
      if (!name) return;
      const created = P.create(name);
      chara().list.push(created);
      chara().active = created.id;
      changed();
    });
    $('profile-rename').addEventListener('click', () => {
      const name = (prompt('設定の名前', profile().name) || '').trim();
      if (!name) return;
      profile().name = name;
      changed();
    });
    $('profile-copy').addEventListener('click', () => {
      const copy = P.normalize(JSON.parse(JSON.stringify(profile())));
      copy.id = P.create('').id;
      copy.name = profile().name + ' のコピー';
      chara().list.push(copy);
      chara().active = copy.id;
      changed();
    });
    $('profile-delete').addEventListener('click', () => {
      if (chara().list.length < 2 || !confirm(`「${chara().name}」の設定「${profile().name}」を削除します。元に戻せません。`)) return;
      chara().list = chara().list.filter((p) => p.id !== chara().active);
      chara().active = chara().list[0].id;
      changed();
    });
    const setAll = (on) => {
      profile().cape = on;
      for (const content of contents) profile().contents[content.id] = Object.assign({}, P.contentSetting(profile(), content), { on });
      changed();
    };
    $('all-on').addEventListener('click', () => setAll(true));
    $('all-off').addEventListener('click', () => setAll(false));
    $('exclude-find').addEventListener('input', renderFinder);
    $('manual-find').addEventListener('input', renderManual);
    for (const [id, race] of Object.entries(data.base.races)) $('race').append(el('option', { value: id, textContent: race.ja }));
    $('race').addEventListener('change', () => {
      chara().race = $('race').value;
      changed();
    });
    for (const button of document.querySelectorAll('.tab')) {
      button.addEventListener('click', () => {
        tab = button.dataset.tab;
        try {
          sessionStorage.setItem('vanarmory.settings.tab', tab);
        } catch {
          // 覚えておけなくても支障はない
        }
        renderTabs();
      });
    }
    $('weights-reset-jobs').addEventListener('click', () => {
      const weights = chara().weights;
      const initial = P.defaultWeights();
      // 初めの型が消されているジョブは「使わない」にする
      for (const job of Object.keys(initial.jobs)) weights.jobs[job] = weights.types.some((t) => t.id === initial.jobs[job]) ? initial.jobs[job] : 'none';
      changed();
    });
    $('weights-reset-all').addEventListener('click', () => {
      if (!confirm('型と重み、ジョブごとの型を、すべて初めの状態に戻します。足した型は消えます。')) return;
      chara().weights = P.defaultWeights();
      changed();
    });
    P.save(localStorage, store); // 引き継いだ内容を保存しておく
    // 数値を打った直後 (欄から出る前) にページを離れても、打った値を保存する
    window.addEventListener('pagehide', () => {
      const field = document.activeElement;
      if (field && field.matches('input, select')) field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    render();
  }

  init();
})();
