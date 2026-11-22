import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prepare } = require('../web/search.js');
const { solve } = require('../web/solver.js');

const SLOT = { ammo: 1 << 3, head: 1 << 4, body: 1 << 5, ear: (1 << 11) | (1 << 12), ring: (1 << 13) | (1 << 14), main: 1 };
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

test('少ない部位で目標を満たす', () => {
  const db = make([
    item('頭5', SLOT.head, { 0: 5 }),
    item('頭10', SLOT.head, { 0: 10 }),
    item('胴8', SLOT.body, { 0: 8 }),
    item('弾3', SLOT.ammo, { 0: 3 }),
  ]);
  const r = solve(db, req({ targets: [{ i: 0, goal: 10 }] }));
  assert.equal(r.reached, true);
  assert.deepEqual(names(r.sets[0]), ['頭10']);
  assert.equal(r.sets[0].totals.get(0), 10);
  // 2 番目以降は部位が増える
  assert.equal(Object.keys(r.sets[1].equip).length, 2);
});

test('負の目標 (被ダメージ) と複数の目標を同時に満たす', () => {
  const db = make([
    item('頭A', SLOT.head, { 0: 10 }),
    item('頭B', SLOT.head, { 0: 4, 1: -7 }),
    item('胴A', SLOT.body, { 0: 6, 1: -3 }),
    item('胴B', SLOT.body, { 1: -9 }),
  ]);
  const r = solve(db, req({ targets: [{ i: 0, goal: 10 }, { i: 1, goal: -10 }] }));
  assert.equal(r.reached, true);
  assert.deepEqual(names(r.sets[0]), ['胴A', '頭B']);
  assert.equal(r.sets[0].totals.get(1), -10);
});

test('耳は同じ装備を 2 つ使わず、別の 2 つを組み合わせる', () => {
  const db = make([item('耳5', SLOT.ear, { 0: 5 }), item('耳4', SLOT.ear, { 0: 4 }), item('耳1', SLOT.ear, { 0: 1 })]);
  const r = solve(db, req({ targets: [{ i: 0, goal: 9 }] }));
  assert.deepEqual(names(r.sets[0]), ['耳4', '耳5']);
  // 耳5 を 2 つ着ければ届く値には届かない
  assert.equal(solve(db, req({ targets: [{ i: 0, goal: 10 }] })).reached, false);
});

test('固定した装備と装備以外の分は目標から引かれ、固定した部位は変えない', () => {
  const db = make([
    item('頭10', SLOT.head, { 0: 10 }),
    item('頭2', SLOT.head, { 0: 2 }),
    item('胴8', SLOT.body, { 0: 8 }),
    item('刀', SLOT.main, { 0: 10 }),
  ]);
  const head2 = db.data.items[1];
  const katana = db.data.items[3];
  const r = solve(db, req({ targets: [{ i: 0, goal: 25 }], fixed: { head: head2, main: katana }, base: { 0: 5 } }));
  assert.equal(r.reached, true);
  assert.deepEqual(names(r.sets[0]), ['刀', '胴8', '頭2']);
  assert.equal(r.sets[0].totals.get(0), 25);
});

test('武器は固定しない限り使わない。除外した装備も使わない', () => {
  const db = make([item('刀', SLOT.main, { 0: 10 }), item('頭10', SLOT.head, { 0: 10 }), item('頭9', SLOT.head, { 0: 9 })]);
  assert.equal(solve(db, req({ targets: [{ i: 0, goal: 15 }] })).reached, false);
  const r = solve(db, req({ targets: [{ i: 0, goal: 9 }], excluded: new Set([db.data.items[1].id]) }));
  assert.deepEqual(names(r.sets[0]), ['頭9']);
});

test('目標を満たしたうえで別のステータスを伸ばす', () => {
  const db = make([
    item('頭STP', SLOT.head, { 0: 10 }),
    item('頭攻', SLOT.head, { 2: 30 }),
    item('胴STP', SLOT.body, { 0: 10, 2: 5 }),
    item('胴攻', SLOT.body, { 2: 40 }),
    item('弾攻', SLOT.ammo, { 2: 7 }),
  ]);
  const r = solve(db, req({ targets: [{ i: 0, goal: 10 }], objective: 'max', maximize: 2 }));
  assert.equal(r.reached, true);
  assert.deepEqual(names(r.sets[0]), ['弾攻', '胴攻', '頭STP']);
  assert.equal(r.sets[0].totals.get(2), 47);
});

