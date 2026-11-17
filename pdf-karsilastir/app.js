/* PDF Revizyon Karşılaştırma — arayüz */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tick = () => new Promise(r => setTimeout(r, 0));

  const state = { files: { A: null, B: null }, docs: null, result: null, summaries: null, shown: 0, filtered: [] };
  const TYPE_LBL = { ins: 'Eklendi', del: 'Silindi', mod: 'Değiştirildi' };
  const LV_LBL = { high: 'Yüksek', med: 'Orta', low: 'Düşük' };

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

  // ---------------------------------------------------------- dosya seçimi
  function setupDrop(side) {
    const drop = $('drop' + side), input = $('in' + side);
    input.addEventListener('change', () => { if (input.files[0]) setFile(side, input.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => {
      const f = [...e.dataTransfer.files].find(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      if (f) setFile(side, f); else status('Lütfen bir PDF dosyası bırakın.', true);
    });
  }
  // sayfanın herhangi bir yerine bırakılan dosyanın tarayıcıda açılmasını engelle
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  function setFile(side, f) {
    state.files[side] = f;
    renderFiles();
  }
  function renderFiles() {
    ['A', 'B'].forEach(s => {
      const f = state.files[s];
      $('file' + s).innerHTML = f ? '📄 <b>' + esc(f.name) + '</b> <span class="muted small">(' + (f.size / 1024 / 1024).toFixed(2) + ' MB)</span>' : '';
      $('drop' + s).classList.toggle('loaded', !!f);
    });
    $('go').disabled = !(state.files.A && state.files.B);
  }
  setupDrop('A'); setupDrop('B');
  $('swap').addEventListener('click', () => { const t = state.files.A; state.files.A = state.files.B; state.files.B = t; renderFiles(); });

  function status(msg, err) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', !!err); }

  // ---------------------------------------------------------- PDF okuma
  async function readPdf(file, label) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false }).promise;
    const pages = [];
    let chars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      status(label + ': sayfa ' + p + ' / ' + pdf.numPages + ' okunuyor…');
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const lines = DocCore.buildLines(tc.items, p, page.view[3] - page.view[1]);
      lines.forEach(l => chars += l.text.length);
      pages.push(lines);
      page.cleanup();
      if (p % 5 === 0) await tick();
    }
    await pdf.destroy();
    return { pages, chars, numPages: pages.length };
  }

  $('go').addEventListener('click', run);

  async function run() {
    const btn = $('go');
    btn.disabled = true;
    try {
      const t0 = performance.now();
      const ra = await readPdf(state.files.A, 'A (eski)');
      const rb = await readPdf(state.files.B, 'B (yeni)');
      const warn = [];
      [['A', ra], ['B', rb]].forEach(([s, r]) => {
        if (r.chars < 20 * r.numPages) warn.push(s + ' dokümanında okunabilir metin çok az. Taranmış (resim) bir PDF olabilir; bu durumda önce OCR uygulanması gerekir.');
      });
      status('Karşılaştırılıyor…');
      await tick();
      const opts = { ignoreBoilerplate: $('optBoiler').checked, ignoreCase: $('optCase').checked, ignoreRevMarks: $('optRev').checked };
      const A = DocCore.prepareDoc(ra.pages, opts);
      const B = DocCore.prepareDoc(rb.pages, opts);
      const result = DocCore.compareDocs(A, B, opts);
      status('Doküman özetleri hazırlanıyor…');
      await tick();
      state.docs = { A, B };
      state.result = result;
      state.summaries = { A: DocCore.summarizeDoc(A), B: DocCore.summarizeDoc(B) };
      state.names = { A: state.files.A.name, B: state.files.B.name };
      state.warn = warn;
      renderAll();
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      status('Tamamlandı (' + secs + ' sn). ' + (warn.length ? '⚠ ' + warn.join(' ') : ''), warn.length > 0);
      $('results').style.display = 'block';
      showTab('ov');
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      status('Hata: ' + (e && e.message ? e.message : e) + (e && e.name === 'PasswordException' ? ' (Şifreli PDF desteklenmiyor.)' : ''), true);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------- sekmeler
  document.querySelectorAll('.tabs button[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  function showTab(t) {
    document.querySelectorAll('.tabs button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    document.querySelectorAll('.tab').forEach(d => d.classList.toggle('active', d.id === 'tab-' + t));
  }

  // ---------------------------------------------------------- render: ortak
  function pageRef(c) {
    const a = c.pageA != null ? 'A s.' + c.pageA : '';
    const b = c.pageB != null ? 'B s.' + c.pageB : '';
    return [a, b].filter(Boolean).join(' → ');
  }

  function sideHtml(c, side) {
    // side: 'A' -> eq + del ; 'B' -> eq + ins
    const want = side === 'A' ? 'del' : 'ins';
    const tag = side === 'A' ? 'del' : 'ins';
    let body = '';
    let any = false;
    c.segs.forEach((s, i) => {
      if (s.type === 'eq') body += (i ? ' ' : '') + esc(s.text) + ' ';
      else if (s.type === want) { body += '<' + tag + '>' + esc(s.text) + '</' + tag + '>'; any = true; }
    });
    const pre = c.before ? '<span class="ctx">…' + esc(c.before) + ' </span>' : '';
    const post = c.after ? '<span class="ctx"> ' + esc(c.after) + '…</span>' : '';
    if (!any && !c.segs.some(s => s.type === 'eq')) {
      body = '<span class="empty-side">' + (side === 'A' ? '(bu metin A\'da yok)' : '(bu metin B\'de yok)') + '</span>';
    }
    return pre + body.replace(/\s+$/, '') + post;
  }

  function cardHtml(c) {
    const reasons = c.reasons.length
      ? '<div class="reasons">' + c.reasons.map(r => '<span class="reason">' + esc(r.t) + '</span>').join('') + '</div>' : '';
    return '<article class="card" id="ch-' + c.id + '">' +
      '<div class="card-h"><span class="num">#' + c.id + '</span>' +
      '<span class="badge b-' + c.type + '">' + TYPE_LBL[c.type] + '</span>' +
      '<span class="badge lv-' + c.level + '">Önem: ' + LV_LBL[c.level] + '</span>' +
      (c.section ? '<span class="sec" title="' + esc(c.section) + '">§ ' + esc(c.section) + '</span>' : '') +
      '<span class="pg">' + esc(pageRef(c)) + '</span></div>' +
      reasons +
      '<div class="sbs"><div><div class="colh">A — eski</div>' + sideHtml(c, 'A') + '</div>' +
      '<div><div class="colh">B — yeni</div>' + sideHtml(c, 'B') + '</div></div></article>';
  }

  function excerpt(c, max) {
    max = max || 220;
    const cut = s => s.length > max ? s.slice(0, max) + '…' : s;
    // kısa değişikliklerde bağlamı da göster: "... nominal [120→150] m3/h debide ..."
    if (c.words <= 16) {
      const w = (s, n, end) => { const p = s.split(' ').filter(Boolean); return end ? p.slice(-n).join(' ') : p.slice(0, n).join(' '); };
      const pre = c.before ? '<span class="ctx">…' + esc(w(c.before, 6, true)) + ' </span>' : '';
      const post = c.after ? '<span class="ctx"> ' + esc(w(c.after, 6, false)) + '…</span>' : '';
      let mid = '';
      c.segs.forEach(sg => {
        if (sg.type === 'eq') mid += ' ' + esc(sg.text) + ' ';
        else mid += sg.type === 'del' ? '<del>' + esc(sg.text) + '</del> ' : '<ins>' + esc(sg.text) + '</ins> ';
      });
      return pre + mid.trim() + post;
    }
    if (c.type === 'ins') return '<ins>' + esc(cut(c.newText)) + '</ins>';
    if (c.type === 'del') return '<del>' + esc(cut(c.oldText)) + '</del>';
    return '<del>' + esc(cut(c.oldText)) + '</del> → <ins>' + esc(cut(c.newText)) + '</ins>';
  }

  // ---------------------------------------------------------- render: genel bakış
  function overviewHtml(forExport) {
    const { stats: st, changes } = state.result;
    const real = changes.filter(c => !c.cosmetic);
    const sB = state.summaries.B;
    let h = '';
    h += '<p class="lead"><span class="tag-a">A</span>' + esc(state.names.A) + ' &nbsp; ⟶ &nbsp; <span class="tag-b">B</span>' + esc(state.names.B) + '</p>';
    if (sB.title) h += '<p class="muted small" style="margin-top:0">Doküman: ' + esc(sB.title) + '</p>';
    h += '<div class="tiles" style="margin-top:14px">' +
      tile(real.length, 'Toplam fark', '') +
      tile(st.mod - (changes.filter(c => c.cosmetic && c.type === 'mod').length), 'Değiştirilen', 'mod') +
      tile(st.ins - (changes.filter(c => c.cosmetic && c.type === 'ins').length), 'Eklenen', 'ins') +
      tile(st.del - (changes.filter(c => c.cosmetic && c.type === 'del').length), 'Silinen', 'del') +
      tile(st.high, 'Yüksek önemli', 'high') +
      tile(Math.round(st.similarity * 100) + '%', 'Metin benzerliği', '') +
      '</div>';

    // özet cümleleri
    const bullets = [];
    if (!real.length) bullets.push('İki revizyon arasında içerik farkı bulunamadı' + (st.cosmetic ? ' (yalnızca ' + st.cosmetic + ' biçimsel fark var).' : '.'));
    else {
      bullets.push('B revizyonunda A\'ya göre <b>' + real.length + '</b> içerik farkı tespit edildi; bunların <b>' + st.high + '</b> tanesi yüksek önemde.');
      if (st.num) bullets.push('<b>' + st.num + '</b> farkta sayısal değer (ölçü, miktar, tarih, süre, tolerans vb.) değişmiş.');
      if (st.req) bullets.push('<b>' + st.req + '</b> farkta yükümlülük / olumsuzluk ifadeleri (shall, must, zorunlu, -malıdır, değil vb.) değişmiş.');
      if (st.code) bullets.push('<b>' + st.code + '</b> farkta kod / etiket adı (tag, sekans, alarm, ekipman numarası vb.) değişmiş.');
      if (state.docs.A.revMarks.length || state.docs.B.revMarks.length) bullets.push('Yoksayılan revizyon işaretleri: A\'da ' + (state.docs.A.revMarks.join(', ') || '—') + ', B\'de ' + (state.docs.B.revMarks.join(', ') || '—') + '.');
      if (st.head) bullets.push('<b>' + st.head + '</b> farkta başlık veya bölüm yapısı etkilenmiş.');
      if (st.sections.length) bullets.push('En çok değişen bölüm: <b>' + esc(st.sections[0].name) + '</b> (' + st.sections[0].count + ' fark).');
      if (st.pagesA !== st.pagesB) bullets.push('Sayfa sayısı ' + st.pagesA + ' → ' + st.pagesB + ' olarak değişmiş.');
      if (st.cosmetic) bullets.push(st.cosmetic + ' adet yalnızca biçimsel (noktalama / büyük-küçük harf) fark ayrıca listelendi.');
    }
    h += '<div class="panel"><ul style="margin:0;padding-left:20px">' + bullets.map(b => '<li>' + b + '</li>').join('') + '</ul></div>';
    if (state.warn && state.warn.length) h += '<p class="note warn">⚠ ' + esc(state.warn.join(' ')) + '</p>';

    // en önemli farklar
    const top = real.slice().sort((x, y) => y.score - x.score || x.id - y.id).slice(0, 10);
    if (top.length) {
      h += '<h2>En Önemli Farklar</h2><div class="list-top">';
      top.forEach((c, i) => {
        h += '<div class="top-item" data-id="' + c.id + '"><div class="rk">' + (i + 1) + '</div><div>' +
          '<span class="badge b-' + c.type + '">' + TYPE_LBL[c.type] + '</span> ' +
          '<span class="badge lv-' + c.level + '">' + LV_LBL[c.level] + '</span> ' +
          c.reasons.map(r => '<span class="reason">' + esc(r.t) + '</span>').join(' ') +
          (c.section ? '<div class="small muted" style="margin-top:4px">§ ' + esc(c.section) + '</div>' : '') +
          '<div class="ex">' + excerpt(c) + '</div></div>' +
          '<div class="pg">' + esc(pageRef(c)) + (forExport ? '' : '<br><span class="small">ayrıntı ›</span>') + '</div></div>';
      });
      h += '</div>';
    }

    // bölümler
    if (st.sections.length) {
      const maxS = st.sections[0].score || 1;
      h += '<h2>Değişikliklerin Bölümlere Dağılımı</h2><div class="panel" style="padding:6px 8px"><table class="sec"><thead><tr><th>Bölüm</th><th style="text-align:right">Fark</th><th style="width:30%">Etki</th></tr></thead><tbody>';
      st.sections.slice(0, 15).forEach(s => {
        h += '<tr><td>' + esc(s.name) + '</td><td class="n">' + s.count + '</td><td><div class="bar" style="width:' + Math.max(2, Math.round(100 * s.score / maxS)) + '%"></div></td></tr>';
      });
      h += '</tbody></table></div>';
      if (st.sections.length > 15) h += '<p class="small muted">… ve ' + (st.sections.length - 15) + ' bölüm daha.</p>';
    }
    h += '<p class="note">Önem puanı otomatik hesaplanır: sayısal değer ve kod/etiket (tag) değişiklikleri, yükümlülük/olumsuzluk ifadeleri (shall/must/should, zorunlu, -malıdır, değil…), başlık değişiklikleri ve değişikliğin büyüklüğü dikkate alınır. Nihai değerlendirme için ilgili farkı mutlaka okuyun.</p>';
    return h;
  }
  function tile(n, l, cls) { return '<div class="tile ' + cls + '"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }

  // ---------------------------------------------------------- render: özet
  let sumSide = 'B';
  function summaryHtml(side, forExport) {
    const s = state.summaries[side];
    let h = '';
    if (!forExport) {
      h += '<div class="docswitch no-print"><button class="chip ' + (side === 'B' ? 'on' : '') + '" data-side="B">B — yeni revizyon</button>' +
        '<button class="chip ' + (side === 'A' ? 'on' : '') + '" data-side="A">A — eski revizyon</button></div>';
    } else {
      h += '<h2>Doküman Özeti — ' + (side === 'B' ? 'B (yeni)' : 'A (eski)') + '</h2>';
    }
    h += '<div class="panel"><div style="font-size:17px;font-weight:650">' + esc(s.title || state.names[side]) + '</div>' +
      '<div class="muted small">' + esc(state.names[side]) + ' · ' + s.pages + ' sayfa · ~' + s.words.toLocaleString('tr-TR') + ' kelime · ' + s.outline.length + ' başlık · ' + s.requirements.length + ' yükümlülük ifadesi</div></div>';
    if (s.keyTerms.length) {
      h += '<h3>Anahtar Terimler <span class="muted small">(dokümanın konusu)</span></h3><div class="terms">' +
        s.keyTerms.map(t => '<span class="term">' + esc(t.term) + '<small>' + t.n + '</small></span>').join('') + '</div>';
    }
    if (s.keySentences.length) {
      h += '<h3>Öne Çıkan Noktalar <span class="muted small">(otomatik seçilmiş önemli cümleler)</span></h3><ol class="keys">' +
        s.keySentences.map(k => '<li>' + esc(k.text) + ' <span class="pgref">s.' + k.page + '</span></li>').join('') + '</ol>';
    }
    if (s.outline.length) {
      h += '<h3>Bölümler / İçindekiler</h3><ul class="outline">' +
        s.outline.slice(0, 120).map(o => '<li><span>' + esc(o.text) + '</span><span class="pgref">s.' + o.page + '</span></li>').join('') + '</ul>';
      if (s.outline.length > 120) h += '<p class="small muted">… ve ' + (s.outline.length - 120) + ' başlık daha.</p>';
    }
    if (s.requirements.length) {
      h += '<details' + (forExport ? ' open' : '') + '><summary>Yükümlülük / zorunluluk içeren ifadeler (' + s.requirements.length + ')</summary><ul class="req-list">' +
        s.requirements.slice(0, 300).map(r => '<li>' + esc(r.text) + ' <span class="pgref">s.' + r.page + '</span></li>').join('') + '</ul></details>';
    }
    h += '<p class="note">Bu özet yapay zekâ kullanılmadan, tamamen yerel olarak, kelime sıklığı ve cümle önem puanlamasıyla çıkarılmıştır.</p>';
    return h;
  }
  function renderSummary() {
    $('tab-sum').innerHTML = summaryHtml(sumSide, false);
    $('tab-sum').querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => { sumSide = b.dataset.side; renderSummary(); }));
  }

  // ---------------------------------------------------------- render: tüm farklar
  const filt = { type: 'all', level: 'all', cos: true, sort: 'doc', q: '' };
  function chipGroup(id, key) {
    $(id).querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      $(id).querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
      filt[key] = b.dataset.v; renderList();
    }));
  }
  chipGroup('fType', 'type'); chipGroup('fLevel', 'level');
  $('fCos').addEventListener('change', e => { filt.cos = e.target.checked; renderList(); });
  $('fSort').addEventListener('change', e => { filt.sort = e.target.value; renderList(); });
  let qT;
  $('fq').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { filt.q = e.target.value.trim(); renderList(); }, 200); });

  const PAGE = 150;
  function renderList() {
    const q = filt.q.toLocaleLowerCase('tr');
    let arr = state.result.changes.filter(c =>
      (filt.type === 'all' || c.type === filt.type) &&
      (filt.level === 'all' || (filt.level === 'high' ? c.level === 'high' : c.level !== 'low')) &&
      (!filt.cos || !c.cosmetic) &&
      (!q || (c.oldText + ' ' + c.newText + ' ' + c.section + ' ' + c.before + ' ' + c.after).toLocaleLowerCase('tr').includes(q)));
    if (filt.sort === 'imp') arr = arr.slice().sort((x, y) => y.score - x.score || x.id - y.id);
    state.filtered = arr;
    state.shown = 0;
    $('list').innerHTML = '';
    $('fInfo').textContent = arr.length + ' fark gösteriliyor' + (arr.length !== state.result.changes.length ? ' (toplam ' + state.result.changes.length + ')' : '');
    if (!arr.length) $('list').innerHTML = '<p class="muted">Bu filtreye uyan fark yok.</p>';
    more();
  }
  function more(upto) {
    const end = Math.min(state.filtered.length, Math.max(state.shown + PAGE, upto || 0));
    let h = '';
    for (let i = state.shown; i < end; i++) h += cardHtml(state.filtered[i]);
    $('list').insertAdjacentHTML('beforeend', h);
    state.shown = end;
    $('more').style.display = state.shown < state.filtered.length ? 'block' : 'none';
    $('more').textContent = 'Daha fazla göster (' + (state.filtered.length - state.shown) + ' kaldı)';
  }
  $('more').addEventListener('click', () => more());

  function jumpTo(id) {
    showTab('all');
    let idx = state.filtered.findIndex(c => c.id === id);
    if (idx < 0) {
      // filtreleri sıfırla
      filt.type = 'all'; filt.level = 'all'; filt.q = ''; $('fq').value = '';
      document.querySelectorAll('#fType .chip, #fLevel .chip').forEach(x => x.classList.toggle('on', x.dataset.v === 'all'));
      filt.cos = false; $('fCos').checked = false;
      renderList();
      idx = state.filtered.findIndex(c => c.id === id);
    }
    if (idx >= state.shown) more(idx + 1);
    const el = $('ch-' + id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
    }
  }

  function renderAll() {
    $('tab-ov').innerHTML = overviewHtml(false);
    $('tab-ov').querySelectorAll('.top-item').forEach(el => el.addEventListener('click', () => jumpTo(+el.dataset.id)));
    $('cntAll').textContent = '(' + state.result.changes.filter(c => !c.cosmetic).length + ')';
    sumSide = 'B';
    renderSummary();
    renderList();
  }

  // ---------------------------------------------------------- dışa aktarma
  $('pr').addEventListener('click', () => {
    // yazdırmadan önce tüm farkları yükle
    if (state.shown < state.filtered.length) more(state.filtered.length);
    window.print();
  });

  $('dl').addEventListener('click', () => {
    const css = $('app-style').textContent;
    const real = state.result.changes.filter(c => !c.cosmetic);
    const cos = state.result.changes.filter(c => c.cosmetic);
    const date = new Date().toLocaleString('tr-TR');
    let body = '<div class="wrap"><header class="top"><h1>PDF Revizyon Karşılaştırma Raporu</h1><span class="muted small">' + esc(date) + '</span></header>';
    body += overviewHtml(true);
    body += '<h2>Tüm Farklar (' + real.length + ')</h2><div class="cards">' + real.map(cardHtml).join('') + '</div>';
    if (cos.length) body += '<details><summary>Biçimsel farklar (' + cos.length + ')</summary><div class="cards" style="margin-top:10px">' + cos.map(cardHtml).join('') + '</div></details>';
    body += summaryHtml('B', true) + summaryHtml('A', true);
    body += '<footer>Bu rapor çevrimdışı olarak, tarayıcı içinde oluşturulmuştur.</footer></div>';
    const html = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
      '<title>Karşılaştırma Raporu</title><style>' + css + '</style></head><body>' + body + '</body></html>';
    const base = s => s.replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}_.-]+/gu, '_').slice(0, 40);
    download(html, 'fark-raporu_' + base(state.names.A) + '_vs_' + base(state.names.B) + '.html');
  });

  function download(html, name) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------------------------------------------------------- paylaşım raporu
  // Sadece farklar: bağlam yok, doküman özeti yok, dosya adı yok, bölüm başlığı yok.
  // Her satırda: sıra, sayfa (A/B), tür, önem, değişiklik kategorisi, eski metin, yeni metin.
  const REASON_CAT = { code: 'Kod / etiket', num: 'Sayısal değer', req: 'Yükümlülük / olumsuzluk ifadesi', head: 'Başlık / bölüm', size: 'Büyük değişiklik' };

  function shareSide(c, want) {
    // yalnızca değişen bölüm (+ değişiklik içindeki en fazla 3 kelimelik ortak boşluklar); bağlam yok
    let h = '';
    c.segs.forEach(s => {
      if (s.type === 'eq') h += ' ' + esc(s.text) + ' ';
      else if (s.type === want) h += want === 'del' ? '<del>' + esc(s.text) + '</del>' : '<ins>' + esc(s.text) + '</ins>';
    });
    h = h.replace(/\s+/g, ' ').trim();
    const hasChange = c.segs.some(s => s.type === want);
    return hasChange ? h : '<span class="none">—</span>';
  }

  $('dlShare').addEventListener('click', () => {
    const real = state.result.changes.filter(c => !c.cosmetic);
    const st = state.result.stats;
    const cnt = t => real.filter(c => c.type === t).length;
    const date = new Date().toLocaleString('tr-TR');
    const rows = real.map((c, i) => {
      const cats = [...new Set(c.reasons.map(r => REASON_CAT[r.k]).filter(Boolean))].join(', ');
      return '<tr class="lv-' + c.level + '">' +
        '<td class="n">' + (i + 1) + '</td>' +
        '<td class="n">' + (c.pageA != null ? c.pageA : '—') + '</td>' +
        '<td class="n">' + (c.pageB != null ? c.pageB : '—') + '</td>' +
        '<td>' + TYPE_LBL[c.type] + '</td>' +
        '<td class="lv">' + LV_LBL[c.level] + '</td>' +
        '<td>' + esc(cats || '—') + '</td>' +
        '<td>' + shareSide(c, 'del') + '</td>' +
        '<td>' + shareSide(c, 'ins') + '</td></tr>';
    }).join('');
    const css = 'body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;margin:24px;color:#1d2330;background:#fff}' +
      'h1{font-size:20px;margin:0 0 4px}p{margin:4px 0}.muted{color:#5d6677;font-size:13px}' +
      'table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #d5dae3;padding:6px 8px;vertical-align:top;text-align:left}' +
      'th{background:#f1f3f7;font-size:12.5px}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
      'del{background:#fbdcdc;color:#8a1414}ins{background:#d9f4df;color:#0f5a26;text-decoration:none}' +
      'tr.lv-high td.lv{color:#c62828;font-weight:700}tr.lv-med td.lv{color:#b06a00;font-weight:600}.none{color:#9aa3b2}' +
      '@media print{tr{break-inside:avoid}}';
    const html = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
      '<title>Fark Listesi</title><style>' + css + '</style></head><body>' +
      '<h1>Revizyon Fark Listesi</h1>' +
      '<p class="muted">' + esc(date) + ' · A = eski revizyon, B = yeni revizyon · Sayfa: A ' + st.pagesA + ', B ' + st.pagesB + '</p>' +
      '<p>Toplam <b>' + real.length + '</b> fark: ' + cnt('mod') + ' değiştirilen, ' + cnt('ins') + ' eklenen, ' + cnt('del') + ' silinen. ' +
      'Yüksek önemli: <b>' + real.filter(c => c.level === 'high').length + '</b>.</p>' +
      '<p class="muted">Bu listede yalnızca değişen metin vardır; çevresindeki metin, doküman özeti, dosya adları ve bölüm başlıkları yer almaz. Yalnızca noktalama veya büyük/küçük harf farkları listelenmemiştir.</p>' +
      (real.length ? '<table><thead><tr><th>#</th><th>Sayfa A</th><th>Sayfa B</th><th>Tür</th><th>Önem</th><th>Kategori</th><th>Eski metin (A)</th><th>Yeni metin (B)</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p><b>İçerik farkı bulunamadı.</b></p>') +
      '</body></html>';
    download(html, 'fark-listesi.html');
  });
})();
