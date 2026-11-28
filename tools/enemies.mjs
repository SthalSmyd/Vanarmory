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
  const filled = data.enemies.map((enemy) => {
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
  return oneEach(filled, data.families || {});
}

// 敵を 1 体 1 行にする。名前を「 / 」でつないである敵は分け、場所・コンテンツ (where) と種族 (family) を付ける。
// same は、レベルと値がすべて同じ敵に共通の印 (画面で「同じ値の敵を 1 行にまとめる」ときに使う)
const WHERE = { 'そのほか': '', '弱い敵 (目安)': '', 'レベルから選ぶ': 'レベルだけ', 'オデシー ジェール (難易度ごと)': 'オデシー ジェール', 'アンバスケード (エキスパート)': 'アンバスケード' };
function oneEach(enemies, families) {
  // 種族は、名前に入っている言葉から引く (長い言葉を先に見る)
  const words = Object.keys(families).sort((a, b) => b.length - a.length);
  const familyOf = (name) => {
    const word = words.find((w) => new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(name));
    return word ? families[word] : '';
  };
  const out = [];
  for (const enemy of enemies) {
    const apex = enemy.group === 'Apex・Locus モンスター';
    // 「名前 (場所)」の場所。場所は、最後のかっこ
    const m = apex ? enemy.ja.match(/^(.*) \(((?:[^()]|\([^()]*\))*)\)$/) : null;
    const where = m ? m[2] : WHERE[enemy.group] != null ? WHERE[enemy.group] : enemy.group;
    const names = (m ? m[1] : enemy.ja).split(' / ');
    const same = [enemy.lv, JSON.stringify(Object.entries(enemy.values).sort()), enemy.est.join(), enemy.table, enemy.guess].join('|');
    names.forEach((name, i) => out.push(Object.assign({}, enemy, {
      id: i ? `${enemy.id}-${i}` : enemy.id, ja: name, where, family: familyOf(name), same, std: enemy.group === 'レベルから選ぶ',
    })));
  }
  // 同じ敵 (名前・場所・レベルが同じ) が 2 つの資料から入っているときは、検証値の多いほうを残す
  const keyOf = (row) => [row.ja, row.where, row.lv].join('|');
  const best = new Map();
  for (const row of out) {
    if (row.std || !best.has(keyOf(row)) || row.est.length < best.get(keyOf(row)).est.length) best.set(keyOf(row), row);
  }
  const kept = out.filter((row) => row.std || best.get(keyOf(row)) === row);
  // 「名前 (型)」の行は、かっこの無い同じ敵が、同じ回避で、検証値を多く持っているなら要らない
  return kept.filter((row) => {
    const base = row.ja.match(/^(.*) \([^()]*\)$/);
    if (!base || row.std) return true;
    const other = best.get([base[1], row.where, row.lv].join('|'));
    return !(other && other.values.eva === row.values.eva && other.est.length < row.est.length);
  });
}
