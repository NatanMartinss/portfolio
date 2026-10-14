import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { INK, RED, RULE, prefersReducedMotion, whenVisible } from './common';
import { CHUNKS, DOCS } from './rag-corpus';
import type { Lang } from '../i18n/ui';
import type { Role, RunResult } from './rag-sim';

const GUARD_Y = 3.2;
const START_Y = 5.4;

export interface RagView {
  play: (r: RunResult) => Promise<void>;
  setRole: (role: Role) => void;
}

export function mountRag(
  container: HTMLElement,
  coords: [number, number, number][],
  lang: Lang,
  names: { guard: string },
  onHover: (index: number | null, x: number, y: number) => void,
): RagView {
  const reduced = prefersReducedMotion();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  camera.position.set(6, 6.5, 9);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'stage-labels';
  container.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.6, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 22;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.35;
  controls.addEventListener('start', () => (controls.autoRotate = false));

  // Chão: anéis de distância, como um alvo.
  for (const r of [1.5, 3, 4.2]) {
    const pts = new THREE.EllipseCurve(0, 0, r, r).getPoints(96).map((p) => new THREE.Vector3(p.x, 0, p.y));
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: RULE })));
  }

  // Anel do guarda de entrada: toda pergunta passa por ele antes de chegar ao espaço vetorial.
  const guardMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 });
  const guardPts = new THREE.EllipseCurve(0, 0, 4.2, 4.2).getPoints(96).map((p) => new THREE.Vector3(p.x, GUARD_Y, p.y));
  const guard = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(guardPts), guardMat);
  scene.add(guard);
  const guardDisk = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 64),
    new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  guardDisk.rotation.x = -Math.PI / 2;
  guardDisk.position.y = GUARD_Y;
  scene.add(guardDisk);
  const gl = document.createElement('div');
  gl.className = 'stage-label';
  gl.innerHTML = `<strong></strong>`;
  gl.querySelector('strong')!.textContent = names.guard;
  const guardLabel = new CSS2DObject(gl);
  guardLabel.position.set(4.4, GUARD_Y, 0);
  scene.add(guardLabel);

  // Um glifo por chunk; o formato diz o tipo (texto, tabela, figura).
  const geoms = {
    text: new THREE.SphereGeometry(0.1, 14, 10),
    table: new THREE.BoxGeometry(0.2, 0.2, 0.2),
    figure: new THREE.OctahedronGeometry(0.15),
  };
  const glyphs = CHUNKS.map((c, i) => {
    const restricted = DOCS.find((d) => d.key === c.doc)!.acl === 'hr';
    const mat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geoms[c.type], mat);
    mesh.position.set(...coords[i]);
    mesh.userData.index = i;
    const edgeMat = new THREE.LineBasicMaterial({ color: INK, transparent: true });
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geoms[c.type]), edgeMat);
    edge.scale.setScalar(1.35);
    mesh.add(edge);
    // Haste até o chão, para ler a posição no espaço.
    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -coords[i][1], 0)]),
      new THREE.LineBasicMaterial({ color: RULE }),
    );
    mesh.add(stem);
    scene.add(mesh);
    const tag = document.createElement('div');
    tag.className = 'rag-rank';
    tag.hidden = true;
    const tagObj = new CSS2DObject(tag);
    tagObj.position.set(0, 0.28, 0);
    mesh.add(tagObj);
    return { mesh, mat, edgeMat, restricted, tag, base: 1 };
  });

  // Rótulos de documento no centróide de cada grupo.
  DOCS.forEach((d) => {
    const idx = CHUNKS.map((c, i) => (c.doc === d.key ? i : -1)).filter((i) => i >= 0);
    const c = idx.reduce((a, i) => a.add(new THREE.Vector3(...coords[i])), new THREE.Vector3()).divideScalar(idx.length);
    const el = document.createElement('div');
    el.className = 'rag-doc';
    el.textContent = d.title[lang];
    const o = new CSS2DObject(el);
    o.position.copy(c).setY(Math.max(...idx.map((i) => coords[i][1])) + 0.55);
    scene.add(o);
  });

  // A pergunta: um ponto vermelho que desce até sua posição no espaço vetorial.
  const query = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: RED }));
  query.visible = false;
  scene.add(query);
  const lines = new THREE.Group();
  scene.add(lines);

  function setRole(role: Role) {
    glyphs.forEach((g) => {
      const dim = g.restricted && role === 'employee';
      g.mat.opacity = dim ? 0.12 : 1;
      g.edgeMat.opacity = dim ? 0.25 : 1;
    });
  }

  // Animação simples baseada em promessas.
  const tweens: ((t: number) => boolean)[] = [];
  const tween = (ms: number, f: (k: number) => void) =>
    new Promise<void>((res) => {
      const t0 = performance.now();
      const d = reduced ? 1 : ms;
      tweens.push((now) => {
        const k = Math.min(1, (now - t0) / d);
        f(k);
        if (k >= 1) res();
        return k >= 1;
      });
    });
  const ease = (k: number) => 1 - Math.pow(1 - k, 3);

  async function play(r: RunResult) {
    lines.clear();
    glyphs.forEach((g) => {
      g.base = 1;
      g.tag.hidden = true;
      g.mat.color.set(INK);
    });
    if (r.blocked === 'rate') return;
    const target = r.queryPos ? new THREE.Vector3(...r.queryPos) : new THREE.Vector3(0, 1, 0);
    const from = new THREE.Vector3(target.x, START_Y, target.z);
    query.visible = true;
    query.position.copy(from);
    (query.material as THREE.MeshBasicMaterial).opacity = 1;

    if (r.blocked === 'injection') {
      // Bate no anel do guarda e é descartada.
      const stop = new THREE.Vector3(target.x, GUARD_Y + 0.12, target.z);
      await tween(500, (k) => query.position.lerpVectors(from, stop, ease(k)));
      guardMat.color.set(RED);
      guardMat.opacity = 1;
      await tween(700, (k) => {
        (guardDisk.material as THREE.MeshBasicMaterial).opacity = 0.18 * (1 - k);
        query.position.y = GUARD_Y + 0.12 + k * 1.2;
        query.scale.setScalar(1 - k);
      });
      query.visible = false;
      query.scale.setScalar(1);
      guardMat.color.set(INK);
      guardMat.opacity = 0.5;
      return;
    }

    await tween(r.cached ? 250 : 800, (k) => query.position.lerpVectors(from, target, ease(k)));
    // Linhas até os vizinhos recuperados, em ordem de similaridade.
    for (const [rank, h] of r.hits.entries()) {
      const g = glyphs[h.index];
      const relevant = h.score >= 0.12;
      const end = new THREE.Vector3(...coords[h.index]);
      const geo = new THREE.BufferGeometry().setFromPoints([target.clone(), target.clone()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: relevant ? RED : INK, transparent: true, opacity: relevant ? 1 : 0.3 }));
      lines.add(line);
      g.tag.hidden = false;
      g.tag.textContent = String(rank + 1);
      g.tag.classList.toggle('weak', !relevant);
      await tween(r.cached ? 60 : 180, (k) => {
        const p = target.clone().lerp(end, ease(k));
        geo.setFromPoints([target, p]);
      });
      if (relevant) {
        g.base = 1.6;
        g.mat.color.set(RED);
      }
    }
  }

  // Hover: mostra o texto do chunk.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  renderer.domElement.addEventListener('pointermove', (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // Escolhe o glifo mais próximo do raio (os glifos são pequenos).
    let best: number | null = null;
    let bestD = 0.3;
    glyphs.forEach((g, i) => {
      const d = ray.ray.distanceToPoint(g.mesh.position);
      if (d < bestD) (bestD = d), (best = i);
    });
    renderer.domElement.style.cursor = best !== null ? 'help' : 'grab';
    onHover(best, e.clientX - r.left, e.clientY - r.top);
  });
  renderer.domElement.addEventListener('pointerleave', () => onHover(null, 0, 0));

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.position.setLength(w < 600 ? 19 : 13);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let visible = true;
  let drawn = false;
  whenVisible(container, (v) => (visible = v));
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i](now)) tweens.splice(i, 1);
    if (!visible && drawn) return;
    drawn = true;
    const t = clock.getElapsedTime();
    glyphs.forEach((g, i) => {
      const s = g.base * (g.base > 1 && !reduced ? 1 + Math.sin(t * 4 + i) * 0.08 : 1);
      g.mesh.scale.setScalar(s);
      if (!reduced) g.mesh.rotation.y = t * 0.4 + i;
    });
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return { play, setRole };
}
