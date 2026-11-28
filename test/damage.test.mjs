import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../web/damage.js');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('STR の補正: 区間の式と、武器ランクでの上限・下限', () => {
  assert.equal(D.fstr(12, 100), 4);
  assert.equal(D.fstr(11, 100), 4.25);
  assert.equal(D.fstr(0, 100), 2);
  assert.equal(D.fstr(-22, 100), -2.25);
  assert.equal(D.fstr(500, 362), 48); // ランク 40 + 8
  assert.equal(D.fstr(-500, 90), -10);
  assert.equal(D.fstr(-500, 5), -1); // ランク 0 は −1
  assert.equal(D.bareDamage(500), 58);
});

test('倍率: 攻防比からの幅、上限、クリティカル', () => {
  const a = D.pdif(1.0, 3.25, false);
  near(a.min, 728 / 1024);
  near(a.max, 1.3);
  near(a.mean, (728 / 1024 + 1.3) / 2);
  const c = D.pdif(1.0, 3.25, true); // 攻防比 2.0 として見る
  near(c.min, (2 * 1176 - 755) / 1024);
  near(c.max, 2.375);
  const top = D.pdif(5, 3.75, false);
  assert.deepEqual([top.min, top.max, top.mean, top.capped], [3.75, 3.75, 3.75, true]);
  assert.equal(D.pdif(5, 3.75, true).max, 4.75);
  // 幅の途中に上限があるとき: 3.0〜3.75 のうち 3.25 を超えた分は 3.25 になる
  const part = D.pdif(3.375, 3.25, false);
  near(part.mean, ((3.25 - 3) * (3 + 3.25) / 2 + (3.75 - 3.25) * 3.25) / 0.75);
  near(D.ratioOf(2000, 1000, 4), 1.8);
  near(D.ratioOf(2000, 1000, -4), 2);
});

test('命中率とクリティカル率', () => {
  assert.equal(D.hitRate(1000, 1000, 99), 0.75);
  assert.equal(D.hitRate(1100, 1000, 99), 0.99);
  assert.equal(D.hitRate(1100, 1000, 95), 0.95);
  assert.equal(D.hitRate(1047, 1000, 99), 0.98);
  assert.equal(D.hitRate(0, 1000, 99), 0.2);
  assert.equal(D.hitRate(1000, 1000, 99, 5), 0.65);
  assert.equal(D.critRate(0, 0), 0.05);
  assert.equal(D.critRate(7, 0), 0.06);
  assert.equal(D.critRate(40, 0), 0.1);
  assert.equal(D.critRate(80, 0), 0.2);
  assert.equal(D.critRate(80, 10), 0.3);
  assert.equal(D.critRate(-50, 200), 1);
});

test('1 発のダメージ: 切り捨て、クリティカルヒットダメージ、上限', () => {
  const h = D.hit({ base: 300, ratio: 5, cap: 3.75, crit: 0.2, critDamage: 10 });
  assert.equal(h.normal.min, 1125);
  assert.equal(h.normal.max, Math.floor(1125 * 1.05));
  assert.equal(h.critical.min, Math.floor(1425 * 1.1));
  near(h.mean, 0.8 * 1125 * 1.025 + 0.2 * 1425 * 1.025 * 1.1);
  assert.equal(h.min, 1125);
  assert.equal(h.max, h.critical.max);
  assert.equal(D.hit({ base: 300, ratio: 5, cap: 3.75, crit: 0, taken: 0.5 }).normal.min, 562);
  assert.equal(D.hit({ base: 90000, ratio: 5, cap: 3.75 }).max, 99999);
});

