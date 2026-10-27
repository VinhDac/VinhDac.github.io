// CAT STUDIO'S OPTIMISER, AND WHY THE HIGHEST PEAK IS DISTRUSTED. Blocks become
// a LEAN algorithm; across the ground are two of its settings, and the height is
// the backtest's result. The optimiser tries settings and climbs to the highest
// result, then asks its neighbours: a lone spike whose neighbours fail is
// flagged as likely luck, and the broad plateau where they hold is kept.
// The ground is an illustration; the rule is the app's.

import { C, GL, tag, place, frame, center, aim, damp, ease, clamp01 } from './kit.js';

const SPIKE = { x: 2.9, z: -2.3 };
const PLATEAU = { x: -2.3, z: 1.5 };
const CYCLE = 16.5;

function height(x, z) {
  const r1 = Math.hypot(x - PLATEAU.x, z - PLATEAU.z) / 2.5;
  const plateau = 2.1 / (1 + Math.pow(r1, 6));
  const r2 = Math.hypot(x - SPIKE.x, z - SPIKE.z);
  const spike = 3.9 * Math.exp(-(r2 * r2) / (2 * 0.27 * 0.27));
  const waves = 0.3 * Math.sin(0.8 * x + 0.3) * Math.cos(0.65 * z - 0.4) + 0.16 * Math.sin(1.6 * x - 1.1 * z);
  const ripple = 0.05 * Math.sin(3.1 * x + 1.7 * z) * Math.cos(2.3 * z - 0.6 * x);
  return 0.45 + plateau + spike + waves + ripple;
}

