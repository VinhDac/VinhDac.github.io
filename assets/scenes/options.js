// THE PRICER, SMALL ENOUGH TO RUN HERE. A European call priced by Monte Carlo
// in this browser, beside the Black-Scholes price. The paths on show are a few
// of the many: every frame draws thousands of terminal prices (exact for
// geometric Brownian motion), and the estimate and its 95% interval are the
// running mean of their discounted payoffs. Antithetic variates use each draw
// twice, once mirrored, and the interval shrinks faster for it.
// Up the screen is log price, so the paths are drawn true to their scale.

import { C, GL, tag, place, frame, center, aim, damp } from './kit.js';

const S0 = 100, RATE = 0.04, T = 1;
const STEPS = 48;
const X0 = -5, X1 = 5;                       // today .. in a year
const LOG_SCALE = 5.5;
const yOf = (p) => Math.log(p / S0) * LOG_SCALE;
const LO = Math.log(40), HI = Math.log(240), BINS = 64;
const HIST_X = 5.35, HIST_LEN = 3.0;
const CAP = 40e6;                            // paths, then it rests

function ncdf(x) {
  // Abramowitz and Stegun 26.2.17: absolute error under 7.5e-8
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}
export function blackScholesCall(S, K, r, sig, t) {
  const sq = sig * Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * t) / sq;
  return S * ncdf(d1) - K * Math.exp(-r * t) * ncdf(d1 - sq);
}
function normals(out) {
  for (let i = 0; i < out.length; i += 2) {
    const u = Math.max(Math.random(), 1e-12), w = 6.283185307179586 * Math.random();
    const rad = Math.sqrt(-2 * Math.log(u));
    out[i] = rad * Math.cos(w);
    if (i + 1 < out.length) out[i + 1] = rad * Math.sin(w);
  }
}

