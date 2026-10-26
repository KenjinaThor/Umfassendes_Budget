// Service Worker: Netzwerk zuerst (immer die aktuelle Version), Cache nur als Offline-Fallback.
// __BUILD__ wird beim Deployment (GitHub Actions) durch den Commit-Hash ersetzt.
const CACHE = 'budget-__BUILD__';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'changelog.json', 'css/app.css',
  'vendor/chart.umd.js', 'vendor/xlsx.full.min.js', 'vendor/supabase.js', 'js/config.js', 'js/passkey.js',
  'js/app.js', 'js/util.js', 'js/crypto.js', 'js/store.js', 'js/fx.js', 'js/market.js',
  'js/calc.js', 'js/plausibility.js', 'js/excel.js', 'js/ui.js', 'js/update.js',
  'js/dashboard.js', 'js/view-tx.js', 'js/view-assets.js', 'js/view-budget.js', 'js/recurring.js', 'js/view-recurring.js', 'js/categories.js', 'js/view-settings.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Kurs-APIs nie cachen
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
