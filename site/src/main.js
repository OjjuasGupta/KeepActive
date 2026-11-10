import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Shape, ExtrudeGeometry, Mesh,
  MeshPhysicalMaterial, MeshBasicMaterial, TorusGeometry, RingGeometry, PlaneGeometry,
  CanvasTexture, Color, PMREMGenerator, DirectionalLight, NeutralToneMapping, SRGBColorSpace,
  Points, BufferGeometry, Float32BufferAttribute, PointsMaterial, MathUtils
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const root = document.documentElement;
root.classList.add('js');

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobileQuery = matchMedia('(max-width: 820px)');

/* ---------- Page chrome ---------- */

function setupStoreLinks() {
  const url = document.querySelector('meta[name="keepactive:store-url"]')?.content.trim();
  for (const el of document.querySelectorAll('[data-store]')) {
    if (url) {
      el.href = url;
      el.rel = 'noopener';
    } else {
      el.removeAttribute('href');
      el.setAttribute('aria-disabled', 'true');
      el.title = 'Coming soon to the Chrome Web Store';
      const soon = document.createElement('span');
      soon.className = 'soon';
      soon.textContent = 'Soon';
      el.append(soon);
    }
  }
}

function setupNav() {
  const nav = document.querySelector('.nav');
  const update = () => nav.classList.toggle('is-scrolled', scrollY > 24);
  addEventListener('scroll', update, { passive: true });
  update();
}

function setupReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  items.forEach(el => io.observe(el));
}

function setupTilt() {
  if (reduceMotion.matches || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  for (const card of document.querySelectorAll('[data-tilt]')) {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', `${px * 8}deg`);
      card.style.setProperty('--rx', `${-py * 8}deg`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--ry', '0deg');
      card.style.setProperty('--rx', '0deg');
    });
  }
}

/* ---------- 3D stage ---------- */

// Brand geometry from branding/render.html (512-unit viewBox, large-size variant).
const BRAND = { tileR: 232, cx: 240, cy: 272, R: 146, cut: 66, dot: 40, ring: 16 };
const UNIT = 3.2 / 464; // brand units -> world units; tile is ~3.2 world units wide
const toWorld = (x, y) => [(x - 256) * UNIT, (256 - y) * UNIT];

const COLORS = {
  crimson: new Color('#a81f31'),
  taupe: new Color('#8d8177'),
  charcoal: new Color('#342c29'),
  cream: new Color('#f6eddf'),
  ink: new Color('#2a1f1d')
};

