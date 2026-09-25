# A Dois

Caderno compartilhado de um casal: o dia, o que fizeram e quem pagou. Ninguém “deve” ninguém pelo app — é só registro.

**Ao vivo:** [adois-chi.vercel.app](https://adois-chi.vercel.app/)

## Funcionalidades

- Registro de saídas com data, descrição e quem pagou
- Código do casal para juntar dois celulares na mesma conta
- Funciona como PWA (instalável no celular)
- Em produção, sync via Redis (Vercel KV / Upstash)

## Stack

- HTML, CSS e JavaScript
- Node (servidor local de desenvolvimento)
- Redis na Vercel para sync permanente

## Como rodar

```bash
npm start
```

Abre em `http://127.0.0.1:8765`. Testes: `npm test`.

No computador, os dados ficam em `data/` (fora do git). Na Vercel, configure `KV_REST_API_URL` e `KV_REST_API_TOKEN` (ou as variáveis `UPSTASH_REDIS_REST_*`).
