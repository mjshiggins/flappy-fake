import { build } from 'esbuild';
const common = { bundle: true, format: 'iife', target: 'chrome111', logLevel: 'info' };
await build({ ...common, entryPoints: ['src/main/index.js'], outfile: 'dist/main.js' });
await build({ ...common, entryPoints: ['src/content/bridge.js'], outfile: 'dist/bridge.js' });
await build({ ...common, entryPoints: ['src/popup/popup.js'], outfile: 'dist/popup.js' });
