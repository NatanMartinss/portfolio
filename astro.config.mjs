import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://natanmartins.com.br',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'pt'],
    routing: { prefixDefaultLocale: false },
  },
});
