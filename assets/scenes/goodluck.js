// GOODLUCK, AS IT RUNS. Postings stream in from the job boards; a sieve of the
// person's own rules lets few through; the score lifts each to its height, and
// the mark (70 unless changed) is the one line on it. What clears the mark goes
// to the assistant: a language model boxed in by the app's rules (the app
// counts, the model only words it), and every answer ends in choices, A to D.

import { C, GL, tag, place, frame, center, aim, canvasTexture, roundRect, damp, ease, clamp01 } from './kit.js';

const SIEVE_X = -5;
const MARK_Y = 3.5;                 // a score of 70, at 0.05 a point
const PER_POINT = 0.05;
const BOX_SIZE = 2.8;
const PASS = 0.3;                   // of the postings, how many the rules let through (an illustration)
const BEST = 0.18;                  // of those, how many clear the mark (an illustration)

const INK = [0.925, 0.922, 0.902];
const AMBER = [0.957, 0.718, 0.251];
const DIMMED = [0.46, 0.48, 0.53];
const COOLISH = [0.72, 0.8, 0.95];

export default function create({ THREE, tier, labels }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
  const target = new THREE.Vector3(-1.0, 2.0, 0);
  const BOX = new THREE.Vector3(6.4, 2.3, 0);

  // ------------------------------------------------ the floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, extensions: { derivatives: true },
    vertexShader: `varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW;
      void main() {
        vec2 p = vW.xz;
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float fade = 1.0 - smoothstep(4.0, 15.0, length((p - vec2(-1.0, 0.0)) * vec2(0.75, 1.3)));
        gl_FragColor = vec4(${GL.cool}, line * 0.11 * fade);
      }`,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-1, 0, 0);
  scene.add(floor);

  // ------------------------------------------------ the postings
  const POOL = tier === 0 ? 90 : 170;
  const cardTex = canvasTexture(THREE, 120, 84, (g, w, h) => {
    roundRect(g, 2, 2, w - 4, h - 4, 10);
    g.fillStyle = 'rgb(20, 24, 33)'; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(255, 255, 255, 0.6)'; g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, 0.95)';
    roundRect(g, 13, 14, 60, 9, 4.5); g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.42)';
    for (const [y, l] of [[33, 92], [45, 78], [57, 88], [69, 50]]) { roundRect(g, 13, y, l, 5, 2.5); g.fill(); }
  });
  const cardGeo = new THREE.PlaneGeometry(0.92, 0.64);
  const aTint = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
  const aFade = new THREE.InstancedBufferAttribute(new Float32Array(POOL), 1);
  cardGeo.setAttribute('aTint', aTint);
  cardGeo.setAttribute('aFade', aFade);
  const cards = new THREE.InstancedMesh(cardGeo, new THREE.ShaderMaterial({
    uniforms: { uMap: { value: cardTex } },
    side: THREE.DoubleSide,
    vertexShader: `attribute vec3 aTint; attribute float aFade;
      varying vec2 vUv; varying vec3 vTint; varying float vFade;
      void main() {
        vUv = uv; vTint = aTint; vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform sampler2D uMap; varying vec2 vUv; varying vec3 vTint; varying float vFade;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.5 || vFade < 0.01) discard;
        gl_FragColor = vec4(mix(${GL.bg}, t.rgb * vTint, vFade), 1.0);
      }`,
  }), POOL);
  cards.frustumCulled = false;
  cards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(cards);

  // ------------------------------------------------ the sieve: the person's own rules
  const SIEVE_W = 5.6, SIEVE_H = 4.6;
  const hits = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
  let hitSlot = 0;
  const sieveU = { uTime: { value: 0 }, uHits: { value: hits } };
  const sieve = new THREE.Mesh(new THREE.PlaneGeometry(SIEVE_W, SIEVE_H), new THREE.ShaderMaterial({
    uniforms: sieveU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, extensions: { derivatives: true },
    vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec4 uHits[8]; varying vec2 vP;
      void main() {
        vec2 cell = vP / 0.3;
        vec2 g = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec3 glow = vec3(0.0);
        float e = 0.0;
        for (int i = 0; i < 8; i++) {
          vec4 h = uHits[i];
          float age = uTime - h.z;
          if (age < 0.0 || age > 1.1) continue;
          float d = length(vP - h.xy);
          float ring = exp(-pow((d - age * 1.5) * 8.0, 2.0)) * (1.0 - age / 1.1);
          float core = exp(-d * d * 14.0) * exp(-age * 6.0);
          float k = ring * 0.8 + core;
          e += k;
          glow += k * (h.w > 0.5 ? ${GL.cool} : ${GL.dim});
        }
        vec3 col = ${GL.cool} * line * 0.5 + glow * 0.9;
        gl_FragColor = vec4(col, clamp(line * 0.3 + e * 0.6, 0.0, 1.0));
      }`,
  }));
  sieve.rotation.y = Math.PI / 2;
  sieve.position.set(SIEVE_X, SIEVE_H / 2, 0);
  scene.add(sieve);
  const sieveEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(SIEVE_W, SIEVE_H)),
    new THREE.LineBasicMaterial({ color: C.cool, transparent: true, opacity: 0.55 }));
  sieveEdge.rotation.copy(sieve.rotation);
  sieveEdge.position.copy(sieve.position);
  scene.add(sieveEdge);

  // ------------------------------------------------ the mark: the one line on the score
  const MARK_X0 = SIEVE_X + 0.4, MARK_X1 = 2.2, MARK_D = 5.2;
  const markU = { uTime: { value: 0 } };
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(MARK_X1 - MARK_X0, MARK_D), new THREE.ShaderMaterial({
    uniforms: markU, transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { derivatives: true },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main() {
        vec2 d = min(vUv, 1.0 - vUv) / fwidth(vUv);
        float edge = 1.0 - min(min(d.x, d.y) / 1.4, 1.0);
        float sweep = exp(-pow((fract(vUv.x - uTime * 0.08) - 0.5) * 30.0, 2.0)) * 0.05;
        gl_FragColor = vec4(${GL.amber}, 0.05 + sweep + edge * 0.8);
      }`,
  }));
  mark.rotation.x = -Math.PI / 2;
  mark.position.set((MARK_X0 + MARK_X1) / 2, MARK_Y, 0);
  scene.add(mark);
  // the score's own axis, 0 to 100, with the mark on it
  const axis = [];
  const ax = MARK_X0, az = -MARK_D / 2;
  axis.push(ax, 0, az, ax, 5, az);
  for (const y of [0, 2.5, 5]) axis.push(ax, y, az, ax + 0.18, y, az);
  const axisLine = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(axis, 3)),
    new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.35 }));
  scene.add(axisLine);

  // ------------------------------------------------ the assistant, boxed in
  const box = new THREE.Group();
  box.position.copy(BOX);
  scene.add(box);
  const glassGeo = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
  box.add(new THREE.Mesh(glassGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV;
      void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        gl_FragColor = vec4(mix(${GL.cool}, ${GL.ink}, 0.4), 0.025 + f * 0.2); }`,
  })));
  box.add(new THREE.LineSegments(new THREE.EdgesGeometry(glassGeo),
    new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.5 })));
  const coreU = { uPulse: { value: 0 } };
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 1), new THREE.ShaderMaterial({
    uniforms: coreU, extensions: { derivatives: true },
    vertexShader: `varying vec3 vW; varying vec3 vV;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uPulse; varying vec3 vW; varying vec3 vV;
      void main() {
        vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
        float l = max(dot(n, normalize(vec3(0.4, 0.8, 0.5))), 0.0);
        float rim = pow(1.0 - abs(dot(n, normalize(vV))), 2.0);
        vec3 c = mix(${GL.ink} * 0.4, ${GL.amber}, 0.35 + 0.65 * uPulse) * (0.4 + 0.65 * l)
               + rim * ${GL.amber} * (0.35 + uPulse);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  box.add(core);
  const shell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.64, 0)),
    new THREE.LineBasicMaterial({ color: C.cool, transparent: true, opacity: 0.45 }));
  box.add(shell);
  // three rules turning round it, each with its own bead running
  const rings = [
    { r: 0.92, color: C.ink, tilt: [Math.PI / 2, 0, 0], turn: 0.16, run: 1.1 },
    { r: 1.06, color: C.cool, tilt: [Math.PI / 3, Math.PI / 5, 0], turn: -0.12, run: -0.9 },
    { r: 1.2, color: C.amber, tilt: [-Math.PI / 4, -Math.PI / 3, 0], turn: 0.09, run: 0.75 },
  ].map((d) => {
    const holder = new THREE.Group();
    const ring = new THREE.Group();
    ring.rotation.set(...d.tilt);
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.012, 6, 128),
      new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.75 })));
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: d.color }));
    ring.add(bead);
    holder.add(ring);
    box.add(holder);
    return { ...d, holder, bead, a: Math.random() * 6.28 };
  });

  // ------------------------------------------------ every answer ends in A to D
  const tiles = ['A', 'B', 'C', 'D'].map((L, i) => {
    const best = i === 0;
    const tex = canvasTexture(THREE, 128, 72, (g, w, h) => {
      roundRect(g, 2, 2, w - 4, h - 4, 12);
      g.fillStyle = 'rgba(12, 14, 20, 0.94)'; g.fill();
      g.lineWidth = 2.5; g.strokeStyle = best ? 'rgba(244, 183, 64, 0.95)' : 'rgba(236, 235, 230, 0.5)'; g.stroke();
      g.fillStyle = best ? '#f4b740' : '#ecebe6';
      g.font = '600 32px Inter, "Segoe UI", system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillText(L, 17, h / 2 + 2);
      g.fillStyle = 'rgba(236, 235, 230, 0.42)';
      roundRect(g, 52, 25, 58, 7, 3.5); g.fill();
      roundRect(g, 52, 40, 40, 7, 3.5); g.fill();
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    return m;
  });
  const TILE_X = BOX.x + BOX_SIZE / 2 + 0.95;
  let tilesT = 99;
  let pulse = 0;
  function answer() {
    pulse = 1;
    if (tilesT > 4.3) tilesT = 0;
  }

  // ------------------------------------------------ the labels
  const tags = [
    { at: new THREE.Vector3(-10.4, 4.1, 0), html: '<b>13,262</b> postings read', minW: 0 },
    { at: new THREE.Vector3(SIEVE_X, SIEVE_H + 0.2, 0), html: 'your own rules', minW: 430 },
    { at: new THREE.Vector3(MARK_X1, MARK_Y + 0.05, MARK_D / 2), html: 'the mark: <b>70</b>', minW: 0 },
    { at: new THREE.Vector3(BOX.x, BOX.y + BOX_SIZE / 2 + 0.3, 0), html: 'a model, boxed in by rules', minW: 430 },
    { at: new THREE.Vector3(TILE_X, BOX.y - 1.45, 0.4), html: 'A to D', minW: 430, dy: 30 },
  ].map((t) => ({ ...t, el: tag(labels, t.html) }));
  let shown = 0;

  // ------------------------------------------------ the postings' lives
  const state = Array.from({ length: POOL }, () => ({ on: false, from: new THREE.Vector3(), tint: [...INK] }));
  const dummy = new THREE.Object3D();
  let spawnClock = 0;
  const SPAWN_EVERY = tier === 0 ? 0.3 : 0.17;
  const ctrl = new THREE.Vector3();

  function setTint(c, rgb) { c.tint[0] = rgb[0]; c.tint[1] = rgb[1]; c.tint[2] = rgb[2]; }
  function towardTint(c, rgb, k) { for (let i = 0; i < 3; i++) c.tint[i] += (rgb[i] - c.tint[i]) * Math.min(1, k); }

  function spawn() {
    const c = state.find((k) => !k.on);
    if (!c) return;
    Object.assign(c, {
      on: true, mode: 'stream', t: 0, x: -13.6, y0: 0.7 + Math.random() * 2.9, z: (Math.random() - 0.5) * 4.4,
      phase: Math.random() * 6.28, rx: 0, ry: (Math.random() - 0.5) * 0.5, rz: (Math.random() - 0.5) * 0.2,
      fade: 0, s: 1, score: 0,
    });
    c.y = c.y0;
    setTint(c, COOLISH);
  }

  function hitSieve(c, passed) {
    const h = hits[hitSlot];
    hitSlot = (hitSlot + 1) % hits.length;
    h.set(-c.z, c.y - SIEVE_H / 2, sieveU.uTime.value, passed ? 1 : 0);
  }

  function step(c, dt) {
    c.t += dt;
    if (c.mode === 'stream') {
      c.x += 2.1 * dt;
      c.y = c.y0 + 0.07 * Math.sin(c.phase + c.t * 1.6);
      c.fade = Math.min(1, c.fade + dt * 1.2);
      if (c.x >= SIEVE_X - 0.1) {
        const passed = Math.random() < PASS;
        hitSieve(c, passed);
        c.t = 0;
        if (passed) {
          c.mode = 'rise';
          c.score = Math.random() < BEST ? 70 + Math.random() * 22 : 26 + Math.random() * 42;
          c.ty = c.score * PER_POINT;
          setTint(c, INK);
        } else {
          c.mode = 'drop';
          c.vx = -0.4 - Math.random() * 0.6; c.vy = 0.6 + Math.random() * 0.9;
          c.vz = (Math.random() - 0.5) * 0.8; c.vr = (Math.random() - 0.5) * 4;
          setTint(c, DIMMED);
        }
      }
    } else if (c.mode === 'drop') {
      c.vy -= 7.5 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      c.rx += 2.2 * dt; c.rz += c.vr * dt;
      c.fade = Math.max(0, 1 - c.t / 1.1);
      if (c.t > 1.1) c.on = false;
    } else if (c.mode === 'rise') {
      c.x += 2.3 * dt;
      c.y = damp(c.y, c.ty, 2.4, dt);
      c.ry = damp(c.ry, 0, 2, dt); c.rz = damp(c.rz, 0, 2, dt);
      towardTint(c, c.y >= MARK_Y ? AMBER : INK, dt * 5);
      if (c.x >= MARK_X1 - 0.4) {
        c.t = 0;
        if (c.score >= 70) { c.mode = 'send'; c.from.set(c.x, c.y, c.z); setTint(c, AMBER); }
        else { c.mode = 'kept'; setTint(c, DIMMED); }
      }
    } else if (c.mode === 'kept') {
      c.x += 0.9 * dt * Math.max(0, 1 - c.t);
      c.y = damp(c.y, 0.2, 1.2, dt);
      c.fade = Math.max(0, 1 - c.t / 1.3);
      if (c.t > 1.3) c.on = false;
    } else if (c.mode === 'send') {
      const k = ease.inOut(c.t / 1.5);
      ctrl.set((c.from.x + BOX.x) / 2, Math.max(c.from.y, BOX.y) + 1.4, c.from.z * 0.5);
      const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, d = k * k;
      c.x = a * c.from.x + b * ctrl.x + d * BOX.x;
      c.y = a * c.from.y + b * ctrl.y + d * BOX.y;
      c.z = a * c.from.z + b * ctrl.z + d * BOX.z;
      c.s = 1 - 0.85 * k;
      c.ry = -0.4 * k;
      if (c.t >= 1.5) { c.on = false; answer(); }
    }
  }

  let baseAz = 0.38, baseEl = 0.28, dist = 40;
  const BOUNDS = [];
  for (const x of [-10, 9.9]) for (const y of [0, 4.9]) for (const z of [-2.6, 2.6]) BOUNDS.push(new THREE.Vector3(x, y, z));
  let W = 1, H = 1;
  const dir = new THREE.Vector3();

  return {
    scene, camera,
    resize(w, h) {
      W = w; H = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // a wide stage takes the pipeline nearly side on; a squarer one turns it
      // corner to corner, so it fills the frame both ways
      const a = w / h;
      baseAz = a >= 1.35 ? 0.42 : a >= 0.9 ? 0.68 : 0.8;
      baseEl = a >= 1.35 ? 0.5 : 0.52;
      const fr = frame(camera, target, aim(THREE, baseAz, baseEl), BOUNDS, 0.94, 0.8);
      dist = fr.dist;
      center(camera, w, h, fr, 0, -h * 0.06);
    },
    update(dt, t, input) {
      // the camera drifts, and leans toward the pointer
      const px = input.inside ? input.x - 0.5 : 0, py = input.inside ? input.y - 0.5 : 0;
      dir.copy(aim(THREE, baseAz + px * 0.22 + Math.sin(t * 0.13) * 0.05, baseEl - py * 0.1 + Math.sin(t * 0.11) * 0.02));
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();

      sieveU.uTime.value += dt;
      markU.uTime.value += dt;
      spawnClock += dt;
      while (spawnClock > SPAWN_EVERY) { spawnClock -= SPAWN_EVERY; spawn(); }
      for (let i = 0; i < POOL; i++) {
        const c = state[i];
        if (c.on) step(c, dt);
        if (!c.on) {
          dummy.scale.setScalar(0);
          aFade.array[i] = 0;
        } else {
          dummy.position.set(c.x, c.y, c.z);
          dummy.rotation.set(c.rx, c.ry, c.rz);
          dummy.scale.setScalar(c.s);
          aFade.array[i] = c.fade;
          aTint.array[i * 3] = c.tint[0]; aTint.array[i * 3 + 1] = c.tint[1]; aTint.array[i * 3 + 2] = c.tint[2];
        }
        dummy.updateMatrix();
        cards.setMatrixAt(i, dummy.matrix);
      }
      cards.instanceMatrix.needsUpdate = true;
      aFade.needsUpdate = aTint.needsUpdate = true;

      // the box: the core pulses with each posting, the rules keep turning
      pulse = Math.max(0, pulse - dt * 0.9);
      coreU.uPulse.value = pulse;
      core.rotation.y += dt * 0.4; core.rotation.x += dt * 0.17;
      shell.rotation.y -= dt * 0.22;
      core.scale.setScalar(1 + 0.12 * pulse);
      for (const r of rings) {
        r.holder.rotation.y += dt * r.turn;
        r.a += dt * r.run;
        r.bead.position.set(Math.cos(r.a) * r.r, Math.sin(r.a) * r.r, 0);
      }

      // the choices come out one after another, and go
      tilesT += dt;
      const out = 1 - clamp01((tilesT - 3.6) / 0.6);
      tiles.forEach((m, i) => {
        const k = ease.out((tilesT - 0.15 - i * 0.16) / 0.45);
        m.visible = k > 0 && out > 0;
        m.position.set(TILE_X - 0.9 * (1 - k), BOX.y + 1.02 - i * 0.68, 0.4);
        m.scale.setScalar(0.6 + 0.4 * k);
        m.material.opacity = k * out;
        m.lookAt(camera.position.x, m.position.y, camera.position.z);
      });

      // the labels, one after another the first time the room is seen
      if (input.seen > 0.35) shown += dt;
      tags.forEach((g, i) => {
        const fits = place(g.el, g.at, camera, W, H, 0, g.dy || 0);
        g.el.classList.toggle('on', fits && W >= g.minW && shown > 0.5 + i * 0.35);
      });
    },
  };
}