export default function create({ THREE, tier, labels }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 300);
  const target = new THREE.Vector3(-0.4, 1.3, 0.2);

  // ------------------------------------------------ the ground of results
  const SEG = tier === 0 ? 96 : 160;
  const geo = new THREE.PlaneGeometry(12, 12, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const groundU = {
    uSpike: { value: 0 }, uPlateau: { value: 0 }, uTime: { value: 0 },
  };
  const ground = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: groundU, extensions: { derivatives: true },
    vertexShader: `varying vec3 vW; varying vec3 vN;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uSpike; uniform float uPlateau; uniform float uTime;
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        float diff = max(dot(n, normalize(vec3(-0.45, 0.85, 0.3))), 0.0);
        float h = vW.y / 4.6;
        vec3 low = vec3(0.045, 0.06, 0.085);
        vec3 mid = vec3(0.2, 0.29, 0.43);
        vec3 col = mix(low, mid, smoothstep(0.08, 0.6, h));
        col = mix(col, ${GL.ink} * 0.85, smoothstep(0.62, 1.0, h));
        col *= 0.38 + 0.8 * diff;
        // contour lines of the result, and the settings' grid on the ground
        float k = vW.y * 5.0;
        float c = abs(fract(k - 0.5) - 0.5) / fwidth(k);
        col += (1.0 - min(c, 1.0)) * 0.16 * ${GL.cool};
        vec2 g2 = abs(fract(vW.xz - 0.5) - 0.5) / fwidth(vW.xz);
        col += (1.0 - min(min(g2.x, g2.y), 1.0)) * 0.035 * ${GL.cool};
        // rings drawn round the spike and the plateau when they are judged
        float ds = length(vW.xz - vec2(${SPIKE.x.toFixed(2)}, ${SPIKE.z.toFixed(2)}));
        float dp = length(vW.xz - vec2(${PLATEAU.x.toFixed(2)}, ${PLATEAU.z.toFixed(2)}));
        col += exp(-pow((ds - 0.75) * 14.0, 2.0)) * uSpike * ${GL.ink} * 0.8;
        col += exp(-pow((dp - 1.85) * 9.0, 2.0)) * uPlateau * ${GL.amber} * 0.95;
        float edge = 1.0 - smoothstep(4.2, 5.9, length(vW.xz));
        gl_FragColor = vec4(mix(${GL.bg}, col, edge), 1.0);
      }`,
  }));
  scene.add(ground);
  const at = (x, z, lift = 0) => new THREE.Vector3(x, height(x, z) + lift, z);

  // ------------------------------------------------ blocks, stacked into a strategy
  scene.add(new THREE.HemisphereLight(0xdfe6f3, 0x1a1f2b, 3.2));
  const sun = new THREE.DirectionalLight(0xffffff, 3.4);
  sun.position.set(-3, 8, 5);
  scene.add(sun);
  const BLOCK_AT = new THREE.Vector3(-4.7, 0, 4.4);
  const blockColors = [0x9cc3ff, 0xecebe6, 0xf4b740, 0x6f86ad];
  const blocks = blockColors.map((color, i) => {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.32, 0.62), mat);
    g.add(body);
    for (const dx of [-0.22, 0.22]) {
      const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 16), mat);
      nub.position.set(dx, 0.2, 0);
      g.add(nub);
    }
    g.userData = { mat, rest: 0.18 + i * 0.36, shift: (i % 2 ? 0.1 : -0.08) };
    g.visible = false;
    scene.add(g);
    return g;
  });

  // ------------------------------------------------ the optimiser and what it touches
  const dot = (r, color) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true }));
  const SAMPLES = 11;
  const samples = Array.from({ length: SAMPLES }, () => { const m = dot(0.075, C.ink); m.visible = false; scene.add(m); return m; });
  const marker = dot(0.15, C.amber);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), new THREE.MeshBasicMaterial({
    color: C.amber, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  marker.add(halo);
  marker.visible = false;
  scene.add(marker);
  const PROBES = 8;
  const probes = Array.from({ length: PROBES }, () => { const m = dot(0.06, C.ink); m.visible = false; scene.add(m); return m; });
  const spokesPos = new Float32Array(PROBES * 6);
  const spokes = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(spokesPos, 3)),
    new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.5 }));
  spokes.frustumCulled = false;
  scene.add(spokes);
  // the optimiser's path, as it went
  const TRAIL = 160;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: C.amber, transparent: true, opacity: 0.45 }));
  trail.frustumCulled = false;
  scene.add(trail);
  let trailN = 0, trailClock = 0;

  // ------------------------------------------------ the labels
  const T = {
    blocks: tag(labels, 'blocks become a LEAN algorithm'),
    search: tag(labels, 'the optimiser tries settings'),
    peak: tag(labels, 'the highest result'),
    flag: tag(labels, 'flagged: likely luck, its neighbours fail'),
    keep: tag(labels, 'kept: its neighbours hold'),
  };

  // ------------------------------------------------ one run of the story
  let picks = [];
  function newRun() {
    picks = [];
    for (let i = 0; i < SAMPLES - 1; i++) {
      let x, z;
      do { const a = Math.random() * 6.28, r = 1 + Math.random() * 3.2; x = Math.cos(a) * r; z = Math.sin(a) * r; }
      while (Math.hypot(x - SPIKE.x, z - SPIKE.z) < 1.0);
      picks.push(at(x, z, 0.1));
    }
    // the last try lands at the foot of the spike, and the climb begins there
    const a = Math.random() * 6.28;
    picks.push(at(SPIKE.x + Math.cos(a) * 0.62, SPIKE.z + Math.sin(a) * 0.62, 0.1));
    trailN = 0;
  }
  newRun();
  const PEAK = at(SPIKE.x, SPIKE.z, 0.16);
  const TOP = at(PLATEAU.x, PLATEAU.z, 0.16);
  const START = new THREE.Vector3(BLOCK_AT.x, 1.9, BLOCK_AT.z);
  const v = new THREE.Vector3();
  const arc = (a, b, k, lift, out) => {
    out.lerpVectors(a, b, k);
    out.y += Math.sin(Math.PI * k) * lift;
    return out;
  };

  let runT = 0, last = -1;
  let baseAz = 0.62, baseEl = 0.6, dist = 20;
  const BOUNDS = [];
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; BOUNDS.push(new THREE.Vector3(Math.cos(a) * 5.3, 0.4, Math.sin(a) * 5.3)); }
  BOUNDS.push(at(SPIKE.x, SPIKE.z, 0.6));
  for (const dx of [-0.7, 0.7]) for (const dz of [-0.5, 0.5]) BOUNDS.push(new THREE.Vector3(BLOCK_AT.x + dx, 1.9, BLOCK_AT.z + dz), new THREE.Vector3(BLOCK_AT.x + dx, 0, BLOCK_AT.z + dz));
  let W = 1, H = 1;
  const dir = new THREE.Vector3();

  function probesAround(c, r, k, drop) {
    for (let i = 0; i < PROBES; i++) {
      const a = i / PROBES * Math.PI * 2 + 0.3;
      const x = c.x + Math.cos(a) * r * k, z = c.z + Math.sin(a) * r * k;
      const ground = height(x, z) + 0.06;
      const y = c.y + (ground - c.y) * drop;
      probes[i].position.set(x, y, z);
      probes[i].visible = k > 0.02;
      spokesPos.set([c.x, c.y, c.z, x, y, z], i * 6);
    }
    spokes.geometry.attributes.position.needsUpdate = true;
  }

  return {
    scene, camera,
    resize(w, h) {
      W = w; H = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      baseAz = w / h >= 1 ? 0.62 : 0.7;
      baseEl = w / h >= 1 ? 0.58 : 0.72;
      const fr = frame(camera, target, aim(THREE, baseAz, baseEl), BOUNDS, 0.92, 0.84);
      dist = fr.dist;
      center(camera, w, h, fr);
    },
    update(dt, t, input) {
      const px = input.inside ? input.x - 0.5 : 0, py = input.inside ? input.y - 0.5 : 0;
      dir.copy(aim(THREE, baseAz + px * 0.3 + Math.sin(t * 0.09) * 0.1, baseEl - py * 0.12));
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      groundU.uTime.value += dt;

      if (input.seen > 0.3 || runT > 0) runT += dt;
      if (runT > CYCLE) { runT = 0; newRun(); }
      const r = runT;

      // 0 - 1.8 s: the blocks fall into a stack
      blocks.forEach((b, i) => {
        const k = ease.out((r - 0.1 - i * 0.28) / 0.5);
        const gone = clamp01((r - 15.2) / 0.8);
        b.visible = k > 0 && gone < 1;
        b.position.set(BLOCK_AT.x + b.userData.shift, b.userData.rest + (1 - k) * 2.2 + gone * 1.2, BLOCK_AT.z);
        b.userData.mat.opacity = 1 - gone;
      });

      // 1.8 - 2.4 s: the algorithm sets out; 2.4 - 7 s: it tries settings
      marker.visible = r > 1.8 && r < 15.6;
      const hop = 0.42, s0 = 2.4;
      let seen = 0;
      if (r < s0) {
        arc(START, picks[0], ease.inOut((r - 1.8) / 0.6), 1.2, v);
      } else if (r < s0 + hop * (SAMPLES - 1)) {
        const i = Math.floor((r - s0) / hop);
        const k = (r - s0 - i * hop) / hop;
        arc(picks[i], picks[i + 1], ease.inOut(k), 0.7, v);
        seen = i + 1;
      } else if (r < 8.6) {
        // climbing to the highest result, along the ground
        seen = SAMPLES;
        const k = ease.inOut((r - (s0 + hop * (SAMPLES - 1))) / (8.6 - s0 - hop * (SAMPLES - 1)));
        v.lerpVectors(picks[SAMPLES - 1], PEAK, k);
        v.y = height(v.x, v.z) + 0.16;
      } else if (r < 11.0) {
        seen = SAMPLES;
        v.copy(PEAK);
      } else if (r < 12.6) {
        seen = SAMPLES;
        arc(PEAK, TOP, ease.inOut((r - 11.0) / 1.6), 1.6, v);
      } else {
        seen = SAMPLES;
        v.copy(TOP);
      }
      marker.position.copy(v);
      halo.scale.setScalar(1 + 0.15 * Math.sin(t * 4));
      samples.forEach((m, i) => {
        m.visible = i < seen && r < 15.8;
        m.position.copy(picks[i]).setY(picks[i].y - 0.04);
        m.material.opacity = 1 - clamp01((r - 15.0) / 0.8);
      });
      // the path, as it went
      trailClock += dt;
      if (marker.visible && trailClock > 0.03 && trailN < TRAIL) {
        trailClock = 0;
        trailPos.set([v.x, v.y, v.z], trailN * 3);
        trailN++;
        trailGeo.attributes.position.needsUpdate = true;
        trailGeo.setDrawRange(0, trailN);
      }
      trail.material.opacity = 0.42 * (1 - clamp01((r - 15.0) / 0.8));
      if (r < 0.05 && last > 1) { trailN = 0; trailGeo.setDrawRange(0, 0); }

      // 8.6 - 11: the neighbours of the peak are asked, and fail
      const askPeak = clamp01((r - 8.7) / 0.5) * (1 - clamp01((r - 10.8) / 0.3));
      const askTop = clamp01((r - 12.8) / 0.5) * (1 - clamp01((r - 15.0) / 0.5));
      if (askPeak > 0) probesAround(PEAK, 0.72, ease.out(askPeak), ease.out(clamp01((r - 9.1) / 0.6)));
      else if (askTop > 0) probesAround(TOP, 0.72, ease.out(askTop), ease.out(clamp01((r - 13.2) / 0.6)));
      else probes.forEach((p) => { p.visible = false; });
      spokes.visible = askPeak > 0 || askTop > 0;
      spokes.material.color.setHex(askTop > 0 ? C.amber : C.ink);
      spokes.material.opacity = 0.6 * Math.max(askPeak, askTop);
      probes.forEach((p) => p.material.color.setHex(askTop > 0 ? C.amber : C.ink));
      groundU.uSpike.value = damp(groundU.uSpike.value, r > 9.4 && r < 11.4 ? 1 : 0, 4, dt);
      groundU.uPlateau.value = damp(groundU.uPlateau.value, r > 13.4 && r < 15.3 ? 1 : 0, 4, dt);

      // the labels follow the story
      const show = (el, on, point, dy = -14) => {
        const fits = place(el, point, camera, W, H, 0, dy);
        el.classList.toggle('on', on && fits);
      };
      show(T.blocks, r > 0.4 && r < 2.6, new THREE.Vector3(BLOCK_AT.x, 1.75, BLOCK_AT.z));
      show(T.search, r > 2.6 && r < 7.0, v.clone().setY(v.y + 0.3));
      show(T.peak, r > 7.6 && r < 9.5, PEAK.clone().setY(PEAK.y + 0.3));
      show(T.flag, r > 9.5 && r < 11.4, PEAK.clone().setY(PEAK.y + 0.3));
      show(T.keep, r > 13.4 && r < 15.4, TOP.clone().setY(TOP.y + 0.35));
      last = r;
    },
  };
}
