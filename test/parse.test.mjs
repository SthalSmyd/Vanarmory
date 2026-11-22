import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDescription } from '../tools/parse.mjs';

const find = (list, key) => list.find((s) => s.key === key);

test('基本のステータスと単位', () => {
  const s = parseDescription('防156 HP+91 ヘイスト+6%\n被ダメージ-7%\nＤ315 隔450 ストアTP+10');
  assert.deepEqual(find(s, '防'), { key: '防', value: 156, unit: '' });
  assert.deepEqual(find(s, 'ヘイスト'), { key: 'ヘイスト', value: 6, unit: '%' });
  assert.deepEqual(find(s, '被ダメージ'), { key: '被ダメージ', value: -7, unit: '%' });
  assert.equal(find(s, 'D').value, 315);
  assert.equal(find(s, 'ストアTP').value, 10);
});

test('条件は同じ行の後ろに掛かり、行の途中から始まれば次の行には続かない', () => {
  const s = parseDescription('魔命スキル+188 きばれ+15 ペット:ヘイスト+8%\nダブルアタック+5%');
  assert.equal(find(s, 'ペット:ヘイスト').value, 8);
  assert.equal(find(s, 'ダブルアタック').value, 5);
  assert.equal(find(s, 'きばれ').value, 15);
});

test('行頭から始まった条件は、次の条件が出るまで後ろの行にも続く', () => {
  const s = parseDescription('ヘイスト+4%\nドメインベージョン:STR+30 DEX+20\nAGI+20\nウェポンスキルのダメージ+50%\nフェイス:Lv+1');
  assert.equal(find(s, 'ヘイスト').value, 4);
  assert.equal(find(s, 'ドメインベージョン:AGI').value, 20);
  assert.equal(find(s, 'ドメインベージョン:ウェポンスキルのダメージ').value, 50);
  assert.equal(find(s, 'ウェポンスキルのダメージ'), undefined);
  assert.equal(find(s, 'フェイス:Lv').value, 1);
});

test('ユニティランクは幅の中間を、条件なしの値として数える', () => {
  const s = parseDescription('ユニティランク:攻+10～15\nユニティランク:敵対心-3～-7');
  assert.deepEqual(find(s, '攻'), { key: '攻', value: 12, unit: '' });
  assert.equal(find(s, '敵対心').value, -5);
});

test('潜在能力は条件なしの値に混ざらない', () => {
  const s = parseDescription('命中+20 潜在能力:命中+30 攻+30');
  assert.equal(find(s, '命中').value, 20);
  assert.equal(find(s, '潜在能力:命中').value, 30);
  assert.equal(find(s, '攻'), undefined);
});

test('数値のない特殊効果', () => {
  const s = parseDescription('リエモン範囲化 被物理ダメージII-25%\nコンビネーション:命中+ 攻+\nアフターマス:命中+/攻+/時々2-3回攻撃');
  assert.equal(find(s, 'リエモン範囲化').value, null);
  assert.equal(find(s, '被物理ダメージII').value, -25);
  assert.equal(find(s, 'コンビネーション:命中').value, null);
  assert.equal(find(s, 'コンビネーション:攻').value, null);
  assert.ok(find(s, 'アフターマス:命中+/攻+/時々2-3回攻撃'));
});

test('「率N%ダウン」は負の値として数える', () => {
  const s = parseDescription('詠唱中断率10%ダウン');
  assert.deepEqual(find(s, '詠唱中断率'), { key: '詠唱中断率', value: -10, unit: '%' });
});

test('説明の文章はステータスにしない', () => {
  const s = parseDescription('従来とは異なる伝達法を用いたストリンガー。\n耐火+2');
  assert.equal(s.length, 1);
});
