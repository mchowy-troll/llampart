import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, open } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = await mkdtemp('/tmp/opencode/llampart-gateway-test-');
const servers = [];
let caddy;
const development = process.argv.includes('--vite');
let log;
let passed = 0;
let cancelled = false;
let sni;
const bytes = Buffer.from('data: {"text":"żółw 🦙"}\n\ndata: [DONE]\n\n');
async function listen(server, host = '127.0.0.1') {
  servers.push(server);
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, host, accept); });
  return server.address().port;
}
function backend(request, response) {
  const url = new URL(request.url, 'http://test');
  if (url.searchParams.has('stream')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let offset = 0;
    const timer = setInterval(() => {
      response.write(bytes.subarray(offset, ++offset));
      if (offset === bytes.length) {
        clearInterval(timer);
        if (url.searchParams.get('stream') !== 'cancel') response.end();
      }
    }, 5);
    response.on('close', () => { clearInterval(timer); if (url.searchParams.get('stream') === 'cancel') cancelled = true; });
    return;
  }
  response.writeHead(Number(url.searchParams.get('status') || 200), { 'Content-Type': 'application/json', 'X-Upstream-Test': 'preserved' });
  response.end(JSON.stringify({ uri: request.url, headers: request.headers, sni }));
}
async function check(name, test) { await test(); passed++; console.log(`PASS: ${name}`); }
try {
  const httpPort = await listen(http.createServer(backend), '0.0.0.0');
  const otherPort = await listen(http.createServer(backend));
  const ipv6Port = await listen(http.createServer(backend), '::1');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', `${temporary}/key.pem`, '-out', `${temporary}/cert.pem`], { stdio: 'ignore' });
  const tls = https.createServer({ key: await readFile(`${temporary}/key.pem`), cert: await readFile(`${temporary}/cert.pem`) }, backend);
  tls.on('secureConnection', (socket) => { sni = socket.servername; });
  const tlsPort = await listen(tls);
  const reserve = http.createServer();
  const port = await listen(reserve);
  await new Promise((accept) => reserve.close(accept));
  const config = development ? '' : execFileSync('bash', ['-c', `source <(sed '$d' "$1")
    LLAMPART_PORT="$2"
    CURRENT_SYMLINK="$3"
    BACKEND_HOST=127.0.0.1
    BACKEND_PORT="$4"
    generate_caddy_config`, '_', `${root}/install.sh`, String(port), temporary, String(httpPort)], { encoding: 'utf8' });
  await writeFile(`${temporary}/Caddyfile`, `{\n admin off\n auto_https off\n}\n${config}`);
  const env = { ...process.env, XDG_DATA_HOME: temporary, XDG_CONFIG_HOME: temporary, SSL_CERT_FILE: `${temporary}/cert.pem` };
  if (!development) execFileSync('caddy', ['validate', '--config', `${temporary}/Caddyfile`], { env, stdio: 'pipe' });
  log = await open(`${temporary}/caddy.log`, 'w');
  caddy = development
    ? spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], { cwd: `${root}/server/webui`, env: { ...env, NODE_EXTRA_CA_CERTS: `${temporary}/cert.pem`, LLAMPART_DEV_BACKEND_URL: `http://127.0.0.1:${httpPort}` }, detached: true, stdio: ['ignore', log.fd, log.fd] })
    : spawn('caddy', ['run', '--config', `${temporary}/Caddyfile`], { env, stdio: ['ignore', log.fd, log.fd] });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { await fetch(origin); break; } catch {
      if (i >= 1200 || caddy.exitCode !== null) throw new Error(await readFile(`${temporary}/caddy.log`, 'utf8'));
      await new Promise((accept) => setTimeout(accept, 25));
    }
  }
  const metadata = { 'X-Llampart-Gateway': '1', 'X-Llampart-Scheme': 'http', 'X-Llampart-Host': '127.0.0.1', 'X-Llampart-Port': String(httpPort), 'X-Llampart-Prefix': '-' };
  const path = '/__llampart/api/openai-compatible/v1/models';
  const request = (suffix = '', headers = {}, method = 'GET', uri = path) => fetch(origin + uri + suffix, { method, headers: { ...metadata, ...headers }, redirect: 'manual' });
  for (const host of ['127.0.0.1', '0.0.0.0', 'localhost']) await check(`HTTP ${host}`, async () => {
    const response = await request('?x=a%2Fb&x=2', { 'X-Llampart-Host': host });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).uri, '/v1/models?x=a%2Fb&x=2');
  });
  await check('HTTP IPv6', async () => assert.equal((await request('', { 'X-Llampart-Host': '[::1]', 'X-Llampart-Port': String(ipv6Port) })).status, 200));
  await check('HTTP LAN', async () => {
    const address = Object.values(networkInterfaces()).flat().find((item) => item?.family === 'IPv4' && !item.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(item.address))?.address;
    assert(address, 'LAN interface required');
    assert.equal((await request('', { 'X-Llampart-Host': address })).status, 200);
  });
  await check('HTTPS certificate, SNI, Host and Bearer', async () => {
    const response = await request('', { 'X-Llampart-Scheme': 'https', 'X-Llampart-Host': 'localhost', 'X-Llampart-Port': String(tlsPort), Authorization: 'Bearer gateway-test-secret' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sni, 'localhost');
    assert.equal(body.headers.host, `localhost:${tlsPort}`);
    assert.equal(body.headers.authorization, 'Bearer gateway-test-secret');
  });
  await check('HTTPS certificate hostname mismatch denied', async () => assert.equal((await request('', { 'X-Llampart-Scheme': 'https', 'X-Llampart-Port': String(tlsPort), Authorization: 'Bearer gateway-test-secret', 'X-Proxy-Header-Authorization': 'Bearer mcp-test-secret' })).status, 502));
  await check('Routing headers, cookies and hop-by-hop fields do not leak', async () => {
    const body = await new Promise((accept, reject) => {
      const req = http.request(origin + path, { headers: { ...metadata, Cookie: 'browser-secret=1', Connection: 'X-Hop-Test', 'X-Hop-Test': 'remove' } }, (res) => {
        let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => accept(JSON.parse(text)));
      });
      req.on('error', reject); req.end();
    });
    assert(!Object.keys(body.headers).some((name) => name.startsWith('x-llampart-')));
    assert.equal(body.headers.cookie, undefined);
    assert.equal(body.headers['x-hop-test'], undefined);
  });
  await check('URI prefixes and query strings', async () => {
    for (const prefix of ['/proxy/api', '/api+test']) assert.equal((await (await request('?q=1', { 'X-Llampart-Prefix': prefix })).json()).uri, `${prefix}/v1/models?q=1`);
  });
  for (const status of [400, 401, 404, 429, 500, 503]) await check(`HTTP ${status} body and headers preserved`, async () => {
    const response = await request(`?status=${status}`);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('X-Upstream-Test'), 'preserved');
    assert.equal((await response.json()).uri, `/v1/models?status=${status}`);
  });
  await check('Fragmented SSE including split UTF-8', async () => {
    const response = await request('?stream=1', {}, 'POST', '/__llampart/api/vllm/v1/chat/completions');
    assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
    const reader = response.body.getReader();
    const first = await reader.read();
    assert(first.value.length < bytes.length);
    const received = [first.value];
    for (;;) { const { value, done } = await reader.read(); if (done) break; received.push(value); }
    assert.deepEqual(Buffer.concat(received), bytes);
  });
  await check('Abort closes active upstream stream', async () => {
    const controller = new AbortController();
    const response = await fetch(`${origin}/__llampart/api/vllm/v1/chat/completions?stream=cancel`, { method: 'POST', headers: metadata, signal: controller.signal });
    await response.body.getReader().read();
    controller.abort();
    for (let i = 0; i < 100 && !cancelled; i++) await new Promise((accept) => setTimeout(accept, 20));
    assert(cancelled);
  });
  await check('Upstream changes without restart', async () => {
    assert.equal((await (await request('', { 'X-Llampart-Port': String(otherPort) })).json()).headers.host, `127.0.0.1:${otherPort}`);
    assert.equal((await request()).status, 200);
  });
  await check('Native fallback, tools and resumable V2 routes', async () => {
    const fallback = await request('?default=1', { 'X-Llampart-Host': '-', 'X-Llampart-Port': '0' }, 'POST', '/__llampart/api/llama-server/tools');
    assert.equal(fallback.status, 200);
    const body = await fallback.json();
    assert.equal(body.headers.host, `127.0.0.1:${httpPort}`);
    assert.equal(body.uri, '/tools?default=1');
    assert.equal((await request('?conv_id=opaque&from=42', {}, 'DELETE', '/__llampart/api/llama-server/v1/stream')).status, 200);
    assert.equal((await request('', {}, 'POST', '/__llampart/api/vllm/tools')).status, 405);
  });
  await check('Provider Responses and optional vLLM telemetry endpoint/method scope', async () => {
    for (const provider of ['openai-compatible', 'vllm']) assert.equal((await request('', {}, 'POST', `/__llampart/api/${provider}/v1/responses`)).status, 200);
    assert.equal((await request('', {}, 'POST', '/__llampart/api/llama-server/v1/responses')).status, 405);
    assert.equal((await request('', {}, 'GET', '/__llampart/api/vllm/metrics')).status, 200);
    assert.equal((await request('', {}, 'GET', '/__llampart/api/vllm/version')).status, 200);
    assert.equal((await request('', {}, 'GET', '/__llampart/api/openai-compatible/metrics')).status, 405);
	assert.equal((await request('', {}, 'GET', '/__llampart/api/vllm/server_info?config_format=json')).status, 405);
  });
  await check('Native MCP proxy methods are scoped to llama-server', async () => {
    for (const method of ['HEAD', 'GET', 'POST', 'DELETE', 'OPTIONS']) assert.equal((await request('?url=http%3A%2F%2Fmcp.test%2Fmcp', {}, method, '/__llampart/api/llama-server/cors-proxy')).status, 200);
    assert.equal((await request('', {}, 'GET', '/__llampart/api/vllm/cors-proxy')).status, 405);
    assert.equal((await request('', {}, 'PATCH', '/__llampart/api/llama-server/cors-proxy')).status, 405);
  });
  await check('No metadata, forbidden endpoints/methods and cross-origin denied', async () => {
    assert.equal((await fetch(origin + path)).status, 400);
    assert.equal((await request('', {}, 'DELETE')).status, 405);
    assert.equal((await request('', {}, 'GET', '/__llampart/api/vllm/admin')).status, 405);
    assert.equal((await request('', { Origin: 'https://untrusted.test' })).status, 403);
    assert.equal((await request('', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await request('', { Origin: origin })).status, 200);
  });
  await check('Independent HTTP client rejects malformed routing headers', async () => {
    for (const headers of [
      { 'X-Llampart-Scheme': 'ftp' }, { 'X-Llampart-Host': 'user@localhost' },
      { 'X-Llampart-Host': 'localhost/path' }, { 'X-Llampart-Host': '999.1.1.1' },
      { 'X-Llampart-Port': '65536' }, { 'X-Llampart-Port': '0080' },
      { 'X-Llampart-Prefix': '/a/../admin' }, { 'X-Llampart-Prefix': '/%2e%2e' },
      { 'X-Llampart-Prefix': '//host' }, { 'X-Llampart-Prefix': '/%252fadmin' },
      { 'X-Llampart-Host': ['localhost', 'other.test'] },
      { 'X-Llampart-Scheme': ['http', 'https'] }, { 'X-Llampart-Port': ['80', '81'] },
      { 'X-Llampart-Prefix': '/%0d%0aInjected' }, { 'X-Llampart-Prefix': '/%2fadmin' },
      { 'X-Llampart-Host': '[::1]:80' }, { 'X-Llampart-Host': '127.1' }, { 'X-Llampart-Host': '0177.0.0.1' }
    ]) {
      const status = await new Promise((accept, reject) => {
        const req = http.request(origin + path, { headers: { ...metadata, ...headers } }, (res) => { res.resume(); accept(res.statusCode); });
        req.on('error', reject); req.end();
      });
      assert.equal(status, 400, JSON.stringify(headers));
    }
  });
  await check('No provider or native MCP Bearer secret in gateway logs, including TLS failure', async () => {
    const contents = await readFile(`${temporary}/caddy.log`, 'utf8');
    assert(!contents.includes('gateway-test-secret')); assert(!contents.includes('mcp-test-secret'));
  });
  console.log(`All ${passed} ${development ? 'npm run dev / Vite' : 'Caddy'} transport checks passed.`);
} finally {
  if (caddy && caddy.exitCode === null) { if (development) process.kill(-caddy.pid, 'SIGTERM'); else caddy.kill('SIGTERM'); await new Promise((accept) => caddy.once('exit', accept)); }
  await log?.close();
  for (const server of servers) { server.closeAllConnections?.(); if (server.listening) await new Promise((accept) => server.close(accept)); }
  await rm(temporary, { recursive: true, force: true });
}
