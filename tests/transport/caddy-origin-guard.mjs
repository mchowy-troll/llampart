import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

// Real installer generator/writer, never main(), sudo, systemctl or system paths.
// Optional --tls adds a synthetic TLS listener to the generated site, not a
// supported installer option. LLAMPART_UI_ROOT + --serve-ui serves a real build.
const root = fileURLToPath(new URL('../..', import.meta.url));
const installer = process.env.LLAMPART_INSTALLER || `${root}/install.sh`;
const temporary = await mkdtemp('/tmp/opencode/llampart-origin-test-');
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
const secure = process.argv.includes('--tls');
const serveUI = process.argv.includes('--serve-ui');
const records = [];
const servers = [];
const results = [];
const streamBytes = Buffer.from('data: {"text":"żółw 🦙"}\n\ndata: [DONE]\n\n');
let cancelled = false;
let caddy;
let log;
let origin;
let failures = 0;

async function listen(server, host = '127.0.0.1') {
  servers.push(server);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  return server.address().port;
}

async function backend(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const record = { method: req.method, uri: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
  records.push(record);
  const url = new URL(req.url, 'http://fixture');
  if (serveUI) {
    const payload = url.pathname === '/props'
      ? { role: 'model', build_info: 'synthetic', default_generation_settings: { n_ctx: 4096, params: {} }, total_slots: 1, model_path: 'fixture-no-model', modalities: { vision: false, audio: false } }
      : url.pathname === '/v1/models' ? { object: 'list', data: [{ id: 'fixture-no-model', object: 'model' }] }
      : url.pathname === '/models' ? { data: [] } : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }
  if (url.searchParams.has('stream')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    let offset = 0;
    const timer = setInterval(() => {
      if (offset < streamBytes.length) res.write(streamBytes.subarray(offset, ++offset));
      else if (url.searchParams.get('stream') !== 'cancel') { clearInterval(timer); res.end(); }
    }, 10);
    res.on('close', () => { clearInterval(timer); if (url.searchParams.get('stream') === 'cancel') cancelled = true; });
    return;
  }
  if (url.searchParams.has('mcp')) {
    const message = JSON.parse(record.body);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'synthetic-session' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } : {} }));
    return;
  }
  res.writeHead(Number(url.searchParams.get('status') || 207), { 'Content-Type': 'application/json', 'X-Upstream-Test': 'preserved' });
  res.end(JSON.stringify(record));
}

