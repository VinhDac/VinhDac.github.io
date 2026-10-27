// The page's engine. One WebGL canvas lies behind the page; every 3D room is
// drawn into it, in its own stage's place, and only while that stage is on
// screen. Three.js is fetched as the page runs: without it, or without WebGL,
// the page stays whole and quiet (the class `no-webgl`).

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const html = document.documentElement;
const canvas = document.getElementById('gl');
const wrap = document.getElementById('glwrap');
const nav = document.getElementById('nav');

// ------------------------------------------------ what works without 3D
const rise = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); rise.unobserve(e.target); }
  }
}, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 }) : null;
document.querySelectorAll('.rise').forEach((el) => (rise ? rise.observe(el) : el.classList.add('in')));

const solid = () => nav && nav.classList.toggle('solid', window.scrollY > 30);
addEventListener('scroll', solid, { passive: true });
solid();

// ------------------------------------------------ how much this device can draw
const coarse = matchMedia('(pointer: coarse)').matches;
const narrow = Math.min(screen.width, screen.height) < 760;
const cores = navigator.hardwareConcurrency || 4;
const memory = navigator.deviceMemory || 8;
let tier = (coarse && narrow) || memory <= 2 || cores <= 2 ? 0 : (cores >= 8 && memory >= 4 ? 2 : 1);
if (/[?&]debug\b/.test(location.search) && /[?&]tier=[012]\b/.test(location.search)) {
  tier = +new URLSearchParams(location.search).get('tier');      // checking only: as a phone would
}

// ------------------------------------------------ the pointer, in window pixels
const pointer = { x: -1e5, y: -1e5, at: -1e5 };
const point = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.at = performance.now(); };
addEventListener('pointermove', point, { passive: true });
addEventListener('pointerdown', point, { passive: true });
addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') pointer.x = pointer.y = -1e5; }, { passive: true });
html.addEventListener('pointerleave', () => { pointer.x = pointer.y = -1e5; });

start().catch(fail);

function fail(e) {
  html.classList.add('no-webgl');
  console.warn('The 3D rooms are off:', (e && e.message) || e);
}

