import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { INK, RED, RULE, prefersReducedMotion, whenVisible } from './common';
import { Machine, N, type Reading } from './iot-sim';

const edges = (geo: THREE.BufferGeometry, color = INK, opacity = 1) =>
  new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 20),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
  );

function label(text: string, sub: string) {
  const el = document.createElement('div');
  el.className = 'stage-label';
  el.innerHTML = '<strong></strong><span></span>';
  el.querySelector('strong')!.textContent = text;
  el.querySelector('span')!.textContent = sub;
  return { obj: new CSS2DObject(el), el };
}

// Cilindro deitado no eixo x, só com anéis e algumas geratrizes (aspecto de desenho técnico).
function hCylinder(r: number, len: number, rings: number, color = INK) {
  const g = new THREE.Group();
  for (let i = 0; i <= rings; i++) {
    const pts = new THREE.EllipseCurve(0, 0, r, r).getPoints(40).map((p) => new THREE.Vector3(0, p.x, p.y));
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
    ring.position.x = -len / 2 + (i / rings) * len;
    g.add(ring);
  }
  const gen: THREE.Vector3[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    gen.push(new THREE.Vector3(-len / 2, Math.cos(a) * r, Math.sin(a) * r), new THREE.Vector3(len / 2, Math.cos(a) * r, Math.sin(a) * r));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gen), new THREE.LineBasicMaterial({ color })));
  return g;
}

export interface IotHooks {
  onReadings: (r: Reading[]) => void;
}

