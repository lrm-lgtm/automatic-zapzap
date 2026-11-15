const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
const { Client, LocalAuth } = require('whatsapp-web.js');
const auth = require('./auth');
const { trustedProxySetting } = require('./security');

const app = express();
app.set('trust proxy', trustedProxySetting(process.env.WHATSAPP_CONTROL_TRUSTED_PROXY_IPS));
const port = Number(process.env.PORT || 8788);
const db = new sqlite3.Database('/var/lib/whatsapp-qr/campaigns.sqlite3');
let state = 'starting';
let qrDataUrl = null;
let lastError = null;
let dispatching = false;

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const nowIso = () => new Date().toISOString();
const validRecipient = (value) => /^\d{8,15}$/.test(String(value || ''));
const contentHash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dispatchEnabled = process.env.WHATSAPP_CONTROL_ENABLE_DISPATCH === 'true';

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,message TEXT NOT NULL,recipients_json TEXT NOT NULL,scheduled_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL,approved_at TEXT,started_at TEXT,finished_at TEXT,result_json TEXT,revision INTEGER NOT NULL DEFAULT 1,approval_status TEXT NOT NULL DEFAULT 'pending',schedule_status TEXT NOT NULL DEFAULT 'unscheduled',delivery_status TEXT NOT NULL DEFAULT 'idle',approved_revision INTEGER,content_hash TEXT,approved_content_hash TEXT,approval_snapshot_json TEXT,approved_by TEXT,cancelled_at TEXT)`);
  for (const column of [
    ['revision', 'INTEGER NOT NULL DEFAULT 1'],
    ['approval_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['schedule_status', "TEXT NOT NULL DEFAULT 'unscheduled'"],
    ['delivery_status', "TEXT NOT NULL DEFAULT 'idle'"],
    ['approved_revision', 'INTEGER'],
    ['content_hash', 'TEXT'],
    ['approved_content_hash', 'TEXT'],
    ['approval_snapshot_json', 'TEXT'],
    ['approved_by', 'TEXT'],
    ['cancelled_at', 'TEXT']
  ]) db.run(`ALTER TABLE campaigns ADD COLUMN ${column[0]} ${column[1]}`, () => {});
  db.run("UPDATE campaigns SET approval_status=CASE WHEN status='approved' THEN 'approved' WHEN status='cancelled' THEN 'revoked' ELSE COALESCE(approval_status,'pending') END, schedule_status=CASE WHEN status IN ('approved','sending','finished') THEN 'scheduled' WHEN status='cancelled' THEN 'cancelled' ELSE CASE WHEN scheduled_at IS NOT NULL THEN 'scheduled' ELSE 'unscheduled' END END, delivery_status=CASE WHEN status='sending' THEN 'sending' WHEN status='finished' THEN 'completed' WHEN status='cancelled' THEN 'idle' ELSE COALESCE(delivery_status,'idle') END, revision=COALESCE(revision,1), content_hash=COALESCE(content_hash,'legacy')");
});

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/var/lib/whatsapp-qr/session' }),
  puppeteer: { headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
});

client.on('qr', async (qr) => { state = 'awaiting_qr_scan'; qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 420 }); });
client.on('authenticated', () => { state = 'authenticated'; qrDataUrl = null; console.log('whatsapp authenticated'); });
client.on('ready', () => { state = 'ready'; qrDataUrl = null; console.log('whatsapp ready'); });
client.on('loading_screen', (percent, message) => console.log(`whatsapp loading ${percent}% ${message}`));
client.on('change_state', (nextState) => console.log(`whatsapp state ${nextState}`));
client.on('remote_session_saved', () => console.log('whatsapp session saved'));
client.on('auth_failure', (message) => { state = 'auth_failure'; lastError = String(message); console.error('whatsapp auth failure', message); });
client.on('disconnected', (reason) => { state = 'disconnected'; lastError = String(reason); console.error('whatsapp disconnected', reason); });

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/assets', express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));
app.get('/manifest.webmanifest', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'manifest.webmanifest')));
app.get('/sw.js', (_req, res) => { res.type('application/javascript').set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'sw.js')); });
app.get('/health', (_req, res) => res.json({ service: 'whatsapp-control', state, has_qr: Boolean(qrDataUrl), auth_configured: auth.configured(), dispatch_enabled: dispatchEnabled, error: lastError ? 'service_error' : null }));
app.get('/login', (_req, res) => res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar · WhatsApp Control</title><style>body{font:16px system-ui;background:#101820;color:#eaf2f4;max-width:420px;margin:0 auto;padding:18px}form{background:#172630;border:1px solid #29414d;border-radius:14px;padding:18px}label{display:block;margin-top:12px}input,button{font:inherit;width:100%;box-sizing:border-box;padding:11px;border-radius:9px;border:1px solid #44606b;background:#0d171d;color:#fff}button{margin-top:18px;background:#1c8c61;border:0;font-weight:700}.note{color:#aac0c7;font-size:13px}</style><h1>WhatsApp Control</h1><p class="note">Acesso privado da central.</p><form id="login"><label>Usuário<input name="username" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="current-password" required></label><button>Entrar</button><p id="error" class="note"></p></form><script>document.querySelector('#login').onsubmit=async(e)=>{e.preventDefault();const d=new FormData(e.target);const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:d.get('username'),password:d.get('password')})});if(r.ok){location.href='/'}else{const j=await r.json();document.querySelector('#error').textContent=j.error==='auth_not_configured'?'Autenticação ainda não foi configurada no servidor.':'Usuário ou senha inválidos.'}};</script>`));
app.post('/login', auth.login);
app.get('/api/auth/status', auth.authStatus);
app.get('/', (req, res, next) => {
  if (!auth.getSession(req)) return res.redirect('/login');
  next();
});
app.use(auth.requireAuth);
app.post('/logout', auth.requireAuth, auth.requireCsrfOrSameOrigin, auth.logout);
app.get('/api/status', (_req, res) => res.json({ service: 'whatsapp-control', state, connected: state === 'ready', authenticated: state === 'authenticated' || state === 'ready', has_qr: Boolean(qrDataUrl), dispatch_enabled: dispatchEnabled, updated_at: nowIso(), error: lastError ? 'service_error' : null }));
app.get('/api/moni/events', (_req, res) => res.json({ integration: 'not_connected', events: [], message: 'A integração MONI será habilitada em uma etapa posterior.' }));
app.get('/api/campaigns', async (_req, res) => { try { const rows = await all('SELECT * FROM campaigns ORDER BY datetime(created_at) DESC LIMIT 50'); res.json(rows.map((row) => ({ ...row, recipients: JSON.parse(row.recipients_json).map((number) => `${number.slice(0, 3)}***`) }))); } catch { res.status(500).json({ error: 'database_error' }); } });

