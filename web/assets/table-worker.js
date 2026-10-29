/* Đọc + parse file bảng (CSV / TSV / TXT) trong Web Worker → trang không bị đơ với file lớn.
   Tự nhận bảng mã: UTF-8 (có/không BOM), UTF-16 (Excel “Unicode Text”), Windows-1258 (CSV do Excel
   tiếng Việt lưu). Gửi tiến độ đọc về cho trang. */
importScripts("../lib/table.js");
const T = self.GDK.lib.table;

async function readText(file, encoding, onProgress) {
  if (!file.stream) return new TextDecoder(encoding).decode(await file.arrayBuffer());
  const reader = file.stream().getReader();
  const dec = new TextDecoder(encoding);
  const parts = [];
  let loaded = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    parts.push(dec.decode(value, { stream: true }));
    const now = Date.now();
    if (now - last > 120) { last = now; onProgress(loaded); }
  }
  parts.push(dec.decode());
  onProgress(loaded);
  return parts.join("");
}

self.onmessage = async (e) => {
  const { id, file } = e.data;
  const post = (m) => self.postMessage(Object.assign({ id }, m));
  try {
    const t0 = Date.now();
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    let encoding = "utf-8";
    if (head[0] === 0xff && head[1] === 0xfe) encoding = "utf-16le";
    else if (head[0] === 0xfe && head[1] === 0xff) encoding = "utf-16be";
    let text = await readText(file, encoding, (loaded) => post({ type: "progress", loaded, total: file.size }));
    let note = "";
    if (encoding === "utf-8" && text.indexOf("\uFFFD") !== -1) {
      // CSV do Excel tiếng Việt lưu thường là Windows-1258, không phải UTF-8 → đọc lại cho đúng dấu
      text = new TextDecoder("windows-1258").decode(await file.arrayBuffer());
      encoding = "windows-1258";
      note = "File không phải UTF-8 — đã đọc theo bảng mã Windows-1258 cho đúng dấu. Lần sau nên lưu dạng “CSV UTF-8”.";
    }
    post({ type: "progress", phase: "parse", loaded: file.size, total: file.size });
    const matrix = T.parseCSV(text);
    post({ type: "done", matrix, note, encoding, ms: Date.now() - t0 });
  } catch (err) {
    post({ type: "error", message: String((err && err.message) || err) });
  }
};
