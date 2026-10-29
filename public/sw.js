// Network first, cache as the fallback: online, every load is fresh (the
// server sends no-cache, so that is a cheap revalidation); offline, the last
// copy still runs. test/sw.test.js checks SHELL lists every file in public/.

const CACHE = 'unsure-v1';
const SHELL = [
    './',
    'app.js',
    'engine/evaluate.js',
    'engine/format.js',
    'engine/histogram.js',
    'engine/parse.js',
    'engine/report.js',
    'engine/sample.js',
    'engine/stats.js',
    'icons/apple-touch-icon.png',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon.svg',
    'icons/maskable-512.png',
    'index.html',
    'keypad.js',
    'manifest.webmanifest',
    'style.css',
    'worker.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(async () => {
                const hit = await caches.match(req, { ignoreSearch: true });
                if (hit) return hit;
                if (req.mode === 'navigate') return caches.match('./');
                return Response.error();
            }),
    );
});
