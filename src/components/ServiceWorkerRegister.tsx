"use client";
import { useEffect } from "react";

// P14 — register the service worker in production only (dev has none, to avoid
// SW caching interfering with HMR). Enables installability / the Android TWA.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
