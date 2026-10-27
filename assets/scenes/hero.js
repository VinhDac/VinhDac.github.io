// THE NAME. Each point of it is where a random walk ends: a Brownian bridge,
// a random walk pinned at both ends. Every walker is computed on the GPU from
// the bridge's Karhunen-Loeve series,
//     B(s) = sum over k of Z_k * sqrt(2) / (k pi) * sin(k pi s),   0 <= s <= 1,
// with fourteen terms (95% of its variance) and its sines by the recurrence
// sin((k+1)a) = 2 cos(a) sin(ka) - sin((k-1)a): one sine and one cosine a point.
// First the walks come in from the left edge and end on the letters; a click
// sends every point out on a walk of its own that must come back to its place.

import { fontsReady, GL, damp } from './kit.js';

const TERMS = 14;
const TRAIL = 9;          // segments of trail behind each walker
const LAG = 0.035;        // seconds between two points of a trail

const VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uMode;      // 0: from the left edge to the name; 1: from the name, back to it
uniform vec2 uClick;
uniform vec2 uPointer;
uniform float uPush;
uniform float uR;
uniform float uAmp;
uniform float uSize;
uniform float uDepth;
attribute vec3 aStart;
attribute vec3 aTarget;
attribute vec2 aTime;     // when it sets off, how long it walks
attribute vec4 aRnd;
varying vec3 vColor;
varying float vAlpha;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

vec3 bridge(float s, vec4 r) {
  float a = 3.14159265 * s;
  float c2 = 2.0 * cos(a);
  float s0 = 0.0;
  float s1 = sin(a);
  vec3 acc = vec3(0.0);
  for (int k = 1; k <= TERMS; k++) {
    float fk = float(k);
    // Z_k: mean 0, variance 1 (uniform on -sqrt3..sqrt3)
    vec3 z = vec3(
      hash(r.x * 91.31 + fk * 12.9898 + uSeed),
      hash(r.y * 77.73 + fk * 78.233 + uSeed * 1.31),
      hash(r.z * 63.17 + fk * 37.719 + uSeed * 1.73)) * 3.4641016 - 1.7320508;
    acc += z * (s1 / fk);
    float s2 = c2 * s1 - s0;
    s0 = s1;
    s1 = s2;
  }
  return acc * 0.45015816;   // sqrt(2) / pi
}

void main() {
#ifdef LINES
  float lag = position.x;
#else
  float lag = 0.0;
#endif
  float delay = mix(aTime.x, length(aTarget.xy - uClick) / 1700.0 + aRnd.y * 0.14, uMode);
  float dur = mix(aTime.y, 1.05 + aRnd.x * 0.8, uMode);
  float t = uTime - lag;
  float s = clamp((t - delay) / dur, 0.0, 1.0);
  vec3 from = mix(aStart, aTarget, uMode);
  vec3 p = mix(from, aTarget, s);
  if (s > 0.0 && s < 1.0) {
    float amp = uAmp * (0.55 + 0.9 * aRnd.w) * mix(1.0, 0.75, uMode) * sqrt(dur);
    p += bridge(s, aRnd) * amp * mix(vec3(0.22, 1.0, 0.7), vec3(1.0, 0.9, 0.75), uMode);
  }
  float landed = smoothstep(0.985, 1.0, s);
  p.xy += landed * 0.6 * vec2(sin(uTime * 1.7 + aRnd.x * 60.0), cos(uTime * 1.3 + aRnd.y * 60.0));
  vec2 d = p.xy - uPointer;
  float f = uPush * exp(-dot(d, d) / (2.0 * uR * uR));
  p.xy += normalize(d + vec2(0.0001)) * f * uR * 0.6;
  p.z += f * uR * 1.2;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  vColor = aRnd.z < 0.06 ? ${GL.amber} : (aRnd.z < 0.2 ? ${GL.cool} : ${GL.ink});
  float launched = step(delay, t);
#ifdef LINES
  vAlpha = launched * (1.0 - landed) * (1.0 - lag / SPAN) * 0.22;
  vColor = mix(${GL.cool}, vColor, 0.4);
#else
  float flying = 1.0 - max(landed, uMode);
  vAlpha = max(launched, uMode) * (0.5 + 0.5 * fract(aRnd.w * 7.31)) * (1.0 - 0.72 * flying);
  gl_PointSize = uSize * (0.85 + 1.1 * aRnd.w) * (1.0 - 0.3 * flying) * uDepth / -mv.z;
#endif
}`;

const POINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = max(0.0, 1.0 - dot(c, c) * 4.0);
  a *= a;
  if (a * vAlpha < 0.004) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

const LINE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha < 0.003) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}`;

