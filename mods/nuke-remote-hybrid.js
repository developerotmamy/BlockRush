// ==BlockRushMod==
// @id nuke-remote
// @name Ядерный пульт (гибрид)
// @version 2.0
// @author me
// @desc Пульт в руке, 3D-карта в мире, выбор цели, отсчёт и ЗАПУСК. Мощный ядерный взрыв: гриб, ударная волна 440 м, физический разлёт машин и персонажа.
// @api 2
// ==/BlockRushMod==
const THREE = BR.THREE, G = BR.G, me = BR.me, cam = BR.camera, Std = G.StdMat;
const clamp = BR.clamp;
const safe = fn => (...a) => { try { return fn(...a); } catch (e) { BR.log('nuke-remote: ' + (e && e.message)); } };
const BOUND = G.BOUND || 272;

const CORE = 95;          // радиус разрушения у эпицентра, м (BR.world.explode)
const WAVE = 440;         // радиус ударной волны, м
const WAVE_T = 1.8;       // за сколько секунд волна доходит до края
const DAMAGE_CARS = true; // ломать машины через штатный crashFx
const BOOST_FX = true;    // поднять лимиты обломков/дыма до максимума

const PX = 0.06;
const ns = o => { o.traverse(c => { c.userData.noSync = true; }); return o; };
const isHostOrSolo = () => BR.net.isHost || !(G.net && G.net.role);

// Больше физических обломков и дыма (профиль Maximum)
if (BOOST_FX) {
  try {
    const pr = G.PROFILES;
    if (pr) for (const k in pr) Object.assign(pr[k], { pieces: 70, pieceLife: 45, piecePts: 256, pieceSub: 3, deb: 90, sm: 360, fx: 1 });
  } catch (e) { BR.log('nuke-remote: profiles skipped'); }
}

let holding = true, fpv = false, hidFp = false, pressT = 0, time = 0;

/* ===================== ЗВУК ===================== */
let ac = null;
function audio() {
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { ac = null; }
  return ac;
}
function beep(freq, len, vol) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.value = freq; g.gain.setValueAtTime(vol || .12, a.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, a.currentTime + (len || .12));
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + (len || .12));
}
function whistle(dur, vol) {
  const a = audio(); if (!a) return;
  const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(260, t + dur);
  g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.09 * vol, t + dur * .6); g.gain.linearRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
}
function boomSound(vol) {
  const a = audio(); if (!a) return;
  const t = a.currentTime, n = a.sampleRate * 5, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
  const s = a.createBufferSource(); s.buffer = b;
  const f = a.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(1200, t); f.frequency.exponentialRampToValueAtTime(60, t + 4);
  const g = a.createGain(); g.gain.value = .8 * vol;
  s.connect(f).connect(g).connect(a.destination); s.start(t);
  const o = a.createOscillator(), og = a.createGain();
  o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(20, t + 3);
  og.gain.setValueAtTime(.7 * vol, t); og.gain.exponentialRampToValueAtTime(.001, t + 3);
  o.connect(og).connect(a.destination); o.start(t); o.stop(t + 3);
}

/* ===================== МОДЕЛЬ ПУЛЬТА ===================== */
function buildRemote() {
  const g = new THREE.Group(), btn = [];
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.42), new Std({ color: 0x23262d, roughness: .5 })));
  const scr = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.006, 0.1), new Std({ color: 0x0a2a3a, emissive: 0x2fd3ff, emissiveIntensity: .9 }));
  scr.position.set(0, 0.027, 0.1); g.add(scr);
  [0xe8553d, 0x5ee0a0, 0xf2c14e, 0x3fa5ff].forEach((c, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 12), new Std({ color: c, emissive: c, emissiveIntensity: .4 }));
    b.position.set((i % 2 ? 1 : -1) * 0.035, 0.035, -0.07 + Math.floor(i / 2) * 0.07); g.add(b); btn.push(b);
  });
  const big = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 16), new Std({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: .6 }));
  big.position.set(0, 0.037, -0.17); g.add(big); btn.push(big);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), new Std({ color: 0xaab0bb }));
  ant.rotation.x = Math.PI / 2; ant.position.set(0.055, 0.03, -0.3); g.add(ant);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), new Std({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 1 }));
  led.position.set(0.055, 0.03, -0.4); g.add(led);
  g.traverse(o => { o.castShadow = false; });
  return { g, btn, led, scr };
}
function animRemote(R) {
  const k = pressT > 0 ? 0.012 : 0;
  R.btn.forEach((b, i) => { b.position.y = (i === R.btn.length - 1 ? 0.037 : 0.035) - k; });
  R.led.material.emissiveIntensity = ui.open ? 0.9 + 0.9 * Math.sin(time * 9) : 0.3 + 0.3 * Math.sin(time * 3);
  R.scr.material.emissiveIntensity = ui.open ? 1.2 : 0.6;
}

