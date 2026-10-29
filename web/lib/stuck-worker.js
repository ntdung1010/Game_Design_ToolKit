/* Level Stuck — chạy bộ giải trong Web Worker để trang không bị đơ. Mỗi tin nhắn = 1 việc:
   {id, type: "level" | "controls", engine, data, name, opts} → {id, ok, out} | {id, ok: false, message}. */
/* global importScripts */
importScripts("stuckkit.js" + (self.location.search || ""));
const SK = self.GDK.lib.stuckkit;
self.onmessage = (e) => {
  const { id, type, engine, data, name, opts } = e.data;
  try {
    const out = type === "controls" ? SK.controls(engine, data, name, opts) : SK.checkLevel(engine, data, name, opts);
    self.postMessage({ id, ok: true, out });
  } catch (err) {
    self.postMessage({ id, ok: false, message: String((err && err.message) || err) });
  }
};
