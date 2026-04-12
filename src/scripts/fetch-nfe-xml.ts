import { ContaAzulTokenManager } from '../integrations/conta-azul/auth.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';

const m = new ContaAzulTokenManager({
  clientId: process.env.CONTA_AZUL_CLIENT_ID!,
  clientSecret: process.env.CONTA_AZUL_CLIENT_SECRET!,
  refreshToken: process.env.CONTA_AZUL_REFRESH_TOKEN!,
  onRefresh: async (t) => {
    const envPath = path.resolve('.env.local');
    let c = fs.readFileSync(envPath, 'utf-8');
    c = c.replace(/^CONTA_AZUL_REFRESH_TOKEN=.+$/m, `CONTA_AZUL_REFRESH_TOKEN=${t.newRefreshToken}`);
    fs.writeFileSync(envPath, c, 'utf-8');
    console.log('Token refreshed + persisted');
  },
});

const token = await m.getAccessToken();
console.log(`Token: ${token.slice(0, 30)}...`);

const resp = await fetch(
  'https://api-v2.contaazul.com/v1/notas-fiscais/29260430938298000146550010000037631416089300',
  {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Miranda Dashboard (dev@stepads.com.br)',
    },
  },
);

console.log(`Status: ${resp.status}`);
console.log(`Content-Type: ${resp.headers.get('content-type')}`);

const body = await resp.text();
console.log(`Body length: ${body.length}`);
console.log('---XML PREVIEW---');
console.log(body.slice(0, 4000));
