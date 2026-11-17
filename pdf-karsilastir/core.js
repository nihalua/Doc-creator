/*
 * PDF Revizyon Karşılaştırma — çekirdek mantık
 * --------------------------------------------
 * Bu dosya tarayıcıdan bağımsızdır (Node ile de test edilebilir).
 * Hiçbir ağ çağrısı yapmaz; tüm işlem yerel bellekte gerçekleşir.
 *
 *  - buildLines      : pdf.js metin parçalarından satır oluşturur
 *  - markBoilerplate : üst/alt bilgi ve sayfa numaralarını işaretler
 *  - prepareDoc      : satırları kelime (token) dizisine çevirir, başlıkları bulur
 *  - compareDocs     : iki dokümanı kelime düzeyinde karşılaştırır, farkları gruplar ve puanlar
 *  - summarizeDoc    : dokümanın içeriğini (başlık, anahtar terimler, önemli cümleler) özetler
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // Yardımcılar
  // ------------------------------------------------------------------

  function trLower(s) {
    return s.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
  }

  function normalizeChars(s) {
    return s
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/ /g, ' ')
      .replace(/ﬁ/g, 'fi')
      .replace(/ﬂ/g, 'fl');
  }

  const STOPWORDS = new Set((
    // Türkçe
    'acaba ama ancak artık aslında az bazı belki biri birkaç birşey biz bu buna bunda bundan bunlar bunları bunların bunu bunun burada çok çünkü da daha dahi de defa diye dolayı en gibi göre hem hep hepsi her hiç için ile ise kadar ki kim mı mi mu mü nasıl ne neden nerde nerede nereye niye niçin o olan olarak oldu olduğu olduğunu olmak olması olup olur olursa ona ondan onlar onları onların onu onun orada öyle sadece şey şu şuna şunda şundan şunu tarafından üzere tüm ve veya ya yani yine yoksa zaten bir iki üç dört beş altı yedi sekiz dokuz on ayrıca böyle bunlara diğer edilen eden etmek ettiği gereken halinde ilgili içinde kendi madde olarak olmayan sonra önce yer yapılan yapılır yapılacak edilir edilecek edilecektir olacaktır yapılacaktır hazırlanacaktır ise ait aynı arasında bile böylece buna göre şekilde sırasında üzerinde yapılması olacak '
    // English
    + 'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing done down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor of off on once only or other our out over own same she so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours per via within without upon shall must should may etc e.g i.e'
  ).split(/\s+/));

  // Zorunluluk / yükümlülük / olumsuzluk ifadeleri (TR + EN)
  const REQ_TERMS = [
    'shall', 'must', 'should', 'may', 'will', 'required', 'require', 'requires', 'mandatory', 'prohibited',
    'forbidden', 'not', 'never', 'only', 'minimum', 'maximum', 'min', 'max', 'optional', 'recommended',
    'allowed', 'permitted', 'except', 'unless', 'cannot',
    'zorunlu', 'zorunludur', 'gerekli', 'gereklidir', 'gerekir', 'gerekmektedir', 'yasak', 'yasaktır',
    'değil', 'değildir', 'hariç', 'sadece', 'yalnızca', 'asla', 'opsiyonel', 'isteğe', 'önerilir',
    'tavsiye', 'izin', 'müsaade', 'azami', 'asgari', 'en az', 'en fazla', 'en çok', 'at least', 'at most',
    'no later than', 'not later than'
  ];
  const STRONG_REQ_RE = /\b(shall|must|required|mandatory|prohibited|zorunlu\w*|gerekli\w*|gerekir|gerekmektedir|yasak\w*)\b|\p{L}+(mal[ıi]d[ıi]r|meli(d[iı]r)?|mamal[ıi]|memeli)\b/iu;
  const TR_MODAL_RE = /\p{L}+?(m[ae]m[ae]l[ıi]|m[ae]l[ıi]d[ıi]r|m[ae]l[ıi])(?![\p{L}])/gu;

  function reqTerms(text) {
    const lower = ' ' + trLower(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ') + ' ';
    const found = {};
    for (const term of REQ_TERMS) {
      let idx = 0, c = 0;
      const needle = ' ' + term + ' ';
      while ((idx = lower.indexOf(needle, idx)) !== -1) { c++; idx += needle.length - 1; }
      if (c) found[term] = c;
    }
    const m = lower.match(TR_MODAL_RE);
    if (m) for (const w of m) {
      const suf = w.match(/(m[ae]m[ae]l[ıi]|m[ae]l[ıi]d[ıi]r|m[ae]l[ıi])$/u)[0];
      const key = /m[ae]m[ae]l/.test(suf) ? '-mamalı/-memeli' : '-malı/-meli';
      found[key] = (found[key] || 0) + 1;
    }
    return found;
  }

  const NUM_RE = /(?<![\p{L}\d.,])%?[±+-]?\d+(?:[.,]\d+)*(?:\s?(?:%|°C|°F|°|mm|cm|km|m|kg|g|mg|t|ton|kN|N|MPa|kPa|Pa|bar|psi|V|kV|mA|A|kW|W|MW|Hz|kHz|MHz|s|sn|dk|min|h|saat|gün|days?|ay|yıl|years?|TL|USD|EUR|€|\$|adet|pcs|x)(?![\p{L}]))?(?![\p{L}\d])/gu;

  // harf ve rakam içeren kodlar: etiket/tag adları (6981XV01001, GGG40, S698101001, I665101A57 …)
  function codes(text) {
    return (text.match(/[\p{L}\p{N}_.-]*\p{L}[\p{L}\p{N}_.-]*\d[\p{L}\p{N}_.-]*|[\p{L}\p{N}_.-]*\d[\p{L}\p{N}_.-]*\p{L}[\p{L}\p{N}_.-]*/gu) || [])
      .map(s => s.replace(/[._-]+$/, ''));
  }

  function numbers(text) {
    return (text.match(NUM_RE) || []).map(s => s.replace(/\s+/g, ' ').trim());
  }

  function multisetDiff(a, b) {
    const ca = new Map();
    for (const x of a) ca.set(x, (ca.get(x) || 0) + 1);
    const onlyB = [];
    for (const x of b) {
      const c = ca.get(x) || 0;
      if (c > 0) ca.set(x, c - 1); else onlyB.push(x);
    }
    const onlyA = [];
    for (const [x, c] of ca) for (let i = 0; i < c; i++) onlyA.push(x);
    return { onlyA, onlyB };
  }

  // ------------------------------------------------------------------
  // 1) pdf.js metin parçalarından satır oluşturma
  // ------------------------------------------------------------------

  /**
   * @param items  pdf.js textContent.items
   * @param pageNum 1 tabanlı sayfa numarası
   * @param pageHeight sayfa yüksekliği (pt)
   */
  function buildLines(items, pageNum, pageHeight) {
    const pts = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const t = it.transform;
      const h = Math.abs(it.height) || Math.hypot(t[2], t[3]) || 10;
      pts.push({ str: normalizeChars(it.str), x: t[4], y: t[5], w: it.width || 0, h });
    }
    pts.sort((p, q) => (q.y - p.y) || (p.x - q.x));

    const groups = [];
    for (const p of pts) {
      const g = groups.length ? groups[groups.length - 1] : null;
      if (g && Math.abs(g.y - p.y) <= Math.max(2, 0.45 * Math.min(g.h, p.h))) {
        g.items.push(p);
        g.h = Math.max(g.h, p.h);
      } else {
        groups.push({ y: p.y, h: p.h, items: [p] });
      }
    }

    const lines = [];
    for (const g of groups) {
      g.items.sort((p, q) => p.x - q.x);
      let text = '';
      let prevEnd = null;
      for (const p of g.items) {
        if (text) {
          const gap = prevEnd === null ? 1 : p.x - prevEnd;
          const needSpace = gap > 0.12 * p.h && !/\s$/.test(text) && !/^\s/.test(p.str);
          if (needSpace) text += ' ';
        }
        text += p.str;
        prevEnd = p.w ? p.x + p.w : null;
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      lines.push({
        text,
        page: pageNum,
        y: g.y,
        size: Math.round(g.h * 10) / 10,
        rel: pageHeight ? 1 - g.y / pageHeight : 0, // 0 = sayfa üstü, 1 = sayfa altı
        boiler: false,
        heading: false
      });
    }
    return lines;
  }

  // ------------------------------------------------------------------
  // 2) Üst bilgi / alt bilgi / sayfa numarası tespiti
  // ------------------------------------------------------------------

  function markBoilerplate(pages) {
    // pages: [[line,...], ...]
    const nPages = pages.length;
    // yalnızca tek başına duran sayılar (sayfa no, tarih) genelleştirilir; 6981XV01001 / S35 gibi kodlar korunur
    const keyOf = l => trLower(l.text).replace(/(?<![\p{L}\d])\d+(?![\p{L}\d])/gu, '#').replace(/\s+/g, ' ').trim();
    const EDGE = 3;
    const counts = new Map();
    pages.forEach(lines => {
      const edge = new Set();
      lines.slice(0, EDGE).forEach(l => edge.add(keyOf(l)));
      lines.slice(-EDGE).forEach(l => edge.add(keyOf(l)));
      edge.forEach(k => counts.set(k, (counts.get(k) || 0) + 1));
    });
    const pageNumRe = /^(sayfa|page|sf\.?|s\.)?\s*#\s*((\/|of|\/ ?|-|\s)\s*#)?\s*$|^-\s*#\s*-$|^#\s*\/\s*#$|^(sayfa|page)\s*#\s*(of|\/)\s*#$/i;
    pages.forEach(lines => {
      const n = lines.length;
      lines.forEach((l, i) => {
        const atEdge = i < EDGE || i >= n - EDGE;
        if (!atEdge) return;
        const k = keyOf(l);
        if (pageNumRe.test(k)) { l.boiler = true; return; }
        if (nPages >= 2 && (counts.get(k) || 0) >= Math.max(2, Math.ceil(nPages * 0.5))) l.boiler = true;
      });
    });
  }

  // ------------------------------------------------------------------
  // 3) Başlık tespiti + tokenlara ayırma
  // ------------------------------------------------------------------

  const NUMBERED_HEADING_RE = /^((\d+(\.\d+)*\.?)|([IVXLC]+\.)|([A-Z]\.)|((madde|bölüm|kısım|ek|section|chapter|article|part|appendix|annex)\s*[\dA-Z]*[.:)-]?))\s+\S/iu;

  function detectHeadings(lines) {
    const sizeChars = new Map();
    for (const l of lines) {
      if (l.boiler) continue;
      sizeChars.set(l.size, (sizeChars.get(l.size) || 0) + l.text.length);
    }
    let body = 0, best = -1;
    for (const [s, c] of sizeChars) if (c > best) { best = c; body = s; }
    for (const l of lines) {
      if (l.boiler) continue;
      const t = l.text;
      const words = t.split(' ').length;
      if (t.length > 110 || words > 14 || !/\p{L}{2,}/u.test(t)) continue;
      if (/[.,;]$/.test(t)) continue;
      const big = body && l.size >= body * 1.12;
      const numbered = NUMBERED_HEADING_RE.test(t) && /\p{Lu}/u.test(t.replace(/^[\d.\sIVXLC]+/, '').charAt(0) || '');
      const letters = t.replace(/[^\p{L}]/gu, '');
      const caps = letters.length >= 4 && letters === letters.toLocaleUpperCase('tr') && words <= 10;
      if (big || (numbered && words <= 12) || caps) l.heading = true;
    }
    return body;
  }

  const PAGE_FOOTER_RE = /(\bRev(?:ision)?\.?\s*[\w-]{1,4}\s+)?\b(Page|Sayfa|Sheet|Pg\.?)\s*\d+\s*(of|\/|von|de)\s*\d+\b/giu;
  const TOC_RE = /(\.\s?){5,}\s*\d{1,4}\s*$|^\.{2,}\s*\d{1,4}$/u;
  const REV_MARK_RE = /^(0\d|[A-Z]\d|R\d{1,2})$/;
  const DELETED_RE = /^(deleted|silindi|removed|entfällt)$/i;
  const TOKEN_RE = /[\p{L}\p{N}](?:[\p{L}\p{N}_._,/'%°&-]*[\p{L}\p{N}%°])?|[^\s\p{L}\p{N}]/gu;

  /**
   * Satır listesini (tüm sayfalar) karşılaştırmaya hazır yapıya çevirir.
   * @param pages [[line,...],...]
   */
  function prepareDoc(pages, opts) {
    opts = opts || {};
    const lines = [];
    if (opts.ignoreBoilerplate !== false) {
      markBoilerplate(pages);
      pages.forEach(pl => pl.forEach(l => {
        // tablo içine karışmış "Rev 02 Page 12 of 246" / "Sayfa 3 / 10" ifadeleri
        const t = l.text.replace(PAGE_FOOTER_RE, ' ').replace(/\s+/g, ' ').trim();
        if (t !== l.text) { l.text = t; if (!t) l.boiler = true; }
        // içindekiler satırları (noktalı sayfa numarası: "2.1 Başlık ........ 12")
        if (TOC_RE.test(l.text)) { l.boiler = true; l.toc = true; }
      }));
    }
    pages.forEach(pl => pl.forEach(l => lines.push(l)));
    const bodySize = detectHeadings(lines);

    const tokens = []; // {t, page, line, sp}
    const headingAt = []; // satır index -> o satırın ait olduğu başlık
    let curHeading = '';
    let pendingHyphen = false;
    lines.forEach((l, li) => {
      if (l.heading && !l.boiler) curHeading = l.text;
      headingAt[li] = curHeading;
      if (l.boiler) return;
      const m = l.text.match(TOKEN_RE) || [];
      // boşluk bilgisini bulmak için orijinal metinde ilerle
      let pos = 0;
      m.forEach((tok, ti) => {
        const at = l.text.indexOf(tok, pos);
        const sp = ti === 0 ? true : at > pos;
        pos = at + tok.length;
        if (ti === 0 && pendingHyphen && /^\p{Ll}/u.test(tok)) {
          // satır sonu tirelemesi: "değer-" + "lendirme" -> "değerlendirme"
          const prevHy = tokens[tokens.length - 1];
          const prevWord = tokens[tokens.length - 2];
          if (prevHy && prevHy.t === '-' && prevWord) {
            tokens.pop();
            prevWord.t += tok;
            return;
          }
        }
        tokens.push({ t: tok, page: l.page, line: li, sp });
      });
      const last = m[m.length - 1];
      pendingHyphen = last === '-' && m.length > 1 && !/\s-$/.test(l.text);
    });

    let revMarks = [];
    if (opts.ignoreRevMarks) {
      // Kenar revizyon işaretleri: çok sık geçen, tek başına duran "02", "03", "A1" gibi kısa kodlar
      const cnt = new Map();
      tokens.forEach(t => { if (REV_MARK_RE.test(t.t)) cnt.set(t.t, (cnt.get(t.t) || 0) + 1); });
      const limit = Math.max(15, pages.length * 0.3);
      revMarks = [...cnt.entries()].filter(e => e[1] >= limit).map(e => e[0]);
      if (revMarks.length) {
        const set = new Set(revMarks);
        const keep = [];
        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i];
          if (set.has(t.t)) {
            // "deleted 02" gibi yer tutucuları da kaldır
            const prev = keep[keep.length - 1];
            if (prev && DELETED_RE.test(prev.t)) keep.pop();
            continue;
          }
          keep.push(t);
        }
        tokens.length = 0; keep.forEach(t => tokens.push(t));
      }
    }

    return { pages: pages.length, lines, tokens, headingAt, bodySize, revMarks };
  }

  // ------------------------------------------------------------------
  // 4) Fark algoritması (Myers O(ND) + patience bölütleme)
  // ------------------------------------------------------------------

  function myers(a, b, a0, a1, b0, b1, maxD, out) {
    const n = a1 - a0, m = b1 - b0;
    const max = n + m;
    const off = max + 1;
    const V = new Int32Array(2 * max + 3);
    V[off + 1] = 0;
    const trace = [];
    let Dfound = -1;
    outer:
    for (let d = 0; d <= max; d++) {
      if (d > maxD) return false;
      trace.push(V.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) x = V[off + k + 1];
        else x = V[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++; }
        V[off + k] = x;
        if (x >= n && y >= m) { Dfound = d; break outer; }
      }
    }
    // geri izleme
    const rev = [];
    let x = n, y = m;
    for (let d = Dfound; d > 0; d--) {
      const Vp = trace[d];
      const base = d + 1;
      const k = x - y;
      let prevK;
      if (k === -d || (k !== d && Vp[k - 1 + base] < Vp[k + 1 + base])) prevK = k + 1;
      else prevK = k - 1;
      const prevX = Vp[prevK + base];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { rev.push(0, a0 + x - 1, b0 + y - 1); x--; y--; }
      if (prevK === k + 1) rev.push(2, -1, b0 + y - 1); // ekleme
      else rev.push(1, a0 + x - 1, -1); // silme
      x = prevX; y = prevY;
    }
    while (x > 0 && y > 0) { rev.push(0, a0 + x - 1, b0 + y - 1); x--; y--; }
    for (let i = rev.length - 3; i >= 0; i -= 3) out.push(rev[i], rev[i + 1], rev[i + 2]);
    return true;
  }

  function lisIndices(arr) {
    // arr: b-pozisyonları; en uzun artan alt dizinin indeksleri
    const tails = [], tailIdx = [], prev = new Int32Array(arr.length).fill(-1);
    for (let i = 0; i < arr.length; i++) {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < arr[i]) lo = mid + 1; else hi = mid; }
      tails[lo] = arr[i]; tailIdx[lo] = i;
      prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
    }
    const res = [];
    let k = tails.length ? tailIdx[tails.length - 1] : -1;
    while (k !== -1) { res.push(k); k = prev[k]; }
    return res.reverse();
  }

  /**
   * a, b: tamsayı dizileri. Çıktı: düz dizi [op, ai, bi, op, ai, bi, ...]
   * op: 0 = aynı, 1 = silindi (A'da var), 2 = eklendi (B'de var)
   */
  function diffSeq(a, b) {
    const out = [];
    const DIRECT_LIMIT = 4000;   // bu boyutun altındaki bölümler doğrudan Myers ile
    const MAX_D = 2500;          // bir bölümde izin verilen maksimum düzenleme sayısı

    function coarse(a0, a1, b0, b1) {
      for (let i = a0; i < a1; i++) out.push(1, i, -1);
      for (let j = b0; j < b1; j++) out.push(2, -1, j);
    }

    function rec(a0, a1, b0, b1, depth) {
      // ortak ön ek
      while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) { out.push(0, a0, b0); a0++; b0++; }
      // ortak son ek (sonra eklenecek)
      let s = 0;
      while (a1 - s > a0 && b1 - s > b0 && a[a1 - 1 - s] === b[b1 - 1 - s]) s++;
      const ea1 = a1 - s, eb1 = b1 - s;

      if (a0 === ea1 || b0 === eb1) {
        coarse(a0, ea1, b0, eb1);
      } else if ((ea1 - a0) + (eb1 - b0) <= DIRECT_LIMIT || depth > 6) {
        if (!myers(a, b, a0, ea1, b0, eb1, (ea1 - a0) + (eb1 - b0) <= DIRECT_LIMIT ? Infinity : MAX_D, out)) coarse(a0, ea1, b0, eb1);
      } else {
        // patience: iki tarafta da tam bir kez geçen öğeler çapa olur
        const ca = new Map(), cb = new Map();
        for (let i = a0; i < ea1; i++) { const v = a[i]; const e = ca.get(v); ca.set(v, e === undefined ? i : -1); }
        for (let j = b0; j < eb1; j++) { const v = b[j]; const e = cb.get(v); cb.set(v, e === undefined ? j : -1); }
        const pairsA = [], pairsB = [];
        for (let i = a0; i < ea1; i++) {
          const v = a[i];
          if (ca.get(v) === i) { const j = cb.get(v); if (j !== undefined && j >= 0) { pairsA.push(i); pairsB.push(j); } }
        }
        const lis = lisIndices(pairsB);
        if (!lis.length) {
          if (!myers(a, b, a0, ea1, b0, eb1, MAX_D, out)) coarse(a0, ea1, b0, eb1);
        } else {
          let pa = a0, pb = b0;
          for (const li of lis) {
            const ai = pairsA[li], bj = pairsB[li];
            rec(pa, ai, pb, bj, depth + 1);
            out.push(0, ai, bj);
            pa = ai + 1; pb = bj + 1;
          }
          rec(pa, ea1, pb, eb1, depth + 1);
        }
      }
      for (let k = 0; k < s; k++) out.push(0, ea1 + k, eb1 + k);
    }

    rec(0, a.length, 0, b.length, 0);
    return out;
  }

  // ------------------------------------------------------------------
  // 5) Karşılaştırma, gruplama ve önem puanlaması
  // ------------------------------------------------------------------

  function detok(tokens) {
    let s = '';
    tokens.forEach((t, i) => { s += (i > 0 && t.sp ? ' ' : '') + t.t; });
    return s;
  }

  function compareDocs(A, B, opts) {
    opts = opts || {};
    const norm = opts.ignoreCase ? (t => trLower(t)) : (t => t);
    const dict = new Map();
    const id = t => { const k = norm(t); let v = dict.get(k); if (v === undefined) { v = dict.size; dict.set(k, v); } return v; };
    const a = Int32Array.from(A.tokens, t => id(t.t));
    const b = Int32Array.from(B.tokens, t => id(t.t));
    const ops = diffSeq(a, b);

    // --- grupla
    const MERGE_GAP = 3; // aradaki en fazla bu kadar ortak kelime olan değişiklikler birleştirilir
    const CONTEXT = 12;
    const hunks = [];
    const nOps = ops.length / 3;
    let i = 0;
    while (i < nOps) {
      if (ops[i * 3] === 0) { i++; continue; }
      const start = i;
      let end = i; // dahil
      let j = i;
      while (j < nOps) {
        if (ops[j * 3] !== 0) { end = j; j++; continue; }
        let k = j;
        while (k < nOps && ops[k * 3] === 0) k++;
        if (k < nOps && k - j <= MERGE_GAP) { j = k; continue; }
        break;
      }
      hunks.push({ s: start, e: end });
      i = end + 1;
    }

    const results = hunks.map((h, idx) => {
      const segs = [];
      const delT = [], insT = [];
      let lastA = -1, lastB = -1, firstA = -1, firstB = -1;
      for (let k = h.s; k <= h.e; k++) {
        const op = ops[k * 3], ai = ops[k * 3 + 1], bi = ops[k * 3 + 2];
        const type = op === 0 ? 'eq' : op === 1 ? 'del' : 'ins';
        const tok = op === 2 ? B.tokens[bi] : A.tokens[ai];
        if (op !== 2) { if (firstA < 0) firstA = ai; lastA = ai; }
        if (op !== 1) { if (firstB < 0) firstB = bi; lastB = bi; }
        if (op === 1) delT.push(tok);
        if (op === 2) insT.push(tok);
        const prev = segs[segs.length - 1];
        if (prev && prev.type === type) prev.tokens.push(tok);
        else segs.push({ type, tokens: [tok] });
      }
      // önceki/sonraki bağlam (ortak kelimeler)
      const before = [], after = [];
      for (let k = h.s - 1; k >= 0 && before.length < CONTEXT && ops[k * 3] === 0; k--) before.unshift(B.tokens[ops[k * 3 + 2]]);
      for (let k = h.e + 1; k < nOps && after.length < CONTEXT && ops[k * 3] === 0; k++) after.push(B.tokens[ops[k * 3 + 2]]);

      // konum: saf ekleme/silmede karşı tarafın konumunu komşu ortak öğeden bul
      const nearA = () => { for (let k = h.s - 1; k >= 0; k--) if (ops[k * 3 + 1] >= 0) return ops[k * 3 + 1]; for (let k = h.e + 1; k < nOps; k++) if (ops[k * 3 + 1] >= 0) return ops[k * 3 + 1]; return -1; };
      const nearB = () => { for (let k = h.s - 1; k >= 0; k--) if (ops[k * 3 + 2] >= 0) return ops[k * 3 + 2]; for (let k = h.e + 1; k < nOps; k++) if (ops[k * 3 + 2] >= 0) return ops[k * 3 + 2]; return -1; };
      const posA = firstA >= 0 ? firstA : nearA();
      const posB = firstB >= 0 ? firstB : nearB();
      const pageA = posA >= 0 && A.tokens[posA] ? A.tokens[posA].page : null;
      const pageB = posB >= 0 && B.tokens[posB] ? B.tokens[posB].page : null;
      const section = (firstB >= 0 ? B.headingAt[B.tokens[firstB].line] : null)
        || (firstA >= 0 ? A.headingAt[A.tokens[firstA].line] : null)
        || (posB >= 0 && B.tokens[posB] ? B.headingAt[B.tokens[posB].line] : '')
        || '';

      const type = delT.length && insT.length ? 'mod' : delT.length ? 'del' : 'ins';
      const oldText = detok(delT), newText = detok(insT);

      // başlık satırı etkilendi mi?
      const headingTouched =
        delT.some(t => A.lines[t.line] && A.lines[t.line].heading) ||
        insT.some(t => B.lines[t.line] && B.lines[t.line].heading);

      const imp = scoreChange(oldText, newText, delT.length, insT.length, headingTouched);

      return {
        id: idx + 1,
        type,
        segs: segs.map(s => ({ type: s.type, text: detok(s.tokens) })),
        before: detok(before),
        after: detok(after),
        oldText, newText,
        pageA, pageB, section,
        score: imp.score, level: imp.level, reasons: imp.reasons, cosmetic: imp.cosmetic,
        words: delT.length + insT.length
      };
    });

    return { changes: results, stats: buildStats(results, A, B) };
  }

  function scoreChange(oldText, newText, nDel, nIns, headingTouched) {
    const reasons = [];
    let score = 0;
    const strip = s => trLower(s).replace(/[^\p{L}\p{N}]+/gu, '');
    const cosmetic = strip(oldText) === strip(newText);
    if (cosmetic) {
      return { score: 0.1, level: 'low', reasons: [{ k: 'cosmetic', t: 'Biçimsel (noktalama / büyük-küçük harf)' }], cosmetic: true };
    }

    const nd = multisetDiff(numbers(oldText), numbers(newText));
    if (nd.onlyA.length || nd.onlyB.length) {
      score += 4;
      const fmt = arr => arr.slice(0, 4).join(', ') + (arr.length > 4 ? ' …' : '');
      let t;
      if (nd.onlyA.length && nd.onlyB.length) t = 'Sayısal değer değişti: ' + fmt(nd.onlyA) + ' → ' + fmt(nd.onlyB);
      else if (nd.onlyB.length) t = 'Yeni sayısal değer: ' + fmt(nd.onlyB);
      else t = 'Sayısal değer kaldırıldı: ' + fmt(nd.onlyA);
      reasons.push({ k: 'num', t });
    }

    const ra = reqTerms(oldText), rb = reqTerms(newText);
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    const gone = [], added = [];
    keys.forEach(k => {
      const d = (rb[k] || 0) - (ra[k] || 0);
      if (d < 0) gone.push(k); else if (d > 0) added.push(k);
    });
    if (gone.length || added.length) {
      score += 4;
      let t = 'Yükümlülük / olumsuzluk ifadesi: ';
      if (gone.length && added.length) t += '"' + gone.join(', ') + '" → "' + added.join(', ') + '"';
      else if (added.length) t += '"' + added.join(', ') + '" eklendi';
      else t += '"' + gone.join(', ') + '" kaldırıldı';
      reasons.push({ k: 'req', t });
    }

    const cd = multisetDiff(codes(oldText), codes(newText));
    if (cd.onlyA.length || cd.onlyB.length) {
      score += 3;
      const fmt = arr => arr.slice(0, 4).join(', ') + (arr.length > 4 ? ' …' : '');
      let t;
      if (cd.onlyA.length && cd.onlyB.length) t = 'Kod / etiket değişti: ' + fmt(cd.onlyA) + ' → ' + fmt(cd.onlyB);
      else if (cd.onlyB.length) t = 'Yeni kod / etiket: ' + fmt(cd.onlyB);
      else t = 'Kod / etiket kaldırıldı: ' + fmt(cd.onlyA);
      reasons.push({ k: 'code', t });
    }

    if (headingTouched) {
      score += 3;
      reasons.push({ k: 'head', t: 'Başlık / bölüm yapısı değişti' });
    }

    const w = nDel + nIns;
    score += Math.min(3, Math.log2(1 + w) / 2);
    if (w >= 40) reasons.push({ k: 'size', t: (nIns && !nDel ? 'Büyük ekleme' : !nIns && nDel ? 'Büyük silme' : 'Kapsamlı değişiklik') + ' (' + w + ' kelime)' });

    const level = score >= 5 ? 'high' : score >= 2.5 ? 'med' : 'low';
    return { score: Math.round(score * 10) / 10, level, reasons, cosmetic: false };
  }

  function buildStats(changes, A, B) {
    const st = { ins: 0, del: 0, mod: 0, high: 0, med: 0, low: 0, cosmetic: 0, num: 0, req: 0, head: 0, code: 0,
      wordsA: A.tokens.length, wordsB: B.tokens.length, pagesA: A.pages, pagesB: B.pages, sections: [] };
    const sec = new Map();
    for (const c of changes) {
      st[c.type]++;
      st[c.level]++;
      if (c.cosmetic) st.cosmetic++;
      c.reasons.forEach(r => { if (r.k in st) st[r.k]++; });
      if (!c.cosmetic) {
        const key = c.section || '(Başlıksız bölüm)';
        const e = sec.get(key) || { name: key, count: 0, score: 0, page: c.pageB || c.pageA };
        e.count++; e.score += c.score;
        sec.set(key, e);
      }
    }
    st.sections = [...sec.values()].sort((x, y) => y.score - x.score);
    // benzerlik oranı
    let changed = 0;
    for (const c of changes) changed += c.words;
    st.similarity = Math.max(0, 1 - changed / Math.max(1, A.tokens.length + B.tokens.length));
    return st;
  }

  // ------------------------------------------------------------------
  // 6) Doküman içerik özeti (çevrimdışı, çıkarımsal)
  // ------------------------------------------------------------------

  function summarizeDoc(D) {
    const lines = D.lines.filter(l => !l.boiler);

    // başlık: ilk sayfadaki en büyük yazı
    let title = '';
    const first = lines.filter(l => l.page === 1 && /\p{L}{2,}/u.test(l.text));
    if (first.length) {
      const maxS = Math.max(...first.map(l => l.size));
      const tl = [];
      let started = false;
      for (const l of first) {
        if (l.size >= maxS * 0.98 && !(started && NUMBERED_HEADING_RE.test(l.text))) { tl.push(l.text); started = true; }
        else if (started) break;
      }
      title = tl.join(' ').slice(0, 180);
    }

    // içindekiler
    const outline = lines.filter(l => l.heading).map(l => ({ text: l.text, page: l.page }));

    // kelime frekansları
    const words = [];
    D.tokens.forEach(t => { if (/\p{L}/u.test(t.t)) words.push(trLower(t.t)); });
    const freq = new Map();
    const isContent = w => w.length >= 3 && !STOPWORDS.has(w) && /\p{L}/u.test(w) && !/^\d/.test(w);
    words.forEach(w => { if (isContent(w)) freq.set(w, (freq.get(w) || 0) + 1); });
    const big = new Map();
    for (let i = 0; i + 1 < words.length; i++) {
      if (isContent(words[i]) && isContent(words[i + 1])) {
        const k = words[i] + ' ' + words[i + 1];
        big.set(k, (big.get(k) || 0) + 1);
      }
    }
    const topBig = [...big.entries()].filter(e => e[1] >= 3).sort((x, y) => y[1] - x[1]).slice(0, 8);
    const topUni = [...freq.entries()].sort((x, y) => y[1] - x[1]).slice(0, 16);
    // bir ikili terimin parçası olan ve neredeyse aynı sıklıkta geçen tekil terimleri ele
    const covered = w => topBig.some(([bg, n]) => bg.split(' ').includes(w) && n >= 0.8 * (freq.get(w) || 0));
    const keyTerms = [...topBig.map(e => ({ term: e[0], n: e[1] })), ...topUni.filter(e => !covered(e[0])).map(e => ({ term: e[0], n: e[1] }))]
      .sort((x, y) => y.n - x.n).slice(0, 20);

    // cümleler
    const sentences = [];
    let buf = '', bufPage = null;
    const flush = () => {
      const t = buf.replace(/\s+/g, ' ').trim();
      if (t) {
        t.split(/(?<=[.!?;])\s+(?=[\p{Lu}\d("“])/u).forEach(s => { if (s.trim()) sentences.push({ text: s.trim(), page: bufPage }); });
      }
      buf = ''; bufPage = null;
    };
    lines.forEach(l => {
      if (l.heading) { flush(); return; }
      if (bufPage === null) bufPage = l.page;
      if (/-$/.test(buf) && /^\p{Ll}/u.test(l.text)) buf = buf.slice(0, -1) + l.text;
      else buf += (buf ? ' ' : '') + l.text;
      if (/[.!?:]$/.test(l.text) && l.text.length < 60) flush();
    });
    flush();

    const maxF = topUni.length ? topUni[0][1] : 1;
    // tekrar eden cümleleri ele
    const seen = new Set();
    const uniq = sentences.filter(s => { const k = trLower(s.text).replace(/[^\p{L}]+/gu, ''); if (seen.has(k)) return false; seen.add(k); return true; });
    sentences.length = 0; uniq.forEach(s => sentences.push(s));
    const scored = sentences.map((s, i) => {
      const ws = (s.text.match(/\p{L}+/gu) || []).map(trLower);
      const n = ws.length;
      let sc = 0;
      ws.forEach(w => { if (isContent(w)) sc += (freq.get(w) || 0) / maxF; });
      sc = n ? sc / Math.sqrt(n) : 0;
      if (n < 6 || n > 70) sc *= 0.3;
      if (STRONG_REQ_RE.test(s.text)) sc *= 1.3;
      if (/\d/.test(s.text)) sc *= 1.1;
      if (s.page === 1) sc *= 1.15;
      return { ...s, score: sc, idx: i };
    });
    const keySentences = scored.slice().sort((x, y) => y.score - x.score).slice(0, 8).sort((x, y) => x.idx - y.idx)
      .map(s => ({ text: s.text, page: s.page }));

    const requirements = sentences.filter(s => STRONG_REQ_RE.test(s.text) && s.text.length < 600);

    return {
      title,
      pages: D.pages,
      words: D.tokens.length,
      outline,
      keyTerms,
      keySentences,
      requirements
    };
  }

  // ------------------------------------------------------------------
  // 7) Display (SCADA ekranı) → revizyon tespiti
  // ------------------------------------------------------------------
  // Özellikler (features):
  //  - id: kod/etiket benzeri ifadeler (6981XV01001, 6981AI01002.PV → hem tam hali hem "." öncesi),
  //        BÜYÜK HARFLİ parametre adları (CALZEROSUC, TMANSAMP)
  //  - ph: 3 kelimelik ifade grupları (operatör mesajları, açıklamalar)

  const ID_RE = /^(?=.*\p{L})(?=.*\d)[\p{L}\p{N}_.\-/]{4,}$|^[A-Z][A-Z0-9_]{4,}$/u;
  const WORD_RE = /[\p{L}\p{N}]+/gu;

  function idVariants(tok) {
    // orijinal yazımıyla test edilir: sıradan kelimeler (Valve, valve) tag sayılmaz; BÜYÜK HARF parametreler sayılır
    const t = tok.replace(/^[.\-_/]+|[.\-_/]+$/g, '');
    const cands = [t];
    // noktalı yollar: SYSTEM.PROJE.6981AI01002.PV -> her parça ve ardışık ikililer (6981AI01002, 6981AI01002.PV …)
    const seg = t.split('.').filter(Boolean);
    if (seg.length > 1) {
      seg.forEach((x, i) => { cands.push(x); if (i + 1 < seg.length) cands.push(x + '.' + seg[i + 1]); });
    }
    const out = [];
    for (const c of cands) if (ID_RE.test(c)) out.push(c.toUpperCase());
    return out;
  }

  // dil bağımsız küçük harf: I/İ/ı hepsi i (İngilizce ve Türkçe metinler aynı şekilde eşleşsin)
  const foldCase = s => s.replace(/[İI]/g, 'i').toLowerCase().replace(/ı/g, 'i');

  function phrasesOf(words, out) {
    for (let i = 0; i + 2 < words.length; i++) {
      // en az bir kelime harf içermeli ve tamamı tek karakter olmamalı
      const a = words[i], b = words[i + 1], c = words[i + 2];
      if (a.length + b.length + c.length < 8) continue;
      out.add(a + ' ' + b + ' ' + c);
    }
  }

  /** Revizyon dokümanından (prepareDoc çıktısı) özellik kümeleri */
  function revFeatures(D) {
    const ids = new Set(), ph = new Set();
    D.tokens.forEach(t => idVariants(t.t).forEach(v => ids.add(v)));
    // ifadeler satır bazında değil, belge akışında (satır kaymalarından etkilenmesin)
    const words = [];
    D.tokens.forEach(t => { if (/[\p{L}\p{N}]/u.test(t.t)) words.push(foldCase(t.t)); });
    phrasesOf(words, ph);
    return { ids, ph };
  }

  /** Display dosyasından çıkarılan metin parçalarından özellik kümeleri */
  function textFeatures(strings) {
    const ids = new Set(), ph = new Set();
    for (const s0 of strings) {
      const s = normalizeChars(String(s0));
      (s.match(TOKEN_RE) || []).forEach(tok => idVariants(tok).forEach(v => ids.add(v)));
      // "6981XV01001.PV" gibi değerler noktalı da gelebilir: ayrıca ayraçlara göre böl
      s.split(/[\s"'<>=;,()[\]{}|\\]+/).forEach(tok => idVariants(tok).forEach(v => ids.add(v)));
      const words = (foldCase(s).match(WORD_RE) || []);
      if (words.length >= 3) phrasesOf(words, ph);
    }
    return { ids, ph };
  }

  /** XML metninden anlamlı dizgileri çıkarır (öznitelik değerleri + metin düğümleri) */
  function xmlStrings(xmlText, DOMParserImpl) {
    const out = [];
    let ok = false;
    try {
      const P = DOMParserImpl || (typeof DOMParser !== 'undefined' ? DOMParser : null);
      if (P) {
        const doc = new P().parseFromString(xmlText, 'application/xml');
        if (!doc.getElementsByTagName('parsererror').length) {
          const walk = n => {
            if (n.nodeType === 1) {
              for (const a of n.attributes) if (a.value && /\p{L}/u.test(a.value)) out.push(a.value);
              for (const c of n.childNodes) walk(c);
            } else if ((n.nodeType === 3 || n.nodeType === 4) && n.nodeValue && /\p{L}/u.test(n.nodeValue)) {
              out.push(n.nodeValue.trim());
            }
          };
          walk(doc.documentElement);
          ok = true;
        }
      }
    } catch (e) { ok = false; }
    if (!ok) {
      // XML bozuksa: etiketleri at, öznitelik değerlerini ve metinleri regex ile topla
      (xmlText.match(/"[^"]*"|'[^']*'/g) || []).forEach(v => out.push(v.slice(1, -1)));
      xmlText.replace(/<[^>]*>/g, '\n').split('\n').forEach(v => { if (/\p{L}/u.test(v)) out.push(v.trim()); });
    }
    return out.map(s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
  }

  /** Tarih metnini çözer: 2026.10.26 / 2026-10-26 / 26.10.2026 / 26.10.26 (saat kısmı yoksayılır) */
  function parseDate(s) {
    if (!s) return null;
    let m = String(s).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = String(s).match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1]); }
    return null;
  }

  /** XML içindeki değişiklik geçmişi tarihleri (when="…", date="…", modified="…" öznitelikleri) */
  function xmlDates(xmlText) {
    const out = [];
    const tagRe = /<[^>]*\b(?:when|date|modified|lastModified|changed|timestamp)\s*=\s*"[^"]*"[^>]*>/gi;
    let t;
    while ((t = tagRe.exec(xmlText))) {
      const tag = t[0];
      const dm = tag.match(/\b(?:when|date|modified|lastModified|changed|timestamp)\s*=\s*"([^"]+)"/i);
      const d = dm && parseDate(dm[1]);
      if (!d || isNaN(d)) continue;
      const wm = tag.match(/\bwhat\s*=\s*"([^"]*)"/i), um = tag.match(/\bwho\s*=\s*"([^"]*)"/i);
      out.push({ date: d, raw: dm[1], what: wm ? wm[1] : '', who: um ? um[1] : '' });
    }
    return out.sort((x, y) => x.date - y.date);
  }

  /**
   * Bir display'in hangi revizyona ait olduğunu tahmin eder.
   * @param F  textFeatures çıktısı
   * @param revs [{label, ids:Set, ph:Set}] (eskiden yeniye sıralı)
   */
  function scoreDisplay(F, revs) {
    const n = revs.length;
    const kinds = ['ids', 'ph'];
    const disc = []; // {f, kind, mask}
    let common = 0, unknown = 0;
    for (const kind of kinds) {
      for (const f of F[kind]) {
        let mask = 0, cnt = 0;
        revs.forEach((r, i) => { if (r[kind].has(f)) { mask |= (1 << i); cnt++; } });
        if (cnt === 0) { if (kind === 'ids') unknown++; continue; }
        if (cnt === n) { common++; continue; }
        disc.push({ f, kind, mask });
      }
    }
    // tag'ler ifadelerden daha güçlü kanıt
    const w = d => d.kind === 'ids' ? 1 : 0.5;
    const total = disc.reduce((s, d) => s + w(d), 0);
    const scores = revs.map((r, i) => {
      let s = 0;
      disc.forEach(d => { if (d.mask & (1 << i)) s += w(d); });
      return total ? s / total : 0;
    });
    const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a] || b - a);
    const best = order[0], second = order[1];
    let verdict, confidence;
    if (disc.length === 0) {
      // Ayırt edici ifade yok ama dokümanla çok ortak ifade var: display revizyonlar arasında DEĞİŞMEYEN bir bölümü gösteriyor
      verdict = common >= 5 ? 'same' : 'insufficient'; confidence = 'low';
    } else if (disc.length < 3 || total < 2) {
      // az ama tek yönlü kanıt (karşı revizyona hiç işaret yok) -> zayıf tahmin
      verdict = (n > 1 && scores[best] === 1 && scores[second] === 0) ? 'weak' : 'insufficient'; confidence = 'low';
    }
    else if (n > 1 && scores[best] - scores[second] < 0.1) { verdict = 'ambiguous'; confidence = 'low'; }
    else { verdict = 'ok'; confidence = scores[best] >= 0.9 ? 'high' : scores[best] >= 0.7 ? 'med' : 'low'; }

    const labelsOf = mask => revs.filter((r, i) => mask & (1 << i)).map(r => r.label);
    // destekleyen: en iyi revizyonda var, ikinci adayda yok
    const support = disc.filter(d => (d.mask & (1 << best)) && !(d.mask & (1 << second)));
    // çelişen: display'de var ama tahmin edilen revizyonda yok
    const conflict = disc.filter(d => !(d.mask & (1 << best))).map(d => ({ f: d.f, kind: d.kind, in: labelsOf(d.mask) }));
    // güncel olmayan: tahmin edilen revizyonda var ama son revizyonda yok (güncellenmesi gerekebilir)
    const last = n - 1;
    const outdated = best === last ? [] : disc.filter(d => (d.mask & (1 << best)) && !(d.mask & (1 << last)))
      .map(d => ({ f: d.f, kind: d.kind, in: labelsOf(d.mask) }));
    return {
      best, second, scores, verdict, confidence,
      nDisc: disc.length, nCommon: common, nUnknown: unknown,
      support: support.map(d => ({ f: d.f, kind: d.kind, in: labelsOf(d.mask) })),
      conflict, outdated
    };
  }

  /**
   * Değişiklik bazlı kontrol: iki revizyon arasındaki her değişikliğin display'lerde eski mi yeni mi haliyle bulunduğuna bakar.
   * @param Dp, Dl  önceki ve son revizyonun prepareDoc çıktısı
   * @param Vp, Vl  aynı revizyonların revFeatures çıktısı
   * @param displays [{name, F}] (F = textFeatures çıktısı)
   */
  function changeCheck(Dp, Dl, Vp, Vl, displays) {
    const cmp = compareDocs(Dp, Dl, {});
    const words = s => (s || '').split(/\s+/).filter(Boolean);
    const items = [];
    let unchecked = 0;
    for (const c of cmp.changes) {
      if (c.cosmetic) continue;
      // değişikliğin çevresinden 2'şer kelime: tek sayı değişikliklerinde de ("60 -> 90 seconds") ifade oluşabilsin
      const pre = words(c.before).slice(-2).join(' '), post = words(c.after).slice(0, 2).join(' ');
      const oF = textFeatures([pre + ' ' + c.oldText + ' ' + post]);
      const nF = textFeatures([pre + ' ' + c.newText + ' ' + post]);
      // yalnızca gerçekten kalkmış (son revizyonda hiç geçmeyen) / gerçekten yeni (önceki revizyonda hiç geçmeyen) ifadeler
      const oldK = [], newK = [];
      oF.ids.forEach(f => { if (!nF.ids.has(f) && !Vl.ids.has(f)) oldK.push({ f, kind: 'ids' }); });
      oF.ph.forEach(f => { if (!nF.ph.has(f) && !Vl.ph.has(f)) oldK.push({ f, kind: 'ph' }); });
      nF.ids.forEach(f => { if (!oF.ids.has(f) && !Vp.ids.has(f)) newK.push({ f, kind: 'ids' }); });
      nF.ph.forEach(f => { if (!oF.ph.has(f) && !Vp.ph.has(f)) newK.push({ f, kind: 'ph' }); });
      if (!oldK.length && !newK.length) { unchecked++; continue; }
      const hasOld = [], hasNew = [];
      for (const d of displays) {
        if (!d.F) continue;
        const o = oldK.filter(k => d.F[k.kind].has(k.f)).map(k => k.f);
        const nn = newK.filter(k => d.F[k.kind].has(k.f)).map(k => k.f);
        if (o.length) hasOld.push({ name: d.name, keys: o });
        if (nn.length) hasNew.push({ name: d.name, keys: nn });
      }
      const status = hasOld.length && hasNew.length ? 'mixed' : hasOld.length ? 'old' : hasNew.length ? 'applied' : 'none';
      items.push({ id: c.id, type: c.type, pageA: c.pageA, pageB: c.pageB, section: c.section, oldText: c.oldText, newText: c.newText,
        level: c.level, reasons: c.reasons, oldK, newK, hasOld, hasNew, status });
    }
    return { items, total: cmp.changes.filter(c => !c.cosmetic).length, unchecked };
  }

  const api = { changeCheck, parseDate, xmlDates, revFeatures, textFeatures, xmlStrings, scoreDisplay, codes, buildLines, markBoilerplate, prepareDoc, diffSeq, compareDocs, summarizeDoc, scoreChange, numbers, reqTerms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DocCore = api;
})(typeof window !== 'undefined' ? window : this);