export function mountIot(container: HTMLElement, machine: Machine, hooks: IotHooks, names: Record<string, [string, string]>) {
  const reduced = prefersReducedMotion();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  camera.position.set(4.5, 4.2, 9.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'stage-labels';
  container.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.6, -0.1, -0.6);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI * 0.49;

  const grid = new THREE.GridHelper(14, 28, RULE, RULE);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  grid.position.y = -1.25;
  scene.add(grid);

  // Base fixa (não vibra).
  const base = edges(new THREE.BoxGeometry(6.2, 0.25, 2));
  base.position.set(0.4, -1.1, 0);
  scene.add(base);

  // Conjunto que vibra: motor, eixo, mancal, bomba.
  const rig = new THREE.Group();
  scene.add(rig);

  const motor = hCylinder(0.7, 2.2, 9);
  motor.position.set(-1.6, 0, 0);
  rig.add(motor);
  const feet = edges(new THREE.BoxGeometry(1.8, 0.3, 1.3));
  feet.position.set(-1.6, -0.82, 0);
  rig.add(feet);

  const shaft = hCylinder(0.08, 3.2, 1);
  shaft.position.set(0.95, 0, 0);
  rig.add(shaft);

  // Acoplamento com uma marca que gira (mostra a rotação).
  const coupling = new THREE.Group();
  coupling.add(hCylinder(0.26, 0.3, 2));
  const mark = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.16, 0, 0), new THREE.Vector3(0.16, 0.26, 0)]),
    new THREE.LineBasicMaterial({ color: RED }),
  );
  coupling.add(mark);
  coupling.position.set(-0.25, 0, 0);
  rig.add(coupling);

  // Mancal: é ele que falha, e é ele que "esquenta" de cor com o score.
  const bearingMat = new THREE.LineBasicMaterial({ color: INK });
  const bearing = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.6, 1.0, 1.0)), bearingMat);
  bearing.position.set(0.9, -0.3, 0);
  rig.add(bearing);
  const bearingRing = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, 0.3, 0.3).getPoints(32).map((p) => new THREE.Vector3(0.31, p.x, p.y))),
    bearingMat,
  );
  bearingRing.position.set(0.9, 0, 0);
  rig.add(bearingRing);

  // Sensores no topo do mancal: acelerômetro e temperatura.
  const sensor = edges(new THREE.BoxGeometry(0.22, 0.14, 0.22));
  sensor.position.set(0.9, 0.27, 0);
  rig.add(sensor);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: RED }));
  led.position.set(0.9, 0.38, 0);
  rig.add(led);

  // Bomba com rotor de pás.
  const pump = hCylinder(0.75, 0.7, 3);
  pump.position.set(2.75, 0, 0);
  rig.add(pump);
  const rotor = new THREE.Group();
  const blades: THREE.Vector3[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    blades.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, Math.cos(a) * 0.62, Math.sin(a) * 0.62));
  }
  rotor.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(blades), new THREE.LineBasicMaterial({ color: INK })));
  rotor.position.set(3.1, 0, 0);
  rig.add(rotor);

  // Infra: broker MQTT e InfluxDB, atrás da máquina.
  const broker = edges(new THREE.BoxGeometry(0.9, 0.5, 0.6));
  broker.position.set(0.9, 0.2, -2.8);
  scene.add(broker);
  const influx = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const disk = hCylinder(0.35, 0.18, 1);
    disk.rotation.z = Math.PI / 2;
    disk.position.y = i * 0.24;
    influx.add(disk);
  }
  influx.position.set(3.4, -0.05, -2.8);
  scene.add(influx);

  const lab = (key: string, pos: THREE.Vector3, parent: THREE.Object3D = scene) => {
    const l = label(names[key][0], names[key][1]);
    l.obj.position.copy(pos);
    parent.add(l.obj);
    return l;
  };
  lab('motor', new THREE.Vector3(-1.6, -1.2, 1.2));
  const bearingLabel = lab('bearing', new THREE.Vector3(0.9, -1.2, 1.2));
  lab('pump', new THREE.Vector3(2.75, -1.2, 1.2));
  lab('broker', new THREE.Vector3(0.9, 0.85, -2.8));
  lab('influx', new THREE.Vector3(3.4, 0.85, -2.8));
  lab('sensor', new THREE.Vector3(0.9, 0.95, 0), rig);

  // Pacotes MQTT: sensor → broker → InfluxDB, um por leitura.
  const packets: { mesh: THREE.Mesh; t: number; curve: THREE.CatmullRomCurve3 }[] = [];
  const packetGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const packetMat = new THREE.MeshBasicMaterial({ color: INK });
  const route = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.9, 0.4, 0),
    new THREE.Vector3(0.9, 1.4, -1.3),
    new THREE.Vector3(0.9, 0.5, -2.8),
    new THREE.Vector3(2.2, 0.6, -2.8),
    new THREE.Vector3(3.4, 0.3, -2.8),
  ]);
  scene.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(route.getPoints(60)),
      new THREE.LineDashedMaterial({ color: INK, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.5 }),
    ).computeLineDistances(),
  );

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.position.setLength(w < 600 ? 15 : 11);
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
  const ink = new THREE.Color(INK);
  const red = new THREE.Color(RED);
  let sampleIdx = 0;
  let ledFlash = 0;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible && drawn) return;
    drawn = true;

    const readings = machine.step(dt);
    if (readings.length) {
      hooks.onReadings(readings);
      ledFlash = 1;
      packets.push({ mesh: new THREE.Mesh(packetGeo, packetMat), t: 0, curve: route });
      scene.add(packets[packets.length - 1].mesh);
    }

    // Vibração visível: o conjunto é deslocado pelo próprio sinal do acelerômetro (exagerado).
    const r = machine.last;
    if (r && !machine.failed && !reduced) {
      sampleIdx = (sampleIdx + 7) % N;
      const g = (r.signal[sampleIdx] - 0) * 0.012;
      const extra = Math.max(0, r.rms - machine.baselineRms) * 0.08;
      rig.position.set((Math.random() - 0.5) * extra, g + (Math.random() - 0.5) * extra, (Math.random() - 0.5) * extra);
    } else {
      rig.position.set(0, 0, 0);
    }

    if (!machine.failed) {
      const spin = reduced ? 0 : dt * 6;
      coupling.rotation.x += spin;
      rotor.rotation.x += spin;
    }

    // Cor do mancal: de tinta para vermelho conforme o score se aproxima do limiar.
    const s = r ? r.smooth : 0;
    const k = machine.failed ? 1 : Math.min(1, Math.max(0, (s - 0.45) / Math.max(0.01, machine.threshold - 0.45)));
    bearingMat.color.copy(ink).lerp(red, k);
    bearingLabel.el.classList.toggle('is-red', k >= 1);

    ledFlash = Math.max(0, ledFlash - dt * 4);
    led.scale.setScalar(0.6 + ledFlash * 0.8);

    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.t += dt * 0.9;
      if (p.t >= 1) {
        scene.remove(p.mesh);
        packets.splice(i, 1);
        continue;
      }
      p.mesh.position.copy(p.curve.getPoint(p.t));
    }

    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });
}
