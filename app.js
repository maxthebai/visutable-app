/* VisuTable – Dokumentenkamera der Schülerfirma Dispektrum
 * Reine Web-App: läuft im Browser des Tablets, keine Daten verlassen das Gerät. */
'use strict';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), video = $('video'), frozen = $('frozen'), ink = $('ink');
const toolbar = $('toolbar'), panel = $('panel'), gallery = $('gallery');

/* ---------- Zustand ---------- */
const S = {
  stream: null, track: null,
  rot: 0, zoom: 1, panX: 0, panY: 0, mirror: false,
  bright: 100, contrast: 100, sat: 100, doc: false,
  frozen: false, override: null,     // override: Ansicht eines Galerie-Fotos (schon gedreht/gefiltert)
  drawing: false, compare: null,
  black: false, autohide: true, watermark: true,
  deviceId: '', res: '1920x1080',
  photos: [], strokes: [], pen: { color: '#ff3b30', w: 4, hi: false },
};
const ZMIN = 1, ZMAX = 8;

/* ---------- Einstellungen speichern ---------- */
const KEY = 'visutable.settings.v1';
function loadSettings() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of ['rot', 'mirror', 'bright', 'contrast', 'sat', 'doc', 'autohide', 'watermark', 'deviceId', 'res']) if (k in o) S[k] = o[k];
  } catch (e) { /* privater Modus o. ä. */ }
}
function saveSettings() {
  try {
    const { rot, mirror, bright, contrast, sat, doc, autohide, watermark, deviceId, res } = S;
    localStorage.setItem(KEY, JSON.stringify({ rot, mirror, bright, contrast, sat, doc, autohide, watermark, deviceId, res }));
  } catch (e) { }
}

/* ---------- Kamera ---------- */
async function startCamera() {
  stopCamera();
  const [w, h] = S.res.split('x').map(Number);
  const video_c = { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } };
  if (S.deviceId) video_c.deviceId = { exact: S.deviceId }; else video_c.facingMode = { ideal: 'environment' };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: video_c, audio: false });
  } catch (e) {
    if (S.deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
      S.deviceId = ''; saveSettings(); return startCamera();
    }
    throw e;
  }
  S.stream = stream; S.track = stream.getVideoTracks()[0];
  video.srcObject = stream;
  await video.play().catch(() => { });
  await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
  S.track.addEventListener('ended', () => toast('Kamera wurde getrennt – tippe auf „Mehr“ → Kamera wählen.'));
  const st = S.track.getSettings();
  if (st.deviceId && !S.deviceId) S.deviceId = st.deviceId;
  $('resInfo').textContent = `Aktuell: ${video.videoWidth} × ${video.videoHeight}${st.frameRate ? ' · ' + Math.round(st.frameRate) + ' fps' : ''}`;
  setupCapabilities();
  await fillCameraList();
  layout();
}
function stopCamera() {
  if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
  S.stream = null; S.track = null;
}
async function fillCameraList() {
  const sel = $('selCam');
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  sel.innerHTML = '';
  devs.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId; o.textContent = d.label || `Kamera ${i + 1}`;
    if (d.deviceId === S.deviceId) o.selected = true;
    sel.appendChild(o);
  });
}
function caps() { try { return S.track && S.track.getCapabilities ? S.track.getCapabilities() : {}; } catch (e) { return {}; } }
function setupCapabilities() {
  const c = caps();
  const torch = $('chkTorch');
  torch.disabled = !c.torch; torch.checked = false;
  $('torchHint').textContent = c.torch ? '' : '(von dieser Kamera nicht unterstützt)';
  $('btnFocus').disabled = !(c.focusMode && c.focusMode.length);
  if (c.focusMode && c.focusMode.includes('continuous')) S.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => { });
}
async function refocus() {
  const c = caps(); if (!c.focusMode) return;
  try {
    if (c.focusMode.includes('single-shot')) await S.track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
    if (c.focusMode.includes('continuous')) setTimeout(() => S.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => { }), 900);
    toast('Fokussiere …');
  } catch (e) { toast('Fokus wird nicht unterstützt'); }
}

