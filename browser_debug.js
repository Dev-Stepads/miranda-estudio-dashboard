// browser_debug.js
// Conecta ao OperaGX via CDP e opera APENAS em abas do Conta Azul.
//
// Safety: toda ação valida que a URL destino/atual contém "contaazul".
// Nunca interage com nenhuma outra aba ou domínio.
//
// Uso:
//   node browser_debug.js list
//   node browser_debug.js menu-links
//   node browser_debug.js screenshot <label>
//   node browser_debug.js navigate <url> <label>

const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CDP_ENDPOINT = 'http://localhost:9222';
const SCREENSHOTS_DIR = path.join(__dirname, 'debug_screenshots');
const ALLOWED_HOST_PATTERN = /contaazul\.com/i;

function assertContaAzul(url, context) {
  if (!ALLOWED_HOST_PATTERN.test(url)) {
    console.error('ERRO DE SEGURANÇA: URL fora do domínio contaazul em ' + context);
    console.error('URL rejeitada: ' + url);
    process.exit(1);
  }
}

async function getContaAzulPages(browser) {
  const contexts = browser.contexts();
  let allPages = [];
  for (const ctx of contexts) {
    allPages.push(...ctx.pages());
  }
  const contaAzulPages = [];
  for (const p of allPages) {
    if (ALLOWED_HOST_PATTERN.test(p.url())) {
      contaAzulPages.push(p);
    }
  }
  return contaAzulPages;
}

async function takeScreenshot(page, label) {
  const url = page.url();
  assertContaAzul(url, 'takeScreenshot');

  await page.bringToFront();
  await page.waitForTimeout(800);

  const title = await page.title();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = (label || 'shot').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `contaazul_${safeLabel}_${timestamp}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  await page.screenshot({
    path: filepath,
    fullPage: true,
  });

  console.log('Screenshot salvo:');
  console.log('  Título:  ' + title);
  console.log('  URL:     ' + url);
  console.log('  Arquivo: ' + filepath);
  return filepath;
}

async function main() {
  const action = process.argv[2] || 'list';

  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const contaAzulPages = await getContaAzulPages(browser);

  if (action === 'list') {
    console.log('Abas Conta Azul encontradas: ' + contaAzulPages.length);
    console.log('');
    for (let i = 0; i < contaAzulPages.length; i++) {
      const p = contaAzulPages[i];
      const title = await p.title();
      console.log('[' + i + '] ' + title);
      console.log('    URL: ' + p.url());
      console.log('');
    }
    await browser.close();
    return;
  }

  if (action === 'menu-links') {
    if (contaAzulPages.length === 0) {
      console.error('ERRO: nenhuma aba do Conta Azul encontrada.');
      process.exit(1);
    }
    const page = contaAzulPages[0];
    assertContaAzul(page.url(), 'menu-links pré-ação');

    // Extrai todos os links <a> da página (sidebar + qualquer outro)
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .map((a) => ({
          text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
          href: a.href,
        }))
        .filter((l) => l.text && l.href);
    });

    // Filtra apenas links dentro do contaazul
    const safeLinks = links.filter((l) => /contaazul\.com/i.test(l.href));

    // Deduplica por href
    const seen = new Set();
    const unique = [];
    for (const l of safeLinks) {
      if (!seen.has(l.href)) {
        seen.add(l.href);
        unique.push(l);
      }
    }

    console.log('Links Conta Azul encontrados: ' + unique.length);
    console.log('');
    unique.forEach((l, i) => {
      console.log('[' + i + '] ' + l.text);
      console.log('    ' + l.href);
    });

    await browser.close();
    return;
  }

  if (action === 'screenshot') {
    const label = process.argv[3] || 'shot';
    if (contaAzulPages.length === 0) {
      console.error('ERRO: nenhuma aba do Conta Azul encontrada.');
      process.exit(1);
    }
    await takeScreenshot(contaAzulPages[0], label);
    await browser.close();
    return;
  }

  if (action === 'navigate') {
    const targetUrl = process.argv[3];
    const label = process.argv[4] || 'nav';

    if (!targetUrl) {
      console.error('ERRO: URL destino obrigatório.');
      process.exit(1);
    }

    // Validação dupla: só permite navegar para URL contaazul
    assertContaAzul(targetUrl, 'navigate destino');

    if (contaAzulPages.length === 0) {
      console.error('ERRO: nenhuma aba do Conta Azul encontrada.');
      process.exit(1);
    }

    const page = contaAzulPages[0];
    assertContaAzul(page.url(), 'navigate aba atual');

    console.log('Navegando para: ' + targetUrl);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => {
      console.log('networkidle timeout, tentando domcontentloaded...');
    });

    // Validação pós-navegação: confirma que continua em contaazul
    const finalUrl = page.url();
    assertContaAzul(finalUrl, 'navigate pós-ação');

    await takeScreenshot(page, label);
    await browser.close();
    return;
  }

  console.error('Ação desconhecida: ' + action);
  process.exit(1);
}

main().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
