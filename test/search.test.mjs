import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { prepare, suggest, search, slotNames, categoryOf } = createRequire(import.meta.url)('../web/search.js');

const item = (ja, slots, stats, extra = {}) => ({
  id: 0, ja, en: ja, lv: 99, il: 119, su: 0, slots, jobs: 0b10 | 2 ** 12, skill: 0, desc: '', aug: '', s: stats.flat(), ...extra,
});
const db = prepare({
  stats: [
    { k: 'ストアTP', n: 3, num: 1, neg: 0, u: '' },
    { k: '被ダメージ', n: 2, num: 1, neg: 1, u: '%' },
    { k: 'ペット:ストアTP', n: 1, num: 1, neg: 0, u: '' },
    { k: 'リエモン範囲化', n: 1, num: 0, neg: 0, u: '' },
  ],
  items: [
    item('頭A', 1 << 4, [[0, 5], [1, -7]]),
    item('頭B', 1 << 4, [[0, 8]]),
    item('耳C', (1 << 11) | (1 << 12), [[0, 3], [1, -3]], { il: 0, jobs: 2 ** 12 }),
    item('剣D', 1, [[3, null]], { lv: 75, il: 0, skill: 3 }),
  ],
});
const base = { stats: [], mode: 'and', slotMask: 0, job: 0, skill: -1, level: 'all', text: '', sort: -1 };
const names = (c) => search(db, { ...base, ...c }).map((i) => i.ja);

test('略称で候補が出て、条件つきは無印の後ろ', () => {
  assert.deepEqual(suggest(db, 'stp', 10).map((s) => s.k), ['ストアTP']);
  assert.deepEqual(suggest(db, 'ストア', 10).map((s) => s.k), ['ストアTP', 'ペット:ストアTP']);
  assert.deepEqual(suggest(db, 'カット', 10).map((s) => s.k), ['被ダメージ']);
});

test('選んだステータスの大きい順、小さいほど良いものは小さい順', () => {
  assert.deepEqual(names({ stats: [{ i: 0, dir: 'desc' }], sort: 0 }), ['頭B', '頭A', '耳C']);
  assert.deepEqual(names({ stats: [{ i: 1, dir: 'asc' }], sort: 1 }), ['頭A', '耳C']);
});

test('最低値と AND / OR', () => {
  assert.deepEqual(names({ stats: [{ i: 0, dir: 'desc', min: 5 }], sort: 0 }), ['頭B', '頭A']);
  assert.deepEqual(names({ stats: [{ i: 1, dir: 'asc', min: -5 }], sort: 1 }), ['頭A']);
  const both = [{ i: 0, dir: 'desc' }, { i: 1, dir: 'asc' }];
  assert.deepEqual(names({ stats: both, sort: 0 }), ['頭A', '耳C']);
  assert.deepEqual(names({ stats: both, mode: 'or', sort: 1 }), ['頭A', '耳C', '頭B']);
});

test('部位・ジョブ・武器種・レベル・文字で絞る', () => {
  assert.deepEqual(names({ slotMask: 1 << 4 }), ['頭A', '頭B']);
  assert.deepEqual(names({ slotMask: 1 << 11 }), ['耳C']);
  assert.deepEqual(names({ job: 1 }), ['頭A', '頭B', '剣D']);
  assert.deepEqual(names({ skill: 3 }), ['剣D']);
  assert.deepEqual(names({ level: '99' }), ['頭A', '頭B', '耳C']);
  assert.deepEqual(names({ level: 'il119' }), ['頭A', '頭B']);
  assert.deepEqual(names({ text: '剣' }), ['剣D']);
  assert.deepEqual(names({ stats: [{ i: 3, dir: 'desc' }] }), ['剣D']);
});

test('部位名', () => {
  assert.deepEqual(slotNames(3), ['メイン', 'サブ']);
  assert.deepEqual(slotNames((1 << 13) | (1 << 14)), ['指']);
});

test('同じ順位の候補は、分類に挙げた順に並ぶ (カット → 被ダメージ・被物理・被魔法)', () => {
  const cut = prepare({
    stats: ['被魔法ダメージ(被ダメージ込み)', '被魔法ダメージ', '被物理ダメージ(被ダメージ込み)', '被物理ダメージ', '被ダメージ']
      .map((k, i) => ({ k, n: 100 - i, num: 1, neg: 1, u: '%' })),
    items: [],
  });
  assert.deepEqual(suggest(cut, 'カット', 10).map((s) => s.k),
    ['被ダメージ', '被物理ダメージ', '被魔法ダメージ', '被物理ダメージ(被ダメージ込み)', '被魔法ダメージ(被ダメージ込み)']);
});

test('ステータスの名前から分類を引く', () => {
  assert.equal(categoryOf('ストアTP'), 'TP・攻撃間隔');
  assert.equal(categoryOf('被ダメージ'), '防御・カット');
  assert.equal(categoryOf('両手刀スキル'), 'スキル');
  assert.equal(categoryOf('歌の詠唱時間'), '詠唱・MP');
  assert.equal(categoryOf('ペット:命中'), 'ペット');
  assert.equal(categoryOf('潜在能力:命中'), '条件つき');
  assert.equal(categoryOf('トレジャーハンター'), 'その他');
});
