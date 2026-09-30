/*
 * LuckyPixel platform bridge.
 * Connects the game to one of three backends, chosen by config.js:
 *   - none (GitHub Pages without settings): play is saved in the browser, account features hidden
 *   - your own server.js (apiBase, or the page is served by server.js itself)
 *   - Firebase (firebase settings): sign-in, saved data, friends, battles, and admin with no server to run
 * Players must register or log in before the game becomes playable whenever a backend is available.
 */
(() => {
  'use strict';
  const PAGES_EDITION = document.documentElement.dataset.edition === 'pages';
  if (PAGES_EDITION && !window.LP_CONFIG) {
    // config.js is missing or has a typo: say so instead of quietly hiding sign-in.
    const g = document.getElementById('gate');
    if (g) {
      document.documentElement.classList.add('gate-on');
      g.querySelector('#gate-title').textContent = 'Sign-in isn’t set up correctly';
      g.querySelector('#gate-offline-text').textContent = 'This site’s settings file (config.js) couldn’t be read, so sign-in can’t start. It usually means a small typo while pasting the Firebase settings. If you run this site, open setup.html on this site to find the problem.';
      g.querySelector('.gate-offline').hidden = false;
      g.classList.add('offline');
      g.querySelector('#gate-retry').addEventListener('click', () => location.reload());
    }
    return;
  }
  const CFG = window.LP_CONFIG || {};
  const API = String(CFG.apiBase || '').trim().replace(/\/+$/, '');
  const FB = CFG.firebase && CFG.firebase.apiKey && CFG.firebase.projectId ? CFG.firebase : null;
  if (CFG.pages && !API && !FB) {
    if (console && console.info) console.info('LuckyPixel: sign-in is off because config.js has no Firebase settings or server address. Open setup.html to check your setup.');
    // Static mode: no backend, so play is saved in this browser and account features stay hidden.
    window.LP_STATIC = true;
    const g = document.getElementById('gate'); if (g) g.remove();
    document.querySelectorAll('[data-alt]').forEach(el => { el.textContent = el.dataset.alt; });
    return;
  }
  window.LP_SELF_HOSTED = true;
  if (FB) window.LP_FIREBASE = true;
  document.documentElement.classList.add('gate-on');

  /* ---------- shared helpers ---------- */
  const clone = v => (v === undefined || v === null) ? undefined : JSON.parse(JSON.stringify(v));
  const plain = v => JSON.parse(JSON.stringify(v)); // drops undefined values before saving
  const newId = () => 'm' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('');
  const normCode = c => String(c || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');
  const CODE_RE = /^[A-Z0-9-]{4,32}$/;
  const toBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

  // Basic content rules for tags and bios (used when no AI check is available).
  const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'whore', 'slut'].concat(Array.isArray(CFG.blockedWords) ? CFG.blockedWords.map(w => String(w).toLowerCase()) : []);
  function basicCheck(text) {
    const t = String(text || ''), low = t.toLowerCase();
    if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|xyz|ru|me|co|app|link|shop)\b)/i.test(t)) return 'Links aren’t allowed';
    if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(t)) return 'Email addresses aren’t allowed';
    if (/(\+?\d[\s().-]?){7,}/.test(t)) return 'Phone numbers aren’t allowed';
    if (/(^|\s)@[a-z0-9_.]{2,}/i.test(t)) return 'Social media handles aren’t allowed';
    if (/\b(paypal|cash ?app|venmo|zelle|bitcoin|btc|usdt|crypto|real money|deposit|withdraw|gift ?cards?)\b/i.test(t)) return 'Money offers aren’t allowed';
    for (const w of BLOCKED) if (w && new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])', 'i').test(low)) return 'Contains blocked language';
    return '';
  }
  function basicReview(prompt) {
    const items = [...String(prompt).matchAll(/^\d+\. <<<([\s\S]*?)>>>$/gm)].map(m => m[1]);
    const bioM = String(prompt).match(/Bio: <<<([\s\S]*?)>>>/);
    const r = t => { const why = basicCheck(t); return { ok: !why, reason: why }; };
    return { tags: items.map(r), bio: bioM ? r(bioM[1]) : { ok: true, reason: '' } };
  }

  const backend = FB ? firebaseBackend() : serverBackend();
  window.lpApi = backend.lpApi;
  window.lpRedeem = backend.redeem;
  window.claude = {
    use: async name => {
      const u = await backend.me;
      if (!u) return null;
      return name === 'db' ? backend.db : name === 'user' ? backend.user : name === 'sample' ? backend.sample : null;
    }
  };

  /* =======================================================
     Backend 1: LuckyPixel server (server.js)
     ======================================================= */
  function serverBackend() {
    const TOKEN_MODE = !!API; // pages on another domain sign in with a token instead of a cookie
    const TOKEN_KEY = 'lp-token';
    const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
    const setToken = t => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } };
    let signedIn = false, state = 'unknown';
    async function api(url, body) {
      let res;
      const headers = { 'Content-Type': 'application/json', 'X-LP': '1' };
      if (TOKEN_MODE) { headers['X-LP-Token'] = '1'; const t = getToken(); if (t) headers.Authorization = 'Bearer ' + t; }
      try {
        res = await fetch(API + url, { method: body === undefined ? 'GET' : 'POST', headers, credentials: TOKEN_MODE ? 'omit' : 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (e) { throw { code: 'unavailable', message: TOKEN_MODE ? 'Can’t reach the game server. It may be starting up, so wait a moment and try again.' : 'Can’t reach the game server. If you run this site, check that “npm start” is running, then try again.' }; }
      let json = null;
      try { json = await res.json(); } catch (e) { /* no body */ }
      if (TOKEN_MODE && res.ok && json && json.token) setToken(json.token);
      if (TOKEN_MODE && url === '/api/logout') setToken('');
      if (!res.ok) {
        if (res.status === 401 && TOKEN_MODE && url !== '/api/login') setToken('');
        if (res.status === 401 && signedIn) setTimeout(() => location.reload(), 1200); // session ended: back to sign-in
        throw { code: (json && json.code) || (res.status === 429 ? 'rate_limited' : res.status === 403 ? 'invalid_argument' : 'unavailable'), message: (json && json.error) || 'Something went wrong. Try again.', status: res.status };
      }
      return json || {};
    }
    const me = api('/api/me')
      .then(j => { if (!j || !('user' in j)) { state = 'wrong'; return null; } state = 'ok'; signedIn = !!j.user; return j.user || null; })
      .catch(e => { state = e && e.status ? 'wrong' : 'down'; return null; });

    // live updates by polling
    const watchers = new Set();
    let timer = 0, kickTimer = 0;
    const refreshAll = () => watchers.forEach(w => w());
    const kick = () => { clearTimeout(kickTimer); kickTimer = setTimeout(refreshAll, 150); };
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
    function docRef(path) {
      return {
        id: path.split('/').pop(), path,
        async get() { const j = await api('/api/db/get', { path }); return docSnap(path, j.data); },
        async set(data) { await api('/api/db/set', { path, data }); kick(); },
        async update(data) { await api('/api/db/update', { path, data }); kick(); },
        async delete() { await api('/api/db/delete', { path }); kick(); },
        async acquire() { return { acquired: true }; },
        onSnapshot(next, error) { return watch(async () => { const j = await api('/api/db/get', { path }); return { key: JSON.stringify(j.data === undefined ? null : j.data), snap: docSnap(path, j.data) }; }, next, error); }
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
    const collRef = cpath => Object.assign(query(cpath, [], 1000), { path: cpath, doc: id => docRef(cpath + '/' + (id || newId())), async add(data) { const ref = docRef(cpath + '/' + newId()); await ref.set(data); return ref; } });
    const user = makeUser(me, async list => {
      try { return (await api('/api/profiles', { ids: list })).profiles || {}; } catch (e) { return {}; }
    });
    let limitsPromise = null;
    const aiLimits = () => limitsPromise || (limitsPromise = api('/api/ai/limits').catch(() => ({ images: false })));
    const sample = makeSample(async (prompt, image) => (await api('/api/ai', { prompt, image })).result, async () => !!(await aiLimits()).images);
    return {
      me, db: Object.freeze({ doc: docRef, collection: collRef }), user, sample, lpApi: api,
      state: () => state,
      loginLabel: 'Email or username', canForgot: false,
      register: (email, username, password) => api('/api/register', { email, username, password }),
      login: (login, password) => api('/api/login', { login, password }),
      offlineText: () => TOKEN_MODE
        ? `This site couldn’t reach its game server at ${API}. The server may be starting up (free hosts can take up to a minute), or its ALLOWED_ORIGINS setting may not include ${location.origin}.`
        : location.protocol === 'file:'
          ? 'This page was opened as a file, so accounts can’t work. In the luckypixel-site folder, run “npm start”, then open http://localhost:3000 in your browser.'
          : state === 'wrong'
            ? 'This page is being served without the LuckyPixel server (server.js), so accounts can’t work. Upload the whole luckypixel-site folder to a host that runs Node.js and start it with “npm start”. Plain file or PHP hosting won’t work.'
            : 'The game server isn’t answering. If you run this site, check that “npm start” (server.js) is running, then try again.',
      redeem: {
        redeem: code => api('/api/redeem', { code: normCode(code) }),
        list: async () => (await api('/api/admin/codes/list', {})).codes,
        create: async o => (await api('/api/admin/codes/create', o)).code,
        disable: code => api('/api/admin/codes/disable', { code })
      }
    };
  }

  /* =======================================================
     Backend 2: Firebase (Authentication + Cloud Firestore)
     ======================================================= */
  function firebaseBackend() {
    const v = String(CFG.firebaseSdk || '10.12.2');
    const base = `https://www.gstatic.com/firebasejs/${v}/`;
    let state = 'unknown', current = null;
    const ready = Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')])
      .then(([A, Au, F]) => { const app = A.initializeApp(FB); return { Au, F, auth: Au.getAuth(app), fs: F.getFirestore(app) }; });
    const me = ready.then(({ Au, F, auth, fs }) => new Promise(resolve => {
      let off = null;
      off = Au.onAuthStateChanged(auth, async u => {
        if (off) off();
        if (!u) { state = 'ok'; return resolve(null); }
        try {
          const acc = await F.getDoc(F.doc(fs, 'accounts/' + u.uid));
          let admin = false;
          try { admin = (await F.getDoc(F.doc(fs, 'admins/' + u.uid))).exists(); } catch (e) { /* not an admin */ }
          state = 'ok';
          if (!acc.exists()) { state = 'unfinished'; return resolve(null); }
          current = { id: u.uid, username: acc.data().username, email: u.email, isAdmin: admin };
          resolve(current);
        } catch (e) { state = 'fberror'; resolve(null); }
      }, () => { state = 'fberror'; resolve(null); });
    })).catch(() => { state = 'sdk'; return null; });

    const authError = e => {
      const c = e && e.code || '';
      const msg = {
        'auth/email-already-in-use': 'An account with that email already exists. Log in instead.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
        'auth/invalid-credential': 'That email or password isn’t right.',
        'auth/invalid-login-credentials': 'That email or password isn’t right.',
        'auth/wrong-password': 'That email or password isn’t right.',
        'auth/user-not-found': 'That email or password isn’t right.',
        'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
        'auth/network-request-failed': 'Can’t reach Firebase. Check your connection and try again.',
        'auth/operation-not-allowed': 'Email sign-in isn’t turned on yet. In Firebase, enable Authentication → Sign-in method → Email/Password.',
        'auth/unauthorized-domain': `This site’s address isn’t authorized in Firebase yet. Add ${location.hostname} under Authentication → Settings → Authorized domains.`,
        'auth/requires-recent-login': 'Log out and back in, then try again.'
      }[c];
      return { code: c, message: msg || (e && e.message) || 'Something went wrong. Try again.' };
    };
    const dataError = e => ({ code: e && e.code === 'permission-denied' ? 'invalid_argument' : e && e.code === 'resource-exhausted' ? 'quota_exceeded' : 'unavailable', message: e && e.code === 'permission-denied' ? 'You can’t change that.' : (e && e.message) || 'Something went wrong. Try again.' });
    const toSnap = s => ({ id: s.id, exists: s.exists(), data: () => (s.exists() ? clone(s.data()) : undefined), metadata: { fromCache: !!(s.metadata && s.metadata.fromCache), hasPendingWrites: !!(s.metadata && s.metadata.hasPendingWrites) } });
    const toQSnap = q => { const docs = q.docs.map(toSnap); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }; };
    function docRef(path) {
      const ref = async () => { const { F, fs } = await ready; return { F, r: F.doc(fs, path) }; };
      return {
        id: path.split('/').pop(), path,
        async get() { const { F, r } = await ref(); try { return toSnap(await F.getDoc(r)); } catch (e) { throw dataError(e); } },
        async set(data) { const { F, r } = await ref(); try { await F.setDoc(r, plain(data)); } catch (e) { throw dataError(e); } },
        async update(data) { const { F, r } = await ref(); try { await F.setDoc(r, plain(data), { merge: true }); } catch (e) { throw dataError(e); } },
        async delete() { const { F, r } = await ref(); try { await F.deleteDoc(r); } catch (e) { throw dataError(e); } },
        async acquire() { return { acquired: true }; },
        onSnapshot(next, error) {
          let off = null, dead = false;
          ref().then(({ F, r }) => { if (!dead) off = F.onSnapshot(r, s => next(toSnap(s)), e => error && error(dataError(e))); });
          return () => { dead = true; if (off) off(); };
        }
      };
    }
    function queryRef(cpath, wh, lim) {
      const build = async () => {
        const { F, fs } = await ready;
        const parts = wh.map(([f, op, val]) => F.where(f, op, val));
        if (lim) parts.push(F.limit(lim));
        return { F, q: F.query(F.collection(fs, cpath), ...parts) };
      };
      return {
        where: (f, op, val) => queryRef(cpath, [...wh, [f, op, val]], lim),
        limit: n => queryRef(cpath, wh, n),
        orderBy: () => queryRef(cpath, wh, lim),
        async get() { const { F, q } = await build(); try { return toQSnap(await F.getDocs(q)); } catch (e) { throw dataError(e); } },
        onSnapshot(next, error) {
          let off = null, dead = false;
          build().then(({ F, q }) => { if (!dead) off = F.onSnapshot(q, s => next(toQSnap(s)), e => error && error(dataError(e))); });
          return () => { dead = true; if (off) off(); };
        }
      };
    }
    const collRef = cpath => Object.assign(queryRef(cpath, [], 0), { path: cpath, doc: id => docRef(cpath + '/' + (id || newId())), async add(data) { const r = docRef(cpath + '/' + newId()); await r.set(data); return r; } });
    const user = makeUser(me, async list => {
      const u = await me; if (!u || !u.isAdmin) return {};
      const { F, fs } = await ready, out = {};
      await Promise.all(list.map(async id => { try { const s = await F.getDoc(F.doc(fs, 'accounts/' + id)); if (s.exists()) out[id] = { name: '', email: s.data().email || null }; } catch (e) { /* skip */ } }));
      return out;
    });
    const sample = makeSample(async prompt => basicReview(prompt), async () => false);

    async function register(email, username, password) {
      const { Au, F, auth, fs } = await ready;
      const lower = username.toLowerCase();
      let taken = false;
      try { taken = (await F.getDoc(F.doc(fs, 'usernames/' + lower))).exists(); } catch (e) { throw { message: 'Can’t reach Firebase. Check the settings in config.js and that the security rules are published.' }; }
      if (taken) throw { message: 'That username is taken. Try another.' };
      let u = auth.currentUser && auth.currentUser.email && auth.currentUser.email.toLowerCase() === email.toLowerCase() ? auth.currentUser : null;
      const fresh = !u;
      if (!u) { try { u = (await Au.createUserWithEmailAndPassword(auth, email, password)).user; } catch (e) { throw authError(e); } }
      try {
        const b = F.writeBatch(fs);
        b.set(F.doc(fs, 'usernames/' + lower), { uid: u.uid });
        b.set(F.doc(fs, 'accounts/' + u.uid), { username, email: u.email, created: Date.now() });
        await b.commit();
      } catch (e) {
        if (fresh) { try { await Au.deleteUser(u); } catch (x) { /* ignore */ } }
        throw { message: e && e.code === 'permission-denied' ? 'That username isn’t available. Try another.' : 'Your account couldn’t be finished. Try again.' };
      }
    }
    async function login(loginName, password) {
      const { Au, auth } = await ready;
      if (!loginName.includes('@')) throw { message: 'Log in with the email address you registered with.' };
      try { await Au.signInWithEmailAndPassword(auth, loginName, password); } catch (e) { throw authError(e); }
    }
    async function forgot(email) {
      const { Au, auth } = await ready;
      try { await Au.sendPasswordResetEmail(auth, email); } catch (e) { if (e && e.code !== 'auth/user-not-found') throw authError(e); }
    }
    async function lpApi(url, body) {
      const { Au, auth } = await ready;
      if (url === '/api/logout') { await Au.signOut(auth); return {}; }
      if (url === '/api/password') {
        const u = auth.currentUser; if (!u) throw { message: 'Log in first.' };
        try { await Au.reauthenticateWithCredential(u, Au.EmailAuthProvider.credential(u.email, String(body.current || ''))); }
        catch (e) { throw { message: 'Your current password isn’t right.' }; }
        try { await Au.updatePassword(u, String(body.next || '')); } catch (e) { throw authError(e); }
        return { ok: true };
      }
      if (url === '/api/admin/reset-password') throw { message: 'With Firebase, players reset their own password with “Forgot your password?” on the sign-in screen.' };
      throw { message: 'That isn’t available.' };
    }
    const redeem = {
      async redeem(code) {
        const { F, fs, auth } = await ready, id = normCode(code), uid = auth.currentUser && auth.currentUser.uid;
        if (!uid) throw { message: 'Log in first.' };
        if (!CODE_RE.test(id)) throw { message: 'Enter a valid code.' };
        const cref = F.doc(fs, 'codes/' + id), claim = F.doc(fs, 'codes/' + id + '/claims/' + uid);
        try {
          return await F.runTransaction(fs, async tx => {
            const c = await tx.get(cref);
            if (!c.exists()) throw { mine: true, message: 'That code doesn’t exist.' };
            const d = c.data();
            if (!d.active) throw { mine: true, message: 'That code has been turned off.' };
            if (d.expires && d.expires < Date.now()) throw { mine: true, message: 'That code has expired.' };
            if ((await tx.get(claim)).exists()) throw { mine: true, message: 'You’ve already redeemed that code.' };
            if (d.uses >= d.maxUses) throw { mine: true, message: 'That code has been used up.' };
            tx.update(cref, { uses: d.uses + 1 });
            tx.set(claim, { at: Date.now() });
            return { amount: d.amount };
          });
        } catch (e) { if (e && e.mine) throw e; throw { message: 'The code couldn’t be redeemed right now. Try again.' }; }
      },
      async list() {
        const { F, fs } = await ready;
        try { const q = await F.getDocs(F.collection(fs, 'codes')); return q.docs.map(s => ({ code: s.id, ...s.data() })).sort((a, b) => (b.created || 0) - (a.created || 0)); }
        catch (e) { throw dataError(e); }
      },
      async create({ code, amount, maxUses, expires }) {
        const { F, fs } = await ready, id = normCode(code), cref = F.doc(fs, 'codes/' + id);
        if (!CODE_RE.test(id)) throw { message: 'Codes use 4 to 32 letters, numbers, or dashes.' };
        try {
          await F.runTransaction(fs, async tx => {
            if ((await tx.get(cref)).exists()) throw { mine: true, message: 'That code already exists. Pick another.' };
            tx.set(cref, { amount, maxUses, uses: 0, expires: expires || null, active: true, created: Date.now() });
          });
        } catch (e) { if (e && e.mine) throw e; throw dataError(e); }
        return id;
      },
      async disable(code) { const { F, fs } = await ready; try { await F.setDoc(F.doc(fs, 'codes/' + normCode(code)), { active: false }, { merge: true }); } catch (e) { throw dataError(e); } }
    };
    return {
      me, db: Object.freeze({ doc: docRef, collection: collRef }), user, sample, lpApi, redeem,
      state: () => state,
      loginLabel: 'Email', canForgot: true, forgot,
      register, login,
      offlineText: () => state === 'sdk'
        ? 'Firebase couldn’t be loaded. Check your internet connection, or the firebaseSdk version in config.js.'
        : 'This site couldn’t connect to Firebase. Check the firebase settings in config.js, that Cloud Firestore is created, and that the included firestore.rules are published.'
    };
  }

  /* ---------- pieces both backends share ---------- */
  function makeUser(me, lookup) {
    return Object.freeze({
      async id() { const u = await me; return u ? u.id : null; },
      async isOwner() { const u = await me; return !!(u && u.isAdmin); },
      async canEdit() { const u = await me; return !!(u && u.isAdmin); },
      async can(name) { const u = await me; return name === 'data.write' ? !!u : false; },
      async me() { const u = await me; return { id: u ? u.id : null, name: u ? u.username : '', email: u ? u.email : null, avatarUrl: '', color: '#8f3df0', isOwner: !!(u && u.isAdmin), canEdit: !!(u && u.isAdmin) }; },
      async name() { const u = await me; return u ? u.username : ''; },
      async email() { const u = await me; return u ? u.email : null; },
      async avatarUrl() { return null; },
      async profiles(ids) {
        const list = [...new Set([].concat(ids))], found = await lookup(list), out = {};
        list.forEach(id => { const p = found[id] || {}; out[id] = { id, name: p.name || '', email: p.email || null, avatarUrl: '', color: '#8f3df0', isMe: false, guest: false }; });
        return out;
      },
      async search() { return []; }
    });
  }
  function makeSample(run, imagesOk) {
    async function json(input, opts) {
      opts = opts || {};
      const prompt = typeof input === 'string' ? input : input.map(t => t.content).join('\n\n');
      let image = null;
      if (opts.images) { const blob = opts.images instanceof Blob ? opts.images : opts.images[0]; if (blob) image = { mediaType: blob.type || 'image/jpeg', data: await toBase64(blob) }; }
      return run(prompt, image);
    }
    const sample = async (input, opts) => ({ text: JSON.stringify(await json(input, opts)), truncated: false });
    sample.json = json;
    sample.limits = async () => (await imagesOk()) ? { maxPromptBytes: 262144, images: { maxCount: 1, maxInputBytes: 5e6, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } } : { maxPromptBytes: 262144 };
    return sample;
  }

  /* ---------- sign-in gate: register or log in before playing ---------- */
  const gate = document.getElementById('gate');
  if (!gate) return;
  const $g = s => gate.querySelector(s);
  function showOffline() {
    $g('#gate-title').textContent = 'Can’t connect to the game server';
    $g('#gate-offline-text').textContent = backend.offlineText();
    $g('.gate-offline').hidden = false;
    gate.classList.add('offline');
    $g('#gate-retry').addEventListener('click', () => location.reload());
  }
  backend.me.then(u => {
    if (u) { gate.remove(); document.documentElement.classList.remove('gate-on'); return; }
    const st = backend.state();
    if (st !== 'ok' && st !== 'unfinished') { showOffline(); return; }
    gate.classList.add('ready');
    const loginInput = $g('#g-login');
    $g('#g-login-label').textContent = backend.loginLabel;
    if (backend.loginLabel === 'Email') { loginInput.type = 'email'; loginInput.autocomplete = 'email'; }
    if (backend.canForgot) {
      $g('#g-forgot-note').hidden = true;
      const fb = $g('#g-forgot'); fb.hidden = false;
      fb.addEventListener('click', async () => {
        const err = $g('#g-login-err'), email = loginInput.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter your email above, then tap “Forgot your password?” again.'; return; }
        try { await backend.forgot(email); err.className = 'form-err ok'; err.textContent = 'If an account uses that email, a reset link is on its way. Check your inbox and spam folder.'; }
        catch (e) { err.className = 'form-err'; err.textContent = e.message; }
      });
    }
    const tabs = gate.querySelectorAll('[data-tab]');
    const show = which => {
      tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === which)));
      $g('#gate-register').hidden = which !== 'register';
      $g('#gate-login').hidden = which !== 'login';
      $g('#gate-title').textContent = st === 'unfinished' && which === 'register' ? 'Finish setting up your account' : which === 'register' ? 'Create your account to play' : 'Welcome back';
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
      if (/admin|moderator|staff|official|support/i.test(username)) { err.textContent = 'Player names can’t include words like “admin”. If you’re the site admin, use the Log in tab.'; return; }
      if (pw.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return; }
      if (pw !== pw2) { err.textContent = 'The two passwords don’t match.'; return; }
      if (!$g('#g-agree').checked) { err.textContent = 'Confirm that you understand credits have no cash value.'; return; }
      btn.disabled = true; btn.textContent = 'Creating account…';
      try { await backend.register(email, username, pw); location.reload(); }
      catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Create account and play'; }
    });
    $g('#gate-login').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $g('#g-login-err'), btn = $g('#g-login-btn');
      err.className = 'form-err'; err.textContent = '';
      const login = loginInput.value.trim(), pw = $g('#g-login-pw').value;
      if (!login || !pw) { err.textContent = `Enter your ${backend.loginLabel.toLowerCase()} and your password.`; return; }
      btn.disabled = true; btn.textContent = 'Logging in…';
      try { await backend.login(login, pw); location.reload(); }
      catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Log in and play'; }
    });
  });
})();
