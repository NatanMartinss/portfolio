// Utilidades compartilhadas pelas cenas Three.js.
export const INK = 0x111111;
export const RED = 0xd2392b;
export const RULE = 0xcfc8b8;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Só anima quando o canvas está visível na tela: poupa bateria e CPU.
export function whenVisible(el: Element, onChange: (visible: boolean) => void) {
  const io = new IntersectionObserver(([e]) => onChange(e.isIntersecting), { threshold: 0.01 });
  io.observe(el);
  return () => io.disconnect();
}
