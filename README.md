# Automatic ZapZap

Painel web responsivo para revisar e agendar campanhas autorizadas no cliente
WhatsApp Web do LRM.

## Escopo atual

- painel HTTP mobile-first;
- rascunhos de campanha com título, mensagem, destinatários e horário;
- aprovação e cancelamento explícitos;
- worker persistente com SQLite;
- limite de 20 destinatários por campanha e intervalo entre envios;
- histórico de estado e resultados mascarados;
- cliente `whatsapp-web.js` com sessão persistida fora do repositório.

O envio só ocorre para campanhas aprovadas e quando o cliente WhatsApp está no
estado `ready`. A integração é não oficial; use apenas contatos autorizados e
respeite as regras do WhatsApp. Para escala comercial, avalie a API oficial.

## Desenvolvimento

```powershell
npm install
node --check server.js
PORT=8788 node server.js
```

Em produção, o serviço systemd está em `whatsapp-qr.service`. Ajuste os
caminhos da sessão e do banco para o ambiente de destino; eles não devem ser
versionados.

## API mínima

- `GET /health` — estado do cliente;
- `GET /api/campaigns` — campanhas recentes;
- `POST /api/campaigns` — cria rascunho;
- `POST /api/campaigns/:id/approve` — aprova o envio;
- `POST /api/campaigns/:id/cancel` — cancela a campanha.

Este repositório não contém QR codes, sessões, tokens, bancos de produção ou
credenciais.