app.post('/api/campaigns', auth.requireCsrf, async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const message = String(req.body.message || '').trim().slice(0, 4000);
  const recipients = Array.isArray(req.body.recipients) ? [...new Set(req.body.recipients.map(String).map((v) => v.trim()))] : [];
  const scheduledAt = new Date(req.body.scheduled_at || '');
  if (!title || !message || !recipients.length || recipients.length > 20 || recipients.some((number) => !validRecipient(number))) return res.status(400).json({ error: 'invalid_campaign', detail: 'Use 1-20 números em formato internacional, somente contatos autorizados.' });
  if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'invalid_schedule' });
  const hash = contentHash({ title, message, recipients });
  try { const result = await run('INSERT INTO campaigns (title,message,recipients_json,scheduled_at,status,created_at,revision,approval_status,schedule_status,delivery_status,content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [title, message, JSON.stringify(recipients), scheduledAt.toISOString(), 'draft', nowIso(), 1, 'pending', 'scheduled', 'idle', hash]); res.status(201).json({ id: result.lastID, status: 'draft', approval_status: 'pending', schedule_status: 'scheduled' }); } catch { res.status(500).json({ error: 'database_error' }); }
});

app.post('/api/campaigns/:id/approve', auth.requireCsrf, async (req, res) => {
  try {
    const campaign = await get('SELECT * FROM campaigns WHERE id=?', [req.params.id]);
    if (!campaign || campaign.approval_status !== 'pending' || campaign.status === 'cancelled') return res.status(409).json({ error: 'not_approvable' });
    const snapshot = { title: campaign.title, message: campaign.message, recipients: JSON.parse(campaign.recipients_json), scheduled_at: campaign.scheduled_at, revision: campaign.revision, content_hash: campaign.content_hash };
    const stamp = nowIso();
    const result = await run("UPDATE campaigns SET status='approved', approval_status='approved', delivery_status='queued', approved_at=?, approved_by=?, approved_revision=?, approved_content_hash=?, approval_snapshot_json=? WHERE id=? AND approval_status='pending'", [stamp, req.auth.username, campaign.revision, campaign.content_hash, JSON.stringify(snapshot), campaign.id]);
    if (!result.changes) return res.status(409).json({ error: 'approval_conflict' });
    res.json({ id: Number(req.params.id), status: 'approved', approval_status: 'approved', approved_revision: campaign.revision });
  } catch { res.status(500).json({ error: 'database_error' }); }
});
app.post('/api/campaigns/:id/cancel', auth.requireCsrf, async (req, res) => { try { const stamp = nowIso(); const result = await run("UPDATE campaigns SET status='cancelled', approval_status='revoked', schedule_status='cancelled', delivery_status='idle', finished_at=?, cancelled_at=? WHERE id=? AND status IN ('draft','approved')", [stamp, stamp, req.params.id]); if (!result.changes) return res.status(409).json({ error: 'not_cancellable' }); res.json({ id: Number(req.params.id), status: 'cancelled' }); } catch { res.status(500).json({ error: 'database_error' }); } });

