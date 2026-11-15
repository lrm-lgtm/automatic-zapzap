# Operação segura

## Configuração externa

O serviço exige, fora do repositório:

- `WHATSAPP_CONTROL_USERNAME`;
- `WHATSAPP_CONTROL_PASSWORD_HASH`;
- `WHATSAPP_CONTROL_ENABLE_DISPATCH=false` durante o piloto.

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

## Limites da V1 mobile

O PWA mostra o estado real do conector, saúde básica, campanhas existentes e o
estado vazio verdadeiro da futura integração MONI. A ingestão MONI e o envio
produtivo pelo novo painel permanecem desativados até validação específica.
