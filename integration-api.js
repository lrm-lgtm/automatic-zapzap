const crypto = require('node:crypto');

const digest = (value) => crypto.createHash('sha256').update(String(value || '')).digest();
const configuredHash = () => String(process.env.WHATSAPP_CONTROL_INTEGRATION_TOKEN_SHA256 || '').trim().toLowerCase();

function tokenConfigured(){
  return /^[a-f0-9]{64}$/.test(configuredHash());
}
function requireIntegration(req,res,next){
  if(!tokenConfigured()) return res.status(503).json({error:'integration_auth_not_configured'});
  const header=String(req.get('authorization')||'');
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  if(!token) return res.status(401).json({error:'integration_auth_required'});
  const expected=Buffer.from(configuredHash(),'hex'),actual=digest(token);
  if(expected.length!==actual.length || !crypto.timingSafeEqual(expected,actual)) return res.status(401).json({error:'integration_auth_invalid'});
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
module.exports={tokenConfigured,requireIntegration,normalizeJob};