/* ---------- Darstellung ---------- */
function activeEl() { return S.frozen ? frozen : video; }
function srcDims() {
  const el = activeEl();
  return el === video ? [video.videoWidth || 16, video.videoHeight || 9] : [frozen.width, frozen.height];
}
function view() {
  return S.override || { rot: S.rot, mirror: S.mirror, filter: cssFilter() };
}
function cssFilter() {
  const b = S.bright / 100, c = S.contrast / 100, s = S.sat / 100;
  return S.doc
    ? `grayscale(1) contrast(${(c * 1.9).toFixed(2)}) brightness(${(b * 1.12).toFixed(2)})`
    : `brightness(${b}) contrast(${c}) saturate(${s})`;
}
function area() {
  const W = stage.clientWidth, H = stage.clientHeight;
  return S.compare ? { W: W / 2, H, cx: W / 4 } : { W, H, cx: 0 };
}
function geometry() {
  const [w, h] = srcDims(); const v = view(); const { W, H, cx } = area();
  const turned = v.rot % 180 !== 0;
  const rw = turned ? h : w, rh = turned ? w : h;
  const fit = Math.min(W / rw, H / rh);
  return { w, h, rw, rh, fit, W, H, cx, v };
}
function clampPan(g) {
  const mx = Math.max(0, (g.rw * g.fit * S.zoom - g.W) / 2), my = Math.max(0, (g.rh * g.fit * S.zoom - g.H) / 2);
  S.panX = Math.min(mx, Math.max(-mx, S.panX)); S.panY = Math.min(my, Math.max(-my, S.panY));
}
function layout() {
  const g = geometry(); clampPan(g);
  for (const el of [video, frozen]) {
    el.style.width = g.w * g.fit + 'px'; el.style.height = g.h * g.fit + 'px';
    el.style.transform = `translate(-50%,-50%) translate(${g.cx + S.panX}px,${S.panY}px) rotate(${g.v.rot}deg) scale(${S.zoom}) scaleX(${g.v.mirror ? -1 : 1})`;
    el.style.filter = g.v.filter;
  }
  video.hidden = S.frozen; frozen.hidden = !S.frozen;
  $('freezeBadge').hidden = !S.frozen;
  $('freezeBadge').textContent = S.override ? '🖼 Foto' : '⏸ Standbild';
  $('watermark').hidden = !S.watermark;
  setOn('freeze', S.frozen); setOn('doc', S.doc); setOn('draw', S.drawing); setOn('black', S.black);
  setOn('fullscreen', !!(document.fullscreenElement || document.webkitFullscreenElement));
}
function setOn(act, on) { const b = toolbar.querySelector(`[data-act="${act}"]`); if (b) b.classList.toggle('on', !!on); }

let zoomBadgeT;
function setZoom(z, ax = null, ay = null) {
  const old = S.zoom; z = Math.min(ZMAX, Math.max(ZMIN, z));
  if (ax !== null) { // um den Fingerpunkt zoomen
    const { cx } = area(); const px = ax - stage.clientWidth / 2 - cx, py = ay - stage.clientHeight / 2;
    S.panX = px - (px - S.panX) * (z / old); S.panY = py - (py - S.panY) * (z / old);
  } else { S.panX *= z / old; S.panY *= z / old; }
  S.zoom = z; if (z === 1) { S.panX = 0; S.panY = 0; }
  layout();
  const zb = $('zoomBadge'); zb.textContent = Math.round(z * 100) + ' %'; zb.hidden = false; zb.style.opacity = 1;
  clearTimeout(zoomBadgeT); zoomBadgeT = setTimeout(() => { zb.style.opacity = 0; setTimeout(() => (zb.hidden = true), 400); }, 1200);
}
function resetView() { S.zoom = 1; S.panX = 0; S.panY = 0; layout(); }

/* ---------- Standbild ---------- */
function freeze(on = !S.frozen) {
  if (on) {
    if (!video.videoWidth) return;
    frozen.width = video.videoWidth; frozen.height = video.videoHeight;
    frozen.getContext('2d').drawImage(video, 0, 0);
    S.override = null; S.frozen = true;
  } else {
    S.frozen = false; S.override = null;
  }
  layout();
}
async function showPhoto(p) {
  const img = await loadImg(p.url);
  frozen.width = img.naturalWidth; frozen.height = img.naturalHeight;
  frozen.getContext('2d').drawImage(img, 0, 0);
  S.override = { rot: 0, mirror: false, filter: 'none' }; S.frozen = true;
  S.zoom = 1; S.panX = S.panY = 0; closeAll(); layout();
}
function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }

