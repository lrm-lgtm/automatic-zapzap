# Auditoria de segurança V1

## Base e evidência

- Base solicitada: commit `e72662e`.
- Repositório: `lrm-lgtm/automatic-zapzap`.
- Comando: `npm audit --json` antes da correção.
- Resultado inicial: 23 vulnerabilidades, sendo 1 crítica, 15 altas, 5 moderadas e 2 baixas.
- Resultado após lock atualizado: 0 vulnerabilidades reportadas pelo npm audit.

## Cadeias corrigidas

| Cadeia | Versão/range afetado | Correção aplicada |
| --- | --- | --- |
| `sqlite3 -> node-gyp -> tar` | `sqlite3` 5.0.0-5.1.7; `tar` <=7.5.20, incluindo DoS crítico <=7.5.18 e travessias de caminho | `sqlite3` 6.0.1, que usa `node-gyp` 12.4.0 e `tar` 7.5.23 |
| `whatsapp-web.js -> puppeteer -> @puppeteer/browsers -> extract-zip/proxy-agent` | `puppeteer` 19.8.1-25.12.0; `extract-zip` <=2.0.1; `proxy-agent` >=6 | overrides para `puppeteer` 25.17.0, `puppeteer-core` 25.17.0 e `@puppeteer/browsers` 3.2.7 |
| `puppeteer -> chromium-bidi -> zod` | `zod` <4.6.6; `chromium-bidi` 0.5.13-157.0.8081-0 | `chromium-bidi` 14.0.0 e `zod` 4.6.7 |
| `whatsapp-web.js` opcional -> `archiver -> archiver-utils -> glob/minimatch` | `archiver` 7.0.0-7.0.1; `glob` 9-14.0.1; `minimatch` 7-11.0.0 | `archiver` 8.0.0, `zip-stream` 7.0.5, `glob` 14.0.6 e `minimatch` 11.0.8 |

As versões foram resolvidas no lock sem `npm audit fix --force`. A compatibilidade
do cliente WhatsApp deve continuar sendo verificada em staging antes do CT 300.

## Correções de aplicação

- Proxy confiável agora usa `WHATSAPP_CONTROL_TRUSTED_PROXY_IPS` com allowlist
  exata e loopback como padrão; `X-Forwarded-*` de clientes diretos não define
  mais `req.ip` ou cookie seguro.
- Logout agora passa por autenticação e proteção CSRF: aceita o token de sessão
  ou `Origin`/`Referer` estritamente do próprio host para preservar o botão
  existente do painel.
- Rate limiting de login agora tem janela limitada, `Retry-After`, limite de
  chaves e limpeza de entradas expiradas.

## Testes

```text
npm run check
npm test
npm audit --json
```

Resultado observado em 2026-11-15: check passou, 3 testes passaram e audit
reportou zero vulnerabilidades.
