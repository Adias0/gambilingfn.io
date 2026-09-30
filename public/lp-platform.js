/*
 * LuckyPixel self-hosted platform bridge.
 * Connects the game to server.js: sign-in, saved data, player profiles, and content checks.
 * Loaded before app.js. Players must register or log in before the game becomes playable.
 */
(() => {
  'use strict';
  window.LP_SELF_HOSTED = true;
  document.documentElement.classList.add('gate-on');

  const HEADERS = { 'Content-Type': 'application/json', 'X-LP': '1' };
  let signedIn = false;
  async function api(url, body) {
    let res;
    try {
      res = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: HEADERS, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw { code: 'unavailable', message: 'Can’t reach the game server. If you run this site, check that “npm start” is running, then try again.' }; }
    let json = null;
    try { json = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      if (res.status === 401 && signedIn) setTimeout(() => location.reload(), 1200); // session ended: back to sign-in
      throw { code: (json && json.code) || (res.status === 429 ? 'rate_limited' : res.status === 403 ? 'invalid_argument' : 'unavailable'), message: (json && json.error) || 'Something went wrong. Try again.', status: res.status };
    }
    return json || {};
  }
  window.lpApi = api;
  // serverState: ok = server.js answered; down = nothing answered; wrong = some other web server answered
  let serverState = 'unknown';
  const mePromise = api('/api/me')
    .then(j => { if (!j || !('user' in j)) { serverState = 'wrong'; return null; } serverState = 'ok'; signedIn = !!j.user; return j.user || null; })
    .catch(e => { serverState = e && e.status ? 'wrong' : 'down'; return null; });

  /* ---------- live updates (polling) ---------- */
  const watchers = new Set();
  let timer = 0, kickTimer = 0;
  const refreshAll = () => watchers.forEach(w => w());
  const kick = () => { clearTimeout(kickTimer); kickTimer = setTimeout(refreshAll, 150); };
  const clone = v => (v === undefined || v === null) ? undefined : JSON.parse(JSON.stringify(v));
  const docSnap = (path, data) => ({ id: path.split('/').pop(), exists: data !== null && data !== undefined, data: () => clone(data), metadata: { fromCache: false, hasPendingWrites: false } });
  function watch(fetcher, next, error) {
    let last = null, alive = true;
    const run = async () => {
      if (!alive) return;
      try { const { key, snap } = await fetcher(); if (alive && key !== last) { last = key; next(snap); } }
      catch (e) { if (e && e.status === 401) { alive = false; watchers.delete(run); if (error) error({ code: 'revoked', message: 'Signed out' }); } }
    };
    watchers.add(run);
    if (!timer) timer = setInterval(() => { if (!document.hidden) refreshAll(); }, 2500);
    setTimeout(run, 0);
    return () => { alive = false; watchers.delete(run); };
  }

  /* ---------- document store (same shape the game uses on Claude's platform) ---------- */
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      async get() { const j = await api('/api/db/get', { path }); return docSnap(path, j.data); },
      async set(data) { await api('/api/db/set', { path, data }); kick(); },
      async update(data) { await api('/api/db/update', { path, data }); kick(); },
      async delete() { await api('/api/db/delete', { path }); kick(); },
      async acquire() { return { acquired: true }; },
      onSnapshot(next, error) {
        return watch(async () => { const j = await api('/api/db/get', { path }); return { key: JSON.stringify(j.data === undefined ? null : j.data), snap: docSnap(path, j.data) }; }, next, error);
      }
    };
  }
  function query(cpath, where, lim) {
    const run = async () => {
      const j = await api('/api/db/query', { collection: cpath, where, limit: lim });
      const docs = j.docs.map(d => docSnap(cpath + '/' + d.id, d.data));
      return { key: JSON.stringify(j.docs), snap: { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } } };
    };
    return {
      where: (f, op, v) => query(cpath, [...where, [f, op, v]], lim),
      limit: n => query(cpath, where, n),
      orderBy: () => query(cpath, where, lim),
      async get() { return (await run()).snap; },
      onSnapshot(next, error) { return watch(run, next, error); }
    };
  }
  const newId = () => 'm' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('');
  function collRef(cpath) {
    return Object.assign(query(cpath, [], 1000), {
      path: cpath,
      doc: id => docRef(cpath + '/' + (id || newId())),
      async add(data) { const ref = docRef(cpath + '/' + newId()); await ref.set(data); return ref; }
    });
  }
  const db = Object.freeze({ doc: docRef, collection: collRef });

  /* ---------- the signed-in person ---------- */
  const user = Object.freeze({
    async id() { const u = await mePromise; return u ? u.id : null; },
    async isOwner() { const u = await mePromise; return !!(u && u.isAdmin); },
    async canEdit() { const u = await mePromise; return !!(u && u.isAdmin); },
    async can(name) { const u = await mePromise; return name === 'data.write' ? !!u : false; },
    async me() {
      const u = await mePromise;
      return { id: u ? u.id : null, name: u ? u.username : '', email: u ? u.email : null, avatarUrl: '', color: '#8f3df0', isOwner: !!(u && u.isAdmin), canEdit: !!(u && u.isAdmin) };
    },
    async name() { const u = await mePromise; return u ? u.username : ''; },
    async email() { const u = await mePromise; return u ? u.email : null; },
    async avatarUrl() { return null; },
    async profiles(ids) {
      const list = [...new Set([].concat(ids))];
      let found = {};
      try { found = (await api('/api/profiles', { ids: list })).profiles || {}; } catch (e) { /* unresolved */ }
      const out = {};
      list.forEach(id => { const p = found[id] || {}; out[id] = { id, name: p.name || '', email: p.email || null, avatarUrl: '', color: '#8f3df0', isMe: false, guest: false }; });
      return out;
    },
    async search() { return []; }
  });

  /* ---------- content checks (AI when the server has an API key, basic rules otherwise) ---------- */
  let limitsPromise = null;
  const aiLimits = () => limitsPromise || (limitsPromise = api('/api/ai/limits').catch(() => ({ images: false })));
  const toBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  async function sampleJson(input, opts) {
    opts = opts || {};
    const prompt = typeof input === 'string' ? input : input.map(t => t.content).join('\n\n');
    let image = null;
    if (opts.images) {
      const blob = opts.images instanceof Blob ? opts.images : opts.images[0];
      if (blob) image = { mediaType: blob.type || 'image/jpeg', data: await toBase64(blob) };
    }
    return (await api('/api/ai', { prompt, image })).result;
  }
  const sample = async (input, opts) => ({ text: JSON.stringify(await sampleJson(input, opts)), truncated: false });
  sample.json = sampleJson;
  sample.limits = async () => {
    const l = await aiLimits();
    return l.images ? { maxPromptBytes: 262144, images: { maxCount: 1, maxInputBytes: 5e6, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } } : { maxPromptBytes: 262144 };
  };

  window.claude = {
    use: async name => {
      const u = await mePromise;
      if (!u) return null;
      return name === 'db' ? db : name === 'user' ? user : name === 'sample' ? sample : null;
    }
  };

  /* ---------- sign-in gate: register or log in before playing ---------- */
  const gate = document.getElementById('gate');
  if (!gate) return;
  const $g = s => gate.querySelector(s);
  function showOffline() {
    const text = location.protocol === 'file:'
      ? 'This page was opened as a file, so accounts can’t work. In the luckypixel-site folder, run “npm start”, then open http://localhost:3000 in your browser.'
      : serverState === 'wrong'
        ? 'This page is being served without the LuckyPixel server (server.js), so accounts can’t work. Upload the whole luckypixel-site folder to a host that runs Node.js and start it with “npm start”. Plain file or PHP hosting won’t work.'
        : 'The game server isn’t answering. If you run this site, check that “npm start” (server.js) is running, then try again.';
    $g('#gate-title').textContent = 'Can’t connect to the game server';
    $g('#gate-offline-text').textContent = text;
    $g('.gate-offline').hidden = false;
    gate.classList.add('offline');
    $g('#gate-retry').addEventListener('click', () => location.reload());
  }
  mePromise.then(u => {
    if (u) { gate.remove(); document.documentElement.classList.remove('gate-on'); return; }
    if (serverState !== 'ok') { showOffline(); return; }
    gate.classList.add('ready');
    const tabs = gate.querySelectorAll('[data-tab]');
    const show = which => {
      tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === which)));
      $g('#gate-register').hidden = which !== 'register';
      $g('#gate-login').hidden = which !== 'login';
      $g('#gate-title').textContent = which === 'register' ? 'Create your account to play' : 'Welcome back';
      const first = gate.querySelector(which === 'register' ? '#g-email' : '#g-login');
      if (first) setTimeout(() => first.focus(), 30);
    };
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    (window.lpIntroDone || Promise.resolve()).then(() => show('register'));

    $g('#gate-register').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $g('#g-reg-err'), btn = $g('#g-reg-btn');
      const email = $g('#g-email').value.trim(), username = $g('#g-user').value.trim(), pw = $g('#g-pw').value, pw2 = $g('#g-pw2').value;
      err.textContent = '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter a valid email address.'; return; }
      if (!/^[A-Za-z0-9_-]{3,16}$/.test(username)) { err.textContent = 'Usernames use 3 to 16 letters, numbers, dashes, or underscores.'; return; }
      if (/admin|moderator|staff|official|support/i.test(username)) { err.textContent = 'Player names can’t include words like “admin”. If you’re the site admin, use the Log in tab with the login from create-admin.'; return; }
      if (pw.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return; }
      if (pw !== pw2) { err.textContent = 'The two passwords don’t match.'; return; }
      if (!$g('#g-agree').checked) { err.textContent = 'Confirm that you understand credits have no cash value.'; return; }
      btn.disabled = true; btn.textContent = 'Creating account…';
      try { await api('/api/register', { email, username, password: pw }); location.reload(); }
      catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Create account and play'; }
    });
    $g('#gate-login').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $g('#g-login-err'), btn = $g('#g-login-btn');
      err.textContent = '';
      const login = $g('#g-login').value.trim(), pw = $g('#g-login-pw').value;
      if (!login || !pw) { err.textContent = 'Enter your email or username and your password.'; return; }
      btn.disabled = true; btn.textContent = 'Logging in…';
      try { await api('/api/login', { login, password: pw }); location.reload(); }
      catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Log in and play'; }
    });
  });
})();
