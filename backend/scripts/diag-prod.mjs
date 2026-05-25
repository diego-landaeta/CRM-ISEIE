// Diagnóstico runtime de https://crm.iseie.com: captura console y network errors.
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[PAGE ERROR] ${err.message}\n${err.stack || ''}`));
  page.on('requestfailed', (req) => logs.push(`[NET FAIL] ${req.url()} :: ${req.failure()?.errorText}`));
  page.on('response', (res) => { if (res.status() >= 400) logs.push(`[HTTP ${res.status()}] ${res.url()}`); });
  await page.goto('https://crm.iseie.com/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));
  console.log('=== LOGS ===');
  for (const l of logs) console.log(l);
  console.log('=== END ===');
  const html = await page.content();
  console.log('HTML body length:', (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || ['', ''])[1].length);
} finally { await browser.close(); }