/* ---------- Foto aufnehmen (genau der sichtbare Ausschnitt, inkl. Zeichnung) ---------- */
function snapshot() {
  const g = geometry(); const src = activeEl(); if (!g.w) return;
  const s = g.fit * S.zoom;
  const outW = Math.round(Math.min(g.rw, g.W / s)), outH = Math.round(Math.min(g.rh, g.H / s));
  const c = document.createElement('canvas'); c.width = outW; c.height = outH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, outW, outH);
  const useCtxFilter = g.v.filter !== 'none' && supportsCtxFilter();
  if (useCtxFilter) ctx.filter = g.v.filter;
  ctx.save();
  ctx.translate(outW / 2 + S.panX / s, outH / 2 + S.panY / s);
  ctx.rotate(g.v.rot * Math.PI / 180);
  if (g.v.mirror) ctx.scale(-1, 1);
  ctx.drawImage(src, -g.w / 2, -g.h / 2, g.w, g.h);
  ctx.restore();
  ctx.filter = 'none';
  if (g.v.filter !== 'none' && !useCtxFilter) manualFilter(ctx, outW, outH);
  if (S.strokes.length) { // Zeichnung mitnehmen
    const dpr = ink.width / stage.clientWidth;
    const sw = outW * s, sh = outH * s;
    const sx = stage.clientWidth / 2 + g.cx - sw / 2, sy = stage.clientHeight / 2 - sh / 2;
    ctx.drawImage(ink, sx * dpr, sy * dpr, sw * dpr, sh * dpr, 0, 0, outW, outH);
  }
  stage.classList.remove('flash'); void stage.offsetWidth; stage.classList.add('flash');
  c.toBlob((blob) => {
    if (!blob) return;
    const p = { id: Date.now(), blob, url: URL.createObjectURL(blob), time: new Date() };
    S.photos.push(p); renderGallery(); toast(`Foto ${S.photos.length} gespeichert`);
  }, 'image/jpeg', 0.92);
}
let _ctxFilter;
function supportsCtxFilter() {
  if (_ctxFilter !== undefined) return _ctxFilter;
  const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d');
  x.filter = 'brightness(0)'; x.fillStyle = '#fff'; x.fillRect(0, 0, 1, 1);
  return (_ctxFilter = x.getImageData(0, 0, 1, 1).data[0] === 0);
}
function manualFilter(ctx, w, h) { // Ersatz für Safari ohne ctx.filter
  const b = S.bright / 100, c = S.contrast / 100, s = S.sat / 100;
  const cc = S.doc ? c * 1.9 : c, bb = S.doc ? b * 1.12 : b, ss = S.doc ? 0 : s;
  const d = ctx.getImageData(0, 0, w, h), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    let r = a[i], g = a[i + 1], bl = a[i + 2];
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    r = L + (r - L) * ss; g = L + (g - L) * ss; bl = L + (bl - L) * ss;
    r = ((r - 128) * cc + 128); g = ((g - 128) * cc + 128); bl = ((bl - 128) * cc + 128);
    if (S.doc) { r *= bb; g *= bb; bl *= bb; } else { r = r * bb; g = g * bb; bl = bl * bb; }
    a[i] = r; a[i + 1] = g; a[i + 2] = bl;
  }
  ctx.putImageData(d, 0, 0);
}

