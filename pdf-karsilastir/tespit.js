/* Display Revizyon Tespiti — arayüz */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tick = () => new Promise(r => setTimeout(r, 0));
  const natural = (a, b) => a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' });

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

  const state = { revs: [], disps: [], dispKeys: new Set(), list: [], results: null, revData: null, open: new Set(), missing: [] };
  const revCache = new Map(); // dosya → özellikler (yeniden analizde PDF'i tekrar okumamak için)

  function status(msg, err) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', !!err); }

  // ------------------------------------------------------------ dosya listeleri
  function guessLabel(name) {
    const base = name.replace(/\.pdf$/i, '');
    let m = base.match(/rev(?:ision|izyon)?[\s._-]*(\d{1,3}(?:\.\d+)?[A-Z]?|[A-Z]\d{0,2})(?![a-z0-9])/i)
      || base.match(/(?:^|[^a-z0-9])R(\d{1,3}(?:\.\d+)?)(?![a-z0-9])/i);
    if (m) return 'Rev ' + m[1].toUpperCase();
    m = base.match(/[_-](\d{2})(?:[\s_-]|$)/);  // belge no sonundaki revizyon: ...-0001_06
    return m ? 'Rev ' + m[1] : base;
  }
  function addRevs(files) {
    files.filter(f => /\.pdf$/i.test(f.name)).forEach(f => {
      if (!state.revs.some(r => r.file.name === f.name && r.file.size === f.size)) state.revs.push({ file: f, label: guessLabel(f.name) });
    });
    if (!state.manualOrder) sortRevs(); // kullanıcı elle sıraladıysa onun sırası korunur
    renderLists();
  }
  function sortRevs() { state.revs.sort((a, b) => natural(a.label, b.label)); }
  function addDisps(files) {
    files.filter(f => /\.xml$/i.test(f.name)).forEach(f => {
      const key = (f.webkitRelativePath || f.relPath || f.name) + '|' + f.size;
      if (state.dispKeys.has(key)) return;
      state.dispKeys.add(key);
      state.disps.push({ file: f, key, name: f.relPath || f.webkitRelativePath || f.name, short: baseKey(f.name) });
    });
    state.disps.sort((a, b) => natural(a.name, b.name));
    renderLists();
  }

  // ------------------------------------------------------------ taranacak display listesi
  // Dosya adı karşılaştırması: klasör yolu ve .xml uzantısı atılır, büyük/küçük harf önemsizdir.
  function baseKey(name) {
    return String(name).trim().replace(/^["']|["']$/g, '').split(/[\\/]/).pop().replace(/\.xml$/i, '').trim().toUpperCase();
  }
  function parseList(text) {
    const seen = new Set(), out = [];
    String(text).split(/[\r\n\t;,]+/).forEach(raw => {
      const k = baseKey(raw);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const wild = /[*?]/.test(k);
      out.push({ raw: raw.trim(), key: k, re: wild ? new RegExp('^' + k.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$') : null });
    });
    return out;
  }
  const entryMatches = (e, d) => e.re ? e.re.test(d.short) : e.key === d.short;
  // Listeye göre taranacak dosyalar + listede olup klasörde bulunamayanlar
  function selection() {
    if (!state.list.length) return { files: state.disps, missing: [], multi: [] };
    const exact = new Map(), wild = state.list.filter(e => e.re);
    state.list.forEach(e => { if (!e.re) exact.set(e.key, e); });
    const hit = new Map();
    const files = state.disps.filter(d => {
      let e = exact.get(d.short);
      if (!e) e = wild.find(w => w.re.test(d.short));
      if (!e) return false;
      hit.set(e.key, (hit.get(e.key) || 0) + 1);
      return true;
    });
    const missing = state.list.filter(e => !hit.has(e.key)).map(e => e.raw);
    const multi = state.list.filter(e => !e.re && hit.get(e.key) > 1).map(e => e.raw + ' (' + hit.get(e.key) + ' dosya)');
    return { files, missing, multi };
  }
  function setList(text) {
    state.list = parseList(text);
    renderLists();
  }
  function renderLists() {
    $('revList').innerHTML = state.revs.map((r, i) =>
      '<div class="row"><span class="muted">' + (i + 1) + '.</span><input type="text" data-i="' + i + '" value="' + esc(r.label) + '" title="Revizyon etiketi">' +
      '<input type="text" class="dt" data-d="' + i + '" value="' + esc(r.date || '') + '" placeholder="yayın tarihi" title="İsteğe bağlı: revizyonun yayın tarihi (gg.aa.yyyy). Display değişiklik tarihleriyle karşılaştırmak için.">' +
      '<span class="nm">' + esc(r.file.name) + (i === state.revs.length - 1 && state.revs.length > 1 ? ' <b style="color:var(--ok-fg)">← güncel</b>' : '') + '</span><button data-up="' + i + '" title="Yukarı (daha eski)"' + (i ? '' : ' disabled') + '>↑</button><button data-dn="' + i + '" title="Aşağı (daha yeni)"' + (i < state.revs.length - 1 ? '' : ' disabled') + '>↓</button><button data-del="' + i + '" title="Listeden çıkar">✕</button></div>').join('');
    $('revHint').style.display = state.revs.length ? 'block' : 'none';
    $('revList').querySelectorAll('input[type=text]:not(.dt)').forEach(inp => inp.addEventListener('change', () => {
      state.revs[+inp.dataset.i].label = inp.value.trim() || state.revs[+inp.dataset.i].label; renderLists();
    }));
    $('revList').querySelectorAll('input.dt').forEach(inp => inp.addEventListener('change', () => {
      const v = inp.value.trim();
      if (v && !DocCore.parseDate(v)) { inp.style.borderColor = 'var(--bad-fg)'; return; }
      inp.style.borderColor = ''; state.revs[+inp.dataset.d].date = v;
    }));
    const swap = (a, b) => { const t = state.revs[a]; state.revs[a] = state.revs[b]; state.revs[b] = t; state.manualOrder = true; renderLists(); };
    $('revList').querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => swap(+b.dataset.up, +b.dataset.up - 1)));
    $('revList').querySelectorAll('[data-dn]').forEach(b => b.addEventListener('click', () => swap(+b.dataset.dn, +b.dataset.dn + 1)));
    $('revList').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { state.revs.splice(+b.dataset.del, 1); renderLists(); }));
    const n = state.disps.length;
    $('dispList').innerHTML = n ? '<div class="row"><span class="nm"><b>' + n + '</b> XML dosyası seçildi' +
      (n <= 8 ? ': ' + state.disps.map(d => esc(d.name)).join(', ') : ' (ör. ' + state.disps.slice(0, 3).map(d => esc(d.name)).join(', ') + ' …)') + '</span></div>' : '';
    const sel = selection();
    let li = '';
    if (state.list.length) {
      li = 'Listede <b>' + state.list.length + '</b> display · klasörde eşleşen <b>' + sel.files.length + '</b> dosya taranacak';
      if (!n) li += ' (henüz klasör seçilmedi)';
      else if (sel.missing.length) li += ' · <span style="color:var(--bad-fg)"><b>' + sel.missing.length + '</b> tanesi bulunamadı</span>: ' +
        esc(sel.missing.slice(0, 12).join(', ')) + (sel.missing.length > 12 ? ' …' : '');
      if (sel.multi.length) li += '<br><span style="color:var(--warn-fg)">Birden fazla klasörde aynı adla bulunanlar: ' + esc(sel.multi.slice(0, 8).join(', ')) + (sel.multi.length > 8 ? ' …' : '') + '</span>';
    } else if (n) {
      li = 'Liste girilmedi: seçilen <b>tüm</b> dosyalar taranacak.';
    }
    $('listInfo').innerHTML = li;
    $('go').disabled = !(state.revs.length >= 2 && sel.files.length);
  }

  function setupDrop(dropId, inputId, handler) {
    const drop = $(dropId), input = $(inputId);
    input.addEventListener('change', () => { handler([...input.files]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', async e => {
      const items = [...(e.dataTransfer.items || [])];
      const entries = items.map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
      if (entries.length) handler(await readEntries(entries)); else handler([...e.dataTransfer.files]);
    });
  }
  // sürüklenen klasörlerin içini (alt klasörler dahil) oku
  async function readEntries(entries) {
    const out = [];
    async function walk(entry, path) {
      if (entry.isFile) {
        const f = await new Promise((res, rej) => entry.file(res, rej));
        try { f.relPath = path + f.name; } catch (e) { /* bazı tarayıcılarda salt okunur */ }
        out.push(f);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e, path + entry.name + '/');
        } while (batch.length);
      }
    }
    for (const e of entries) await walk(e, '');
    return out;
  }
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());
  setupDrop('dropRev', 'inRev', addRevs);
  setupDrop('dropDisp', 'inDisp', addDisps);
  $('pickDir').addEventListener('click', () => $('inDir').click());
  $('inDir').addEventListener('change', () => { addDisps([...$('inDir').files]); $('inDir').value = ''; });
  let lT;
  $('listText').addEventListener('input', () => { clearTimeout(lT); lT = setTimeout(() => setList($('listText').value), 250); });
  $('listFile').addEventListener('change', async () => {
    const f = $('listFile').files[0]; $('listFile').value = '';
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { status('Excel dosyası doğrudan okunamıyor: Excel\'de display adlarının bulunduğu sütunu kopyalayıp kutuya yapıştırın ya da CSV olarak kaydedin.', true); return; }
    const text = await readXmlText(f);
    $('listText').value = text; setList(text);
  });
  $('pickList').addEventListener('click', () => $('listFile').click());
  $('clear').addEventListener('click', () => { state.manualOrder = false; state.revs = []; state.disps = []; state.dispKeys = new Set(); renderLists(); $('results').style.display = 'none'; status(''); });

  // ------------------------------------------------------------ okuma
  async function readPdf(file, label) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      if (p % 5 === 1) { status(label + ': sayfa ' + p + ' / ' + pdf.numPages + ' okunuyor…'); await tick(); }
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      pages.push(DocCore.buildLines(tc.items, p, page.view[3] - page.view[1]));
      page.cleanup();
    }
    await pdf.destroy();
    return pages;
  }

  async function readXmlText(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let enc = 'utf-8';
    if (buf[0] === 0xFF && buf[1] === 0xFE) enc = 'utf-16le';
    else if (buf[0] === 0xFE && buf[1] === 0xFF) enc = 'utf-16be';
    else if (buf[0] === 0x3C && buf[1] === 0x00) enc = 'utf-16le';
    else if (buf[0] === 0x00 && buf[1] === 0x3C) enc = 'utf-16be';
    else {
      const head = new TextDecoder('latin1').decode(buf.slice(0, 300));
      const m = head.match(/encoding\s*=\s*["']([\w.-]+)["']/i);
      if (m) enc = m[1].toLowerCase();
    }
    try { return new TextDecoder(enc).decode(buf); } catch (e) { return new TextDecoder('utf-8').decode(buf); }
  }

  // ------------------------------------------------------------ analiz
  $('go').addEventListener('click', async () => {
    $('go').disabled = true;
    try {
      const t0 = performance.now();
      const revs = [];
      for (const r of state.revs) {
        const key = r.file.name + '|' + r.file.size + '|' + r.file.lastModified;
        let feat = revCache.get(key);
        if (!feat) {
          const pages = await readPdf(r.file, r.label);
          const D = DocCore.prepareDoc(pages, { ignoreBoilerplate: true, ignoreRevMarks: true });
          if (D.tokens.length < 50) throw new Error(r.file.name + ' içinde okunabilir metin bulunamadı (taranmış PDF olabilir).');
          feat = DocCore.revFeatures(D);
          feat.pages = D.pages;
          feat.D = D;
          revCache.set(key, feat);
        }
        revs.push({ label: r.label, ids: feat.ids, ph: feat.ph, pages: feat.pages, file: r.file.name, date: r.date ? DocCore.parseDate(r.date) : null, D: feat.D });
      }
      // revizyonlar arası ayırt edici ifade sayısı (bilgi amaçlı)
      const results = [];
      const sel = selection();
      state.missing = sel.missing;
      let i = 0;
      for (const d of sel.files) {
        if (i % 10 === 0) { status('Display\'ler inceleniyor: ' + i + ' / ' + sel.files.length + '…'); await tick(); }
        i++;
        let res;
        try {
          const text = await readXmlText(d.file);
          const F = DocCore.textFeatures(DocCore.xmlStrings(text));
          res = DocCore.scoreDisplay(F, revs);
          res.F = F;
          const hist = DocCore.xmlDates(text);
          res.history = hist;
          res.lastChange = hist.length ? hist[hist.length - 1].date : null;
          res.dateNote = dateCheck(res, revs);
        } catch (e) {
          res = { error: e.message || String(e) };
        }
        res.name = d.name;
        results.push(res);
      }
      state.results = results;
      state.revData = revs;
      status('Değişiklik bazlı kontrol yapılıyor…'); await tick();
      const L = revs.length - 1;
      state.cc = DocCore.changeCheck(revs[L - 1].D, revs[L].D, revs[L - 1], revs[L], results.filter(r => r.F).map(r => ({ name: r.name, F: r.F })));
      state.open.clear();
      render();
      $('results').style.display = 'block';
      status('Tamamlandı (' + ((performance.now() - t0) / 1000).toFixed(1) + ' sn). ' + results.length + ' display, ' + revs.length + ' revizyon.' + (state.missing.length ? ' Listede olup bulunamayan: ' + state.missing.length + '.' : ''));
    } catch (e) {
      console.error(e);
      status('Hata: ' + (e.message || e), true);
    } finally {
      $('go').disabled = false;
    }
  });

  const fmtDate = d => d ? d.toLocaleDateString('tr-TR') : '';
  // Display'in son değişiklik tarihi bir revizyonun yayın tarihinden önceyse, display o revizyona göre güncellenmiş olamaz.
  function dateCheck(r, revs) {
    if (!r.lastChange || !revs.some(x => x.date)) return null;
    const firstAfter = revs.findIndex(x => x.date && x.date > r.lastChange);
    const note = { conflict: false, text: '' };
    if (firstAfter >= 0) note.text = 'Son değişiklik ' + revs[firstAfter].label + ' yayınından (' + fmtDate(revs[firstAfter].date) + ') önce';
    else note.text = 'Son değişiklik tüm revizyonlardan sonra';
    if (!r.error && r.verdict === 'ok' && firstAfter >= 0 && r.best >= firstAfter) {
      note.conflict = true;
      note.text += ' — içerik ' + revs[r.best].label + ' gösteriyor, tarih uyuşmuyor (değişiklik geçmişi eksik tutulmuş olabilir)';
    }
    return note;
  }

  // ------------------------------------------------------------ sonuçlar
  function classify(r) {
    const revs = state.revData, last = revs.length - 1;
    if (r.error) return { cls: 'v-ins', text: 'Okunamadı', key: 'unclear' };
    if (r.verdict === 'insufficient') return { cls: 'v-ins', text: 'Yetersiz kanıt', key: 'unclear' };
    if (r.verdict === 'same') return { cls: 'v-same', text: 'Değişmeyen içerik', key: 'same', tip: 'Display\'deki ifadeler revizyonlar arasında değişmemiş: tüm revizyonlarla uyumlu' };
    if (r.verdict === 'weak') return { cls: r.best === last ? 'v-ok' : 'v-old', text: 'Muhtemelen ' + revs[r.best].label + ' (zayıf kanıt)', key: r.best === last ? 'cur' : 'old', weak: true };
    if (r.verdict === 'ambiguous') return { cls: 'v-amb', text: 'Belirsiz: ' + revs[r.best].label + ' / ' + revs[r.second].label, key: 'unclear' };
    if (r.best === last) return { cls: 'v-ok', text: revs[r.best].label + ' (güncel)', key: 'cur' };
    return { cls: 'v-old', text: revs[r.best].label, key: 'old' };
  }
  const isMixed = r => !r.error && r.verdict === 'ok' && r.conflict.length >= 2 && r.conflict.length >= 0.1 * r.nDisc;
  const CONF = { high: 'yüksek', med: 'orta', low: 'düşük' };

  function render() {
    const revs = state.revData, res = state.results;
    const counts = {};
    res.forEach(r => { const c = classify(r); const k = (c.key === 'unclear' || c.key === 'same') ? c.key : revs[r.best].label; counts[k] = (counts[k] || 0) + 1; });
    let tiles = '<div class="tile"><div class="n">' + res.length + '</div><div class="l">Display</div></div>';
    revs.forEach((rv, i) => {
      tiles += '<div class="tile"><div class="n">' + (counts[rv.label] || 0) + '</div><div class="l">' + esc(rv.label) + (i === revs.length - 1 ? ' (güncel)' : '') + ' ile uyumlu</div></div>';
    });
    tiles += '<div class="tile"><div class="n">' + res.filter(isMixed).length + '</div><div class="l">Karışık izler içeren</div></div>';
    tiles += '<div class="tile" title="Revizyonlar arasında değişmeyen bölümleri gösteren display\'ler: tüm revizyonlarla uyumlu"><div class="n">' + (counts.same || 0) + '</div><div class="l">Değişmeyen içerik (tüm revizyonlarla uyumlu)</div></div>';
    tiles += '<div class="tile"><div class="n">' + (counts.unclear || 0) + '</div><div class="l">Belirsiz / yetersiz kanıt</div></div>';
    if (state.list.length) tiles += '<div class="tile"><div class="n"' + (state.missing.length ? ' style="color:var(--bad-fg)"' : '') + '>' + state.missing.length + '</div><div class="l">Listede olup klasörde bulunamayan</div></div>';
    $('tiles').innerHTML = tiles;
    $('missing').innerHTML = state.missing.length ? '<div class="panel" style="margin-bottom:14px"><b style="color:var(--bad-fg)">Listede olup klasörde bulunamayan display\'ler (' + state.missing.length + ')</b>' +
      '<div class="muted" style="margin:4px 0 6px">Ad farklı yazılmış, dosya başka klasörde ya da hiç oluşturulmamış olabilir.</div><div class="ev"><div class="chips">' +
      state.missing.map(m => '<span class="chip">' + esc(m) + '</span>').join('') + '</div></div></div>' : '';
    $('thead').innerHTML = '<tr><th>Display</th><th>Tahmin</th>' + revs.map(r => '<th>' + esc(r.label) + '</th>').join('') + '<th title="Bu display\'de bulunan ve sadece bazı revizyonlarda geçen ifade sayısı">Ayırt edici</th><th>Son değişiklik</th></tr>';
    renderRows();
    renderCC();
  }

  // ------------------------------------------------------------ değişiklik bazlı kontrol
  const CC_LBL = { applied: ['v-ok', '✔ Uygulanmış'], old: ['v-old', '✖ Eski hali duruyor'], mixed: ['v-amb', '◐ Karışık'], none: ['v-ins', '— Display\'lerde yok'] };
  function ccExcerpt(it, max) {
    const cut = s => s.length > max ? s.slice(0, max) + '…' : s;
    return (it.oldText ? '<del>' + esc(cut(it.oldText)) + '</del> ' : '') + (it.oldText && it.newText ? '→ ' : '') + (it.newText ? '<ins>' + esc(cut(it.newText)) + '</ins>' : '');
  }
  const dispNames = arr => arr.map(d => '<span class="chip" title="' + esc(d.keys.join(', ')) + '">' + esc(d.name.split('/').pop()) + '</span>');
  function ccRowsHtml(items, all) {
    return items.map(it => {
      const [cls, txt] = CC_LBL[it.status];
      return '<tr><td class="n">' + it.id + '</td><td class="n">' + (it.pageA != null ? it.pageA : '—') + ' → ' + (it.pageB != null ? it.pageB : '—') + '</td>' +
        '<td>' + (it.section ? '<div class="muted">§ ' + esc(it.section) + '</div>' : '') + '<div class="cc-x">' + ccExcerpt(it, all ? 600 : 220) + '</div></td>' +
        '<td><span class="badge ' + cls + '">' + txt + '</span></td>' +
        '<td class="ev">' + (it.hasNew.length ? '<div class="chips">' + dispNames(it.hasNew).join('') + '</div>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="ev">' + (it.hasOld.length ? '<div class="chips">' + dispNames(it.hasOld).join('') + '</div>' : '<span class="muted">—</span>') + '</td></tr>';
    }).join('');
  }
  function renderCC() {
    const cc = state.cc, revs = state.revData, L = revs.length - 1;
    if (!cc) { $('cc').innerHTML = ''; return; }
    const cnt = k => cc.items.filter(i => i.status === k).length;
    let h = '<h2>Değişiklik bazlı kontrol: ' + esc(revs[L - 1].label) + ' → ' + esc(revs[L].label) + '</h2>' +
      '<p class="muted" style="margin-top:0">İki revizyon arasındaki her değişiklik için: yeni hali hangi display\'lerde var (✔), eski hali hâlâ hangi display\'lerde duruyor (✖)? ' +
      'Toplam ' + cc.total + ' içerik değişikliğinden ' + cc.items.length + ' tanesi kontrol edilebildi (diğerleri display\'lerde aranabilecek ayırt edici bir ifade içermiyor).</p>' +
      '<div class="tiles">' +
      '<div class="tile"><div class="n" style="color:var(--ok-fg)">' + cnt('applied') + '</div><div class="l">Uygulanmış (yeni hali display\'de)</div></div>' +
      '<div class="tile"><div class="n" style="color:var(--bad-fg)">' + cnt('old') + '</div><div class="l">Eski hali duruyor</div></div>' +
      '<div class="tile"><div class="n" style="color:var(--warn-fg)">' + cnt('mixed') + '</div><div class="l">Karışık (bazı display\'lerde eski)</div></div>' +
      '<div class="tile"><div class="n">' + cnt('none') + '</div><div class="l">Taranan display\'lerde geçmiyor</div></div></div>' +
      '<div class="filters"><select id="ccF"><option value="hit">Display\'lerde geçenler</option><option value="problem">Sorunlu olanlar (eski / karışık)</option><option value="none">Display\'lerde geçmeyenler</option><option value="all">Tümü</option></select>' +
      '<button id="ccCsv">⬇ CSV</button></div>' +
      '<table class="res"><thead><tr><th>#</th><th>Sayfa</th><th>Değişiklik (eski → yeni)</th><th>Durum</th><th>Yeni hali olan display\'ler</th><th>Eski hali olan display\'ler</th></tr></thead><tbody id="ccBody"></tbody></table>' +
      '<p class="note"><b>Display\'lerde geçmeyen</b> bir değişiklik iki anlama gelebilir: o konu bu display\'lerde gösterilmiyor (normal) ya da yeni eklenen bir öğe display\'e hiç eklenmemiş. Özellikle yeni eklenen adımlar, parametreler ve mesajlar için bu listeye göz atın.</p>';
    $('cc').innerHTML = h;
    const draw = () => {
      const f = $('ccF').value;
      const items = cc.items.filter(i => f === 'all' || (f === 'hit' && i.status !== 'none') || (f === 'problem' && (i.status === 'old' || i.status === 'mixed')) || (f === 'none' && i.status === 'none'));
      $('ccBody').innerHTML = items.length ? ccRowsHtml(items) : '<tr><td colspan="6" class="muted">Bu filtreye uyan değişiklik yok.</td></tr>';
    };
    $('ccF').addEventListener('change', draw);
    $('ccCsv').addEventListener('click', () => {
      const head = ['#', 'Sayfa (önceki)', 'Sayfa (son)', 'Bölüm', 'Eski metin', 'Yeni metin', 'Durum', 'Yeni hali olan display\'ler', 'Eski hali olan display\'ler'];
      const lines = [head.map(csvCell).join(';')];
      cc.items.forEach(i => lines.push([i.id, i.pageA, i.pageB, i.section, i.oldText, i.newText, CC_LBL[i.status][1].replace(/^\S+\s/, ''),
        i.hasNew.map(d => d.name).join(', '), i.hasOld.map(d => d.name).join(', ')].map(csvCell).join(';')));
      download('\ufeff' + lines.join('\r\n'), 'degisiklik-kontrolu.csv', 'text/csv;charset=utf-8');
    });
    draw();
  }

  function renderRows() {
    const revs = state.revData;
    const fv = $('fVerdict').value, q = $('fq').value.trim().toUpperCase();
    const rows = state.results.filter(r => {
      const c = classify(r);
      if (fv === 'old' && c.key !== 'old') return false;
      if (fv === 'mix' && !isMixed(r)) return false;
      if (fv === 'unclear' && c.key !== 'unclear') return false;
      if (fv === 'same' && c.key !== 'same') return false;
      if (q && !r.name.toUpperCase().includes(q) && !(r.support || []).concat(r.conflict || [], r.outdated || []).some(e => e.f.toUpperCase().includes(q))) return false;
      return true;
    });
    let h = '';
    rows.forEach(r => {
      const c = classify(r);
      const idx = state.results.indexOf(r);
      h += '<tr class="main" data-i="' + idx + '"><td>' + esc(r.name) + '</td><td><span class="badge ' + c.cls + '"' + (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '>' + esc(c.text) + '</span>' +
        (isMixed(r) ? '<span class="mix" title="Başka revizyonlara ait ifadeler de var">⚠ karışık</span>' : '') +
        (!r.error && r.verdict === 'ok' ? '<div class="muted">güven: ' + CONF[r.confidence] + '</div>' : '') + '</td>';
      revs.forEach((rv, i) => {
        const p = r.error ? 0 : Math.round(100 * r.scores[i]);
        h += '<td class="pct"><span class="bar" style="width:' + Math.max(2, p * 0.6) + 'px"></span>' + (r.error ? '—' : p + '%') + '</td>';
      });
      h += '<td class="n">' + (r.error ? '—' : r.nDisc) + '</td><td>' + dateCell(r) + '</td></tr>';
      if (state.open.has(idx)) h += '<tr class="detail"><td colspan="' + (revs.length + 4) + '">' + evidenceHtml(r) + '</td></tr>';
    });
    if (!rows.length) h = '<tr><td colspan="' + (revs.length + 4) + '" class="muted">Bu filtreye uyan display yok.</td></tr>';
    $('tbody').innerHTML = h;
    $('tbody').querySelectorAll('tr.main').forEach(tr => tr.addEventListener('click', () => {
      const i = +tr.dataset.i; if (state.open.has(i)) state.open.delete(i); else state.open.add(i); renderRows();
    }));
  }

  function dateCell(r) {
    if (!r.lastChange) return '<span class="muted">—</span>';
    let h = '<span class="pct">' + fmtDate(r.lastChange) + '</span>';
    if (r.dateNote) h += '<div class="muted"' + (r.dateNote.conflict ? ' style="color:var(--warn-fg)"' : '') + '>' + (r.dateNote.conflict ? '⚠ ' : '') + esc(r.dateNote.text) + '</div>';
    return h;
  }

  function chips(list, max) {
    max = max || 60;
    const show = list.slice(0, max);
    return '<div class="chips">' + show.map(e => '<span class="chip" title="' + (e.kind === 'ids' ? 'tag / parametre' : 'ifade') + '">' +
      (e.kind === 'ph' ? '“' + esc(e.f) + '”' : esc(e.f)) + (e.in ? '<small>' + esc(e.in.join(', ')) + '</small>' : '') + '</span>').join('') +
      (list.length > max ? '<span class="muted">… +' + (list.length - max) + '</span>' : '') + '</div>';
  }

  function evidenceHtml(r) {
    if (r.error) return '<div class="ev">Dosya okunamadı: ' + esc(r.error) + '</div>';
    const revs = state.revData;
    let h = '<div class="ev">';
    h += '<div class="muted">' + r.nDisc + ' ayırt edici ifade · ' + r.nCommon + ' tüm revizyonlarda ortak ifade · ' + r.nUnknown + ' dokümanlarda bulunmayan tag benzeri değer</div>';
    if (r.support.length) h += '<h4>✔ ' + esc(revs[r.best].label) + ' lehine kanıt (' + esc(revs[r.second].label) + ' revizyonunda olmayan ifadeler)</h4>' + chips(r.support.map(e => ({ f: e.f, kind: e.kind, in: e.in })));
    if (r.conflict.length) h += '<h4>⚠ Çelişen ifadeler: ' + esc(revs[r.best].label) + ' revizyonunda yok, başka revizyonlarda var</h4>' + chips(r.conflict);
    if (r.outdated.length) h += '<h4>⟳ Güncellenmesi gerekebilir: son revizyonda (' + esc(revs[revs.length - 1].label) + ') artık bulunmayan ifadeler</h4>' + chips(r.outdated);
    if (!r.support.length && !r.conflict.length && !r.outdated.length) h += r.verdict === 'same'
      ? '<p class="muted">Display\'deki ' + r.nCommon + ' ifade tüm revizyonlarda aynen geçiyor; revizyonlar arasında bu display\'i etkileyen bir değişiklik bulunamadı. Bu display tüm revizyonlarla uyumludur.</p>'
      : '<p class="muted">Ayırt edici kanıt yok: display\'deki tag ve metinler revizyonlar arasında değişmemiş ya da dokümanda hiç geçmiyor.</p>';
    if (r.history && r.history.length) h += '<h4>🕒 Display değişiklik geçmişi</h4><div class="muted">' +
      r.history.slice(-10).map(x => esc(fmtDate(x.date)) + (x.what ? ' — ' + esc(x.what) : '') + (x.who ? ' (' + esc(x.who) + ')' : '')).join('<br>') + '</div>';
    return h + '</div>';
  }

  $('fVerdict').addEventListener('change', renderRows);
  let qT; $('fq').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(renderRows, 200); });

  // ------------------------------------------------------------ dışa aktarma
  function download(content, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const list = (arr, n) => (arr || []).slice(0, n || 50).map(e => e.f + (e.in ? ' [' + e.in.join('/') + ']' : '')).join('; ');

  $('csv').addEventListener('click', () => {
    const revs = state.revData;
    const head = ['Display', 'Tahmin', 'Güven', 'Karışık'].concat(revs.map(r => r.label + ' %'), ['Ayırt edici', 'Son değişiklik', 'Tarih notu', 'Lehine kanıt', 'Çelişen', 'Güncellenmesi gerekebilir']);
    const lines = [head.map(csvCell).join(';')];
    state.results.forEach(r => {
      const c = classify(r);
      lines.push([r.name, c.text, r.error ? '' : CONF[r.confidence], isMixed(r) ? 'evet' : '']
        .concat(revs.map((x, i) => r.error ? '' : Math.round(100 * r.scores[i])),
          [r.error ? '' : r.nDisc, fmtDate(r.lastChange), r.dateNote ? r.dateNote.text : '', list(r.support), list(r.conflict), list(r.outdated)]).map(csvCell).join(';'));
    });
    state.missing.forEach(m => lines.push([m, 'Klasörde bulunamadı'].map(csvCell).join(';')));
    download('﻿' + lines.join('\r\n'), 'display-revizyon.csv', 'text/csv;charset=utf-8');
  });

  $('html').addEventListener('click', () => {
    const revs = state.revData;
    let body = '<div class="wrap"><header class="top"><h1>Display Revizyon Tespiti — Rapor</h1><span class="muted">' + esc(new Date().toLocaleString('tr-TR')) + '</span></header>';
    body += '<p class="muted">Revizyonlar (eskiden yeniye): ' + revs.map(r => esc(r.label) + ' (' + esc(r.file) + (r.date ? ', ' + fmtDate(r.date) : '') + ')').join(' → ') + '</p>';
    body += '<div class="tiles">' + $('tiles').innerHTML + '</div>' + $('missing').innerHTML;
    body += '<table class="res"><thead>' + $('thead').innerHTML + '</thead><tbody>';
    state.results.forEach(r => {
      const c = classify(r);
      body += '<tr><td>' + esc(r.name) + '</td><td><span class="badge ' + c.cls + '">' + esc(c.text) + '</span>' + (isMixed(r) ? '<span class="mix">⚠ karışık</span>' : '') + '</td>' +
        revs.map((x, i) => '<td class="pct">' + (r.error ? '—' : Math.round(100 * r.scores[i]) + '%') + '</td>').join('') +
        '<td class="n">' + (r.error ? '—' : r.nDisc) + '</td><td>' + dateCell(r) + '</td></tr>';
      if (c.key !== 'cur' || isMixed(r)) body += '<tr class="detail"><td colspan="' + (revs.length + 4) + '">' + evidenceHtml(r) + '</td></tr>';
    });
    body += '</tbody></table>' + document.querySelector('#results .note').outerHTML;
    if (state.cc) {
      const L = revs.length - 1;
      const prob = state.cc.items.filter(i => i.status !== 'none');
      body += '<h2>Değişiklik bazlı kontrol: ' + esc(revs[L - 1].label) + ' → ' + esc(revs[L].label) + '</h2><p class="muted">Display\'lerde geçen ' + prob.length + ' değişiklik (toplam kontrol edilebilen: ' + state.cc.items.length + ').</p>' +
        '<table class="res"><thead><tr><th>#</th><th>Sayfa</th><th>Değişiklik (eski → yeni)</th><th>Durum</th><th>Yeni hali olan display\'ler</th><th>Eski hali olan display\'ler</th></tr></thead><tbody>' + ccRowsHtml(prob, true) + '</tbody></table>';
    }
    body += '</div>';
    const html = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
      '<title>Display Revizyon Raporu</title><style>' + $('app-style').textContent + '</style></head><body>' + body + '</body></html>';
    download(html, 'display-revizyon-raporu.html', 'text/html;charset=utf-8');
  });

  renderLists();
})();
