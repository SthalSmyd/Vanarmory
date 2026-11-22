// 得TP と振り数の計算。
// 出典: 区間ごとの式は BG-wiki「Tactical Points」(https://www.bg-wiki.com/ffxi/Tactical_Points)。
// FF11用語辞典「ストアTP」(https://wiki.ffo.jp/html/2608.html) の例 (隔 450 で 127、ストアTP +48 で 187) と合う。
// ヘイストやスナップショットは得TP に関わらない。二刀流・マーシャルアーツは隔を減らすので得TP も減る。
(function (root) {
  'use strict';

  // 1 ヒットの基本の得TP。delay は、二刀流やマーシャルアーツを入れたあとの 1 発ぶんの隔
  function baseTp(delay) {
    const d = Math.max(0, delay);
    let tp;
    if (d <= 180) tp = 61 + ((d - 180) * 63) / 360;
    else if (d <= 540) tp = 61 + ((d - 180) * 88) / 360;
    else if (d <= 630) tp = 149 + ((d - 540) * 20) / 360;
    else if (d <= 720) tp = 154 + ((d - 630) * 28) / 360;
    else if (d <= 900) tp = 161 + ((d - 720) * 24) / 360;
    else tp = 173 + ((d - 900) * 28) / 360;
    return Math.floor(tp);
  }

  // ストアTP を入れた 1 ヒットの得TP (基本の得TP と、ストアTP を掛けたあとの 2 回、切り捨てる)
  const perHit = (delay, storeTp) => Math.floor((baseTp(delay) * (100 + (storeTp || 0))) / 100);

  // 近接の 1 発ぶんの隔と、1 ラウンドの手数。
  //   kind: 'h2h' (格闘) | そのほか。main / sub は武器の隔 (サブが武器でなければ 0)
  //   dualWield: 二刀流 (%)。隔の短縮は 80% までなので、そこで止める
  //   martialArts: マーシャルアーツで縮む隔 (正の値)
  function melee({ kind, main, sub, dualWield, martialArts }) {
    if (kind === 'h2h') {
      // 格闘: 素手の隔 480 + 武器の隔 − マーシャルアーツ。左右それぞれ、その半分で計算する
      const total = Math.max(0, 480 + (main || 0) - (martialArts || 0));
      return { mode: 'h2h', delay: total / 2, hands: 2, total };
    }
    if (sub > 0) {
      // 二刀流: (メイン + サブ) × (1 − 二刀流) を、左右それぞれ半分ずつ
      const rate = Math.min(80, Math.max(0, dualWield || 0));
      const total = (((main || 0) + sub) * (100 - rate)) / 100;
      return { mode: 'dual', delay: total / 2, hands: 2, total, dualWield: rate };
    }
    return { mode: 'single', delay: main || 0, hands: 1, total: main || 0 };
  }

  // WS を撃った直後の TP。setting: { mode: 'value' | 'hits', value, hits }
  //   'value' は入力した値そのまま。'hits' は WS の段数から: 初段は通常の 1 ヒットぶん、2 段目以降は 1 段につき 10
  //   (FF11用語辞典「多段WS」https://wiki.ffo.jp/html/354.html)。全段命中として数える
  function afterWs(setting, hit) {
    if (!setting || setting.mode !== 'hits') return Math.max(0, Number(setting && setting.value) || 0);
    const hits = Math.max(1, Math.floor(Number(setting.hits) || 1));
    return hit + 10 * (hits - 1);
  }

  // start から hit ずつ足して goal (既定 1000) に届くまでの回数
  function swings(start, hit, goal) {
    const left = (goal || 1000) - start;
    if (left <= 0) return 0;
    return hit > 0 ? Math.ceil(left / hit) : Infinity;
  }

  // n 振り以内にするのに要るストアTP (合計の値)。届かなければ null
  function storeTpFor(delay, setting, n, goal) {
    for (let s = 0; s <= 400; s++) {
      const hit = perHit(delay, s);
      if (swings(afterWs(setting, hit), hit, goal) <= n) return s;
    }
    return null;
  }

  // 1 ラウンドの平均の攻撃回数 (命中 100% として)。クワッド → トリプル → ダブルの順に判定する。
  // 二刀流・格闘は左右それぞれで判定するものとして 2 倍する (1 ラウンド 8 回までの制限は見ていない目安)
  function hitsPerRound({ doubleAttack, tripleAttack, quadAttack, hands }) {
    const rate = (v) => Math.min(1, Math.max(0, (v || 0) / 100));
    const q = rate(quadAttack);
    const t = rate(tripleAttack);
    const d = rate(doubleAttack);
    const one = 1 + 3 * q + (1 - q) * (2 * t + (1 - t) * d);
    return Math.min(8, one * (hands || 1));
  }

  // start から goal までの、平均のラウンド数 (小数)
  function rounds(start, hit, perRound, goal) {
    const left = (goal || 1000) - start;
    if (left <= 0) return 0;
    return hit > 0 && perRound > 0 ? left / (hit * perRound) : Infinity;
  }

  // TP の積み上がり [WS後, 1 振り後, …]。goal に届いたところまで
  function ladder(start, hit, goal) {
    const out = [start];
    if (hit <= 0) return out;
    while (out[out.length - 1] < (goal || 1000) && out.length < 40) out.push(out[out.length - 1] + hit);
    return out;
  }

  // マーシャルアーツ (ジョブ特性) で縮む隔。モンク (2) とからくり士 (18) だけが覚える。
  // 出典: FF11用語辞典「マーシャルアーツ」(https://wiki.ffo.jp/html/3240.html)、BG-wiki「Martial Arts」。
  // [覚えるレベル, 累積の値]。からくり士の 4 段階目は用語辞典 Lv86・BG-wiki Lv87 と違うが、Lv99 でもサポ (59 まで) でも結果は同じ
  const MARTIAL_ARTS = {
    2: [[1, 80], [16, 100], [31, 120], [46, 140], [61, 160], [75, 180], [82, 200]],
    18: [[25, 80], [50, 100], [75, 120], [87, 140], [97, 160]],
  };
  // ギフト: [必要なジョブポイントの合計, 増える値] (BG-wiki の値)。からくり士は、ジョブポイントの項目
  // 「マーシャルアーツ効果」(20 段階で −40) もある。ほかの項目と同じく、使い切ったときだけ数える
  const MARTIAL_GIFTS = { 2: [[100, 5], [1200, 5]], 18: [[550, 5]] };
  const MARTIAL_JP = { 18: 40 };
  //   who: { job, sub, subLevel, jp (メインジョブで使ったジョブポイント), maxJp, trait, gift }
  function martialArts(who) {
    const of = (job, level) => (MARTIAL_ARTS[job] || []).reduce((value, [at, v]) => (at <= level ? v : value), 0);
    let value = 0;
    if (who.trait !== false) value = Math.max(of(who.job, 99), who.sub ? of(who.sub, who.subLevel || 0) : 0);
    if (who.gift !== false && value) {
      for (const [jp, v] of MARTIAL_GIFTS[who.job] || []) if ((who.jp || 0) >= jp) value += v;
      if (MARTIAL_JP[who.job] && (who.jp || 0) >= (who.maxJp || Infinity)) value += MARTIAL_JP[who.job];
    }
    return value;
  }

  const api = { martialArts, baseTp, perHit, melee, afterWs, swings, storeTpFor, hitsPerRound, rounds, ladder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaTP = api;
})(typeof window !== 'undefined' ? window : globalThis);
