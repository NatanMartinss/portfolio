// Gráfico de linha em SVG, no estilo do site: uma série em tinta, uma linha de
// referência tracejada, marcadores verticais opcionais e crosshair com tooltip.

export interface LineChartOpts {
  label: string;
  capacity: number; // quantos pontos cabem no eixo x
  minMax: number; // valor mínimo do topo do eixo y
  step: number; // o topo do eixo y é arredondado para múltiplos disto
  format: (v: number) => string; // valor no tooltip
  axisFormat?: (v: number) => string; // valor no eixo y
  tip: (indexFromEnd: number) => string; // prefixo do tooltip (ex.: "12 s atrás")
  reference?: { value: number; text: string };
  width?: number;
  height?: number;
}

const NS = 'http://www.w3.org/2000/svg';

export function createLineChart(box: HTMLElement, o: LineChartOpts) {
  const W = o.width ?? 560;
  const H = o.height ?? 180;
  const PAD = { l: 40, r: 12, t: 12, b: 22 };
  const values: number[] = [];
  const markers: { index: number; text: string }[] = [];
  let yMax = o.minMax;
  let offsetBase = 0; // quantos pontos já saíram pela esquerda (para os marcadores)

  box.classList.add('lc');
  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img">
      <g class="lc-grid"></g>
      <line class="lc-ref" x1="${PAD.l}" x2="${W - PAD.r}" visibility="hidden"></line>
      <text class="lc-ref-text" x="${W - PAD.r}" text-anchor="end"></text>
      <g class="lc-markers"></g>
      <path class="lc-series" fill="none"></path>
      <line class="lc-cross" y1="${PAD.t}" y2="${H - PAD.b}" visibility="hidden"></line>
      <circle class="lc-dot" r="4" visibility="hidden"></circle>
      <rect class="lc-hit" x="${PAD.l}" y="0" width="${W - PAD.l - PAD.r}" height="${H}" fill="transparent"></rect>
    </svg>
    <div class="lc-tip" hidden></div>`;
  const svg = box.querySelector('svg')!;
  svg.setAttribute('aria-label', o.label);
  const tip = box.querySelector<HTMLElement>('.lc-tip')!;
  const $ = (s: string) => svg.querySelector(s)!;

  const xAt = (i: number) => PAD.l + (i / (o.capacity - 1)) * (W - PAD.l - PAD.r);
  const yAt = (v: number) => H - PAD.b - (Math.min(Math.max(v, 0), yMax) / yMax) * (H - PAD.t - PAD.b);
  const slot = (i: number) => i + (o.capacity - values.length); // posição no eixo do i-ésimo valor

  function redraw() {
    const top = Math.max(o.minMax, ...values.map((v) => v * 1.15), o.reference ? o.reference.value * 1.3 : 0);
    yMax = Math.ceil(top / o.step) * o.step;
    const g = $('.lc-grid');
    g.innerHTML = '';
    for (let k = 0; k <= 4; k++) {
      const v = (yMax / 4) * k;
      const y = yAt(v);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', String(PAD.l));
      line.setAttribute('x2', String(W - PAD.r));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      g.appendChild(line);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', String(PAD.l - 6));
      t.setAttribute('y', String(y + 4));
      t.setAttribute('text-anchor', 'end');
      t.textContent = (o.axisFormat ?? o.format)(v);
      g.appendChild(t);
    }
    if (o.reference) {
      const y = yAt(o.reference.value);
      const ref = $('.lc-ref');
      ref.setAttribute('y1', String(y));
      ref.setAttribute('y2', String(y));
      ref.setAttribute('visibility', 'visible');
      const rt = $('.lc-ref-text');
      rt.setAttribute('y', String(y - 6));
      rt.textContent = o.reference.text;
    }
    const mg = $('.lc-markers');
    mg.innerHTML = '';
    markers.forEach((m, n) => {
      const i = m.index - offsetBase;
      if (i < 0 || i >= values.length) return;
      const x = xAt(slot(i));
      const nearRight = x > W - 90;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', String(PAD.t));
      line.setAttribute('y2', String(H - PAD.b));
      mg.appendChild(line);
      const t = document.createElementNS(NS, 'text');
      // Rótulos escalonados em 3 alturas para não se sobreporem.
      t.setAttribute('x', String(nearRight ? x - 4 : x + 4));
      t.setAttribute('y', String(PAD.t + 10 + (n % 3) * 13));
      if (nearRight) t.setAttribute('text-anchor', 'end');
      t.textContent = m.text;
      mg.appendChild(t);
    });
    $('.lc-series').setAttribute(
      'd',
      values.map((v, i) => `${i ? 'L' : 'M'}${xAt(slot(i)).toFixed(1)},${yAt(v).toFixed(1)}`).join(''),
    );
  }

  const cross = $('.lc-cross');
  const dot = $('.lc-dot');
  const hit = $('.lc-hit');
  hit.addEventListener('pointermove', (e) => {
    const ev = e as PointerEvent;
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.round(((x - PAD.l) / (W - PAD.l - PAD.r)) * (o.capacity - 1)) - (o.capacity - values.length);
    if (i < 0 || i >= values.length) return;
    const cx = xAt(slot(i));
    cross.setAttribute('x1', String(cx));
    cross.setAttribute('x2', String(cx));
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(yAt(values[i])));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.textContent = `${o.tip(values.length - 1 - i)} · ${o.format(values[i])}`;
    tip.style.left = `${(cx / W) * 100}%`;
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });

  return {
    push(v: number) {
      values.push(v);
      if (values.length > o.capacity) {
        values.shift();
        offsetBase++;
      }
      redraw();
    },
    // Marca o ponto mais recente com uma linha vertical anotada.
    mark(text: string) {
      markers.push({ index: offsetBase + values.length - 1, text });
      redraw();
    },
    reset() {
      values.length = 0;
      markers.length = 0;
      offsetBase = 0;
      redraw();
    },
    setReference(value: number) {
      if (o.reference) o.reference.value = value;
      redraw();
    },
  };
}
