'use strict';
/*
 * LuckyPixel Casino server. A fictional casino simulation using virtual credits only.
 * Zero dependencies: needs Node.js 18 or newer.
 *
 *   node server.js                      start the site (default http://localhost:3000)
 *   node server.js create-admin [name]  create an admin login and print its password once
 *   node server.js reset-password <username-or-email>   set a new random password
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- configuration (.env is optional) ---------- */
const ROOT = __dirname;
(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'luckypixel-db.json');
const COOKIE_SECURE = (process.env.COOKIE_SECURE || 'auto').toLowerCase(); // true | false | auto
const TRUST_PROXY = (process.env.TRUST_PROXY || 'false').toLowerCase() === 'true';
const AI_KEY = process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';
const SESSION_DAYS = 30;
const START_TIME = Date.now();

/* ---------- storage: one JSON file, written atomically ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let DB = { version: 1, users: {}, sessions: {}, docs: {} };
if (fs.existsSync(DB_FILE)) {
  try { DB = { ...DB, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; }
  catch (e) { console.error('Could not read ' + DB_FILE + '. Fix or remove it before starting.'); process.exit(1); }
}
let saveTimer = null;
function persist() { if (!saveTimer) saveTimer = setTimeout(flush, 300); }
function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB));
  fs.renameSync(tmp, DB_FILE);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { flush(); } finally { process.exit(0); } });

/* ---------- passwords (scrypt) ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashPassword = pw => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16);
  crypto.scrypt(pw, salt, 64, SCRYPT, (err, key) => err ? reject(err) : resolve({ salt: salt.toString('base64'), hash: key.toString('base64') }));
});
const verifyPassword = (pw, u) => new Promise(resolve => {
  if (!u || !u.salt || !u.hash) return resolve(false);
  crypto.scrypt(pw, Buffer.from(u.salt, 'base64'), 64, SCRYPT, (err, key) => {
    if (err) return resolve(false);
    const stored = Buffer.from(u.hash, 'base64');
    resolve(stored.length === key.length && crypto.timingSafeEqual(stored, key));
  });
});
function randomPassword(len = 20) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(len), b => A[b % A.length]).join('');
}
const DUMMY_USER = { salt: crypto.randomBytes(16).toString('base64'), hash: crypto.randomBytes(64).toString('base64') };

/* ---------- users ---------- */
const USERNAME_RE = /^[A-Za-z0-9_-]{3,16}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const RESERVED_RE = /admin|moderator|staff|official|support/i;
const findUser = login => {
  const l = String(login || '').trim().toLowerCase();
  return Object.values(DB.users).find(u => u.emailLower === l || u.usernameLower === l) || null;
};
const publicUser = u => ({ id: u.id, username: u.username, email: u.email, isAdmin: !!u.admin, created: u.created });
async function createUser({ email, username, password, admin = false }) {
  const { salt, hash } = await hashPassword(password);
  const id = 'u_' + crypto.randomBytes(9).toString('base64url');
  const u = { id, email: email || null, emailLower: email ? email.toLowerCase() : null, username, usernameLower: username.toLowerCase(), salt, hash, admin, created: Date.now() };
  DB.users[id] = u; persist();
  return u;
}