test('通常攻撃の 1 ラウンド: 複数回攻撃は上から順に判定する', () => {
  const chances = D.extraSwings({ doubleAttack: 20, tripleAttack: 10, quadAttack: 5 });
  near(chances[3], 0.05); near(chances[2], 0.095); near(chances[1], 0.95 * 0.9 * 0.2);
  const hit = D.hit({ base: 100, ratio: 5, cap: 3.25 });
  const r = D.round({ hands: [{ hit, hitRate: 0.9 }, { hit, hitRate: 0.8 }], multi: { doubleAttack: 50 } });
  near(r.swings, 3);
  near(r.damage, 1.5 * 0.9 * hit.mean + 1.5 * 0.8 * hit.mean);
});

test('TP での直線補間と、ステータス修正', () => {
  assert.equal(D.byTp(1000, [4, 10.25, 13.75]), 4);
  assert.equal(D.byTp(1500, [4, 10.25, 13.75]), 7.125);
  assert.equal(D.byTp(2500, [4, 10.25, 13.75]), 12);
  assert.equal(D.byTp(3500, [4, 10.25, 13.75]), 13.75);
  assert.equal(D.wsc({ STR: 301, MND: 250 }, { STR: 50, MND: 50 }), 275); // 150.5 + 125 を足してから切り捨て
});

test('WS: 1 段目だけに掛かるものと、全段に掛かるもの', () => {
  const main = { damage: 200, fstr: 20, ratio: 5, cap: 3.25, firstHitRate: 1, hitRate: 0.9, crit: 0.5, critDamage: 0 };
  const ws = D.weaponSkill({ main, wsc: 80, ftp: 4, replicate: false, hits: 2, wsd: 50, bonus: 10, multi: {}, canCrit: false });
  // 1 段目: floor(300 × 4 × 1.5 × 1.1) = 1980、2 段目: floor(300 × 1 × 1.1) = 330。倍率は上限の 3.25
  assert.equal(ws.parts.first.hit.min, Math.floor(1980 * 3.25));
  assert.equal(ws.parts.rest.hit.min, Math.floor(330 * 3.25));
  near(ws.mean, 1980 * 3.25 * 1.025 + 0.9 * 330 * 3.25 * 1.025);
  assert.equal(ws.min, 6435 + 1072);
  const rep = D.weaponSkill({ main, wsc: 80, ftp: 4, replicate: true, hits: 2, multi: {}, canCrit: true });
  assert.equal(rep.parts.rest.hit.normal.min, 1200 * 3.25);
  assert.equal(rep.parts.rest.hit.crit, 0.5);
});

test('WS: 複数回攻撃の判定の回数と、8 回までの制限', () => {
  const main = { damage: 100, fstr: 0, ratio: 5, cap: 3.25, firstHitRate: 1, hitRate: 1, crit: 0 };
  const da = { doubleAttack: 100 };
  // 1 段の WS: 判定 1 回。2 段の WS: 判定 2 回
  near(D.weaponSkill({ main, ftp: 1, hits: 1, multi: da }).attempts, 2);
  near(D.weaponSkill({ main, ftp: 1, hits: 2, multi: da }).attempts, 4);
  // 二刀流: メイン 1 回 + サブ 1 回
  near(D.weaponSkill({ main, sub: main, ftp: 1, hits: 2, multi: da }).attempts, 5);
  // 8 段の WS は、複数回攻撃の入る余地が無い
  const eight = D.weaponSkill({ main, ftp: 1, hits: 8, multi: { quadAttack: 100 } });
  near(eight.attempts, 8);
  assert.equal(eight.parts.multi.count, 0);
  // 6 段 + クワッド 100%: 残り 2 回まで
  near(D.weaponSkill({ main, ftp: 1, hits: 6, multi: { quadAttack: 100 } }).attempts, 8);
  near(D.wsExtras([0.5, 0.5, 0, 0], 2, 7).mean, 1);
});

