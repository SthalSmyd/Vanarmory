import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prepare } = require('../web/search.js');
const V = require('../web/solver.js');
const I = require('../web/solver-ilp.js');

// HiGHS は、画面と同じく web/vendor に置いたものを読み込む
globalThis.window = globalThis.window || {};
require('../web/vendor/highs-wasm.js');
const highs = await I.load(require('../web/vendor/highs.js'), globalThis.window.HIGHS_WASM_BASE64);

const SLOT = { ammo: 1 << 3, head: 1 << 4, body: 1 << 5, hands: 1 << 6, ear: (1 << 11) | (1 << 12), ear2: 1 << 12, ring: (1 << 13) | (1 << 14) };
let nextId = 1;
const item = (ja, slots, stats, extra = {}) => ({
  id: nextId++, ja, en: ja, lv: 99, il: 119, su: 0, slots, jobs: 2 ** 12, skill: 0, desc: '', aug: '',
  s: Object.entries(stats).flatMap(([k, v]) => [Number(k), v]), ...extra,
});
// 0: ストアTP  1: 被ダメージ  2: 攻
const make = (items) => prepare({
  stats: [
    { k: 'ストアTP', n: 1, num: 1, neg: 0, u: '' },
    { k: '被ダメージ', n: 1, num: 1, neg: 1, u: '%' },
    { k: '攻', n: 1, num: 1, neg: 0, u: '' },
  ],
  items,
});
const req = (extra) => ({ job: 12, level: 'all', targets: [], objective: 'min', fixed: {}, excluded: new Set(), base: {}, ...extra });
const names = (set) => Object.values(set.equip).map((i) => i.ja).sort();

test('少ない部位で目標を満たす', async () => {
  const db = make([item('頭5', SLOT.head, { 0: 5 }), item('頭10', SLOT.head, { 0: 10 }), item('胴8', SLOT.body, { 0: 8 }), item('弾3', SLOT.ammo, { 0: 3 })]);
  const r = await I.solve(highs, db, req({ targets: [{ i: 0, goal: 10 }] }));
  assert.equal(r.reached, true);
  assert.equal(r.exact, true);
  assert.deepEqual(names(r.sets[0]), ['頭10']);
});

test('耳・指は同じ装備を 2 つ着けず、右耳専用は右耳に、同時に持てない組は 1 つだけ', async () => {
  const db = make([
    item('報酬A', SLOT.ring, { 0: 10 }, { only: 0 }), item('報酬B', SLOT.ring, { 0: 9 }, { only: 0 }), item('普通の指', SLOT.ring, { 0: 3 }),
    item('右耳専用A', SLOT.ear2, { 0: 8 }), item('右耳専用B', SLOT.ear2, { 0: 7 }), item('普通の耳', SLOT.ear, { 0: 2 }),
  ]);
  const r = await I.solve(highs, db, req({ targets: [{ i: 0, goal: 1 }], objective: 'max', maximize: [{ i: 0, weight: 1 }] }));
  assert.deepEqual(names(r.sets[0]), ['右耳専用A', '報酬A', '普通の指', '普通の耳']);
  assert.equal(r.sets[0].equip.ear2.ja, '右耳専用A');
  assert.equal(r.sets[0].totals.get(0), 23);
});

test('セット効果と上限を数える', async () => {
  // 頭と胴をそろえると攻 +50。攻は 60 が上限なので、それ以上は伸ばさずに部位を減らす
  const db = make([
    item('セット頭', SLOT.head, { 2: 5 }, { set: [0] }), item('セット胴', SLOT.body, { 2: 5 }, { set: [0] }),
    item('強い頭', SLOT.head, { 2: 30 }), item('強い胴', SLOT.body, { 2: 20 }), item('弾', SLOT.ammo, { 2: 1 }),
  ]);
  const sets = [{ by: { 2: [0, 0, 50] } }];
  const open = await I.solve(highs, db, req({ sets, targets: [{ i: 0, goal: 0 }], objective: 'max', maximize: [{ i: 2, weight: 1 }] }));
  assert.deepEqual(names(open.sets[0]), ['セット胴', 'セット頭', '弾']);
  assert.equal(open.sets[0].totals.get(2), 61);
  const capped = await I.solve(highs, db, req({ sets, targets: [{ i: 0, goal: 0 }], objective: 'max', maximize: [{ i: 2, weight: 1, cap: 60 }] }));
  assert.deepEqual(names(capped.sets[0]), ['セット胴', 'セット頭']);
});