/* ---------- sessions ---------- */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  DB.sessions[sha(token)] = { uid: userId, exp: Date.now() + SESSION_DAYS * 864e5 };
  persist();
  setCookie(res, req, token, SESSION_DAYS * 86400);
}
function setCookie(res, req, value, maxAge) {
  const secure = COOKIE_SECURE === 'true' || (COOKIE_SECURE === 'auto' && isHttps(req));
  res.setHeader('Set-Cookie', `lp_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}
const isHttps = req => req.socket.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
function sessionUser(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)lp_session=([A-Za-z0-9_-]{20,})/);
  if (!m) return null;
  const key = sha(m[1]), s = DB.sessions[key];
  if (!s) return null;
  if (s.exp < Date.now()) { delete DB.sessions[key]; persist(); return null; }
  return DB.users[s.uid] || null;
}
function endSessionsFor(uid, exceptKey) {
  for (const [k, s] of Object.entries(DB.sessions)) if (s.uid === uid && k !== exceptKey) delete DB.sessions[k];
  persist();
}
setInterval(() => { const now = Date.now(); let n = 0; for (const [k, s] of Object.entries(DB.sessions)) if (s.exp < now) { delete DB.sessions[k]; n++; } if (n) persist(); }, 36e5).unref();

/* ---------- rate limiting ---------- */
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return false; }
  b.count++;
  return b.count > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 6e4).unref();
const clientIp = req => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

/* ---------- document store with access rules ---------- */
const SEG_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const COLLECTIONS = new Set(['players', 'profiles', 'photos', 'names', 'matches', 'battles']);
function parseDocPath(p) {
  if (typeof p !== 'string') return null;
  const s = p.split('/');
  if (s.length !== 2 || !s.every(x => SEG_RE.test(x) && x !== '.' && x !== '..') || !COLLECTIONS.has(s[0])) return null;
  return { col: s[0], id: s[1], path: p };
}
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const getDoc = p => (DB.docs[p] ? DB.docs[p].data : null);
function canRead(u, col, id, data) {
  if (u.admin) return true;
  if (col === 'players') return id === u.id;
  if (col === 'matches' || col === 'battles') return !data || data.a === u.id || data.b === u.id;
  return true; // profiles, photos, names: any signed-in player
}
function canWrite(u, col, id, existing, next) {
  if (u.admin) return true;
  if (col === 'players' || col === 'profiles' || col === 'photos') return id === u.id;
  if (col === 'names') return (!existing || existing.owner === u.id) && (next === null || next.owner === u.id);
  if (col === 'matches' || col === 'battles') {
    if (!existing) return !!next && next.a === u.id && typeof next.b === 'string' && next.b !== u.id && !!DB.users[next.b];
    if (existing.a !== u.id && existing.b !== u.id) return false;
    return next === null ? existing.a === u.id : (next.a === existing.a && next.b === existing.b);
  }
  return false;
}
function deepMerge(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  return out;
}
const MAX_DOC = 256 * 1024, MAX_DOCS = 20000;
function cmp(a, op, b) {
  switch (op) {
    case '==': return a === b; case '!=': return a !== b;
    case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
    case 'in': return Array.isArray(b) && b.includes(a); case 'not-in': return Array.isArray(b) && !b.includes(a);
    case 'array-contains': return Array.isArray(a) && a.includes(b);
    default: return false;
  }
}

/* ---------- content checks ---------- */
const BLOCKED = (() => {
  const f = path.join(ROOT, 'blocked-words.txt');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(w => w && !w.startsWith('#'));
})();
function basicCheck(text) {
  const t = String(text || ''), low = t.toLowerCase();
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|xyz|ru|me|co|app|link|shop)\b)/i.test(t)) return 'Links aren’t allowed';
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(t)) return 'Email addresses aren’t allowed';
  if (/(\+?\d[\s().-]?){7,}/.test(t)) return 'Phone numbers aren’t allowed';
  if (/(^|\s)@[a-z0-9_.]{2,}/i.test(t)) return 'Social media handles aren’t allowed';
  if (/\b(paypal|cash ?app|venmo|zelle|bitcoin|btc|usdt|crypto|real money|deposit|withdraw|gift ?cards?)\b/i.test(t)) return 'Money offers aren’t allowed';
  if (RESERVED_RE.test(t) && /\b(i am|i'm|im|official)\b/i.test(t)) return 'Pretending to be staff isn’t allowed';
  for (const w of BLOCKED) if (new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])', 'i').test(low)) return 'Contains blocked language';
  return '';
}
function basicReview(prompt) {
  // Mirrors the JSON the game asks the AI for, using simple rules when no API key is configured.
  const items = [...String(prompt).matchAll(/^\d+\. <<<([\s\S]*?)>>>$/gm)].map(m => m[1]);
  const bioM = String(prompt).match(/Bio: <<<([\s\S]*?)>>>/);
  const r = t => { const why = basicCheck(t); return { ok: !why, reason: why }; };
  return { tags: items.map(r), bio: bioM ? r(bioM[1]) : { ok: true, reason: '' } };
}
function extractJson(text) {
  const tryParse = s => { try { return JSON.parse(s); } catch (e) { return undefined; } };
  let v = tryParse(text.trim());
  if (v !== undefined) return v;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && (v = tryParse(fence[1].trim())) !== undefined) return v;
  const a = text.search(/[[{]/), b = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (a >= 0 && b > a && (v = tryParse(text.slice(a, b + 1))) !== undefined) return v;
  return undefined;
}
async function aiReview(prompt, image) {
  // Claude API Messages endpoint. See https://docs.claude.com/en/api/overview
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  content.push({ type: 'text', text: prompt + '\n\nReply with the JSON only.' });
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 400, messages: [{ role: 'user', content }] })
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) throw Object.assign(new Error('upstream'), { code: 'upstream_error', detail: j && j.error ? j.error.message : res.status });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    const parsed = extractJson(text);
    if (parsed === undefined) throw Object.assign(new Error('bad json'), { code: 'invalid_json' });
    return parsed;
  } finally { clearTimeout(t); }
}

/* ---------- HTTP helpers ---------- */
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
const fail = (res, status, error, code) => send(res, status, { error, code: code || undefined });
function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- API ---------- */
const routes = {};
routes['GET /api/me'] = (req, res, u) => send(res, 200, { user: u ? publicUser(u) : null });
routes['GET /api/health'] = (req, res) => send(res, 200, { ok: true, uptime: Math.round((Date.now() - START_TIME) / 1000) });

routes['POST /api/register'] = async (req, res, u, body) => {
  if (limited('reg:' + clientIp(req), 10, 36e5)) return fail(res, 429, 'Too many sign-ups from this network. Try again later.', 'rate_limited');
  const email = String(body.email || '').trim(), username = String(body.username || '').trim(), password = String(body.password || '');
  if (!EMAIL_RE.test(email) || email.length > 254) return fail(res, 400, 'Enter a valid email address.');
  if (!USERNAME_RE.test(username)) return fail(res, 400, 'Usernames use 3 to 16 letters, numbers, dashes, or underscores.');
  if (RESERVED_RE.test(username)) return fail(res, 400, 'That username isn’t available. Try another.');
  if (password.length < 8 || password.length > 200) return fail(res, 400, 'Use a password of at least 8 characters.');
  if (password.toLowerCase() === username.toLowerCase() || password.toLowerCase() === email.toLowerCase()) return fail(res, 400, 'Choose a password that isn’t your username or email.');
  if (findUser(email)) return fail(res, 409, 'An account with that email already exists. Log in instead.');
  if (findUser(username)) return fail(res, 409, 'That username is taken. Try another.');
  const nu = await createUser({ email, username, password });
  createSession(res, req, nu.id);
  send(res, 201, { user: publicUser(nu) });
};
routes['POST /api/login'] = async (req, res, u, body) => {
  const login = String(body.login || '').trim().toLowerCase(), password = String(body.password || '');
  if (limited('login-ip:' + clientIp(req), 30, 9e5) || limited('login:' + login, 8, 9e5)) return fail(res, 429, 'Too many attempts. Wait 15 minutes and try again.', 'rate_limited');
  const found = findUser(login);
  const ok = await verifyPassword(password, found || DUMMY_USER);
  if (!found || !ok) return fail(res, 401, 'That email, username, or password isn’t right.', 'bad_login');
  createSession(res, req, found.id);
  send(res, 200, { user: publicUser(found) });
};
routes['POST /api/logout'] = (req, res) => {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)lp_session=([A-Za-z0-9_-]{20,})/);
  if (m) { delete DB.sessions[sha(m[1])]; persist(); }
  setCookie(res, req, '', 0);
  send(res, 200, { ok: true });
};
routes['POST /api/password'] = async (req, res, u, body) => {
  if (!u) return fail(res, 401, 'Log in first.', 'unauthenticated');
  if (limited('pw:' + u.id, 8, 9e5)) return fail(res, 429, 'Too many attempts. Wait 15 minutes and try again.', 'rate_limited');
  const next = String(body.next || '');
  if (!(await verifyPassword(String(body.current || ''), u))) return fail(res, 400, 'Your current password isn’t right.');
  if (next.length < 8 || next.length > 200) return fail(res, 400, 'Use at least 8 characters for the new password.');
  Object.assign(u, await hashPassword(next));
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)lp_session=([A-Za-z0-9_-]{20,})/);
  endSessionsFor(u.id, m ? sha(m[1]) : null);
  send(res, 200, { ok: true });
};
routes['POST /api/admin/reset-password'] = async (req, res, u, body) => {
  if (!u || !u.admin) return fail(res, 403, 'Only admins can do that.');
  const target = DB.users[String(body.id || '')];
  if (!target) return fail(res, 404, 'That player wasn’t found.');
  const password = randomPassword(12);
  Object.assign(target, await hashPassword(password));
  endSessionsFor(target.id);
  send(res, 200, { password });
};
routes['POST /api/profiles'] = (req, res, u, body) => {
  if (!u) return fail(res, 401, 'Log in first.', 'unauthenticated');
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 500) : [], out = {};
  for (const id of ids) { const x = DB.users[id]; if (x) out[id] = { name: '', email: u.admin ? x.email : null }; }
  send(res, 200, { profiles: out });
};

routes['POST /api/db/get'] = (req, res, u, body) => {
  const p = parseDocPath(body.path);
  if (!p) return fail(res, 400, 'Bad path.', 'invalid_argument');
  const data = getDoc(p.path);
  send(res, 200, { data: data && canRead(u, p.col, p.id, data) ? data : null });
};
routes['POST /api/db/query'] = (req, res, u, body) => {
  const col = String(body.collection || '');
  if (!COLLECTIONS.has(col)) return fail(res, 400, 'Bad collection.', 'invalid_argument');
  const where = Array.isArray(body.where) ? body.where.slice(0, 10) : [];
  const limit = Math.max(1, Math.min(1000, Number(body.limit) || 1000));
  const docs = [];
  for (const [p, rec] of Object.entries(DB.docs).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    const [c, id] = p.split('/');
    if (c !== col || !canRead(u, c, id, rec.data)) continue;
    if (!where.every(w => Array.isArray(w) && typeof w[0] === 'string' && cmp(rec.data[w[0]], w[1], w[2]))) continue;
    docs.push({ id, data: rec.data });
    if (docs.length >= limit) break;
  }
  send(res, 200, { docs });
};
async function writeDoc(res, u, body, mode) {
  const p = parseDocPath(body.path);
  if (!p) return fail(res, 400, 'Bad path.', 'invalid_argument');
  if (limited('w:' + u.id, 900, 6e4)) return fail(res, 429, 'Slow down a little.', 'resource_exhausted');
  const existing = getDoc(p.path);
  let next = null;
  if (mode !== 'delete') {
    if (!isObj(body.data)) return fail(res, 400, 'Documents must be objects.', 'invalid_argument');
    if (mode === 'update' && !existing) return fail(res, 400, 'That document doesn’t exist.', 'invalid_argument');
    next = mode === 'update' ? deepMerge(existing, body.data) : body.data;
    if (JSON.stringify(next).length > MAX_DOC) return fail(res, 400, 'That’s too much data for one document.', 'invalid_argument');
    if (!existing && Object.keys(DB.docs).length >= MAX_DOCS) return fail(res, 507, 'The site’s storage is full.', 'quota_exceeded');
  }
  if (!canWrite(u, p.col, p.id, existing, next)) return fail(res, 403, 'You can’t change that.', 'invalid_argument');
  if (mode === 'delete') delete DB.docs[p.path];
  else DB.docs[p.path] = { data: next, updated: Date.now() };
  persist();
  send(res, 200, { ok: true });
}
routes['POST /api/db/set'] = (req, res, u, body) => writeDoc(res, u, body, 'set');
routes['POST /api/db/update'] = (req, res, u, body) => writeDoc(res, u, body, 'update');
routes['POST /api/db/delete'] = (req, res, u, body) => writeDoc(res, u, body, 'delete');

routes['GET /api/ai/limits'] = (req, res) => send(res, 200, { ai: !!AI_KEY, images: !!AI_KEY });
routes['POST /api/ai'] = async (req, res, u, body) => {
  if (limited('ai:' + u.id, 40, 36e5)) return fail(res, 429, 'Too many checks at once. Wait a minute, then try again.', 'rate_limited');
  const prompt = String(body.prompt || '').slice(0, 20000);
  let image = null;
  if (body.image) {
    const mt = String(body.image.mediaType || ''), data = String(body.image.data || '');
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mt) || !/^[A-Za-z0-9+/=]+$/.test(data)) return fail(res, 400, 'That image can’t be checked.', 'image_rejected');
    if (data.length > 7e6) return fail(res, 413, 'That image is too large.', 'too_large');
    image = { mediaType: mt, data };
  }
  if (!AI_KEY) {
    if (image) return send(res, 200, { result: { ok: true, reason: '' } });
    return send(res, 200, { result: basicReview(prompt) });
  }
  try { send(res, 200, { result: await aiReview(prompt, image) }); }
  catch (e) {
    console.error('AI check failed:', e.code || e.name, e.detail || '');
    if (!image && e.code !== 'invalid_json') return send(res, 200, { result: basicReview(prompt) }); // fall back to basic rules
    fail(res, 502, 'The check couldn’t finish. Try again.', e.code || 'upstream_error');
  }
};

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res);
  }
  const route = routes[req.method + ' ' + url];
  if (!route) return fail(res, 404, 'Not found.');
  try {
    let body = {};
    if (req.method === 'POST') {
      // Blocks cross-site form posts: browsers can't add this header cross-origin without CORS approval.
      if (req.headers['x-lp'] !== '1' || !String(req.headers['content-type'] || '').startsWith('application/json')) return fail(res, 403, 'Bad request.');
      const origin = req.headers.origin;
      if (origin) { try { if (new URL(origin).host !== req.headers.host) return fail(res, 403, 'Bad origin.'); } catch (e) { return fail(res, 403, 'Bad origin.'); } }
      body = await readBody(req);
      if (!isObj(body)) return fail(res, 400, 'Bad request.');
    }
    const u = sessionUser(req);
    const open = url === '/api/me' || url === '/api/health' || url === '/api/register' || url === '/api/login' || url === '/api/logout';
    if (!open && !u) return fail(res, 401, 'Log in first.', 'unauthenticated');
    await route(req, res, u, body);
  } catch (e) {
    if (e && e.status) return fail(res, e.status, e.status === 413 ? 'That’s too much data.' : 'Bad request.');
    console.error(e);
    if (!res.headersSent) fail(res, 500, 'Something went wrong on the server.');
  }
});

/* ---------- command line ---------- */
async function cli(cmd, arg) {
  if (cmd === 'create-admin') {
    const username = arg || 'admin-' + crypto.randomBytes(3).toString('hex');
    if (!USERNAME_RE.test(username)) { console.error('Admin usernames use 3 to 16 letters, numbers, dashes, or underscores.'); process.exit(1); }
    const password = randomPassword(20);
    let u = findUser(username);
    if (u) { Object.assign(u, await hashPassword(password), { admin: true }); endSessionsFor(u.id); }
    else u = await createUser({ email: null, username, password, admin: true });
    flush();
    console.log('\nAdmin login created. This password is shown only once, so store it somewhere safe.\n');
    console.log('  Username: ' + username);
    console.log('  Password: ' + password + '\n');
    console.log('Log in on the site with these, then open the Admin tab.\n');
    process.exit(0);
  }
  if (cmd === 'reset-password') {
    const u = findUser(arg);
    if (!u) { console.error('No account matches "' + (arg || '') + '".'); process.exit(1); }
    const password = randomPassword(14);
    Object.assign(u, await hashPassword(password)); endSessionsFor(u.id); flush();
    console.log('\nNew password for ' + u.username + ': ' + password + '\n');
    process.exit(0);
  }
  console.error('Unknown command. Use: create-admin [username] | reset-password <username-or-email>');
  process.exit(1);
}
if (process.argv[2]) cli(process.argv[2], process.argv[3]);
else server.listen(PORT, HOST, () => {
  console.log(`LuckyPixel Casino running at http://localhost:${PORT}`);
  console.log(AI_KEY ? `Content checks: AI (${AI_MODEL})` : 'Content checks: basic rules (set ANTHROPIC_API_KEY to use AI)');
  if (!Object.values(DB.users).some(u => u.admin)) console.log('No admin yet. Run: node server.js create-admin');
});
