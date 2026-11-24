# Operação segura

## Configuração externa

O serviço exige, fora do repositório:

- `WHATSAPP_CONTROL_USERNAME`;
- `WHATSAPP_CONTROL_PASSWORD_HASH`;
- `WHATSAPP_CONTROL_ENABLE_DISPATCH=false` durante o piloto.
- `WHATSAPP_CONTROL_TRUSTED_PROXY_IPS=127.0.0.1,::1,192.168.254.200` quando o HTTPS privado
  termina em um proxy local, como Tailscale Serve. A lista deve conter somente
  enderecos de proxies administrados; nao use `trust proxy=1` por padrao.

O hash é gerado localmente com `node tools/hash-password.js`. A senha em
texto nunca deve ser gravada em arquivo de projeto, commit ou log.

## Preservação da sessão

Não iniciar um segundo processo usando `/var/lib/whatsapp-qr/session`. Antes de
qualquer atualização no CT 300, registrar o commit implantado e criar backup
protegido dos dados persistentes. Não remover a sessão nem executar logout para
obter QR Code.

## Rollback

1. Identificar o commit anterior validado.
2. Parar somente o serviço WhatsApp Control, se necessário.
3. Restaurar os arquivos da versão anterior.
4. Preservar `/var/lib/whatsapp-qr/session` e o banco.
5. Iniciar o serviço.
6. Validar `/health`, estado do processo e preservação da sessão.

O rollback não deve apagar sessão, banco, anexos ou logs de auditoria.

## Estado de segurança do código

O commit de base `e72662e` tinha `app.set('trust proxy', 1)`, logout sem
verificação CSRF e um limitador de login sem limite de chaves. A versão validada
usa uma allowlist exata de proxies, exige sessão e CSRF ou origem estritamente
do próprio host no logout, e limita/pruneia as chaves do rate limiter.

O `npm audit` validado após a atualização do lock reportou `0` vulnerabilidades
info/low/moderate/high/critical. A atualização foi explícita, sem
`npm audit fix --force`: `sqlite3=6.0.1`, overrides de Puppeteer e dependências
de arquivamento corrigidas. O cliente `whatsapp-web.js` continua sendo uma
integração não oficial e deve permanecer em piloto, com dispatch desabilitado.

## Publicação CT 300

Os commits `913d6c2ab42819fa8b8a328433f7bda6a0148180` e `5fad0ff` estão publicados no CT 300.
O acesso privado validado é `https://atendimento1.taild2b8d7.ts.net:8443/`.
O Tailscale Serve usa o Windows como proxy LAN para o CT 300, sem dependência do
CT 210 e sem Funnel. A sessão WhatsApp existente permanece fora do Git e não foi
removida, recriada ou usada por uma segunda instância.

## Limites da V1 mobile

O PWA mostra o estado real do conector, saúde básica, campanhas existentes e o
estado vazio verdadeiro da futura integração MONI. A ingestão MONI e o envio
produtivo pelo novo painel permanecem desativados até validação específica.


## Integração privada INFO-LRM

O INFO-LRM usa grants HMAC de curta duração emitidos por uma Function autenticada. O CT 300 não recebe o segredo: valida cada grant pela Function `communication-verify` do próprio INFO-LRM. O navegador recebe somente o grant expirável; destinatário e conteúdo ficam vinculados ao grant.

Antes de habilitar envio automático, publicar esta versão preservando sessão/banco e validar: OPTIONS/CORS, grant válido, grant expirado, idempotência, campanha criada, entrega e consulta de status. Somente então avaliar `WHATSAPP_CONTROL_TRUSTED_AUTO_APPROVAL=true` e `WHATSAPP_CONTROL_ENABLE_DISPATCH=true`.
