import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContaAzulTokenManager } from '../integrations/conta-azul/auth.ts';

const m = new ContaAzulTokenManager({
  clientId: process.env.CONTA_AZUL_CLIENT_ID!,
  clientSecret: process.env.CONTA_AZUL_CLIENT_SECRET!,
  refreshToken: process.env.CONTA_AZUL_REFRESH_TOKEN!,
  onRefresh: async (t) => {
    const p = path.resolve('.env.local');
    let c = fs.readFileSync(p, 'utf-8');
    c = c.replace(/^CONTA_AZUL_REFRESH_TOKEN=.+$/m, `CONTA_AZUL_REFRESH_TOKEN=${t.newRefreshToken}`);
    fs.writeFileSync(p, c);
    console.log('Token rotated');
  },
});

const token = await m.getAccessToken();
console.log(`Token OK\n`);

const headers = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'Miranda Dashboard (dev@stepads.com.br)',
};

const tests = [
  '/notas-fiscais?data_inicial=2026-04-01&data_final=2026-04-12',
  '/notas-fiscais?data_inicial=2026-04-01&data_final=2026-04-12&tamanho_pagina=10',
  '/notas-fiscais?data_inicial=2026-04-01&data_final=2026-04-12&tamanho_pagina=50',
  '/notas-fiscais?data_inicial=2026-04-01&data_final=2026-04-12&tamanho_pagina=50&pagina=1',
  '/notas-fiscais?data_inicial=2026-03-13&data_final=2026-04-12&tamanho_pagina=10',
];

for (const p of tests) {
  const resp = await fetch(`https://api-v2.contaazul.com/v1${p}`, { headers });
  const body = await resp.text();
  console.log(`${resp.status}  ${p}`);
  if (resp.status !== 200) {
    console.log(`  → ${body.slice(0, 200)}`);
  } else {
    const parsed = JSON.parse(body);
    console.log(`  → ${(parsed.itens ?? []).length} items`);
  }
  console.log('');
}
