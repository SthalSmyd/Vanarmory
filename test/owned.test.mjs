import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prepare } = require('../web/search.js');
const A = require('../web/augment.js');
const O = require('../web/owned.js');

const make = () => prepare({
  stats: [
    { k: 'STR', n: 1, num: 1, neg: 0, u: '' },
    { k: '命中', n: 1, num: 1, neg: 0, u: '' },
    { k: '被ダメージ', n: 1, num: 1, neg: 1, u: '%' },
    { k: '被物理ダメージ', n: 1, num: 1, neg: 1, u: '%' },
    { k: '被物理ダメージ(被ダメージ込み)', n: 1, num: 1, neg: 1, u: '%' },
  ],
  derived: [{ k: '被物理ダメージ(被ダメージ込み)', parts: ['被ダメージ', '被物理ダメージ'] }],
  items: [
    { id: 10, ja: '指A', en: 'A', lv: 99, il: 0, su: 0, slots: (1 << 13) | (1 << 14), jobs: 2, skill: 0, desc: '', aug: '', rank: '', s: [0, 5] },
    { id: 20, ja: '足B', en: 'B', lv: 99, il: 119, su: 0, slots: 1 << 8, jobs: 2, skill: 0, desc: '', aug: '', rank: '', s: [0, 10, 3, -2, 4, -2] },
    { id: 30, ja: '首C', en: 'C', lv: 99, il: 0, su: 0, slots: 1 << 9, jobs: 2, skill: 0, desc: '', aug: '', rank: '', rp: 0, s: [0, 1] },
    { id: '30#R15 A', ja: '首C', en: 'C', lv: 99, il: 0, su: 0, slots: 1 << 9, jobs: 2, skill: 0, desc: '', aug: 'STR+10', rank: 'R15 A', rp: 15, s: [0, 11] },
    { id: '30#R15 B', ja: '首C', en: 'C', lv: 99, il: 0, su: 0, slots: 1 << 9, jobs: 2, skill: 0, desc: '', aug: '命中+10', rank: 'R15 B', rp: 15, s: [0, 1, 1, 10] },
    { id: '30#R25 A', ja: '首C', en: 'C', lv: 99, il: 0, su: 0, slots: 1 << 9, jobs: 2, skill: 0, desc: '', aug: 'STR+20', rank: 'R25 A', rp: 25, s: [0, 21] },
  ],
});
const file = (items, extra) => JSON.stringify(Object.assign({ format: 'moglist-gear', version: 1, read_at: '2026-01-02T03:04:05.000Z', items }, extra));

test('Moglist の書き出しを確かめて読む。収納の場所やキャラクター名は持たない', () => {
  const owned = O.read(file([{ id: 20, n: 1, bag: 8, ext: 'AB01', augs: ['STR+5'] }, { id: 'x' }, { id: 10, n: 2, bag: 0 }], { character: 'Someone' }));
  assert.deepEqual(owned, { at: '2026-01-02T03:04:05.000Z', items: [{ id: 20, n: 1, ext: 'ab01', augs: ['STR+5'] }, { id: 10, n: 2 }] });
  assert.throws(() => O.read('{'), /JSON/);
  assert.throws(() => O.read(JSON.stringify({ items: [] })), /Moglist/);
  assert.throws(() => O.read(JSON.stringify({ format: 'moglist-gear', version: 2, items: [] })), /version 2/);
});

test('同じ装備でもオーグメントが違えば、別々の候補になる。値は元の装備に上乗せし、合算も作り直す', () => {
  const db = make();
  const built = O.build(db, O.read(file([
    { id: 20, n: 1, ext: 'aa', augs: ['STR+5', '命中+20'] },
    { id: 20, n: 1, ext: 'bb', augs: ['被ダメージ-3%'] },
  ])));
  assert.deepEqual(built.items.map((i) => i.id), ['own:20:aa', 'own:20:bb']);
  const [a, b] = built.items;
  assert.equal(a.m.get(0), 15);
  assert.equal(a.m.get(1), 20);
  assert.equal(b.m.get(2), -3);
  assert.equal(b.m.get(4), -5); // 被ダメージ -3 と、元からの被物理ダメージ -2 の合算
  assert.equal(a.rank, '所持');
  assert.equal(a.aug, 'STR+5 命中+20');
  assert.equal(a.owned, true);
  assert.equal(a.base, 20);
  assert.equal(db.data.items[1].m.get(0), 10); // 元の装備は変えない
  assert.deepEqual([...built.baseIds], [20]);
});

test('耳・指は、2 個持っていれば 2 個目の候補を作る。ほかの部位は 1 つだけ', () => {
  const db = make();
  const built = O.build(db, O.read(file([{ id: 10, n: 3 }, { id: 20, n: 1 }, { id: 20, n: 1 }])));
  assert.deepEqual(built.items.map((i) => i.id), ['own:10:', 'own:10:#2', 'own:20:']);
});

