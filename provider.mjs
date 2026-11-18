import http from 'node:http';
import url from 'node:url';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const providerDir = join(__dirname, 'provider');
const storeFile = join(providerDir, 'store.json');

// In‑memory map
const store = new Map();

// Load persisted data
async function loadStore() {
  try {
    await fs.mkdir(providerDir, { recursive: true });
    const data = await fs.readFile(storeFile, 'utf-8');
    const obj = JSON.parse(data);
    for (const [k, v] of Object.entries(obj)) {
      store.set(k, v);
    }
    console.log('[provider] Loaded store from', storeFile);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[provider] Failed to load store:', e);
    else console.log('[provider] No existing store, starting fresh');
  }
}

// Persist current map
async function saveStore() {
  try {
    const obj = Object.fromEntries(store);
    await fs.writeFile(storeFile, JSON.stringify(obj, null, 2), 'utf-8');
    console.log('[provider] Saved store to', storeFile);
  } catch (e) {
    console.error('[provider] Failed to save store:', e);
  }
}

await loadStore();

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  console.log('[provider] Incoming request:', req.method, req.url);
  const parsed = url.parse(req.url, true);
  console.log('[provider] Parsed URL:', parsed.pathname, parsed.query);

  // Create short URL
  if (parsed.pathname === '/create.php') {
    const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const longUrl = parsed.query.url;
    let short = parsed.query.shorturl;
    console.log('[provider] Create request - longUrl:', longUrl, 'short:', short);
    if (!short) short = Math.random().toString(36).slice(2, 10);
    if (store.has(short)) {
      console.warn('[provider] Short URL already taken:', short);
      res.writeHead(400, corsHeaders);
      res.end(JSON.stringify({ errorcode: 1, errormessage: 'Short URL taken' }));
      return;
    }
    store.set(short, longUrl);
    await saveStore();
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ shorturl: `http://localhost:3000/${short}`, longurl: longUrl }));
    return;
  }

  // Lookup endpoint (mimics is.gd API)
  if (parsed.pathname === '/forward.php') {
    const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const short = parsed.query.shorturl;
    console.log('[provider] Lookup request for shorturl:', short);
    if (!short) {
      res.writeHead(400, corsHeaders);
      res.end(JSON.stringify({ errorcode: 2, errormessage: 'shorturl query param missing' }));
      return;
    }
    // Strip domain from full URL if present, and trailing slashes
    let code = short.replace(/^https?:\/\/[^/]+\//, '');
    code = code.replace(/\/+$/, ''); // strip trailing slashes
    console.log('[provider] Extracted code:', code, 'from shorturl:', short);
    if (store.has(code)) {
      const longurl = store.get(code);
      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({ shorturl: short, longurl }));
    } else {
      console.warn('[provider] Code not found:', code);
      res.writeHead(404, corsHeaders);
      res.end(JSON.stringify({ errorcode: 3, errormessage: 'Short URL not found' }));
    }
    return;
  }

  // Redirect based on short code in path
  let code = parsed.pathname.slice(1);
  code = code.replace(/\/+$/, ''); // strip trailing slashes
  console.log('[provider] Redirect lookup for code:', code);
  if (store.has(code)) {
    const target = store.get(code);
    console.log('[provider] Redirecting to:', target);
    res.writeHead(302, { Location: target });
    res.end();
    return;
  }

  console.warn('[provider] Not found for code:', code);
  res.writeHead(404);
  res.end('Not found');
});

server.listen(3000, () => console.log('provider on http://localhost:3000'));
