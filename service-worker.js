/* پولینو — Service Worker
   • فقط فایل‌های برنامه را کش می‌کند (Cache Storage). به IndexedDB دست نمی‌زند؛ داده‌ی کاربر در به‌روزرسانی حفظ می‌شود.
   • نسخه‌ی کش با هر انتشار (build) عوض می‌شود: 6ed4ed52fd هنگام ساخت جایگزین می‌شود. */
const BUILD = '6ed4ed52fd';
const PREFIX = 'polino-shell-';
const LEGACY_PREFIX = 'malyar-shell-'; /* کش نسخه‌ی قبلی (قبل از تغییر نام) */
const CACHE = PREFIX + BUILD;
const SHELL = [
  './', './app/', './manifest.json',
  './assets/fonts/vazirmatn-arabic-wght-normal.woff2',
  './assets/fonts/vazirmatn-latin-wght-normal.woff2',
  './assets/icons/icon.svg', './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png', './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png', './assets/icons/favicon-32.png', './assets/icons/favicon-48.png',
  './assets/shots/desktop.webp', './assets/shots/dash.webp', './assets/shots/budget.webp',
  './assets/shots/forecast.webp', './assets/shots/wealth.webp', './assets/shots/people.webp', './assets/shots/sms.webp'
];
/* آدرس را یکسان می‌کنیم: بدون query/hash و index.html → پوشه */
const keyOf = u => { const x = new URL(u, self.location.href); x.search = ''; x.hash = ''; x.pathname = x.pathname.replace(/index\.html$/, ''); return x.href; };

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* یکی‌یکی؛ نبودن یک فایل فرعی نباید نصب را خراب کند، ولی صفحات اصلی ضروری‌اند */
    const must = ['./', './app/', './manifest.json'];
    await Promise.all(SHELL.map(async p => {
      try { const r = await fetch(new Request(p, { cache: 'reload' })); if (r.ok && !r.redirected) await c.put(keyOf(p), r); else if (must.includes(p)) throw new Error(p); }
      catch (err) { if (must.includes(p)) throw err; }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    /* فقط کش‌های قدیمیِ همین برنامه پاک می‌شوند */
    for (const k of await caches.keys()) if ((k.startsWith(PREFIX) && k !== CACHE) || k.startsWith(LEGACY_PREFIX)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/service-worker.js')) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE), key = keyOf(req.url), hit = await c.match(key);
    /* هم‌زمان نسخه‌ی تازه را در پس‌زمینه می‌گیریم (stale-while-revalidate)؛ دفعه‌ی بعد اعمال می‌شود */
    const net = fetch(req).then(r => { if (r && r.ok && r.type === 'basic' && !r.redirected) c.put(key, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const r = await net;
    if (r) return r;
    if (req.mode === 'navigate') return (await c.match(keyOf(url.pathname.includes('/app') ? './app/' : './'))) || Response.error();
    return Response.error();
  })());
});

/* ================= یادآورها و اعلان‌ها =================
   صف یادآور را برنامه می‌سازد (IndexedDB: settings / notifQueue)؛ اینجا فقط خوانده و نمایش داده می‌شود.
   این بخش به داده‌ی دیگری دست نمی‌زند و فقط ردیف notifQueue را (فهرست «نمایش‌داده‌شده‌ها») به‌روز می‌کند. */
const DB_NAME = 'PersonalFinanceDB', Q_KEY = 'notifQueue', Q_TAG = 'polino-due-check', MAX_AGE = 48 * 36e5;
const idbOpen = () => new Promise((res, rej) => { const r = indexedDB.open(DB_NAME); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function checkReminders() {
  if (!self.Notification || Notification.permission !== 'granted') return 0;
  let db; try { db = await idbOpen(); } catch (e) { return 0; }
  try {
    if (!db.objectStoreNames.contains('settings')) return 0;
    const row = await new Promise(res => { const r = db.transaction('settings').objectStore('settings').get(Q_KEY); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
    const q = row && row.value; if (!q || !Array.isArray(q.items)) return 0;
    const now = Date.now(), shown = Object.assign({}, q.shown || {}); let n = 0;
    const icon = new URL('assets/icons/icon-192.png', self.registration.scope).href;
    for (const it of q.items) {
      if (it.at <= now && now - it.at <= MAX_AGE && !shown[it.id]) {
        await self.registration.showNotification(it.title, { body: it.body, tag: it.id, lang: 'fa', dir: 'rtl', icon, badge: icon, data: { url: './app/' } });
        shown[it.id] = now; n++;
      }
    }
    if (n) await new Promise(res => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: Q_KEY, value: Object.assign({}, q, { shown }) }); tx.oncomplete = tx.onerror = tx.onabort = () => res(); });
    return n;
  } finally { db.close(); }
}
/* ۱) از صفحه، وقتی برنامه باز است */
self.addEventListener('message', e => { if (e.data && e.data.type === 'check-reminders') e.waitUntil(checkReminders()); });
/* ۲) بررسی دوره‌ای مرورگر (فقط Chrome/Edge برنامه‌ی نصب‌شده؛ زمان‌بندی با مرورگر است) */
self.addEventListener('periodicsync', e => { if (e.tag === Q_TAG) e.waitUntil(checkReminders()); });
/* ۳) Push از سرور اختیاری. در iOS هر Push باید اعلان نمایش بدهد (بدون نمایش، اشتراک لغو می‌شود) */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  e.waitUntil((async () => {
    const icon = new URL('assets/icons/icon-192.png', self.registration.scope).href;
    if (d.title) { await self.registration.showNotification(d.title, { body: d.body || '', tag: d.tag, lang: 'fa', dir: 'rtl', icon, badge: icon, data: { url: d.url || './app/' } }); return; }
    if (!(await checkReminders())) await self.registration.showNotification('پولینو', { body: 'یادآور سررسید: برنامه را باز کنید.', tag: 'generic', lang: 'fa', dir: 'rtl', icon, data: { url: './app/' } });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './app/', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) if (c.url.startsWith(self.registration.scope + 'app')) { await c.focus(); return; }
    await clients.openWindow(target);
  })());
});
