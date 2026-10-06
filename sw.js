// Network-first, falls back to the saved copy when offline.
var C = 'wj-v1';
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(function (c) { return c.add('/'); }).catch(function () {}));
});
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname.indexOf('/api/') === 0) return;
  e.respondWith(
    fetch(r).then(function (res) {
      var cp = res.clone();
      caches.open(C).then(function (c) { c.put(r, cp); });
      return res;
    }).catch(function () {
      return caches.match(r).then(function (m) { return m || caches.match('/'); });
    })
  );
});
