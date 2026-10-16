// Service worker : met en cache l'interface pour une ouverture rapide et hors ligne.
// Les appels à Supabase (données, connexion) ne sont jamais mis en cache.
const VERSION = 'cake-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/main.js', 'js/config.js', 'js/ingredients.js', 'js/scale.js',
  'img/logo.svg', 'img/cupcake.svg', 'img/cake.svg', 'img/strawberry.svg', 'img/cream.svg',
  'img/donut.svg', 'img/tart.svg', 'img/macaron.svg', 'img/rolling.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-48.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return; // toujours réseau

  const sameOrigin = url.origin === self.location.origin;
  const cdn = /cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (!sameOrigin && !cdn) return;

  // Réseau d'abord pour la page (pour récupérer les mises à jour), cache sinon.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('index.html', copy)); return res; }).catch(() => caches.match('index.html')));
    return;
  }
  // « Stale-while-revalidate » pour le reste.
  e.respondWith(caches.match(req).then((cached) => {
    const net = fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => cached);
    return cached || net;
  }));
});