/* ---------- Galerie & Vergleich ---------- */
function renderGallery() {
  $('galCount').textContent = S.photos.length ? `(${S.photos.length})` : '';
  const grid = $('galGrid'); grid.innerHTML = '';
  if (!S.photos.length) { grid.innerHTML = '<div class="gal-empty">Noch keine Fotos. Tippe unten auf „Foto“.</div>'; return; }
  S.photos.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'gal-item';
    d.innerHTML = `<span class="num">${i + 1}</span><img alt="Foto ${i + 1}"><div class="acts">
      <button data-a="cmp" title="Neben Livebild vergleichen">⇆</button>
      <button data-a="dl" title="Speichern">⤓</button>
      <button data-a="del" title="Löschen">🗑</button></div>`;
    d.querySelector('img').src = p.url;
    d.querySelector('img').onclick = () => showPhoto(p);
    d.querySelector('[data-a=cmp]').onclick = () => startCompare(p);
    d.querySelector('[data-a=dl]').onclick = () => downloadPhoto(p, i);
    d.querySelector('[data-a=del]').onclick = () => { URL.revokeObjectURL(p.url); S.photos.splice(i, 1); if (S.compare === p) stopCompare(); renderGallery(); };
    grid.appendChild(d);
  });
}
function fname(p, i) {
  const t = p.time, z = (n) => String(n).padStart(2, '0');
  return `VisuTable_${t.getFullYear()}-${z(t.getMonth() + 1)}-${z(t.getDate())}_${z(t.getHours())}-${z(t.getMinutes())}_${i + 1}.jpg`;
}
async function downloadPhoto(p, i) {
  const file = new File([p.blob], fname(p, i), { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPad|iPhone|Android/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: 'VisuTable' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = p.url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
}
async function saveAll() {
  if (!S.photos.length) return;
  const files = S.photos.map((p, i) => new File([p.blob], fname(p, i), { type: 'image/jpeg' }));
  if (navigator.canShare && navigator.canShare({ files }) && /iPad|iPhone|Android/i.test(navigator.userAgent)) {
    try { await navigator.share({ files, title: 'VisuTable Fotos' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  for (let i = 0; i < S.photos.length; i++) { await downloadPhoto(S.photos[i], i); await new Promise((r) => setTimeout(r, 300)); }
}
let cmpClose;
function startCompare(p) {
  S.compare = p; const im = $('compareImg'); im.src = p.url; im.hidden = false;
  stage.classList.add('compare');
  if (!cmpClose) {
    cmpClose = document.createElement('button'); cmpClose.className = 'chip'; cmpClose.textContent = '✕ Vergleich beenden';
    Object.assign(cmpClose.style, { position: 'absolute', top: '14px', left: '14px', zIndex: 6 });
    cmpClose.onclick = stopCompare; stage.appendChild(cmpClose);
  }
  cmpClose.hidden = false; closeAll(); resetView();
}
function stopCompare() { S.compare = null; $('compareImg').hidden = true; stage.classList.remove('compare'); if (cmpClose) cmpClose.hidden = true; resetView(); }

/* ---------- Zeichnen ---------- */
function sizeInk() {
  const dpr = window.devicePixelRatio || 1;
  ink.width = Math.round(stage.clientWidth * dpr); ink.height = Math.round(stage.clientHeight * dpr);
  redrawInk();
}
function drawStroke(ctx, st) {
  if (!st.pts.length) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = st.color; ctx.lineWidth = st.w; ctx.globalAlpha = st.hi ? 0.35 : 1;
  ctx.beginPath(); ctx.moveTo(st.pts[0][0], st.pts[0][1]);
  if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] + 0.1, st.pts[0][1]);
  for (let i = 1; i < st.pts.length; i++) {
    const [x0, y0] = st.pts[i - 1], [x1, y1] = st.pts[i];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.stroke(); ctx.restore();
}
function redrawInk() {
  const ctx = ink.getContext('2d'); const dpr = ink.width / Math.max(1, stage.clientWidth);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ink.width, ink.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S.strokes.forEach((s) => drawStroke(ctx, s));
}
function setDrawing(on = !S.drawing) {
  S.drawing = on; stage.classList.toggle('drawing', on); $('drawbar').hidden = !on; layout();
}
let curStroke = null;
ink.addEventListener('pointerdown', (e) => {
  if (!S.drawing) return; e.stopPropagation(); ink.setPointerCapture(e.pointerId);
  curStroke = { color: S.pen.color, w: S.pen.w, hi: S.pen.hi, pts: [[e.offsetX, e.offsetY]] };
  S.strokes.push(curStroke); redrawInk(); poke();
});
ink.addEventListener('pointermove', (e) => {
  if (!curStroke) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  evs.forEach((ev) => curStroke.pts.push([ev.offsetX, ev.offsetY])); redrawInk();
});
['pointerup', 'pointercancel'].forEach((t) => ink.addEventListener(t, () => (curStroke = null)));
document.querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active')); b.classList.add('active'); S.pen.color = b.dataset.color;
}));
[$('penThin'), $('penHi')].forEach((b) => b.addEventListener('click', () => {
  $('penThin').classList.remove('active'); $('penHi').classList.remove('active'); b.classList.add('active');
  S.pen.w = +b.dataset.w; S.pen.hi = !!b.dataset.hi;
}));
$('inkUndo').onclick = () => { S.strokes.pop(); redrawInk(); };
$('inkClear').onclick = () => { S.strokes = []; redrawInk(); };

/* ---------- Gesten: Ziehen, Pinch-Zoom, Doppeltipp ---------- */
const pts = new Map(); let pinch = null, lastTap = 0;
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.toolbar,.panel,.gallery,.drawbar,button')) return;
  const wasHidden = !stage.classList.contains('ui-visible'); poke();
  if (S.black) { blackout(false); return; }
  if (S.drawing) return;
  stage.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: S.zoom };
  }
  const now = Date.now();
  if (pts.size === 1 && now - lastTap < 300 && !wasHidden) { setZoom(S.zoom > 1.01 ? 1 : 2.5, e.clientX, e.clientY); lastTap = 0; }
  else lastTap = now;
});
stage.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId)) return;
  const prev = pts.get(e.pointerId); const cur = { x: e.clientX, y: e.clientY }; pts.set(e.pointerId, cur);
  if (pts.size === 1 && S.zoom > 1) { S.panX += cur.x - prev.x; S.panY += cur.y - prev.y; layout(); }
  else if (pts.size === 2 && pinch) {
    const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    setZoom(pinch.z * d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => stage.addEventListener(t, (e) => {
  pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
}));
stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY); }, { passive: false });