test('他の部位を塞ぐ装備は固定したときだけ使い、塞がれた部位は空ける', () => {
  const db = make([
    item('スーツ', SLOT.body, { 0: 30 }, { block: 1 << 4 }),
    item('頭10', SLOT.head, { 0: 10 }),
    item('弾3', SLOT.ammo, { 0: 3 }),
  ]);
  assert.equal(solve(db, req({ targets: [{ i: 0, goal: 20 }] })).reached, false);
  const r = solve(db, req({ targets: [{ i: 0, goal: 33 }], fixed: { body: db.data.items[0] } }));
  assert.deepEqual(names(r.sets[0]), ['スーツ', '弾3']);
  assert.equal(solve(db, req({ targets: [{ i: 0, goal: 40 }], fixed: { body: db.data.items[0] } })).reached, false);
});

test('届かないときは、いちばん近い組み合わせを返す', () => {
  const db = make([item('頭10', SLOT.head, { 0: 10 }), item('胴8', SLOT.body, { 0: 8 })]);
  const r = solve(db, req({ targets: [{ i: 0, goal: 50 }] }));
  assert.equal(r.reached, false);
  assert.equal(r.sets[0].totals.get(0), 18);
});

test('ジョブが装備できないものは使わない', () => {
  const db = make([item('頭10', SLOT.head, { 0: 10 }, { jobs: 2 ** 1 }), item('頭3', SLOT.head, { 0: 3 })]);
  const r = solve(db, req({ targets: [{ i: 0, goal: 3 }] }));
  assert.deepEqual(names(r.sets[0]), ['頭3']);
});

test('セット効果を数えて、部位数で変わる分も目標に入れる', () => {
  const member = { set: [0] };
  const db = make([
    item('頭組', SLOT.head, { 0: 2 }, member),
    item('胴組', SLOT.body, { 0: 2 }, member),
    item('頭単', SLOT.head, { 0: 5 }),
    item('胴単', SLOT.body, { 0: 5 }),
  ]);
  // 2 部位でストアTP+10 のセット。単品 (5+5=10) では届かない 14 に、組 (2+2+10) で届く
  const sets = [{ by: { 0: [0, 0, 10] } }];
  const r = solve(db, req({ targets: [{ i: 0, goal: 14 }], sets }));
  assert.equal(r.reached, true);
  assert.deepEqual(names(r.sets[0]), ['胴組', '頭組']);
  assert.equal(r.sets[0].totals.get(0), 14);
  assert.deepEqual(r.sets[0].bonuses, [{ index: 0, count: 2 }]);
  // セット効果を使わなくても届く目標では、強い単品を選ぶ
  assert.deepEqual(names(solve(db, req({ targets: [{ i: 0, goal: 5 }], sets })).sets[0]).length, 1);
  // 固定した装備もセットの部位として数える
  const fixed = solve(db, req({ targets: [{ i: 0, goal: 14 }], sets, fixed: { head: db.data.items[0] } }));
  assert.deepEqual(names(fixed.sets[0]), ['胴組', '頭組']);
});

test('伸ばすステータスに上限があるときは、上限を超える分を追わない', () => {
  // 0: ストアTP  2: 攻。攻を伸ばすが上限は 30
  const db = make([
    item('頭攻40', SLOT.head, { 2: 40 }),
    item('頭攻30STP5', SLOT.head, { 0: 5, 2: 30 }),
    item('胴攻50', SLOT.body, { 2: 50 }),
    item('胴STP5', SLOT.body, { 0: 5 }),
  ]);
  // 上限なし: 攻が最大の組み合わせ (STP の目標 5 は頭で満たす)
  const free = solve(db, req({ targets: [{ i: 0, goal: 5 }], objective: 'max', maximize: 2 }));
  assert.equal(free.sets[0].totals.get(2), 80);
  // 上限 30: 攻は頭だけで上限に届くので、胴の攻 50 は要らない
  const capped = solve(db, req({ targets: [{ i: 0, goal: 5 }], objective: 'max', maximize: 2, maximizeCap: 30 }));
  assert.equal(capped.reached, true);
  assert.deepEqual(names(capped.sets[0]), ['頭攻30STP5']);
  // 上限に届かない場合でも、目標を満たしていれば届いたところまでで候補にする
  const far = solve(db, req({ targets: [{ i: 0, goal: 10 }], objective: 'max', maximize: 2, maximizeCap: 500 }));
  assert.equal(far.reached, true);
  assert.deepEqual(names(far.sets[0]), ['胴STP5', '頭攻30STP5']);
});