function squircleShape(r, n = 5, steps = 180) {
  const shape = new Shape();
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const x = r * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = r * Math.sign(s) * Math.abs(s) ** (2 / n);
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

// The cream disc minus the notch circle around the status badge.
function notchedDiscShape() {
  const [cx, cy] = toWorld(BRAND.cx, BRAND.cy);
  const R = BRAND.R * UNIT;
  const [bx, by] = badgeCenter();
  const r = BRAND.cut * UNIT;
  const theta = Math.atan2(by - cy, bx - cx);
  const d = Math.hypot(bx - cx, by - cy);
  const alpha = Math.acos((d * d + R * R - r * r) / (2 * d * R));
  const shape = new Shape();
  const N = 160;
  for (let i = 0; i <= N; i++) {
    const t = theta + alpha + (2 * Math.PI - 2 * alpha) * (i / N);
    const x = cx + R * Math.cos(t), y = cy + R * Math.sin(t);
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  // Return along the part of the notch circle that lies inside the disc.
  const angleOnNotch = t => Math.atan2(cy + R * Math.sin(t) - by, cx + R * Math.cos(t) - bx);
  const a0 = angleOnNotch(theta - alpha);
  const a1 = angleOnNotch(theta + alpha);
  let span = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const mid = a0 + span / 2;
  const facing = theta + Math.PI;
  if (Math.abs(Math.atan2(Math.sin(mid - facing), Math.cos(mid - facing))) > Math.PI / 2) span -= 2 * Math.PI;
  const M = 60;
  for (let i = 1; i < M; i++) {
    const t = a0 + span * (i / M);
    shape.lineTo(bx + r * Math.cos(t), by + r * Math.sin(t));
  }
  shape.closePath();
  return shape;
}

function badgeCenter() {
  return toWorld(BRAND.cx + BRAND.R * 0.72, BRAND.cy - BRAND.R * 0.72);
}

function circleShape(r) {
  const shape = new Shape();
  shape.absarc(0, 0, r, 0, Math.PI * 2, false);
  return shape;
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(60,20,20,0.55)');
  grad.addColorStop(0.5, 'rgba(60,20,20,0.18)');
  grad.addColorStop(1, 'rgba(60,20,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

function setupStage() {
  const canvas = document.getElementById('stage');
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    root.classList.add('no-webgl');
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;

  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  const key = new DirectionalLight('#fff0dd', 2.2);
  key.position.set(-4, 6, 7);
  const rim = new DirectionalLight('#ffd5c8', 1.6);
  rim.position.set(6, 1, -5);
  scene.add(key, rim);

  // rig: position/scale from scroll. mark: rotation from pointer, sway and spin.
  const rig = new Group();
  const mark = new Group();
  rig.add(mark);
  scene.add(rig);

  const tileDepth = 0.34, tileBevel = 0.15;
  const tileGeo = new ExtrudeGeometry(squircleShape(BRAND.tileR * UNIT - 0.09), {
    depth: tileDepth, bevelEnabled: true, bevelThickness: tileBevel, bevelSize: 0.09, bevelSegments: 12, curveSegments: 4
  });
  tileGeo.translate(0, 0, -tileDepth / 2);
  const tileMat = new MeshPhysicalMaterial({
    color: COLORS.crimson.clone(), roughness: 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.14,
    sheen: 0.5, sheenRoughness: 0.5, sheenColor: new Color('#ff9c8f')
  });
  const tile = new Mesh(tileGeo, tileMat);
  mark.add(tile);
  const front = tileDepth / 2 + tileBevel;

  const reliefOpts = { depth: 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.028, bevelSegments: 6, curveSegments: 48 };
  const creamMat = new MeshPhysicalMaterial({ color: COLORS.cream.clone(), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.25 });
  const disc = new Mesh(new ExtrudeGeometry(notchedDiscShape(), reliefOpts), creamMat);
  disc.position.z = front - 0.02;
  mark.add(disc);

  const [bx, by] = badgeCenter();
  const dot = new Mesh(new ExtrudeGeometry(circleShape(BRAND.dot * UNIT), reliefOpts), creamMat);
  dot.position.set(bx, by, front - 0.02);
  mark.add(dot);

  const ringR = (BRAND.dot - BRAND.ring / 2) * UNIT;
  const ring = new Mesh(new TorusGeometry(ringR, (BRAND.ring / 2) * UNIT * 1.05, 24, 96), creamMat);
  ring.position.set(bx, by, front + 0.04);
  mark.add(ring);

  // Presence pulses: thin rings radiating behind the tile.
  const pulses = [];
  const pulseGeo = new RingGeometry(1, 1.008, 160);
  for (let i = 0; i < 4; i++) {
    const m = new Mesh(pulseGeo, new MeshBasicMaterial({ color: '#b02536', transparent: true, opacity: 0, depthWrite: false }));
    m.position.z = -0.7;
    m.visible = false;
    rig.add(m);
    pulses.push({ mesh: m, age: Infinity });
  }

  // Orbiting particles in a tilted ring around the mark.
  const COUNT = 700;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const palette = [COLORS.crimson, COLORS.crimson, COLORS.crimson, COLORS.ink, new Color('#c9a98a')];
  for (let i = 0; i < COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = 2.5 + Math.random() ** 1.6 * 1.6;
    positions[i * 3] = Math.cos(a) * rr;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 0.22;
    positions[i * 3 + 2] = Math.sin(a) * rr;
    const c = palette[(Math.random() * palette.length) | 0];
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  const pGeo = new BufferGeometry();
  pGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  pGeo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const pMat = new PointsMaterial({ size: 0.055, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, opacity: 0.9 });
  const orbit = new Points(pGeo, pMat);
  const orbitTilt = new Group();
  orbitTilt.rotation.set(1.18, 0, -0.32);
  orbitTilt.add(orbit);
  rig.add(orbitTilt);

  const shadow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.position.set(0, -2.45, -0.9);
  shadow.scale.set(3.6, 0.6, 1);
  rig.add(shadow);

  /* Scroll keyframes */
  const keyframes = [...document.querySelectorAll('[data-scene]')];
  const parse = s => s.trim().split(/\s+/).map(Number);
  const values = el => parse((mobileQuery.matches && el.dataset.sceneM) || el.dataset.scene);

  const cur = { x: 0, y: 0, s: 1, spin: 0, state: 0 };
  let first = true;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', e => {
    pointer.tx = (e.clientX / innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  function sample() {
    const focus = innerHeight / 2;
    const anchors = keyframes.map(el => {
      const r = el.getBoundingClientRect();
      return { at: r.top + r.height / 2, v: values(el) };
    });
    if (focus <= anchors[0].at) return anchors[0].v;
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (focus <= b.at) {
        const t = MathUtils.smoothstep((focus - a.at) / (b.at - a.at), 0.18, 0.82);
        return a.v.map((v, k) => v + (b.v[k] - v) * t);
      }
    }
    return anchors[anchors.length - 1].v;
  }

  function resize() {
    const w = innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  let time = 0, intro = 0, nextPulse = 0.6, last = performance.now();
  const tmp = new Color();

  function frame() {
    // rAF timestamps can lag performance.now(); clamp so dt is never negative.
    const now = performance.now();
    const dt = MathUtils.clamp((now - last) / 1000, 0, 0.05);
    last = now;
    const still = reduceMotion.matches;
    if (!still) time += dt;
    intro = still ? 1 : Math.min(1, intro + dt / 1.9);
    const e = 1 - (1 - intro) ** 4;

    const [x, y, s, spin, state] = sample();
    const k = first || still ? 1 : 1 - Math.exp(-5 * dt);
    first = false;
    cur.x += (x - cur.x) * k;
    cur.y += (y - cur.y) * k;
    cur.s += (s - cur.s) * k;
    cur.spin += (spin - cur.spin) * k;
    cur.state += (state - cur.state) * (still ? 1 : 1 - Math.exp(-6 * dt));

    const halfH = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * camera.aspect;
    const base = Math.min(halfH, halfW * 1.1) / 2.75;
    rig.position.set(cur.x * halfW, cur.y * halfH + Math.sin(time * 0.9) * 0.08, 0);
    rig.scale.setScalar(cur.s * base * (0.82 + 0.18 * e));

    pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-3 * dt));
    pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-3 * dt));
    const tilt = still ? 0 : 1;
    mark.rotation.x = tilt * (pointer.y * 0.28 + Math.sin(time * 0.6) * 0.05) - 0.06;
    mark.rotation.y = tilt * (pointer.x * 0.42 + Math.sin(time * 0.45) * 0.16) - 0.22 + cur.spin * Math.PI * 2 - (1 - e) * 2.4;
    mark.rotation.z = tilt * Math.sin(time * 0.5) * 0.03;

    // State: 0 active (dot), 1 paused (ring), 2 off (no badge, muted disc).
    const st = MathUtils.clamp(cur.state, 0, 2);
    if (st <= 1) tmp.lerpColors(COLORS.crimson, COLORS.taupe, st);
    else tmp.lerpColors(COLORS.taupe, COLORS.charcoal, st - 1);
    tileMat.color.copy(tmp);
    tileMat.sheenColor.set(st < 0.5 ? '#ff9c8f' : '#d8cfc8');
    creamMat.color.lerpColors(COLORS.cream, COLORS.charcoal, Math.max(0, st - 1) * 0.42);
    const dotS = MathUtils.smoothstep(1 - st, 0, 1);
    const ringS = MathUtils.smoothstep(st <= 1 ? st : 2 - st, 0, 1);
    const activeAmt = 1 - MathUtils.clamp(st, 0, 1);

    // Pulses run only while "active".
    if (!still && activeAmt > 0.6 && time >= nextPulse) {
      const p = pulses.find(q => q.age === Infinity) || pulses[0];
      p.age = 0;
      nextPulse = time + 2.2 + Math.random() * 0.8;
    }
    let beat = 0;
    for (const p of pulses) {
      if (p.age === Infinity) continue;
      p.age += dt;
      const life = p.age / 4.2;
      if (life >= 1) { p.age = Infinity; p.mesh.visible = false; continue; }
      p.mesh.visible = true;
      p.mesh.scale.setScalar(2.05 + life * 3.2);
      p.mesh.material.opacity = 0.42 * (1 - life) ** 1.6 * activeAmt;
      beat = Math.max(beat, Math.max(0, 1 - p.age / 0.5));
    }
    dot.scale.setScalar(Math.max(0.0001, dotS * (1 + beat * 0.1)));
    dot.visible = dotS > 0.001;
    ring.scale.setScalar(Math.max(0.0001, ringS));
    ring.visible = ringS > 0.001;

    orbit.rotation.y = time * (0.05 + 0.07 * activeAmt);
    pMat.opacity = 0.25 + 0.65 * (1 - st / 2);
    pMat.size = 0.055 * (mobileQuery.matches ? 0.8 : 1);
    shadow.material.opacity = 0.75 - Math.sin(time * 0.9) * 0.12;

    renderer.render(scene, camera);

    if (shots && !mobileQuery.matches) {
      const r = shots.getBoundingClientRect();
      const p = MathUtils.clamp((innerHeight / 2 - (r.top + r.height / 2)) / innerHeight, -1, 1);
      shots.style.setProperty('--p', p.toFixed(3));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__ka = { rig, mark, camera, renderer, cur };
  return { renderer };
}

const shots = document.querySelector('.shots');
setupStoreLinks();
setupNav();
setupReveal();
setupTilt();
setupStage();
