// 装備の説明文 (ゲーム内表記) をステータスの並びに分解する。
// データを作るとき (tools/build-data.mjs) と、画面で手入力のオーグメントを読むときの両方で使う。
(function (root) {
  'use strict';

  //
  // 返す要素: { key, value, unit }
  //   key   … "ストアTP"、"ペット:命中" のような名前。条件つきのものは「条件:名前」
  //   value … 数値。数値を持たない特殊効果は null
  //   unit  … "%" か ""
  //
  // 条件の扱い:
  //   ユニティランク … ランクで変わる幅の中間の値を、条件なしの値として数える
  //   潜在能力 など   … 「潜在能力:命中」のように別の名前になり、条件なしの値には足されない

  const BASE = /^(防|D|隔)(\d+)$/;
  const NUMERIC = /^(.+?)([+\-±])(\d+(?:\.\d+)?)(?:~[+\-]?(\d+(?:\.\d+)?))?(%?)$/;
  // 「詠唱中断率10%ダウン」は「詠唱中断率-10%」として数える
  const RATE_DOWN = /^(.+率)(\d+(?:\.\d+)?)%ダウン$/;
  const UNITY = 'ユニティランク';
  const OPEN_ENDED = /^(.+?)[+\-]$/; // 「コンビネーション:命中+」のように数値が書かれないもの

  function normalize(text) {
    return text.normalize('NFKC');
  }

  function parseDescription(text) {
    const out = [];
    let scope = '';
    // 行頭から始まった条件は、次の条件が出てくるまで後ろの行にも続くとみなす
    // (「ドメインベージョン:STR+30 …」のあと数行にわたって続く書き方がある)。
    // 行の途中から始まった条件は、その行の終わりまで
    let carry = false;

    for (const line of normalize(text).split('\n')) {
      const tokens = line.split(/\s+/).filter(Boolean);
      if (!carry) scope = '';

      tokens.forEach((raw, index) => {
        let token = raw;
        const colon = token.indexOf(':');
        if (colon > 0) {
          scope = token.slice(0, colon);
          token = token.slice(colon + 1);
          carry = index === 0;
          if (!token) return;
        }
        // 文章 (句点を含む) は説明書きなのでステータスにしない
        if (token.includes('。') || token.includes('、')) return;

        const prefix = scope ? scope + ':' : '';
        let m;
        if (!token.includes('/') && (m = token.match(BASE))) {
          out.push({ key: prefix + m[1], value: Number(m[2]), unit: '' });
        } else if ((m = token.match(RATE_DOWN))) {
          out.push({ key: prefix + m[1], value: -Number(m[2]), unit: '%' });
        } else if (!token.includes('/') && (m = token.match(NUMERIC))) {
          // 「+10~15」は中間 (端数は切り捨て) を採る
          const magnitude = m[4] === undefined ? Number(m[3]) : Math.floor((Number(m[3]) + Number(m[4])) / 2);
          const key = scope === UNITY ? m[1] : prefix + m[1];
          out.push({ key, value: m[2] === '-' ? -magnitude : magnitude, unit: m[5] });
        } else if (!token.includes('/') && (m = token.match(OPEN_ENDED))) {
          out.push({ key: prefix + m[1], value: null, unit: '' });
        } else {
          out.push({ key: prefix + token, value: null, unit: '' });
        }
      });
    }
    return out;
  }

  const api = { normalize, parseDescription };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VanaParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
