import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { INK, RED, RULE, prefersReducedMotion, whenVisible } from './common';
import { FraudSim, type Tx } from './fraud-sim';

// Coordenadas x de cada etapa do pipeline.
const X = { src: -7, kafka: -4, queue: -1.9, flink: -0.6, model: 2.6, out: 6.6 };
const LANES = [-0.7, 0, 0.7]; // partições do tópico
const MAX = 900;

interface Particle {
  tx: Tx;
  t: number; // tempo de vida em segundos
  queueWait: number; // tempo visual parado na fila antes do Flink
  jitter: THREE.Vector3;
}

export interface FraudHooks {
  onTick: (m: ReturnType<FraudSim['metrics']>, sim: FraudSim) => void;
  onInspect: (tx: Tx | null) => void;
  onBlocked: (tx: Tx) => void;
}

function label(text: string, sub: string, cls = '') {
  const el = document.createElement('div');
  el.className = `stage-label ${cls}`;
  el.innerHTML = '<strong></strong><span></span>';
  el.querySelector('strong')!.textContent = text;
  el.querySelector('span')!.textContent = sub;
  return new CSS2DObject(el);
}

function box(w: number, h: number, d: number, color = INK) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color }),
  );
}

export function mountFraud(container: HTMLElement, sim: FraudSim, hooks: FraudHooks, names: Record<string, [string, string]>) {
  const reduced = prefersReducedMotion();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  camera.position.set(0.8, 5.2, 13);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'stage-labels';
  container.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.2, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 9;
  controls.maxDistance = 26;
  controls.maxPolarAngle = Math.PI * 0.49;

  // Chão quadriculado, como papel milimetrado.
  const grid = new THREE.GridHelper(17, 34, RULE, RULE);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  grid.position.y = -1.4;
  scene.add(grid);

  // Etapas do pipeline.
  const kafka = new THREE.Group();
  LANES.forEach((z) => {
    const lane = box(2.2, 0.35, 0.45);
    lane.position.set(X.kafka, 0, z);
    kafka.add(lane);
  });
  scene.add(kafka);
  const flink = box(1.6, 1.2, 2.4);
  flink.position.set(X.flink, 0, 0);
  scene.add(flink);
  const redis = box(1.2, 0.6, 1);
  redis.position.set(X.flink, 2.4, 0);
  scene.add(redis);
  const redisLink = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(X.flink, 0.6, 0), new THREE.Vector3(X.flink, 2.1, 0)]),
    new THREE.LineDashedMaterial({ color: INK, dashSize: 0.12, gapSize: 0.1 }),
  );
  redisLink.computeLineDistances();
  scene.add(redisLink);
  const model = box(1.2, 1.2, 1.2);
  model.position.set(X.model, 0, 0);
  scene.add(model);
  const approve = box(1, 0.5, 1.6);
  approve.position.set(X.out, 0.9, 0);
  scene.add(approve);
  const block = box(1, 0.5, 1.6, RED);
  block.position.set(X.out, -0.9, 0);
  scene.add(block);

  const addLabel = (key: string, pos: THREE.Vector3, cls = '') => {
    const l = label(names[key][0], names[key][1], cls);
    l.position.copy(pos);
    scene.add(l);
  };
  addLabel('src', new THREE.Vector3(X.src, -0.7, 0.9));
  addLabel('kafka', new THREE.Vector3(X.kafka, -0.8, 1.3));
  addLabel('flink', new THREE.Vector3(X.flink, -1.0, 1.4));
  addLabel('redis', new THREE.Vector3(X.flink, 3.1, 0));
  addLabel('model', new THREE.Vector3(X.model, -0.9, 0.8));
  addLabel('ok', new THREE.Vector3(X.out + 1.1, 0.9, 0));
  addLabel('block', new THREE.Vector3(X.out + 1.1, -0.9, 0), 'is-red');

  // Partículas: uma InstancedMesh, cada instância é uma transação desenhada.
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial(), MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const ink = new THREE.Color(INK);
  const red = new THREE.Color(RED);
  for (let i = 0; i < MAX; i++) mesh.setColorAt(i, ink);
  scene.add(mesh);

  const slots: (Particle | null)[] = new Array(MAX).fill(null);
  let selected: number | null = null; // id da tx inspecionada

  // Anel que marca a transação inspecionada.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 24), new THREE.MeshBasicMaterial({ color: RED, side: THREE.DoubleSide }));
  ring.visible = false;
  scene.add(ring);

  function spawn(tx: Tx) {
    const i = slots.indexOf(null);
    if (i < 0) return;
    // A espera na fila vira tempo parado na frente do Flink (comprimido para caber na tela).
    const queueWait = Math.min(4, Math.max(0, (tx.latency.queue - 1) * 0.06));
    slots[i] = {
      tx,
      t: 0,
      queueWait,
      jitter: new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.35),
    };
    mesh.setColorAt(i, ink);
  }

  const tmp = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k));
  const ease = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k));

  // Posição da partícula ao longo do trajeto, por fase.
  function place(p: Particle, out: THREE.Vector3): boolean {
    const lane = LANES[p.tx.partition];
    let t = p.t;
    const legs = [0.9, 0.6, p.queueWait, 0.6, 0.7, 0.9];
    if ((t -= legs[0]) < 0) {
      const k = 1 + t / legs[0];
      return void out.set(lerp(X.src, X.kafka, k), 0, lane), true;
    }
    if ((t -= legs[1]) < 0) {
      const k = 1 + t / legs[1];
      return void out.set(lerp(X.kafka, X.queue, k), 0, lerp(lane, lane * 0.5, k)), true;
    }
    if ((t -= legs[2]) < 0) {
      // Parada na fila: amontoado na frente do Flink.
      return void out.set(X.queue - Math.abs(p.jitter.x) * 3, p.jitter.y * 2, lane * 0.5 + p.jitter.z * 3), true;
    }
    if ((t -= legs[3]) < 0) {
      const k = 1 + t / legs[3];
      return void out.set(lerp(X.queue, X.flink + 0.4, k), lerp(p.jitter.y, p.jitter.y * 0.6, k), lerp(lane * 0.5, p.jitter.z * 1.4, ease(k))), true;
    }
    if ((t -= legs[4]) < 0) {
      const k = 1 + t / legs[4];
      return void out.set(lerp(X.flink + 0.4, X.model, k), p.jitter.y * 0.6, p.jitter.z * 1.4), true;
    }
    if ((t -= legs[5]) < 0) {
      const k = 1 + t / legs[5];
      const y = p.tx.blocked ? -0.9 : 0.9;
      return void out.set(lerp(X.model, X.out, k), lerp(p.jitter.y * 0.6, y, ease(k)), lerp(p.jitter.z * 1.4, p.jitter.z * 2, k)), true;
    }
    return t < 0.4 ? (out.set(X.out, p.tx.blocked ? -0.9 : 0.9, p.jitter.z * 2), true) : false;
  }

  // Clique numa partícula: inspeciona a transação.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return (down = null);
    down = null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // Escolhe a partícula mais próxima do raio na tela (as esferas são pequenas demais para acertar).
    let best = -1;
    let bestD = 0.35;
    slots.forEach((p, i) => {
      if (!p || !place(p, tmp)) return;
      const d = ray.ray.distanceToPoint(tmp);
      if (d < bestD) (bestD = d), (best = i);
    });
    selected = best >= 0 ? slots[best]!.tx.id : null;
    hooks.onInspect(best >= 0 ? slots[best]!.tx : null);
  });

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.position.setLength(w < 600 ? 26 : 16.5);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let visible = true;
  whenVisible(container, (v) => (visible = v));
  let drawn = false;
  let spawnAcc = 0;
  let tickAcc = 0;
  const clock = new THREE.Clock();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible && drawn) return;
    drawn = true;

    const attacks = sim.step(dt);

    // Desenha uma amostra do fluxo; os ataques são sempre desenhados.
    const perSec = Math.min(45, Math.max(6, sim.params.tps / 120));
    spawnAcc += dt * perSec * (reduced ? 0.4 : 1);
    while (spawnAcc >= 1) {
      spawnAcc--;
      const tx = sim.makeTx();
      spawn(tx);
      if (tx.blocked) hooks.onBlocked(tx);
    }
    attacks.forEach((tx) => {
      spawn(tx);
      if (tx.blocked) hooks.onBlocked(tx);
    });

    ring.visible = false;
    for (let i = 0; i < MAX; i++) {
      const p = slots[i];
      if (!p) {
        mesh.setMatrixAt(i, hidden);
        continue;
      }
      p.t += dt;
      if (!place(p, tmp)) {
        slots[i] = null;
        mesh.setMatrixAt(i, hidden);
        continue;
      }
      // Fica vermelha a partir do modelo, se for bloqueada.
      const decided = tmp.x > X.model;
      mesh.setColorAt(i, decided && p.tx.blocked ? red : ink);
      const s = p.tx.attack ? 1.4 : 1;
      m4.makeScale(s, s, s).setPosition(tmp);
      mesh.setMatrixAt(i, m4);
      if (p.tx.id === selected) {
        ring.visible = true;
        ring.position.copy(tmp);
        ring.lookAt(camera.position);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // O Flink "esquenta" quando a utilização passa de 85%.
    (flink.material as THREE.LineBasicMaterial).color.set(sim.utilization > 0.85 ? RED : INK);

    tickAcc += dt;
    if (tickAcc > 0.25) {
      tickAcc = 0;
      hooks.onTick(sim.metrics(), sim);
    }
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return {
    clearSelection() {
      selected = null;
    },
  };
}
