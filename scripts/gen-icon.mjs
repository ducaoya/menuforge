// 生成 1024x1024 应用图标源图（无第三方依赖）
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const S = 1024;
const px = Buffer.alloc(S * S * 4);
const R = 210; // 圆角半径

const set = (x, y, r, g, b, a = 255) => {
  const i = (y * S + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
};

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (!inRoundRect(x, y, 0, 0, S - 1, S - 1, R)) {
      set(x, y, 0, 0, 0, 0);
      continue;
    }
    const t = (x / S) * 0.45 + (y / S) * 0.55;
    const r = lerp(112, 46, t);
    const g = lerp(157, 68, t);
    const b = lerp(255, 176, t);
    set(x, y, r, g, b);
  }
}

// 三条“菜单”横线
const bars = [
  [300, 380, 700, 452, 34],
  [300, 560, 620, 632, 34],
  [300, 740, 560, 812, 34],
];
for (const [x0, y0, x1, y1, r] of bars) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (inRoundRect(x, y, x0, y0, x1, y1, r)) set(x, y, 255, 255, 255, 255);
    }
  }
}

// 小圆点（呼应“每一项”）
for (const cy of [416, 596, 776]) {
  for (let y = cy - 26; y <= cy + 26; y++) {
    for (let x = 218 - 26; x <= 218 + 26; x++) {
      if ((x - 218) ** 2 + (y - cy) ** 2 <= 26 * 26) set(x, y, 255, 255, 255, 255);
    }
  }
}

// PNG 编码
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("src-tauri", { recursive: true });
writeFileSync("src-tauri/icon-source.png", png);
console.log(`icon-source.png written: ${(png.length / 1024).toFixed(1)} KB`);
