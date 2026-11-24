const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const api=require('../integration-api');
const TEST_PRIVATE='MC4CAQAwBQYDK2VwBCIEIPg0y5wPTLeXSyFJnoEIYUt1nu98omaQwwO+osYah555';
const TEST_PUBLIC='MCowBQYDK2VwAyEAdGzzWdFv6TzsmcuiIPcMoDfrLvfjCrxLRcAhILKC4fc=';
function signGrant(job,now=Date.now(),offset=90){
 const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
 const payload={v:1,sub:'user-test',exp:Math.floor(now/1000)+offset,job:{source:job.source,external_id:job.external_id,recipient:job.recipient,title_sha256:sha(job.title),message_sha256:sha(job.message),user_confirmed:true}};
 const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
 const key=crypto.createPrivateKey({key:Buffer.from(TEST_PRIVATE,'base64'),format:'der',type:'pkcs8'});
 return encoded+'.'+crypto.sign(null,Buffer.from(encoded),key).toString('base64url');
}

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


test('accepts a short-lived signed LRM grant bound to the exact job',()=>{
 process.env.WHATSAPP_CONTROL_LRM_PUBLIC_KEY_B64=TEST_PUBLIC;
 const now=Date.parse('2026-11-24T03:00:00Z');
 const job={source:'info-lrm',external_id:'notification:abc',title:'Agendamento Dori',message:'Visita confirmada',recipient:'5519999999999',user_confirmed:true};
 const grant=signGrant(job,now);
 const verified=api.verifyLrmGrant(grant,job,now);assert.equal(verified.userId,'user-test');assert.equal(verified.job.externalId,'notification:abc');
 assert.throws(()=>api.verifyLrmGrant(grant,{...job,message:'mensagem alterada'},now),/grant_mismatch/);
 assert.throws(()=>api.verifyLrmGrant(signGrant(job,now,-1),job,now),/grant_expired/);
 delete process.env.WHATSAPP_CONTROL_LRM_PUBLIC_KEY_B64;
});