async function start() {
  if (!canvas) return;
  const THREE = await import(THREE_URL);
  THREE.ColorManagement.enabled = false;            // the page's colours, as written
  const anyGL = /[?&]gl=any\b/.test(location.search);
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: tier > 0, alpha: false, stencil: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: !anyGL,           // a GPU drawn in software gets the quiet page
  });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x07080c, 1);
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

  let pr = Math.min(window.devicePixelRatio || 1, [1.25, 1.5, 2][tier]);
  let W = 0, H = 0;
  const size = () => {
    const w = html.clientWidth, h = window.innerHeight;
    if (w === W && h === H) return;
    W = w; H = h;
    canvas.style.height = h + 'px';
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
  };

  // Each stage is loaded when it comes near, and drawn while it is on screen.
  const stages = [...document.querySelectorAll('[data-scene]')].map((el) => ({
    el, name: el.dataset.scene, room: null, loading: false, w: 0, h: 0,
  }));
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const s = stages.find((x) => x.el === e.target);
      if (s && e.isIntersecting && !s.room && !s.loading) load(s);
    }
  }, { rootMargin: '60% 0px 60% 0px' });
  stages.forEach((s) => near.observe(s.el));

  async function load(s) {
    s.loading = true;
    try {
      const mod = await import(`./scenes/${s.name}.js`);
      s.room = await mod.default({
        THREE, renderer, tier, el: s.el, labels: s.el.querySelector('.labels'),
      });
      if (s.room.click) {
        s.el.addEventListener('click', (e) => {
          if (e.target.closest('.panel, a, button, input, label')) return;
          const r = s.el.getBoundingClientRect();
          s.room.click((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        });
      }
    } catch (e) {
      console.warn(`The ${s.name} room did not load:`, e);
    }
  }

  // For checking the page: ?debug exposes the rooms; &at=NAME scrolls to one,
  // &solo=NAME puts one room alone at the top (a screenshot needs no scrolling).
  if (/[?&]debug\b/.test(location.search)) {
    window.__gl = { THREE, renderer, stages };
    const q = new URLSearchParams(location.search);
    const solo = q.get('solo') && document.querySelector(`[data-scene="${q.get('solo')}"]`);
    if (solo && solo.closest('.room')) {
      document.querySelector('.hero').style.display = 'none';
      const room = solo.closest('.room');
      room.style.paddingTop = '96px';
      if (q.has('bare')) room.querySelector('.room-copy').style.display = 'none';
      document.querySelector('.page').prepend(room);
      document.querySelectorAll('.rise').forEach((e) => e.classList.add('in'));
    }
    const from = q.get('from') && document.getElementById(q.get('from'));
    if (from) {            // &from=ID: the page starts at that part of it
      const page = document.querySelector('.page');
      for (let e = from; e && e !== page; e = e.parentElement) {
        for (let n = e.previousElementSibling; n; n = n.previousElementSibling) n.style.display = 'none';
      }
      from.style.paddingTop = '96px';
      document.querySelectorAll('.rise').forEach((e) => e.classList.add('in'));
    }
    const at = q.get('at') && document.querySelector(`[data-scene="${q.get('at')}"]`);
    if (at) { html.style.scrollBehavior = 'auto'; at.scrollIntoView({ block: 'center' }); }
  }

  const FF = /[?&]debug\b/.test(location.search) ? +(new URLSearchParams(location.search).get('ff') || 0) : 0;
  const HOLD = FF > 0 && /[?&]hold\b/.test(location.search);     // checking only: stop there
  let last = performance.now();
  let drew = true;
  let frames = 0, spent = 0;
  const live = [];

  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(Math.max((now - last) / 1000, 0), 1 / 20);
    last = now;
    size();
    live.length = 0;
    for (const s of stages) {
      if (!s.room) continue;
      const r = s.el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= H || r.width < 2 || r.height < 2) continue;
      live.push([s, r]);
    }
    if (!live.length) {
      if (drew) { renderer.setScissorTest(false); renderer.clear(); drew = false; }
      return;
    }
    drew = true;
    // back to the top of the window, wherever the page has put the canvas's box
    canvas.style.transform = `translate3d(0, ${-wrap.getBoundingClientRect().top}px, 0)`;
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    const moved = now - pointer.at < 160;
    for (const [s, r] of live) {
      const w = r.width, h = r.height;
      if (Math.abs(w - s.w) > 0.5 || Math.abs(h - s.h) > 0.5) {
        s.w = w; s.h = h; s.room.resize(w, h);
        s.ff = false;
        if (window.__gl) {
          let d = document.getElementById('__dbg');
          if (!d) {
            d = document.createElement('div'); d.id = '__dbg';
            d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;color:#f4b740;font:12px monospace;white-space:pre';
            document.body.appendChild(d);
          }
          d.textContent += `${s.name} ${w.toFixed(1)}x${h.toFixed(1)} at ${(now / 1000).toFixed(2)}s\n`;
        }
      }
      if (FF && !s.ff) {     // checking only: run the room on so many seconds first
        s.ff = true;
        for (let i = 0; i < FF * 60; i++) s.room.update(1 / 60, now / 1000 - FF + i / 60, { x: -1, y: -1, inside: false, moved: false, seen: 1 });
      }
      const x = (pointer.x - r.left) / w, y = (pointer.y - r.top) / h;
      const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      const seen = (Math.min(r.bottom, H) - Math.max(r.top, 0)) / h;
      if (!(HOLD && s.ff)) s.room.update(dt, now / 1000, { x, y, inside, moved: inside && moved, seen });
      const bottom = H - r.bottom;
      renderer.setViewport(r.left, bottom, w, h);
      renderer.setScissor(r.left, bottom, w, h);
      if (s.room.render) s.room.render(renderer);
      else renderer.render(s.room.scene, s.room.camera);
    }
    // A device that cannot keep up draws fewer pixels, never fewer things.
    frames++; spent += dt;
    if (frames >= 90) {
      if (spent / frames > 1 / 38 && pr > 1) { pr = Math.max(1, pr - 0.25); W = 0; }
      frames = 0; spent = 0;
    }
  }
  requestAnimationFrame(tick);
}
