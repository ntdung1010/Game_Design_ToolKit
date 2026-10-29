// đặt theme trước khi vẽ để không nháy màu (file riêng vì CSP không cho script inline)
try { const t = localStorage.getItem("gdk.theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* bỏ qua */ }
