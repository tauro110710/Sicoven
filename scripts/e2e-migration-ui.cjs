const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const appPath = process.env.SICOVEN_E2E_APP;
const port = Number(process.env.SICOVEN_E2E_CDP_PORT || 9333);
const productCode = 'E2E-MIG-0001';
const fixturePath = path.join(os.tmpdir(), 'sicoven-migration-e2e.csv');
const artifactDir = path.join(process.cwd(), 'artifacts');
let appProcess;
let socket;
let nextId = 0;
const pending = new Map();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function waitFor(check, message, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await sleep(400);
  }
  throw new Error(message + (lastError ? ': ' + lastError.message : ''));
}

async function connectDebugger() {
  let target;
  await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    if (!response.ok) return false;
    const targets = await response.json();
    target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
    return Boolean(target);
  }, 'Electron no expuso el objetivo Chromium para la prueba E2E', 60000);

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message || 'CDP command failed'));
    else entry.resolve(message.result || {});
  });
}

function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed');
  }
  return response.result?.value;
}

async function clickButton(label) {
  const findExpression = '(() => { const button = [...document.querySelectorAll("button")].find(item => item.innerText.trim() === ' +
    JSON.stringify(label) + '); return Boolean(button && !button.disabled); })()';
  await waitFor(() => evaluate(findExpression), 'El botón "' + label + '" no se habilitó a tiempo', 30000);
  const clickExpression = '(() => { const button = [...document.querySelectorAll("button")].find(item => item.innerText.trim() === ' +
    JSON.stringify(label) + '); if (!button || button.disabled) return false; button.click(); return true; })()';
  const result = await evaluate(clickExpression);
  assert(result, 'No se pudo pulsar el botón "' + label + '".');
}

async function setInput(selector, value) {
  const expression = '(() => { const input = document.querySelector(' + JSON.stringify(selector) +
    '); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, "value")?.set;' +
    ' if (setter) setter.call(input, ' + JSON.stringify(value) + '); else input.value = ' + JSON.stringify(value) +
    '; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));' +
    ' input.dispatchEvent(new Event("blur", { bubbles: true })); return true; })()';
  const result = await evaluate(expression);
  assert(result, 'No se encontró el campo ' + selector + '.');
}

async function capture(name) {
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, name), Buffer.from(screenshot.data, 'base64'));
}

