import {mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';
// Bundle the runtime as ESM separately; api.cjs stays require()-compatible.
await build({entryPoints:['netlify-handler.mjs'],outfile:'server-runtime/runtime.mjs',bundle:true,platform:'node',format:'esm',target:'node18',packages:'bundle',banner:{js:"import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);"}});
// Explicit publish list: never publish .env, server code, test data, or credentials.
rmSync('dist',{recursive:true,force:true});mkdirSync('dist/vendor',{recursive:true});
for(const file of ['index.html','client.js','styles.css','pdf_template_b64.js'])copyFileSync(file,join('dist',file));
for(const [source,name] of [['lucide/dist/umd/lucide.js','lucide.js'],['xlsx/dist/xlsx.full.min.js','xlsx.js'],['pdf-lib/dist/pdf-lib.min.js','pdf-lib.js'],['jszip/dist/jszip.min.js','jszip.js']])copyFileSync(join('node_modules',source),join('dist/vendor',name));