// пульт в руке персонажа (вид от 3-го лица)
const R1 = buildRemote(); const remote = R1.g; ns(remote); remote.visible = true;
const HAND_POS = [0, -6 * PX - 0.1, 0];
const HAND_ROT = [Math.PI / 2, 0, 0];
function attach() {
  const hand = me.H.elbA;
  if (remote.parent !== hand) { remote.parent && remote.parent.remove(remote); hand.add(remote); }
  remote.position.set(...HAND_POS); remote.rotation.set(...HAND_ROT);
}
BR.patch('drawAvatar', orig => function (a, dt) {
  const r = orig.call(this, a, dt);
  try {
    if (a === BR.me) {
      if (hidFp && !fpv && !me.inCar) { me.H.g.visible = true; hidFp = false; }
      if (holding && !fpv && !a.fly && !(a.lie > 0) && !a.inCar && BR.state.mode === 'play') {
        a.H.armA.rotation.set(-1.1, 0, 0.15);
        a.H.elbA.rotation.set(-1.2, 0, 0);
        attach();
      }
    }
  } catch (e) { BR.log('drawAvatar: ' + e.message); }
  return r;
});

// пульт перед камерой (вид от 1-го лица)
const R2 = buildRemote(); ns(R2.g); R2.g.visible = false; BR.scene.add(R2.g);
const Y = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3(), q = new THREE.Quaternion();
const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
BR.patch('updateCamera', orig => function (dt) {
  const r = orig.call(this, dt);
  try {
    R2.g.visible = false;
    if (!fpv || BR.state.mode !== 'play') return r;
    if (me.inCar) {
      const o = BR.player.obj; o.updateMatrixWorld(true);
      cam.position.copy(o.localToWorld(v3.set(0.35, 1.1, 0.1)));
      o.getWorldQuaternion(q).multiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.PI));
      cam.quaternion.copy(q);
    } else {
      const p = clamp(me.camPitch - 0.32, -0.6, 0.9), cp = Math.cos(p);
      cam.position.set(me.x, me.y + 1.65, me.z);
      cam.lookAt(me.x + Math.sin(me.camYaw) * cp, me.y + 1.65 - Math.sin(p), me.z + Math.cos(me.camYaw) * cp);
      me.H.g.visible = false; hidFp = true;
    }
    cam.updateMatrixWorld();
    if (!me.inCar && holding) {
      R2.g.position.copy(cam.localToWorld(v3.set(0.2, -0.2, -0.5 + (pressT > 0 ? 0.02 : 0))));
      R2.g.quaternion.copy(cam.quaternion).multiply(qTilt);
      R2.g.visible = true;
    }
  } catch (e) { BR.log('updateCamera: ' + e.message); }
  return r;
});
BR.keys.bind('V', () => {
  fpv = !fpv; cam.near = fpv ? 0.05 : 0.4; cam.updateProjectionMatrix();
  BR.toast(fpv ? 'Вид от 1-го лица' : 'Вид от 3-го лица');
});
BR.keys.bind('G', () => {
  holding = !holding;
  if (!holding) { remote.parent && remote.parent.remove(remote); ui.open = false; ui.cd = 0; }
  BR.toast(holding ? 'Пульт в руке: коснись экрана' : 'Пульт убран');
});

/* ===================== ВСПОМОГАТЕЛЬНОЕ ДЛЯ КАРТЫ ===================== */
function geo() {
  const n = v => typeof v === 'number' && isFinite(v) && v > 0;
  return { N: n(G.N) ? G.N : 20, CELL: n(G.CELL) ? G.CELL : 44, HALF: n(G.HALF) ? G.HALF : 264 };
}
function sector(x, z) {
  const g = geo();
  const i = clamp(Math.floor((x + g.HALF) / g.CELL), 0, g.N - 1), j = clamp(Math.floor((z + g.HALF) / g.CELL), 0, g.N - 1);
  return String.fromCharCode(65 + i % 26) + '-' + (j + 1);
}
function groundAt(x, z) {
  try {
    if (typeof G.groundH === 'function') { const y = G.groundH(x, z, 0); if (isFinite(y) && Math.abs(y) < 100) return y; }
  } catch (e) { /* без рельефа */ }
  return 0;
}
function allCars() {
  const set = new Set();
  for (const v of (BR.vehicles || [])) if (v) set.add(v);
  for (const v of (BR.npcs || [])) if (v) set.add(v);
  return set;
}

/* ===================== 3D-ПАНЕЛЬ С КАРТОЙ ===================== */
const PW = 1024, PH = 640, WW = 5.2, WH = WW * PH / PW;
const MX = 40, MY = 96, MS = 500, SC = MS / (2 * BOUND);
const mx = x => (BOUND - x) * SC, my = z => (BOUND - z) * SC;     // вверх на карте = +Z, влево = +X

const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH;
const ctx = cv.getContext('2d');
const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
const pmat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
const panel = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), pmat);
panel.visible = false; panel.renderOrder = 999; panel.frustumCulled = false; ns(panel); BR.scene.add(panel);

const mapCv = document.createElement('canvas'); mapCv.width = mapCv.height = MS;
const mctx = mapCv.getContext('2d');

const ui = { open: false, appear: 0, cd: 0, lastN: 0, target: null, acc: 1, flashId: null, flashT: 0 };
const anchor = new THREE.Vector3();
const btns = [];