test('倍率の上限: 武器種 + 特性に、物理ダメージ上限+ を掛ける', () => {
  assert.equal(D.limitTrait(8, 12, 59), 128 / 256); // 暗黒騎士
  assert.equal(D.limitTrait(12, 8, 59), 77 / 256); // 侍 / 暗 59: サポの 3 段階目のほうが高い
  assert.equal(D.limitTrait(1, 0, 0), 51 / 256); // 戦士: 2 段階
  assert.equal(D.limitTrait(3, 0, 0), 0);
  near(D.limitOf('scythe', 0.5, 20), 5.4);
  near(D.limitOf('one', 0, 0), 3.25);
  // クリティカルの +1.0 は、掛けたあと
  near(D.pdif(9, D.limitOf('scythe', 0.5, 20), true).max, 6.4);
});

test('TP のサイクル: 当たる回数の確率と、次の WS までのラウンド数', () => {
  const hits = D.roundHits([{ hitRate: 0.5 }], { doubleAttack: 100 }); // 必ず 2 回振る
  near(hits[0], 0.25); near(hits[1], 0.5); near(hits[2], 0.25);
  // 必ず 1 回当たる: 100 ずつたまり、1000 に届くまで 10 ラウンド
  const sure = D.cycle({ start: 0, threshold: 1000, tpHit: 100, hits: [0, 1] });
  near(sure.rounds, 10); near(sure.tp, 1000);
  // 半分は外れる: ラウンド数は 2 倍
  near(D.cycle({ start: 0, threshold: 1000, tpHit: 100, hits: [0.5, 0.5] }).rounds, 20);
  // 300 ずつ: 4 ラウンドで 1200
  const over = D.cycle({ start: 0, threshold: 1000, tpHit: 300, hits: [0, 1] });
  near(over.rounds, 4); near(over.tp, 1200);
  // 2 回当たることがある: 900 からなら必ず 1 ラウンドで、TP は 1000 か 1100
  const two = D.cycle({ start: 900, threshold: 1000, tpHit: 100, hits: [0, 0.5, 0.5] });
  near(two.rounds, 1); near(two.tp, 1050);
  assert.equal(D.cycle({ start: 1200, threshold: 1000, tpHit: 100, hits: [0, 1] }).rounds, 0);
  near(D.hasteOf({ gear: 30, magic: 50, ability: 10 }), 0.7875);
  near(D.hasteOf({ gear: 25, magic: 43.75, ability: 25 }), 0.8);
  near(D.roundTime(480, 480, 0.5), 4);
  near(D.roundTime(240, 480, 0.8), 1.6); // 二刀流 50% + ヘイスト 80% でも、元の 20% まで
});

test('武器の効果: 時々 2〜3 回攻撃、倍撃、隠しの WS ダメージ', () => {
  // ダブルアタック 20% が先。出なかった 80% のうち、3 回 20%・2 回 40%
  const c = D.extraSwings({ doubleAttack: 20, twice: 40, thrice: 20 });
  near(c[0], 0.8 * 0.4); near(c[1], 0.2 + 0.8 * 0.4); near(c[2], 0.8 * 0.2);
  const hit = D.hit({ base: 100, ratio: 5, cap: 3.25 });
  const plain = D.round({ hands: [{ hit, hitRate: 1 }], multi: {} }).damage;
  near(D.round({ hands: [{ hit, hitRate: 1, scale: 1.5 }], multi: {} }).damage, plain * 1.5);
  near(D.round({ hands: [{ hit, hitRate: 1 }], multi: { doubleAttack: 100 }, first: 0.26 }).damage, plain * 2.26);
  const main = { damage: 100, fstr: 0, ratio: 5, cap: 3.25, firstHitRate: 1, hitRate: 1, crit: 0 };
  const a = D.weaponSkill({ main, ftp: 2, hits: 1, bonus: 20, hidden: 40, multi: {} });
  assert.equal(a.parts.first.hit.min, Math.floor(Math.floor(200 * 1.2 * 1.4) * 3.25));
  // 1 回目の判定だけ、アフターマスの分が入る
  const b = D.weaponSkill({ main, ftp: 1, hits: 2, multi: {}, firstMulti: { thrice: 100 } });
  near(b.attempts, 4);
});

