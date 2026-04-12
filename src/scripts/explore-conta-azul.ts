/**
 * Script de exploração da API Conta Azul.
 *
 * Uso: npx tsx --env-file=.env.local src/scripts/explore-conta-azul.ts
 *
 * 1. Refresha o access_token usando o ContaAzulTokenManager
 * 2. Tenta descobrir o endpoint de detalhe de NF-e
 * 3. Salva o novo refresh_token no .env.local (rotativo!)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContaAzulTokenManager } from '../integrations/conta-azul/auth.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

/**
 * Persist the new refresh_token to .env.local by replacing the old value.
 */
function updateEnvFile(newRefreshToken: string): void {
  const envPath = path.resolve('.env.local');
  let content = fs.readFileSync(envPath, 'utf-8');

  // Replace the CONTA_AZUL_REFRESH_TOKEN line
  content = content.replace(
    /^CONTA_AZUL_REFRESH_TOKEN=.+$/m,
    `CONTA_AZUL_REFRESH_TOKEN=${newRefreshToken}`,
  );

  fs.writeFileSync(envPath, content, 'utf-8');
  console.log('  ✅ .env.local updated with new refresh_token\n');
}

async function probeEndpoint(
  accessToken: string,
  urlPath: string,
): Promise<{ status: number; body: string }> {
  const url = `https://api-v2.contaazul.com/v1${urlPath}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'Miranda Dashboard (dev@stepads.com.br)',
    },
  });
  const body = await response.text();
  return { status: response.status, body: body.slice(0, 500) };
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('Conta Azul API Explorer');
  console.log('========================================\n');

  // 1. Refresh token
  console.log('🔄 Refreshing access_token...');
  const manager = new ContaAzulTokenManager({
    clientId: requireEnv('CONTA_AZUL_CLIENT_ID'),
    clientSecret: requireEnv('CONTA_AZUL_CLIENT_SECRET'),
    refreshToken: requireEnv('CONTA_AZUL_REFRESH_TOKEN'),
    onRefresh: async (tokens) => {
      console.log(`  New access_token: ${tokens.newAccessToken.slice(0, 20)}...`);
      console.log(`  New refresh_token: ${tokens.newRefreshToken.slice(0, 20)}...`);
      console.log(`  Expires at: ${tokens.expiresAt.toISOString()}`);
      updateEnvFile(tokens.newRefreshToken);
    },
  });

  const accessToken = await manager.getAccessToken();
  console.log('✅ Token refreshed successfully.\n');

  // 2. First, get a real NF-e to use as test data
  console.log('📋 Fetching a recent NF-e from list endpoint...');
  const listUrl = 'https://api-v2.contaazul.com/v1/notas-fiscais?data_inicial=2026-04-01&data_final=2026-04-12&tamanho_pagina=10';
  const listResp = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'Miranda Dashboard (dev@stepads.com.br)',
    },
  });
  const listJson = await listResp.json() as { itens?: Array<{ chave_acesso: string; numero_nota: number; status: string }> };
  console.log(`  List status: ${listResp.status}`);

  let chaveAcesso = '';
  let numeroNota = 0;
  const firstItem = listJson.itens?.[0];
  if (firstItem) {
    chaveAcesso = firstItem.chave_acesso;
    numeroNota = firstItem.numero_nota;
    console.log(`  First NF-e: numero=${numeroNota}, chave=${chaveAcesso}`);
    console.log(`  Status: ${firstItem.status}\n`);
  } else {
    console.log('  ❌ No NF-e found in list response\n');
  }

  // 3. Probe potential detail endpoints
  console.log('🔍 Probing detail endpoints...\n');

  const pathsToTry = [
    // By numero_nota
    `/notas-fiscais/${numeroNota}`,
    // By chave_acesso
    `/notas-fiscais/${chaveAcesso}`,
    // Sub-resources
    `/notas-fiscais/${numeroNota}/itens`,
    `/notas-fiscais/${chaveAcesso}/itens`,
    // Different patterns
    `/nota-fiscal/${numeroNota}`,
    `/nfe/${chaveAcesso}`,
    // Vendas patterns
    `/vendas`,
    `/vendas?tamanho_pagina=10`,
    `/venda/${numeroNota}`,
    // Sales patterns (English)
    `/sales`,
    `/sales?tamanho_pagina=10`,
    // Pedidos
    `/pedidos-venda`,
    `/pedidos-venda?tamanho_pagina=10`,
    // Faturamento
    `/faturamento`,
    `/faturamento?tamanho_pagina=10`,
    // Recebimentos
    `/recebimentos`,
    `/recebimentos?tamanho_pagina=10`,
    // Contas a receber
    `/contas-receber`,
    `/contas-receber?tamanho_pagina=10`,
    // Movimentacoes
    `/movimentacoes`,
    `/movimentacoes?tamanho_pagina=10`,
    // Generic detail
    `/notas-fiscais/detalhe/${numeroNota}`,
    `/notas-fiscais/por-numero/${numeroNota}`,
    `/notas-fiscais/por-chave/${chaveAcesso}`,
  ];

  for (const p of pathsToTry) {
    const result = await probeEndpoint(accessToken, p);
    const indicator = result.status === 200 ? '✅' :
                      result.status === 400 ? '⚠️' :
                      result.status === 404 ? '❌' :
                      result.status === 502 ? '🔶' : `${result.status}`;
    const bodyPreview = result.body.slice(0, 120).replace(/\n/g, ' ');
    console.log(`  ${indicator} ${result.status}  ${p}`);
    if (result.status !== 404) {
      console.log(`          → ${bodyPreview}`);
    }
    console.log('');
  }

  console.log('========================================');
  console.log('Exploration complete');
  console.log('========================================');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
