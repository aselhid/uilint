import { defineConfig } from '../../../src/config.js';

export default defineConfig({
  viewports: [400],
  rules: { spacing: ['warn', { max: 3 }] },
});