function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// слой карты (статичный): реальные коллайдеры мира, карта совпадает с игрой
function buildMapLayer() {
  const c = mctx; c.clearRect(0, 0, MS, MS);
  const g = c.createLinearGradient(0, 0, MS, MS); g.addColorStop(0, '#0c1830'); g.addColorStop(1, '#07101f');
  c.fillStyle = g; c.fillRect(0, 0, MS, MS);
  c.strokeStyle = 'rgba(90,170,255,.12)'; c.lineWidth = 1;
  const step = G.CELL || 44;
  for (let v = -BOUND; v <= BOUND; v += step) {
    c.beginPath(); c.moveTo(mx(v), 0); c.lineTo(mx(v), MS); c.moveTo(0, my(v)); c.lineTo(MS, my(v)); c.stroke();
  }
  const seen = new Set(), grid = G.grid || [];
  for (const col of grid) {
    if (!col) continue;
    for (const cell of col) {
      if (!cell) continue;
      for (const b of cell) {
        if (!b || seen.has(b) || b.maxX == null) continue;
        seen.add(b);
        const w = (b.maxX - b.minX) * SC, h = (b.maxZ - b.minZ) * SC, top = b.top || 5;
        c.fillStyle = b.nr ? 'rgba(255,200,61,.75)' : 'rgba(110,190,255,' + (0.28 + Math.min(top / 50, 0.5)).toFixed(2) + ')';
        c.fillRect(mx(b.maxX), my(b.maxZ), Math.max(w, 1), Math.max(h, 1));
        if (!b.nr && w > 4) { c.strokeStyle = 'rgba(170,225,255,.35)'; c.lineWidth = 1; c.strokeRect(mx(b.maxX) + .5, my(b.maxZ) + .5, w, h); }
      }
    }
  }
  for (const r of (G.ramps || [])) {
    const px = -r.uz, pz = r.ux, hw = r.W / 2;
    const pts = [[r.x + px * hw, r.z + pz * hw], [r.x - px * hw, r.z - pz * hw],
      [r.x - px * hw + r.ux * r.L, r.z - pz * hw + r.uz * r.L], [r.x + px * hw + r.ux * r.L, r.z + pz * hw + r.uz * r.L]];
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(mx(p[0]), my(p[1])) : c.moveTo(mx(p[0]), my(p[1])));
    c.closePath(); c.fillStyle = 'rgba(255,200,61,.85)'; c.fill();
  }
  c.strokeStyle = 'rgba(95,225,255,.8)'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, MS - 3, MS - 3);
}

function button(id, x, y, w, h, label, kind, pulse) {
  btns.push({ id, x, y, w, h });
  let c0 = 'rgba(255,255,255,.16)', c1 = 'rgba(255,255,255,.08)', tc = '#fff';
  if (kind === 'danger') { c0 = '#ff5a3c'; c1 = '#c1121f'; }
  else if (kind === 'off') { c0 = 'rgba(255,255,255,.10)'; c1 = 'rgba(255,255,255,.05)'; tc = 'rgba(255,255,255,.35)'; }
  ctx.save();
  if (kind === 'danger') { ctx.shadowColor = 'rgba(255,70,40,' + (0.5 + 0.4 * pulse).toFixed(2) + ')'; ctx.shadowBlur = 26; }
  rr(ctx, x, y, w, h, 20);
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0;
  if (ui.flashId === id) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); }
  ctx.strokeStyle = kind === 'danger' ? 'rgba(255,205,185,.7)' : 'rgba(255,255,255,.22)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = tc; ctx.font = 'bold ' + (h > 80 ? 40 : 28) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 2);
  ctx.restore();
}

