/**
 * Service Worker - سامانه ثبت گراف مدیریت اتوماسیون و ارتباطات
 * طراحی شده برای کارکرد ۱۰۰٪ آفلاین بر روی اندروید، ویندوز و مرورگرهای مدرن (PWA)
 */

// نسخه سراسری پروژه - با تغییر این متغیر، اپلیکیشن‌های نصب‌شده قدیمی نسخه جدید را شناسایی و ارتقا می‌دهند
var APP_VERSION = '3.3.1';
var CACHE_NAME = `automation-graph-pwa-v${APP_VERSION}`;
var CORE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/version.json',
  '/xlsx.full.min.js',
  '/personnel-data.json',
  '/personnel-data.js',
  '/app-logo.png',
  '/icon.png',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png'
];

// استخراج خودکار فایل‌های باندل Vite (/assets/*.js و /assets/*.css) از index.html جهت کارکرد ۱۰۰٪ آفلاین PWA
function extractBuiltAssetsFromHtml(htmlText) {
  const urls = new Set();
  if (!htmlText) return [];
  const attrRegex = /<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = attrRegex.exec(htmlText)) !== null) {
    const raw = (match[1] || '').trim();
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) continue;
    try {
      const resolved = new URL(raw, self.location.origin);
      if (resolved.origin !== self.location.origin) continue;
      if (
        resolved.pathname.startsWith('/assets/') ||
        resolved.pathname.endsWith('.js') ||
        resolved.pathname.endsWith('.css')
      ) {
        urls.add(resolved.pathname + resolved.search);
      }
    } catch (e) {}
  }
  return Array.from(urls);
}

// نصب و ذخیره اولیه دارایی‌های اصلی + باندل‌های کامپایل‌شده Vite
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of CORE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Caching asset note:', asset, err);
        }
      }

      // کش خودکار اسکریپت‌ها و استایل‌های تزریق‌شده در index.html (مثل /assets/index-*.js)
      try {
        const htmlRes = await fetch('/index.html', { cache: 'no-store' });
        if (htmlRes && htmlRes.ok) {
          const htmlCopy = htmlRes.clone();
          const htmlText = await htmlRes.text();
          await cache.put('/index.html', htmlCopy.clone());
          await cache.put('/', htmlCopy);

          const builtAssets = extractBuiltAssetsFromHtml(htmlText);
          for (const assetUrl of builtAssets) {
            try {
              await cache.add(assetUrl);
            } catch (err) {
              console.warn('[SW] Built asset cache note:', assetUrl, err);
            }
          }
        }
      } catch (err) {
        console.warn('[SW] Index HTML bundle discovery note:', err);
      }
    }).then(() => self.skipWaiting())
  );
});

// فعال‌سازی و پاک‌سازی کامل تمام نسخه‌های قبلی کش
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Cleaning old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// استراتژی پاسخ‌دهی هوشمند: Network-First با Fallback کامل به کش محلی برای کارکرد ۱۰۰٪ آفلاین
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // برای صفحات HTML، ناوبری، اسکریپت‌های JS، CSS و داده‌های JSON:
  if (
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/'
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const exactCached = await caches.match(event.request);
          if (exactCached) return exactCached;

          const cachedIgnoreSearch = await caches.match(event.request, { ignoreSearch: true });
          if (cachedIgnoreSearch) return cachedIgnoreSearch;

          if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
            return (await caches.match('/index.html', { ignoreSearch: true })) ||
                   (await caches.match('/', { ignoreSearch: true }));
          }
          return Response.error();
        })
    );
    return;
  }

  // برای سایر فایل‌ها (تصاویر، آیکون‌ها، فونت‌ها): Network-First و سپس کش آفلاین
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = (await caches.match(event.request)) ||
                       (await caches.match(event.request, { ignoreSearch: true }));
        if (cached) return cached;
        if (event.request.destination === 'image' || url.pathname.match(/\.(png|jpg|jpeg|svg|webp|ico)$/i)) {
          return (await caches.match('/app-logo.png', { ignoreSearch: true })) ||
                 (await caches.match('/icon.png', { ignoreSearch: true })) ||
                 (await caches.match('/icon-192.png', { ignoreSearch: true })) ||
                 (await caches.match('/icon.svg', { ignoreSearch: true }));
        }
        return new Response('', { status: 408, statusText: 'Offline Asset Unavailable' });
      })
  );
});

// همگام‌سازی پس‌زمینه (Background Sync API) در اولین اتصال اینترنت
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-graphs') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'TRIGGER_OFFLINE_SYNC' });
        }
      })
    );
  }
});

// دریافت پیام پرش از انتظار یا درخواست بروزرسانی از کلاینت
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
