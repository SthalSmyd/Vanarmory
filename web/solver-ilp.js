// セットを探す計算。整数計画法のソルバー HiGHS に解かせる。
// 「部位ごとに 1 つ選び、合計が目標を満たす中でいちばん良いもの」をそのまま式にするので、
// 途中で候補を数で切ることがなく、出た答えは最良だと保証される。
//
// 候補の装備の絞り込み (ジョブ・設定・固定・除外) は solver.js と同じものを使う。
(function (root) {
  'use strict';
  const V = typeof module !== 'undefined' && module.exports ? require('./solver.js') : root.VanaSolver;

  const DEFAULTS = {
    results: 6, // 返す候補の数
    keep: 8, // 上位互換がこの数以上ある装備は候補から外す (2 番目以降の候補のために多めに残す)
    timeLimit: 8, // 1 回の計算の打ち切り (秒)
    totalLimit: 15, // 全体の打ち切り (秒)。超えたら、そこまでに見つけた候補を返す
  };

  // 数を式に書く形にする (指数表記は変数名と紛らわしいので使わない)
  const num = (v) => {
    const text = Math.abs(v).toFixed(6).replace(/\.?0+$/, '');
    return text === '' ? '0' : text;
  };
  const signed = (v) => (v < 0 ? '-' : '') + num(v);

  // 式: [[係数, 変数名], …] を「+ 3 x1 - 2 x2」の形に。長い行は折る
  function terms(list) {
    const parts = [];
    for (const [c, name] of list) if (c) parts.push(`${c < 0 ? '-' : '+'} ${num(c)} ${name}`);
    if (!parts.length) return null;
    const lines = [];
    for (let i = 0; i < parts.length; i += 8) lines.push(parts.slice(i, i + 8).join(' '));
    return lines.join('\n  ');
  }

  // highs: load() か worker() で用意したもの。worker() のほうは別のスレッドで解くので、答えを待つ間も画面が動く。
  // options.onProgress(見つけた候補の数) は、候補が 1 つ見つかるたびに呼ばれる
  async function solve(highs, db, req, options) {
    const opt = Object.assign({}, DEFAULTS, options);
    const P = V.solve(db, req, { problem: true, keep: opt.keep });
    const { targets, required, need, open, capped, maxMode, tracked, counts } = P;

    // 変数。着ける・着けないを 0/1 で表す。耳・指は 2 部位をまとめて「この組に着ける」とし、あとで左右に振る
    const vars = []; // { name, item, c (候補), entry }
    const entries = P.slots.map((entry, e) => {
      const list = entry.cands.map((c, j) => {
        const v = { name: `x${e}_${j}`, item: c.item, c, entry };
        vars.push(v);
        return v;
      });
      return { slot: entry.slot, second: entry.second, list };
    });

    const rows = []; // 制約の行
    for (const entry of entries) {
      if (!entry.list.length) continue;
      if (!entry.second) {
        rows.push(`${terms(entry.list.map((v) => [1, v.name]))} <= 1`);
        continue;
      }
      // 耳・指: 合わせて 2 つまで。片側にしか着けられない装備 (右耳専用など) は、その側に 1 つまで
      rows.push(`${terms(entry.list.map((v) => [1, v.name]))} <= 2`);
      for (const side of [entry.slot, entry.second]) {
        const other = side === entry.slot ? entry.second : entry.slot;
        const onlyHere = entry.list.filter((v) => v.item.slots & side.mask && !(v.item.slots & other.mask));
        if (onlyHere.length > 1) rows.push(`${terms(onlyHere.map((v) => [1, v.name]))} <= 1`);
      }
    }
    // 同時に持てない装備 (報酬リングなど) は、同じ組から 1 つまで
    const exclusive = new Map();
    for (const v of vars) {
      if (v.item.only == null) continue;
      if (!exclusive.has(v.item.only)) exclusive.set(v.item.only, []);
      exclusive.get(v.item.only).push(v);
    }
    for (const list of exclusive.values()) if (list.length > 1) rows.push(`${terms(list.map((v) => [1, v.name]))} <= 1`);

    // セット効果。「c 部位以上そろっている」を 0/1 の変数 y で表し、段ごとの増える分を足す
    const SLOTS = V.SLOTS.length;
    const steps = []; // { name, k, c }
    tracked.forEach((set, k) => {
      const members = vars.filter((v) => v.c.sc[k]).map((v) => [1, v.name]);
      for (let c = 1; c <= set.max; c++) {
        const name = `y${k}_${c}`;
        steps.push({ name, k, c });
        // y = 1 なら c 部位以上、y = 0 なら c 部位未満
        rows.push(`${terms([[c, name], ...members.map(([, n]) => [-1, n])])} <= ${counts[k]}`);
        rows.push(`${terms([...members, [-SLOTS, name]])} <= ${c - 1 - counts[k]}`);
      }
    });
    const at = (values, count) => (values ? values[Math.min(count, values.length - 1)] : 0);
    // セット効果が、あるステータス (番号 i、向き sign) に足す分。固定した装備だけで得ている分は定数として返す
    const bonusTerms = (i, sign) => {
      const list = [];
      let constant = 0;
      tracked.forEach((set, k) => {
        if (!set.by[i]) return;
        constant += sign * at(set.by[i], 0);
        for (const step of steps) {
          if (step.k === k) list.push([sign * (at(set.by[i], step.c) - at(set.by[i], step.c - 1)), step.name]);
        }
      });
      return { list, constant };
    };

    // 目標 t の「進み」= 装備の分 + セット効果の分
    const progress = targets.map((t, ti) => {
      const bonus = bonusTerms(t.i, t.sign);
      return { list: vars.map((v) => [v.c.g[ti], v.name]).concat(bonus.list), constant: bonus.constant };
    });

    // 上限つきで伸ばすステータス: z は「上限までに届いた分」
    const extras = []; // 連続の変数 { name, lower, upper }
    const gain = []; // 目的 (大きいほど良い)
    if (maxMode) {
      for (const w of open) {
        const bonus = bonusTerms(w.i, w.sign);
        for (const v of vars) gain.push([w.weight * w.sign * (v.item.m.get(w.i) || 0), v.name]);
        for (const [c, name] of bonus.list) gain.push([w.weight * c, name]);
      }
      capped.forEach((w, k) => {
        const p = progress[required + k];
        const name = `z${k}`;
        extras.push({ name, lower: -1e6, upper: Math.max(need[required + k], 0) });
        rows.push(`${terms([[1, name], ...p.list.map(([c, n]) => [-c, n])])} <= ${signed(p.constant)}`);
        gain.push([w.weight, name]);
      });
      for (const v of vars) gain.push([-1e-3, v.name]); // 同じ良さなら部位が少ないほう
    } else {
      for (const v of vars) gain.push([-1, v.name]); // 少ない部位で
    }

    // 目標の行。strict = false のときは「届いた割合」を変数にして、それを伸ばす (届かない目標のとき)
    const build = (strict, cuts) => {
      const lines = [];
      const objective = gain.slice();
      const more = extras.slice();
      for (let t = 0; t < required; t++) {
        if (need[t] <= 0 && !progress[t].list.some(([c]) => c < 0)) continue; // 装備以外で満たしていて、減ることもない
        const p = progress[t];
        const rhs = need[t] - p.constant;
        if (strict) {
          lines.push(`${terms(p.list) || '0 x_none'} >= ${signed(rhs)}`);
        } else if (need[t] > 0) {
          // r ≤ 進み ÷ 必要な量、r ≤ 1
          const name = `r${t}`;
          more.push({ name, lower: -1e6, upper: 1 });
          const right = -p.constant;
          lines.push(`${terms([[need[t], name], ...p.list.map(([c, n]) => [-c, n])])} <= ${signed(right)}`);
          objective.push([1e4, name]);
        }
      }
      // 同じ係数の変数が何度も出ないようにまとめる
      const merged = new Map();
      for (const [c, name] of objective) merged.set(name, (merged.get(name) || 0) + c);
      const lp = [
        'Maximize',
        ` obj: ${terms([...merged].map(([name, c]) => [c, name])) || '0 x_none'}`,
        'Subject To',
        ...rows.concat(lines, cuts).map((row, index) => ` c${index}: ${row}`),
        'Bounds',
        ' x_none = 0',
        ...more.map((x) => ` ${signed(x.lower)} <= ${x.name} <= ${signed(x.upper)}`),
        'Binary',
        ...chunk(vars.map((v) => v.name).concat(steps.map((s) => s.name)), 12).map((names) => ` ${names.join(' ')}`),
        'End',
      ];
      return lp.join('\n');
    };

    const satisfied = (totals) => req.targets.every((t) => (t.goal < 0 ? (totals.get(t.i) || 0) <= t.goal : (totals.get(t.i) || 0) >= t.goal));
    const sets = [];
    const cuts = [];
    let strict = true;
    let exact = true;
    let calls = 0;
    const started = Date.now();
    while (sets.length < opt.results) {
      const left = opt.totalLimit - (Date.now() - started) / 1000;
      if (sets.length && left <= 0) break;
      calls++;
      const result = await highs.solve(build(strict, cuts), { output_flag: false, time_limit: Math.max(1, Math.min(opt.timeLimit, left)) });
      const found = result.Columns && (result.Status === 'Optimal' || /limit/i.test(result.Status)) && Number.isFinite(result.ObjectiveValue);
      if (!found) {
        // 1 つ目から解が無ければ、目標に届かない。いちばん近いものを探す形に切り替える
        if (strict && !sets.length && result.Status === 'Infeasible') { strict = false; continue; }
        break;
      }
      if (result.Status !== 'Optimal') exact = false;
      const chosen = vars.filter((v) => result.Columns[v.name] && result.Columns[v.name].Primal > 0.5);
      if (!chosen.length) break;
      const equip = Object.assign({}, P.fixed);
      for (const entry of entries) {
        const picked = chosen.filter((v) => entry.list.includes(v)).map((v) => v.item);
        if (!entry.second) { if (picked[0]) equip[entry.slot.id] = picked[0]; continue; }
        // 左右に振る。片側にしか着けられないものを先に置く
        picked.sort((a, b) => (a.slots & entry.slot.mask && a.slots & entry.second.mask ? 1 : 0) - (b.slots & entry.slot.mask && b.slots & entry.second.mask ? 1 : 0));
        for (const item of picked) {
          const side = item.slots & entry.slot.mask && !equip[entry.slot.id] ? entry.slot : entry.second;
          equip[side.id] = item;
        }
      }
      sets.push(Object.assign({ equip }, V.totalsOf(equip, P.base, P.allSets)));
      // 次は、選んだ装備のうち 2 つ以上が違うものを探す (1 つだけ違う候補ばかりにしない)
      cuts.push(`${terms(chosen.map((v) => [1, v.name]))} <= ${Math.max(chosen.length - 2, 0)}`);
      if (opt.onProgress) opt.onProgress(sets.length);
    }
    return {
      reached: sets.length > 0 && satisfied(sets[0].totals), sets, exact, calls,
      size: { vars: vars.length + steps.length, rows: rows.length },
    };
  }

  const chunk = (list, n) => {
    const out = [];
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
  };

  // base64 の文字列を、中身のバイト列に戻す
  function decode(base64) {
    if (typeof Buffer !== 'undefined') return Buffer.from(base64, 'base64');
    const text = atob(base64);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  }

  // HiGHS を読み込む。factory は vendor/highs.js の Module、base64 は vendor/highs-wasm.js の HIGHS_WASM_BASE64。
  // file:// で開いたページは .wasm を取りに行けないので、スクリプトとして持っている中身を直接渡す
  function load(factory, base64) {
    const bytes = decode(base64);
    return factory({
      instantiateWasm: (info, receive) => {
        WebAssembly.instantiate(bytes, info).then((r) => receive(r.instance, r.module));
        return {};
      },
    });
  }

  // 別のスレッド (Web Worker) で HiGHS を動かす。画面のスレッドで解くと、答えが出るまで画面が固まるため。
  // file:// で開いたページは Worker のスクリプトを取りに行けないので、読み込み済みの factory の中身から
  // その場で Worker を作る。返すものは load() と同じく solve(式, 設定) を持つ (こちらは答えを Promise で返す)
  function worker(factory, base64) {
    const inside = function () {
      let highs = null;
      self.onmessage = async (event) => {
        const message = event.data;
        try {
          if (message.wasm) {
            const bytes = message.wasm;
            highs = await self.Module({
              instantiateWasm: (info, receive) => {
                WebAssembly.instantiate(bytes, info).then((r) => receive(r.instance, r.module));
                return {};
              },
            });
            self.postMessage({ id: message.id });
          } else {
            self.postMessage({ id: message.id, result: highs.solve(message.lp, message.options) });
          }
        } catch (error) {
          self.postMessage({ id: message.id, error: String(error && error.message || error) });
        }
      };
    };
    // vendor/highs.js の Module は、_scriptName だけを外から見ている関数
    const source = `var _scriptName; self.Module = ${factory.toString()};\n(${inside.toString()})();`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const thread = new Worker(url);
    const waiting = new Map(); // 送った番号 -> 答えを受け取る関数
    let next = 0;
    let dead = null;
    const fail = (error) => {
      dead = error;
      for (const { ng } of waiting.values()) ng(error);
      waiting.clear();
      thread.terminate();
    };
    thread.onmessage = (event) => {
      const { id, result, error } = event.data;
      const entry = waiting.get(id);
      waiting.delete(id);
      // HiGHS は一度失敗すると続けて使えないことがあるので、失敗したらこの Worker は捨てる
      if (error) { if (entry) entry.ng(new Error(error)); fail(new Error(error)); } else if (entry) entry.ok(result);
    };
    thread.onerror = (event) => fail(new Error(event.message || 'Worker を始められませんでした'));
    const send = (message) => new Promise((ok, ng) => {
      if (dead) return ng(dead);
      const id = next++;
      waiting.set(id, { ok, ng });
      thread.postMessage(Object.assign({ id }, message));
    });
    return send({ wasm: decode(base64) }).then(() => {
      URL.revokeObjectURL(url);
      return { solve: (lp, options) => send({ lp, options }), stop: () => fail(new Error('中止しました')), alive: () => !dead };
    });
  }

  const api = { solve, load, worker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaSolverILP = api;
})(typeof window !== 'undefined' ? window : globalThis);