// 小さな問題をたくさん作り、総当たりの答えと突き合わせる。途中経過を細かく間引く設定でも最良を逃さないこと
test('ランダムな問題で、総当たりと同じ最良の値になる', () => {
  let seed = 12345;
  const random = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const slots = [['head', SLOT.head], ['body', SLOT.body], ['ammo', SLOT.ammo], ['ring', SLOT.ring]];
  for (let round = 0; round < 60; round++) {
    const items = [];
    for (const [name, mask] of slots) {
      for (let n = 0; n < (name === 'ring' ? 5 : 4); n++) {
        items.push(item(`${name}${n}`, mask, { 0: random(8), 1: -random(6), 2: random(30) }, random(3) === 0 ? { set: [0] } : {}));
      }
    }
    const db = make(items);
    const sets = [{ by: { 0: [0, 0, 4, 9], 2: [0, 0, 10, 10] } }];
    const targets = [{ i: 0, goal: 6 + random(10) }, { i: 1, goal: -(2 + random(6)) }];
    const cap = random(2) ? 40 + random(40) : null;

    // 総当たり: 部位ごとに「着けない」も含めて全部試す (指は別の 2 つまで)
    const pools = slots.map(([name, mask]) => db.data.items.filter((i) => i.slots === mask));
    const rings = pools[3];
    const ringChoices = [[]].concat(rings.map((r) => [r]));
    rings.forEach((a, x) => rings.slice(x + 1).forEach((b) => ringChoices.push([a, b])));
    let best = null;
    for (const h of [null, ...pools[0]]) for (const b of [null, ...pools[1]]) for (const a of [null, ...pools[2]]) for (const rs of ringChoices) {
      const worn = [h, b, a, ...rs].filter(Boolean);
      const total = [0, 0, 0];
      for (const w of worn) for (const [i, v] of w.m) total[i] += v;
      const count = Math.min(3, worn.filter((w) => w.set).length);
      total[0] += sets[0].by[0][count];
      total[2] += sets[0].by[2][count];
      if (total[0] < targets[0].goal || total[1] > targets[1].goal) continue;
      const value = cap == null ? total[2] : Math.min(total[2], cap);
      if (best === null || value > best) best = value;
    }

    const r = solve(db, req({ targets, objective: 'max', maximize: 2, maximizeCap: cap, sets }), { thin: 5, stateLimit: 100000 });
    assert.equal(r.reached, best !== null, `round ${round}: 届くかどうか`);
    if (best === null) continue;
    assert.equal(r.exact, true);
    const got = r.sets[0].totals.get(2) || 0;
    assert.equal(cap == null ? got : Math.min(got, cap), best, `round ${round}: 最良の値`);
  }
});

test('右耳にしか着けられない装備は右耳に置く。右耳専用を 2 つは着けない', () => {
  const RIGHT = 1 << 12;
  const db = make([
    item('右専用A', RIGHT, { 0: 9 }),
    item('右専用B', RIGHT, { 0: 8 }),
    item('両耳C', SLOT.ear, { 0: 5 }),
    item('両耳D', SLOT.ear, { 0: 4 }),
  ]);
  // いちばん高い 2 つ (右専用 A と B) は同時に着けられないので、右専用 A と両耳 C
  const r = solve(db, req({ targets: [{ i: 0, goal: 14 }] }));
  assert.equal(r.reached, true);
  assert.equal(r.sets[0].equip.ear2.ja, '右専用A');
  assert.equal(r.sets[0].equip.ear1.ja, '両耳C');
  assert.equal(solve(db, req({ targets: [{ i: 0, goal: 15 }] })).reached, false);
  // 1 つだけ着けるときも右耳に入る
  const one = solve(db, req({ targets: [{ i: 0, goal: 9 }] }));
  assert.equal(one.sets[0].equip.ear2.ja, '右専用A');
  assert.equal(one.sets[0].equip.ear1, undefined);
});

