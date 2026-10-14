# Portfólio

No ar em https://natanmartins.com.br. Astro + Three.js, estático, bilíngue (EN padrão em `/`, PT em `/pt/`).

Projetos: [fraud-stream](https://github.com/NatanMartinss/fraud-stream) · [rag-guard](https://github.com/NatanMartinss/rag-guard) · [iot-maintenance](https://github.com/NatanMartinss/iot-maintenance) · [feature-store](https://github.com/NatanMartinss/feature-store)

## Rodar
    npm install
    npm run dev        # desenvolvimento em http://localhost:4321
    npm run build      # gera dist/
    npm run deploy     # build + copia para /var/www/portfolio (servido pelo Caddy)

## Onde mexer
- `src/config.ts`: nome, e-mail, GitHub, LinkedIn
- `src/i18n/ui.ts`: textos da interface (EN/PT)
- `src/data/projects.ts`: projetos, diagramas de arquitetura e o painel "real / simulado"
- `src/scenes/`: cenas Three.js e a lógica de cada demo (os arquivos `*-sim.ts` não dependem de Three.js)
  - `hero.ts`: capa
  - `fraud.ts` + `fraud-sim.ts`: 01, pipeline de fraude, modelo de filas
  - `rag.ts` + `rag-sim.ts` + `rag-corpus.ts`: 02, TF-IDF, PCA, ACL, guardas de PII/injeção/aderência
  - `iot.ts` + `iot-sim.ts`: 03, FFT e Isolation Forest implementados do zero
  - `fs.ts` + `fs-sim.ts`: 04, join point-in-time e experimento de vazamento
  - `chart.ts`: gráfico de linha SVG compartilhado
- `src/components/*Demo.astro`: interface de cada demo
- `src/styles/demo.css`: peças compartilhadas das demos (controles, indicadores, palco 3D)
- `src/styles/global.css`: identidade visual (cores, tipos)

## Identidade
Papel `#F4F1EA`, tinta `#111111`, vermelho `#D2392B` (texto vermelho usa `#B8301F` para contraste).
Fraunces (títulos), Inter (texto), IBM Plex Mono (legendas e números). Fontes servidas localmente.

## Regra do painel "real / simulado"
Ao concluir uma parte de um projeto, mova o item de `todo` para `real` em `projects.ts`
e troque `status` para `live`. O painel só tem valor se for honesto.
