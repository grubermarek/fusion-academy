/** E2E: Obchod hub — overview, odporúčania z reálnych dát, presmerovanie /pricing, nákupy. */
const BASE='http://localhost:'+(process.env.QA_PORT||3999);
let PASS=0,FAIL=0;
const ok=(n,c,d)=>{ if(c){PASS++;console.log('  ✓ '+n);} else {FAIL++;console.log('  ✗ '+n+(d?' — '+JSON.stringify(d).slice(0,250):''));} };
const jars={};
async function call(jar,method,path,body){
  const headers={'Content-Type':'application/json'}; if(jars[jar]) headers['Cookie']=jars[jar];
  const r=await fetch(BASE+path,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'manual'});
  const sc=r.headers.get('set-cookie'); if(sc) jars[jar]=sc.split(';')[0];
  let data=null; try{data=await r.json();}catch(e){}
  return {status:r.status,data,location:r.headers.get('location')};
}
const g=(j,p)=>call(j,'GET',p), post=(j,p,b)=>call(j,'POST',p,b), put=(j,p,b)=>call(j,'PUT',p,b);
(async()=>{
  const uniq=Date.now().toString(36);
  console.log('\n═══ OBCHOD HUB AUDIT ═══');
  await post('admin','/api/login',{email:'admin@fusionacademy.sk',password:'admin123'});
  // presmerovania: jeden obchod
  const pr=await g('x','/pricing');
  ok('/pricing presmeruje na /obchod', pr.status===302 && /\/obchod/.test(pr.location), {s:pr.status,l:pr.location});
  const ob=await g('x','/obchod');
  ok('/obchod sa servíruje (200)', ob.status===200, ob.status);
  // nová klientka: overview + odporúčanie začni
  await post('A','/api/register',{name:'OB Nova',email:'ob-a-'+uniq+'@test-fa-qa.local',password:'AuditPass123!',consent:true});
  let ov=(await g('A','/api/shop/overview')).data||{};
  ok('overview: žiadne členstvo, kredit 0', ov.ok && !ov.membership && ov.credit===0, ov);
  ok('odporúčanie „začni"', ov.recommendations.some(r=>r.key==='start'), ov.recommendations);
  // kúpi permanentku (manuál) → pending v overview → potvrdenie → vstupy + nákupy
  await post('A','/api/membership/buy',{plan_id:'permanentka10',payment_method:'manual'});
  ov=(await g('A','/api/shop/overview')).data||{};
  ok('čakajúca platba v overview + odporúčanie', ov.pending.length===1 && ov.recommendations.some(r=>r.key==='pay_pending'), ov.pending);
  const qq=(await g('admin','/api/admin/manual-payments')).data||{};
  const pay=(qq.payments||[]).find(p=>p.user==='OB Nova');
  await post('admin','/api/admin/manual-payments/'+pay.id+'/confirm',{method:'cash'});
  ov=(await g('A','/api/shop/overview')).data||{};
  ok('po potvrdení: 10 vstupov + expirácia', ov.entries.left===10 && ov.entries.total===10 && !!ov.entries.expires_at, ov.entries);
  ok('nákup v histórii + faktúra', ov.purchases.length>=1 && ov.purchases[0].amount===80 && ov.invoices.length>=1, {p:ov.purchases[0],i:ov.invoices.length});
  // dochádza permanentka → odporúčanie
  const meA=(await g('A','/api/me')).data;
  await put('admin','/api/admin/users/'+meA.id+'/awards',{single_entries:2});
  ov=(await g('A','/api/shop/overview')).data||{};
  ok('odporúčanie „dochádza permanentka" pri 2 vstupoch', ov.recommendations.some(r=>r.key==='entries_low'), ov.recommendations);
  // kredit → odporúčanie
  await put('admin','/api/admin/users/'+meA.id+'/awards',{referral_credit:15});
  ov=(await g('A','/api/shop/overview')).data||{};
  ok('kredit v overview + odporúčanie použiť', ov.credit===15 && ov.recommendations.some(r=>r.key==='credit'), ov.credit);
  // merch objednávka cez existujúci systém
  const prods=(await g('A','/api/shop/products')).data||[];
  const merch=prods.find(p=>/tričko|taška|tielko/i.test(p.name));
  const ord=await post('A','/api/shop/order',{client_name:'OB Nova',client_email:'ob-a-'+uniq+'@test-fa-qa.local',
    items:[{product_id:merch._id,qty:1}],payment_method:'cash',delivery:'pickup'});
  ok('merch objednávka prešla', ord.status===200, ord.data);
  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  if(FAIL) process.exit(1);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
