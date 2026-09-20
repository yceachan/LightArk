import {readdir,writeFile} from 'node:fs/promises';
const list=[];
async function walk(dir){for(const e of await readdir('dist/'+dir,{withFileTypes:true})){const path=dir+'/'+e.name;if(e.isDirectory())await walk(path);else if(/\.(js|mjs|woff2|wasm|bcmap|ttf)$/.test(path))list.push('/'+path)}}
await walk('assets');await walk('pdf');
await writeFile('dist/offline-assets.json',JSON.stringify(list));