async function dispatchDueCampaign() {
  if (!dispatchEnabled || dispatching || state !== 'ready') return;
  const campaign = await get("SELECT * FROM campaigns WHERE status='approved' AND approval_status='approved' AND schedule_status='scheduled' AND delivery_status='queued' AND approved_revision=revision AND datetime(scheduled_at) <= datetime('now') ORDER BY datetime(scheduled_at) LIMIT 1");
  if (!campaign) return;
  dispatching = true;
  await run("UPDATE campaigns SET status='sending', delivery_status='sending', started_at=? WHERE id=? AND delivery_status='queued'", [nowIso(), campaign.id]);
  const results = [];
  for (const number of JSON.parse(campaign.recipients_json)) {
    if (!validRecipient(number)) { results.push({ number: 'invalid', status: 'rejected' }); continue; }
    try { await client.sendMessage(`${number}@c.us`, campaign.message); results.push({ number: `${number.slice(0, 3)}***`, status: 'accepted' }); } catch { results.push({ number: `${number.slice(0, 3)}***`, status: 'error' }); }
    await new Promise((resolve) => setTimeout(resolve, 12000));
  }
  await run("UPDATE campaigns SET status='finished', delivery_status='completed', finished_at=?, result_json=? WHERE id=?", [nowIso(), JSON.stringify(results), campaign.id]);
  dispatching = false;
}
setInterval(() => dispatchDueCampaign().catch((error) => { dispatching = false; lastError = String(error); }), 15000);