test('複数のステータスを、重みを付けて伸ばす', () => {
  // 0: ストアTP  1: 被ダメージ (小さいほど良い)  2: 攻
  const db = make([
    item('首STP8', 1 << 9, { 0: 8 }),
    item('首両方', 1 << 9, { 0: 4, 2: 6 }),
    item('首攻7', 1 << 9, { 2: 7 }),
    item('頭STP', SLOT.head, { 0: 10 }),
  ]);
  const max = (maximize) => names(solve(db, req({ targets: [], objective: 'max', maximize })).sets[0]);
  // ストアTP だけを伸ばすと、ストアTP が最大の首
  assert.deepEqual(max([{ i: 0, weight: 1 }]), ['頭STP', '首STP8']);
  // 両方を同じ重みで伸ばすと、合計が大きい首 (4 + 6 = 10 > 8)
  assert.deepEqual(max([{ i: 0, weight: 1 }, { i: 2, weight: 1 }]), ['頭STP', '首両方']);
  // 攻の重みを大きくすると、攻が最大の首 (7×3 = 21 > 4 + 6×3 = 22 ではないので、首両方のまま)。重み 5 なら 35 > 34
  assert.deepEqual(max([{ i: 0, weight: 1 }, { i: 2, weight: 3 }]), ['頭STP', '首両方']);
  assert.deepEqual(max([{ i: 0, weight: 1 }, { i: 2, weight: 5 }]), ['頭STP', '首攻7']);
  // 上限のあるものと無いものを混ぜる: ストアTP は上限 10 (頭だけで届く) なので、首は攻で選ぶ
  assert.deepEqual(max([{ i: 0, weight: 1, cap: 10 }, { i: 2, weight: 1 }]), ['頭STP', '首攻7']);
});

test('途中経過を数で切っても、仕上げで空いた部位を埋める', () => {
  // 目標を 3 つにして途中経過を増やし、わざと数を強く絞る。それでも、攻の付く首を着けない候補は出さない
  const items = [];
  for (let n = 0; n < 6; n++) {
    items.push(item(`頭${n}`, SLOT.head, { 0: n, 1: -n, 2: 30 - n }));
    items.push(item(`胴${n}`, SLOT.body, { 0: 5 - n, 1: -(5 - n), 2: 20 + n }));
    items.push(item(`弾${n}`, SLOT.ammo, { 0: n % 3, 2: n }));
  }
  items.push(item('首攻', 1 << 9, { 2: 9 }));
  const db = make(items);
  const r = solve(db, req({ targets: [{ i: 0, goal: 5 }, { i: 1, goal: -5 }], objective: 'max', maximize: [{ i: 2, weight: 1 }] }), { stateLimit: 2, thin: 1 });
  assert.equal(r.reached, true);
  for (const set of r.sets) assert.equal(set.equip.neck && set.equip.neck.ja, '首攻');
  // 絞らない場合と同じ値になる
  const exact = solve(db, req({ targets: [{ i: 0, goal: 5 }, { i: 1, goal: -5 }], objective: 'max', maximize: [{ i: 2, weight: 1 }] }));
  assert.equal(r.sets[0].totals.get(2), exact.sets[0].totals.get(2));
});

test('少ない部位で満たすときは、仕上げで要らない装備を外す', () => {
  const db = make([item('頭10', SLOT.head, { 0: 10 }), item('胴3', SLOT.body, { 0: 3 }), item('弾2', SLOT.ammo, { 0: 2 })]);
  const r = solve(db, req({ targets: [{ i: 0, goal: 10 }] }));
  assert.deepEqual(names(r.sets[0]), ['頭10']);
});

