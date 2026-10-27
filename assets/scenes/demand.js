// BRITAIN'S DEMAND, AS A LANDSCAPE. Each line is a day of half-hours, the
// newest in front and the days before it going back, on the real calendar (the
// weekends dip). The day in front is drawn as it happens: its day-ahead
// forecast was laid out before it began, and beside it the seasonal naive, the
// same day a week before. AN ILLUSTRATION of the data's shape, made up here;
// the figures beside it are the model's, measured on the real data.

import { C, GL, tag, place, frame, center, aim, ease, clamp01 } from './kit.js';

const HH = 48;
const X0 = -6, X1 = 6;
const DZ = 0.36;
const DAY_T = 4.6;
const SHIFT_T = 0.7;
const yOf = (gw) => (gw - 13) * 0.24;
const xOf = (j) => X0 + (X1 - X0) * j / (HH - 1);
const bell = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2);
const sig = (x) => 1 / (1 + Math.exp(-x));

function weather(d) {
  return 1.15 * Math.sin(d * 0.21 + 1.3) + 0.75 * Math.sin(d * 0.47 + 4.1)
    + 0.45 * Math.sin(d * 1.13 + 2.2) + 0.3 * Math.sin(d * 2.71 + 0.7);
}

// One day of half-hourly demand in GW, by a made-up rule with Britain's shape:
// a night trough, a morning ramp, an evening peak that grows in winter, a midday
// dip in summer where solar panels on roofs meet demand before the grid sees it.
function demand(d, out) {
  const date = new Date(d * 864e5);
  const doy = (date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 864e5;
  const weekend = (d + 3) % 7 >= 5;                  // 1 Jan 1970 was a Thursday
  const winter = 0.5 + 0.5 * Math.cos(2 * Math.PI * (doy - 15) / 365);
  const w = weather(d);
  for (let j = 0; j < HH; j++) {
    const hr = j / 2 + 0.25;
    let g = 22.6 + 7.4 * winter;
    g -= 6.2 * bell(hr, 4.4, 3.0);
    g += (weekend ? 1.0 : 2.6) * sig((hr - (weekend ? 8.6 : 7.0)) / 0.7) * (1 - sig((hr - 22.4) / 1.1));
    g += (1.4 + 4.0 * winter) * bell(hr, 17.7 + 0.9 * (1 - winter), 1.45);
    g -= 3.4 * (1 - winter) * bell(hr, 13.0, 2.6);
    if (weekend) g *= 0.9;
    out[j] = g + w;
  }
  return out;
}

export default function create({ THREE, tier, labels }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  const R = [30, 44, 56][tier];
  const target = new THREE.Vector3(0, 1.5, -R * DZ * 0.32);

  // the days on show, newest first, on the real calendar
  const today = Math.floor(Date.now() / 864e5);
  const days = Array.from({ length: R }, (_, i) => ({ d: today - 1 - i, v: demand(today - 1 - i, new Float32Array(HH)) }));

  // ------------------------------------------------ the ridges: a curtain under each line hides the days behind
  const curtainPos = new Float32Array(R * HH * 2 * 3);
  const idx = [];
  for (let r = 0; r < R; r++) {
    for (let j = 0; j < HH - 1; j++) {
      const a = (r * HH + j) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const curtainGeo = new THREE.BufferGeometry();
  curtainGeo.setAttribute('position', new THREE.BufferAttribute(curtainPos, 3));
  curtainGeo.setIndex(idx);
  const curtains = new THREE.Mesh(curtainGeo, new THREE.MeshBasicMaterial({
    color: C.bg, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  }));
  curtains.frustumCulled = false;
  scene.add(curtains);

  const linePos = new Float32Array(R * (HH - 1) * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const ridges = new THREE.LineSegments(lineGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `varying float vF;
      void main() { vF = clamp(-position.z / ${(R * DZ).toFixed(2)}, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vF;
      void main() {
        vec3 c = mix(${GL.ink}, ${GL.cool} * 0.85, smoothstep(0.0, 0.6, vF));
        gl_FragColor = vec4(c, mix(0.85, 0.07, pow(vF, 0.75)));
      }`,
  }));
  ridges.frustumCulled = false;
  scene.add(ridges);

  function layRows(shift) {
    for (let r = 0; r < R; r++) {
      const z = -(r + shift) * DZ, v = days[r].v;
      for (let j = 0; j < HH; j++) {
        const a = ((r * HH + j) * 2) * 3, x = xOf(j), y = yOf(v[j]);
        curtainPos[a] = x; curtainPos[a + 1] = y; curtainPos[a + 2] = z;
        curtainPos[a + 3] = x; curtainPos[a + 4] = 0; curtainPos[a + 5] = z;
        if (j < HH - 1) {
          const b = ((r * (HH - 1) + j) * 2) * 3;
          linePos[b] = x; linePos[b + 1] = y; linePos[b + 2] = z;
          linePos[b + 3] = xOf(j + 1); linePos[b + 4] = yOf(v[j + 1]); linePos[b + 5] = z;
        }
      }
    }
    curtainGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------ the day in front, as it happens
  const lineOf = (color, alpha, dash) => {
    const pos = new Float32Array(HH * 3), frac = new Float32Array(HH);
    for (let j = 0; j < HH; j++) frac[j] = j / (HH - 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aFrac', new THREE.BufferAttribute(frac, 1));
    const u = { uReveal: { value: 0 }, uAlpha: { value: alpha }, uDash: { value: dash ? 1 : 0 }, uColor: { value: new THREE.Color(color) } };
    const line = new THREE.Line(g, new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false,
      vertexShader: `attribute float aFrac; varying float vFrac;
        void main() { vFrac = aFrac; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uReveal; uniform float uAlpha; uniform float uDash; uniform vec3 uColor; varying float vFrac;
        void main() {
          if (vFrac > uReveal) discard;
          if (uDash > 0.5 && fract(vFrac * ${(HH - 1).toFixed(1)} / 1.5) > 0.5) discard;
          gl_FragColor = vec4(uColor, uAlpha);
        }`,
    }));
    line.frustumCulled = false;
    line.renderOrder = 2;
    scene.add(line);
    return { pos, u, line, v: new Float32Array(HH) };
  };
  const actual = lineOf(C.ink, 1.0, false);
  const forecast = lineOf(C.amber, 0.95, false);
  const naive = lineOf(C.cool, 0.85, true);
  const sweepPos = new Float32Array(6);
  const sweep = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sweepPos, 3)),
    new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.35, depthWrite: false }));
  sweep.frustumCulled = false;
  scene.add(sweep);

  function newDay() {
    const d = days[0].d + 1;
    demand(d, actual.v);
    demand(d - 7, naive.v);
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28;
    for (let j = 0; j < HH; j++) {
      forecast.v[j] = actual.v[j] * (1 + 0.042 * Math.sin(j * 0.21 + p1) + 0.018 * Math.sin(j * 0.63 + p2));
    }
    actual.d = d;
  }
  function layFront(z) {
    for (const L of [actual, forecast, naive]) {
      for (let j = 0; j < HH; j++) { L.pos[j * 3] = xOf(j); L.pos[j * 3 + 1] = yOf(L.v[j]); L.pos[j * 3 + 2] = z; }
      L.line.geometry.attributes.position.needsUpdate = true;
    }
  }
  newDay();

  // ------------------------------------------------ the labels
  const T = {
    actual: tag(labels, 'what happened'),
    forecast: tag(labels, 'forecast: <b>3.2%</b> typical miss'),
    naive: tag(labels, 'seasonal naive: <b>8.2%</b>'),
  };

  let dayT = 0;
  let baseAz = 0, baseEl = 0.3, dist = 20;
  const BOUNDS = [];
  // framed on the days as they are: the tallest of them sets the top
  let top = 0;
  for (const d of days) for (const g of d.v) top = Math.max(top, yOf(g));
  top += 0.4;
  for (const x of [X0, X1]) {
    BOUNDS.push(new THREE.Vector3(x, 0, DZ * 1.5), new THREE.Vector3(x, top, DZ * 1.5),
      new THREE.Vector3(x, 0, -(R - 1) * DZ), new THREE.Vector3(x, top, -(R - 1) * DZ));
  }
  let W = 1, H = 1, started = false;
  const dir = new THREE.Vector3();
  const v = new THREE.Vector3();
  const screenY = (p) => (-p.clone().project(camera).y * 0.5 + 0.5) * H;

  return {
    scene, camera,
    resize(w, h) {
      W = w; H = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      baseEl = w / h >= 1 ? 0.3 : 0.45;
      const fr = frame(camera, target, aim(THREE, baseAz, baseEl), BOUNDS, w / h >= 1 ? 0.8 : 0.9, 0.8);
      dist = fr.dist;
      center(camera, w, h, fr, w / h >= 1 ? -w * 0.03 : 0, -h * 0.02);
    },
    update(dt, t, input) {
      const px = input.inside ? input.x - 0.5 : 0, py = input.inside ? input.y - 0.5 : 0;
      dir.copy(aim(THREE, baseAz + px * 0.35 + Math.sin(t * 0.08) * 0.12, baseEl - py * 0.12));
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();

      if (input.seen > 0.25) started = true;
      if (started) dayT += dt;
      if (dayT >= DAY_T) {
        // the day is over: it joins the others, and the next one begins
        dayT = 0;
        const last = days.pop();
        last.d = actual.d;
        last.v.set(actual.v);
        days.unshift(last);
        newDay();
      }
      const draw = clamp01(dayT / 0.6);
      const happen = clamp01((dayT - 0.6) / (DAY_T - SHIFT_T - 0.6));
      const shift = ease.inOut((dayT - (DAY_T - SHIFT_T)) / SHIFT_T);
      layRows(shift);
      layFront(DZ * (1 - shift));
      forecast.u.uReveal.value = naive.u.uReveal.value = draw;
      forecast.u.uAlpha.value = 0.95 * (1 - shift);
      naive.u.uAlpha.value = 0.85 * (1 - shift);
      actual.u.uReveal.value = happen;
      const j = Math.min(HH - 1, happen * (HH - 1));
      const j0 = Math.floor(j), f = j - j0, j1 = Math.min(HH - 1, j0 + 1);
      const headY = yOf(actual.v[j0] * (1 - f) + actual.v[j1] * f);
      const hx = X0 + (X1 - X0) * happen, zf = DZ * (1 - shift);
      sweepPos.set([hx, Math.max(0, headY - 1.4), zf, hx, headY + 0.6, zf]);
      sweep.geometry.attributes.position.needsUpdate = true;
      sweep.material.opacity = 0.35 * (happen > 0 && happen < 1 ? 1 : 0);

      // the labels: two at the right end kept apart, one riding the head of the day
      const live = shift < 0.05;
      const pf = new THREE.Vector3(X1 + 0.1, yOf(forecast.v[HH - 1]), zf);
      const pn = new THREE.Vector3(X1 + 0.1, yOf(naive.v[HH - 1]), zf);
      let yf = screenY(pf), yn = screenY(pn);
      const gap = 26 - Math.abs(yf - yn);
      let dyf = 0, dyn = 0;
      if (gap > 0) { if (yf <= yn) { dyf = -gap / 2; dyn = gap / 2; } else { dyf = gap / 2; dyn = -gap / 2; } }
      T.forecast.classList.toggle('on', live && draw > 0.9 && place(T.forecast, pf, camera, W, H, 10, dyf, 'right'));
      T.naive.classList.toggle('on', live && draw > 0.9 && place(T.naive, pn, camera, W, H, 10, dyn, 'right'));
      T.actual.classList.toggle('on', live && happen > 0.08 && happen < 0.97
        && place(T.actual, v.set(hx, headY + 0.6, zf), camera, W, H, 0, -6));
    },
  };
}
