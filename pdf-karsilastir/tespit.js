/* Display Revizyon Tespiti — arayüz */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tick = () => new Promise(r => setTimeout(r, 0));
  const natural = (a, b) => a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' });

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

  const state = { revs: [], disps: [], results: null, revData: null, open: new Set() };
  const revCache = new Map(); // dosya → özellikler (yeniden analizde PDF'i tekrar okumamak için)

  function status(msg, err) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', !!err); }

  // ------------------------------------------------------------ dosya listeleri
  function guessLabel(name) {
    const m = name.match(/rev(?:ision|izyon)?[\s._-]*([A-Z]?\d{1,3}[A-Z]?|[A-Z])(?![a-z])/i);
    return m ? 'Rev ' + m[1].toUpperCase() : name.replace(/\.pdf$/i, '');
  }
  function addRevs(files) {
    files.filter(f => /\.pdf$/i.test(f.name)).forEach(f => {
      if (!state.revs.some(r => r.file.name === f.name && r.file.size === f.size)) state.revs.push({ file: f, label: guessLabel(f.name) });
    });
    sortRevs(); renderLists();
  }
  function sortRevs() { state.revs.sort((a, b) => natural(a.label, b.label)); }
  function addDisps(files) {
    files.filter(f => /\.xml$/i.test(f.name)).forEach(f => {
      const key = (f.webkitRelativePath || f.relPath || f.name) + '|' + f.size;
      if (!state.disps.some(d => d.key === key)) state.disps.push({ file: f, key, name: f.relPath || f.webkitRelativePath || f.name });
    });
    state.disps.sort((a, b) => natural(a.name, b.name));
    renderLists();
  }
  function renderLists() {
    $('revList').innerHTML = state.revs.map((r, i) =>
      '<div class="row"><span class="muted">' + (i + 1) + '.</span><input type="text" data-i="' + i + '" value="' + esc(r.label) + '" title="Revizyon etiketi">' +
      '<span class="nm">' + esc(r.file.name) + '</span><button data-del="' + i + '" title="Listeden çıkar">✕</button></div>').join('');
    $('revHint').style.display = state.revs.length ? 'block' : 'none';
    $('revList').querySelectorAll('input[type=text]').forEach(inp => inp.addEventListener('change', () => {
      state.revs[+inp.dataset.i].label = inp.value.trim() || state.revs[+inp.dataset.i].label; sortRevs(); renderLists();
    }));
    $('revList').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { state.revs.splice(+b.dataset.del, 1); renderLists(); }));
    const n = state.disps.length;
    $('dispList').innerHTML = n ? '<div class="row"><span class="nm"><b>' + n + '</b> XML dosyası seçildi' +
      (n <= 8 ? ': ' + state.disps.map(d => esc(d.name)).join(', ') : ' (ör. ' + state.disps.slice(0, 3).map(d => esc(d.name)).join(', ') + ' …)') + '</span></div>' : '';
    $('go').disabled = !(state.revs.length >= 2 && n);
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
  $('clear').addEventListener('click', () => { state.revs = []; state.disps = []; renderLists(); $('results').style.display = 'none'; status(''); });

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
          revCache.set(key, feat);
        }
        revs.push({ label: r.label, ids: feat.ids, ph: feat.ph, pages: feat.pages, file: r.file.name });
      }
      // revizyonlar arası ayırt edici ifade sayısı (bilgi amaçlı)
      const results = [];
      let i = 0;
      for (const d of state.disps) {
        if (i % 10 === 0) { status('Display\'ler inceleniyor: ' + i + ' / ' + state.disps.length + '…'); await tick(); }
        i++;
        let res;
        try {
          const text = await readXmlText(d.file);
          const F = DocCore.textFeatures(DocCore.xmlStrings(text));
          res = DocCore.scoreDisplay(F, revs);
        } catch (e) {
          res = { error: e.message || String(e) };
        }
        res.name = d.name;
        results.push(res);
      }
      state.results = results;
      state.revData = revs;
      state.open.clear();
      render();
      $('results').style.display = 'block';
      status('Tamamlandı (' + ((performance.now() - t0) / 1000).toFixed(1) + ' sn). ' + results.length + ' display, ' + revs.length + ' revizyon.');
    } catch (e) {
      console.error(e);
      status('Hata: ' + (e.message || e), true);
    } finally {
      $('go').disabled = false;
    }
  });

  // ------------------------------------------------------------ sonuçlar
  function classify(r) {
    const revs = state.revData, last = revs.length - 1;
    if (r.error) return { cls: 'v-ins', text: 'Okunamadı', key: 'unclear' };
    if (r.verdict === 'insufficient') return { cls: 'v-ins', text: 'Yetersiz kanıt', key: 'unclear' };
    if (r.verdict === 'ambiguous') return { cls: 'v-amb', text: 'Belirsiz: ' + revs[r.best].label + ' / ' + revs[r.second].label, key: 'unclear' };
    if (r.best === last) return { cls: 'v-ok', text: revs[r.best].label + ' (güncel)', key: 'cur' };
    return { cls: 'v-old', text: revs[r.best].label, key: 'old' };
  }
  const isMixed = r => !r.error && r.verdict === 'ok' && r.conflict.length >= 2 && r.conflict.length >= 0.1 * r.nDisc;
  const CONF = { high: 'yüksek', med: 'orta', low: 'düşük' };

  function render() {
    const revs = state.revData, res = state.results;
    const counts = {};
    res.forEach(r => { const c = classify(r); const k = c.key === 'unclear' ? 'unclear' : revs[r.best].label; counts[k] = (counts[k] || 0) + 1; });
    let tiles = '<div class="tile"><div class="n">' + res.length + '</div><div class="l">Display</div></div>';
    revs.forEach((rv, i) => {
      tiles += '<div class="tile"><div class="n">' + (counts[rv.label] || 0) + '</div><div class="l">' + esc(rv.label) + (i === revs.length - 1 ? ' (güncel)' : '') + ' ile uyumlu</div></div>';
    });
    tiles += '<div class="tile"><div class="n">' + res.filter(isMixed).length + '</div><div class="l">Karışık izler içeren</div></div>';
    tiles += '<div class="tile"><div class="n">' + (counts.unclear || 0) + '</div><div class="l">Belirsiz / yetersiz kanıt</div></div>';
    $('tiles').innerHTML = tiles;
    $('thead').innerHTML = '<tr><th>Display</th><th>Tahmin</th>' + revs.map(r => '<th>' + esc(r.label) + '</th>').join('') + '<th title="Bu display\'de bulunan ve sadece bazı revizyonlarda geçen ifade sayısı">Ayırt edici</th></tr>';
    renderRows();
  }

  function renderRows() {
    const revs = state.revData;
    const fv = $('fVerdict').value, q = $('fq').value.trim().toUpperCase();
    const rows = state.results.filter(r => {
      const c = classify(r);
      if (fv === 'old' && c.key !== 'old') return false;
      if (fv === 'mix' && !isMixed(r)) return false;
      if (fv === 'unclear' && c.key !== 'unclear') return false;
      if (q && !r.name.toUpperCase().includes(q) && !(r.support || []).concat(r.conflict || [], r.outdated || []).some(e => e.f.toUpperCase().includes(q))) return false;
      return true;
    });
    let h = '';
    rows.forEach(r => {
      const c = classify(r);
      const idx = state.results.indexOf(r);
      h += '<tr class="main" data-i="' + idx + '"><td>' + esc(r.name) + '</td><td><span class="badge ' + c.cls + '">' + esc(c.text) + '</span>' +
        (isMixed(r) ? '<span class="mix" title="Başka revizyonlara ait ifadeler de var">⚠ karışık</span>' : '') +
        (!r.error && r.verdict === 'ok' ? '<div class="muted">güven: ' + CONF[r.confidence] + '</div>' : '') + '</td>';
      revs.forEach((rv, i) => {
        const p = r.error ? 0 : Math.round(100 * r.scores[i]);
        h += '<td class="pct"><span class="bar" style="width:' + Math.max(2, p * 0.6) + 'px"></span>' + (r.error ? '—' : p + '%') + '</td>';
      });
      h += '<td class="n">' + (r.error ? '—' : r.nDisc) + '</td></tr>';
      if (state.open.has(idx)) h += '<tr class="detail"><td colspan="' + (revs.length + 3) + '">' + evidenceHtml(r) + '</td></tr>';
    });
    if (!rows.length) h = '<tr><td colspan="' + (revs.length + 3) + '" class="muted">Bu filtreye uyan display yok.</td></tr>';
    $('tbody').innerHTML = h;
    $('tbody').querySelectorAll('tr.main').forEach(tr => tr.addEventListener('click', () => {
      const i = +tr.dataset.i; if (state.open.has(i)) state.open.delete(i); else state.open.add(i); renderRows();
    }));
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
    if (!r.support.length && !r.conflict.length && !r.outdated.length) h += '<p class="muted">Ayırt edici kanıt yok.</p>';
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
    const head = ['Display', 'Tahmin', 'Güven', 'Karışık'].concat(revs.map(r => r.label + ' %'), ['Ayırt edici', 'Lehine kanıt', 'Çelişen', 'Güncellenmesi gerekebilir']);
    const lines = [head.map(csvCell).join(';')];
    state.results.forEach(r => {
      const c = classify(r);
      lines.push([r.name, c.text, r.error ? '' : CONF[r.confidence], isMixed(r) ? 'evet' : '']
        .concat(revs.map((x, i) => r.error ? '' : Math.round(100 * r.scores[i])),
          [r.error ? '' : r.nDisc, list(r.support), list(r.conflict), list(r.outdated)]).map(csvCell).join(';'));
    });
    download('﻿' + lines.join('\r\n'), 'display-revizyon.csv', 'text/csv;charset=utf-8');
  });

  $('html').addEventListener('click', () => {
    const revs = state.revData;
    let body = '<div class="wrap"><header class="top"><h1>Display Revizyon Tespiti — Rapor</h1><span class="muted">' + esc(new Date().toLocaleString('tr-TR')) + '</span></header>';
    body += '<p class="muted">Revizyonlar (eskiden yeniye): ' + revs.map(r => esc(r.label) + ' (' + esc(r.file) + ')').join(' → ') + '</p>';
    body += '<div class="tiles">' + $('tiles').innerHTML + '</div>';
    body += '<table class="res"><thead>' + $('thead').innerHTML + '</thead><tbody>';
    state.results.forEach(r => {
      const c = classify(r);
      body += '<tr><td>' + esc(r.name) + '</td><td><span class="badge ' + c.cls + '">' + esc(c.text) + '</span>' + (isMixed(r) ? '<span class="mix">⚠ karışık</span>' : '') + '</td>' +
        revs.map((x, i) => '<td class="pct">' + (r.error ? '—' : Math.round(100 * r.scores[i]) + '%') + '</td>').join('') +
        '<td class="n">' + (r.error ? '—' : r.nDisc) + '</td></tr>';
      if (c.key !== 'cur' || isMixed(r)) body += '<tr class="detail"><td colspan="' + (revs.length + 3) + '">' + evidenceHtml(r) + '</td></tr>';
    });
    body += '</tbody></table>' + document.querySelector('#results .note').outerHTML + '</div>';
    const html = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
      '<title>Display Revizyon Raporu</title><style>' + $('app-style').textContent + '</style></head><body>' + body + '</body></html>';
    download(html, 'display-revizyon-raporu.html', 'text/html;charset=utf-8');
  });

  renderLists();
})();
