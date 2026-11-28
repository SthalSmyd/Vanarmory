// 通常攻撃と物理 WS のダメージの計算。数値だけを受け取り、画面や装備データには触らない。
// 出典:
//   固定ダメージ・SV関数 (fSTR): FF11用語辞典 https://wiki.ffo.jp/html/329.html https://wiki.ffo.jp/html/12087.html 、BG-wiki https://www.bg-wiki.com/ffxi/FSTR
//   攻防比と倍率 (pDIF):          FF11用語辞典 https://wiki.ffo.jp/html/227.html 、BG-wiki https://www.bg-wiki.com/ffxi/PDIF
//   命中率:                       FF11用語辞典 https://wiki.ffo.jp/html/223.html 、BG-wiki https://www.bg-wiki.com/ffxi/Hit_Rate
//   クリティカル:                 FF11用語辞典 https://wiki.ffo.jp/html/1710.html 、BG-wiki https://www.bg-wiki.com/ffxi/Critical_Hit_Rate
//   WS:                           FF11用語辞典 https://wiki.ffo.jp/html/307.html https://wiki.ffo.jp/html/19049.html 、BG-wiki https://www.bg-wiki.com/ffxi/Weapon_Skill_Damage
// 用語辞典と BG-wiki で食い違うところは、区間の式がそろっている BG-wiki の値を使っている
// (レベル差の補正 1 レベル 0.05、クリティカル率の DEX 差の区切り)。
(function (root) {
  'use strict';

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const HIT_LIMIT = 99999; // 1 発のダメージの上限

  // STR の補正 (fSTR)。dstr = 自分の STR − 敵の VIT、rankDamage = 武器ランクを決めるＤ
  // (格闘は 武器のＤ + 3。スキルで増える素手のＤは入れない)。上限は ランク + 8、下限は −ランク (ランク 0 は −1)
  function fstr(dstr, rankDamage) {
    let value;
    if (dstr >= 12) value = (dstr + 4) / 4;
    else if (dstr >= 6) value = (dstr + 6) / 4;
    else if (dstr >= 1) value = (dstr + 7) / 4;
    else if (dstr >= -2) value = (dstr + 8) / 4;
    else if (dstr >= -7) value = (dstr + 9) / 4;
    else if (dstr >= -15) value = (dstr + 10) / 4;
    else if (dstr >= -21) value = (dstr + 12) / 4;
    else value = (dstr + 13) / 4;
    const rank = Math.floor(Math.max(0, rankDamage) / 9);
    return clamp(value, rank ? -rank : -1, rank + 8);
  }

  // 遠隔の STR の補正 (fSTR2)。近接の 2 倍の傾き。rankDamage は、弓や銃のＤ (矢弾のＤは入れない)。
  // 上限は (ランク + 8) × 2、下限は −ランク × 2 (ランク 0 は −2、ランク 1 は −3)。出典: BG-wiki https://www.bg-wiki.com/ffxi/FSTR
  function fstr2(dstr, rankDamage) {
    let value;
    if (dstr >= 12) value = (dstr + 4) / 2;
    else if (dstr >= 6) value = (dstr + 6) / 2;
    else if (dstr >= 1) value = (dstr + 7) / 2;
    else if (dstr >= -2) value = (dstr + 8) / 2;
    else if (dstr >= -7) value = (dstr + 9) / 2;
    else if (dstr >= -15) value = (dstr + 10) / 2;
    else if (dstr >= -21) value = (dstr + 12) / 2;
    else value = (dstr + 13) / 2;
    const rank = Math.floor(Math.max(0, rankDamage) / 9);
    return clamp(value, rank === 0 ? -2 : rank === 1 ? -3 : -rank * 2, (rank + 8) * 2);
  }

  // 格闘の素手のＤ (スキルから)。これに武器のＤを足したものが、格闘の 1 発のＤ
  const bareDamage = (skill) => Math.floor(skill * 0.11) + 3;

  // 倍率の上限 (クリティカルでないとき)。クリティカルは +1.0
  const CAPS = { one: 3.25, h2h: 3.5, gkt: 3.5, two: 3.75, scythe: 4.0, bow: 3.25, gun: 3.5 }; // bow は弓術と投てき、gun は射撃

  // ジョブ特性「ダメージ上限アップ」で上がる、攻防関数の上限。[覚えるレベル, 段階]。
  // 段階ごとの値は 256 分率 (26/256, 51/256, 77/256, 102/256, 128/256。およそ 0.1 刻み)。
  // 出典: BG-wiki https://www.bg-wiki.com/ffxi/Damage_Limit%2B (256 分率の値)、FF11用語辞典 https://wiki.ffo.jp/html/37531.html (習得レベルは両者一致)
  const LIMIT_STEPS = [0, 26 / 256, 51 / 256, 77 / 256, 102 / 256, 128 / 256];
  const LIMIT_TRAITS = {
    8: [[20, 1], [40, 2], [55, 3], [70, 4], [80, 5]], // 暗黒騎士
    2: [[30, 1], [60, 2], [90, 3]], 11: [[30, 1], [60, 2], [90, 3]], 14: [[30, 1], [60, 2], [90, 3]], // モンク・狩人・竜騎士
    1: [[40, 1], [80, 2]], 12: [[40, 1], [80, 2]], // 戦士・侍
    9: [[45, 1], [90, 2]], 18: [[45, 1], [90, 2]], 19: [[45, 1], [90, 2]], // 獣使い・からくり士・踊り子
    6: [[50, 1]], 13: [[50, 1]], 5: [[60, 1]], // シーフ・忍者・赤魔道士
  };
  // メインジョブ (Lv99) とサポートジョブ (サポのレベルで覚えている段階まで) の、高いほう。
  // サポートジョブでも効くことは、有志の報告による (https://leaguemili.com/blog-entry-2482.html)
  function limitTrait(job, sub, subLevel) {
    const of = (id, level) => (LIMIT_TRAITS[id] || []).reduce((value, [at, v]) => (at <= level ? v : value), 0);
    return LIMIT_STEPS[Math.max(of(job, 99), sub ? of(sub, subLevel || 0) : 0)];
  }
  // 攻防関数の上限 (クリティカルでないとき) = (武器種の上限 + 特性) × (1 + 物理ダメージ上限+ の %)。
  // 「ジョブ特性の加算後の数値に対して装備分が掛けられる」(FF11用語辞典 https://wiki.ffo.jp/html/37520.html)。
  // % は、装備・プライムウェポンのアフターマス・冷静と情熱のアリアを足したもの (同じ枠に足す。同じ記事)。
  // クリティカルの +1.0 は、この掛け算のあとに足す。+1.0 にも % を掛ける式は実測と合わない、という検証がある
  // (https://ffxilogdialy.hatenablog.com/entry/2020/07/25/153000 、https://www.ffxiah.com/forum/topic/56649/physical-damage-limit/ も同じ扱い)
  const limitOf = (kind, trait, percent) => (CAPS[kind] + (trait || 0)) * (1 + (percent || 0) / 100);

  // 攻防比 → 倍率の幅と平均。
  //   ratio: 攻撃力 ÷ 敵の防御力 (レベル差の補正を引いたあと)、cap: 倍率の上限、crit: クリティカルか
  // クリティカルは攻防比に 1.0 を足し、上限も 1.0 上がる。幅の中は一様な乱数
  function pdif(ratio, cap, crit) {
    const w = Math.max(0, ratio) + (crit ? 1 : 0);
    const top = cap + (crit ? 1 : 0);
    let high;
    if (w < 0.5) high = w + 0.5;
    else if (w < 0.7) high = 1;
    else if (w < 1.2) high = w + 0.3;
    else if (w < 1.5) high = w * 1.25;
    else high = w + 0.375;
    let low;
    if (w < 0.38) low = 0;
    else if (w < 1.25) low = (w * 1176) / 1024 - 448 / 1024;
    else if (w < 1.51) low = 1;
    else if (w < 2.44) low = (w * 1176) / 1024 - 755 / 1024;
    else low = w - 0.375;
    // 上限で切ったあとの平均: 上限を超えた分は、すべて上限の値になる
    let mean;
    if (high <= top) mean = (low + high) / 2;
    else if (low >= top) mean = top;
    else mean = (((top - low) * (low + top)) / 2 + (high - top) * top) / (high - low);
    return { min: Math.min(low, top), max: Math.min(high, top), mean, capped: low >= top };
  }

  // 遠隔の倍率。攻防比 (飛攻 ÷ 防御力) から決まる幅の中の乱数。近接と違い、最後の 1.00〜1.05 は掛からない。
  // クリティカルは、上限で切ったあとのダメージを 1.25 倍する (hit のほうで掛ける)。出典: BG-wiki https://www.bg-wiki.com/ffxi/PDIF
  function pdifRanged(ratio, cap) {
    const r = Math.max(0, ratio);
    let low;
    let high;
    if (r < 0.9) { low = r; high = (r * 10) / 9; } else if (r < 1.1) { low = 1; high = 1; } else { low = Math.min((r * 20) / 19 - 3 / 19, cap); high = Math.min(r, cap); }
    return { min: low, max: high, mean: (low + high) / 2, capped: low >= cap };
  }

  // 攻防関数の幅がすべて上限に張り付く攻防比 (これ以上は攻撃力を上げても変わらない)。
  // BG-wiki の「effective ratio cap」(片手 3.625、両手 4.125 など。https://www.bg-wiki.com/ffxi/PDIF)。
  // FF11用語辞典の表の「攻防比上限」は、攻防関数上限 + 0.5 (https://wiki.ffo.jp/html/227.html)。0.5 の根拠は見つかっていない
  // 近接: 下端 = 攻防比 − 0.375 が上限に届くところ。遠隔: 下端 = 攻防比 × 20/19 − 3/19。
  // クリティカルは攻防比も上限も +1 (遠隔は上限のあとに掛ける) なので、同じ値になる
  const capRatio = (cap, ranged) => (ranged ? (19 * cap + 3) / 20 : cap + 0.375);
  // 攻防関数の幅の上の端が、上限に当たり始める攻防比。近接: 上の端 = 攻防比 + 0.375。遠隔: 上の端 = 攻防比
  const capStart = (cap, ranged) => (ranged ? cap : cap - 0.375);

  // レベル差の補正を引いた攻防比。敵のほうが高いときだけ、1 レベルにつき 0.05 下がる
  // (補正の無い場所が多いので、levelGap は補正のある場所のときだけ渡す)
  // 遠隔は 1 レベルにつき 0.025 (perLevel で渡す)
  const ratioOf = (attack, defense, levelGap, perLevel) => Math.max(0, attack / Math.max(1, defense) - Math.max(0, levelGap || 0) * (perLevel || 0.05));

  // 命中率 (0〜1)。cap は上限 (%): メインの片手武器と格闘は 99、サブと両手武器は 95。下限は 20
  function hitRate(accuracy, evasion, cap, levelGap) {
    return clamp(75 + Math.floor((accuracy - evasion) / 2) - 2 * Math.max(0, levelGap || 0), 20, cap || 95) / 100;
  }

  // クリティカル率 (0〜1)。ddex = 自分の DEX − 敵の AGI、bonus = 装備・特性・メリポなどの合計 (%)
  function critRate(ddex, bonus) {
    let extra;
    if (ddex <= 6) extra = 0;
    else if (ddex <= 13) extra = 1;
    else if (ddex <= 19) extra = 2;
    else if (ddex <= 29) extra = 3;
    else if (ddex <= 39) extra = 4;
    else extra = Math.min(ddex, 50) - 35;
    return clamp(5 + extra + (bonus || 0), 0, 100) / 100;
  }

  // 遠隔のクリティカル率 (0〜1)。dagi = 自分の AGI − 敵の AGI。10 ごとに 1% (上限は分かっていない)
  const critRateRanged = (dagi, bonus) => clamp(5 + Math.max(0, Math.floor(dagi / 10)) + (bonus || 0), 0, 100) / 100;

  // 1 射にかかる時間 (秒)。delay: 弓や銃の隔 (矢弾の隔は入れない。投てきは矢弾の隔)、snapshot: スナップショット (% 。70 まで)、
  // velocity: ベロシティショットの短縮 (%)、rapid: ラピッドショットの発動率 (%。出ると 2〜50% 縮むので、平均 26% として入れる)。
  // 隔 106 が 1 秒で、撃ったあとに約 1 秒の硬直がある (BG-wiki https://www.bg-wiki.com/ffxi/Delay の近似。確定した値ではない)。ヘイストは効かない
  const shotTime = (delay, { snapshot, velocity, rapid }) => (delay * (1 - Math.min(70, snapshot || 0) / 100) * (1 - (velocity || 0) / 100) * (1 - (clamp(rapid || 0, 0, 100) / 100) * 0.26)) / 106 + 1;

  // 当たった 1 発のダメージ。
  //   base: 倍率を掛ける前の値 (Ｄ + STR の補正。WS はステータス修正と TP による倍率まで入れたもの)
  //   ratio, cap: 攻防比と倍率の上限、crit: クリティカル率 (0〜1)、critDamage: クリティカルヒットダメージ+ (%。+100 まで)
  //   taken: 敵の被ダメージの倍率 (1 = そのまま)
  // 切り捨ては、倍率を掛けたあとと、最後の乱数 (1.00〜1.05) を掛けたあとの 2 回
  //   ranged: 遠隔のとき true (倍率の出し方とクリティカルの掛かり方が違う)
  function hit({ base, ratio, cap, crit, critDamage, taken, ranged }) {
    const rate = clamp(crit || 0, 0, 1);
    const scale = taken == null ? 1 : Math.max(0, taken);
    const boost = 1 + Math.min(100, Math.max(0, critDamage || 0)) / 100;
    const one = (isCrit) => {
      if (ranged) {
        const p = pdifRanged(ratio, cap);
        const extra = (isCrit ? 1.25 * boost : 1) * scale;
        return {
          min: Math.min(HIT_LIMIT, Math.floor(Math.floor(base * p.min) * extra)),
          max: Math.min(HIT_LIMIT, Math.floor(Math.floor(base * p.max) * extra)),
          mean: Math.min(HIT_LIMIT, base * p.mean * extra),
          pdif: p,
        };
      }
      const p = pdif(ratio, cap, isCrit);
      const extra = (isCrit ? boost : 1) * scale;
      return {
        min: Math.min(HIT_LIMIT, Math.floor(Math.floor(base * p.min) * extra)),
        max: Math.min(HIT_LIMIT, Math.floor(Math.floor(Math.floor(base * p.max) * 1.05) * extra)),
        mean: Math.min(HIT_LIMIT, base * p.mean * 1.025 * extra),
        pdif: p,
      };
    };
    const normal = one(false);
    const critical = one(true);
    return {
      normal, critical, crit: rate,
      min: rate >= 1 ? critical.min : normal.min,
      max: rate > 0 ? critical.max : normal.max,
      mean: normal.mean * (1 - rate) + critical.mean * rate,
    };
  }

  // 複数回攻撃で増える回数の確率。クワッド → トリプル → ダブルの順に判定し、上が出たら下は判定しない。
  // 値は %。返すのは [増えない, +1, +2, +3] の確率。
  // twice / thrice は、武器の「時々 2 回攻撃・3 回攻撃」(ミシックウェポンのアフターマスなど)。ダブルアタックまでが出なかったときに判定する
  function extraSwings({ doubleAttack, tripleAttack, quadAttack, twice, thrice }) {
    const rate = (v) => clamp((v || 0) / 100, 0, 1);
    const q = rate(quadAttack);
    const t = rate(tripleAttack);
    const d = rate(doubleAttack);
    const none = (1 - q) * (1 - t) * (1 - d);
    const three = Math.min(rate(thrice), 1);
    const two = Math.min(rate(twice), 1 - three);
    return [none * (1 - two - three), (1 - q) * (1 - t) * d + none * two, (1 - q) * t + none * three, q];
  }
  const meanOf = (chances) => chances.reduce((sum, p, n) => sum + p * n, 0);

  // 通常攻撃の 1 ラウンド。hands: [{ hit: hit() の結果, hitRate }] (片手・両手は 1 つ、二刀流・格闘は 2 つ)。
  // 複数回攻撃は、手ごとに判定する (二刀流・格闘でも 1 ラウンド 8 回に収まる)
  //   hands[].scale: その手の攻撃すべてに掛かる平均の倍率 (エンピリアンウェポンのアフターマスの倍撃など)
  //   first: メインの 1 発目だけに足す、平均の倍率の増分 (レリックウェポンの 3 倍撃 13% なら 0.26)
  function round({ hands, multi, first }) {
    const each = hands.map((hand, i) => {
      const swings = 1 + meanOf(extraSwings(hand.multi || multi || {})); // hands[].multi: その手だけの複数回攻撃 (武器の「時々 2 回攻撃」を入れたもの)
      return {
        swings, hits: swings * hand.hitRate,
        damage: swings * hand.hitRate * hand.hit.mean * (hand.scale || 1) + (i === 0 ? hand.hitRate * hand.hit.mean * (first || 0) : 0),
      };
    });
    return {
      hands: each,
      swings: each.reduce((sum, h) => sum + h.swings, 0),
      hits: each.reduce((sum, h) => sum + h.hits, 0),
      damage: each.reduce((sum, h) => sum + h.damage, 0),
    };
  }

  // 1 ラウンドで当たる回数の確率 [0 回, 1 回, …]。手ごとに、振る回数 (複数回攻撃) と命中を掛け合わせる
  function roundHits(hands, multi) {
    let total = [1];
    for (const hand of hands) {
      const chances = extraSwings(hand.multi || multi || {});
      const p = clamp(hand.hitRate, 0, 1);
      const one = new Array(5).fill(0);
      chances.forEach((chance, extra) => {
        const swings = 1 + extra;
        for (let k = 0, c = 1; k <= swings; k++) {
          one[k] += chance * c * p ** k * (1 - p) ** (swings - k);
          c = (c * (swings - k)) / (k + 1);
        }
      });
      const next = new Array(total.length + 4).fill(0);
      total.forEach((a, i) => one.forEach((b, j) => { next[i + j] += a * b; }));
      total = next;
    }
    return total;
  }

  // WS から次の WS までの、通常攻撃のラウンド数と、撃つときの TP (平均)。
  //   start: WS を撃った直後の TP、threshold: 撃つ TP、tpHit: 1 発の得 TP、hits: roundHits の結果
  // ラウンドの途中では撃たず、ラウンドが終わって TP が threshold 以上なら撃つものとする
  function cycle({ start, threshold, tpHit, hits }) {
    if (start >= threshold) return { rounds: 0, tp: Math.min(3000, start), need: 0 };
    const stay = hits[0] || 0;
    if (!(tpHit > 0) || stay >= 1) return { rounds: Infinity, tp: threshold, need: Infinity };
    const need = Math.ceil((threshold - start) / tpHit);
    const at = new Array(need).fill(0); // これまでに n 回当たっている確率
    at[0] = 1;
    let rounds = 0;
    let tp = 0;
    for (let n = 0; n < need; n++) {
      const visits = at[n] / (1 - stay); // 1 回も当たらないラウンドは、同じところに留まる
      rounds += visits;
      for (let k = 1; k < hits.length; k++) {
        const p = visits * hits[k];
        if (!p) continue;
        if (n + k >= need) tp += p * Math.min(3000, start + (n + k) * tpHit);
        else at[n + k] += p;
      }
    }
    return { rounds, tp, need };
  }

  // ヘイストの合計 (0〜0.8)。装備は 25%、魔法は 43.75%、アビリティは 25% まで、合計は 80% まで
  const hasteOf = ({ gear, magic, ability }) => Math.min(0.8, (Math.min(25, gear || 0) + Math.min(43.75, magic || 0) + Math.min(25, ability || 0)) / 100);
  // 1 ラウンドの時間 (秒)。delay: 二刀流やマーシャルアーツを入れた 1 ラウンドぶんの隔、rawDelay: 入れる前の隔。
  // 隔 60 が 1 秒。二刀流などとヘイストを合わせて、元の 20% までしか縮まない
  const roundTime = (delay, rawDelay, haste) => Math.max(delay * (1 - haste), (rawDelay || delay) * 0.2) / 60;

  // TP 1000・2000・3000 の値の間を直線でつなぐ (TP による倍率、クリティカル率、攻撃力の補正など)
  function byTp(tp, values) {
    const t = clamp(tp, 1000, 3000);
    const [a, b, c] = values;
    return t >= 2000 ? b + ((t - 2000) * (c - b)) / 1000 : a + ((t - 1000) * (b - a)) / 1000;
  }

  // ステータス修正。stats: { STR: 値, … }、mods: { STR: 50, MND: 50 } (%)。足してから 1 回だけ切り捨てる
  const wsc = (stats, mods) => Math.floor(Object.entries(mods || {}).reduce((sum, [key, percent]) => sum + ((stats[key] || 0) * percent) / 100, 0));

  // WS の複数回攻撃で増える回数。checks 回の判定のそれぞれで extraSwings の分だけ増えるが、合計は room 回まで。
  // 返すのは { mean: 平均, max: 最大 }
  function wsExtras(chances, checks, room, firstChances) {
    let states = new Map([[0, 1]]);
    for (let i = 0; i < checks; i++) {
      const next = new Map();
      for (const [count, p] of states) {
        (i === 0 && firstChances ? firstChances : chances).forEach((chance, n) => {
          if (!chance) return;
          const total = Math.min(room, count + n);
          next.set(total, (next.get(total) || 0) + p * chance);
        });
      }
      states = next;
    }
    let mean = 0;
    let max = 0;
    for (const [count, p] of states) { mean += count * p; max = Math.max(max, count); }
    return { mean, max };
  }

  // 物理 WS のダメージ。
  //   main: { damage (Ｄ), fstr, ratio, cap, firstHitRate (1 段目。命中 +100 込み), hitRate (2 段目以降), crit, critDamage }
  //   sub:  二刀流のサブ・格闘のもう片方の手 (同じ形。firstHitRate は使わない)。無ければ null
  //   wsc: ステータス修正、ftp: 1 段目の TP による倍率 (フォシャなどの + も足したもの)、replicate: 倍率が全段に掛かるか
  //   hits: WS の段数、wsd: ウェポンスキルのダメージ+ (%。1 段目だけ)、bonus: その WS のダメージ+ (%。全段)
  //   multi: { doubleAttack, tripleAttack, quadAttack }、canCrit: クリティカルが出る WS か、taken: 敵の被ダメージの倍率
  //   hidden: 武器の隠し効果の、その WS のダメージ+ (%。全段。bonus とは別に掛ける)
  //   firstMulti: メインの 1 回目の判定だけに使う複数回攻撃 (ミシックウェポンのアフターマスの分を入れたもの)。無ければ multi
  // 攻撃の順: メインの 1 段目 → (サブがあれば) サブの 1 発 → メインの 2 段目以降 → 複数回攻撃。全部で 8 回まで。
  // 複数回攻撃の判定は、サブが無く 2 段以上の WS はメインで 2 回、それ以外はメインで 1 回。サブがあればサブでも 1 回
  function weaponSkill({ main, sub, wsc: mod, ftp, replicate, hits, wsd, bonus, hidden, multi, firstMulti, canCrit, taken }) {
    const later = replicate ? ftp : 1;
    const all = (1 + (bonus || 0) / 100) * (1 + (hidden || 0) / 100);
    const baseOf = (hand, f, first) => Math.floor((hand.damage + hand.fstr + (mod || 0)) * f * (first ? 1 + (wsd || 0) / 100 : 1) * all);
    const hitOf = (hand, f, first) => hit({
      base: baseOf(hand, f, first), ratio: hand.ratio, cap: hand.cap,
      crit: canCrit ? hand.crit : 0, critDamage: hand.critDamage, taken, ranged: hand.ranged,
    });
    const chances = extraSwings(multi || {});
    let room = 8 - 1;
    const subHits = sub && room > 0 ? 1 : 0;
    room -= subHits;
    const restHits = Math.min(room, Math.max(0, (hits || 1) - 1));
    room -= restHits;
    const checks = !sub && (hits || 1) > 1 ? 2 : 1;
    const mainExtra = wsExtras(chances, checks, room, firstMulti ? extraSwings(firstMulti) : null);
    // サブの複数回攻撃は、メインの分が入ったあとの残りの回数まで (平均は、メインの平均を引いた残りで頭打ちにする)
    const subExtra = sub
      ? { mean: Math.min(wsExtras(chances, 1, room).mean, Math.max(0, room - mainExtra.mean)), max: Math.min(3, Math.max(0, room - mainExtra.max)) }
      : { mean: 0, max: 0 };

    const first = hitOf(main, ftp, true);
    const rest = hitOf(main, later, false);
    const off = sub ? hitOf(sub, later, false) : null;
    const parts = {
      first: { count: 1, hitRate: main.firstHitRate, hit: first },
      rest: { count: restHits, hitRate: main.hitRate, hit: rest },
      multi: { count: mainExtra.mean, hitRate: main.hitRate, hit: rest, max: mainExtra.max },
      sub: off ? { count: subHits + subExtra.mean, hitRate: sub.hitRate, hit: off, max: subHits + subExtra.max } : null,
    };
    let mean = 0;
    let min = 0;
    let max = 0;
    for (const [key, part] of Object.entries(parts)) {
      if (!part) continue;
      part.mean = part.count * part.hitRate * part.hit.mean;
      mean += part.mean;
      // 最小: 段数ぶんがすべて当たり、複数回攻撃が出ず、乱数が最小のとき。最大: 複数回攻撃が最大まで出て、乱数が最大のとき
      const fixed = key === 'multi' ? 0 : key === 'sub' ? subHits : part.count;
      min += fixed * part.hit.min;
      max += (part.max != null ? part.max : part.count) * part.hit.max;
    }
    return { mean, min, max, parts, attempts: 1 + subHits + restHits + mainExtra.mean + subExtra.mean };
  }

  // ---- 魔法 WS・属性つきの物理 WS・連携 ----
  // 出典: BG-wiki https://www.bg-wiki.com/ffxi/Weapon_Skill_Damage 、https://www.bg-wiki.com/ffxi/Category:Skillchain 、
  //       FF11用語辞典「属性ウェポンスキル」https://wiki.ffo.jp/html/806.html 、「連携」https://wiki.ffo.jp/html/341.html
  // 魔法 WS の、武器のレベルで決まる基本の値 (アイテムレベル 119 の武器で 201)
  const magicBase = (level, itemLevel) => (itemLevel >= 100 ? 152 + Math.floor((itemLevel - 99) * 2.45) : 5 + Math.floor((Math.max(1, level) - 1) * 1.5));
  // 系統係数。n が 2 以上の WS (トゥルーフライトなど) は 差 × n、そのほかは 差 ÷ 2 + 8 で 32 まで
  const dstat = (diff, n) => (n >= 2 ? Math.max(0, diff * n) : clamp(diff / 2 + 8, 0, 32));
  // 魔法の分に掛かる倍率: 魔攻 ÷ 敵の魔防、敵の被魔法ダメージ、WS のダメージ+ (1 段目の分・その WS の分・武器の隠し効果)。
  // レジスト・天候と曜日・属性の相性は入れていない (すべて等倍)
  const magicScale = ({ magicAttack, magicDefense, taken, wsd, bonus, hidden }) => ((100 + (magicAttack || 0)) / (100 + Math.max(-50, magicDefense || 0)))
    * (taken == null ? 1 : Math.max(0, taken)) * (1 + (wsd || 0) / 100) * (1 + (bonus || 0) / 100) * (1 + (hidden || 0) / 100);
  // 魔法 WS のダメージ。base: magicBase の値、wsc: ステータス修正、ftp: TP による倍率、dstat: 系統係数、magicDamage: 装備の「魔法ダメージ」
  function magicSkill(o) {
    return Math.min(HIT_LIMIT, Math.floor(Math.floor((o.base + (o.wsc || 0)) * o.ftp + (o.dstat || 0) + (o.magicDamage || 0)) * magicScale(o)));
  }
  // 属性つきの物理 WS の、属性の分。physical: 物理の分のダメージ、mftp: 属性の分の倍率
  const hybridMagic = (o) => Math.min(HIT_LIMIT, (o.physical * o.mftp + (o.magicDamage || 0)) * magicScale(o));
  // 連携のダメージの倍率 (連携を作った WS の数が 2 のとき)。2 連携目以降は、もっと高くなる
  const SKILLCHAIN = { 1: 0.5, 2: 0.6, 3: 1.0, 4: 1.5 };
  // 連携のダメージ = 閉じた WS のダメージ × 倍率 × (1 + 連携ボーナス)。連携ボーナスは 50% まで。敵の被魔法ダメージが掛かる
  const skillchain = (damage, level, bonus, taken) => Math.min(HIT_LIMIT, damage * (SKILLCHAIN[level] || 0) * (1 + Math.min(50, Math.max(0, bonus || 0)) / 100) * (taken == null ? 1 : Math.max(0, taken)));

  const api = { magicBase, dstat, magicScale, magicSkill, hybridMagic, SKILLCHAIN, skillchain, HIT_LIMIT, CAPS, LIMIT_TRAITS, limitTrait, limitOf, fstr, fstr2, bareDamage, pdif, pdifRanged, capRatio, capStart, ratioOf, hitRate, critRate, critRateRanged, shotTime, hit, extraSwings, round, roundHits, cycle, hasteOf, roundTime, byTp, wsc, wsExtras, weaponSkill };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaDamage = api;
})(typeof window !== 'undefined' ? window : globalThis);
