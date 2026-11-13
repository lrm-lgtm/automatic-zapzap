const express = require('express');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
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

db.serialize(() => { db.run(`CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,message TEXT NOT NULL,recipients_json TEXT NOT NULL,scheduled_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL,approved_at TEXT,started_at TEXT,finished_at TEXT,result_json TEXT)`); });

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

app.get('/health', (_req, res) => res.json({ service: 'whatsapp-control', state, has_qr: Boolean(qrDataUrl), error: lastError }));
app.get('/api/campaigns', async (_req, res) => { try { const rows = await all('SELECT * FROM campaigns ORDER BY datetime(created_at) DESC LIMIT 50'); res.json(rows.map((row) => ({ ...row, recipients: JSON.parse(row.recipients_json) }))); } catch { res.status(500).json({ error: 'database_error' }); } });

app.post('/api/campaigns', async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const message = String(req.body.message || '').trim().slice(0, 4000);
  const recipients = Array.isArray(req.body.recipients) ? [...new Set(req.body.recipients.map(String).map((v) => v.trim()))] : [];
  const scheduledAt = new Date(req.body.scheduled_at || '');
  if (!title || !message || !recipients.length || recipients.length > 20 || recipients.some((number) => !validRecipient(number))) return res.status(400).json({ error: 'invalid_campaign', detail: 'Use 1-20 números em formato internacional, somente contatos autorizados.' });
  if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'invalid_schedule' });
  try { const result = await run('INSERT INTO campaigns (title,message,recipients_json,scheduled_at,status,created_at) VALUES (?,?,?,?,?,?)', [title, message, JSON.stringify(recipients), scheduledAt.toISOString(), 'draft', nowIso()]); res.status(201).json({ id: result.lastID, status: 'draft' }); } catch { res.status(500).json({ error: 'database_error' }); }
});

app.post('/api/campaigns/:id/approve', async (req, res) => { try { const result = await run("UPDATE campaigns SET status='approved', approved_at=? WHERE id=? AND status='draft'", [nowIso(), req.params.id]); if (!result.changes) return res.status(409).json({ error: 'not_a_draft' }); res.json({ id: Number(req.params.id), status: 'approved' }); } catch { res.status(500).json({ error: 'database_error' }); } });
app.post('/api/campaigns/:id/cancel', async (req, res) => { try { const result = await run("UPDATE campaigns SET status='cancelled', finished_at=? WHERE id=? AND status IN ('draft','approved')", [nowIso(), req.params.id]); if (!result.changes) return res.status(409).json({ error: 'not_cancellable' }); res.json({ id: Number(req.params.id), status: 'cancelled' }); } catch { res.status(500).json({ error: 'database_error' }); } });

async function dispatchDueCampaign() {
  if (dispatching || state !== 'ready') return;
  const campaign = await get("SELECT * FROM campaigns WHERE status='approved' AND datetime(scheduled_at) <= datetime('now') ORDER BY datetime(scheduled_at) LIMIT 1");
  if (!campaign) return;
  dispatching = true;
  await run("UPDATE campaigns SET status='sending', started_at=? WHERE id=?", [nowIso(), campaign.id]);
  const results = [];
  for (const number of JSON.parse(campaign.recipients_json)) {
    if (!validRecipient(number)) { results.push({ number: 'invalid', status: 'rejected' }); continue; }
    try { await client.sendMessage(`${number}@c.us`, campaign.message); results.push({ number: `${number.slice(0, 3)}***`, status: 'accepted' }); } catch { results.push({ number: `${number.slice(0, 3)}***`, status: 'error' }); }
    await new Promise((resolve) => setTimeout(resolve, 12000));
  }
  await run("UPDATE campaigns SET status='finished', finished_at=?, result_json=? WHERE id=?", [nowIso(), JSON.stringify(results), campaign.id]);
  dispatching = false;
}
setInterval(() => dispatchDueCampaign().catch((error) => { dispatching = false; lastError = String(error); }), 15000);

app.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  let rows = []; try { rows = await all('SELECT * FROM campaigns ORDER BY datetime(created_at) DESC LIMIT 20'); } catch {}
  const cards = rows.map((row) => `<article><b>${esc(row.title)}</b><span>${esc(row.status)} · ${esc(row.scheduled_at)}</span><small>${esc(row.message.slice(0, 140))}</small>${row.status === 'draft' ? `<button onclick="approve(${row.id})">Aprovar</button><button onclick="cancelCampaign(${row.id})" style="background:#71434b">Cancelar</button>` : ''}</article>`).join('') || '<p>Nenhum disparo criado.</p>';
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp Control</title><style>body{font:16px system-ui;background:#101820;color:#eaf2f4;max-width:760px;margin:0 auto;padding:18px}h1{font-size:25px}.pill{color:#8ee6b2}form,article{background:#172630;border:1px solid #29414d;border-radius:14px;padding:14px;margin:12px 0}label{display:block;margin-top:10px}input,textarea,button{font:inherit;width:100%;box-sizing:border-box;padding:11px;border-radius:9px;border:1px solid #44606b;background:#0d171d;color:#fff}button{margin-top:14px;background:#1c8c61;border:0;font-weight:700}small,span{display:block;color:#aac0c7;margin-top:6px}.note{font-size:13px;color:#c9d7da}</style><h1>WhatsApp Control</h1><p class="pill">Conector: ${esc(state)} · Piloto com aprovação</p><form id="campaign"><label>Título<input name="title" maxlength="120" required placeholder="Ex.: Aviso de manutenção"></label><label>Mensagem<textarea name="message" maxlength="4000" rows="5" required placeholder="Digite a mensagem..."></textarea></label><label>Números autorizados, separados por vírgula<input name="recipients" required placeholder="5511999999999,5521999999999"></label><label>Agendar para <input name="scheduled_at" type="datetime-local" required></label><p class="note">A IA entra na etapa de revisão. Nada é enviado sem você aprovar.</p><button>Criar rascunho</button></form><h2>Campanhas</h2>${cards}<script>const f=document.querySelector('#campaign');const act=async(id,path)=>{const r=await fetch('/api/campaigns/'+id+'/'+path,{method:'POST'});if(!r.ok)alert('Não foi possível alterar a campanha');location.reload()};window.approve=(id)=>act(id,'approve');window.cancelCampaign=(id)=>act(id,'cancel');f.onsubmit=async(e)=>{e.preventDefault();const d=new FormData(f);const r=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:d.get('title'),message:d.get('message'),recipients:d.get('recipients').split(',').map(x=>x.trim()),scheduled_at:new Date(d.get('scheduled_at')).toISOString()})});const j=await r.json();alert(r.ok?'Rascunho criado. Revise e aprove na lista.':(j.detail||j.error));if(r.ok)location.reload()};</script>`);
});

app.listen(port, '0.0.0.0', () => console.log(`whatsapp-control listening on ${port}`));
client.initialize().catch((error) => { state = 'startup_error'; lastError = String(error); console.error(error); });
