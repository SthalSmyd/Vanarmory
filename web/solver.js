// 目標値を満たす装備セットを探す。画面 (builder.js) とテスト (Node) の両方から使う。
//
// 考え方: 部位を 1 つずつ決めていき、「各目標にあとどれだけ足りているか」が同じ途中経過は
// 良いものだけ残す。目標を超えた分は区別しない (超過は目標値で打ち切る) ので、
// 途中経過の種類は目標値の大きさ程度に収まる。
(function (root) {
  'use strict';

  const SLOTS = [
    { id: 'main', ja: 'メイン', mask: 1 << 0, weapon: true },
    { id: 'sub', ja: 'サブ', mask: 1 << 1, weapon: true },
    { id: 'range', ja: 'レンジ', mask: 1 << 2, weapon: true },
    { id: 'ammo', ja: '矢弾', mask: 1 << 3 },
    { id: 'head', ja: '頭', mask: 1 << 4 },
    { id: 'neck', ja: '首', mask: 1 << 9 },
    { id: 'ear1', ja: '耳1', mask: 1 << 11, pair: 'ear2' },
    { id: 'ear2', ja: '耳2', mask: 1 << 12 },
    { id: 'body', ja: '胴', mask: 1 << 5 },
    { id: 'hands', ja: '両手', mask: 1 << 6 },
    { id: 'ring1', ja: '指1', mask: 1 << 13, pair: 'ring2' },
    { id: 'ring2', ja: '指2', mask: 1 << 14 },
    { id: 'back', ja: '背', mask: 1 << 15 },
    { id: 'waist', ja: '腰', mask: 1 << 10 },
    { id: 'legs', ja: '両脚', mask: 1 << 7 },
    { id: 'feet', ja: '両足', mask: 1 << 8 },
  ];
  const SLOT_BY_ID = new Map(SLOTS.map((s) => [s.id, s]));

  const DEFAULTS = {
    results: 6, // 返す候補の数
    keep: 3, // 上位互換がこの数以上ある装備は候補から外す
    thin: 1500, // 途中経過がこの数を超えたら、確実に劣るものを捨てる
    stateLimit: 3000, // それでもこの数を超えたら、進みの良い順に残す (ここまで来ると最良とは限らなくなる)
  };

  const usable = (item, job) => Math.floor(item.jobs / 2 ** job) % 2 === 1;

  const TIERED = new Set(['af', 'relic', 'empy']);
  // 同時に持てない装備どうしか。装備の only に、同じ組なら同じ番号が入っている (data/exclusive.json)
  const clash = (a, b) => a.only != null && a.only === b.only && a !== b;

  // 上位互換が keep 個以上あるものを落とす。同じ性能どうしは先にあるものを残す。
  // 同時に持てない組の装備は、何個あっても上位互換 1 個分と数える (同時には 1 つしか着けられないため)
  function prune(cands, keep) {
    return cands.filter((a, ai) => {
      let dominated = 0;
      const groups = new Set();
      for (let bi = 0; bi < cands.length && dominated < keep; bi++) {
        if (bi === ai) continue;
        const b = cands[bi];
        if (b.m < a.m) continue;
        let better = b.m > a.m;
        // セット効果に数えられる装備は、同じセットに数えられる装備とだけ比べる
        let worse = a.sc.some((n, k) => b.sc[k] < n);
        for (let t = 0; t < a.g.length; t++) {
          if (b.g[t] < a.g[t]) { worse = true; break; }
          if (b.g[t] > a.g[t]) better = true;
        }
        if (worse || !(better || bi < ai)) continue;
        if (b.item.only != null) {
          if (groups.has(b.item.only)) continue;
          groups.add(b.item.only);
        }
        dominated++;
      }
      return dominated < keep;
    });
  }

  // req: {
  //   job, level ('il119' | '99' | 'all'),
  //   targets: [{ i, goal }]   goal が負なら「その値以下」(被ダメージ -40 など)
  //   objective: 'min' (少ない部位で) | 'max' (maximize のステータスを伸ばす)
  //   maximize: 伸ばすステータス。[{ i, weight, cap }] の並びで、「値 × 重み」の合計が最大になる組み合わせを探す。
  //             cap は上限 (合計の値。これを超えた分は数えない)。
  //             1 つだけのときは、ステータスの番号を maximize、上限を maximizeCap に入れてもよい
  //   fixed: { 部位: 装備 }, excluded: Set<装備の id>, base: { ステータスの番号: 装備以外の値 }
  //   extra: { 部位: [装備] }  データにない装備 (構成を選んだマントなど)
  //   sets: [{ by: { ステータスの番号: [0 部位, 1 部位, 2 部位, … のときの値] } }]  セット効果。
  //         装備の set に、数えられるセットの番号が入っている
  // }
  function solve(db, req, options) {
    const opt = Object.assign({}, DEFAULTS, options);
    const depth = opt.results * 2; // 似た候補を間引くので、多めに持っておく
    const stats = db.data.stats;
    const targets = req.targets.map((t) => ({ i: t.i, goal: t.goal, sign: t.goal < 0 ? -1 : 1 }));
    // 伸ばすステータス。上限のあるものは「上限まで届かなくてもよい目標」として進みを追いかけ、
    // 上限を超えた分は得にならないようにする (最後に、届いた分だけ良い候補として並べる)。
    // 上限の無いものは、そのまま「値 × 重み」を足していく
    const wanted = req.objective !== 'max' || req.maximize == null ? []
      : (Array.isArray(req.maximize) ? req.maximize : [{ i: req.maximize, weight: 1, cap: req.maximizeCap }])
        .filter((w) => w && stats[w.i] && w.weight !== 0)
        .map((w) => ({ i: w.i, weight: w.weight == null ? 1 : w.weight, cap: w.cap == null ? null : w.cap, sign: stats[w.i].neg ? -1 : 1 }));
    const maxMode = wanted.length > 0;
    const open = wanted.filter((w) => w.cap === null); // 上限なし
    const capped = wanted.filter((w) => w.cap !== null); // 上限あり
    const required = targets.length; // これより後ろは、届かなくてもよい目標 (上限つきで伸ばすもの)
    for (const w of capped) targets.push({ i: w.i, goal: w.cap, sign: w.sign });
    const fixed = req.fixed || {};
    const excluded = req.excluded || new Set();
    const base = req.base || {};

    // セット効果のうち、目標か伸ばすステータスに関わるものだけを、部位数として追いかける
    const allSets = req.sets || [];
    const tracked = allSets
      .map((set, index) => ({ index, by: set.by, max: Math.max(...Object.values(set.by).map((v) => v.length)) - 1 }))
      .filter((set) => targets.some((t) => set.by[t.i]) || open.some((w) => set.by[w.i]));
    const countsOf = (item) => tracked.map((set) => ((item.set || []).includes(set.index) ? 1 : 0));
    const at = (values, count) => (values ? values[Math.min(count, values.length - 1)] : 0);
    // 部位数 counts のときにセット効果で得られる分 (目標ごと) と、伸ばすステータスの分
    const bonusOf = (counts) => targets.map((t, ti) => tracked.reduce((sum, set, k) => sum + t.sign * at(set.by[t.i], counts[k]), 0));
    const bonusMax = (counts) => open.reduce((total, w) => total + w.weight * tracked.reduce((sum, set, k) => sum + w.sign * at(set.by[w.i], counts[k]), 0), 0);

    const gainOf = (item) => targets.map((t) => t.sign * (item.m.get(t.i) || 0));
    const maxOf = (item) => open.reduce((total, w) => total + w.weight * w.sign * (item.m.get(w.i) || 0), 0);

    // 固定した装備と装備以外の分を先に引いて、残りの必要量を出す
    const fixedItems = Object.values(fixed).filter(Boolean);
    // 固定した装備が塞ぐ部位 (スーツ類の「両手両脚両足装備不可」など) は空けておく
    const blocked = fixedItems.reduce((mask, item) => mask | (item.block || 0), 0);
    const need = targets.map((t, ti) => {
      let have = t.sign * (base[t.i] || 0);
      for (const item of fixedItems) have += gainOf(item)[ti];
      return t.sign * t.goal - have;
    });

    // mask は着ける部位。耳・指を 2 つまとめて決めるときは、どちらかに着けられれば候補にする
    const candidates = (slot, mask) => {
      const list = [];
      const all = db.data.items.concat((req.extra && req.extra[slot.id]) || []);
      const pool = [];
      // ジョブ専用装束 (AF・レリック・エンピリアン) は、使ってよい中でいちばん上の段階だけを候補にする
      const top = new Map();
      const piece = (item) => (TIERED.has(item.group) ? item.group + '|' + item.slots + '|' + item.ja.replace(/\+\d+$/, '') : null);
      for (const item of all) {
        if (!(item.slots & (mask || slot.mask)) || !usable(item, req.job)) continue;
        if (excluded.has(item.id) || fixedItems.includes(item)) continue;
        // 同時に持てない装備 (報酬リングなど) は、同じ組のものを固定していたら使わない
        if (fixedItems.some((f) => clash(f, item))) continue;
        // 他の部位を塞ぐ装備は、固定したときだけ使う
        if (item.block) continue;
        if (req.level === 'il119' && item.il !== 119) continue;
        if (req.level === '99' && item.lv < 99) continue;
        if (req.allow && !req.allow(item)) continue;
        const key = piece(item);
        if (key) top.set(key, Math.max(top.get(key) || 0, item.plus || 0));
        pool.push(item);
      }
      for (const item of pool) {
        const key = piece(item);
        if (key && (item.plus || 0) < top.get(key)) continue;
        const g = gainOf(item);
        const m = maxOf(item);
        const sc = countsOf(item);
        if (m <= 0 && !g.some((v, ti) => v > 0 && need[ti] > 0) && !sc.some(Boolean)) continue;
        list.push({ item, g, m, sc });
      }
      return list;
    };
    // (上限つきで伸ばす分は m に入らず、最後にまとめて数える)
    const cost = (m, used) => (maxMode ? -m + used * 1e-3 : used);
    const single = (slot, c) => ({ slots: [slot.id], items: [c.item], g: c.g, sc: c.sc, c: cost(c.m, 1) });
    const NONE = { slots: [], items: [], g: targets.map(() => 0), sc: tracked.map(() => 0), c: 0 };

    // 自動で決める部位。武器 (メイン・サブ・レンジ) は固定したものだけを使う。
    // レンジを固定したときは、矢弾が合うかどうか判断できないので矢弾も自動にしない
    const groups = [];
    const pool = new Map(); // 部位 -> 候補の装備
    const listed = []; // 部位ごとの候補 (opt.problem で返す)
    for (const slot of SLOTS) {
      if (slot.weapon || fixed[slot.id] || slot.mask & blocked) continue;
      if (slot.id === 'ammo' && fixed.range) continue;
      if (slot.id === 'ear2' || slot.id === 'ring2') {
        // 対の 1 つ目が固定されているときだけ、2 つ目を単独で決める
        const first = slot.id === 'ear2' ? 'ear1' : 'ring1';
        if (!fixed[first]) continue;
      }
      const second = slot.pair && !fixed[slot.pair] ? SLOT_BY_ID.get(slot.pair) : null;
      const cands = prune(candidates(slot, second ? slot.mask | second.mask : 0), opt.keep + (second ? 1 : 0));
      // 右耳にしか着けられない装備があるので、1 つだけ着けるときも、着けられる側に置く
      const fits = (c, s) => c.item.slots & s.mask;
      const options = [NONE, ...cands.map((c) => single(second && !fits(c, slot) ? second : slot, c))];
      if (second) {
        // 耳・指は同じ装備を 2 つ着けない
        for (let a = 0; a < cands.length; a++) {
          for (let b = a + 1; b < cands.length; b++) {
            if (clash(cands[a].item, cands[b].item)) continue; // 同時に持てない組
            // 2 つとも着けられる並べ方を探す (どちらも同じ側にしか着けられないなら、その組は無い)
            const order = fits(cands[a], slot) && fits(cands[b], second) ? [cands[a], cands[b]]
              : fits(cands[b], slot) && fits(cands[a], second) ? [cands[b], cands[a]] : null;
            if (!order) continue;
            options.push({
              slots: [slot.id, second.id],
              items: [order[0].item, order[1].item],
              g: cands[a].g.map((v, t) => v + cands[b].g[t]),
              sc: cands[a].sc.map((v, k) => v + cands[b].sc[k]),
              c: cost(cands[a].m + cands[b].m, 2),
            });
          }
        }
      }
      // 仕上げ (下の polish) で、部位ごとに入れ替えを試すための候補
      for (const s of second ? [slot, second] : [slot]) pool.set(s.id, cands.filter((c) => c.item.slots & s.mask).map((c) => c.item));
      listed.push({ slot, second, cands });
      if (opt.trace) opt.trace(slot, cands, options); // 調査用: 候補の絞り込みの結果を見る
      if (options.length > 1) groups.push({ slot, options });
    }

    // 別の解き方 (solver-ilp.js) のために、探す前の状態だけを返す
    if (opt.problem) {
      const counts = tracked.map((set) => fixedItems.filter((item) => (item.set || []).includes(set.index)).length);
      return { targets, required, need, open, capped, maxMode, tracked, counts, fixed, base, allSets, slots: listed };
    }

    // 残りの部位で稼げる上限。届く見込みのない途中経過を早めに捨てるのに使う
    const reach = groups.map(() => targets.map(() => 0));
    reach.push(targets.map(() => 0));
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      for (let t = 0; t < targets.length; t++) {
        let best = 0;
        for (const o of groups[gi].options) if (o.g[t] > best) best = o.g[t];
        reach[gi][t] = reach[gi + 1][t] + best;
      }
    }
    // セット効果で最大どれだけ得られるか (届く見込みの判定に足す)
    const setReach = targets.map((t) => tracked.reduce((sum, set) => sum + Math.max(0, ...(set.by[t.i] || [0]).map((v) => t.sign * v)), 0));
    const feasible = need.every((n, t) => t >= required || n <= reach[0][t] + setReach[t]);

    const clip = (p) => p.map((v, t) => Math.min(v, Math.max(need[t], 0)));
    const progress = (p) => {
      let sum = 0;
      for (let t = 0; t < required; t++) sum += need[t] > 0 ? Math.max(Math.min(p[t], need[t]), 0) / need[t] : 1;
      return sum;
    };

    // 途中経過は「各目標の進み」と「追いかけているセットの部位数」で区別する
    const startCounts = tracked.map((set) => Math.min(set.max, fixedItems.filter((item) => (item.set || []).includes(set.index)).length));
    // 確実に劣る途中経過を捨てる。セットの部位数が同じで、すべての目標の進みが同じか上、かつ
    // いちばん良い候補のコストも同じか下の途中経過があれば、そこから先はそちらが必ず同じか良くなる。
    // (最良の候補はこれで失われない。2 番目以降の候補は減ることがある)
    const FRONT = 40;
    function dropDominated(all) {
      const byCounts = new Map();
      for (const [key, state] of all) {
        const counts = key.slice(key.indexOf('|'));
        if (!byCounts.has(counts)) byCounts.set(counts, []);
        byCounts.get(counts).push([key, state]);
      }
      const kept = new Map();
      for (const group of byCounts.values()) {
        group.sort((a, b) => a[1].list[0].c - b[1].list[0].c);
        const front = [];
        for (const entry of group) {
          const p = entry[1].p;
          // front はコストの良い順なので、進みが同じか上のものがあれば劣っている
          let dominated = false;
          // 比べる相手は先頭の FRONT 個まで (見落としても、捨てずに残るだけで結果は変わらない)
          for (let f = 0; f < front.length && f < FRONT && !dominated; f++) {
            const q = front[f];
            dominated = true;
            for (let t = 0; t < p.length; t++) if (q[t] < p[t]) { dominated = false; break; }
          }
          if (dominated) continue;
          front.push(p);
          kept.set(entry[0], entry[1]);
        }
      }
      return kept;
    }

    // それでも多すぎるときは数で切る。進みの良いものだけを残すと「コストは良いが、まだ目標から遠い」
    // 途中経過が全滅して良い組み合わせを逃すので、進みの度合いごとに分けて、それぞれコストの良い順に残す
    const BANDS = 12;
    function trim(all, limit) {
      const bands = Array.from({ length: BANDS + 1 }, () => []);
      for (const entry of all) bands[Math.round((progress(entry[1].p) / Math.max(required, 1)) * BANDS)].push(entry);
      const used = bands.filter((band) => band.length);
      const kept = new Map();
      let room = limit;
      // 少ない組から順に取り、余った枠は残りの組に回す
      used.sort((a, b) => a.length - b.length);
      used.forEach((band, index) => {
        const quota = Math.ceil(room / (used.length - index));
        band.sort((a, b) => a[1].list[0].c - b[1].list[0].c);
        for (const [key, state] of band.slice(0, quota)) kept.set(key, state);
        room -= Math.min(quota, band.length);
      });
      return kept;
    }

    let trimmed = false; // 途中経過を数で切ったか (切ったときは最良とは限らない)
    let states;
    const start = clip(targets.map(() => 0));
    // feasible: 届かないと分かった途中経過を捨てるか
    const search = (feasible) => {
    trimmed = false;
    states = new Map();
    states.set(start.join(',') + '|' + startCounts.join(','), { p: start, n: startCounts, list: [{ c: 0, prev: null, opt: NONE }] });

    groups.forEach((group, gi) => {
      const next = new Map();
      for (const state of states.values()) {
        for (const o of group.options) {
          const p = new Array(targets.length);
          let dead = false;
          for (let t = 0; t < p.length; t++) {
            const cap = need[t] > 0 ? need[t] : 0;
            const v = state.p[t] + o.g[t];
            p[t] = v > cap ? cap : v;
            // 届かないと分かったら捨てる。そもそも届かない目標のときは、近いものを出すために残す
            if (feasible && t < required && p[t] + reach[gi + 1][t] + setReach[t] < need[t]) { dead = true; break; }
          }
          if (dead) continue;
          const n = state.n.map((v, k) => Math.min(tracked[k].max, v + o.sc[k]));
          const key = p.join(',') + '|' + n.join(',');
          let target = next.get(key);
          if (!target) next.set(key, (target = { p, n, list: [] }));
          const list = target.list;
          for (const entry of state.list) {
            const c = entry.c + o.c;
            if (list.length >= depth && c >= list[list.length - 1].c) break;
            let at = list.length;
            while (at > 0 && list[at - 1].c > c) at--;
            list.splice(at, 0, { c, prev: entry, opt: o });
            if (list.length > depth) list.pop();
          }
        }
      }
      states = next;
      if (states.size > opt.thin) states = dropDominated(states);
      if (states.size > opt.stateLimit) {
        trimmed = true;
        states = trim(states, opt.stateLimit);
      }
    });
    };
    search(feasible);
    // 目標を 1 つずつ見れば届くのに、同時には届かないことがある (全部の途中経過が捨てられて空になる)。
    // そのときは捨てずに探し直して、いちばん近いものを出す
    if (!states.size) search(false);

    // 目標に届いたものを良い順に。届くものが無ければ、いちばん近いものを返す
    // 最後にセット効果を足して判定する
    const all = [...states.values()].map((s) => {
      const bonus = bonusOf(s.n);
      const p = s.p.map((v, t) => v + bonus[t]);
      // 上限つきで伸ばすものは、上限までに届いた分だけ良くなる
      const extra = bonusMax(s.n) + capped.reduce((total, w, k) => total + w.weight * Math.max(0, Math.min(p[required + k], need[required + k])), 0);
      return { p, list: s.list.map((e) => ({ c: e.c - extra, prev: e.prev, opt: e.opt })) };
    });
    const done = all.filter((s) => s.p.every((v, t) => t >= required || v >= need[t]));
    let entries;
    if (done.length) {
      entries = done.flatMap((s) => s.list).sort((a, b) => a.c - b.c).slice(0, depth);
    } else {
      all.sort((a, b) => progress(b.p) - progress(a.p) || a.list[0].c - b.list[0].c);
      entries = all.slice(0, depth).map((s) => s.list[0]);
    }

    const built = entries.map((entry) => {
      const equip = Object.assign({}, fixed);
      for (let e = entry; e; e = e.prev) e.opt.slots.forEach((id, k) => (equip[id] = e.opt.items[k]));
      return Object.assign({ equip }, totalsOf(equip, base, allSets));
    });
    // 仕上げ。途中経過を数で切ったときは、良い組み合わせを取りこぼすことがある (空いたままの部位など)。
    // 部位を 1 つずつ入れ替えたり外したりして、目標を満たしたまま良くなるなら採る。良くならなくなるまで繰り返す
    const satisfied = (totals) => req.targets.every((t) => (t.goal < 0 ? (totals.get(t.i) || 0) <= t.goal : (totals.get(t.i) || 0) >= t.goal));
    const worth = (totals) => wanted.reduce((sum, w) => {
      const value = w.sign * (totals.get(w.i) || 0);
      return sum + w.weight * (w.cap === null ? value : Math.min(value, w.sign * w.cap));
    }, 0);
    const count = (equip) => Object.keys(equip).length;
    // 良さ: 伸ばすときは「値 × 重み」の合計 (同じなら部位が少ないほう)、少ない部位で満たすときは部位の少なさ
    const good = (a, b) => (maxMode ? a.worth > b.worth + 1e-9 || (Math.abs(a.worth - b.worth) <= 1e-9 && a.count < b.count) : a.count < b.count);
    // 目標への近さ。目標ごとに、届いた割合 (0〜1) を足したもの。すべて届けば目標の数と同じになる
    const closeness = (totals) => req.targets.reduce((sum, t) => {
      const goal = Math.abs(t.goal);
      const value = (t.goal < 0 ? -1 : 1) * (totals.get(t.i) || 0);
      return sum + (goal > 0 ? Math.max(0, Math.min(1, value / goal)) : 1);
    }, 0);
    // 目標をすべて満たすものを優先する。満たせないもの同士は、目標に近いほうが良い (同じなら上の「良さ」で比べる)
    const better = (a, b) => {
      if (a.ok !== b.ok) return a.ok;
      if (a.ok) return good(a, b);
      return a.close > b.close + 1e-9 || (Math.abs(a.close - b.close) <= 1e-9 && good(a, b));
    };
    const judge = (equip) => {
      const totals = totalsOf(equip, base, allSets).totals;
      return { ok: satisfied(totals), close: closeness(totals), worth: worth(totals), count: count(equip) };
    };
    function polish(set) {
      let equip = Object.assign({}, set.equip);
      let now = judge(equip);
      for (let round = 0; round < 6; round++) {
        let improved = false;
        for (const [slotId, items] of pool) {
          const other = slotId === 'ear1' ? 'ear2' : slotId === 'ear2' ? 'ear1' : slotId === 'ring1' ? 'ring2' : slotId === 'ring2' ? 'ring1' : null;
          for (const item of [null, ...items]) {
            if (item === (equip[slotId] || null)) continue;
            if (item && other && equip[other] === item) continue; // 耳・指に同じ装備は着けない
            if (item && Object.entries(equip).some(([id, worn]) => id !== slotId && clash(worn, item))) continue;
            const trial = Object.assign({}, equip);
            if (item) trial[slotId] = item;
            else delete trial[slotId];
            const next = judge(trial);
            if (better(next, now)) {
              equip = trial;
              now = next;
              improved = true;
            }
          }
        }
        if (!improved) break;
      }
      return Object.assign({ equip }, totalsOf(equip, base, allSets));
    }
    const polished = [];
    for (const set of built.map(polish)) {
      // 仕上げで同じ組み合わせになったものは 1 つにまとめる
      const signature = SLOTS.map((slot) => (set.equip[slot.id] ? set.equip[slot.id].id : '')).join('|');
      if (!polished.some((p) => p.signature === signature)) polished.push(Object.assign(set, { signature }));
    }
    // 良い順に並べ直す。目標をすべて満たすものが先、満たせないものは目標に近い順
    const rank = (set) => ({ ok: satisfied(set.totals), close: closeness(set.totals), worth: worth(set.totals), count: count(set.equip) });
    polished.sort((a, b) => {
      const x = rank(a);
      const y = rank(b);
      return better(x, y) ? -1 : better(y, x) ? 1 : 0;
    });
    const sets = diverse(polished, opt.results);
    // 仕上げで目標に届くようになることもあるので、届いたかどうかは仕上げた後の候補で決める
    return { reached: sets.length > 0 && satisfied(sets[0].totals), sets, groups: groups.length, exact: !trimmed };
  }

  // 1 部位だけ違う候補ばかりにならないよう、2 部位以上違うものを優先して選ぶ
  function diverse(sets, count) {
    const differs = (a, b) => {
      let n = 0;
      for (const slot of SLOTS) if (a.equip[slot.id] !== b.equip[slot.id]) n++;
      return n;
    };
    const picked = [];
    const rest = [];
    for (const set of sets) {
      if (picked.length < count && picked.every((p) => differs(p, set) >= 2)) picked.push(set);
      else rest.push(set);
    }
    return picked.concat(rest.slice(0, count - picked.length));
  }

  // セット全体の合計 (ステータスの番号 -> 値)。装備以外の分とセット効果も含める。
  // bonuses は、効いているセット効果の一覧 [{ index, count }]
  function totalsOf(equip, base, sets) {
    const totals = new Map();
    const add = (i, v) => totals.set(i, (totals.get(i) || 0) + v);
    for (const [i, v] of Object.entries(base || {})) if (v) add(Number(i), v);
    const counts = new Map();
    for (const item of Object.values(equip)) {
      if (!item) continue;
      for (const [i, v] of item.m) if (typeof v === 'number') add(i, v);
      for (const index of item.set || []) counts.set(index, (counts.get(index) || 0) + 1);
    }
    const bonuses = [];
    for (const [index, count] of counts) {
      const set = (sets || [])[index];
      if (!set) continue;
      let active = false;
      for (const [i, values] of Object.entries(set.by)) {
        const v = values[Math.min(count, values.length - 1)];
        if (v) { add(Number(i), v); active = true; }
      }
      if (active) bonuses.push({ index, count });
    }
    return { totals, bonuses };
  }

  const api = { SLOTS, solve, totalsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaSolver = api;
})(typeof window !== 'undefined' ? window : globalThis);
