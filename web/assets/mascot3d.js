/* Linh vật 3D của GD Toolkit — "GD Bot": robot đất sét mờ, đầu là màn hình phát sáng viền cầu vồng, tai nghe có vòng
   LED, ăng-ten là ống nghiệm nhỏ (chủ đề game sort), ngực có ">_" (logo Toolkit), 6 khối màu bay theo một vòng quỹ đạo.
   Dựng hoàn toàn bằng code với three.js (vendor/, chạy offline) — không có file model, không dùng nhân vật của web khác.
   Tối ưu: không dùng shadow map (bóng đổ là 1 tấm mờ), vật liệu Standard, khối bay vẽ 1 lần (InstancedMesh), mặt màn
   hình chỉ vẽ lại khi đổi, giới hạn 60 khung/giây, tự hạ độ phân giải nếu máy chậm, dừng hẳn khi khuất màn hình.
   mount(el, {still, palette, color}) → {mood(m), color(i), destroy()}  — mascot.js gọi, lỗi thì giữ bản SVG.
   palette: [{clay, joint}] — 5 màu thân do mascot.js khai báo (dùng chung cho nút chọn màu). */
import * as THREE from "./vendor/three.module.min.js";

const RAINBOW = ["#38BDF8", "#818CF8", "#E879F9", "#FB7185", "#FBBF24", "#34D399"];
const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

// góc máy (phương vị, độ cao — radian): máy quay tự chuyển qua lại giữa các góc này
const SHOTS = [[0.5, 0.26], [-0.45, 0.22], [0.08, 0.1], [0.8, 0.36], [-0.2, 0.4]];
const TARGET_Y = 1.5, DIST = 9.3;

// hộp bo tròn mượt: hình cầu tách làm 8 phần rồi đẩy ra 2 phía → góc tròn đều, mặt phẳng, pháp tuyến chuẩn.
// số đoạn ngang lẻ + số đoạn dọc lẻ để không có đỉnh nằm đúng mặt phẳng cắt.
// Đường nối của hình cầu có 2 hàng đỉnh trùng nhau: 1 hàng z = 0, hàng kia z ≈ -1e-16 (sai số sin 2π) — phải coi cả 2
// là 0, nếu không hàng sau bị đẩy sang nửa kia và để hở 1 dải trên mặt hộp (lỗ trên đầu robot).
const side = (v) => (v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0);
function rbox(w, h, d, r, seg = 21) {
  const g = new THREE.SphereGeometry(r, seg, seg - 4), p = g.attributes.position;
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x + side(x) * ix, y + side(y) * iy, z + side(z) * iz);
  }
  g.computeBoundingSphere();
  return g;
}
function rrect(p, w, h, r) {
  const x = w / 2, y = h / 2;
  p.moveTo(-x + r, -y); p.lineTo(x - r, -y); p.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x, y - r); p.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  p.lineTo(-x + r, y); p.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(-x, -y + r); p.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}
function planarUV(g) {
  g.computeBoundingBox();
  const b = g.boundingBox, p = g.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) uv.push((p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
function rainbowRing(g, k = 1.6) {
  const p = g.attributes.position, cols = [], c = new THREE.Color(), c2 = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const a = (Math.atan2(p.getY(i), p.getX(i)) / TAU + 0.5) * RAINBOW.length;
    const i0 = Math.floor(a) % RAINBOW.length;
    c.set(RAINBOW[i0]).lerp(c2.set(RAINBOW[(i0 + 1) % RAINBOW.length]), a - Math.floor(a)).multiplyScalar(k); cols.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  return g;
}
function canvasTex(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { c, x: c.getContext("2d"), t };
}
function glowTexture(inner, outer) {
  const { x, t } = canvasTex(64, 64), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(0.45, outer); g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return t;
}

// phòng studio ảo cho phản chiếu (tạo 1 lần lúc dựng)
function studio(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: 0x0d0c12, side: THREE.BackSide })));
  const panel = (w, h, color, k, pos) => {
    const m = new THREE.MeshBasicMaterial({ color }); m.color.multiplyScalar(k);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(...pos); p.lookAt(0, 0, 0); env.add(p);
  };
  panel(6, 3, "#ffffff", 5, [0, 5.5, 1.5]);
  panel(3, 5, "#ffffff", 2.2, [-5.5, 1, 3]);
  panel(2, 5, "#A78BFA", 2.4, [5.5, 0.5, -1]);
  panel(4, 1.2, "#38BDF8", 1.6, [0, 0.5, -5.5]);
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(env, 0.04).texture;
  pm.dispose(); env.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return tex;
}

