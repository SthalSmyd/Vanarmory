import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const base = createRequire(import.meta.url)('../web/basestats.js');
const { baseStats } = base;
const combat = JSON.parse(fs.readFileSync(new URL('../data/combat.json', import.meta.url), 'utf8'));
const tables = JSON.parse(fs.readFileSync(new URL('../data/base.json', import.meta.url), 'utf8'));

test('検算用の実例と一致する (種族・ジョブ・サポ・マスターレベル)', () => {
  assert.ok(tables.samples.length >= 10);
  for (const s of tables.samples) {
    assert.deepEqual(baseStats(tables, s.race, s.job, s.sub, s.subLevel, s.masterLevel), s.expect, `${s.race} ${s.job}/${s.sub ?? 'なし'}${s.subLevel} ML${s.masterLevel}`);
  }
});

test('マスターレベルは全ステータス +1、HP +7。サポのレベルは省くとマスターレベルから決まる', () => {
  const a = baseStats(tables, 'hume', 'SAM', 'WAR', 49, 0);
  const b = baseStats(tables, 'hume', 'SAM', 'WAR', 49, 10);
  assert.equal(b.STR - a.STR, 10);
  assert.equal(b.HP - a.HP, 70);
  assert.equal(b.MP, 0); // 侍も戦士も MP を持たない
  assert.deepEqual(baseStats(tables, 'hume', 'SAM', 'WAR', undefined, 50), baseStats(tables, 'hume', 'SAM', 'WAR', 59, 50));
  assert.equal(baseStats(tables, 'unknown', 'SAM', 'WAR', 49, 0), null);
});

test('攻撃・命中の計算が、検算用の実例と一致する', () => {
  assert.ok(combat.samples.length >= 10);
  for (const s of combat.samples) assert.equal(base[s.fn](s.input), s.expect, `${s.fn} ${JSON.stringify(s.input)}`);
  // 用語辞典の例: 両手刀 A+ 424 + メリポ 16 + IL119 の武器 242 = 682 → 命中 613
  assert.equal(base.skillToAccuracy(424 + 16 + 242), 613);
});