test('遠隔: STR の補正、倍率、クリティカル、1 射の時間', () => {
  assert.equal(D.fstr2(12, 100), 8);
  assert.equal(D.fstr2(500, 100), 38); // (ランク 11 + 8) × 2
  assert.equal(D.fstr2(-500, 100), -22);
  assert.equal(D.fstr2(-500, 9), -3);
  const low = D.pdifRanged(0.45, 3.25);
  near(low.min, 0.45); near(low.max, 0.5);
  assert.deepEqual([D.pdifRanged(1, 3.25).min, D.pdifRanged(1, 3.25).max], [1, 1]);
  const mid = D.pdifRanged(2, 3.5);
  near(mid.min, 40 / 19 - 3 / 19); near(mid.max, 2);
  assert.equal(D.pdifRanged(9, 3.5).min, 3.5);
  // クリティカルは、上限のあとに 1.25 倍。最後の乱数は無い
  const h = D.hit({ base: 200, ratio: 9, cap: 3.5, crit: 0.5, critDamage: 20, ranged: true });
  assert.equal(h.normal.min, 700); assert.equal(h.normal.max, 700);
  assert.equal(h.critical.min, 1050);
  near(h.mean, 0.5 * 700 + 0.5 * 700 * 1.25 * 1.2);
  near(D.ratioOf(2000, 1000, 4, 0.025), 1.9);
  assert.equal(D.critRateRanged(35, 0), 0.08);
  assert.equal(D.critRateRanged(-50, 2), 0.07);
  near(D.shotTime(424, {}), 5);
  near(D.shotTime(424, { snapshot: 80 }), 4 * 0.3 + 1);
  const main = { damage: 300, fstr: 20, ratio: 9, cap: 3.5, firstHitRate: 0.95, hitRate: 0.95, crit: 0, ranged: true };
  const ws = D.weaponSkill({ main, wsc: 80, ftp: 2, replicate: true, hits: 2, multi: {} });
  assert.equal(ws.parts.first.hit.min, 800 * 3.5);
  near(ws.mean, 2 * 0.95 * 2800);
});

test('魔法 WS・属性つきの物理 WS・連携', () => {
  assert.equal(D.magicBase(99, 119), 201);
  assert.equal(D.magicBase(99, 0), 152);
  assert.equal(D.dstat(48, 1), 32);
  assert.equal(D.dstat(100, 1), 32);
  assert.equal(D.dstat(-100, 1), 0);
  assert.equal(D.dstat(50, 2), 100);
  // floor((201 + 99) × 2 + 32 + 100) = 732、魔攻 +100 ÷ 魔防 0 = 2 倍、WS のダメージ +50%
  assert.equal(D.magicSkill({ base: 201, wsc: 99, ftp: 2, dstat: 32, magicDamage: 100, magicAttack: 100, wsd: 50 }), 2196);
  assert.equal(D.magicSkill({ base: 201, wsc: 99, ftp: 2, magicAttack: 0, magicDefense: -90 }), 1200); // 魔防は −50 まで
  near(D.hybridMagic({ physical: 1000, mftp: 1.5, magicDamage: 100, magicAttack: 50 }), 2400);
  near(D.skillchain(10000, 3, 80, 0.5), 7500); // 連携ボーナスは 50% まで
  near(D.skillchain(10000, 1, 0), 5000);
});

test('倍率がすべて上限になる攻防比', () => {
  // 近接: その攻防比で下端が上限に届き、少し下では届かない
  assert.equal(D.pdif(D.capRatio(3.75), 3.75).capped, true);
  assert.equal(D.pdif(D.capRatio(3.75) - 0.01, 3.75).capped, false);
  assert.equal(D.pdif(D.capRatio(3.75), 3.75, true).capped, true);
  // 遠隔
  assert.equal(D.pdifRanged(D.capRatio(3.25, true) + 1e-9, 3.25).capped, true);
  assert.equal(D.pdifRanged(D.capRatio(3.25, true) - 0.01, 3.25).capped, false);
});

