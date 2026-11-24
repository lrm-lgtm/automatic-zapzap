const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const api=require('../integration-api');

function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}}}
function request(token){return {get(name){return name.toLowerCase()==='authorization'&&token?'Bearer '+token:'';}}}

test('integration bearer token is compared by SHA-256',()=>{
 const token='segredo-de-integracao-longo';
 process.env.WHATSAPP_CONTROL_INTEGRATION_TOKEN_SHA256=crypto.createHash('sha256').update(token).digest('hex');
 const ok=response();let passed=false;api.requireIntegration(request(token),ok,()=>{passed=true});assert.equal(passed,true);
 const bad=response();api.requireIntegration(request('errado'),bad,()=>{});assert.equal(bad.statusCode,401);
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
