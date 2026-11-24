const crypto = require('node:crypto');

const digest = (value) => crypto.createHash('sha256').update(String(value || '')).digest();
const configuredHash = () => String(process.env.WHATSAPP_CONTROL_INTEGRATION_TOKEN_SHA256 || '').trim().toLowerCase();
const DEFAULT_LRM_PUBLIC_KEY_B64='MCowBQYDK2VwAyEAASQrXBIBEkkBYzevfL3KXQEJI/JbzVM1neI79fWB9Tk=';
const lrmPublicKey=()=>String(process.env.WHATSAPP_CONTROL_LRM_PUBLIC_KEY_B64||DEFAULT_LRM_PUBLIC_KEY_B64).trim();
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function verifyLrmGrant(token,body,now=Date.now()){
  const parts=String(token||'').split('.');if(parts.length!==2)throw Error('grant_invalid');
  const [encoded,signature]=parts;
  const key=crypto.createPublicKey({key:Buffer.from(lrmPublicKey(),'base64'),format:'der',type:'spki'});
  const valid=crypto.verify(null,Buffer.from(encoded),key,Buffer.from(signature,'base64url'));
  if(!valid)throw Error('grant_invalid');
  let payload;try{payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw Error('grant_invalid');}
  const nowSec=Math.floor(now/1000);
  if(payload?.v!==1||!payload?.sub||!Number.isInteger(payload?.exp)||payload.exp<nowSec||payload.exp>nowSec+180)throw Error('grant_expired');
  const job=normalizeJob(body,new Date(now));
  if(payload.job?.source!==job.source||payload.job?.external_id!==job.externalId||payload.job?.recipient!==job.recipient||
     payload.job?.title_sha256!==sha(job.title)||payload.job?.message_sha256!==sha(job.message)||payload.job?.user_confirmed!==true||job.userConfirmed!==true)throw Error('grant_mismatch');
  return {userId:String(payload.sub),job};
}

function tokenConfigured(){
  return /^[a-f0-9]{64}$/.test(configuredHash());
}
function requireIntegration(req,res,next){
  const header=String(req.get('authorization')||'');
  if(header.startsWith('LRMGrant ')){
    try{const verified=verifyLrmGrant(header.slice(9),req.body);req.integrationAuth={kind:'lrm-grant',userId:verified.userId};return next();}
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
module.exports={tokenConfigured,requireIntegration,normalizeJob,verifyLrmGrant};