test('攻防関数が上限に当たり始める攻防比', () => {
  // 近接: その攻防比で、上の端がちょうど上限。少し下では届かない
  near(D.pdif(D.capStart(3.75), 3.75).max, 3.75);
  assert.ok(D.pdif(D.capStart(3.75) - 0.01, 3.75).max < 3.75);
  // 遠隔: 上の端は攻防比そのもの
  near(D.pdifRanged(D.capStart(3.5, true), 3.5).max, 3.5);
  assert.ok(D.pdifRanged(D.capStart(3.5, true) - 0.01, 3.5).max < 3.5);
});

test('属性ゴルゲット・フォシャ: 連携属性が合う WS だけ', () => {
  assert.equal(D.charmFits('フォシャゴルゲット', ['Scission']), true);
  assert.equal(D.charmFits('フォシャベルト', []), false); // 連携属性の無い WS
  assert.equal(D.charmFits('フレイムゴルゲット', ['Fusion', 'Impaction']), true);
  assert.equal(D.charmFits('フレイムベルト', ['Light']), false); // 光・闇は、ライト・シャドウだけ
  assert.equal(D.charmFits('ライトゴルゲット', ['Light', 'Fragmentation']), true);
  assert.equal(D.charmFits('ソイルベルト', ['Fragmentation', 'Scission']), true);
  assert.equal(D.charmFits('サイズミクアクス', ['Gravitation']), true);
  assert.equal(D.charmFits('アクアゴルゲット', ['Induration']), false);
  assert.equal(D.CHARM_FTP, 25 / 256);
});

test('格闘 WS: 段数に左手の 1 発が含まれる', () => {
  const hand = { damage: 100, fstr: 10, ratio: 2, cap: 3.5, firstHitRate: 1, hitRate: 1, crit: 0, critDamage: 0 };
  const base = { main: hand, sub: hand, wsc: 0, ftp: 1, replicate: true, hits: 4, multi: {}, canCrit: false };
  assert.equal(D.weaponSkill(Object.assign({ subInHits: true }, base)).attempts, 4); // 格闘: 表記どおり 4 回
  assert.equal(D.weaponSkill(base).attempts, 5); // 二刀流: 表記 + サブの 1 発
  assert.equal(D.weaponSkill(Object.assign({}, base, { hits: 8, subInHits: true })).attempts, 8);
  assert.equal(D.weaponSkill(Object.assign({}, base, { hits: 2, subInHits: true })).attempts, 2);
});

test('蹴撃: 1 ラウンドに 1 回の判定で、当たった分だけ増える', () => {
  const hit = D.hit({ base: 100, ratio: 2, cap: 3.5, crit: 0 });
  const hands = [{ hit, hitRate: 0.9 }, { hit, hitRate: 0.9 }];
  const plain = D.round({ hands, multi: {} });
  const kicked = D.round({ hands, multi: {}, kick: { rate: 0.5, hit, hitRate: 0.9 } });
  assert.ok(Math.abs(kicked.swings - plain.swings - 0.5) < 1e-9);
  assert.ok(Math.abs(kicked.damage - plain.damage - 0.5 * 0.9 * hit.mean) < 1e-6);
  const chances = D.roundHits(hands, {}, { rate: 0.5, hitRate: 0.9 });
  assert.ok(Math.abs(chances.reduce((s, p) => s + p, 0) - 1) < 1e-9);
  assert.ok(Math.abs(chances.reduce((s, p, n) => s + p * n, 0) - (1.8 + 0.45)) < 1e-9);
  assert.ok(Math.abs(chances[3] - 0.81 * 0.45) < 1e-9);
});