app.get('/', async (req, res) => {
  if (!req.auth) return res.redirect('/login');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  let rows = []; try { rows = await all('SELECT * FROM campaigns ORDER BY datetime(created_at) DESC LIMIT 20'); } catch {}
  const cards = rows.map((row) => `<article><b>${esc(row.title)}</b><span>${esc(row.approval_status || row.status)} · ${esc(row.schedule_status || 'legacy')} · ${esc(row.delivery_status || 'legacy')} · ${esc(row.scheduled_at)}</span><small>${esc(row.message.slice(0, 140))}</small>${row.approval_status === 'pending' || row.status === 'draft' ? `<button onclick="approve(${row.id})">Aprovar</button><button onclick="cancelCampaign(${row.id})" style="background:#71434b">Cancelar</button>` : ''}</article>`).join('') || '<p>Nenhum disparo criado.</p>';
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#101820"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/assets/icon.svg"><title>WhatsApp Control</title><style>body{font:16px system-ui;background:#101820;color:#eaf2f4;max-width:760px;margin:0 auto;padding:18px}h1{font-size:25px}.pill{color:#8ee6b2}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.metric{background:#172630;border:1px solid #29414d;border-radius:14px;padding:14px}.metric strong{display:block;font-size:20px;margin-top:4px}.ok{color:#8ee6b2}.warn{color:#ffd17a}.bad{color:#ff9b9b}form,article{background:#172630;border:1px solid #29414d;border-radius:14px;padding:14px;margin:12px 0}label{display:block;margin-top:10px}input,textarea,button{font:inherit;width:100%;box-sizing:border-box;padding:11px;border-radius:9px;border:1px solid #44606b;background:#0d171d;color:#fff}button{margin-top:14px;background:#1c8c61;border:0;font-weight:700}small,span{display:block;color:#aac0c7;margin-top:6px}.note{font-size:13px;color:#c9d7da}.topbar{display:flex;justify-content:space-between;gap:10px;align-items:center}.secondary{background:#35505d}.empty{border:1px dashed #44606b;border-radius:14px;padding:16px;color:#aac0c7}</style><div class="topbar"><h1>WhatsApp Control</h1><button class="secondary" id="logout">Sair</button></div><p id="connector" class="pill">Consultando conector…</p><div class="grid"><div class="metric">WhatsApp<strong id="wa-state">—</strong></div><div class="metric">Atualização<strong id="updated">—</strong></div><div class="metric">Eventos MONI<strong id="moni-count">0</strong></div><div class="metric">Fila de envio<strong id="dispatch">desativada</strong></div></div><section><h2>Eventos pendentes</h2><div id="moni" class="empty">A integração MONI ainda não está conectada. Nenhum evento foi inventado.</div></section><section><h2>Campanhas piloto</h2><p class="note">O envio pelo novo painel permanece desativado até a validação completa da segurança e do adapter.</p><form id="campaign"><label>Título<input name="title" maxlength="120" required placeholder="Ex.: Aviso de manutenção"></label><label>Mensagem<textarea name="message" maxlength="4000" rows="5" required placeholder="Digite a mensagem..."></textarea></label><label>Números autorizados, separados por vírgula<input name="recipients" required placeholder="5511999999999,5521999999999"></label><label>Agendar para <input name="scheduled_at" type="datetime-local" required></label><button>Criar rascunho</button></form><div id="campaigns">Carregando campanhas…</div></section><script>let csrfToken=null;const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function load(){const [s,m,c]=await Promise.all([fetch('/api/status'),fetch('/api/moni/events'),fetch('/api/campaigns')]);const status=await s.json();const moni=await m.json();const campaigns=await c.json();document.querySelector('#wa-state').textContent=status.state;document.querySelector('#wa-state').className=status.connected?'ok':'warn';document.querySelector('#connector').textContent='WhatsApp: '+status.state+(status.error?' · '+status.error:'');document.querySelector('#updated').textContent=new Date(status.updated_at).toLocaleTimeString();document.querySelector('#moni-count').textContent=moni.events.length;document.querySelector('#dispatch').textContent=status.dispatch_enabled?'habilitada':'desativada';document.querySelector('#moni').textContent=moni.events.length?('Eventos pendentes: '+moni.events.length):moni.message;document.querySelector('#campaigns').innerHTML=campaigns.map(row=>'<article><b>'+esc(row.title)+'</b><span>'+esc(row.approval_status||row.status)+' · '+esc(row.schedule_status||'legacy')+' · '+esc(row.delivery_status||'legacy')+'</span><small>'+esc(row.message.slice(0,140))+'</small></article>').join('')||'<div class="empty">Nenhuma campanha cadastrada.</div>'}fetch('/api/auth/status').then(r=>r.json()).then(j=>{csrfToken=j.csrf_token;load();setInterval(load,15000)});document.querySelector('#campaign').onsubmit=async(e)=>{e.preventDefault();const d=new FormData(e.target);const r=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify({title:d.get('title'),message:d.get('message'),recipients:d.get('recipients').split(',').map(x=>x.trim()),scheduled_at:new Date(d.get('scheduled_at')).toISOString()})});if(r.ok){e.target.reset();load()}else{const j=await r.json();alert(j.detail||j.error)}};document.querySelector('#logout').onclick=async()=>{await fetch('/logout',{method:'POST'});location.href='/login'};if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');</script>`);
});

app.listen(port, '0.0.0.0', () => console.log(`whatsapp-control listening on ${port}`));
client.initialize().catch((error) => { state = 'startup_error'; lastError = String(error); console.error(error); });
