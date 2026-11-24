# CT 300 — rollout do canal INFO-LRM

## Objetivo

Publicar o Gateway compatível com INFO-LRM sem recriar sessão do WhatsApp, sem apagar campanhas e sem habilitar disparo antes da homologação.

## Gate 0 — evidência antes de alterar

Registrar, sem expor segredos:
- commit realmente implantado;
- estado de `whatsapp-qr.service`;
- `GET /health`;
- caminho e metadados do banco `/var/lib/whatsapp-qr/campaigns.sqlite3`;
- existência e ownership de `/var/lib/whatsapp-qr/session`;
- configuração efetiva do Tailscale Serve.

Se sessão, banco, serviço ou checkout divergirem do esperado, parar.

## Gate 1 — backup consistente

1. Não executar logout e não abrir uma segunda instância.
2. Parar somente o serviço quando necessário para garantir consistência.
3. Preservar a sessão inteira.
4. Fazer backup consistente do SQLite, preferencialmente pela API de backup do SQLite.
5. Guardar código/configuração anterior e SHA-256 dos artefatos.
6. Preparar rollback que restaure código/configuração sem substituir banco vivo por cópia antiga automaticamente.

## Gate 2 — publicar código com envio desligado

Publicar o commit aprovado mantendo:
- `WHATSAPP_CONTROL_ENABLE_DISPATCH=false`;
- `WHATSAPP_CONTROL_TRUSTED_AUTO_APPROVAL=false`.

Validar:
- serviço ativo e sem restart loop;
- `/health` HTTP 200;
- sessão continua autenticada/ready;
- painel e campanhas anteriores intactos;
- Tailscale Serve privado, sem Funnel.

## Gate 3 — contrato INFO-LRM sem envio

Validar pelo endereço privado:
1. origem não autorizada → 403;
2. grant inválido/expirado → 401;
3. grant válido → job criado como draft;
4. repetir o mesmo `source + external_id` → retorna o mesmo job, sem duplicar;
5. consulta de status encontra o job;
6. nenhum WhatsApp é enviado com dispatch desligado.

## Gate 4 — autoaprovação controlada

Ativar somente `WHATSAPP_CONTROL_TRUSTED_AUTO_APPROVAL=true`, mantendo dispatch false.

Criar um único job de teste autorizado pelo INFO-LRM. Confirmar:
- status approved;
- snapshot/conteúdo correspondem ao job confirmado;
- idempotência preservada;
- zero envio real.

## Gate 5 — primeiro envio real

Somente após Gates 0–4:
- escolher um destinatário de teste autorizado;
- habilitar `WHATSAPP_CONTROL_ENABLE_DISPATCH=true`;
- enviar um único job;
- confirmar `delivery_status=completed`, histórico e consulta pelo INFO-LRM;
- repetir o external_id e comprovar que não gera segundo envio.

Se qualquer verificação falhar, desabilitar dispatch e executar rollback de código preservando sessão e banco.

## Aprovação

O Gateway só pode ser considerado homologado para INFO-LRM quando o ciclo completo for comprovado: OS confirmada → job idempotente → envio único → status completed → INFO-LRM marca a comunicação como entregue.