function request(uri, { headers = {}, method = 'GET', body = '', base = origin } = {}) {
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request(base + uri, {
      method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, rejectUnauthorized: !secure, timeout: 5000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function check(name, run) {
  const start = records.length;
  try {
    await run();
    results.push({ name, pass: true, upstreamRequests: records.length - start });
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    results.push({ name, pass: false, error: error.message, upstream: records.slice(start) });
    console.error(`FAIL ${name}: ${error.message}; upstream=${JSON.stringify(records.slice(start))}`);
  }
}

const secrets = { Cookie: 'synthetic-cookie=own005', Authorization: 'Bearer synthetic-own005', 'X-Proxy-Header-Authorization': 'Bearer synthetic-mcp', 'Mcp-Session-Id': 'synthetic-session' };
async function denied(uri, options) {
  const before = records.length;
  const response = await request(uri, { ...options, headers: { ...secrets, ...options.headers } });
  // Assert no forwarding even when a response code happens to look safe.
  assert.equal(records.length, before, `must not reach upstream (HTTP ${response.status})`);
  assert.equal(response.status, 403);
  assert.equal(response.body, options.method === 'HEAD' ? '' : 'Cross-origin gateway request denied');
  assert(!/synthetic|upstream|127\.0\.0\.1/.test(response.body));
}

async function allowed(uri, { gateway = false, expectedUri = uri, ...options } = {}) {
  const before = records.length;
  const response = await request(uri, { ...options, headers: { ...secrets, ...options.headers } });
  assert.equal(records.length, before + 1);
  assert.equal(response.status, Number(new URL(uri, origin).searchParams.get('status') || 207));
  const record = records.at(-1);
  assert.equal(record.uri, expectedUri);
  assert.equal(record.method, options.method || 'GET');
  assert.equal(record.body, options.body || '');
  assert.equal(record.headers.authorization, secrets.Authorization);
  assert.equal(record.headers.cookie, gateway ? undefined : secrets.Cookie);
  assert.equal(record.headers['x-proxy-header-authorization'], secrets['X-Proxy-Header-Authorization']);
  assert.equal(record.headers['mcp-session-id'], secrets['Mcp-Session-Id']);
  assert.equal(record.headers['x-llampart-gateway'], gateway ? undefined : options.headers?.['X-Llampart-Gateway']);
  assert.equal(response.headers['x-upstream-test'], 'preserved');
  if (record.method === 'HEAD') assert.equal(response.body, '');
  else assert.deepEqual(JSON.parse(response.body), record);
}

try {
  const upstream = http.createServer(backend);
  const backendPort = await listen(upstream, '0.0.0.0');
  const reserve = http.createServer();
  const port = await listen(reserve);
  await new Promise((resolve) => reserve.close(resolve));
  origin = `${secure ? 'https' : 'http'}://127.0.0.1:${port}`;
  const webroot = process.env.LLAMPART_UI_ROOT || `${temporary}/web`;
  if (!process.env.LLAMPART_UI_ROOT) {
    await mkdir(`${webroot}/_app`, { recursive: true });
    for (const path of ['index.html', '_app/app.js', 'toolshed']) await writeFile(`${webroot}/${path}`, `public:${path}`);
  }
  const env = { ...process.env, XDG_DATA_HOME: temporary, XDG_CONFIG_HOME: temporary };
  const args = ['_', installer, String(port), webroot, String(backendPort), temporary];
  const definitions = `source <(sed '$d' "$1")
    LLAMPART_PORT="$2"; CURRENT_SYMLINK="$3"; BACKEND_HOST=127.0.0.1; BACKEND_PORT="$4"`;
  let config = execFileSync('bash', ['-c', `${definitions}\n generate_caddy_config`, ...args], { encoding: 'utf8' });
  if (secure) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', `${temporary}/key.pem`, '-out', `${temporary}/cert.pem`], { stdio: 'ignore' });
    config = config.replace(`:${port} {`, `:${port} {\n tls ${temporary}/cert.pem ${temporary}/key.pem`);
  }
  await writeFile(`${temporary}/Caddyfile`, `{\n admin off\n auto_https off\n}\n${config}`);
  const validation = execFileSync('caddy', ['validate', '--config', `${temporary}/Caddyfile`], { env, encoding: 'utf8', stdio: 'pipe' });
  await writeFile(`${temporary}/validation.txt`, validation);
  // Exercise the actual writer twice, creating then replacing an installed site.
  // Every filesystem variable is redirected; no service or deployment call.
  const writer = execFileSync('bash', ['-c', `${definitions}
    SUDO=(); WORK_DIR="$5/work"; mkdir -p "$WORK_DIR"
    CADDY_DIR="$5/installed"; CADDYFILE="$CADDY_DIR/Caddyfile"
    CADDY_CONF_DIR="$CADDY_DIR/conf.d"; LLAMPART_CADDY_CONFIG="$CADDY_CONF_DIR/llampart.caddy"
    CADDY_IMPORT_LINE="import $CADDY_CONF_DIR/*.caddy"; TIMESTAMP=own005
    # Production's import detector hardcodes /etc/caddy; redirect only that check.
    caddyfile_has_import() { [[ -f "$CADDYFILE" ]] && grep -Fxq "$CADDY_IMPORT_LINE" "$CADDYFILE"; }
    write_and_validate_caddy_config
    printf ':${port} {\n respond "old legacy site"\n}\n' > "$LLAMPART_CADDY_CONFIG"
    validate_existing_caddy_config
    write_and_validate_caddy_config`, ...args], { env, encoding: 'utf8', stdio: 'pipe' });
  await writeFile(`${temporary}/writer.log`, writer);
  assert.equal(await readFile(`${temporary}/installed/conf.d/llampart.caddy`, 'utf8'), secure
    ? config.replace(`\n tls ${temporary}/cert.pem ${temporary}/key.pem`, '') : config);
  log = await open(`${temporary}/caddy.log`, 'w');
  caddy = spawn('caddy', ['run', '--config', `${temporary}/Caddyfile`], { env, stdio: ['ignore', log.fd, log.fd] });
  for (let i = 0; ; i++) {
    try { await request('/'); break; } catch {
      if (i > 200 || caddy.exitCode !== null) throw new Error(await readFile(`${temporary}/caddy.log`, 'utf8'));
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (serveUI) {
    console.log(`UI_READY ${origin}`);
    await new Promise((resolve) => process.once('SIGTERM', resolve));
  } else {
    const metadata = { 'X-Llampart-Gateway': '1', 'X-Llampart-Scheme': 'http', 'X-Llampart-Host': '127.0.0.1', 'X-Llampart-Port': String(backendPort), 'X-Llampart-Prefix': '-' };
    for (const path of ['/tools', '/__llampart/api/llama-server/tools']) await check(`original exact POST ${path}`, () => denied(path, {
      method: 'POST', body: '{"tool":"synthetic-only"}', headers: { ...metadata, Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' }
    }));
    const legacy = ['/props', '/models', '/models/', '/models/load', '/models/unload', '/slots', '/slots/', '/slots/0', '/cors-proxy', '/tools', '/tools/', '/tools/run', '/v1/', '/v1/models', '/v1/chat/completions', '/v1/responses', '/v1/stream', '/v1/streams/lookup'];
    const gateway = [
      ['GET', 'llama-server/props'], ['GET', 'llama-server/models'], ['GET', 'llama-server/slots'], ['GET', 'llama-server/tools'],
      ['POST', 'llama-server/tools'], ['POST', 'llama-server/models/load'], ['POST', 'llama-server/models/unload'],
      ['POST', 'llama-server/v1/streams/lookup'], ['GET', 'llama-server/v1/stream'], ['DELETE', 'llama-server/v1/stream'],
      ...['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD'].map((method) => [method, 'llama-server/cors-proxy']),
      ...['llama-server', 'openai-compatible', 'vllm'].flatMap((provider) => [['GET', `${provider}/v1/models`], ['POST', `${provider}/v1/chat/completions`]]),
      ...['openai-compatible', 'vllm'].map((provider) => ['POST', `${provider}/v1/responses`]),
      ['GET', 'vllm/metrics'], ['GET', 'vllm/version']
    ];
    const profiles = [
      ['foreign-origin', { Origin: 'https://attacker.invalid' }, false],
      ['original-repro', { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' }, false],
      ['fetch-cross-site-no-origin', { 'Sec-Fetch-Site': 'cross-site' }, false],
      ['foreign-origin-friendly-fetch', { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'same-origin' }, false],
      ['null-origin', { Origin: 'null' }, false],
      ['same-site', { Origin: origin, 'Sec-Fetch-Site': 'same-site' }, false],
      ['fetch-none', { 'Sec-Fetch-Site': 'none' }, false],
      ['wrong-port', { Origin: `${secure ? 'https' : 'http'}://127.0.0.1:${port + 1}` }, false],
      ['forwarded-cannot-bless', { Origin: 'https://attacker.invalid', 'X-Forwarded-Host': 'attacker.invalid', 'X-Forwarded-Proto': 'https' }, false],
      ['same-origin', { Origin: origin }, true],
      ['fetch-same-origin', { 'Sec-Fetch-Site': 'same-origin' }, true],
      ['both-same-origin', { Origin: origin, 'Sec-Fetch-Site': 'same-origin' }, true],
      ['no-browser-headers', {}, true]
    ];
    for (const [method, path, isGateway] of [...legacy.map((path) => ['POST', path, false]), ...gateway.map(([method, path]) => [method, `/__llampart/api/${path}`, true])]) {
      for (const [profile, headers, accept] of profiles) await check(`${method} ${path} ${profile}`, async () => {
        const uri = `${path}?q=a%2Fb&q=2`;
        const options = { method, headers: { ...(isGateway ? metadata : {}), ...headers }, body: ['POST', 'DELETE'].includes(method) ? '{"synthetic":"żółw 🦙"}' : '' };
        if (accept) await allowed(uri, { ...options, gateway: isGateway, expectedUri: isGateway ? uri.replace(/^\/__llampart\/api\/[^/]+/, '') : uri });
        else await denied(uri, options);
      });
    }
    for (const path of legacy) for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) await check(`${method} ${path} legacy method passthrough`, () => allowed(path, { method, headers: { Origin: origin } }));
    for (const [method, path] of [['PATCH', 'llama-server/cors-proxy'], ['OPTIONS', 'llama-server/tools'], ['DELETE', 'vllm/v1/models'], ['POST', 'llama-server/v1/responses'], ['GET', 'vllm/tools'], ['GET', 'vllm/server_info']]) await check(`${method} ${path} endpoint refusal`, async () => {
      const before = records.length;
      assert.equal((await request(`/__llampart/api/${path}`, { method, headers: metadata })).status, 405);
      assert.equal(records.length, before);
    });
    await check('OPTIONS cross-origin preflight blocked; same-origin MCP preflight forwarded', async () => {
      for (const path of ['/tools', '/cors-proxy', '/__llampart/api/llama-server/cors-proxy']) await denied(path, { method: 'OPTIONS', headers: { ...metadata, Origin: 'https://attacker.invalid', 'Access-Control-Request-Method': 'POST' } });
      await allowed('/cors-proxy', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    });
    for (const path of ['/TOOLS', '/%74ools', '/tools%2Frun', '/models/%6coad', '/V1/chat/completions']) await check(`path matching ${path}`, async () => {
      await allowed(`${path}?exact=%2F`, { method: 'POST' });
      await denied(path, { method: 'POST', headers: { Origin: 'null' } });
    });
    for (const path of ['/', '/_app/app.js', '/toolshed', '/props/', '/cors-proxy/', '/v1', '/toolsmith', '/__llampart/api']) await check(`public/nonalias ${path}`, async () => {
      const before = records.length;
      const response = await request(path, { headers: { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' } });
      assert.equal(response.status, ['/', '/_app/app.js', '/toolshed'].includes(path) ? 200 : 404);
      assert.equal(records.length, before);
    });
    for (const path of ['/__llampart/api/llama-server/TOOLS', '/__llampart/api/llama-server/%74ools', '/__llampart/api/llama-server/tools/', '/__llampart/api/llama-server/tools/sub']) await check(`namespace variant ${path}`, async () => {
      const before = records.length;
      assert.equal((await request(path, { headers: metadata })).status, 405);
      assert.equal(records.length, before);
      await denied(path, { headers: { ...metadata, Origin: 'null' } });
    });
    const lan = Object.values(networkInterfaces()).flat().find((item) => item?.family === 'IPv4' && !item.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(item.address))?.address;
    await check('real LAN client without Origin; exact LAN origin', async () => {
      assert(lan, 'LAN interface required');
      const base = `${secure ? 'https' : 'http'}://${lan}:${port}`;
      for (const headers of [{}, { Origin: base }]) {
        await allowed('/tools?lan=1', { base, method: 'POST', headers });
        await allowed('/__llampart/api/llama-server/tools?lan=1', { base, method: 'POST', headers: { ...metadata, ...headers }, gateway: true, expectedUri: '/tools?lan=1' });
      }
    });
    for (const status of [400, 401, 404, 429, 500, 503]) await check(`legacy upstream HTTP ${status}`, () => allowed(`/tools?status=${status}`, { method: 'POST', body: 'unchanged' }));
    for (const [method, path] of [
      ['POST', '/v1/chat/completions'], ['POST', '/v1/responses'], ['GET', '/v1/stream'],
      ['GET', '/cors-proxy'], ['POST', '/cors-proxy'],
      ['GET', '/__llampart/api/llama-server/cors-proxy'], ['POST', '/__llampart/api/llama-server/cors-proxy'],
      ['GET', '/__llampart/api/llama-server/v1/stream'],
      ['POST', '/__llampart/api/openai-compatible/v1/chat/completions'], ['POST', '/__llampart/api/vllm/v1/responses']
    ]) await check(`SSE chunks, bytes, cancel and refusal ${method} ${path}`, async () => {
      const headers = { ...secrets, ...metadata, Origin: origin };
      const before = records.length;
      const req = (secure ? https : http).request(`${origin}${path}?stream=1`, { method, headers, rejectUnauthorized: !secure });
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on('error', reject);
        req.on('response', (res) => {
          if (res.statusCode !== 200 || res.headers['content-type'] !== 'text/event-stream') {
            res.resume(); reject(new Error(`Expected SSE 200, got ${res.statusCode}`)); return;
          }
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('error', reject); res.on('end', resolve);
        });
        req.end();
      });
      assert(chunks.length > 1);
      assert(chunks[0].length < streamBytes.length);
      assert.deepEqual(Buffer.concat(chunks), streamBytes);
      assert.equal(records.length, before + 1);
      cancelled = false;
      await new Promise((resolve, reject) => {
        const cancel = (secure ? https : http).request(`${origin}${path}?stream=cancel`, { method, headers, rejectUnauthorized: !secure }, (res) => {
          if (res.statusCode !== 200) { res.resume(); reject(new Error(`Expected SSE cancel 200, got ${res.statusCode}`)); return; }
          res.once('data', () => { res.destroy(); resolve(); });
        });
        cancel.on('error', reject);
        cancel.end();
      });
      for (let i = 0; i < 100 && !cancelled; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      assert(cancelled, 'closing client must close upstream stream');
      await denied(`${path}?stream=1`, { method, headers: { ...metadata, Origin: 'https://attacker.invalid' } });
    });
    for (const path of ['/cors-proxy', '/__llampart/api/llama-server/cors-proxy']) await check(`MCP HTTP initialize/ping session and credentials ${path}`, async () => {
      for (const [id, method] of [[1, 'initialize'], [2, 'ping']]) {
        const response = await request(`${path}?mcp=1&url=http%3A%2F%2Ffixture.invalid%2Fmcp`, { method: 'POST', headers: { ...metadata, ...secrets, Origin: origin, 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-03-26' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params: {} }) });
        assert.equal(response.status, 200);
        assert.equal(JSON.parse(response.body).id, id);
        assert.equal(response.headers['mcp-session-id'], 'synthetic-session');
        assert.equal(records.at(-1).headers['mcp-session-id'], 'synthetic-session');
        assert.equal(records.at(-1).headers['mcp-protocol-version'], '2025-03-26');
        assert.equal(records.at(-1).headers.authorization, secrets.Authorization);
        assert.equal(records.at(-1).headers['x-proxy-header-authorization'], secrets['X-Proxy-Header-Authorization']);
      }
    });
    console.log(`RESULT ${results.length - failures} PASS / ${failures} FAIL; Caddy ${execFileSync('caddy', ['version'], { encoding: 'utf8' }).trim()}; ${origin}`);
    if (failures) process.exitCode = 1;
  }
} finally {
  if (caddy && caddy.exitCode === null) { caddy.kill('SIGTERM'); await new Promise((resolve) => caddy.once('exit', resolve)); }
  await log?.close();
  for (const server of servers) { server.closeAllConnections?.(); if (server.listening) await new Promise((resolve) => server.close(resolve)); }
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await writeFile(`${artifacts}/results.json`, JSON.stringify({ temporary, origin, failures, results, records }, null, 2));
    for (const name of ['Caddyfile', 'validation.txt', 'writer.log', 'caddy.log']) {
      try { await writeFile(`${artifacts}/${name}`, await readFile(`${temporary}/${name}`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  await rm(temporary, { recursive: true, force: true });
}
