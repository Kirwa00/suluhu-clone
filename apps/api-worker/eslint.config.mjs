import globals from 'globals';
import rootConfig from '../../eslint.config.mjs';

/**
 * Re-exports the shared config, but swaps the Node.js globals for Workers
 * runtime globals (fetch, Request/Response, crypto, ExecutionContext, ...) —
 * this package never runs under Node.
 */
export default [
  { ignores: ['src/generated/**'] },
  ...rootConfig,
  { languageOptions: { globals: { ...globals.worker } } },
];