function drawPanel() {
  const c = ctx, t = time, f = me.inCar ? BR.player : me;
  btns.length = 0; c.clearRect(0, 0, PW, PH);
  rr(c, 8, 8, PW - 16, PH - 16, 36);
  const bg = c.createLinearGradient(0, 0, 0, PH); bg.addColorStop(0, 'rgba(12,20,40,.94)'); bg.addColorStop(1, 'rgba(6,10,22,.94)');
  c.fillStyle = bg; c.fill();
  c.save(); c.lineWidth = 3; c.strokeStyle = 'rgba(110,200,255,.6)'; c.shadowColor = 'rgba(80,180,255,.9)'; c.shadowBlur = 18; c.stroke(); c.restore();

  c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillStyle = '#8fdcff'; c.font = 'bold 30px sans-serif'; c.fillText('ТАКТИЧЕСКАЯ КАРТА', 44, 54);
  c.fillStyle = 'rgba(94,224,160,' + (0.5 + 0.5 * Math.sin(t * 4)).toFixed(2) + ')'; c.beginPath(); c.arc(372, 54, 6, 0, 6.283); c.fill();
  c.fillStyle = 'rgba(255,255,255,.4)'; c.font = '600 18px sans-serif'; c.textAlign = 'right'; c.fillText('СПУТНИКОВЫЙ КАНАЛ', PW - 44, 54);

  // карта
  c.save(); rr(c, MX, MY, MS, MS, 18); c.clip();
  c.drawImage(mapCv, MX, MY);
  c.fillStyle = 'rgba(255,255,255,.6)';
  let cnt = 0;
  for (const v of allCars()) {
    if (v === BR.player || v.parked || v.x == null || v.x > 9000 || !isFinite(v.x)) continue;
    c.fillRect(MX + mx(v.x) - 1.5, MY + my(v.z) - 1.5, 3, 3);
    if (++cnt > 220) break;
  }
  c.fillStyle = 'rgba(120,220,255,.10)'; c.fillRect(MX, MY + ((t * 80) % MS), MS, 3);
  c.font = '600 14px sans-serif'; c.textAlign = 'center'; c.fillStyle = 'rgba(255,200,61,.9)';
  c.fillText('ГАРАЖ', MX + mx(22), MY + my(22) - 8);
  c.fillRect(MX + mx(22) - 3, MY + my(22) - 3, 6, 6);
  const tg = ui.target;
  if (tg) {
    const tx = MX + mx(tg.x), ty = MY + my(tg.z), pl = 0.5 + 0.5 * Math.sin(t * 5);
    // ударная волна
    c.fillStyle = 'rgba(255,154,48,.06)'; c.beginPath(); c.arc(tx, ty, WAVE * SC, 0, 6.283); c.fill();
    c.setLineDash([8, 6]); c.strokeStyle = 'rgba(255,154,48,.9)'; c.lineWidth = 2; c.beginPath(); c.arc(tx, ty, WAVE * SC, 0, 6.283); c.stroke();
    c.strokeStyle = 'rgba(255,110,40,.45)'; c.beginPath(); c.arc(tx, ty, WAVE * 0.5 * SC, 0, 6.283); c.stroke(); c.setLineDash([]);
    // зона разрушения
    c.fillStyle = 'rgba(255,50,30,' + (0.18 + 0.10 * pl).toFixed(2) + ')'; c.beginPath(); c.arc(tx, ty, CORE * SC, 0, 6.283); c.fill();
    c.strokeStyle = 'rgba(255,90,60,.95)'; c.lineWidth = 2; c.beginPath(); c.arc(tx, ty, CORE * SC, 0, 6.283); c.stroke();
    c.strokeStyle = '#ff3b2a'; c.lineWidth = 3; c.beginPath(); c.arc(tx, ty, 9 + 5 * pl, 0, 6.283); c.stroke();
    c.beginPath(); c.moveTo(tx - 22, ty); c.lineTo(tx - 6, ty); c.moveTo(tx + 6, ty); c.lineTo(tx + 22, ty);
    c.moveTo(tx, ty - 22); c.lineTo(tx, ty - 6); c.moveTo(tx, ty + 6); c.lineTo(tx, ty + 22); c.stroke();
  }
  // игрок: стрелка по направлению взгляда
  const px = MX + mx(f.x), py = MY + my(f.z), yaw = me.camYaw || 0, dx = -Math.sin(yaw), dy = -Math.cos(yaw);
  c.fillStyle = '#5ee0a0'; c.strokeStyle = '#07101f'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(px + dx * 13, py + dy * 13); c.lineTo(px - dx * 8 - dy * 8, py - dy * 8 + dx * 8); c.lineTo(px - dx * 8 + dy * 8, py - dy * 8 - dx * 8); c.closePath(); c.fill(); c.stroke();
  c.restore();
  c.lineWidth = 2; c.strokeStyle = 'rgba(95,225,255,.55)'; rr(c, MX, MY, MS, MS, 18); c.stroke();

  // правая колонка
  const X0 = 584, W0 = 400;
  c.textAlign = 'left'; c.fillStyle = 'rgba(255,255,255,.5)'; c.font = '600 20px sans-serif'; c.fillText('ЦЕЛЬ', X0, 120);
  const busy = nuke.on;
  if (tg) {
    c.fillStyle = '#fff'; c.font = 'bold 34px sans-serif'; c.fillText('X ' + Math.round(tg.x) + '   Z ' + Math.round(tg.z), X0, 160);
    const d = Math.round(Math.hypot(f.x - tg.x, f.z - tg.z));
    c.fillStyle = 'rgba(255,255,255,.75)'; c.font = '600 21px sans-serif'; c.fillText('Сектор ' + sector(tg.x, tg.z) + ' · ' + d + ' м от вас', X0, 198);
    if (d < CORE + 20) {
      const a = 0.65 + 0.35 * Math.sin(t * 8);
      c.fillStyle = 'rgba(255,70,50,' + a.toFixed(2) + ')'; c.font = 'bold 21px sans-serif'; c.fillText('! ВЫ В ЗОНЕ РАЗРУШЕНИЯ', X0, 238);
    } else if (d < WAVE) {
      const a = 0.7 + 0.3 * Math.sin(t * 6);
      c.fillStyle = 'rgba(255,154,48,' + a.toFixed(2) + ')'; c.font = 'bold 21px sans-serif'; c.fillText('! ВЫ В ЗОНЕ УДАРНОЙ ВОЛНЫ', X0, 238);
    } else { c.fillStyle = 'rgba(94,224,160,.85)'; c.font = '600 21px sans-serif'; c.fillText('Безопасная дистанция', X0, 238); }
  } else {
    c.fillStyle = '#ffc83d'; c.font = 'bold 28px sans-serif'; c.fillText('Не выбрана', X0, 160);
    c.fillStyle = 'rgba(255,255,255,.6)'; c.font = '600 22px sans-serif'; c.fillText('Коснись карты, чтобы выбрать', X0, 200);
  }
  c.fillStyle = 'rgba(255,255,255,.4)'; c.font = '600 18px sans-serif';
  c.fillText('Разрушение: ' + CORE + ' м · волна: ' + WAVE + ' м', X0, 290);
  c.fillText('Зелёная стрелка: ты', X0, 320);

  if (ui.cd > 0) button('launch', X0, 364, W0, 96, 'ПУСК ЧЕРЕЗ ' + Math.ceil(ui.cd), 'danger', 1);
  else if (tg && !busy) button('launch', X0, 364, W0, 96, 'ЗАПУСК', 'danger', 0.5 + 0.5 * Math.sin(t * 5));
  else button('launch', X0, 364, W0, 96, busy ? 'БОМБА В ПУТИ' : 'ЗАПУСК', 'off', 0);
  button('close', X0, 480, W0, 64, ui.cd > 0 ? 'ОТМЕНА' : 'ЗАКРЫТЬ', 'normal', 0);
  c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.3)'; c.font = '600 17px sans-serif';
  c.fillText('Отойди от панели: она исчезнет', X0 + W0 / 2, 584);
  tex.needsUpdate = true;
}

