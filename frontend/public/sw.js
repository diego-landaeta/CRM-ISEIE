// Kill-switch SW para CRM ISEIE.
// Las versiones anteriores (v1-v3) cacheaban /assets/* con estrategia cache-first
// y mantenían chunks viejos indefinidamente. Síntoma: tras un deploy, las gestoras
// veían la UI nueva pero el JS bundle viejo, lo que rompía recordatorios, notifs,
// cambios de status e interacciones (todo lo que pegara contra el backend nuevo).
//
// Esta versión se auto-desregistra al activarse y borra todos los caches. La PWA
// instalable vuelve a estar disponible cuando reescribamos un SW que no caché.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try { await self.registration.unregister(); } catch (_) { /* ignore */ }
    try {
      const keys = await self.caches.keys();
      await Promise.all(keys.map((k) => self.caches.delete(k)));
    } catch (_) { /* ignore */ }
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => { try { c.navigate(c.url); } catch (_) { /* ignore */ } });
    } catch (_) { /* ignore */ }
  })());
});
