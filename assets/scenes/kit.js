// What every room shares: the palette, its labels, and how its camera is framed.

export const C = {
  bg: 0x07080c, ink: 0xecebe6, muted: 0xa3a8b2, dim: 0x6b717c,
  amber: 0xf4b740, cool: 0x9cc3ff,
};

// The same colours as GLSL vec3 literals (the page draws with no colour management).
export const GL = {
  bg: 'vec3(0.0275, 0.0314, 0.0471)',
  ink: 'vec3(0.925, 0.922, 0.902)',
  amber: 'vec3(0.957, 0.718, 0.251)',
  cool: 'vec3(0.612, 0.765, 1.0)',
  dim: 'vec3(0.420, 0.443, 0.486)',
};

export async function fontsReady(spec, ms = 2500) {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.race([document.fonts.load(spec), new Promise((r) => setTimeout(r, ms))]);
  } catch (e) { /* a font that will not load: the fallback draws instead */ }
}

// A label pinned to a point of the room.
export function tag(container, html, cls = '') {
  const el = document.createElement('div');
  el.className = 'tag' + (cls ? ' ' + cls : '');
  el.innerHTML = html;
  container.appendChild(el);
  return el;
}

// Moves a label to where a 3D point falls in the stage: above it, or with
// side 'right' beside it. The whole label is kept inside the stage.
// -> false when the point itself falls off the stage.
export function place(el, point, camera, w, h, dx = 0, dy = 0, side = 'above') {
  const p = point.clone().project(camera);
  let x = (p.x * 0.5 + 0.5) * w + dx;
  let y = (-p.y * 0.5 + 0.5) * h + dy;
  const inside = p.z < 1 && x > -40 && x < w + 40 && y > -10 && y < h + 40;
  if (!el._w) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
  const m = 8, ew = el._w, eh = el._h;
  if (side === 'right') {
    x = Math.min(Math.max(x, m), w - ew - m);
    y = Math.min(Math.max(y, eh / 2 + m), h - eh / 2 - m);
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(0, -50%)`;
  } else {
    x = Math.min(Math.max(x, ew / 2 + m), w - ew / 2 - m);
    y = Math.min(Math.max(y, eh + m), h - m);
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
  return inside;
}

// THE FRAMING: the camera looks at `target` from direction `dir` (a unit vector),
// as close as it can while the picture of every point of `pts` spans no more
// than `fx` and `fy` of the frame each way from its own centre (1 = the edge).
// Found by halving: projecting is cheap. -> { dist, cx, cy }, the centre of
// that picture in the frame's -1..1, for `center` to bring to the middle.
export function frame(camera, target, dir, pts, fx = 0.9, fy = 0.88) {
  // the far plane is lifted while searching: past it, every point would seem not to fit
  const far = camera.far;
  camera.far = 1e7;
  camera.clearViewOffset();
  const v = target.clone();
  const box = (d) => {
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
    for (const p of pts) {
      v.copy(p).project(camera);
      if (v.z > 1 || v.z < -1) behind = true;
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    return { x0, x1, y0, y1, behind };
  };
  let lo = 0.5, hi = 800;
  for (let i = 0; i < 40; i++) {
    const d = (lo + hi) / 2, b = box(d);
    if (!b.behind && (b.x1 - b.x0) / 2 <= fx && (b.y1 - b.y0) / 2 <= fy) hi = d; else lo = d;
  }
  const b = box(hi);
  camera.far = Math.max(far, hi * 3);
  camera.updateProjectionMatrix();
  return { dist: hi, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
}

// Moves the picture so the framed points sit in the middle of the stage, or,
// with (sx, sy), that many pixels off it (toward the free part beside a panel).
export function center(camera, w, h, fr, sx = 0, sy = 0) {
  camera.setViewOffset(w, h, fr.cx * w / 2 - sx, -fr.cy * h / 2 - sy, w, h);
}

// A direction from the target: azimuth round the y axis from +z, elevation above the floor.
export function aim(THREE, az, el) {
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

// A texture drawn on a 2D canvas (labels on things, the face of a card).
export function canvasTexture(THREE, w, h, draw, scale = 2) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export const ease = {
  out: (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3),
  inOut: (t) => { t = Math.min(Math.max(t, 0), 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
};

export const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
