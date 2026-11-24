# Automatic ZapZap

Painel web responsivo para revisar e agendar campanhas autorizadas no cliente
WhatsApp Web do LRM.

## Escopo atual

- painel HTTP mobile-first;
- PWA instalável com dashboard de saúde;
- login próprio com sessão e proteção CSRF;
- rascunhos de campanha com título, mensagem, destinatários e horário;
- aprovação e cancelamento explícitos;
- worker persistente com SQLite;
- limite de 20 destinatários por campanha e intervalo entre envios;
- histórico de estado e resultados mascarados;
- integração MONI explicitamente pendente, sem eventos fictícios;
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

Antes de iniciar, configure a autenticação fora do repositório:

```text
WHATSAPP_CONTROL_USERNAME=operador
WHATSAPP_CONTROL_PASSWORD_HASH=scrypt$16384$8$1$...
```

Gere apenas o hash, sem registrar a senha:

```powershell
node tools/hash-password.js "uma senha forte"
```

Sem essas variáveis, o serviço permanece sem liberar o painel e as APIs
mutáveis.

Em produção, o serviço systemd está em `whatsapp-qr.service`. Ajuste os
caminhos da sessão e do banco para o ambiente de destino; eles não devem ser
versionados.

## Integração entre sistemas LRM

A integração expõe `POST /api/integrations/jobs` para notificações idempotentes de outros sistemas LRM. O INFO-LRM usa `Authorization: LRMGrant ...`: o grant expira rapidamente e é validado pelo backend do próprio INFO-LRM, de modo que o CT 300 não recebe nenhum segredo compartilhado. O Bearer token SHA-256 continua disponível apenas como fallback para integrações máquina-a-máquina controladas.

Cada job exige `source`, `external_id`, `title`, `message` e `recipient`. O par `source + external_id` é único, evitando disparo duplicado. `POST /api/integrations/jobs/status` consulta o estado sem criar novo envio. Por padrão o job entra como rascunho. A autoaprovação só é possível se o servidor tiver `WHATSAPP_CONTROL_TRUSTED_AUTO_APPROVAL=true` e o cliente declarar `user_confirmed=true`; o dispatch geral continua dependendo de `WHATSAPP_CONTROL_ENABLE_DISPATCH=true`.

## API mínima

- `GET /health` — estado do cliente;
- `GET /api/campaigns` — campanhas recentes;
- `POST /api/campaigns` — cria rascunho;
- `POST /api/campaigns/:id/approve` — aprova o envio;
- `POST /api/campaigns/:id/cancel` — cancela a campanha.

Este repositório não contém QR codes, sessões, tokens, bancos de produção ou
credenciais.

O roteiro operacional está em [`docs/operations.md`](docs/operations.md).
