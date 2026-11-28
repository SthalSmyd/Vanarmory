// ダメージの画面の敵の一覧 (data/enemies.json) を、値を埋めた形にする。
// 資料に載っている値はそのまま使い、載っていない項目は、レベルから出す (回避は必要命中の表、防御力・VIT・AGI は目安)。
import fs from 'node:fs';
import path from 'node:path';

export function buildEnemies(root) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'enemies.json'), 'utf8'));
  const { types, rows } = data.accuracy;
  const byLevel = new Map(rows.map((row) => [row[0], row.slice(1)]));
  // 型ごとの必要命中。表に無いレベルは、標準 (war) の値に、いちばん近いレベルでの差を足す
  const standard = (lv) => {
    if (byLevel.has(lv) && byLevel.get(lv)[4] != null) return byLevel.get(lv)[4];
    const known = rows.filter((row) => row[5] != null).map((row) => [row[0], row[5]]);
    const below = known.filter(([l]) => l < lv).pop();
    const above = known.find(([l]) => l > lv);
    if (below && above) return Math.round(below[1] + ((above[1] - below[1]) * (lv - below[0])) / (above[0] - below[0]));
    return Math.round(below[1] + (lv - below[0]) * 40); // 表より上は、1 レベル 40 ずつ (Lv139〜149 の増え方)
  };
  const required = (lv, type) => {
    const col = types.indexOf(type);
    if (col === 4 || col < 0) return standard(lv);
    if (byLevel.has(lv) && byLevel.get(lv)[col] != null) return byLevel.get(lv)[col];
    const near = rows.filter((row) => row[col + 1] != null).sort((a, b) => Math.abs(a[0] - lv) - Math.abs(b[0] - lv))[0];
    return standard(lv) + (near[col + 1] - near[5]);
  };
  return data.enemies.map((enemy) => {
    const vit = 254 + (enemy.lv - 129) * 8;
    const guess = { def: 1142 + (enemy.lv - 129) * 36, vit, agi: vit + 20 };
    // 回避が載っている敵は、表を引かない (表に無い低いレベルの敵のため)
    const values = Object.assign(enemy.values.eva == null ? { eva: required(enemy.lv, enemy.type) - 40 } : {}, guess, enemy.values);
    // est: 目安で埋めた項目、table: 回避を必要命中の表から出したか
    return {
      id: enemy.id, group: enemy.group, ja: enemy.ja, lv: enemy.lv, page: enemy.page, note: enemy.note, values,
      // guess の印のある敵は、入っている値そのものが目安
      est: Object.keys(guess).filter((key) => enemy.guess || enemy.values[key] == null), table: enemy.values.eva == null, guess: !!enemy.guess,
    };
  });
}