test('届かないときは、いちばん近いものを出す', async () => {
  const db = make([item('頭STP', SLOT.head, { 0: 10 }), item('頭攻', SLOT.head, { 2: 10 }), item('弾攻', SLOT.ammo, { 2: 3 })]);
  const r = await I.solve(highs, db, req({ targets: [{ i: 0, goal: 10 }, { i: 2, goal: 10 }] }));
  assert.equal(r.reached, false);
  assert.equal(r.sets[0].equip.ammo.ja, '弾攻');
});

test('でたらめな装備で、いまの計算 (確実なとき) と最良の値が同じになる', async () => {
  let seed = 7;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const places = [SLOT.ammo, SLOT.head, SLOT.body, SLOT.hands, SLOT.ear, SLOT.ring];
  for (let round = 0; round < 30; round++) {
    const items = [];
    for (let n = 0; n < 24; n++) items.push(item('i' + n, places[rnd(places.length)], { 0: rnd(8), 1: -rnd(6), 2: rnd(20) - 3 }, rnd(5) === 0 ? { only: 0 } : {}));
    const db = make(items);
    const request = req({ targets: [{ i: 0, goal: 12 + rnd(10) }, { i: 1, goal: -(6 + rnd(8)) }], objective: 'max', maximize: [{ i: 2, weight: 1 }] });
    const a = V.solve(db, request, { keep: 1000, stateLimit: 1e9, thin: 1e9 });
    const b = await I.solve(highs, db, request, { keep: 1000 });
    assert.equal(b.reached, a.reached, 'round ' + round);
    if (a.reached) assert.equal(b.sets[0].totals.get(2) || 0, a.sets[0].totals.get(2) || 0, 'round ' + round);
  }
});

test('同じ良さの中からは、重みの合計が大きいものを選ぶ (目標と「伸ばす」は落とさない)', async () => {
  const db = make([
    item('頭STP10', SLOT.head, { 0: 10 }), item('頭STP10攻20', SLOT.head, { 0: 10, 2: 20 }), item('頭STP9攻99', SLOT.head, { 0: 9, 2: 99 }),
    item('胴STP5', SLOT.body, { 0: 5 }), item('胴攻30', SLOT.body, { 2: 30 }),
    item('作ったマント', SLOT.ammo, { 0: 3 }, { made: true }), item('実在の矢弾', SLOT.ammo, { 0: 3 }),
  ]);
  const tie = [{ i: 2, weight: 1, sign: 1, cap: null }];
  // 少ない部位で: ストアTP 10 は頭 1 つで届く。同じ 1 部位なら、攻の付いたほう。攻のために部位は増やさない
  const min = await I.solve(highs, db, req({ targets: [{ i: 0, goal: 10 }], tie }));
  assert.deepEqual(names(min.sets[0]), ['頭STP10攻20']);
  // 伸ばす: ストアTP がいちばん大きい組み合わせ (頭 10 + 胴 5 + 矢弾 3) は変えない。頭は攻の付いたほう、矢弾は実在のほう
  const max = await I.solve(highs, db, req({ targets: [{ i: 0, goal: 1 }], objective: 'max', maximize: [{ i: 0, weight: 1 }], tie }));
  assert.deepEqual(names(max.sets[0]), ['実在の矢弾', '胴STP5', '頭STP10攻20']);
  assert.equal(max.sets[0].totals.get(0), 18);
  // 重みが無いときも、同じ良さなら実在の装備
  const plain = await I.solve(highs, db, req({ targets: [{ i: 0, goal: 1 }], objective: 'max', maximize: [{ i: 0, weight: 1 }] }));
  assert.equal(names(plain.sets[0]).includes('実在の矢弾'), true);
});
