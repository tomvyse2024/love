importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBD2lnyijjD4HJsJ1B1j1bvjGRDN0pnP_k",
  authDomain: "tom-fix-everything.firebaseapp.com",
  projectId: "tom-fix-everything",
  storageBucket: "tom-fix-everything.firebasestorage.app",
  messagingSenderId: "1062380316397",
  appId: "1:1062380316397:web:4e6b159e8deadcc1570ee4",
  measurementId: "G-F4TNPMK340"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || "♡ TOM & LOVE";
  const options = {
    body: payload.notification?.body || "Your person is calling.",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: "tom-love-incoming-call",
    requireInteraction: true,
    data: { url: "/love/" }
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL("/love/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({type:"window", includeUncontrolled:true});
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