function openPanel() {
  if (!holding || me.inCar || BR.state.mode !== 'play') return;
  const y = me.camYaw || 0, d = fpv ? 2.6 : 3.2;
  anchor.set(me.x + Math.sin(y) * d, me.y + (fpv ? 1.75 : 2.1), me.z + Math.cos(y) * d);
  buildMapLayer(); ui.open = true; ui.cd = 0; ui.acc = 1; pressT = 0.2; beep(520, .08, .08);
}

function panelPress(px, py) {
  for (const b of btns) {
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
      ui.flashId = b.id; ui.flashT = 0.18; pressT = 0.15;
      if (b.id === 'launch') {
        if (ui.target && ui.cd <= 0 && !nuke.on) { ui.cd = 3; ui.lastN = 4; }
      } else if (b.id === 'close') {
        if (ui.cd > 0) ui.cd = 0; else ui.open = false;
      }
      return;
    }
  }
  if (px >= MX && px <= MX + MS && py >= MY && py <= MY + MS && ui.cd <= 0) {
    ui.target = { x: clamp(BOUND - (px - MX) / SC, -BOUND + 8, BOUND - 8), z: clamp(BOUND - (py - MY) / SC, -BOUND + 8, BOUND - 8) };
    placeMarker();
    beep(900, .05, .06);
  }
}

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitPanel(e) {
  if (ui.appear < 0.5) return null;
  const r = G.renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  panel.updateMatrixWorld(); cam.updateMatrixWorld();
  ray.setFromCamera(ndc, cam);
  return ray.intersectObject(panel, false)[0] || null;
}
let down = null;
window.addEventListener('pointerdown', safe(e => {
  if (BR.state.mode !== 'play' || e.target !== G.renderer.domElement) return;
  const h = hitPanel(e);
  if (h) { e.stopImmediatePropagation(); e.preventDefault(); down = null; panelPress(h.uv.x * PW, (1 - h.uv.y) * PH); return; }
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
}), true);
window.addEventListener('pointerup', safe(e => {
  const d = down; down = null;
  if (!d || d.id !== e.pointerId) return;
  if (BR.state.mode !== 'play' || e.target !== G.renderer.domElement) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14 || performance.now() - d.t > 380) return;   // это был тап, а не поворот камеры
  if (!ui.open) openPanel();
}), true);

function panelTick(dt, play) {
  if (ui.open) {
    const far = Math.hypot(me.x - anchor.x, me.z - anchor.z) > 7;
    if (!play || me.inCar || !holding || far) { ui.open = false; ui.cd = 0; }
  }
  if (ui.flashT > 0) { ui.flashT -= dt; if (ui.flashT <= 0) ui.flashId = null; }
  if (ui.open && ui.cd > 0) {
    ui.cd -= dt;
    const n = Math.ceil(Math.max(0, ui.cd));
    if (n !== ui.lastN) { ui.lastN = n; if (n > 0) beep(700 + (3 - n) * 160, .16, .12); }
    if (ui.cd <= 0) {
      ui.cd = 0; const t = ui.target; ui.open = false;
      if (t) { ui.target = null; marker.visible = false; launchNuke(t.x, t.z); }
    }
  }
  const goal = ui.open ? 1 : 0;
  ui.appear += (goal - ui.appear) * Math.min(1, dt * 9);
  if (Math.abs(goal - ui.appear) < 0.003) ui.appear = goal;
  const a = ui.appear, e = a * a * (3 - 2 * a);
  panel.visible = a > 0.01;
  if (!panel.visible) return;
  pmat.opacity = a;
  const s = (fpv ? 0.5 : 1) * (0.72 + 0.28 * e);
  panel.scale.setScalar(s);
  panel.position.set(anchor.x, anchor.y + Math.sin(time * 1.4) * 0.04 * s - (1 - e) * 0.4, anchor.z);
  panel.lookAt(cam.position.x, panel.position.y, cam.position.z);
  ui.acc += dt;
  if (ui.acc > 0.055) { ui.acc = 0; drawPanel(); }
}

/* ===================== ЯДЕРНАЯ БОМБА И ВЗРЫВ ===================== */
const nuke = { on: false };
const fx = [];                                            // активные эффекты {u(dt)->bool, d()}
const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const C0 = new THREE.Color(0xff8a2a), C1 = new THREE.Color(0x57504a), C2 = new THREE.Color(0x70675e);
let shakeT = 0, shakeDur = 1, shakeAmp = 0;

