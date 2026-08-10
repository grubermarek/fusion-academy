/** E2E: Testovací účet admina — prepnutie, reset na prázdno, návrat, ochrana. */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS=0, FAIL=0;
const ok=(n,c,d)=>{ if(c){PASS++;console.log('  ✓ '+n);} else {FAIL++;console.log('  ✗ '+n+(d?' — '+JSON.stringify(d).slice(0,200):''));} };
const jars={};
async function call(jar,method,path,body){
  const headers={'Content-Type':'application/json'}; if(jars[jar]) headers['Cookie']=jars[jar];
  const r=await fetch(BASE+path,{method,headers,body:body?JSON.stringify(body):undefined});
  const sc=r.headers.get('set-cookie'); if(sc) jars[jar]=sc.split(';')[0];
  let data=null; try{data=await r.json();}catch(e){}
  return {status:r.status,data};
}
const g=(j,p)=>call(j,'GET',p), post=(j,p,b)=>call(j,'POST',p,b);
(async()=>{
  console.log('\n═══ TEST ÚČET AUDIT ═══');
  await post('admin','/api/login',{email:'admin@fusionacademy.sk',password:'admin123'});
  const sw=await post('admin','/api/admin/test-account');
  ok('prepnutie prešlo', sw.status===200 && sw.data.redirect_to==='/client-dashboard', sw);
  const me=(await g('admin','/api/me')).data||{};
  ok('som testovacia klientka (nie admin)', me.name==='Test Klientka' && !me.is_admin && me.test_account===true, me);
  ok('účet je prázdny', me.free_credits===0 && !me.membership && me.visit_count===0, me);
  const adminApi=await g('admin','/api/admin/manual-payments');
  ok('admin API v teste nedostupné (403)', adminApi.status===403, adminApi.status);
  // niečo naklikaj (booking) → pri ďalšom vstupe musí zmiznúť
  const classes=(await g('admin','/api/classes')).data||[];
  const cls=classes.find(c=>c.category!=='Online');
  await post('admin','/api/bookings',{class_id:cls._id});
  const back=await post('admin','/api/test-account/back');
  ok('návrat do admina', back.status===200 && back.data.redirect_to==='/admin', back);
  const me2=(await g('admin','/api/me')).data||{};
  ok('som zase admin', me2.is_admin===true && !me2.test_account, me2);
  await post('admin','/api/admin/test-account');
  const me3=(await g('admin','/api/me')).data||{};
  ok('opätovný vstup = čistý účet (booking zmizol, free class znova)', me3.visit_count===0, me3);
  const myB=(await g('admin','/api/my-bookings')).data;
  ok('žiadne rezervácie po resete', (Array.isArray(myB)?myB:myB?.bookings||[]).length===0, myB);
  await post('admin','/api/test-account/back');
  const noSess=await post('cudzi','/api/test-account/back');
  ok('návrat bez test session odmietnutý', noSess.status===400, noSess.status);
  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  if(FAIL) process.exit(1);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
