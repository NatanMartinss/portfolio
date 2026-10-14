import type { Lang } from '../i18n/ui';

type L = Record<Lang, string>;

export interface ArchNode {
  id: string;
  label: string;
  sub: L;
  col: number; // coluna no diagrama (0..n)
  row: number; // linha no diagrama (0..n)
}

export interface Project {
  slug: string;
  num: string;
  status: 'building' | 'live' | 'planned';
  title: L;
  kicker: L; // domínio
  tagline: L;
  problem: L;
  how: Record<Lang, string[]>;
  stack: string[];
  nodes: ArchNode[];
  edges: [string, string][];
  reality: Record<Lang, { real: string[]; sim: string[]; todo: string[] }>;
  hasDemo: boolean;
  repo?: string; // repositório público do projeto
}

export const projects: Project[] = [
  {
    slug: 'fraud-stream',
    repo: 'https://github.com/NatanMartinss/fraud-stream',
    num: '01',
    status: 'building',
    hasDemo: true,
    kicker: { en: 'Finance · low latency', pt: 'Finanças · baixa latência' },
    title: { en: 'Real-time fraud detection', pt: 'Detecção de fraude em tempo real' },
    tagline: {
      en: 'Thousands of card transactions per second, each scored and blocked or approved within a 20 ms latency budget.',
      pt: 'Milhares de transações de cartão por segundo, cada uma pontuada e bloqueada ou aprovada dentro de uma meta de 20 ms.',
    },
    problem: {
      en: 'A fraud decision is only useful before the payment clears. That turns a modelling problem into a latency budget: features must be computed over sliding windows, user profiles fetched from memory, and the model evaluated, all inside a single authorization round-trip.',
      pt: 'Uma decisão de fraude só serve se vier antes do pagamento ser aprovado. Isso transforma um problema de modelagem num orçamento de latência: features calculadas em janelas deslizantes, perfil do usuário buscado em memória e modelo avaliado, tudo dentro de uma única ida e volta da autorização.',
    },
    how: {
      en: [
        'Transactions land on a partitioned Redpanda topic, keyed by card so each card’s events stay ordered.',
        'Flink keeps per-card state: transaction velocity over 60 s, amount z-score against the card’s history, distance from the last location.',
        'Redis holds the long-lived profile (typical merchants, home region) so the stream job never touches a database.',
        'A gradient-boosted model, compiled to native code, turns features into a fraud probability. A threshold, tuned on the cost of false blocks versus missed fraud, makes the call.',
      ],
      pt: [
        'As transações chegam num tópico particionado do Redpanda, com chave pelo cartão, para que os eventos de cada cartão fiquem em ordem.',
        'O Flink mantém estado por cartão: velocidade de transações em 60 s, z-score do valor contra o histórico do cartão, distância da última localização.',
        'O Redis guarda o perfil de longo prazo (comerciantes habituais, região de origem), então o job de streaming nunca toca um banco de dados.',
        'Um modelo de gradient boosting, compilado para código nativo, transforma as features numa probabilidade de fraude. Um limiar, ajustado pelo custo de bloquear à toa versus deixar passar fraude, toma a decisão.',
      ],
    },
    stack: ['Redpanda', 'Apache Flink', 'Redis', 'XGBoost → TL2cgen', 'Prometheus'],
    nodes: [
      { id: 'pos', label: 'POS / API', sub: { en: 'card swipes', pt: 'passagens de cartão' }, col: 0, row: 1 },
      { id: 'rp', label: 'Redpanda', sub: { en: 'partitioned log', pt: 'log particionado' }, col: 1, row: 1 },
      { id: 'flink', label: 'Flink', sub: { en: 'windowed features', pt: 'features em janela' }, col: 2, row: 1 },
      { id: 'redis', label: 'Redis', sub: { en: 'user profile', pt: 'perfil do usuário' }, col: 2, row: 0 },
      { id: 'model', label: 'XGBoost', sub: { en: 'compiled scorer', pt: 'scorer compilado' }, col: 3, row: 1 },
      { id: 'ok', label: 'Approve', sub: { en: 'p ≤ threshold', pt: 'p ≤ limiar' }, col: 4, row: 0 },
      { id: 'block', label: 'Block', sub: { en: 'p > threshold', pt: 'p > limiar' }, col: 4, row: 2 },
    ],
    edges: [['pos', 'rp'], ['rp', 'flink'], ['redis', 'flink'], ['flink', 'model'], ['model', 'ok'], ['model', 'block']],
    reality: {
      en: {
        real: ['The scoring function and threshold logic in the demo run live in your browser.', 'Precision, recall and latency percentiles are computed live from every simulated transaction, not just the drawn ones.'],
        sim: ['Transactions are synthetic, generated from two distributions (legit, fraud).', 'Stage latencies come from a queueing model, not from a measured cluster.', 'The demo model is a hand-weighted logistic score, standing in for XGBoost.'],
        todo: ['Redpanda + Flink + Redis pipeline (docker-compose)', 'XGBoost trained on a public fraud dataset', 'Load test with measured p99'],
      },
      pt: {
        real: ['A função de pontuação e a lógica de limiar da demo rodam ao vivo no seu navegador.', 'Precisão, recall e percentis de latência são calculados ao vivo a partir de todas as transações simuladas, não só das desenhadas.'],
        sim: ['As transações são sintéticas, geradas a partir de duas distribuições (legítima e fraude).', 'As latências das etapas vêm de um modelo de filas, não de um cluster medido.', 'O modelo da demo é um score logístico com pesos manuais, no lugar do XGBoost.'],
        todo: ['Pipeline Redpanda + Flink + Redis (docker-compose)', 'XGBoost treinado num dataset público de fraude', 'Teste de carga com p99 medido'],
      },
    },
  },
  {
    slug: 'rag-guard',
    repo: 'https://github.com/NatanMartinss/rag-guard',
    num: '02',
    status: 'building',
    hasDemo: true,
    kicker: { en: 'Generative AI · LLMOps', pt: 'IA generativa · LLMOps' },
    title: { en: 'Multimodal RAG with a governance layer', pt: 'RAG multimodal com camada de governança' },
    tagline: {
      en: 'Answers questions from text, tables and charts in PDFs, and audits every prompt and answer for leaked data and hallucination.',
      pt: 'Responde perguntas a partir de textos, tabelas e gráficos em PDFs, e audita cada prompt e resposta contra vazamento de dados e alucinação.',
    },
    problem: {
      en: 'Corporate knowledge lives in PDFs full of tables and charts that plain text extraction destroys. And once an LLM can read those documents, something has to stop it from repeating a salary or inventing a number.',
      pt: 'O conhecimento corporativo vive em PDFs cheios de tabelas e gráficos que a extração de texto simples destrói. E quando um LLM consegue ler esses documentos, algo precisa impedir que ele repita um salário ou invente um número.',
    },
    how: {
      en: [
        'Documents are parsed into typed elements (paragraph, table, figure); tables keep their structure and figures get a generated description.',
        'Elements are embedded and stored in Qdrant with their source page, so every answer can cite.',
        'A LangGraph agent decides whether to search, read a table, or ask for clarification.',
        'A gateway in front of the model caches, rate-limits, and sends every exchange to an async audit queue: PII detection, groundedness against retrieved sources, toxicity.',
      ],
      pt: [
        'Os documentos são separados em elementos tipados (parágrafo, tabela, figura); tabelas mantêm a estrutura e figuras ganham uma descrição gerada.',
        'Os elementos viram embeddings e vão para o Qdrant com a página de origem, para que toda resposta possa citar a fonte.',
        'Um agente em LangGraph decide se busca, lê uma tabela ou pede esclarecimento.',
        'Um gateway na frente do modelo faz cache, limita requisições e envia cada troca para uma fila de auditoria assíncrona: detecção de PII, aderência às fontes recuperadas, toxicidade.',
      ],
    },
    stack: ['Unstructured', 'Qdrant', 'LangGraph', 'RabbitMQ', 'vLLM', 'FastAPI'],
    nodes: [
      { id: 'pdf', label: 'PDFs', sub: { en: 'text · tables · charts', pt: 'texto · tabelas · gráficos' }, col: 0, row: 0 },
      { id: 'etl', label: 'Parser', sub: { en: 'typed elements', pt: 'elementos tipados' }, col: 1, row: 0 },
      { id: 'qd', label: 'Qdrant', sub: { en: 'vector index', pt: 'índice vetorial' }, col: 2, row: 0 },
      { id: 'user', label: 'User', sub: { en: 'question', pt: 'pergunta' }, col: 0, row: 2 },
      { id: 'gw', label: 'Gateway', sub: { en: 'cache · limits', pt: 'cache · limites' }, col: 1, row: 2 },
      { id: 'agent', label: 'LangGraph', sub: { en: 'agent', pt: 'agente' }, col: 2, row: 2 },
      { id: 'audit', label: 'Audit', sub: { en: 'PII · grounding', pt: 'PII · aderência' }, col: 3, row: 1 },
    ],
    edges: [['pdf', 'etl'], ['etl', 'qd'], ['user', 'gw'], ['gw', 'agent'], ['agent', 'qd'], ['gw', 'audit']],
    reality: {
      en: {
        real: [
          'Retrieval is real: TF-IDF vectors with cosine similarity over 20 chunks, and the 3D layout is a PCA of those vectors computed in your browser.',
          'The ACL filter, the cache, the token-bucket rate limit, the prompt-injection rules, PII redaction and the grounding check are the actual logic.',
          'Millisecond timings in the trace are measured on your machine.',
        ],
        sim: [
          'The documents belong to a fictional company; names, CPFs and contacts are invented.',
          'There is no LLM: answers are extractive (sentences copied from the sources). The “lying LLM” switch alters a number on purpose so the grounding check has something to catch.',
          'TF-IDF stands in for dense embeddings, and the audit queue is a list on the page, not RabbitMQ.',
        ],
        todo: ['PDF parsing of real tables and charts (Unstructured)', 'Qdrant with dense embeddings and payload ACL filters', 'LangGraph agent and a real LLM behind the gateway', 'PII and grounding models (instead of rules) consuming from RabbitMQ'],
      },
      pt: {
        real: [
          'A recuperação é real: vetores TF-IDF com similaridade de cosseno sobre 20 trechos, e o layout 3D é um PCA desses vetores calculado no seu navegador.',
          'O filtro de ACL, o cache, o limite de requisições por balde de tokens, as regras de prompt injection, o mascaramento de PII e a checagem de aderência são a lógica de verdade.',
          'Os tempos em milissegundos no rastro são medidos na sua máquina.',
        ],
        sim: [
          'Os documentos são de uma empresa fictícia; nomes, CPFs e contatos são inventados.',
          'Não há LLM: as respostas são extrativas (frases copiadas das fontes). O botão do “LLM mentiroso” altera um número de propósito, para a checagem de aderência ter o que pegar.',
          'TF-IDF substitui embeddings densos, e a fila de auditoria é uma lista na página, não o RabbitMQ.',
        ],
        todo: ['Parsing de PDFs com tabelas e gráficos reais (Unstructured)', 'Qdrant com embeddings densos e filtros de ACL no payload', 'Agente em LangGraph e um LLM de verdade atrás do gateway', 'Modelos de PII e aderência (no lugar de regras) consumindo do RabbitMQ'],
      },
    },
  },
  {
    slug: 'iot-maintenance',
    repo: 'https://github.com/NatanMartinss/iot-maintenance',
    num: '03',
    status: 'building',
    hasDemo: true,
    kicker: { en: 'IoT · edge', pt: 'IoT · borda' },
    title: { en: 'Predictive maintenance from vibration', pt: 'Manutenção preditiva por vibração' },
    tagline: {
      en: 'Sensors on industrial machines stream vibration and temperature; an unsupervised model flags a failing bearing days ahead.',
      pt: 'Sensores em máquinas industriais transmitem vibração e temperatura; um modelo não supervisionado aponta um rolamento falhando dias antes.',
    },
    problem: {
      en: 'Failures are rare, so there is almost nothing labelled to learn from. The model has to learn what normal looks like for each machine and notice drift, without drowning operators in false alarms.',
      pt: 'Falhas são raras, então quase não há dados rotulados para aprender. O modelo precisa aprender como é o normal de cada máquina e perceber o desvio, sem afogar os operadores em alarmes falsos.',
    },
    how: {
      en: [
        'Sensors publish over MQTT; a bridge writes raw readings to InfluxDB.',
        'Airflow computes spectral features (FFT bands, RMS, kurtosis) per machine every few minutes.',
        'An Isolation Forest per machine scores each window; a smoothed score crossing a threshold opens an alert.',
        'This is the one project designed to run live on this server, with simulated machines.',
      ],
      pt: [
        'Os sensores publicam via MQTT; uma ponte grava as leituras brutas no InfluxDB.',
        'O Airflow calcula features espectrais (bandas de FFT, RMS, curtose) por máquina a cada poucos minutos.',
        'Um Isolation Forest por máquina pontua cada janela; um score suavizado que cruza o limiar abre um alerta.',
        'Este é o único projeto pensado para rodar ao vivo neste servidor, com máquinas simuladas.',
      ],
    },
    stack: ['MQTT (Mosquitto)', 'InfluxDB', 'Apache Airflow', 'scikit-learn', 'Grafana'],
    nodes: [
      { id: 's', label: 'Sensors', sub: { en: 'vibration · temp', pt: 'vibração · temp' }, col: 0, row: 1 },
      { id: 'mq', label: 'MQTT', sub: { en: 'broker', pt: 'broker' }, col: 1, row: 1 },
      { id: 'ifx', label: 'InfluxDB', sub: { en: 'time series', pt: 'séries temporais' }, col: 2, row: 1 },
      { id: 'af', label: 'Airflow', sub: { en: 'FFT features', pt: 'features FFT' }, col: 3, row: 0 },
      { id: 'if', label: 'Isolation Forest', sub: { en: 'per machine', pt: 'por máquina' }, col: 3, row: 2 },
      { id: 'al', label: 'Alerts', sub: { en: 'smoothed score', pt: 'score suavizado' }, col: 4, row: 1 },
    ],
    edges: [['s', 'mq'], ['mq', 'ifx'], ['ifx', 'af'], ['af', 'if'], ['if', 'al']],
    reality: {
      en: {
        real: [
          'The FFT, the features (RMS, kurtosis, crest factor, band energies) and the Isolation Forest are implemented from scratch and run in your browser.',
          'The model is trained when the page loads, only on healthy windows; the threshold is the 99.5th percentile of their scores.',
          'Lead times in the timeline come from the model’s actual alerts in your run.',
        ],
        sim: [
          'The vibration signal is synthetic: shaft harmonics, noise, and bearing impacts at the outer-race defect frequency ringing a structural resonance.',
          'Degradation follows a fixed 21-day exponential curve; time is compressed.',
          'Known limitation: overheating moves a single sensor, and the Isolation Forest score saturates above its training range, so for that fault the model is usually not earlier than the classic temperature alarm.',
        ],
        todo: ['Hybrid detector: per-sensor physical limits alongside the model', 'MQTT broker, InfluxDB and Airflow running live on this server', 'Validation on a public bearing dataset (e.g. NASA IMS / CWRU)', 'Grafana dashboard'],
      },
      pt: {
        real: [
          'A FFT, as features (RMS, curtose, fator de crista, energia por banda) e o Isolation Forest foram implementados do zero e rodam no seu navegador.',
          'O modelo é treinado quando a página carrega, só com janelas saudáveis; o limiar é o percentil 99,5 dos scores delas.',
          'As antecedências na linha do tempo vêm dos alertas reais do modelo na sua execução.',
        ],
        sim: [
          'O sinal de vibração é sintético: harmônicos do eixo, ruído e impactos do rolamento na frequência de defeito da pista externa, excitando uma ressonância estrutural.',
          'A degradação segue uma curva exponencial fixa de 21 dias; o tempo é comprimido.',
          'Limitação conhecida: o superaquecimento mexe num único sensor, e o score do Isolation Forest satura acima da faixa de treino; nesse defeito o modelo geralmente não avisa antes do alarme clássico de temperatura.',
        ],
        todo: ['Detector híbrido: limites físicos por sensor ao lado do modelo', 'Broker MQTT, InfluxDB e Airflow rodando ao vivo neste servidor', 'Validação num dataset público de rolamentos (ex.: NASA IMS / CWRU)', 'Dashboard no Grafana'],
      },
    },
  },
  {
    slug: 'feature-store',
    repo: 'https://github.com/NatanMartinss/feature-store',
    num: '04',
    status: 'building',
    hasDemo: true,
    kicker: { en: 'MLOps · data platform', pt: 'MLOps · plataforma de dados' },
    title: { en: 'A feature store without leakage', pt: 'Uma feature store sem vazamento' },
    tagline: {
      en: 'One definition per feature, served offline for training and online for inference, with point-in-time joins that never peek at the future.',
      pt: 'Uma definição por feature, servida offline para treino e online para inferência, com joins point-in-time que nunca espiam o futuro.',
    },
    problem: {
      en: 'Most production models are worse than their notebooks because training used a value that did not exist yet at prediction time. A feature store exists to make that mistake impossible, and to stop five teams from computing “active users” five different ways.',
      pt: 'A maioria dos modelos em produção é pior do que no notebook porque o treino usou um valor que ainda não existia no momento da previsão. Uma feature store existe para tornar esse erro impossível, e para impedir que cinco times calculem “usuários ativos” de cinco jeitos diferentes.',
    },
    how: {
      en: [
        'Features are declared once (source, entity, transformation, freshness) in a registry.',
        'The offline store keeps full history; training sets are built with point-in-time joins: for each label, the latest feature value strictly before the label’s timestamp.',
        'Materialisation jobs push the latest values to Redis for millisecond online reads.',
        'A consistency check compares online and offline values for the same entity and time.',
      ],
      pt: [
        'As features são declaradas uma vez (fonte, entidade, transformação, frescor) num registro.',
        'O armazenamento offline guarda o histórico completo; os conjuntos de treino são montados com joins point-in-time: para cada rótulo, o valor mais recente da feature estritamente antes do timestamp do rótulo.',
        'Jobs de materialização enviam os valores mais recentes para o Redis, para leituras online em milissegundos.',
        'Uma checagem de consistência compara os valores online e offline para a mesma entidade e instante.',
      ],
    },
    stack: ['Feast', 'DuckDB / Parquet', 'Redis', 'Apache Airflow', 'Great Expectations'],
    nodes: [
      { id: 'src', label: 'Sources', sub: { en: 'events · tables', pt: 'eventos · tabelas' }, col: 0, row: 1 },
      { id: 'reg', label: 'Registry', sub: { en: 'feature defs', pt: 'definições' }, col: 1, row: 0 },
      { id: 'off', label: 'Offline', sub: { en: 'Parquet history', pt: 'histórico Parquet' }, col: 2, row: 1 },
      { id: 'on', label: 'Online', sub: { en: 'Redis latest', pt: 'Redis mais recente' }, col: 3, row: 0 },
      { id: 'train', label: 'Training', sub: { en: 'point-in-time', pt: 'point-in-time' }, col: 3, row: 2 },
      { id: 'serve', label: 'Inference', sub: { en: '< 5 ms read', pt: 'leitura < 5 ms' }, col: 4, row: 0 },
    ],
    edges: [['src', 'off'], ['reg', 'off'], ['off', 'on'], ['off', 'train'], ['on', 'serve']],
    reality: {
      en: {
        real: [
          'The point-in-time join, the TTL rule and the leak detection in the timeline are the actual logic, running in your browser.',
          'The experiment really trains two logistic regressions on 2,800 rows and scores them on 1,200, computing AUC with the Mann–Whitney statistic.',
        ],
        sim: [
          'Customers and their behaviour are synthetic, generated so that activity stops after churn, which is exactly what makes “latest value” leak.',
          'The registry entry is illustrative; no Feast server sits behind this page.',
        ],
        todo: ['Feast repository with offline (Parquet/DuckDB) and online (Redis) stores', 'Materialisation job in Airflow', 'Online/offline consistency check with Great Expectations'],
      },
      pt: {
        real: [
          'O join point-in-time, a regra de TTL e a detecção de vazamento na linha do tempo são a lógica de verdade, rodando no seu navegador.',
          'O experimento realmente treina duas regressões logísticas com 2.800 linhas e as avalia em 1.200, calculando o AUC pela estatística de Mann–Whitney.',
        ],
        sim: [
          'Os clientes e o comportamento deles são sintéticos, gerados para que a atividade pare depois do churn, que é exatamente o que faz o “último valor” vazar.',
          'A entrada do registro é ilustrativa; não há um servidor Feast por trás desta página.',
        ],
        todo: ['Repositório Feast com armazenamento offline (Parquet/DuckDB) e online (Redis)', 'Job de materialização no Airflow', 'Checagem de consistência online/offline com Great Expectations'],
      },
    },
  },
];
