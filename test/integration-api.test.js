const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const api=require('../integration-api');

function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}}}
function request(token,scheme='Bearer'){return {body:{},get(name){return name.toLowerCase()==='authorization'&&token?scheme+' '+token:'';}}}

test('integration bearer token is compared by SHA-256',async()=>{
 const token='segredo-de-integracao-longo';
 process.env.WHATSAPP_CONTROL_INTEGRATION_TOKEN_SHA256=crypto.createHash('sha256').update(token).digest('hex');
 const ok=response();let passed=false;await api.requireIntegration(request(token),ok,()=>{passed=true});assert.equal(passed,true);
 const bad=response();await api.requireIntegration(request('errado'),bad,()=>{});assert.equal(bad.statusCode,401);
});

test('normalizes INFO-LRM job without inventing schedule',()=>{
 const now=new Date('2026-11-25T12:00:00.000Z');
 const job=api.normalizeJob({source:'info-lrm',external_id:'notification:abc',title:'Agendamento Dori',message:'Visita confirmada',recipient:'+55 (19) 99999-9999',user_confirmed:true},now);
 assert.equal(job.source,'info-lrm');assert.equal(job.recipient,'5519999999999');assert.equal(job.scheduledAt,now.toISOString());assert.equal(job.userConfirmed,true);
});
test('rejects missing recipient and unsafe identifiers',()=>{
 assert.throws(()=>api.normalizeJob({source:'info lrm',external_id:'x',title:'x',message:'x',recipient:'5519'}));
 assert.throws(()=>api.normalizeJob({source:'info-lrm',external_id:'x y',title:'x',message:'x',recipient:'5519999999999'}));
});

test('validates LRM grant with INFO-LRM verifier and rejects invalid verifier response',async()=>{
 const job={source:'info-lrm',external_id:'notification:abc',title:'Agendamento Dori',message:'Visita confirmada',recipient:'5519999999999',user_confirmed:true};
 const okFetch=async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.grant,'grant-abc');assert.equal(body.job.external_id,'notification:abc');return {ok:true,async json(){return {valid:true,user_id:'user-test'}}};};
 assert.deepEqual(await api.verifyLrmGrantRemote('grant-abc',job,okFetch),{userId:'user-test'});
 const badFetch=async()=>({ok:false,async json(){return {valid:false,detail:'Grant expirado'}}});
 await assert.rejects(()=>api.verifyLrmGrantRemote('expired',job,badFetch),/Grant expirado/);
});