test('目標に届かないときも、空いた部位を埋めてできるだけ近づける', () => {
  // ストアTP 100 は届かない。それでも、ストアTP の付く装備はすべて着ける (矢弾を空けたままにしない)
  const db = make([
    item('頭10', SLOT.head, { 0: 10 }),
    item('胴8', SLOT.body, { 0: 8 }),
    item('弾3', SLOT.ammo, { 0: 3 }),
    item('耳2', SLOT.ear, { 0: 2 }),
  ]);
  for (const extra of [{}, { objective: 'max', maximize: [{ i: 0, weight: 1 }] }]) {
    const r = solve(db, req({ targets: [{ i: 0, goal: 100 }], ...extra }), { stateLimit: 2, thin: 1 });
    assert.equal(r.reached, false);
    assert.equal(r.sets[0].totals.get(0), 23);
    assert.equal(r.sets[0].equip.ammo.ja, '弾3');
  }
});

test('ジョブ専用装束は、使ってよい中でいちばん上の段階だけを候補にする', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  globalThis.window = globalThis.window || {};
  require('../web/data.js');
  const S = require('../web/search.js');
  const V = require('../web/solver.js');
  const P = require('../web/profiles.js');
  const db = S.prepare(globalThis.window.VANARMORY_DATA);
  const d = db.data;
  const k = (n) => db.statByKey.get(n).i;
  const run = (profile) => V.solve(db, { job: 1, level: 'all', objective: 'min', fixed: {}, excluded: new Set(), base: {},
    targets: [{ i: k('ヘイスト'), goal: 20 }, { i: k('ダブルアタック'), goal: 30 }], allow: (i) => P.allow(profile, i, d.contents), sets: d.sets });
  const tiered = (r) => r.sets.flatMap((s) => Object.values(s.equip)).filter((i) => i && ['af', 'relic', 'empy'].includes(i.group));
  const full = P.create('全部');
  const used = tiered(run(full));
  assert.ok(used.length > 0);
  for (const i of used) assert.equal(i.plus, full.tiers[i.group], i.ja);
  const low = P.create('+2まで'); low.tiers = { af: 2, relic: 2, empy: 2 };
  for (const i of tiered(run(low))) assert.ok(i.plus <= 2, i.ja);
});

test('目標を 1 つずつなら届くが同時には届かないときも、いちばん近い候補を出す', () => {
  // 頭はストアTP か 攻 のどちらかしか選べないので、両方 10 は同時に満たせない
  const db = make([
    item('頭STP', SLOT.head, { 0: 10 }),
    item('頭攻', SLOT.head, { 2: 10 }),
    item('弾攻', SLOT.ammo, { 2: 3 }),
  ]);
  const r = solve(db, req({ targets: [{ i: 0, goal: 10 }, { i: 2, goal: 10 }] }));
  assert.equal(r.reached, false);
  assert.ok(r.sets.length > 0);
  assert.equal(r.sets[0].equip.ammo.ja, '弾攻');
});

test('同時に持てない装備 (報酬リングなど) は、同じ組から 1 つだけ使う', () => {
  const db = make([
    item('報酬A', SLOT.ring, { 0: 10 }, { only: 0 }),
    item('報酬B', SLOT.ring, { 0: 9 }, { only: 0 }),
    item('報酬C', SLOT.ring, { 0: 8 }, { only: 0 }),
    item('別の組', SLOT.ring, { 0: 7 }, { only: 1 }),
    item('普通', SLOT.ring, { 0: 3 }),
  ]);
  for (const extra of [{}, { objective: 'max', maximize: [{ i: 0, weight: 1 }] }]) {
    const r = solve(db, req({ targets: [{ i: 0, goal: 15 }], ...extra }));
    assert.equal(r.reached, true);
    assert.deepEqual(names(r.sets[0]), ['別の組', '報酬A']);
    for (const set of r.sets) assert.ok(names(set).filter((n) => n.startsWith('報酬')).length <= 1, names(set).join(','));
  }
  // 同じ組のものを固定していたら、残りは使わない
  const fixedItem = db.data.items.find((i) => i.ja === '報酬C');
  const r = solve(db, req({ targets: [{ i: 0, goal: 15 }], fixed: { ring1: fixedItem } }));
  assert.deepEqual(names(r.sets[0]), ['別の組', '報酬C']);
});