export default function create({ THREE, el, tier, labels }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
  const target = new THREE.Vector3(1.6, 0.1, 0);
  const $ = (id) => document.getElementById(id);
  const ui = {
    paths: $('mc-paths'), price: $('mc-price'), bs: $('mc-bs'), gap: $('mc-gap'),
    vol: $('mc-vol'), volV: $('mc-vol-v'), k: $('mc-k'), kV: $('mc-k-v'), anti: $('mc-anti'),
  };
  const panel = el.querySelector('.panel');
  let sig = +ui.vol.value / 100, K = +ui.k.value, anti = ui.anti.checked;

  // ------------------------------------------------ the paths on show
  const M = tier === 0 ? 40 : 90;
  const V = M * STEPS * 2;
  const pPos = new Float32Array(V * 3), pBirth = new Float32Array(V).fill(-1e6);
  const pFrac = new Float32Array(V), pPay = new Float32Array(V);
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pathGeo.setAttribute('aBirth', new THREE.BufferAttribute(pBirth, 1));
  pathGeo.setAttribute('aFrac', new THREE.BufferAttribute(pFrac, 1));
  pathGeo.setAttribute('aPay', new THREE.BufferAttribute(pPay, 1));
  const pathU = { uTime: { value: 0 }, uDraw: { value: 0.9 }, uLife: { value: 2.6 } };
  const paths = new THREE.LineSegments(pathGeo, new THREE.ShaderMaterial({
    uniforms: pathU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; attribute float aBirth; attribute float aFrac; attribute float aPay;
      varying float vFrac; varying float vAge; varying float vPay;
      void main() { vFrac = aFrac; vAge = uTime - aBirth; vPay = aPay;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uDraw; uniform float uLife; varying float vFrac; varying float vAge; varying float vPay;
      void main() {
        if (vAge < 0.0 || vFrac > vAge / uDraw) discard;
        float a = exp(-max(vAge - uDraw, 0.0) / uLife);
        float head = smoothstep(0.08, 0.0, vAge / uDraw - vFrac) * step(vAge, uDraw);
        vec3 c = mix(mix(${GL.cool}, ${GL.ink}, 0.25), ${GL.amber}, vPay);
        gl_FragColor = vec4(c, a * (mix(0.26, 0.55, vPay) + head * 0.5));
      }`,
  }));
  paths.frustumCulled = false;
  scene.add(paths);
  const finals = new Float32Array(M).fill(0);
  let slot = 0;
  const steps = new Float64Array(STEPS);

  function drawPath(sign, z, now) {
    const dt = T / STEPS, drift = (RATE - 0.5 * sig * sig) * dt, vol = sig * Math.sqrt(dt);
    let ln = 0, px = X0, py = 0;
    const base = slot * STEPS * 2;
    for (let j = 0; j < STEPS; j++) {
      ln += drift + vol * sign * steps[j];
      const nx = X0 + (X1 - X0) * (j + 1) / STEPS, ny = ln * LOG_SCALE;
      const a = (base + j * 2) * 3;
      pPos[a] = px; pPos[a + 1] = py; pPos[a + 2] = z;
      pPos[a + 3] = nx; pPos[a + 4] = ny; pPos[a + 5] = z;
      pFrac[base + j * 2] = j / STEPS; pFrac[base + j * 2 + 1] = (j + 1) / STEPS;
      px = nx; py = ny;
    }
    const final = S0 * Math.exp(ln);
    finals[slot] = final;
    const pay = final > K ? 1 : 0;
    for (let j = 0; j < STEPS * 2; j++) { pBirth[base + j] = now; pPay[base + j] = pay; }
    slot = (slot + 1) % M;
  }
  function recolour() {
    for (let s = 0; s < M; s++) {
      const pay = finals[s] > K ? 1 : 0;
      pPay.fill(pay, s * STEPS * 2, (s + 1) * STEPS * 2);
    }
    pathGeo.attributes.aPay.needsUpdate = true;
  }

  // ------------------------------------------------ prices at a year: the histogram
  const counts = new Float64Array(BINS);
  const shown = new Float32Array(BINS);
  const binH = (HI - LO) / BINS * LOG_SCALE;
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), BINS);
  bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const amber = new THREE.Color(C.amber), grey = new THREE.Color(0x5d6470);
  for (let i = 0; i < BINS; i++) bars.setColorAt(i, grey);
  scene.add(bars);
  const dummy = new THREE.Object3D();

  // ------------------------------------------------ the strike, a plane across the year
  const strikeU = { uTime: { value: 0 } };
  const strike = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 + HIST_LEN + 0.6, 3.6), new THREE.ShaderMaterial({
    uniforms: strikeU, transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { derivatives: true },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv;
      void main() {
        vec2 d = min(vUv, 1.0 - vUv) / fwidth(vUv);
        float edge = 1.0 - min(min(d.x, d.y) / 1.4, 1.0);
        gl_FragColor = vec4(${GL.amber}, 0.055 + edge * 0.7);
      }`,
  }));
  strike.rotation.x = -Math.PI / 2;
  scene.add(strike);
  let strikeY = yOf(K);
  strike.position.set((X0 + X1 + HIST_LEN + 0.6) / 2, strikeY, 0);

  // today's price, and the floor of the year
  const spot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: C.ink }));
  spot.position.set(X0, 0, 0);
  scene.add(spot);
  const floorY = yOf(42);
  const ticks = [X0, floorY, 0, X1, floorY, 0];
  for (let i = 0; i <= 4; i++) { const x = X0 + (X1 - X0) * i / 4; ticks.push(x, floorY, 0, x, floorY + 0.14, 0); }
  ticks.push(HIST_X, floorY, 0, HIST_X, yOf(240), 0);
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3)),
    new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.3 })));

  // ------------------------------------------------ the labels
  const tags = {
    spot: tag(labels, 'spot <b>100</b>'),
    strike: tag(labels, 'strike <b>100</b>'),
    today: tag(labels, 'today'),
    year: tag(labels, 'in a year'),
    pays: tag(labels, 'above the strike, it pays'),
  };

  // ------------------------------------------------ the estimate
  let sum = 0, sum2 = 0, n = 0, drawn = 0, bs = 0;
  const zbuf = new Float64Array([4000, 10000, 20000][tier]);   // draws a frame
  function reset(clearPaths) {
    sum = sum2 = n = drawn = 0;
    counts.fill(0);
    bs = blackScholesCall(S0, K, RATE, sig, T);
    if (clearPaths) { pBirth.fill(-1e6); pathGeo.attributes.aBirth.needsUpdate = true; }
    else recolour();
    for (let i = 0; i < BINS; i++) {
      const mid = Math.exp(LO + (i + 0.5) * (HI - LO) / BINS);
      bars.setColorAt(i, mid > K ? amber : grey);
    }
    bars.instanceColor.needsUpdate = true;
    tags.strike.innerHTML = `strike <b>${K}</b>`;
    tags.strike._w = 0;
    paint();
  }
  function simulate() {
    if (drawn >= CAP) return;
    normals(zbuf);
    const drift = (RATE - 0.5 * sig * sig) * T, vol = sig * Math.sqrt(T);
    const scale = BINS / (HI - LO), lnS0 = Math.log(S0);
    for (let i = 0; i < zbuf.length; i++) {
      const z = zbuf[i];
      const a = drift + vol * z;
      const sa = S0 * Math.exp(a);
      const pa = sa > K ? sa - K : 0;
      let y;
      let b = Math.floor((lnS0 + a - LO) * scale);
      if (b >= 0 && b < BINS) counts[b]++;
      if (anti) {
        const sb = S0 * Math.exp(2 * drift - a);
        const pb = sb > K ? sb - K : 0;
        y = 0.5 * (pa + pb);
        b = Math.floor((lnS0 + 2 * drift - a - LO) * scale);
        if (b >= 0 && b < BINS) counts[b]++;
        drawn += 2;
      } else {
        y = pa;
        drawn += 1;
      }
      sum += y; sum2 += y * y; n++;
    }
  }
  const fmt = (x, d = 3) => x.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  let paintClock = 0;
  function paint() {
    const disc = Math.exp(-RATE * T);
    ui.bs.textContent = fmt(bs);
    if (!n) { ui.paths.textContent = '0 paths'; ui.price.textContent = '-'; ui.gap.textContent = '-'; return; }
    const mean = sum / n, varr = Math.max(sum2 / n - mean * mean, 0);
    const price = disc * mean, half = 1.96 * disc * Math.sqrt(varr / n);
    ui.paths.textContent = `${drawn.toLocaleString('en-GB')} paths`;
    ui.price.textContent = `${fmt(price)} ± ${fmt(half)}`;
    ui.gap.textContent = fmt(Math.abs(price - bs));
  }

  ui.vol.addEventListener('input', () => { sig = +ui.vol.value / 100; ui.volV.textContent = `${ui.vol.value}%`; reset(true); });
  ui.k.addEventListener('input', () => { K = +ui.k.value; ui.kV.textContent = ui.k.value; reset(false); });
  ui.anti.addEventListener('change', () => { anti = ui.anti.checked; reset(true); });
  reset(true);

  let spawnClock = 0, running = false;
  let baseAz = -0.32, baseEl = 0.2, dist = 20;
  const BOUNDS = [];
  for (const x of [X0 - 0.3, HIST_X + HIST_LEN]) for (const y of [yOf(52), yOf(235)]) for (const z of [-1.6, 1.6]) BOUNDS.push(new THREE.Vector3(x, y, z));
  let W = 1, H = 1;
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  return {
    scene, camera,
    resize(w, h) {
      W = w; H = h;
      // On a phone the panel sits under the paths, and they are framed above it.
      // Beside it, they run corner to corner, from today low at the left to the
      // year's prices high at the right, clear of the panel at the top left.
      const sr = el.getBoundingClientRect(), pr = panel.getBoundingClientRect();
      const below = pr.top - sr.top > h * 0.35;
      const fh = below ? pr.top - sr.top - 6 : h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      baseAz = below ? -0.5 : -0.62;
      baseEl = below ? 0.3 : 0.42;
      const fr = frame(camera, target, aim(THREE, baseAz, baseEl), BOUNDS, 0.9, 0.84 * fh / h);
      dist = fr.dist;
      center(camera, w, h, fr, below ? 0 : w * 0.05, below ? fh / 2 - h / 2 : h * 0.04);
    },
    update(dt, t, input) {
      const px = input.inside ? input.x - 0.5 : 0, py = input.inside ? input.y - 0.5 : 0;
      dir.copy(aim(THREE, baseAz + px * 0.25 + Math.sin(t * 0.1) * 0.06, baseEl - py * 0.1));
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();

      if (input.seen > 0.2) running = true;
      if (!running) return;
      pathU.uTime.value += dt;
      strikeU.uTime.value += dt;
      simulate();

      // a new path, or a mirrored pair, every so often
      spawnClock += dt;
      if (spawnClock > (anti ? 0.2 : 0.11)) {
        spawnClock = 0;
        normals(steps);
        const z = (Math.random() - 0.5) * 3.0;
        drawPath(1, z, pathU.uTime.value);
        if (anti) drawPath(-1, z, pathU.uTime.value);
        pathGeo.attributes.position.needsUpdate = true;
        pathGeo.attributes.aBirth.needsUpdate = true;
        pathGeo.attributes.aFrac.needsUpdate = true;
        pathGeo.attributes.aPay.needsUpdate = true;
      }

      // the histogram grows toward the counts
      let most = 1;
      for (let i = 0; i < BINS; i++) most = Math.max(most, counts[i]);
      for (let i = 0; i < BINS; i++) {
        shown[i] = damp(shown[i], counts[i] / most, 5, dt);
        const len = Math.max(0.0001, shown[i] * HIST_LEN);
        dummy.position.set(HIST_X + len / 2, (LO + (i + 0.5) * (HI - LO) / BINS - Math.log(S0)) * LOG_SCALE, 0);
        dummy.scale.set(len, binH * 0.82, 0.8);
        dummy.updateMatrix();
        bars.setMatrixAt(i, dummy.matrix);
      }
      bars.instanceMatrix.needsUpdate = true;

      strikeY = damp(strikeY, yOf(K), 8, dt);
      strike.position.y = strikeY;

      paintClock += dt;
      if (paintClock > 0.2) { paintClock = 0; paint(); }

      const on = (el, p, dy = -10) => el.classList.toggle('on', place(el, p, camera, W, H, 0, dy));
      on(tags.spot, tmp.set(X0, 0.12, 0));
      on(tags.strike, tmp.set(HIST_X + HIST_LEN + 0.2, strikeY + 0.05, 1.8));
      on(tags.today, tmp.set(X0, floorY, 0), 30);
      on(tags.year, tmp.set(X1, floorY, 0), 30);
      on(tags.pays, tmp.set(HIST_X + 1.2, yOf(Math.max(K * 1.45, 130)), 0));
    },
  };
}
