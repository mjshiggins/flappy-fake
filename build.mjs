import { build } from 'esbuild';

// One entry point. The controls live on the page in the MAIN world alongside
// the controller, so there is no popup and no ISOLATED-world bridge to build.
await build({
  bundle: true, format: 'iife', target: 'chrome111', logLevel: 'info',
  entryPoints: ['src/main/index.js'], outfile: 'dist/main.js',
});