const root = new THREE.Group(); root.userData.noSync = true; BR.scene.add(root);
const addFx = o => { ns(o); root.add(o); return o; };
function disp(o) {
  o.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(x => x.dispose());
  });
}

// 3D-метка цели в мире: видно, куда упадёт
const marker = new THREE.Group(); marker.visible = false; addFx(marker);
const mm = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
const mr1 = new THREE.Mesh(new THREE.RingGeometry(9, 11, 48), mm(0xff2a2a, .9));
const mr2 = new THREE.Mesh(new THREE.RingGeometry(3, 4, 32), mm(0xff2a2a, .9));
const mr3 = new THREE.Mesh(new THREE.RingGeometry(CORE - 1.2, CORE, 72), mm(0xff9a30, .55));
const beam = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 160, 8), mm(0xff3030, .45));
[mr1, mr2, mr3].forEach(r => { r.rotation.x = -Math.PI / 2; });
beam.position.y = 80;
marker.add(mr1, mr2, mr3, beam);
marker.traverse(o => { o.renderOrder = 998; });
function placeMarker() {
  const t = ui.target; if (!t) return;
  marker.position.set(t.x, groundAt(t.x, t.z) + 0.5, t.z); marker.visible = true;
}

// белая вспышка на весь экран
const flashEl = document.createElement('div');
flashEl.style.cssText = 'position:fixed;inset:0;z-index:15;pointer-events:none;background:radial-gradient(circle,#fff,#ffe9b5);opacity:0;display:none';
document.body.appendChild(flashEl);

function makeBomb() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x55604a, metalness: .5, roughness: .5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 9, 16), steel);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4, 16), steel); nose.rotation.x = Math.PI; nose.position.y = -6.5;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 1.1, 16), new THREE.MeshStandardMaterial({ color: 0xffd23a }));
  band.position.y = 1;
  g.add(body, nose, band);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(.2, 3, 2.2), steel);
    const a = i * Math.PI / 2;
    fin.position.set(Math.cos(a) * 2.1, 3.6, Math.sin(a) * 2.1); fin.rotation.y = -a;
    g.add(fin);
  }
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(.3, 2, 60, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  trail.position.y = 35; g.add(trail);
  g.scale.setScalar(2);
  return g;
}

function startNuke(x, z) {
  if (nuke.on || !isFinite(x) || !isFinite(z)) return;
  x = clamp(x, -BOUND, BOUND); z = clamp(z, -BOUND, BOUND);
  const gy = groundAt(x, z), tgt = new THREE.Vector3(x, gy, z);
  const f = me.inCar ? BR.player : me;
  nuke.on = true;
  const bomb = makeBomb(); addFx(bomb);
  let y = 520, v = 25;
  bomb.position.set(x, gy + y, z);
  whistle(3.5, clamp(1.2 - Math.hypot(f.x - x, f.z - z) / 700, 0.3, 1));
  BR.toast('Пуск! Бомба в пути');
  fx.push({
    u(dt) {
      v += 70 * dt; y -= v * dt;
      if (y <= 0) { boom(tgt); return false; }
      bomb.position.y = gy + y; return true;
    },
    d() { root.remove(bomb); disp(bomb); nuke.on = false; }
  });
}
function launchNuke(x, z) {
  if (G.net && G.net.role) BR.net.emit('nuke:go', { x, z }); else startNuke(x, z);
}
BR.net.on('nuke:go', safe(d => { if (d) startNuke(+d.x, +d.z); }));

