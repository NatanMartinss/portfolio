export type Lang = 'en' | 'pt';

export const ui = {
  en: {
    role: 'Systems architect & data scientist',
    lede: 'I design systems that move data fast and models that make sense of it. Every project below is a small working machine you can poke at.',
    figHero: 'Fig. 1 — The four systems. Drag to orbit, click a node to enter.',
    index: 'Index of work',
    open: 'Open the demo',
    about: 'About',
    aboutBody: 'I care about the seam between architecture and statistics: where latency budgets meet model calibration, and where a pipeline’s guarantees decide whether a metric can be trusted.',
    contact: 'Contact',
    status: { building: 'In construction', live: 'Live', planned: 'Planned' },
    back: '← Back to index',
    problem: 'The problem',
    howItWorks: 'How it works',
    demo: 'Interactive demo',
    reality: 'What is real, what is simulated',
    realCol: 'Real',
    simCol: 'Simulated in this demo',
    todoCol: 'Not built yet',
    stack: 'Stack',
    code: 'Code and roadmap on GitHub →',
    demoSoon: 'The interactive demo for this project is being built. The architecture and plan above are final.',
    noWebgl: 'Your browser could not start WebGL. The text and diagram still describe the whole system.',
    langSwitch: 'Português',
  },
  pt: {
    role: 'Arquiteto de sistemas & cientista de dados',
    lede: 'Projeto sistemas que movem dados rápido e modelos que dão sentido a eles. Cada projeto abaixo é uma pequena máquina funcionando, que você pode cutucar.',
    figHero: 'Fig. 1 — Os quatro sistemas. Arraste para girar, clique num nó para entrar.',
    index: 'Índice de trabalhos',
    open: 'Abrir a demo',
    about: 'Sobre',
    aboutBody: 'Me interessa a costura entre arquitetura e estatística: onde orçamentos de latência encontram calibração de modelos, e onde as garantias de um pipeline decidem se uma métrica é confiável.',
    contact: 'Contato',
    status: { building: 'Em construção', live: 'No ar', planned: 'Planejado' },
    back: '← Voltar ao índice',
    problem: 'O problema',
    howItWorks: 'Como funciona',
    demo: 'Demo interativa',
    reality: 'O que é real, o que é simulado',
    realCol: 'Real',
    simCol: 'Simulado nesta demo',
    todoCol: 'Ainda não construído',
    stack: 'Stack',
    code: 'Código e roteiro no GitHub →',
    demoSoon: 'A demo interativa deste projeto está sendo construída. A arquitetura e o plano acima são definitivos.',
    noWebgl: 'Seu navegador não conseguiu iniciar o WebGL. O texto e o diagrama ainda descrevem o sistema inteiro.',
    langSwitch: 'English',
  },
} as const;

export const t = (lang: Lang) => ui[lang];

export const projectHref = (lang: Lang, slug: string) =>
  lang === 'en' ? `/projects/${slug}/` : `/pt/projects/${slug}/`;
export const homeHref = (lang: Lang) => (lang === 'en' ? '/' : '/pt/');