export function mount(el, opts = {}) {
  const still = !!opts.still;
  const canvas = document.createElement("canvas");
  canvas.className = "ms-3d";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.environment = studio(renderer);
  scene.environmentIntensity = 0.6;
  const camera = new THREE.PerspectiveCamera(25, 1, 0.1, 60);

  // 3 đèn: trời / đất, đèn chính trên-trái, đèn tím viền sau lưng
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1c1a26, 0.7));
  const key = new THREE.DirectionalLight(0xfff6ec, 2.3); key.position.set(-3.2, 6.5, 4.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xC084FC, 2.4); rim.position.set(2.5, 3.5, -4.5); scene.add(rim);

  const M = {
    clay: new THREE.MeshStandardMaterial({ color: "#C3BDB5", roughness: 0.5 }),
    joint: new THREE.MeshStandardMaterial({ color: "#2B2A31", roughness: 0.4, metalness: 0.3 }),
  };
  const palette = opts.palette && opts.palette.length ? opts.palette : [{ clay: "#F2C94C", joint: "#3B2F14" }];
  const pal0 = palette[opts.color] || palette[0];
  M.clay.color.set(pal0.clay); M.joint.color.set(pal0.joint);
  M.led = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const add = (parent, g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); parent.add(o); return o; };

  // ---------- robot (mặt đất y = 0) ----------
  const stage = new THREE.Group(); scene.add(stage);           // kéo chuột để xoay
  const bot = new THREE.Group(); stage.add(bot);                // nhảy / xoay vòng
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({
    map: glowTexture("rgba(0,0,0,0.7)", "rgba(0,0,0,0.28)"), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002; stage.add(shadow);

  // chân: giày + đế + ống chân; hông
  const bootG = rbox(0.36, 0.24, 0.48, 0.11, 17), soleG = rbox(0.38, 0.05, 0.5, 0.024, 13), legG = new THREE.CylinderGeometry(0.085, 0.095, 0.34, 16);
  [-1, 1].forEach((s) => {
    add(bot, bootG, M.clay, s * 0.21, 0.13, 0.04);
    add(bot, soleG, M.joint, s * 0.21, 0.025, 0.04);
    add(bot, legG, M.joint, s * 0.21, 0.4, 0);
  });
  add(bot, rbox(0.72, 0.22, 0.52, 0.1, 17), M.joint, 0, 0.6, 0);

  // thân trên
  const torso = new THREE.Group(); torso.position.y = 0.66; bot.add(torso);
  const chest = add(torso, rbox(0.94, 0.82, 0.68, 0.27), M.clay, 0, 0.41, 0);
  // huy hiệu ngực ">_": chữ vẽ 1 lần, con trỏ "_" là tấm riêng chỉ bật / tắt (không vẽ lại canvas)
  const badge = canvasTex(256, 128);
  {
    const x = badge.x; x.fillStyle = "#07070c"; x.fillRect(0, 0, 256, 128);
    x.font = "bold 76px Consolas, ui-monospace, monospace"; x.textBaseline = "middle";
    x.shadowColor = "rgba(165,148,255,0.9)"; x.shadowBlur = 14; x.fillStyle = "#EFEFE5"; x.fillText(">", 62, 66);
  }
  add(torso, planarUV(new THREE.ShapeGeometry(rrect(new THREE.Shape(), 0.38, 0.19, 0.06), 5)),
    new THREE.MeshBasicMaterial({ map: badge.t, toneMapped: false }), 0, 0.42, 0.342);
  const cur = canvasTex(64, 8), cg = cur.x.createLinearGradient(0, 0, 64, 0);
  cg.addColorStop(0, "#38BDF8"); cg.addColorStop(0.5, "#E879F9"); cg.addColorStop(1, "#FBBF24"); cur.x.fillStyle = cg; cur.x.fillRect(0, 0, 64, 8);
  const cursor = add(torso, new THREE.PlaneGeometry(0.116, 0.019), new THREE.MeshBasicMaterial({ map: cur.t, toneMapped: false }), 0.043, 0.42 - 0.042, 0.344);
  add(torso, new THREE.CylinderGeometry(0.12, 0.14, 0.16, 16), M.joint, 0, 0.86, 0);

  // tay: vai → cánh tay → khuỷu → cẳng tay → găng (dùng chung hình khối cho 2 tay)
  const shG = new THREE.SphereGeometry(0.125, 16, 12), upG = new THREE.CapsuleGeometry(0.08, 0.2, 4, 14);   // bắp tay: kim loại, đầy đặn hơn
  const elG = new THREE.SphereGeometry(0.078, 14, 10), foreG = new THREE.CapsuleGeometry(0.108, 0.14, 6, 16);   // cẳng tay: khối tròn màu thân
  // bàn tay robot mềm 5 ngón: lòng bàn tay xám mờ + 4 ngón xếp hàng + ngón cái, mỗi ngón 2 đốt, co nhẹ tự nhiên
  // (lòng bàn tay quay vào thân; vui / nhảy thì duỗi xoè ra). Cánh tay vẫn là thanh kim loại + vòng cổ tay.
  const metal = new THREE.MeshStandardMaterial({ color: "#C3C7D0", metalness: 0.85, roughness: 0.28, envMapIntensity: 1.4 });
  const soft = new THREE.MeshStandardMaterial({ color: "#56555F", roughness: 0.6, metalness: 0.05 });
  const cuffG = new THREE.CylinderGeometry(0.095, 0.085, 0.085, 24);
  const palmG = rbox(0.075, 0.12, 0.15, 0.034, 13);
  const seg1G = new THREE.CapsuleGeometry(0.023, 0.05, 4, 10), seg2G = new THREE.CapsuleGeometry(0.021, 0.036, 4, 10);
  const knuckleG = new THREE.SphereGeometry(0.024, 10, 8);
  // 4 ngón: vị trí theo bề ngang lòng bàn tay (trục z) + độ dài tương đối (giữa dài nhất)
  const FINGERS = [[0.05, 0.92], [0.017, 1.0], [-0.017, 0.96], [-0.05, 0.82]];
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.56, 0.66, 0); torso.add(sh);
    add(sh, shG, M.joint); add(sh, upG, metal, 0, -0.2, 0);
    const elb = new THREE.Group(); elb.position.y = -0.39; sh.add(elb);
    add(elb, elG, M.joint); add(elb, foreG, M.clay, 0, -0.17, 0);
    const hand = new THREE.Group(); hand.position.y = -0.33; hand.scale.setScalar(1.25); elb.add(hand);
    add(hand, cuffG, M.joint, 0, 0.0, 0);
    add(hand, palmG, soft, 0, -0.095, 0);
    const finger = (x, y, z, len, thumb) => {
      const f = new THREE.Group(); f.position.set(x, y, z); hand.add(f);            // khớp gốc ngón
      add(f, knuckleG, soft);
      add(f, seg1G, soft, 0, -0.045 * len, 0).scale.set(1, len, 1);
      const mid = new THREE.Group(); mid.position.y = -0.088 * len; f.add(mid);    // khớp giữa
      add(mid, knuckleG, soft).scale.setScalar(0.9);
      add(mid, seg2G, soft, 0, -0.034 * len, 0).scale.set(1, len, 1);
      f.userData = { mid, thumb, s };
      return f;
    };
    const fingers = FINGERS.map(([z, len]) => finger(0, -0.158, z, len, false));
    // ngón cái: mọc ở mép trước của lòng bàn tay, chĩa xuống - ra trước, ngắn hơn
    const th = finger(-s * 0.022, -0.11, 0.075, 0.78, true);
    th.rotation.x = -0.75;
    fingers.push(th);
    return { s, sh, el: elb, fingers };
  });

  // đầu (nhỏ hơn bản trước để cân với thân): hộp bo tròn + màn hình + viền cầu vồng + tai nghe + ăng-ten ống nghiệm
  const head = new THREE.Group(); head.position.y = 0.9; torso.add(head);
  const HW = 1.26, HH = 1.0, HD = 0.98, HY = 0.52, SW = 0.92, SH = 0.64;
  add(head, rbox(HW, HH, HD, 0.2, 25), M.clay, 0, HY, 0);
  // nền màn hình: lưới LED vẽ 1 lần, không bao giờ vẽ lại
  const face = canvasTex(320, 224);
  {
    const x = face.x, bg = x.createRadialGradient(160, 112, 20, 160, 112, 210);
    bg.addColorStop(0, "#0d0c18"); bg.addColorStop(1, "#040408"); x.fillStyle = bg; x.fillRect(0, 0, 320, 224);
    x.fillStyle = "rgba(165,148,255,0.08)";
    for (let yy = 6; yy < 224; yy += 10) for (let xx = 6; xx < 320; xx += 10) x.fillRect(xx, yy, 2, 2);
  }
  const screenG = planarUV(new THREE.ShapeGeometry(rrect(new THREE.Shape(), SW, SH, 0.16), 8));
  add(head, screenG, new THREE.MeshBasicMaterial({ map: face.t, toneMapped: false }), 0, HY, HD / 2 + 0.004);
  // mắt / miệng / dấu "…": mỗi hình là 1 tấm phẳng có sẵn ảnh phát sáng → mỗi khung chỉ dời / co giãn, không vẽ lại canvas
  const PX = SW / 320;                                              // 1 px trên mặt 320 × 224 = PX đơn vị 3D
  const faceG = new THREE.Group(); faceG.position.set(0, HY, HD / 2 + 0.008); head.add(faceG);
  const glowShape = (w, h, draw) => {
    const { x, t } = canvasTex(w, h);
    x.shadowColor = "rgba(140,220,255,0.95)"; x.shadowBlur = 18; x.fillStyle = x.strokeStyle = "#EAFBFF"; x.lineCap = "round";
    draw(x); return { t, w, h };
  };
  const plate = (s) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w * PX, s.h * PX),
      new THREE.MeshBasicMaterial({ map: s.t, transparent: true, depthWrite: false, toneMapped: false }));
    m.renderOrder = 2; faceG.add(m); return m;
  };
  const pillS = glowShape(72, 104, (x) => { x.beginPath(); x.roundRect(21, 23, 30, 58, 15); x.fill(); });
  const arcS = glowShape(96, 72, (x) => { x.lineWidth = 14; x.beginPath(); x.arc(48, 50, 22, Math.PI * 1.12, Math.PI * 1.88); x.stroke(); });
  const smileS = glowShape(84, 56, (x) => { x.lineWidth = 8; x.beginPath(); x.arc(42, 14, 18, Math.PI * 0.15, Math.PI * 0.85); x.stroke(); });
  const dotS = glowShape(32, 32, (x) => { x.beginPath(); x.arc(16, 16, 6, 0, TAU); x.fill(); });
  const eyes = [plate(pillS), plate(pillS)], arcs = [plate(arcS), plate(arcS)], smile = plate(smileS);
  const dots = [0, 1, 2].map(() => plate(dotS));
  const heartPath = (x, cx, cy, r) => {
    x.beginPath(); x.moveTo(cx, cy + r);
    x.bezierCurveTo(cx - r * 1.6, cy - r * 0.2, cx - r * 0.9, cy - r * 1.3, cx, cy - r * 0.5);
    x.bezierCurveTo(cx + r * 0.9, cy - r * 1.3, cx + r * 1.6, cy - r * 0.2, cx, cy + r); x.fill();
  };
  const heartS = glowShape(88, 88, (x) => { x.shadowColor = "rgba(255,120,170,0.95)"; x.fillStyle = "#FF9EC0"; heartPath(x, 44, 46, 21); });
  const hearts = [plate(heartS), plate(heartS)];
  // tim nhỏ bay lên khỏi đầu khi nhảy cute
  const floaty = [0, 1, 2].map((i) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartS.t, transparent: true, depthWrite: false, toneMapped: false }));
    sp.visible = false; sp.userData.i = i; head.add(sp); return sp;
  });
  const place = (m, px, py) => m.position.set((px - 160) * PX, -(py - 112) * PX, 0);
  const glass = add(head, screenG, new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0, HY, HD / 2 + 0.01);
  glass.renderOrder = 3;
  const bezelShape = rrect(new THREE.Shape(), SW + 0.12, SH + 0.12, 0.21); bezelShape.holes.push(rrect(new THREE.Path(), SW, SH, 0.16));
  const rb = canvasTex(128, 128), rg = rb.x.createLinearGradient(0, 128, 128, 0);
  RAINBOW.forEach((c, i) => rg.addColorStop(i / (RAINBOW.length - 1), c)); rb.x.fillStyle = rg; rb.x.fillRect(0, 0, 128, 128);
  add(head, planarUV(new THREE.ExtrudeGeometry(bezelShape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 8 })),
    new THREE.MeshStandardMaterial({ map: rb.t, emissive: 0xffffff, emissiveMap: rb.t, emissiveIntensity: 0.8, roughness: 0.3 }), 0, HY, HD / 2 - 0.018);
  const cupG = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 24), padG = new THREE.CylinderGeometry(0.15, 0.17, 0.05, 24);
  const ringG = rainbowRing(new THREE.TorusGeometry(0.19, 0.016, 8, 48));
  [-1, 1].forEach((s) => {
    add(head, cupG, M.joint, s * (HW / 2 + 0.05), HY, 0).rotation.z = Math.PI / 2;
    add(head, padG, M.clay, s * (HW / 2 + 0.13), HY, 0).rotation.z = Math.PI / 2;
    add(head, ringG, M.led, s * (HW / 2 + 0.115), HY, 0).rotation.y = Math.PI / 2;
  });
  // ăng-ten: ống nghiệm nhỏ chứa 3 lớp nước, lắc lư như lò xo
  const ant = new THREE.Group(); ant.position.set(0.26, HY + HH / 2 - 0.02, -0.06); head.add(ant);
  add(ant, new THREE.CylinderGeometry(0.09, 0.11, 0.07, 16), M.joint, 0, 0.025, 0);
  const tube = new THREE.Group(); tube.position.y = 0.06; ant.add(tube);
  const tp = [];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); tp.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * 0.075), 0.075 + Math.sin(a) * 0.075)); }
  tp.push(new THREE.Vector2(0.075, 0.37), new THREE.Vector2(0.09, 0.39), new THREE.Vector2(0.075, 0.4));
  const tubeGlass = add(tube, new THREE.LatheGeometry(tp, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true,
    opacity: 0.22, envMapIntensity: 2, depthWrite: false, side: THREE.DoubleSide }));
  tubeGlass.renderOrder = 2;
  const liq = (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.3 });
  const green = liq("#34D399"), layerG = new THREE.CylinderGeometry(0.064, 0.064, 0.08, 14);
  add(tube, new THREE.SphereGeometry(0.064, 14, 8, 0, TAU, Math.PI / 2, Math.PI / 2), green, 0, 0.075, 0);
  add(tube, layerG, green, 0, 0.115, 0);
  add(tube, layerG, liq("#FBBF24"), 0, 0.2, 0);
  add(tube, layerG, liq("#E879F9"), 0, 0.285, 0);
  const tubeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(232,121,249,0.8)", "rgba(129,140,248,0.25)"),
    blending: THREE.AdditiveBlending, depthWrite: false }));
  tubeGlow.scale.setScalar(0.5); tubeGlow.position.y = 0.22; tube.add(tubeGlow);

  // 6 khối màu bay vòng quanh chân robot (thay cho bục) — thấp hơn tay, xa hơn giày nên không xuyên qua người / che mặt,
  // vẽ 1 lần (instanced)
  const N = RAINBOW.length, ORBIT_R = 1.3;
  const cubes = new THREE.InstancedMesh(rbox(1, 1, 1, 0.24, 9), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, emissive: 0x333333 }), N);
  RAINBOW.forEach((c, i) => cubes.setColorAt(i, new THREE.Color(c)));
  const orbit = new THREE.Group(); orbit.position.y = 0.26; orbit.rotation.set(0.06, 0, -0.05); orbit.add(cubes); scene.add(orbit);
  const dummy = new THREE.Object3D();

  // ---------- mặt màn hình: chỉ dời / co giãn các tấm (rẻ, mượt) ----------
  function updateFace(st) {
    const cx = 160 + st.ex * 34, cy = 106 + st.ey * 20;
    const happy = st.mood === "happy", sad = st.mood === "sad", think = st.mood === "think", cute = st.mood === "cute";
    hearts.forEach((e, i) => {
      e.visible = cute;
      if (cute) { place(e, cx + (i ? 50 : -50), cy + 2); e.scale.setScalar(1 + Math.sin(st.t * 9 + i) * 0.12); }
    });
    eyes.forEach((e, i) => {
      const s = i ? 1 : -1;
      e.visible = !happy && !cute; place(e, cx + s * 50, cy + (sad ? 8 : 0));
      e.scale.set(sad ? 0.93 : 1, (sad ? 0.55 : 1) * st.open, 1); e.rotation.z = sad ? s * 0.38 : 0;
    });
    arcs.forEach((e, i) => { e.visible = happy; place(e, cx + (i ? 50 : -50), cy); });
    smile.visible = happy || sad || cute;
    if (happy || cute) { place(smile, cx, cy + 44); smile.rotation.z = 0; smile.scale.setScalar(1); }
    else if (sad) { place(smile, cx, cy + 58); smile.rotation.z = Math.PI; smile.scale.setScalar(0.85); }
    dots.forEach((d, i) => {
      d.visible = think;
      if (think) { place(d, 138 + i * 22, 188); d.material.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(st.t * 6 - i * 0.9)); }
    });
  }
  // ---------- trạng thái & điều khiển ----------
  let W = 0, H = 0, dpr = Math.min(1.5, window.devicePixelRatio || 1), alive = true, visible = true, raf = 0, last = 0, t = 0;
  let lookX = 0, lookY = 0, lx = 0, ly = 0, rectTop = 0;
  let dragYaw = 0, dragVel = 0, dragging = false, moved = 0, px = 0;
  let spin = 0, spinTo = 0, jump = -1, shake = -1, cute = -1, pop = -1, mood = "", blinkAt = 1.4, blink = 0;
  // đổi màu: chuyển mượt trong ~0,45 giây
  const colFrom = { clay: new THREE.Color(), joint: new THREE.Color() }, colTo = { clay: new THREE.Color(), joint: new THREE.Color() };
  let colT = 1;
  let shot = 0, shotFrom = SHOTS[0], shotT = 1, shotNext = 6, antV = 0, antA = 0, prevHeadYaw = 0;
  let slowFrames = 0, sampled = 0;
  const pose = { yaw: 0, pitch: 0, roll: 0 };

  // vị trí khung trên màn hình: chỉ đo khi cuộn / đổi cỡ (không đo trong vòng vẽ → không ép trình duyệt tính lại bố cục)
  let rect = { left: 0, top: 0, width: 1, height: 1 };
  const measure = () => { rect = el.getBoundingClientRect(); rectTop = rect.top; return rect; };
  const resize = (force) => {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h || (!force && w === W && h === H)) return;
    W = w; H = h; renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix(); measure(); if (still) frame(0);
  };
  const onMove = (e) => {
    const rc = rect;
    lookX = clamp((e.clientX - (rc.left + rc.width / 2)) / Math.max(360, rc.width * 1.6), -1, 1);
    lookY = clamp((e.clientY - (rc.top + rc.height * 0.3)) / Math.max(360, rc.height * 1.6), -1, 1);
    if (dragging) { const dx = e.clientX - px; px = e.clientX; moved += Math.abs(dx); dragVel = dx * 0.012; dragYaw += dragVel; }
  };
  const onScroll = () => { measure(); };
  const onDown = (e) => { dragging = true; moved = 0; px = e.clientX; try { el.setPointerCapture(e.pointerId); } catch (_) { /* bỏ qua */ } };
  const onUp = () => { dragging = false; };
  const onClickCapture = (e) => { if (moved > 6) { e.stopImmediatePropagation(); e.preventDefault(); } };
  function curShot() { const k = ease(shotT), to = SHOTS[shot]; return [lerp(shotFrom[0], to[0], k), lerp(shotFrom[1], to[1], k)]; }

  function frame(dt) {
    t += dt;
    if (!still) {
      shotNext -= dt;
      if (shotNext <= 0) { shotFrom = curShot(); shot = (shot + 1) % SHOTS.length; shotT = 0; shotNext = 7 + Math.random() * 3; }
      shotT = Math.min(1, shotT + dt / 2.8);
    }
    // máy quay: góc kịch bản + thị sai chuột + cuộn trang (càng cuộn càng nhìn từ trên xuống)
    const s = curShot(), vh = window.innerHeight || 800, scrollK = clamp(-rectTop / vh, -0.5, 1.2);
    lx = damp(lx, lookX, 5, dt); ly = damp(ly, lookY, 5, dt);
    const az = s[0] - lx * 0.16 + scrollK * 0.5, elv = clamp(s[1] + ly * 0.08 + scrollK * 0.4, -0.05, 0.9);
    camera.position.set(Math.sin(az) * Math.cos(elv) * DIST, TARGET_Y + Math.sin(elv) * DIST, Math.cos(az) * Math.cos(elv) * DIST);
    camera.lookAt(0, TARGET_Y, 0);

    // xoay bằng kéo chuột (quán tính, tự về), xoay một vòng + nhảy khi vui
    if (!dragging) { dragVel *= Math.pow(0.04, dt); dragYaw += dragVel; dragYaw = damp(dragYaw, Math.round(dragYaw / TAU) * TAU, 1.2, dt); }
    spin = damp(spin, spinTo, 3, dt);
    stage.rotation.y = dragYaw + Math.sin(t * 0.35) * 0.08;
    bot.rotation.y = spin;
    let lift = 0; bot.scale.set(1, 1, 1);
    if (jump >= 0) {
      jump += dt; const k = jump / 0.8;
      if (k < 1) { lift = Math.sin(k * Math.PI) * 0.34; bot.scale.set(1 - lift * 0.08, 1 + lift * 0.14, 1 - lift * 0.08); }
      else if (k < 1.3) { const q = Math.sin(((k - 1) / 0.3) * Math.PI); bot.scale.set(1 + q * 0.05, 1 - q * 0.06, 1 + q * 0.05); }
      if (k >= 2.2) jump = mood === "happy" ? 0 : -1;
    }
    // nhảy cute: 2 nhịp nhún + lắc người qua lại (nhịp 1,25 Hz)
    let sway = 0, ph = 0;
    if (cute >= 0) {
      cute += dt; ph = cute * Math.PI * 2.5;
      const fade = Math.max(0, 1 - Math.max(0, cute - 1.35) * 4);
      lift = Math.max(lift, Math.abs(Math.sin(ph)) * 0.17 * fade);
      sway = Math.sin(ph) * 0.12 * fade;
      const g = (1 - Math.abs(Math.sin(ph))) * fade;
      bot.scale.set(1 + g * 0.045, 1 - g * 0.06, 1 + g * 0.045);
      if (cute >= 1.6) cute = mood === "cute" ? 0 : -1;
    }
    bot.rotation.z = damp(bot.rotation.z, sway, 14, dt);
    if (pop >= 0) {               // nảy nhẹ khi đổi màu
      pop += dt; const q = Math.sin(Math.min(1, pop / 0.4) * Math.PI) * 0.07;
      bot.scale.set(bot.scale.x * (1 + q), bot.scale.y * (1 - q * 0.8), bot.scale.z * (1 + q));
      if (pop >= 0.4) pop = -1;
    }
    if (colT < 1) {
      colT = Math.min(1, colT + dt / 0.45); const k = ease(colT);
      M.clay.color.copy(colFrom.clay).lerp(colTo.clay, k); M.joint.color.copy(colFrom.joint).lerp(colTo.joint, k);
    }
    bot.position.y = lift;
    const sk = 1 - lift * 0.9; shadow.scale.set(sk, sk, 1); shadow.material.opacity = 1 - lift * 1.5;

    // nhìn về phía người xem (máy quay) + theo chuột
    const fy = az - stage.rotation.y - spin, wrapped = Math.atan2(Math.sin(fy), Math.cos(fy));
    let hy = clamp(wrapped * 0.55 + lx * 0.6, -0.85, 0.85), hp = -elv * 0.35 + ly * 0.32, hr = 0;
    if (mood === "think") { hr = 0.2; hp -= 0.18; hy += 0.15; }
    if (mood === "sad") hp += 0.3;
    if (mood === "cute") { hr = -sway * 2.4; hp -= 0.06; }
    if (shake >= 0) { shake += dt; hy += Math.sin(shake * 22) * 0.35 * Math.max(0, 1 - shake); if (shake > 1) shake = -1; }
    pose.yaw = damp(pose.yaw, hy, 7, dt); pose.pitch = damp(pose.pitch, hp, 6, dt); pose.roll = damp(pose.roll, hr, 5, dt);
    head.rotation.set(pose.pitch, pose.yaw, pose.roll, "YXZ");
    torso.rotation.y = damp(torso.rotation.y, clamp(wrapped * 0.2 + lx * 0.15, -0.35, 0.35), 4, dt);
    torso.rotation.x = damp(torso.rotation.x, mood === "sad" ? 0.08 : 0, 5, dt);
    const breath = still ? 0 : Math.sin(t * 2.1);
    chest.scale.set(1 + breath * 0.008, 1, 1 + breath * 0.008);

    // tay: buông tự nhiên, thỉnh thoảng vẫy; vui giơ hai tay; nghĩ thì giơ tay lên
    arms.forEach((a) => {
      const waveOn = a.s === 1 && !mood && (t % 9.5) > 7.6;
      let z = a.s * (0.14 + Math.sin(t * 1.4 + a.s) * 0.03), x = Math.sin(t * 1.1 + a.s) * 0.05, ez = 0, ex = -0.12;
      if (mood === "cute") {        // hai tay gập lên, bàn tay chụm cạnh má, lắc so le
        const w = Math.sin(ph + (a.s > 0 ? 0 : Math.PI));
        z = a.s * (2.15 - Math.abs(w) * 0.12); x = 0.8; ez = a.s * (1.55 + w * 0.22); ex = 0;
      } else if (mood === "happy") { z = a.s * (2.25 + Math.sin(t * 12 + a.s) * 0.12); ez = a.s * 0.25; }
      else if (mood === "sad") { z = a.s * 0.05; x = 0.15; }
      else if (mood === "think" && a.s === 1) { z = 0.35; x = -1.2; ex = -1.8; }
      else if (waveOn) { z = 2.3; ez = 0.2 + Math.sin(t * 11) * 0.4; }
      a.sh.rotation.z = damp(a.sh.rotation.z, z, 8, dt); a.sh.rotation.x = damp(a.sh.rotation.x, x, 8, dt);
      a.el.rotation.z = damp(a.el.rotation.z, ez, 10, dt); a.el.rotation.x = damp(a.el.rotation.x, ex, 8, dt);
      // ngón tay: co nhẹ khi thả lỏng (cử động chậm, so le từng ngón), duỗi xoè khi vui / nhảy
      const relaxed = !(mood === "happy" || mood === "cute");
      a.fingers.forEach((f, i) => {
        const curl = relaxed ? 0.42 + Math.sin(t * 1.3 + i * 0.7 + a.s) * 0.06 : 0.06;
        f.rotation.z = damp(f.rotation.z, -a.s * curl, 9, dt);                      // gập vào phía lòng bàn tay
        f.userData.mid.rotation.z = damp(f.userData.mid.rotation.z, -a.s * curl * 1.35, 9, dt);
      });
    });
    floaty.forEach((sp) => {
      const i = sp.userData.i, k = cute >= 0 && mood === "cute" ? ((cute / 1.6 + i / 3) % 1) : -1;
      sp.visible = k >= 0;
      if (k < 0) return;
      sp.position.set((i - 1) * 0.42 + Math.sin(k * 6 + i) * 0.08, HY + HH / 2 + 0.15 + k * 0.9, 0.2);
      sp.scale.setScalar(0.16 + k * 0.1); sp.material.opacity = Math.sin(k * Math.PI);
    });

    // ăng-ten ống nghiệm: lò xo trễ theo cử động đầu / nhảy
    const hv = (pose.yaw - prevHeadYaw) / Math.max(dt, 1e-3); prevHeadYaw = pose.yaw;
    const f = -antA * 70 - antV * 5 - hv * 1.4 + (jump >= 0 && jump < 0.8 ? Math.cos(jump * 8) * 5 : 0);
    antV += f * dt; antA = clamp(antA + antV * dt, -0.6, 0.6);
    tube.rotation.z = antA + 0.12; tube.rotation.x = Math.sin(t * 1.3) * 0.05;
    tubeGlow.material.opacity = mood === "think" ? 0.5 + 0.5 * Math.sin(t * 10) : 0.75 + 0.2 * Math.sin(t * 2.2);

    // màn hình + huy hiệu ngực
    blinkAt -= dt; if (blinkAt <= 0 && !still) { blink = 0.16; blinkAt = 2.4 + Math.random() * 3.4; }
    blink = Math.max(0, blink - dt);
    const open = blink > 0 ? Math.max(0.08, Math.abs(blink - 0.08) / 0.08) : 1;
    updateFace({ mood, open, t, ex: mood === "think" ? 0.55 : clamp(lx * 0.6, -0.8, 0.8), ey: mood === "think" ? -0.7 : clamp(ly * 0.5, -0.6, 0.6) });
    cursor.visible = still || (t % 1.1) < 0.6;

    // khối bay: quay đều trên quỹ đạo, tự xoay, nhấp nhô nhẹ
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + t * 0.32, sc = 0.085 + (i % 3) * 0.02;
      dummy.position.set(Math.cos(a) * ORBIT_R, Math.sin(t * 1.2 + i * 1.7) * 0.06 + (i % 2) * 0.12, Math.sin(a) * ORBIT_R);
      dummy.rotation.set(t * 0.6 + i, t * 0.8 + i * 0.5, 0); dummy.scale.setScalar(sc); dummy.updateMatrix();
      cubes.setMatrixAt(i, dummy.matrix);
    }
    cubes.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  }

  // vòng lặp: màn 60 Hz vẽ đủ mọi khung (ngưỡng bỏ khung có dư 4 ms, tránh rớt khung vì lệch nhịp vài phần ms);
  // màn 120 / 144 Hz giới hạn ~60–72 khung. dt làm mượt nhẹ để chuyển động không giật theo nhịp khung không đều.
  // Máy chậm (khung > 12 ms hoặc tụt dưới 30 fps liên tục) thì hạ độ phân giải.
  let sdt = 1 / 60;
  const loop = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) { last = now; return; }
    const gap = now - last;
    if (gap < 1000 / 60 - 4) return;
    last = now;
    sdt = lerp(sdt, Math.min(0.05, gap / 1000), 0.3);
    const t0 = performance.now(); frame(sdt);
    if (sampled < 240) {
      sampled++;
      if (performance.now() - t0 > 12 || gap > 34) slowFrames++;
      if (slowFrames > 40 && dpr > 1) { dpr = 1; slowFrames = 0; resize(true); }
    }
  };

  el.appendChild(canvas);
  const ro = new ResizeObserver(() => resize()); ro.observe(canvas);
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) measure(); }); io.observe(el);
  resize();
  if (still) frame(0);
  else {
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true }); window.addEventListener("resize", onScroll);
    el.addEventListener("pointerdown", onDown); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
    el.addEventListener("click", onClickCapture, true);
    raf = requestAnimationFrame((n) => { last = n - 16; loop(n); });
  }

  return {
    mood(m) {
      if ((m || "") === mood) return;
      mood = m || "";
      if (mood === "happy") { jump = 0; spinTo += TAU; }
      if (mood === "cute") cute = 0;
      if (mood === "sad") shake = 0;
      if (still) frame(0);
    },
    color(i) {
      const p = palette[i];
      if (!p) return;
      colFrom.clay.copy(M.clay.color); colFrom.joint.copy(M.joint.color);
      colTo.clay.set(p.clay); colTo.joint.set(p.joint);
      if (still) { M.clay.color.copy(colTo.clay); M.joint.color.copy(colTo.joint); frame(0); return; }
      colT = 0; pop = 0;
    },
    destroy() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll);
      window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerdown", onDown); el.removeEventListener("click", onClickCapture, true);
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        [].concat(o.material || []).forEach((m) => { if (seen.has(m)) return; seen.add(m); if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); });
      });
      if (scene.environment) scene.environment.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
