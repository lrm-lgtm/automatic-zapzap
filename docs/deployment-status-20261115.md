# WhatsApp Control Mobile V1 — estado de publicação

## Código validado

- Base: `e72662e`.
- Alterações locais: proxy confiável, logout CSRF, rate limiting, dependências
  auditadas e testes de regressão.
- Testes: `npm run check` passou; `npm test` passou com 3 testes; `npm audit`
  reportou zero vulnerabilidades.
- Dispatch: permanece desabilitado; não foi criado envio real.

## Deploy

Status: **não concluído**.

O inventário autorizado disponível registra Proxmox e CT 210, mas não fornece
um canal administrativo validado para o CT 300. Não houve SSH, console, cópia de
arquivos, restart de serviço, configuração Tailscale ou alteração de sessão.

## Bloqueio preciso

Falta cadastrar/validar uma identidade guest autorizada para o CT 300 no cofre
e no executor operacional. O inventário atual informa que o binding do executor
Proxmox/CT 210 está pendente e não substitui acesso ao guest; o token amplo
observado no Proxmox não é adequado para reutilização em um deploy mínimo.

## Procedimento de retomada

1. Validar pelo canal autorizado o CT 300, hostname, IP e identidade guest.
2. Criar backup consistente do diretório do serviço, banco e
   `/var/lib/whatsapp-qr/session`, sem logout nem QR novo.
3. Publicar o commit validado com `WHATSAPP_CONTROL_ENABLE_DISPATCH=false`.
4. Configurar Tailscale Serve somente no CT 300, sem Funnel e sem CT 210.
5. Validar login, PWA, health, WhatsApp pronto e acesso móvel fora da LAN.
6. Registrar commit, hostname, evidências e rollback.
