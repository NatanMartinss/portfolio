import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { INK, RED, RULE, prefersReducedMotion, whenVisible } from './common';

export interface HeroNode {
  slug: string;
  num: string;
  title: string;
  href: string;
}

// Textura de ponto redondo, compartilhada por todas as nuvens de pontos.
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const lineMat = (color = INK, opacity = 1) =>
  new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });

// Um glifo por projeto: um pequeno desenho técnico do que o sistema faz.
function glyphFor(slug: string, dot: THREE.Texture) {
  const g = new THREE.Group();
  const pts = (positions: number[], color = INK, size = 0.06) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color, size, map: dot, alphaTest: 0.5, transparent: true }),
    );
  };

  if (slug === 'fraud-stream') {
    // Um fluxo de transações; algumas (vermelhas) são desviadas.
    const ink: number[] = [];
    for (let i = 0; i < 70; i++) ink.push(-0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.18);
    const flow = pts(ink);
    flow.userData.flow = true;
    g.add(flow);
    const red: number[] = [];
    for (let i = 0; i < 6; i++) red.push(0.2 + Math.random() * 0.5, -0.15 - Math.random() * 0.35, (Math.random() - 0.5) * 0.1);
    g.add(pts(red, RED, 0.08));
    const rail = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.9, -0.14, 0), new THREE.Vector3(0.9, -0.14, 0)]);
    g.add(new THREE.Line(rail, lineMat(INK, 0.5)));
  } else if (slug === 'rag-guard') {
    // Espaço vetorial: esfera de Fibonacci, uma consulta e seus vizinhos.
    const p: number[] = [];
    const n = 140;
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      const s = 0.55 * (0.75 + Math.random() * 0.25);
      p.push(Math.cos(th) * r * s, y * s, Math.sin(th) * r * s);
    }
    g.add(pts(p, INK, 0.045));
    const q = new THREE.Vector3(0.15, 0.1, 0.2);
    g.add(pts([q.x, q.y, q.z], RED, 0.12));
    const near: THREE.Vector3[] = [];
    for (let i = 0; i < n; i += 23) near.push(q, new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(near), lineMat(INK, 0.45)));
  } else if (slug === 'iot-maintenance') {
    // Uma máquina (cilindro) e o sinal de vibração acima dela.
    const cyl = new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 14, 1));
    g.add(new THREE.LineSegments(cyl, lineMat()));
    const wave: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) wave.push(new THREE.Vector3(-0.6 + i * 0.02, 0.6, 0));
    const wl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(wave), lineMat(RED));
    wl.userData.wave = true;
    g.add(wl);
  } else {
    // Fatias de tempo empilhadas e o corte point-in-time.
    for (let i = 0; i < 5; i++) {
      const slab = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.02, 0.5));
      const m = new THREE.LineSegments(slab, lineMat(INK, 0.35 + i * 0.15));
      m.position.set(0, -0.4 + i * 0.2, 0);
      g.add(m);
    }
    const cut = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.15, -0.55, 0.26), new THREE.Vector3(0.15, 0.55, 0.26)]);
    g.add(new THREE.Line(cut, lineMat(RED)));
  }
  return g;
}

