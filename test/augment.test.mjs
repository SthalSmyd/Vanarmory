import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prepare } = require('../web/search.js');
const A = require('../web/augment.js');

const make = () => prepare({
  stats: [
    { k: 'STR', n: 1, num: 1, neg: 0, u: '' },
    { k: '被ダメージ', n: 1, num: 1, neg: 1, u: '%' },
    { k: '被物理ダメージ', n: 1, num: 1, neg: 1, u: '%' },
    { k: '被物理ダメージ(被ダメージ込み)', n: 1, num: 1, neg: 1, u: '%' },
  ],
  derived: [{ k: '被物理ダメージ(被ダメージ込み)', parts: ['被ダメージ', '被物理ダメージ'] }],
  items: [
    { id: 10, ja: '耳A', en: 'A', lv: 99, il: 0, su: 0, slots: 1 << 12, jobs: 2, skill: 0, desc: '', aug: '', s: [0, 5] },
    { id: '20#RP30', ja: '手B', en: 'B', lv: 99, il: 119, su: 0, slots: 1 << 6, jobs: 2, skill: 0, desc: '', aug: '', s: [2, -3, 3, -3] },
  ],
});

test('入力したオーグメントを装備の性能に上乗せする。合算も作り直す', () => {
  const db = make();
  A.apply(db, { 10: 'STR+8 被ダメージ-3%', '20#RP30': '被ダメージ-4%' });
  const [ear, hands] = db.data.items;
  assert.equal(ear.m.get(0), 13);
  assert.equal(ear.m.get(1), -3);
  assert.equal(ear.m.get(3), -3); // 被物理 (込み) にも反映される
  assert.equal(ear.manual, 'STR+8 被ダメージ-3%');
  assert.equal(hands.m.get(3), -7); // 被物理 -3 + 被ダメージ -4
});

test('もう一度呼ぶと、前の上乗せは元に戻る (キャラクターの切り替え)', () => {
  const db = make();
  A.apply(db, { 10: 'STR+8' });
  A.apply(db, { 10: 'STR+2' });
  assert.equal(db.data.items[0].m.get(0), 7);
  A.apply(db, {});
  assert.equal(db.data.items[0].m.get(0), 5);
  assert.equal(db.data.items[0].manual, '');
});

test('装備のデータに無い名前は、知らせるために返す', () => {
  const db = make();
  assert.deepEqual(A.read(db, 'STR+8 なぞの値+3').unknown, ['なぞの値']);
  assert.deepEqual(A.read(db, 'STR+8').pairs, [[0, 8]]);
});
