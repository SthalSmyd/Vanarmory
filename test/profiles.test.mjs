import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('../web/profiles.js');

const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
// 0: 段階のあるコンテンツ  1: 入手元を選べるコンテンツ  2: 入・切だけのコンテンツ
const contents = [
  { id: 'unity', tiers: ['NQ', '+1'] },
  { id: 'hightier', froms: ['BF-A', 'BF-B'], picks: true },
  { id: 'omen', froms: ['Kin', 'Ou'] }, // 入手元は一覧に出すだけで、選べない
];

test('何も決めていない設定は、すべての装備を使う', () => {
  const p = P.create('メイン');
  assert.equal(P.allow(p, { id: 1, src: [[0, 1, 0]] }, contents), true);
  assert.equal(P.allow(p, { id: 2, src: [[1, 0, 1]] }, contents), true);
  assert.equal(P.allow(p, { id: 3 }, contents), true);
  assert.equal(P.allow(p, { id: 4, fam: 'nyame', rp: 30, rank: 'RP30 A' }, contents), true);
  assert.equal(P.allow(p, { id: 5, fam: 'nyame', rp: 25, rank: 'RP25 A' }, contents), false);
});

test('コンテンツを切る、段階を下げる、入手元を選ぶ', () => {
  const p = P.create('メイン');
  p.contents.omen = { on: false };
  p.contents.unity = { on: true, tier: 0 };
  p.contents.hightier = { on: true, picks: ['BF-A'] };
  assert.equal(P.allow(p, { id: 1, src: [[2, 0, 0]] }, contents), false);
  assert.equal(P.allow(p, { id: 2, src: [[0, 0, 0]] }, contents), true);
  assert.equal(P.allow(p, { id: 3, src: [[0, 1, 0]] }, contents), false);
  assert.equal(P.allow(p, { id: 4, src: [[1, 0, 0]] }, contents), true);
  assert.equal(P.allow(p, { id: 5, src: [[1, 0, 1]] }, contents), false);
  // 入手先が複数ある装備は、どれか 1 つが使えれば使う
  assert.equal(P.allow(p, { id: 6, src: [[2, 0, 0], [0, 0, 0]] }, contents), true);
  // どのコンテンツにも属さない装備は常に使う
  assert.equal(P.allow(p, { id: 7 }, contents), true);
});

test('ジョブ専用装束・オデシー・マント・個別の除外', () => {
  const p = P.create('メイン');
  p.tiers.af = 2;
  p.odyssey.nyame = 0;
  p.odyssey.sakpata = -1;
  p.cape = false;
  p.excluded = [99];
  assert.equal(P.allow(p, { id: 1, group: 'af', plus: 2 }, contents), true);
  assert.equal(P.allow(p, { id: 2, group: 'af', plus: 3 }, contents), false);
  assert.equal(P.allow(p, { id: 3, fam: 'nyame', rp: 0, rank: '' }, contents), true);
  assert.equal(P.allow(p, { id: 4, fam: 'nyame', rp: 5, rank: 'RP5 A' }, contents), false);
  assert.equal(P.allow(p, { id: 5, fam: 'sakpata', rp: 0, rank: '' }, contents), false);
  // シェオル・ジャイアのそのほかの装備は、まとまりごとのランク (初めは最大の 30)
  assert.equal(P.allow(p, { id: 10, fam: 'gaea2', rp: 30, rank: 'R30' }, contents), true);
  assert.equal(P.allow(p, { id: 11, fam: 'gaea2', rp: 20, rank: 'R20' }, contents), false);
  p.odyssey.gaea2 = 20;
  assert.equal(P.allow(p, { id: 11, fam: 'gaea2', rp: 20, rank: 'R20' }, contents), true);
  assert.equal(P.allow(p, { id: 10, fam: 'gaea2', rp: 30, rank: 'R30' }, contents), false);
  assert.equal(P.allow(p, { id: 12, fam: 'gleti', rp: 0, rank: '' }, contents), false);
  // ランクを選べない強化は、入なら強化した状態だけ、切なら強化していない状態だけ
  assert.equal(P.allow(p, { id: 30, plain: 'abjuration', rank: '' }, contents), false);
  assert.equal(P.allow(p, { id: 31, group: 'abjuration', rank: 'R15 A' }, contents), true);
  p.boosts.abjuration = false;
  assert.equal(P.allow(p, { id: 30, plain: 'abjuration', rank: '' }, contents), true);
  assert.equal(P.allow(p, { id: 31, group: 'abjuration', rank: 'R15 A' }, contents), false);
  assert.equal(P.allow(p, { id: 6, group: 'cape' }, contents), false);
  assert.equal(P.allow(p, { id: 99 }, contents), false);
});

test('保存と読み込み。設定を分ける前の内容は、1 人目のキャラクターの最初の設定に引き継ぐ', () => {
  const storage = memory();
  const store = P.load(storage, { tiers: { af: 3 }, odyssey: { nyame: 20 }, cape: false, excluded: [7] });
  assert.equal(store.chars.length, 1);
  assert.equal(P.character(store).name, 'キャラクター1');
  assert.equal(P.active(store).name, 'メイン');
  assert.equal(P.active(store).tiers.af, 3);
  assert.equal(P.active(store).tiers.relic, 4);
  assert.equal(P.active(store).odyssey.nyame, 20);
  assert.deepEqual(P.active(store).excluded, [7]);
  const c = P.character(store);
  c.list.push(P.create('復帰直後'));
  c.active = c.list[1].id;
  assert.equal(P.save(storage, store), true);
  const again = P.load(storage);
  assert.deepEqual(P.character(again).list.map((p) => p.name), ['メイン', '復帰直後']);
  assert.equal(P.active(again).name, '復帰直後');
});

