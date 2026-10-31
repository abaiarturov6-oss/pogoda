const CACHE_NAME = 'pogoda-shell-v9';
const APP_SHELL = [
  './',
  './index.html',
  './style.css?v=4',
  './app.js?v=5',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    if (event.request.mode === 'navigate') {
      try {
        const response = await fetch(event.request);
        if (response.ok) (await caches.open(CACHE_NAME)).put(event.request, response.clone());
        return response;
      } catch {
        return caches.match('./index.html');
      }
    }
    const cached = await caches.match(event.request);
    if (cached) {
      fetch(event.request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
      }).catch(() => {});
      return cached;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok) (await caches.open(CACHE_NAME)).put(event.request, response.clone());
      return response;
    } catch (error) {
      throw error;
    }
  })());
});
