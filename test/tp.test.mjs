import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../web/tp.js');

test('基本の得TP: 隔ごとの区間', () => {
  assert.equal(T.baseTp(450), 127); // 用語辞典「ストアTP」の例 (両手刀)
  assert.equal(T.baseTp(482), 134); // ウコンバサラ
  assert.equal(T.baseTp(180), 61);
  assert.equal(T.baseTp(540), 149);
  assert.equal(T.baseTp(630), 154);
  assert.equal(T.baseTp(720), 161);
  assert.equal(T.baseTp(900), 173);
  assert.equal(T.baseTp(96), 46); // 61 + (96 − 180) × 63 ÷ 360 = 46.3
});

test('ストアTP を掛けて切り捨てる', () => {
  assert.equal(T.perHit(450, 48), 187); // 用語辞典の例: 127 → 187
  assert.equal(T.perHit(482, 25), 167);
  assert.equal(T.perHit(482, 0), 134);
});

test('二刀流と格闘は、1 発ぶんの隔が半分になる', () => {
  assert.deepEqual(T.melee({ kind: 'one', main: 200, sub: 0 }), { mode: 'single', delay: 200, hands: 1, total: 200 });
  const dual = T.melee({ kind: 'one', main: 200, sub: 180, dualWield: 25 });
  assert.equal(dual.delay, 142); // 142.5 の端数は切り捨て
  assert.equal(dual.hands, 2);
  assert.equal(T.melee({ kind: 'one', main: 200, sub: 200, dualWield: 95 }).delay, 40); // 80% で止まる
  const h2h = T.melee({ kind: 'h2h', main: 96, martialArts: 200 });
  assert.equal(h2h.delay, 188);
  assert.equal(h2h.hands, 2);
});

test('WS後TP と振り数', () => {
  assert.equal(T.afterWs({ mode: 'value', value: 250 }, 167), 250);
  assert.equal(T.afterWs({ mode: 'hits', hits: 1 }, 167), 167);
  assert.equal(T.afterWs({ mode: 'hits', hits: 4 }, 167), 197);
  assert.equal(T.swings(250, 167), 5); // 250 + 167 × 5 = 1085
  assert.equal(T.swings(250, 188), 4);
  assert.equal(T.swings(1000, 100), 0);
  assert.deepEqual(T.ladder(250, 167), [250, 417, 584, 751, 918, 1085]);
});

test('n 振りにするのに要るストアTP', () => {
  const value = { mode: 'value', value: 250 };
  assert.equal(T.storeTpFor(482, value, 5), 12); // 134 × 1.12 = 150
  assert.equal(T.storeTpFor(482, value, 4), 41); // 134 × 1.41 = 188
  // 段数から計算するときは、WS後TP もストアTP で増える: 146 × 1.37 = 200、200 × 5 = 1000
  assert.equal(T.storeTpFor(528, { mode: 'hits', hits: 1 }, 4), 37);
  assert.equal(T.storeTpFor(100, value, 1), null);
});

test('平均の攻撃回数とラウンド数', () => {
  assert.equal(T.hitsPerRound({ hands: 1 }), 1);
  assert.equal(T.hitsPerRound({ doubleAttack: 40, hands: 1 }), 1.4);
  assert.ok(Math.abs(T.hitsPerRound({ doubleAttack: 40, tripleAttack: 5, hands: 1 }) - 1.48) < 1e-9);
  assert.equal(T.hitsPerRound({ doubleAttack: 50, hands: 2 }), 3);
  assert.ok(Math.abs(T.rounds(250, 167, 1.48) - 750 / (167 * 1.48)) < 1e-9);
});

test('マーシャルアーツ: メインとサポの高いほう、ギフトはメインジョブだけ', () => {
  assert.equal(T.martialArts({ job: 2, jp: 0 }), 200);
  assert.equal(T.martialArts({ job: 2, jp: 2100, maxJp: 2100 }), 210);
  assert.equal(T.martialArts({ job: 18, jp: 2100, maxJp: 2100 }), 205);
  assert.equal(T.martialArts({ job: 18, jp: 600, maxJp: 2100 }), 165);
  assert.equal(T.martialArts({ job: 1, sub: 2, subLevel: 53, jp: 2100, maxJp: 2100 }), 140);
  assert.equal(T.martialArts({ job: 1, sub: 12, subLevel: 53 }), 0);
  assert.equal(T.martialArts({ job: 2, trait: false }), 0);
});

test('格闘の得TP: 片手の隔は端数を切り捨てる (検証記事の表と合う)', () => {
  // [武器の隔, マーシャルアーツ, ストアTP, 得TP]
  const rows = [[116, 210, 0, 64], [126, 210, 0, 65], [79, 255, 0, 56], [81, 210, 0, 60], [138, 210, 10, 72], [96, 210, 10, 67], [96, 210, 0, 61], [90, 210, 0, 61], [79, 210, 10, 64], [121, 210, 5, 67], [81, 210, 5, 63], [121, 210, 25, 80]];
  for (const [main, martialArts, storeTp, tp] of rows) assert.equal(T.perHit(T.melee({ kind: 'h2h', main, martialArts }).delay, storeTp), tp);
});