/* ---------- физика ударной волны ---------- */
function blastVehicle(v, p, radius) {
  const kickBody = G.kickBody, crashFx = G.crashFx;
  if (!v || v.remote || v.parked || v.x > 9000 || !v.obj || typeof kickBody !== 'function') return false;
  const dx = v.x - p.x, dz = v.z - p.z, dist = Math.hypot(dx, dz);
  if (dist > radius) return false;
  let dirX, dirZ;
  if (dist > .001) { dirX = dx / dist; dirZ = dz / dist; } else { dirX = Math.sin(v.h || 0); dirZ = Math.cos(v.h || 0); }
  const sh = Math.sin(v.h || 0), ch = Math.cos(v.h || 0);
  const localX = dirX * ch - dirZ * sh, localZ = dirX * sh + dirZ * ch;
  const falloff = Math.pow(Math.max(0, 1 - dist / radius), 1.15);
  const mass = Math.max(.7, Number(v.mass) || 1.3);
  const horizontal = clamp((24 + 30 * falloff) / Math.sqrt(mass), 10, 52);
  const lift = clamp((5 + 11 * falloff) / Math.pow(mass, .18), 4, 16);
  try {
    kickBody(v, localX * 9, localZ * 9);
    v.far = false;
    v.vx += dirX * horizontal; v.vz += dirZ * horizontal;
    v.vy = Math.max(0, Number(v.vy) || 0) + lift;
    v.over = false; v.settle = 0; v.tipT = 0;
    if (DAMAGE_CARS && typeof crashFx === 'function') {
      crashFx(v, 6 + 10 * falloff, -localX * .7, -localZ * .7, -localX, -localZ, 'body');
      if (v._freeContactPoints) delete v._freeContactPoints;
    }
    return true;
  } catch (e) { BR.log('nuke vehicle: ' + e.message); return false; }
}
function blastPlayer(p, radius) {
  const hitAvatar = G.hitAvatar;
  if (!me || me.inCar || me.fly || me.lie > 0 || typeof hitAvatar !== 'function') return false;
  const dx = me.x - p.x, dz = me.z - p.z, dist = Math.hypot(dx, dz);
  if (dist > radius) return false;
  const dirX = dist > .001 ? dx / dist : Math.sin(me.h || 0), dirZ = dist > .001 ? dz / dist : Math.cos(me.h || 0);
  const falloff = Math.pow(Math.max(0, 1 - dist / radius), .8);
  try {
    hitAvatar(me, { vx: dirX * (14 + 46 * falloff), vz: dirZ * (14 + 46 * falloff) }, dirX, dirZ, 18 + 42 * falloff);
    return true;
  } catch (e) { BR.log('nuke ragdoll: ' + e.message); return false; }
}
// Фронт волны растёт синхронно с визуальным кольцом; каждый получает импульс один раз, когда фронт до него дошёл.
function scheduleBlastWave(p) {
  let t = 0, carHits = 0, playerHit = false, toldP = false, toldC = false;
  const hit = new Set();
  fx.push({
    u(dt) {
      t += dt;
      const wr = WAVE * clamp(t / WAVE_T, 0, 1), authority = isHostOrSolo();
      for (const v of allCars()) {
        if (hit.has(v)) continue;
        if (!authority && v !== BR.player) continue;      // чужие/NPC машины двигает хост
        if (Math.hypot(v.x - p.x, v.z - p.z) > wr) continue;
        hit.add(v);
        if (blastVehicle(v, p, WAVE)) carHits++;
      }
      if (!playerHit && !me.inCar && !me.fly && !(me.lie > 0) && Math.hypot(me.x - p.x, me.z - p.z) <= wr) playerHit = blastPlayer(p, WAVE);
      if (playerHit && !toldP) { toldP = true; BR.toast('Ударная волна подхватила персонажа!'); }
      if (t >= WAVE_T && carHits && !toldC) { toldC = true; BR.toast('Волна отбросила машин: ' + carHits); }
      return t < WAVE_T;
    },
    d() {}
  });
}

