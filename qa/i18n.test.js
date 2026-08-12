/** i18n audit: parita kľúčov sk/en/uk + každý FA_T('kľúč') v stránkach existuje. */
const fs=require('fs'), vm=require('vm');
let PASS=0, FAIL=0;
const ok=(n,c,d)=>{ if(c){PASS++;console.log('  ✓ '+n);} else {FAIL++;console.log('  ✗ '+n, d||'');} };
console.log('\n═══ I18N AUDIT ═══');
// načítaj obidva slovníky v sandboxe
const dicts={sk:{},cs:{},en:{},uk:{},hu:{},de:{}};
const ctx={ window:{}, localStorage:{getItem:()=>null,setItem:()=>{}}, navigator:{language:'sk'},
  document:{documentElement:{setAttribute:()=>{}}, addEventListener:()=>{}, querySelectorAll:()=>[], dispatchEvent:()=>{}}, fetch:()=>Promise.resolve() };
ctx.window=ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/i18n.js','utf8'), ctx);
vm.runInContext(fs.readFileSync('public/i18n-pages.js','utf8'), ctx);
// vytiahni DICT cez FA_I18N.t fallback trik: extend uložil do interného DICT — použijeme t() na overenie
const T=(lang,key)=>{ ctx.FA_I18N.setLang; // switch cur cez setLang je async fetch — obídeme: t používa cur; nastavíme cez localStorage nejde. Použijeme extend introspekciu:
  return null; };
// jednoduchšie: parsuj kľúče regexom zo súborov
function keysOf(src, lang){
  const i=src.indexOf(lang+':{'); if(i<0) return null;
  let depth=0, j=src.indexOf('{',i), start=j;
  for(; j<src.length; j++){ if(src[j]==='{')depth++; if(src[j]==='}'){depth--; if(!depth) break; } }
  const seg=src.slice(start,j);
  return new Set([...seg.matchAll(/'([a-z]+\.[a-z0-9_]+)'\s*:/g)].map(m=>m[1]));
}
const core=fs.readFileSync('public/i18n.js','utf8');
const pages=fs.readFileSync('public/i18n-pages.js','utf8');
const merged={};
for(const l of ['sk','en','uk']){
  const a=keysOf(core,l)||new Set(), b=keysOf(pages,l)||new Set();
  merged[l]=new Set([...a,...b]);
}
ok('slovníky sk/en/uk načítané', merged.sk.size>100 && merged.en.size>100 && merged.uk.size>100, {sk:merged.sk.size,en:merged.en.size,uk:merged.uk.size});
for(const l of ['en','uk']){
  const missing=[...merged.sk].filter(k=>!merged[l].has(k));
  const extra=[...merged[l]].filter(k=>!merged.sk.has(k));
  ok(`parita ${l} (chýba 0, navyše 0)`, !missing.length && !extra.length, {missing:missing.slice(0,8), extra:extra.slice(0,8)});
}
// použité kľúče v stránkach existujú v sk
for(const f of ['public/invite.html','public/obchod.html','public/profile.html','public/index.html','public/schedule.html','public/online.html']){
  const html=fs.readFileSync(f,'utf8');
  const used=new Set([...html.matchAll(/FA_T\('([a-z]+\.[a-z0-9_]+)'/g)].map(m=>m[1])
    .concat([...html.matchAll(/data-i18n(?:-ph)?="([a-z]+\.[a-z0-9_]+)"/g)].map(m=>m[1]))
    .concat([...html.matchAll(/'(shop\.[a-z0-9_]+)'/g)].map(m=>m[1])));
  const miss=[...used].filter(k=>!merged.sk.has(k));
  ok(`${f}: všetky použité kľúče existujú (${used.size})`, !miss.length, miss.slice(0,10));
}
console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
if(FAIL) process.exit(1);