async function main() {
  assert(appPath && fs.existsSync(appPath), 'No se encontró el ejecutable SICOVEN indicado por SICOVEN_E2E_APP.');
  assert(typeof WebSocket === 'function', 'Node.js no ofrece WebSocket global para el protocolo CDP.');
  fs.writeFileSync(fixturePath, [
    'code,name,category,unit,currentStock,avgCostBs,lastCostBs,lastCostUsd,salesPriceBs,salesPriceUsd,minStock,costingMethod,vatTreatment,itemType,openingDate,openingBcvRate,inventoryAccountCode,costOfSalesAccountCode,adjustmentAccountCode,openingBalanceAccountCode',
    'E2E-MIG-0001,ARTICULO PRUEBA MIGRACION,E2E,Unidad,3,100,100,0.2,180,0.36,1,PROMEDIO_PONDERADO,16,MERCANCIA,2026-01-01,500,1.1.4.01,5.1.1.01,5.1.2.01,3.1.1.01'
  ].join('\n'), 'utf8');

  appProcess = spawn(appPath, ['--remote-debugging-port=' + port, '--disable-gpu'], {
    windowsHide: true,
    stdio: 'ignore',
    env: process.env
  });

  await connectDebugger();
  await command('Page.enable');
  await command('Runtime.enable');

  await waitFor(() => evaluate("Boolean(document.querySelector('#username') && document.querySelector('#password')) || Boolean(document.body && document.body.innerText.includes('Continuar con la prueba gratuita'))"), 'No apareció la pantalla de licencia ni el formulario de acceso');
  await capture('migration-login-screen.png');
  const trialButtonVisible = await evaluate("Boolean([...document.querySelectorAll('button')].find(button => button.innerText.trim() === 'Continuar con la prueba gratuita'))");
  if (trialButtonVisible) await clickButton('Continuar con la prueba gratuita');

  await waitFor(() => evaluate("Boolean(document.querySelector('#username') && document.querySelector('#password'))"), 'No apareció el formulario de acceso');
  // Create a unique local administrator as required on first launch.
  await setInput('#username', 'e2e-admin');
  await setInput('#password', 'E2E-Sicoven-Initial-Admin-2026!');
  await clickButton('Crear administrador inicial');
  // El registro inicial puede abrirse automáticamente cuando termina la
  // hidratación SQLite. Si la aplicación muestra primero la pantalla principal,
  // seguir el flujo real del selector de empresas en lugar de asumir un modal.
  try {
    await waitFor(() => evaluate("Boolean(document.querySelector('.company-registration-modal')) || Boolean([...document.querySelectorAll('button')].find(button => (button.title || '').startsWith('Empresa activa:')))"),
      'SICOVEN no mostró el selector de empresas después del acceso', 60000);
  } catch (error) {
    const diagnostic = await evaluate("JSON.stringify({title:document.title,body:(document.body?.innerText||'').slice(0,5000),url:location.href,companyModal:!!document.querySelector('.company-registration-modal'),companyButton:[...document.querySelectorAll('button')].some(button=>(button.title||'').startsWith('Empresa activa:')),loginForm:!!document.querySelector('#loginForm')})").catch(() => 'No se pudo leer el estado del renderer');
    try { await capture('migration-post-login-failure.png'); } catch {}
    throw new Error(String(error.message || error) + ' | Estado visible después del acceso: ' + diagnostic);
  }
  let companyModalOpen = await evaluate("Boolean(document.querySelector('.company-registration-modal'))");
  if (!companyModalOpen) {
    const openedSelector = await evaluate("(() => { const button = [...document.querySelectorAll('button')].find(item => (item.title || '').startsWith('Empresa activa:')); if (!button) return false; button.click(); return true; })()");
    assert(openedSelector, 'No se pudo abrir el selector de empresas.');
    await clickButton('Crear Nueva Empresa');
  }
  await waitFor(() => evaluate("Boolean(document.querySelector('.company-registration-modal'))"),
    'No se abrió el formulario de registro de empresa', 30000);
  console.log('E2E: formulario de empresa abierto mediante el flujo disponible en pantalla.');
  await setInput('input[placeholder="J-12345678-9"]', 'J-12345678-9');
  await setInput('input[placeholder="EJEMPLO COMERCIAL, C.A."]', 'E2E MIGRATION TEST, C.A.');
  // The historical start date is mandatory for every newly registered company.
  // Use a deterministic fixture date so the test exercises the real form contract.
  // Scope the date selector to the dedicated historical-start-date field.
  // The company form also contains optional adoption/notification dates.
  await setInput('.company-registration-form .border-emerald-200 input[type="date"]', '2015-01-01');
  const operationalDate = await evaluate('document.querySelector(".company-registration-form .border-emerald-200 input[type=date]")?.value || ""');
  assert(operationalDate === '2015-01-01', 'No se estableció la fecha real de inicio de operaciones.');
  const savedCompany = await evaluate('(() => { const form = document.querySelector(".company-registration-form"); if (!form) return false; form.querySelector("button[type=submit]")?.click(); return true; })()');
  assert(savedCompany, 'No se pudo enviar el registro de empresa.');
  await waitFor(() => evaluate("!document.querySelector('.company-registration-modal')"), 'La empresa de prueba no se guardó');

  await waitFor(() => evaluate("[...document.querySelectorAll('button')].some(button => button.innerText.trim() === 'Configuración')"), 'No apareció la navegación de Configuración');
  await clickButton('Configuración');
  await waitFor(() => evaluate("[...document.querySelectorAll('button')].some(button => button.innerText.includes('Abrir importador universal'))"), 'No apareció el acceso al importador transaccional');
  await clickButton('Abrir importador universal');
  await waitFor(() => evaluate("Boolean(document.querySelector('[role=dialog] #migration-target-company'))"), 'No abrió el diálogo del importador');
  await capture('migration-wizard-open.png');

  const selectedCompanyId = await evaluate('(() => { const select = document.querySelector("#migration-target-company"); const option = [...(select?.options || [])].find(item => item.value && item.textContent.includes("E2E MIGRATION TEST, C.A.") && item.textContent.includes("J-12345678-9")); if (!select || !option) return ""; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; setter.call(select, option.value); select.dispatchEvent(new Event("change", { bubbles: true })); return select.value; })()');
  assert(selectedCompanyId, 'El importador no presentó una empresa destino seleccionable.');

  const documentNode = await command('DOM.getDocument', { depth: -1, pierce: true });
  const fileNode = await command('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector: '[role="dialog"] input[type="file"]'
  });
  assert(fileNode.nodeId, 'No se encontró el selector de archivos del importador.');
  await command('DOM.setFileInputFiles', { files: [fixturePath], nodeId: fileNode.nodeId });

  await waitFor(() => evaluate('document.body.innerText.includes(' + JSON.stringify(productCode) + ')'), 'El archivo CSV no apareció en la vista previa');
  await clickButton('Seleccionar visibles');

  const confirmation = await evaluate('(() => { const label = [...document.querySelectorAll("[role=dialog] label")].find(item => item.innerText.includes("Confirmo que revisé las colecciones y los registros seleccionados")); const checkbox = label?.querySelector("input[type=checkbox]"); if (!checkbox) return false; checkbox.click(); return checkbox.checked; })()');
  assert(confirmation, 'No se pudo marcar la confirmación explícita de importación.');

  await clickButton('Importar siguiente módulo');
  try {
    await waitFor(() => evaluate("document.body.innerText.includes('Inventario importado en E2E MIGRATION TEST, C.A.')"), 'La interfaz no confirmó la importación del artículo de prueba', 60000);
  } catch (error) {
    const diagnostic = await evaluate("JSON.stringify({body:(document.body?.innerText||'').slice(-7000),target:document.querySelector('#migration-target-company')?.selectedOptions?.[0]?.textContent,dialog:!!document.querySelector('[role=dialog]')})").catch(() => 'No se pudo leer el estado del renderer');
    try { await capture('migration-import-failure.png'); } catch {}
    throw new Error(String(error.message || error) + ' | Estado de importación: ' + diagnostic);
  }
  await capture('migration-import-success.png');

  // Cada empresa opera en su propia base SQLite; el archivo raíz sicoven.sqlite
  // es la base de control/compatibilidad y no contiene el snapshot contable del tenant.
  const databasePath = path.join(process.env.APPDATA || '', 'sicoven-desktop', 'companies', selectedCompanyId, 'accounting.sqlite');
  assert(fs.existsSync(databasePath), 'No se encontró la base SQLite de prueba: ' + databasePath);
  const pythonCheck = [
    'import json, sqlite3, sys',
    "db = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)",
    "row = db.execute(\"SELECT state_json FROM app_state WHERE state_key='accounting'\").fetchone()",
    "assert row and row[0], 'SQLite no contiene el snapshot contable persistido.'",
    'state = json.loads(row[0])',
    "company = next((item for item in state.get('companies', []) if item.get('rif') == 'J-12345678-9'), None)",
    "product = next((item for item in state.get('products', []) if item.get('code') == '" + productCode + "'), None)",
    "assert company, 'La empresa de prueba no quedó persistida en SQLite.'",
    "assert product, 'El artículo importado no quedó persistido en SQLite.'",
    "assert product.get('companyId') == company.get('id'), 'El artículo quedó asociado a una empresa distinta de la empresa destino.'",
    "assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'SQLite integrity_check no está correcto.'",
    "print('E2E OK: " + productCode + " persistido en SQLite para ' + company.get('name') + '; empresaId=' + company.get('id') + '.')",
    'db.close()'
  ].join('; ');
  const verification = execFileSync('python', ['-c', pythonCheck, databasePath], { encoding: 'utf8' });
  console.log(verification.trim());
}

main().catch(error => {
  console.error('E2E migration UI failed:', error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  try { if (socket && socket.readyState === WebSocket.OPEN) socket.close(); } catch {}
  try { if (appProcess && !appProcess.killed) appProcess.kill(); } catch {}
});