export function mountHero(container: HTMLElement, nodes: HeroNode[]) {
  const reduced = prefersReducedMotion();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 3.2, 10.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'hero-labels';
  container.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.5;
  controls.target.set(0, -0.2, 0);
  controls.minPolarAngle = Math.PI * 0.25;
  controls.maxPolarAngle = Math.PI * 0.55;

  const dot = dotTexture();
  const root = new THREE.Group();
  scene.add(root);

  // Base gravada: anéis concêntricos e marcas radiais.
  const plate = new THREE.Group();
  for (const r of [1.4, 2.8, 3.6]) {
    const c = new THREE.EllipseCurve(0, 0, r, r).getPoints(128).map((p) => new THREE.Vector3(p.x, 0, p.y));
    plate.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c), lineMat(RULE)));
  }
  const ticks: THREE.Vector3[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r0 = i % 6 === 0 ? 3.45 : 3.55;
    ticks.push(new THREE.Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0), new THREE.Vector3(Math.cos(a) * 3.6, 0, Math.sin(a) * 3.6));
  }
  plate.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), lineMat(RULE)));
  plate.position.y = -1.3;
  root.add(plate);

  // Núcleo: você, no centro dos sistemas.
  const core = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.32, 0)), lineMat());
  root.add(core);

  const hitTargets: THREE.Object3D[] = [];
  const pulses: { mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; offset: number }[] = [];
  const entries = nodes.map((node, i) => {
    const a = (i / nodes.length) * Math.PI * 2 + Math.PI / 10;
    const pos = new THREE.Vector3(Math.cos(a) * 2.8, i % 2 ? 0.45 : -0.15, Math.sin(a) * 2.8);

    const glyph = glyphFor(node.slug, dot);
    glyph.position.copy(pos);
    glyph.scale.setScalar(1.25);
    root.add(glyph);

    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 12, 12),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.position.copy(pos);
    hit.userData.index = i;
    root.add(hit);
    hitTargets.push(hit);

    const ctrl = pos.clone().multiplyScalar(0.5).setY(pos.y + 1.1);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), ctrl, pos);
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), lineMat(INK, 0.3)));
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), new THREE.MeshBasicMaterial({ color: RED }));
    root.add(pulse);
    pulses.push({ mesh: pulse, curve, offset: i / nodes.length });

    const el = document.createElement('a');
    el.href = node.href;
    el.className = 'hero-label';
    el.innerHTML = `<span class="hero-label-num">${node.num}</span><span class="hero-label-title"></span>`;
    el.querySelector('.hero-label-title')!.textContent = node.title;
    el.addEventListener('pointerenter', () => setHover(i));
    el.addEventListener('pointerleave', () => setHover(-1));
    el.addEventListener('focus', () => setHover(i));
    el.addEventListener('blur', () => setHover(-1));
    const label = new CSS2DObject(el);
    label.position.copy(pos).add(new THREE.Vector3(0, -0.95, 0));
    root.add(label);

    // Guarda as cores originais para restaurar depois do hover.
    const mats: { m: THREE.Material & { color: THREE.Color }; c: number }[] = [];
    glyph.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material & { color?: THREE.Color };
      if (m && m.color) mats.push({ m: m as THREE.Material & { color: THREE.Color }, c: m.color.getHex() });
    });
    return { node, glyph, el, mats };
  });

  let hovered = -1;
  function setHover(i: number) {
    if (i === hovered) return;
    hovered = i;
    entries.forEach((e, j) => {
      const on = j === i;
      e.el.classList.toggle('is-active', on);
      e.mats.forEach(({ m, c }) => m.color.setHex(on ? RED : c));
    });
    renderer.domElement.style.cursor = i >= 0 ? 'pointer' : 'grab';
    controls.autoRotate = !reduced && i < 0;
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(ev: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hitTargets, false)[0];
    return hit ? (hit.object.userData.index as number) : -1;
  }
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointermove', (ev) => setHover(pick(ev)));
  renderer.domElement.addEventListener('pointerleave', () => setHover(-1));
  renderer.domElement.addEventListener('pointerdown', (ev) => (down = { x: ev.clientX, y: ev.clientY }));
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    const i = pick(ev);
    if (moved < 6 && i >= 0) window.location.href = entries[i].node.href;
  });

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    // Em telas estreitas, afasta a câmera para caber tudo.
    camera.position.setLength(w < 560 ? 17 : 10.5);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let visible = true;
  whenVisible(container, (v) => (visible = v));
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    const t = clock.getElapsedTime();
    if (!reduced) {
      core.rotation.y = t * 0.3;
      core.rotation.x = t * 0.17;
      pulses.forEach((p) => p.mesh.position.copy(p.curve.getPoint((t * 0.25 + p.offset) % 1)));
      entries.forEach(({ glyph }) =>
        glyph.traverse((o) => {
          if (o.userData.flow) o.position.x = ((t * 0.25) % 0.4) - 0.2;
          if (o.userData.wave) {
            const pos = (o as THREE.Line).geometry.attributes.position as THREE.BufferAttribute;
            for (let i = 0; i < pos.count; i++) {
              const x = pos.getX(i);
              pos.setY(i, 0.62 + Math.sin(x * 18 + t * 5) * 0.05 + (x > 0.2 ? Math.sin(x * 61 + t * 11) * 0.06 : 0));
            }
            pos.needsUpdate = true;
          }
        }),
      );
    } else {
      pulses.forEach((p) => p.mesh.position.copy(p.curve.getPoint(0.6)));
    }
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });
}
