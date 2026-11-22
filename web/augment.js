// 手入力のオーグメント。ランダムで付くオーグメント (ソーティの耳装備など) は人によって値が違うので、
// 「STR+8 DEX+8 命中+12」のように本人が入力し、その装備の性能に上乗せする。
// セットを組む画面 (builder.js)、設定画面 (settings.js)、テスト (Node) から使う。
(function (root) {
  'use strict';

  const parse = typeof module !== 'undefined' && module.exports ? require('./parse.js') : root.VanaParse;

  // 入力した文字を [ステータスの番号, 値] に直す。装備のデータに無い名前は unknown に入れて返す
  function read(db, text) {
    const pairs = [];
    const unknown = [];
    for (const s of parse.parseDescription(text || '')) {
      const stat = db.statByKey.get(s.key);
      if (!stat || s.value === null) unknown.push(s.key);
      else pairs.push([stat.i, s.value]);
    }
    return { pairs, unknown };
  }

  // augments: { 装備の id: 入力した文字 }。装備の性能 (item.m) を、上乗せした値に置き換える。
  // 前に上乗せした分は先に元へ戻すので、キャラクターを切り替えたときも呼べばよい
  function apply(db, augments) {
    const byId = new Map(db.data.items.map((item) => [String(item.id), item]));
    for (const item of db.data.items) {
      if (!item.plainM) continue;
      item.m = item.plainM;
      delete item.plainM;
      item.manual = '';
    }
    for (const [id, text] of Object.entries(augments || {})) {
      const item = byId.get(String(id));
      if (!item || !String(text).trim()) continue;
      const m = new Map(item.m);
      for (const [i, value] of read(db, text).pairs) m.set(i, (m.get(i) || 0) + value);
      // 「被物理ダメージ(被ダメージ込み)」のような合算を作り直す
      for (const d of db.data.derived || []) {
        const parts = d.parts.map((p) => m.get(db.statByKey.get(p).i)).filter((v) => typeof v === 'number');
        if (parts.length) m.set(db.statByKey.get(d.k).i, parts.reduce((a, b) => a + b, 0));
      }
      item.plainM = item.m;
      item.m = m;
      item.manual = String(text).trim();
    }
  }

  const api = { read, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaAugment = api;
})(typeof window !== 'undefined' ? window : globalThis);
