# A Dois

Caderno das saídas de um casal: o dia, o que fizeram e quem pagou. Ninguém deve ninguém pelo app.

```bash
npm start
```

Abre em http://127.0.0.1:8765. Os testes são `npm test`.

O código do casal junta os dois celulares. No computador a conta fica em `data/`, que não entra no git. Na Vercel, a sincronização permanente pede Redis (`KV_REST_API_URL` e `KV_REST_API_TOKEN`, ou as variáveis `UPSTASH_REDIS_REST_*`).
