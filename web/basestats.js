// 素のステータス (メインジョブ Lv99 の HP・MP・STR〜CHR) を、種族・ジョブ・サポートジョブ・マスターレベルから計算する。
// 表は data/base.json (装備データと一緒に data.js に入る)。画面 (builder.js) とテスト (Node) の両方から使う。
(function (root) {
  'use strict';

  const ATTRIBUTES = ['STR', 'DEX', 'VIT', 'AGI', 'INT', 'MND', 'CHR'];
  const MAIN_LEVEL = 99;

  // レベルごとの伸びを足し上げた値。rows は [そのレベルから, { 段階: 1 レベルあたりの伸び }] の並びで、
  // 次の行のレベルの手前まで同じ伸びが続く。lastLevel より上は伸びない
  function cumulative(rows, column, level, lastLevel) {
    if (!column || level < 1) return 0;
    const top = Math.min(level, lastLevel || MAIN_LEVEL);
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
      const from = rows[i][0];
      const until = i + 1 < rows.length ? rows[i + 1][0] - 1 : MAIN_LEVEL;
      if (from > top) break;
      total += (rows[i][1][column] || 0) * (Math.min(until, top) - from + 1);
    }
    return total;
  }

  // tables: data/base.json の内容。race は 'hume' など、job と sub は 'SAM' のような 3 文字。
  // sub が無ければサポートジョブなし。subLevel を省くと、マスターレベルから決まる値 (49 + マスターレベル ÷ 5)
  function baseStats(tables, race, job, sub, subLevel, masterLevel) {
    const scales = tables.scales;
    const ml = Math.max(0, Math.min(scales.masterLevel.cap, Math.floor(masterLevel || 0)));
    const raceRow = tables.races[race];
    const main = tables.jobs[job];
    const support = sub ? tables.jobs[sub] : null;
    if (!raceRow || !main || (sub && !support)) return null;
    const s = support ? Math.max(0, Math.min(59, subLevel == null ? 49 + Math.floor(ml / 5) : Math.floor(subLevel))) : 0;
    const out = {};

    // HP: 種族の分 + メインジョブの分 + サポートジョブの分の半分 + マスターレベルの分
    out.HP = cumulative(scales.hp.racial, race, MAIN_LEVEL) + cumulative(scales.hp.graded, main.HP, MAIN_LEVEL)
      + Math.floor((support ? cumulative(scales.hp.graded, support.HP, s) : 0) / 2) + scales.masterLevel.HP * ml;

    // MP: メインジョブが MP を持つかどうかで変わる。サポートジョブだけが持つ場合は、種族の分もサポのレベルで半分になる
    const supportMp = support && support.MP ? cumulative(scales.mp.graded, support.MP, s) : 0;
    if (main.MP) {
      out.MP = cumulative(scales.mp.racial, race, MAIN_LEVEL) + cumulative(scales.mp.graded, main.MP, MAIN_LEVEL)
        + Math.floor(supportMp / 2) + scales.masterLevel.MP * ml;
    } else if (support && support.MP) {
      out.MP = Math.floor(cumulative(scales.mp.racial, race, s) / 2) + Math.floor(supportMp / 2);
    } else {
      out.MP = 0;
    }

    // STR〜CHR: 段階ごとの伸びは Lv75 まで (0.5 刻みで持つ)。Lv76 以上は段階に関係なく全員同じだけ伸びる
    const half = (grade, level) => Math.floor(cumulative(scales.attributes.graded, grade, level, scales.attributes.lastGradedLevel) / 10);
    let over75 = 0;
    scales.attributes.ungraded.forEach(([from, gain], k, rows) => {
      const until = k + 1 < rows.length ? rows[k + 1][0] - 1 : MAIN_LEVEL;
      if (from <= MAIN_LEVEL) over75 += gain * (Math.min(until, MAIN_LEVEL) - from + 1);
    });
    for (const key of ATTRIBUTES) {
      const pooled = half(raceRow[key], MAIN_LEVEL) + half(main[key], MAIN_LEVEL) + Math.floor((support ? half(support[key], s) : 0) / 2);
      out[key] = Math.floor(pooled / 2) + over75 + scales.masterLevel.attributes * ml;
    }
    return out;
  }

  // ---- 攻撃・命中 ----
  // スキルから命中への換算。スキルが高いほど、1 あたりの伸びが目減りする
  function skillToAccuracy(skill) {
    const s = Math.max(0, Math.floor(skill));
    if (s <= 200) return s;
    if (s <= 400) return 200 + Math.floor(((s - 200) * 9) / 10);
    if (s <= 600) return 380 + Math.floor(((s - 400) * 8) / 10);
    return 540 + Math.floor(((s - 600) * 9) / 10);
  }
  // 命中 = スキルからの換算 + DEX × 0.75 + 装備などの命中。飛命は DEX の代わりに AGI
  function accuracy({ skill, dex, flat }) {
    return skillToAccuracy(skill) + Math.floor(((dex || 0) * 3) / 4) + (flat || 0);
  }
  const rangedAccuracy = ({ skill, agi, flat }) => accuracy({ skill, dex: agi, flat });
  // 攻撃 = 8 + スキル + STR の分 + 装備などの攻。STR の分は、片手 (メイン)・両手・遠隔が STR、格闘が STR × 0.75
  function attack({ skill, str, flat, hands }) {
    const strength = hands === 'h2h' ? Math.floor(((str || 0) * 3) / 4) : hands === 'off' ? Math.floor((str || 0) / 2) : str || 0;
    return 8 + Math.floor(skill || 0) + strength + (flat || 0);
  }
  const rangedAttack = ({ skill, str, flat }) => attack({ skill, str, flat, hands: 'ranged' });

  const api = { ATTRIBUTES, baseStats, skillToAccuracy, accuracy, rangedAccuracy, attack, rangedAttack };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaBase = api;
})(typeof window !== 'undefined' ? window : globalThis);
