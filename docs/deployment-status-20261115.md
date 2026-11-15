# WhatsApp Control Mobile V1 - estado de publicacao

## Codigo implantado

- Commit: `913d6c2ab42819fa8b8a328433f7bda6a0148180`.
- Repositorio: `lrm-lgtm/automatic-zapzap`, branch `main`.
- `npm run check`: aprovado.
- `npm test`: aprovado.
- `npm audit`: zero vulnerabilidades reportadas.
- `WHATSAPP_CONTROL_ENABLE_DISPATCH=false` permanece ativo.

## CT 300

- Host: `192.168.254.108`.
- Servico: `whatsapp-qr.service`.
- Health validado: `state=authenticated`, `has_qr=false`, `auth_configured=true`, `dispatch_enabled=false`.
- Processo observado: um unico `/opt/whatsapp-qr/server.js`.
- Sessao preservada em `/var/lib/whatsapp-qr/session`.
- Nenhum QR foi gerado e nenhum disparo real foi executado.

## Backup e rollback

- Backup: `/var/backups/whatsapp-control/20261115T043026Z`.
- Inclui sessao, banco SQLite, codigo, lockfile, `package.json` e unit systemd.
- Manifesto: `SHA256SUMS`.
- Arquivo de sessao validado com `tar -tzf` e hash SHA-256.
- Para rollback, parar somente `whatsapp-qr.service`, restaurar os arquivos do backup,
  reconstruir as dependencias da versao anterior e iniciar o mesmo servico. Nunca
  remover `/var/lib/whatsapp-qr/session`.

## URL privada

- URL efetivamente testada: `https://atendimento1.taild2b8d7.ts.net:8443/`.
- Tailscale Serve encaminha para `http://192.168.254.108:8788`.
- HTTPS privado validado para `/health`, `/login`, `/manifest.webmanifest` e `/sw.js`.
- Funnel removido/desabilitado.
- A raiz `https://atendimento1.taild2b8d7.ts.net/` continua reservada ao BrasilSat Gestor;
  o WhatsApp Control usa a porta HTTPS `8443` para nao substituir esse servico.

## Login e PWA

- Credencial do usuario `operator` provisionada fora do GitHub no Bitwarden.
- Login HTTPS validado com status `200`.
- Cookie de sessao validado com `HttpOnly`, `SameSite=Strict` e `Secure`.
- Dashboard, manifest e service worker responderam com status `200`.
- Sessao de teste encerrada apos a validacao.

## Limites remanescentes

- O teste foi feito a partir de um dispositivo Windows membro da tailnet; ainda falta
  confirmar a abertura pelo celular fora da LAN.
- O conector permanece em `authenticated` e sem QR; o estado `ready` ainda nao foi
  observado neste ciclo.
- `whatsapp-web.js` continua sendo uma integracao nao oficial.
- A integracao MONI permanece desativada e sem eventos ficticios.