test('キャラクターを分ける前の保存内容は、1 人目のキャラクターにまとめる', () => {
  const storage = memory();
  const old = P.create('メイン');
  old.tiers.af = 1;
  storage.setItem(P.STORAGE, JSON.stringify({ active: old.id, list: [old], jobs: { 12: { jp: 550, ml: 20, merit: true } }, crit: true }));
  const store = P.load(storage);
  assert.equal(store.chars.length, 1);
  assert.equal(P.active(store).tiers.af, 1);
  assert.deepEqual(P.jobSetting(P.character(store), 12), { jp: 550, raw: 550, master: false, ml: 20, merit: true });
  // 以前の「クリティカルヒット +5%」の入・切は、5 段階として引き継ぐ
  assert.deepEqual(P.character(store).merits, { 'クリティカルヒット': 5 });
});

test('ジョブの育成はキャラクターごと。何も入れていなければ最大、サポのレベルはマスターレベルから決まる', () => {
  const storage = memory();
  const store = P.load(storage);
  const a = P.character(store);
  assert.deepEqual(P.jobSetting(a, 12), { jp: 2100, raw: 0, master: true, ml: 0, merit: true });
  a.jobs[12] = { jp: 1200, ml: 30, merit: false };
  const b = P.createCharacter('サブ');
  store.chars.push(b);
  assert.deepEqual(P.jobSetting(a, 12), { jp: 1200, raw: 1200, master: false, ml: 30, merit: false });
  assert.deepEqual(P.jobSetting(b, 12), { jp: 2100, raw: 0, master: true, ml: 0, merit: true });
  // マスターにチェックを入れると 2100 として数えるが、入力してある数値は残る
  a.jobs[12].master = true;
  assert.equal(P.jobSetting(a, 12).jp, 2100);
  assert.equal(P.jobSetting(a, 12).raw, 1200);
  a.jobs[12].master = false;
  assert.equal(P.jobSetting(a, 12).jp, 1200);
  assert.equal(P.supportLevel(0), 49);
  assert.equal(P.supportLevel(4), 49);
  assert.equal(P.supportLevel(30), 55);
  assert.equal(P.supportLevel(50), 59);
  assert.equal(P.supportLevel(99), 59);
  store.activeChar = b.id;
  P.save(storage, store);
  const again = P.load(storage);
  assert.equal(P.character(again).name, 'サブ');
  assert.deepEqual(P.jobSetting(again.chars[0], 12), { jp: 1200, raw: 1200, master: false, ml: 30, merit: false });
});

test('装備の範囲の設定を別のキャラクターへ写す。同じ名前があれば置き換え、元は変わらない', () => {
  const a = P.createCharacter('A');
  const b = P.createCharacter('B');
  a.list[0].tiers.af = 2;
  a.list[0].excluded.push(5);
  const extra = P.create('復帰直後');
  a.list.push(extra);
  // B には「メイン」が既にあるので置き換わり、選択中もそれに付け替わる
  const copied = P.copyProfile(a.list[0], b);
  assert.equal(b.list.length, 1);
  assert.equal(b.list[0].tiers.af, 2);
  assert.equal(b.active, copied.id);
  assert.notEqual(copied.id, a.list[0].id);
  // 写した先を変えても、元は変わらない
  b.list[0].excluded.push(9);
  assert.deepEqual(a.list[0].excluded, [5]);
  // 同じ名前が無ければ足す
  P.copyProfile(extra, b);
  assert.deepEqual(b.list.map((p) => p.name), ['メイン', '復帰直後']);
});

test('共通のメリポは、入れていなければ最大。合計に上限のある分類だけ 0 から', () => {
  const c = P.createCharacter('A');
  const free = { limit: null };
  const limited = { limit: 10 };
  const hp = { id: 'HP', max: 15 };
  const crit = { id: 'クリティカルヒット', max: 5 };
  assert.equal(P.sharedLevel(c, free, hp), 15);
  assert.equal(P.sharedLevel(c, limited, crit), 0);
  // 入れた値はそのまま使う。0 と入れたものを最大に戻さない。上限を超える値は上限に丸める
  c.merits.HP = 0;
  c.merits['クリティカルヒット'] = 9;
  assert.equal(P.sharedLevel(c, free, hp), 0);
  assert.equal(P.sharedLevel(c, limited, crit), 5);
});

test('デュナミス〔D〕の首装備は、オーグメントを付けた状態だけを使う', () => {
  const p = P.create('メイン');
  const neck = [{ id: 'dynamis_neck', tiers: ['無印まで', '+1 まで', '+2 まで'] }];
  assert.equal(P.allow(p, { id: 1, plain: 'neck', src: [[0, 1, 0]] }, neck), false);
  assert.equal(P.allow(p, { id: '1#R20', group: 'neck', rank: 'R20', src: [[0, 1, 0]] }, neck), true);
  // 段階の設定はこれまでどおり効く
  p.contents.dynamis_neck = { on: true, tier: 0 };
  assert.equal(P.allow(p, { id: '1#R20', group: 'neck', rank: 'R20', src: [[0, 1, 0]] }, neck), false);
});
