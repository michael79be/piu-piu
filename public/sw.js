const CACHE_NAME = 'piu-piu-v1';
let VAPID_PUBLIC_KEY = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function loadVapidPublicKey() {
  if (VAPID_PUBLIC_KEY) {
    return VAPID_PUBLIC_KEY;
  }
  const response = await fetch('/config.json');
  if (!response.ok) {
    throw new Error(`Failed to load config: ${response.status}`);
  }
  const config = await response.json();
  VAPID_PUBLIC_KEY = config.vapidPublicKey.trim();
  return VAPID_PUBLIC_KEY;
}

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (url.origin !== location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);
        return networkResponse;
      } catch {
        return new Response('Offline', { status: 503 });
      }
    })()
  );
});

self.addEventListener('push', (event) => {
  console.log('[SW] Push received');
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Piu-Piu', body: event.data.text() };
    }
  }

  const targetAccount = data.targetAccount || data.accountName;
  const accountName = targetAccount;
  if (!accountName) {
    console.log('[SW] No accountName in push data, skipping');
    return;
  }

  event.waitUntil(
    (async () => {
      // Check if target account has a valid subscription in IndexedDB
      const hasSubscription = await checkAccountSubscription(targetAccount);
      if (!hasSubscription) {
        console.log('[SW] No valid subscription for account:', targetAccount, 'skipping');
        return;
      }

      console.log('[SW] Processing push for target account:', targetAccount);

      // If push contains posts array, save all posts to IndexedDB
      if (data.posts && Array.isArray(data.posts)) {
        // Group posts by senderAccount and store in respective databases
        const postsByAccount = new Map();
        for (const post of data.posts) {
          let postObj = post;
          if (typeof post === 'string') {
            try {
              postObj = JSON.parse(post);
            } catch {
              console.warn('[SW] Failed to parse post string:', post);
              continue;
            }
          }
          
          if (postObj && postObj.uuid) {
            // Determine which account this post belongs to (use senderAccount from post)
            const postAccount = postObj.senderAccount;
            if (!postAccount) {
              console.warn('[SW] Post missing senderAccount:', postObj.uuid);
              continue;
            }
            if (!postsByAccount.has(postAccount)) {
              postsByAccount.set(postAccount, []);
            }
            postsByAccount.get(postAccount).push(postObj);
          }
        }
        
        // Save posts to each account's database
        for (const [postAccount, posts] of postsByAccount) {
          const db = await openDB(postAccount);
          for (const postObj of posts) {
            const isMetaPost = postObj.uuid.startsWith('@');
            console.log('[SW] Checking if post exists:', postObj.uuid, isMetaPost ? '(meta)' : '', 'for account:', postAccount);
            const existing = await dbGet(db, 'posts', postObj.uuid);
            if (!existing || isMetaPost) {
              console.log('[SW] Saving', isMetaPost ? 'meta ' : '', 'post to DB:', postObj.uuid, 'for account:', postAccount);
              await dbPut(db, 'posts', postObj.uuid, postObj);
            } else {
              console.log('[SW] Post already exists, skipping:', postObj.uuid, 'for account:', postAccount);
            }
          }
        }
      }
    })()
  );
});

async function checkAccountSubscription(accountName) {
  try {
    console.log('[SW] Checking subscription for account:', accountName);
    // Open the account's IndexedDB database
    const db = await openDB(accountName);
    console.log('[SW] DB opened, object stores:', Array.from(db.objectStoreNames));
    const data = await dbGet(db, 'posts', '@subscription');
    console.log('[SW] Subscription data found:', !!data);
    return !!data;
  } catch (error) {
    console.error('[SW] Failed to check subscription:', error);
    return false;
  }
}

function openDB(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('posts')) {
        db.createObjectStore('posts');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbPut(db, storeName, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click:', event.action);
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === location.origin && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

async function subscribeToPush() {
  try {
    const vapidPublicKey = await loadVapidPublicKey();
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    console.log('[SW] Push subscription:', subscription);
    return subscription;
  } catch (error) {
    console.error('[SW] Push subscription failed:', error);
    throw error;
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }

  if (event.data?.type === 'test-push') {
    console.log('[SW] Test push requested');
    const testData = {
      title: 'Piu-Piu Test',
      body: 'This is a test push notification!',
      data: { test: true, timestamp: Date.now() },
    };
    self.registration.showNotification(testData.title, {
      body: testData.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [200, 100, 200],
      data: testData.data,
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'close', title: 'Close' },
      ],
      requireInteraction: true,
    });
  }

  if (event.data?.type === 'subscribe-push') {
    event.waitUntil(
      subscribeToPush().then((subscription) => {
        event.ports[0]?.postMessage({ success: true, subscription });
      }).catch((error) => {
        event.ports[0]?.postMessage({ success: false, error: error.message });
      })
    );
  }
});