/* ---------- Steuerung ein-/ausblenden ---------- */
let hideT;
function poke() {
  stage.classList.add('ui-visible'); clearTimeout(hideT);
  if (S.autohide && panel.hidden && gallery.hidden && !S.drawing) hideT = setTimeout(() => stage.classList.remove('ui-visible'), 4000);
}
document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') poke(); });

/* ---------- Bild aus / Vollbild / Wake-Lock ---------- */
function blackout(on = !S.black) { S.black = on; $('blackout').hidden = !on; layout(); }
async function toggleFullscreen() {
  const d = document, el = d.documentElement;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen());
    else await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
  } catch (e) { toast('Vollbild nicht möglich – App über „Zum Home-Bildschirm“ installieren.'); }
}
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); } } catch (e) { }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !stage.hidden) { keepAwake(); if (S.track && S.track.readyState === 'ended') startCamera().catch(() => { }); }
});

/* ---------- Panels ---------- */
function closeAll() { panel.hidden = true; gallery.hidden = true; poke(); }
function openPanel(p) { const was = !p.hidden; closeAll(); if (!was) { p.hidden = false; poke(); } }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeAll));

/* ---------- Aktionen ---------- */
const actions = {
  freeze: () => freeze(),
  snap: () => snapshot(),
  zoomin: () => setZoom(S.zoom * 1.25),
  zoomout: () => setZoom(S.zoom / 1.25),
  rotate: () => { if (S.override) S.override.rot = (S.override.rot + 90) % 360; else { S.rot = (S.rot + 90) % 360; saveSettings(); } S.panX = S.panY = 0; layout(); toast(`Gedreht: ${(S.override || S).rot}°`); },
  doc: () => { S.doc = !S.doc; saveSettings(); layout(); toast(S.doc ? 'Textmodus: schwarz-weiß, hoher Kontrast' : 'Farbmodus'); },
  draw: () => setDrawing(),
  gallery: () => { renderGallery(); openPanel(gallery); },
  black: () => blackout(),
  settings: () => openPanel(panel),
  fullscreen: () => toggleFullscreen(),
};
toolbar.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (!b) return; poke(); actions[b.dataset.act](); });

