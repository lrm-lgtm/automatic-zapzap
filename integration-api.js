const crypto = require('node:crypto');

const digest = (value) => crypto.createHash('sha256').update(String(value || '')).digest();
const configuredHash = () => String(process.env.WHATSAPP_CONTROL_INTEGRATION_TOKEN_SHA256 || '').trim().toLowerCase();
const verifyUrl=()=>String(process.env.WHATSAPP_CONTROL_LRM_VERIFY_URL||'https://lrm-campo-pessoal.netlify.app/.netlify/functions/communication-verify').trim();

function tokenConfigured(){
  return /^[a-f0-9]{64}$/.test(configuredHash());
}
async function verifyLrmGrantRemote(token,body,fetchFn=fetch){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
  try{
    const response=await fetchFn(verifyUrl(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant:String(token||''),job:body}),signal:controller.signal,cache:'no-store'});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok||data.valid!==true||!data.user_id)throw Error(data.detail||'grant_invalid');
    return {userId:String(data.user_id)};
  }catch(error){if(error?.name==='AbortError')throw Error('grant_verifier_timeout');throw error;}
  finally{clearTimeout(timer);}
}
async function requireIntegration(req,res,next){
  const header=String(req.get('authorization')||'');
  if(header.startsWith('LRMGrant ')){
    try{const verified=await verifyLrmGrantRemote(header.slice(9),req.body);req.integrationAuth={kind:'lrm-grant',userId:verified.userId};return next();}
    catch(error){return res.status(401).json({error:error.message||'grant_invalid'});}
  }
  if(!tokenConfigured()) return res.status(503).json({error:'integration_auth_not_configured'});
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  if(!token) return res.status(401).json({error:'integration_auth_required'});
  const expected=Buffer.from(configuredHash(),'hex'),actual=digest(token);
  if(expected.length!==actual.length || !crypto.timingSafeEqual(expected,actual)) return res.status(401).json({error:'integration_auth_invalid'});
  req.integrationAuth={kind:'machine'};
  next();
}
function normalizeJob(body,now=new Date()){
  const source=String(body?.source||'').trim().toLowerCase();
  const externalId=String(body?.external_id||'').trim();
  const title=String(body?.title||'').trim().slice(0,120);
  const message=String(body?.message||'').trim().slice(0,4000);
  const recipient=String(body?.recipient||'').replace(/\D/g,'');
  const requested=body?.scheduled_at?new Date(body.scheduled_at):now;
  if(!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(source)) throw Error('invalid_source');
  if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(externalId)) throw Error('invalid_external_id');
  if(!title||!message) throw Error('invalid_content');
  if(!/^\d{8,15}$/.test(recipient)) throw Error('invalid_recipient');
  if(Number.isNaN(requested.getTime())) throw Error('invalid_schedule');
  return {source,externalId,title,message,recipient,scheduledAt:requested.toISOString(),userConfirmed:body?.user_confirmed===true};
}
module.exports={tokenConfigured,requireIntegration,normalizeJob,verifyLrmGrantRemote};
