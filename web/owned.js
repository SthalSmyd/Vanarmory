// 持っている装備。Moglist (収納の中身を読むツール) が書き出したファイルを読み込み、
// 「持っている装備だけで組む」「実物のオーグメントで計算する」ための候補を作る。
// セットを組む画面 (builder.js)、設定画面 (settings.js)、テスト (Node) から使う。
//
// 保存する形 (キャラクターごと。profiles.js の owned):
//   { at: 書き出した日時, items: [{ id, n, ext?, path?, rank?, augs?, undecoded? }] }
//   id        アイテム番号 (このツールの装備の id と同じ)
//   n         個数
//   ext       オーグメントの中身を表す文字。同じ装備のオーグメント違いを見分ける鍵にする
//   path rank ルート (A〜D) とランク
//   augs      オーグメント。ゲーム内の表記の並び (["命中+24", "ストアTP+3"])
//   undecoded オーグメントが付いているが、Moglist が読めなかった
//
// 補正 (キャラクターごと。profiles.js の ownedFix): { 「アイテム番号:ext」: { variant?, text? } }
//   強化の値を読めなかった装備を、本人が直したもの。読み込み直しても残る
//   variant  このツールが持っている「強化した状態」の id。その値で計算する
//   text     オーグメント。ゲーム内の表記 (「STR+8 命中+12」)。あれば variant より優先し、元の装備に上乗せする
(function (root) {
  'use strict';

  const A = typeof module !== 'undefined' && module.exports ? require('./augment.js') : root.VanaAugment;

  const FORMAT = 'moglist-gear';
  const PAIRED = (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14); // 耳・指。同じ装備を 2 個持っていれば、両方に着けられる

  // ファイルの中身 (文字) を確かめて、保存する形に直す。読めなければ、理由を付けて投げる
  function read(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('JSON として読めません。Moglist の「Vanarmory へ書き出す」で作ったファイルを選んでください。');
    }
    if (!raw || raw.format !== FORMAT || !Array.isArray(raw.items)) throw new Error('Moglist が書き出したファイルではありません。');
    if (raw.version !== 1) throw new Error(`このファイルの形 (version ${raw.version}) には対応していません。`);
    const items = [];
    for (const o of raw.items) {
      if (!o || !Number.isInteger(o.id)) continue;
      const item = { id: o.id, n: Number.isInteger(o.n) && o.n > 0 ? o.n : 1 };
      if (typeof o.ext === 'string' && /^[0-9a-f]*$/i.test(o.ext)) item.ext = o.ext.toLowerCase();
      if (typeof o.path === 'string' && /^[A-D]$/.test(o.path)) {
        item.path = o.path;
        item.rank = Number.isInteger(o.rank) ? o.rank : 0;
      }
      if (Array.isArray(o.augs) && o.augs.length) item.augs = o.augs.map(String);
      if (o.undecoded) item.undecoded = true;
      items.push(item);
    }
    return { at: typeof raw.read_at === 'string' ? raw.read_at : '', items };
  }

  // Moglist の書き方と、このツールのステータス名が違うものを、こちらの名前に直す
  const rename = (aug) => aug
    .replace(/^ファランクス(?=[+-])/, '被ファランクス')
    .replace(/^詠唱中断率ダウン\+(\d+)/, '詠唱中断率-$1');

  // 装備の、元になるアイテム番号。強化した状態 ("23761#RP15 A") は # の前、持っている装備の候補は base
  const baseOf = (item) => (item.owned ? item.base : typeof item.id === 'number' ? item.id : Number(String(item.id).split('#')[0]));

  // 強化した状態の名前 ("RP15 A"、"R15") の、ルートの文字。無ければ空
  const pathOf = (variant) => (/\s([A-D])$/.exec(variant.rank || '') || [])[1] || '';

  // 持っている装備から、候補にする装備を作る。
  // 返す形: { items, byId, baseIds, total, withAug, skipped, unknown, needs }
  //   items   候補。元の装備を写して、実物のオーグメントを上乗せしたもの (owned: true)。
  //           id は "own:アイテム番号:ext"。収納の場所は入れないので、整頓し直しても同じ id になる。
  //           耳・指に着けられる装備を 2 個以上持っていれば、2 個目を "…#2" として作る
  //   byId    id -> 候補
  //   baseIds 持っている装備のアイテム番号 (このツールにあるものだけ)
  //   skipped このツールのデータに無くて、読み飛ばした個数
  //   unknown オーグメントのうち、このツールが知らない名前
  //   needs   強化の値を読めなかった装備 (補正の画面に並べる)。
  //           [{ key, item (元の装備), label, why, options: [強化した状態], fix (いまの補正。無ければ null), unknown: [補正の中の知らない名前] }]
  function build(db, owned, fixes) {
    const plainById = new Map();
    const variants = new Map(); // アイテム番号 -> 強化した状態の並び
    for (const item of db.data.items) {
      if (typeof item.id === 'number') plainById.set(item.id, item);
      else if (/^\d+#/.test(String(item.id))) {
        const base = Number(String(item.id).split('#')[0]);
        if (!variants.has(base)) variants.set(base, []);
        variants.get(base).push(item);
      }
    }
    const out = { items: [], byId: new Map(), baseIds: new Set(), total: 0, withAug: 0, skipped: 0, unknown: new Set(), needs: [] };
    const made = new Map(); // id -> 作った数
    for (const o of (owned && owned.items) || []) {
      out.total++;
      const plain = plainById.get(o.id);
      if (!plain) {
        out.skipped++;
        continue;
      }
      out.baseIds.add(o.id);
      if (o.augs || o.path) out.withAug++;
      const key = `own:${o.id}:${o.ext || ''}`;
      const limit = plain.slots & PAIRED ? 2 : 1;
      for (let k = 0; k < o.n && (made.get(key) || 0) < limit; k++) {
        const index = made.get(key) || 0;
        made.set(key, index + 1);
        const item = make(db, plain, variants.get(o.id) || [], o, out, (fixes || {})[`${o.id}:${o.ext || ''}`], index === 0);
        item.id = index ? `${key}#${index + 1}` : key;
        out.items.push(item);
        out.byId.set(item.id, item);
      }
    }
    return out;
  }

  // 元の装備の性能に、オーグメント (ゲーム内の表記) を上乗せしたものを返す。知らない名前は unknown に足す
  function boosted(db, plain, text, unknown) {
    const m = new Map(plain.plainM || plain.m);
    const parsed = A.read(db, text);
    for (const [i, value] of parsed.pairs) m.set(i, (m.get(i) || 0) + value);
    for (const k of parsed.unknown) unknown.add(k);
    // 「被物理ダメージ(被ダメージ込み)」のような合算を作り直す
    for (const d of db.data.derived || []) {
      const parts = d.parts.map((p) => m.get(db.statByKey.get(p).i)).filter((v) => typeof v === 'number');
      if (parts.length) m.set(db.statByKey.get(d.k).i, parts.reduce((a, b) => a + b, 0));
    }
    return m;
  }

  // 候補を 1 つ作る。オーグメントの扱いは 3 通り:
  //   中身が分かっている … 元の装備に、その値を上乗せする (手入力のオーグメントより優先)
  //   ルートとランクだけ … このツールが持っている「強化した状態」のうち、同じルートでランクを超えないいちばん上を使う
  //   無い・読めなかった … 元の装備のまま (手入力のオーグメントがあれば、それは残る)
  // 下の 2 つで強化の値が分からなかったものは、本人の補正 (fix) があればそれで計算し、補正の画面に並べる (list が true のとき)
  function make(db, plain, variants, o, out, fix, list) {
    const rankLabel = o.path ? ` R${o.rank} ${o.path}` : '';
    const own = { plain: '', owned: true, base: o.id };
    if (o.augs) {
      const m = boosted(db, plain, o.augs.map(rename).join(' '), out.unknown);
      return Object.assign({}, plain, own, { m, rank: '所持' + rankLabel, aug: o.augs.join(' '), manual: '', manualKey: null });
    }
    let source = plain;
    let note = '';
    let why = o.undecoded ? 'オーグメントを読めなかった' : '';
    if (o.undecoded) note = ' オーグメント未解読';
    const options = variants.filter((v) => !o.path || !pathOf(v) || pathOf(v) === o.path).sort((a, b) => (a.rp || 0) - (b.rp || 0));
    if (o.path) {
      const fit = options.filter((v) => (v.rp || 0) <= o.rank).pop();
      if (fit) source = fit;
      // ちょうどのランクの値を持っていないときは、下のランクの値で計算していることを名前に出す
      if (o.rank > 0 && (!fit || (fit.rp || 0) < o.rank)) {
        note = fit ? ` (R${fit.rp} の値)` : ' (強化の値なし)';
        why = `R${o.rank} の値が無い`;
      }
    }
    if (!why) return Object.assign({}, source, own, { m: source.m, rank: '所持' + rankLabel, manualKey: source.id });
    const text = fix && typeof fix.text === 'string' ? fix.text.trim() : '';
    const chosen = fix && fix.variant ? options.find((v) => v.id === fix.variant) : null;
    const unknown = new Set();
    let item;
    if (text) {
      item = Object.assign({}, plain, own, { m: boosted(db, plain, text, unknown), rank: `所持${rankLabel} 補正`, aug: text, manual: '', manualKey: null });
    } else if (chosen) {
      item = Object.assign({}, chosen, own, { m: chosen.m, rank: `所持${rankLabel} 補正 (${chosen.rank} の値)`, manualKey: chosen.id });
    } else {
      item = Object.assign({}, source, own, { m: source.m, rank: '所持' + rankLabel + note, manualKey: source.id });
    }
    if (list) {
      out.needs.push({ key: `${o.id}:${o.ext || ''}`, item: plain, label: rankLabel.trim(), why, options, fix: text || chosen ? { variant: chosen ? chosen.id : '', text } : null, unknown: [...unknown] });
    }
    return item;
  }

  const api = { FORMAT, read, build, baseOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaOwned = api;
})(typeof window !== 'undefined' ? window : globalThis);