test('ルートとランクだけのときは、同じルートでランクを超えない、いちばん上の強化した状態を使う', () => {
  const db = make();
  const built = O.build(db, O.read(file([
    { id: 30, n: 1, ext: '01', path: 'A', rank: 25 },
    { id: 30, n: 1, ext: '02', path: 'B', rank: 20 },
    { id: 30, n: 1, ext: '03', path: 'A', rank: 3 },
  ])));
  const [a25, b20, a3] = built.items;
  assert.equal(a25.m.get(0), 21);
  assert.equal(a25.rank, '所持 R25 A');
  assert.equal(b20.m.get(1), 10);
  assert.equal(b20.rank, '所持 R20 B (R15 の値)');
  assert.equal(a3.m.get(0), 1);
  assert.equal(a3.rank, '所持 R3 A (強化の値なし)');
});

test('オーグメントが分かっていれば手入力より優先し、分からなければ手入力を残す', () => {
  const db = make();
  A.apply(db, { 20: 'STR+100', 10: 'STR+7' });
  const built = O.build(db, O.read(file([{ id: 20, n: 1, ext: 'aa', augs: ['STR+5'] }, { id: 10, n: 1, undecoded: true }])));
  assert.equal(built.byId.get('own:20:aa').m.get(0), 15);
  assert.equal(built.byId.get('own:20:aa').manualKey, null);
  assert.equal(built.byId.get('own:10:').m.get(0), 12);
  assert.equal(built.byId.get('own:10:').manualKey, 10);
  assert.match(built.byId.get('own:10:').rank, /未解読/);
});

test('データに無い装備は読み飛ばして数える。知らないオーグメントの名前は集める', () => {
  const db = make();
  const built = O.build(db, O.read(file([{ id: 999, n: 1 }, { id: 20, n: 1, ext: 'aa', augs: ['なぞの力+3', 'STR+1'] }])));
  assert.equal(built.total, 2);
  assert.equal(built.skipped, 1);
  assert.equal(built.withAug, 1);
  assert.deepEqual([...built.unknown], ['なぞの力']);
  assert.equal(O.baseOf(built.items[0]), 20);
  assert.equal(O.baseOf({ id: '30#R15 A' }), 30);
});

test('強化の値を読めなかった装備は、補正の一覧に出る。補正は、オーグメントの入力を、強化した状態の選択より優先する', () => {
  const db = make();
  const owned = O.read(file([
    { id: 30, n: 1, ext: '01', path: 'A', rank: 20 },
    { id: 30, n: 1, ext: '02', path: 'B', rank: 3 },
    { id: 30, n: 1, ext: '03', path: 'A', rank: 25 },
    { id: 10, n: 2, ext: '04', undecoded: true },
  ]));
  const plain = O.build(db, owned);
  assert.deepEqual(plain.needs.map((n) => [n.key, n.label, n.why, n.options.map((v) => v.id), n.fix]), [
    ['30:01', 'R20 A', 'R20 の値が無い', ['30#R15 A', '30#R25 A'], null],
    ['30:02', 'R3 B', 'R3 の値が無い', ['30#R15 B'], null],
    ['10:04', '', 'オーグメントを読めなかった', [], null], // 2 個持っていても、並ぶのは 1 行
  ]);
  const fixed = O.build(db, owned, { '30:01': { variant: '30#R25 A' }, '30:02': { variant: '30#R15 B', text: 'STR+3 なぞ+1' }, '10:04': { text: '命中+7' }, '30:03': { text: 'STR+99' } });
  assert.equal(fixed.byId.get('own:30:01').m.get(0), 21);
  assert.equal(fixed.byId.get('own:30:01').rank, '所持 R20 A 補正 (R25 A の値)');
  assert.equal(fixed.byId.get('own:30:02').m.get(0), 4);
  assert.equal(fixed.byId.get('own:30:02').m.get(1), undefined);
  assert.equal(fixed.byId.get('own:30:02').rank, '所持 R3 B 補正');
  assert.deepEqual(fixed.needs[1].unknown, ['なぞ']);
  assert.deepEqual(fixed.needs[1].fix, { variant: '30#R15 B', text: 'STR+3 なぞ+1' });
  assert.equal(fixed.byId.get('own:10:04').m.get(1), 7);
  assert.equal(fixed.byId.get('own:10:04#2').m.get(1), 7);
  assert.equal(fixed.byId.get('own:30:03').m.get(0), 21); // 値を読めている装備には、補正を使わない
  assert.equal(fixed.needs.length, 3);
});
