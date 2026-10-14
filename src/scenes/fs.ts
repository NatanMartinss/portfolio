import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { INK, RED, RULE, whenVisible } from './common';
import { NOW, join, type Customer, type JoinResult, type Strategy } from './fs-sim';

const X0 = -6.2;
const DX = 0.2; // unidades por dia
const xOf = (day: number) => X0 + day * DX;
const dayOf = (x: number) => (x - X0) / DX;
const ROWS = [-2.1, -0.7, 0.7, 2.1];
const BAR_H = 0.09; // altura por unidade de valor

export interface FsState {
  strategy: Strategy;
  ttl: number;
}

function css2d(html: string, cls: string) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return { obj: new CSS2DObject(el), el };
}

export function mountFs(
  container: HTMLElement,
  customers: Customer[],
  state: FsState,
  onChange: (results: JoinResult[]) => void,
  names: { now: string; churn: string; stayed: string },
) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  camera.position.set(-1.5, 6.5, 12);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'stage-labels';
  container.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.4, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 8;
  controls.maxDistance = 24;
  controls.maxPolarAngle = Math.PI * 0.47;

  const lineMat = (color = INK, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const seg = (a: THREE.Vector3, b: THREE.Vector3, m: THREE.Material) =>
    new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), m);

  // Eixo do tempo com marcas a cada 10 dias.
  const axisZ = ROWS[ROWS.length - 1] + 0.9;
  scene.add(seg(new THREE.Vector3(xOf(0), 0, axisZ), new THREE.Vector3(xOf(NOW), 0, axisZ), lineMat()));
  for (let d = 0; d <= NOW; d += 10) {
    scene.add(seg(new THREE.Vector3(xOf(d), 0, axisZ), new THREE.Vector3(xOf(d), 0, axisZ + 0.15), lineMat()));
    const t = css2d(`d${d}`, 'fs-tick');
    t.obj.position.set(xOf(d), 0, axisZ + 0.45);
    scene.add(t.obj);
  }

  // Plano do "agora": quando o dataset de treino é extraído.
  const nowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(ROWS[ROWS.length - 1] - ROWS[0] + 1.4, 2.4),
    new THREE.MeshBasicMaterial({ color: RULE, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  nowPlane.rotation.y = Math.PI / 2;
  nowPlane.position.set(xOf(NOW), 1.2, 0);
  scene.add(nowPlane);
  const nowLabel = css2d(`<strong>${names.now}</strong>`, 'stage-label');
  nowLabel.obj.position.set(xOf(NOW), 2.6, 0);
  scene.add(nowLabel.obj);

  interface RowView {
    c: Customer;
    bars: { mesh: THREE.LineSegments; fill: THREE.Mesh; day: number; value: number }[];
    flag: THREE.Group;
    flagHit: THREE.Mesh;
    joinLine: THREE.Line;
    joinMat: THREE.LineBasicMaterial;
    stale: THREE.Line;
    flagLabel: { obj: CSS2DObject; el: HTMLElement };
  }
  const rows: RowView[] = customers.map((c, i) => {
    const z = ROWS[i];
    scene.add(seg(new THREE.Vector3(xOf(0), 0, z), new THREE.Vector3(xOf(NOW), 0, z), lineMat(RULE)));
    const rl = css2d(`<strong>${c.id}</strong>`, 'stage-label');
    rl.obj.position.set(xOf(0) - 0.7, 0, z);
    scene.add(rl.obj);

    // Barras: cada evento da feature purchases_30d (altura = valor).
    const bars = c.events.map((e) => {
      const h = Math.max(0.03, e.value * BAR_H);
      const geo = new THREE.BoxGeometry(0.1, h, 0.1);
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.08 }));
      fill.position.set(xOf(e.day), h / 2, z);
      const mesh = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat());
      mesh.position.copy(fill.position);
      scene.add(fill, mesh);
      return { mesh, fill, day: e.day, value: e.value };
    });

    // Bandeira do rótulo: preenchida = churn, vazada = ficou.
    const flag = new THREE.Group();
    flag.add(seg(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2, 0), lineMat()));
    const tri = new THREE.Shape([new THREE.Vector2(0, 2), new THREE.Vector2(0.55, 1.8), new THREE.Vector2(0, 1.6)]);
    const triGeo = new THREE.ShapeGeometry(tri);
    if (c.churned) flag.add(new THREE.Mesh(triGeo, new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide })));
    flag.add(new THREE.LineSegments(new THREE.EdgesGeometry(triGeo), lineMat()));
    flag.position.set(xOf(c.labelDay), 0, z);
    scene.add(flag);
    const flagHit = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 2.3, 0.6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    flagHit.position.set(0.15, 1.1, 0);
    flagHit.userData.row = i;
    flag.add(flagHit);
    const flagLabel = css2d('', 'fs-flag');
    flagLabel.obj.position.set(0.3, 2.3, 0);
    flag.add(flagLabel.obj);

    const joinMat = new THREE.LineBasicMaterial({ color: INK });
    const joinLine = new THREE.Line(new THREE.BufferGeometry(), joinMat);
    scene.add(joinLine);
    const stale = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: INK, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.6 }));
    scene.add(stale);
    return { c, bars, flag, flagHit, joinLine, joinMat, stale, flagLabel };
  });

  const ink = new THREE.Color(INK);
  const red = new THREE.Color(RED);

  // Recalcula todos os joins e redesenha as ligações rótulo → valor.
  function update() {
    const results = rows.map((r) => {
      const res = join(r.c, state.strategy, state.ttl);
      r.flag.position.x = xOf(r.c.labelDay);
      r.flagLabel.el.innerHTML = `<strong>${r.c.churned ? names.churn : names.stayed}</strong><span>d${r.c.labelDay.toFixed(0)}</span>`;
      const z = r.flag.position.z;
      const from = new THREE.Vector3(r.flag.position.x, 1.6, z);
      r.bars.forEach((b) => {
        const chosen = res.event && b.day === res.event.day;
        const future = b.day >= r.c.labelDay;
        (b.mesh.material as THREE.LineBasicMaterial).color.copy(chosen && res.status === 'leak' ? red : ink);
        (b.fill.material as THREE.MeshBasicMaterial).color.copy(chosen && res.status === 'leak' ? red : ink);
        (b.fill.material as THREE.MeshBasicMaterial).opacity = chosen ? 0.75 : future ? 0.03 : 0.1;
        (b.mesh.material as THREE.LineBasicMaterial).opacity = future && !chosen ? 0.35 : 1;
        (b.mesh.material as THREE.LineBasicMaterial).transparent = true;
      });
      r.joinLine.visible = !!res.event;
      r.stale.visible = res.status === 'stale';
      if (res.event) {
        const to = new THREE.Vector3(xOf(res.event.day), Math.max(0.03, res.event.value * BAR_H) + 0.02, z);
        const mid = from.clone().lerp(to, 0.5).setY(Math.max(from.y, to.y) + 0.8);
        r.joinLine.geometry.setFromPoints(new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(32));
        r.joinMat.color.copy(res.status === 'leak' ? red : ink);
      }
      if (res.status === 'stale' && res.candidate) {
        const to = new THREE.Vector3(xOf(res.candidate.day), res.candidate.value * BAR_H + 0.02, z);
        const mid = from.clone().lerp(to, 0.5).setY(Math.max(from.y, to.y) + 0.8);
        r.stale.geometry.setFromPoints(new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(32));
        r.stale.computeLineDistances();
      }
      return res;
    });
    onChange(results);
  }

  // Arrastar uma bandeira ao longo do tempo.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let dragging: RowView | null = null;
  const setNdc = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    setNdc(e);
    const h = ray.intersectObjects(rows.map((r) => r.flagHit), false)[0];
    if (!h) return;
    dragging = rows[h.object.userData.row];
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    setNdc(e);
    if (!dragging) {
      const over = ray.intersectObjects(rows.map((r) => r.flagHit), false).length > 0;
      renderer.domElement.style.cursor = over ? 'ew-resize' : 'grab';
      return;
    }
    // Interseção com o plano horizontal na altura da bandeira.
    ground.constant = -1;
    if (!ray.ray.intersectPlane(ground, hit)) return;
    const day = Math.round(Math.min(NOW - 1, Math.max(1, dayOf(hit.x))));
    if (day !== dragging.c.labelDay) {
      dragging.c.labelDay = day;
      update();
    }
  });
  const end = () => {
    dragging = null;
    controls.enabled = true;
  };
  renderer.domElement.addEventListener('pointerup', end);
  renderer.domElement.addEventListener('pointercancel', end);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.position.setLength(w < 600 ? 22 : 14.5);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
  }
  new ResizeObserver(resize).observe(container);
  resize();
  update();

  let visible = true;
  let drawn = false;
  whenVisible(container, (v) => (visible = v));
  renderer.setAnimationLoop(() => {
    if (!visible && drawn) return;
    drawn = true;
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return { update };
}