/* ---------- сам взрыв ---------- */
function boom(p) {
  const f = me.inCar ? BR.player : me, dist = Math.hypot(f.x - p.x, f.z - p.z);
  boomSound(clamp(1.1 - dist / 800, 0.25, 1));
  const cd = cam.position.distanceTo(p);
  shakeAmp = clamp(30 * 400 / (cd + 200), 4, 30); shakeDur = shakeT = 5;
  if (isHostOrSolo()) BR.world.explode(p.x, p.y + 1.5, p.z, { radius: CORE, force: 100, up: 1.6 });
  scheduleBlastWave(p);

  const parts = [];
  const add = (geo, color, op, extra) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial(Object.assign({ color, transparent: true, opacity: op, depthWrite: false, fog: false }, extra || {})));
    m.frustumCulled = false; addFx(m); parts.push(m); return m;
  };
  const fb = add(new THREE.SphereGeometry(1, 24, 16), 0xffb040, 1, { blending: THREE.AdditiveBlending });
  const dome = add(new THREE.SphereGeometry(1, 32, 16), 0xffffff, .3, { blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = add(new THREE.RingGeometry(.94, 1, 64), 0xfff2cc, .8, { blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  ring.rotation.x = -Math.PI / 2;
  const dust = add(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), 0x8a7b6a, .55, { side: THREE.DoubleSide });
  const stem = add(new THREE.CylinderGeometry(1, 1.5, 1, 20), 0xff8a2a, .92);
  const cap = add(new THREE.SphereGeometry(1, 28, 18), 0xff8a2a, .92);
  const skirt = add(new THREE.TorusGeometry(1, .3, 12, 40), 0xff8a2a, .85);
  skirt.rotation.x = Math.PI / 2;

  // разлетающиеся обломки
  const dg = new THREE.BoxGeometry(1, 1, 1);
  const dm = [new THREE.MeshBasicMaterial({ color: 0x2a2623, fog: false }), new THREE.MeshBasicMaterial({ color: 0xff7a1e, fog: false })];
  const deb = [];
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(dg, dm[i % 2]); m.scale.setScalar(.6 + Math.random() * 2);
    m.position.copy(p); addFx(m);
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 90;
    deb.push({ m, on: true, r: Math.random() * 8, v: new THREE.Vector3(Math.cos(a) * sp, 60 + Math.random() * 140, Math.sin(a) * sp) });
  }

  // выжженное пятно
  const sc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({
    color: 0x050505, transparent: true, opacity: .7, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }));
  sc.rotation.x = -Math.PI / 2; sc.position.set(p.x, p.y + .25, p.z); sc.scale.setScalar(58); addFx(sc);
  let st = 0;
  fx.push({
    u(dt) { st += dt; sc.material.opacity = .7 * clamp(1 - (st - 45) / 20, 0, 1) * Math.min(1, st / 1.5); return st < 65; },
    d() { root.remove(sc); sc.geometry.dispose(); sc.material.dispose(); }
  });

  let t = 0, ex2 = false;
  fx.push({
    u(dt) {
      t += dt;
      const m = t > 14 ? Math.max(0, 1 - (t - 14) / 6) : 1;
      const e7 = ease(t / 7);
      const fr = Math.max(55 * ease(t / 1.2), .01);
      fb.scale.setScalar(fr); fb.position.set(p.x, p.y + fr * .5, p.z); fb.material.opacity = clamp(1 - t / 3, 0, 1); fb.visible = t < 3;
      const sw = clamp(t / WAVE_T, 0, 1), R = Math.max(WAVE * sw, .01);
      dome.scale.setScalar(R); dome.position.copy(p); dome.material.opacity = .3 * (1 - sw); dome.visible = sw < 1;
      ring.scale.setScalar(R); ring.position.set(p.x, p.y + .4, p.z); ring.material.opacity = .8 * (1 - sw); ring.visible = sw < 1;
      const dk = clamp(t / 4.5, 0, 1), dr = Math.max(320 * ease(dk), .01);
      dust.scale.set(dr, 34, dr); dust.position.set(p.x, p.y + 14, p.z); dust.material.opacity = .55 * (1 - dk) * m;
      const h = Math.max(200 * e7, .01), sr = 13 + 3 * e7, ce = .3 + .7 * e7;
      stem.scale.set(sr, h, sr); stem.position.set(p.x, p.y + h / 2, p.z);
      cap.scale.set(52 * ce, 33 * ce, 52 * ce); cap.position.set(p.x, p.y + h + 10, p.z);
      skirt.scale.setScalar(46 * ce); skirt.position.set(p.x, p.y + h + 2, p.z);
      const k = clamp(t / 6, 0, 1);
      stem.material.color.copy(C0).lerp(C1, k); cap.material.color.copy(C0).lerp(C2, k * .9); skirt.material.color.copy(C0).lerp(C2, k);
      stem.material.opacity = .92 * m; cap.material.opacity = .92 * m; skirt.material.opacity = .85 * m;
      for (const d of deb) {
        if (d.on) {
          d.v.y -= 60 * dt; d.m.position.addScaledVector(d.v, dt);
          d.m.rotation.x += d.r * dt; d.m.rotation.z += d.r * dt;
          if (d.m.position.y <= p.y) { d.m.position.y = p.y; d.on = false; }
        }
        d.m.visible = m > .3;
      }
      // добивающая волна разрушения мира
      if (t > 0.45 && !ex2) { ex2 = true; if (isHostOrSolo()) BR.world.explode(p.x, p.y + 1.5, p.z, { radius: 150, force: 55, up: 0.5 }); }
      // столб дыма из движка игры
      if (t < 2.5) {
        try {
          const a = Math.random() * 6.283, r = Math.random() * 35;
          G.spawnSmoke(p.x + Math.cos(a) * r, 1, p.z + Math.sin(a) * r, Math.cos(a) * 8, 10 + Math.random() * 10, Math.sin(a) * 8, 4, 4, 16, 0.6, 1);
        } catch (e) { /* необязательно */ }
      }
      // белая вспышка
      const kf = clamp(1.3 - dist / 900, 0.35, 1), fa = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.12) / 3), op = kf * fa;
      flashEl.style.display = op > 0.004 ? 'block' : 'none'; flashEl.style.opacity = op.toFixed(3);
      return t < 20;
    },
    d() {
      flashEl.style.display = 'none'; flashEl.style.opacity = '0';
      parts.forEach(x => { root.remove(x); x.geometry.dispose(); x.material.dispose(); });
      deb.forEach(d => root.remove(d.m)); dg.dispose(); dm.forEach(x => x.dispose());
    }
  });
}

/* ===================== ГЛАВНЫЙ ЦИКЛ ===================== */
BR.on('tick', safe(dt0 => {
  const dt = Math.min(dt0 || .016, .05);
  time += dt; pressT = Math.max(0, pressT - dt);
  const play = BR.state.mode === 'play';
  if ((!play || !holding || me.inCar || fpv) && remote.parent) remote.parent.remove(remote);
  try { animRemote(R1); animRemote(R2); } catch (e) { /* модель могла быть пересоздана */ }
  try { panelTick(dt, play); } catch (e) { BR.log('panel: ' + e.message); }

  if (marker.visible) {
    mr1.scale.setScalar(1 + .08 * Math.sin(time * 6)); mr2.rotation.z = time * 2; beam.material.opacity = .3 + .2 * Math.sin(time * 5);
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    let alive = false;
    try { alive = fx[i].u(dt); } catch (e) { BR.log('fx: ' + e.message); }
    if (!alive) { try { fx[i].d(); } catch (e) { BR.log('fx end: ' + e.message); } fx.splice(i, 1); }
  }
  if (shakeT > 0) {
    shakeT -= dt;
    const el = G.renderer.domElement;
    if (shakeT > 0) {
      const a = shakeAmp * Math.pow(shakeT / shakeDur, 2);
      el.style.transform = 'translate(' + (Math.random() - .5) * 2 * a + 'px,' + (Math.random() - .5) * 2 * a + 'px) scale(1.04)';
    } else el.style.transform = '';
  }
}));

BR.on('start', safe(() => { BR.toast('Пульт в руке: коснись экрана (G убрать, V вид)'); }));
BR.log('Ядерный пульт (гибрид) загружен');