document.addEventListener('keydown', (e) => {
  if (stage.hidden || e.target.matches('input,select')) return;
  const k = e.key; let used = true; poke();
  if (S.black && k !== 'b' && k !== 'B' && k !== '.') { blackout(false); return; }
  if (k === ' ' || k === 'PageDown') actions.freeze();
  else if (k === 's' || k === 'S' || k === 'PageUp') actions.snap();
  else if (k === '+' || k === '=') actions.zoomin();
  else if (k === '-' || k === '_') actions.zoomout();
  else if (k === '0') resetView();
  else if (k === 'r' || k === 'R') actions.rotate();
  else if (k === 'd' || k === 'D') actions.doc();
  else if (k === 'p' || k === 'P') actions.draw();
  else if (k === 'g' || k === 'G') actions.gallery();
  else if (k === 'b' || k === 'B' || k === '.') actions.black();
  else if (k === 'f' || k === 'F') actions.fullscreen();
  else if (k === 'Escape') { closeAll(); if (S.drawing) setDrawing(false); }
  else if (k.startsWith('Arrow')) { const st = 60; if (k === 'ArrowLeft') S.panX += st; if (k === 'ArrowRight') S.panX -= st; if (k === 'ArrowUp') S.panY += st; if (k === 'ArrowDown') S.panY -= st; layout(); }
  else used = false;
  if (used) e.preventDefault();
});

/* ---------- Einstellungs-Panel ---------- */
function bindSettings() {
  const r = (id, key) => { const el = $(id); el.value = S[key]; el.addEventListener('input', () => { S[key] = +el.value; layout(); saveSettings(); }); };
  r('rngBright', 'bright'); r('rngContrast', 'contrast'); r('rngSat', 'sat');
  const c = (id, key, fn) => { const el = $(id); el.checked = S[key]; el.addEventListener('change', () => { S[key] = el.checked; saveSettings(); layout(); fn && fn(); }); };
  c('chkMirror', 'mirror'); c('chkWatermark', 'watermark'); c('chkAutohide', 'autohide', poke);
  $('chkTorch').addEventListener('change', (e) => S.track && S.track.applyConstraints({ advanced: [{ torch: e.target.checked }] }).catch(() => toast('Licht nicht verfügbar')));
  $('selRes').value = S.res;
  $('selRes').addEventListener('change', (e) => { S.res = e.target.value; saveSettings(); startCamera().catch(camError); });
  $('selCam').addEventListener('change', (e) => { S.deviceId = e.target.value; saveSettings(); startCamera().catch(camError); });
  $('btnReset').onclick = () => { Object.assign(S, { bright: 100, contrast: 100, sat: 100, doc: false, rot: 0, mirror: false }); ['rngBright', 'rngContrast', 'rngSat'].forEach((id) => ($(id).value = 100)); $('chkMirror').checked = false; saveSettings(); resetView(); };
  $('btnFocus').onclick = refocus;
  $('galClear').onclick = () => { if (!S.photos.length || !confirm('Alle Fotos dieser Stunde löschen?')) return; S.photos.forEach((p) => URL.revokeObjectURL(p.url)); S.photos = []; stopCompare(); renderGallery(); };
  $('galSaveAll').onclick = saveAll;
}

/* ---------- Hilfen ---------- */
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200); }
function camError(e) {
  const m = {
    NotAllowedError: 'Kamera-Zugriff wurde verweigert. Erlaube die Kamera in den Browser-Einstellungen und lade die Seite neu.',
    NotFoundError: 'Keine Kamera gefunden.',
    NotReadableError: 'Die Kamera wird gerade von einer anderen App benutzt.',
  }[e && e.name] || 'Kamera konnte nicht gestartet werden: ' + (e && e.message || e);
  if (!stage.hidden) toast(m); else $('splashMsg').textContent = m;
}

/* ---------- Start ---------- */
loadSettings(); bindSettings();
$('btnStart').addEventListener('click', async () => {
  $('splashMsg').textContent = '';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('splashMsg').textContent = window.isSecureContext ? 'Dieser Browser unterstützt keinen Kamerazugriff.' : 'Die Kamera funktioniert nur über https:// – bitte die offizielle Adresse öffnen.';
    return;
  }
  $('btnStart').disabled = true; $('btnStart').textContent = 'Starte …';
  try {
    stage.hidden = false; sizeInk();
    await startCamera();
    $('splash').hidden = true; keepAwake(); poke();
    if (matchMedia('(display-mode: browser)').matches && !/iPhone/.test(navigator.userAgent)) toggleFullscreen();
  } catch (e) {
    stage.hidden = true; camError(e);
  } finally { $('btnStart').disabled = false; $('btnStart').textContent = 'Kamera starten'; }
});
window.addEventListener('resize', () => { if (!stage.hidden) { sizeInk(); layout(); } });
document.addEventListener('fullscreenchange', layout);
document.addEventListener('webkitfullscreenchange', layout);
video.addEventListener('resize', layout);
renderGallery();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