export default async function create({ THREE, renderer, el, tier }) {
  await fontsReady('900 120px Inter');
  if (document.fonts && document.fonts.ready) {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  }
  const N = [3000, 6500, 12000][tier];
  const caption = document.getElementById('hero-caption');
  const copy = document.querySelector('.hero-copy');
  const touch = matchMedia('(pointer: coarse)').matches;
  if (caption) {
    caption.textContent = `Each point of the name is where one of ${N.toLocaleString('en-GB')} random walks ends: `
      + `Brownian bridges, drawn live in your browser. ${touch ? 'Tap' : 'Click'} to draw them again.`;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 20000);
  const pivot = new THREE.Group();       // turned a little toward the pointer, round the name's centre
  const inner = new THREE.Group();
  pivot.add(inner);
  scene.add(pivot);

  const aStart = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  const aTarget = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  const aTime = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
  const aRnd = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  for (let i = 0; i < N * 4; i++) aRnd.array[i] = Math.random();

  const uniforms = {
    uTime: { value: 0 }, uSeed: { value: Math.random() * 50 }, uMode: { value: 0 },
    uClick: { value: new THREE.Vector2() }, uPointer: { value: new THREE.Vector2(1e5, 1e5) },
    uPush: { value: 0 }, uR: { value: 60 }, uAmp: { value: 120 }, uSize: { value: 2 }, uDepth: { value: 1000 },
  };
  const geometry = (base) => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
    g.setAttribute('aStart', aStart);
    g.setAttribute('aTarget', aTarget);
    g.setAttribute('aTime', aTime);
    g.setAttribute('aRnd', aRnd);
    g.instanceCount = N;
    return g;
  };
  const trail = [];
  for (let k = 0; k < TRAIL; k++) trail.push(k * LAG, 0, 0, (k + 1) * LAG, 0, 0);
  const common = {
    uniforms, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  };
  const defines = { TERMS, SPAN: (TRAIL * LAG).toFixed(4) };
  const lines = new THREE.LineSegments(geometry(trail), new THREE.ShaderMaterial({
    ...common, defines: { ...defines, LINES: 1 }, vertexShader: VERT, fragmentShader: LINE_FRAG,
  }));
  const points = new THREE.Points(geometry([0, 0, 0]), new THREE.ShaderMaterial({
    ...common, defines, vertexShader: VERT, fragmentShader: POINT_FRAG,
  }));
  lines.geometry.instanceCount = Math.round(N * 0.3);    // a thread behind three walkers in ten
  lines.frustumCulled = points.frustumCulled = false;
  inner.add(lines, points);

  // ------------------------------------------------ laying the name out
  const meas = document.createElement('canvas').getContext('2d');
  const FONT = (px) => `900 ${px}px Inter, "Segoe UI", system-ui, -apple-system, sans-serif`;
  let laidW = 0, laidH = 0, span = 4, pointSize = 2;

  function layout(w, h) {
    const sr = el.getBoundingClientRect();
    const cr = copy ? copy.getBoundingClientRect() : { left: sr.left + 24, width: w - 48, top: sr.top + h * 0.62 };
    const left = Math.max(14, cr.left - sr.left);
    const availW = Math.max(120, Math.min(cr.width, w - left - 14));
    const bandTop = Math.min(96, h * 0.13);
    const bandBottom = Math.max(bandTop + 80, cr.top - sr.top - Math.max(16, h * 0.035));
    const bandH = bandBottom - bandTop;

    meas.font = FONT(100);
    const cap = (meas.measureText('H').actualBoundingBoxAscent || 72.7) / 100;
    const wOne = meas.measureText('DAC VINH NGUYEN').width / 100;
    const wTwo = Math.max(meas.measureText('DAC VINH').width, meas.measureText('NGUYEN').width) / 100;
    const gapEm = 0.24;
    const one = Math.min(availW / wOne, (bandH * 0.9) / cap, 240);
    const two = Math.min(availW / wTwo, (bandH * 0.9) / (cap * 2 + gapEm), 240);
    const rows = two > one * 1.3 ? ['DAC VINH', 'NGUYEN'] : ['DAC VINH NGUYEN'];
    const size = Math.max(28, rows.length === 2 ? two : one);
    const capPx = cap * size, gapPx = gapEm * size;
    const blockH = rows.length * capPx + (rows.length - 1) * gapPx;
    const blockTop = bandTop + (bandH - blockH) / 2;

    // the letters, drawn once on a canvas of their own size
    meas.font = FONT(size);
    const pad = 6;
    const tw = Math.ceil(Math.max(...rows.map((r) => meas.measureText(r).width))) + pad * 2;
    const th = Math.ceil(blockH) + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.font = FONT(size);
    g.fillStyle = '#fff';
    g.textBaseline = 'alphabetic';
    rows.forEach((r, i) => g.fillText(r, pad, pad + capPx + i * (capPx + gapPx)));
    const data = g.getImageData(0, 0, tw, th).data;
    const filled = [];
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) if (data[(y * tw + x) * 4 + 3] > 140) filled.push(x, y);
    }
    const count = filled.length / 2;
    if (!count) return;

    const X = (px) => left + px - pad - w / 2;
    const Y = (py) => h / 2 - (blockTop + py - pad);
    const cx = X(tw / 2), cy = Y(th / 2);
    const minX = X(0), maxX = X(tw);
    const ox = -w / 2 - 30;
    const T = aTarget.array, S = aStart.array, TM = aTime.array;
    span = 0;
    for (let i = 0; i < N; i++) {
      const j = (Math.random() * count) | 0;
      const tx = X(filled[j * 2] + Math.random()), ty = Y(filled[j * 2 + 1] + Math.random());
      T[i * 3] = tx; T[i * 3 + 1] = ty; T[i * 3 + 2] = (Math.random() - 0.5) * 10;
      // each walk comes in from the left edge near its own height, like a series in time
      S[i * 3] = ox - Math.random() * 40; S[i * 3 + 1] = cy + (ty - cy) * 0.6 + gauss() * 18; S[i * 3 + 2] = gauss() * 20;
      const ux = (tx - minX) / Math.max(1, maxX - minX);
      const delay = 0.1 + Math.random() * 1.1;
      const dur = 1.1 + 1.8 * ux + Math.random() * 0.35;
      TM[i * 2] = delay; TM[i * 2 + 1] = dur;
      span = Math.max(span, delay + dur);
    }
    aStart.needsUpdate = aTarget.needsUpdate = aTime.needsUpdate = true;
    span += TRAIL * LAG;
    pivot.position.set(cx, cy, 0);
    inner.position.set(-cx, -cy, 0);
    uniforms.uR.value = size * 0.42;
    uniforms.uAmp.value = Math.min(h * 0.075, 80);
    pointSize = Math.min(2.6, Math.max(1.5, size * 0.018));
  }

  function draw(mode, x = 0, y = 0) {
    uniforms.uMode.value = mode;
    uniforms.uTime.value = 0;
    uniforms.uSeed.value = Math.random() * 60;
    uniforms.uClick.value.set(x, y);
    if (mode === 1) {
      // the last walker home sets out from the farthest letter
      let far = 0;
      const T = aTarget.array;
      for (let i = 0; i < N; i++) far = Math.max(far, Math.hypot(T[i * 3] - x, T[i * 3 + 1] - y));
      span = far / 1700 + 0.14 + 1.85 + TRAIL * LAG;
    }
    lines.visible = true;
  }

  // ------------------------------------------------ the pointer, on the name's plane
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  function onPlane(fx, fy) {
    ndc.set(fx * 2 - 1, 1 - fy * 2);
    ray.setFromCamera(ndc, camera);
    inv.copy(inner.matrixWorld).invert();
    ray.ray.applyMatrix4(inv);
    return ray.ray.intersectPlane(plane, hit);
  }

  let push = 0, yaw = 0, pitch = 0;

  return {
    scene, camera,
    resize(w, h) {
      camera.aspect = w / h;
      const D = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.set(0, 0, D);
      camera.near = D * 0.25;
      camera.far = D * 4;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      uniforms.uDepth.value = D;
      // A phone's bar coming and going is not a new page: the name is laid
      // out again only for a new width, or a much changed height.
      const rw = Math.round(w);
      if (rw !== laidW || Math.abs(h - laidH) > laidH * 0.15) {
        // the first drawing starts again if the window changed while it ran
        const fresh = laidW === 0 || (uniforms.uMode.value === 0 && uniforms.uTime.value < span);
        pivot.rotation.set(0, 0, 0);
        pivot.updateMatrixWorld(true);
        layout(w, h);
        laidW = rw; laidH = h;
        if (fresh) draw(0);
        else { uniforms.uMode.value = 1; uniforms.uTime.value = 1e3; lines.visible = false; }
      }
    },
    update(dt, t, input) {
      uniforms.uTime.value += dt;
      const tx = input.inside ? input.x - 0.5 : 0;
      const ty = input.inside ? input.y - 0.5 : 0;
      yaw = damp(yaw, tx * 0.11 + Math.sin(t * 0.21) * 0.025, 2.5, dt);
      pitch = damp(pitch, ty * 0.08 + Math.sin(t * 0.17 + 1.3) * 0.015, 2.5, dt);
      pivot.rotation.set(pitch, yaw, 0);
      pivot.updateMatrixWorld(true);
      if (input.inside && onPlane(input.x, input.y)) uniforms.uPointer.value.set(hit.x, hit.y);
      push = damp(push, input.moved ? 1 : 0, input.moved ? 7 : 1.4, dt);
      uniforms.uPush.value = push;
      uniforms.uSize.value = renderer.getPixelRatio() * pointSize;
      if (uniforms.uTime.value > span + 0.3) lines.visible = false;
    },
    click(fx, fy) {
      if (uniforms.uTime.value < span) return;          // one drawing at a time
      pivot.updateMatrixWorld(true);
      if (onPlane(fx, fy)) draw(1, hit.x, hit.y);
    },
  };
}

function gauss() {
  const u = Math.max(Math.random(), 1e-9), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
