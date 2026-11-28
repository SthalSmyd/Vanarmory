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

  // 「被物理ダメージ(被ダメージ込み)」のような合算を作り直す
  function rederive(db, m) {
    for (const d of db.data.derived || []) {
      const parts = d.parts.map((p) => m.get(db.statByKey.get(p).i)).filter((v) => typeof v === 'number');
      if (parts.length) m.set(db.statByKey.get(d.k).i, parts.reduce((a, b) => a + b, 0));
    }
  }

  // 装備の「ユニティランク:STR+10～20」のような、ユニティランクで変わる値。[ステータスの番号, 最小, 最大, 中間] の並び。
  // データには中間の値が入っているので、最小・最大を選んだときは、その差を足す
  function unityOf(db, item) {
    if (item.unity !== undefined) return item.unity;
    const list = [];
    if (item.desc && item.desc.includes('ユニティランク')) {
      for (const s of parse.parseDescription(item.desc)) {
        if (!s.unity) continue;
        const stat = db.statByKey.get(s.key) || db.statByKey.get(s.key + (s.unit === '%' ? '(%)' : '(実数)'));
        if (stat) list.push([stat.i, s.unity[0], s.unity[1], s.value]);
      }
    }
    item.unity = list.length ? list : null;
    return item.unity;
  }

  // augments: { 装備の id: 入力した文字 }。装備の性能 (item.m) を、上乗せした値に置き換える。
  // 前に上乗せした分は先に元へ戻すので、キャラクターを切り替えたときも呼べばよい。
  // unity: ユニティランクで変わる値の数え方。'min' (最小) / 'mid' (中間。既定) / 'max' (最大)
  function apply(db, augments, unity) {
    const byId = new Map(db.data.items.map((item) => [String(item.id), item]));
    for (const item of db.data.items) {
      if (item.plainM) {
        item.m = item.plainM;
        delete item.plainM;
        item.manual = '';
      }
      // ユニティランクの値を入れ直す (midM が、中間の値のままの元の性能)
      if (item.midM) item.m = item.midM;
      const ranges = unityOf(db, item);
      if (!ranges || (unity !== 'min' && unity !== 'max')) continue;
      item.midM = item.m;
      const m = new Map(item.m);
      for (const [i, low, high, mid] of ranges) m.set(i, (m.get(i) || 0) + (unity === 'max' ? high : low) - mid);
      rederive(db, m);
      item.m = m;
    }
    for (const [id, text] of Object.entries(augments || {})) {
      const item = byId.get(String(id));
      if (!item || !String(text).trim()) continue;
      const m = new Map(item.m);
      for (const [i, value] of read(db, text).pairs) m.set(i, (m.get(i) || 0) + value);
      rederive(db, m);
      item.plainM = item.m;
      item.m = m;
      item.manual = String(text).trim();
    }
  }

  const api = { read, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaAugment = api;
})(typeof window !== 'undefined' ? window : globalThis);
