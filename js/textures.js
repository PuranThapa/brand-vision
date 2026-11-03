/*
 * BrandVision · textures.js
 * Fabric textures generated in the browser (no image files needed):
 *   - knit normal map with hem / cuff folds and stitch dents
 *   - grain overlay for the colour canvas
 *   - rib normal map for the collar
 *   - colour canvas per panel: tee colour + printed logo + stitches
 */
(function () {
  'use strict';
  const BV = (window.BV = window.BV || {});
  const { clamp, smooth, noise2 } = BV.math;
  const SIZE = 2048;
  const STITCH = 0.0056; // stitch pitch in world units
  BV.TEX_SIZE = SIZE;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h || w;
    return c;
  }

  // world (x, y) of a panel → canvas pixel
  function toPx(x, y, side) {
    const U = BV.UV_SIZE;
    let u = (x + U / 2) / U;
    if (side < 0) u = 1 - u;
    return [u * SIZE, (1 - (y + U / 2) / U) * SIZE];
  }
  BV.toPx = toPx;

  /* ---------- knit + construction normal map (shared by both panels) ---------- */
  BV.makeFabricNormal = function (spec) {
    const W = SIZE;
    const h = new Float32Array(W * W);
    const U = BV.UV_SIZE;
    const cw = 6, ch = 7; // knit loop size in pixels
    const H = spec.H, C1 = spec.C1, dir = spec.dir, perp = spec.perp;
    for (let py = 0; py < W; py++) {
      const y = (1 - (py + 0.5) / W) * U - U / 2;
      const row = Math.floor(py / ch);
      const fy = (py % ch) + 0.5 - ch / 2;
      for (let px = 0; px < W; px++) {
        const x = ((px + 0.5) / W) * U - U / 2;
        // jersey knit: columns of little V loops
        const col = Math.floor(px / cw);
        const fx = (px % cw) + 0.5 - cw / 2;
        const leg = fx < 0 ? -1 : 1;
        const lx = fx - leg * 1.5, ly = fy;
        const c = Math.cos(0.42 * leg), s = Math.sin(0.42 * leg);
        const rx = lx * c - ly * s, ry = lx * s + ly * c;
        let k = 1 - (rx * rx) / 2.1 - (ry * ry) / 11;
        k = k > 0 ? Math.sqrt(k) : 0;
        k *= 0.85 + 0.3 * (((col * 7 + row * 13) % 5) / 5);
        let v = k * 0.3;
        // slub yarn unevenness
        v += noise2(px * 0.03, py * 0.045) * 0.08;
        // hem: double fold and two rows of stitches
        const ax = Math.abs(x);
        const yh = H[1] - 0.004 * (1 - (x / H[0]) * (x / H[0]));
        const dh = y - yh;
        if (dh > -0.01 && dh < 0.04 && ax < H[0] + 0.01) {
          v += 0.9 * smooth(0.031, 0.026, dh);
          const dash = (ax / STITCH) % 1 < 0.62 ? 1 : 0;
          v -= 0.9 * dash * (Math.exp(-((dh - 0.016) * (dh - 0.016)) / 2.2e-6) + Math.exp(-((dh - 0.022) * (dh - 0.022)) / 2.2e-6));
        }
        // cuffs (mirrored for the left sleeve)
        if (ax > 0.2 && y > 0.1 && y < 0.3) {
          const qx = ax - C1[0], qy = y - C1[1];
          const t = -(qx * dir[0] + qy * dir[1]); // distance toward the shoulder
          const q = qx * perp[0] + qy * perp[1]; // along the cuff
          if (t > -0.01 && t < 0.04 && q > -0.01 && q < 0.1) {
            v += 0.9 * smooth(0.031, 0.026, t);
            const dash = ((q + 1) / STITCH) % 1 < 0.62 ? 1 : 0;
            v -= 0.9 * dash * (Math.exp(-((t - 0.016) * (t - 0.016)) / 2.2e-6) + Math.exp(-((t - 0.022) * (t - 0.022)) / 2.2e-6));
          }
        }
        h[py * W + px] = v;
      }
    }
    const c = canvas(W);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, W);
    const d = img.data;
    const str = 1.6;
    for (let py = 0; py < W; py++) {
      const yu = py > 0 ? py - 1 : py, yd = py < W - 1 ? py + 1 : py;
      for (let px = 0; px < W; px++) {
        const xl = px > 0 ? px - 1 : px, xr = px < W - 1 ? px + 1 : px;
        let nx = -(h[py * W + xr] - h[py * W + xl]) * str;
        let ny = (h[yd * W + px] - h[yu * W + px]) * str;
        const l = Math.hypot(nx, ny, 1);
        const o = (py * W + px) * 4;
        d[o] = ((nx / l) * 0.5 + 0.5) * 255;
        d[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
        d[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };

  /* ---------- grain overlay (tileable) ---------- */
  BV.makeGrain = function () {
    const W = 512;
    const c = canvas(W);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, W);
    const d = img.data;
    for (let y = 0; y < W; y++) {
      const rowTone = 0;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const v = clamp(128 + (Math.random() - 0.5) * 26 + rowTone, 0, 255);
        d[o] = d[o + 1] = d[o + 2] = v;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };

  /* ---------- collar rib ---------- */
  BV.makeRibNormal = function () {
    const W = 32;
    const c = canvas(W, 8);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, 8);
    for (let x = 0; x < W; x++) {
      const nx = -Math.cos((x / W) * Math.PI * 2) * 0.75;
      const l = Math.hypot(nx, 1);
      for (let y = 0; y < 8; y++) {
        const o = (y * W + x) * 4;
        img.data[o] = ((nx / l) * 0.5 + 0.5) * 255;
        img.data[o + 1] = 128;
        img.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };

  /* ---------- colour helpers ---------- */
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  function threadColor(hex) {
    const [r, g, b] = hexToRgb(hex);
    const f = luminance(hex) > 0.55 ? 0.82 : 1.22;
    const m = (v) => Math.round(clamp(v * f + (f > 1 ? 10 : 0), 0, 255));
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  }
  BV.luminance = luminance;

  /* ---------- panel colour canvas ---------- */
  // o = { color, logo (canvas), place: {cx, cy, w} | null, spec, grain (canvas) }
  BV.paintPanel = function (cv, side, o) {
    const ctx = cv.getContext('2d');
    const sp = o.spec;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = o.color;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // printed logo
    let box = null;
    if (o.logo && o.place) {
      const [px, py] = toPx(o.place.cx, o.place.cy, side);
      const wpx = (o.place.w / BV.UV_SIZE) * SIZE;
      const hpx = (wpx * o.logo.height) / o.logo.width;
      ctx.globalAlpha = 0.97;
      ctx.drawImage(o.logo, px - wpx / 2, py - hpx / 2, wpx, hpx);
      ctx.globalAlpha = 1;
      box = [px - wpx / 2, py - hpx / 2, wpx, hpx];
    }

    // fabric grain over everything, so the print sits in the cloth
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = ctx.createPattern(o.grain, 'repeat');
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // polo placket: two raised edges, stitching and a box at the bottom
    if (sp.placket && side > 0) {
      const pk = sp.placket;
      const P = (x, y) => toPx(x, y, side);
      const [lx, ty] = P(-pk.half, pk.top + 0.01), [rx, by] = P(pk.half, pk.bottom);
      ctx.lineCap = 'butt';
      // overlap edge shadow on the right, highlights on the left of each edge
      for (const ex of [-pk.half, pk.half]) {
        const [x0] = P(ex, 0);
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(x0 + 3, ty); ctx.lineTo(x0 + 3, by); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x0 - 2, ty); ctx.lineTo(x0 - 2, by); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.14)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(lx, by); ctx.lineTo(rx, by); ctx.stroke();
      // placket stitching
      ctx.strokeStyle = threadColor(o.color);
      ctx.lineWidth = 2.2;
      ctx.setLineDash([STITCH * 0.62 / BV.UV_SIZE * SIZE, STITCH * 0.38 / BV.UV_SIZE * SIZE]);
      const inset = (0.004 / BV.UV_SIZE) * SIZE;
      ctx.strokeRect(lx + inset, ty, rx - lx - inset * 2, by - ty - inset);
      // closed part: the overlap line from the open V down to the bottom
      const [cx0, oy] = P(0, pk.open);
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx0 + 2, oy); ctx.lineTo(cx0 + 2, by - inset); ctx.stroke();
      // open part: the flap edges cast a soft shadow and carry a row of stitches
      for (const sg of [-1, 1]) {
        const a = P(sg * pk.w0, pk.top), b = P(0, pk.open);
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        const off = (0.005 / BV.UV_SIZE) * SIZE * sg;
        ctx.strokeStyle = threadColor(o.color);
        ctx.lineWidth = 2.2;
        ctx.setLineDash([STITCH * 0.62 / BV.UV_SIZE * SIZE, STITCH * 0.38 / BV.UV_SIZE * SIZE]);
        ctx.beginPath(); ctx.moveTo(a[0] + off, a[1]); ctx.lineTo(b[0] + off * 0.4, b[1] - off * sg * 0.6); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // soft contact shadow where the fold down collar lies on the fabric
    if (o.shadowLines && o.shadowLines.length) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const [wpx, a] of [[30, 0.05], [16, 0.07], [7, 0.1]]) {
        ctx.strokeStyle = `rgba(0,0,0,${a})`;
        ctx.lineWidth = wpx;
        ctx.beginPath();
        for (const line of o.shadowLines) {
          line.forEach((pt, i) => {
            const [px, py] = toPx(pt[0], pt[1], side);
            if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          });
        }
        ctx.stroke();
      }
    }

    // stitches
    ctx.strokeStyle = threadColor(o.color);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    const dashLen = STITCH * 0.62;
    const seg = (a, b) => {
      const p = toPx(a[0], a[1], side), q = toPx(b[0], b[1], side);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    };
    ctx.beginPath();
    // hem: two rows
    const H = sp.H;
    for (const off of [0.016, 0.022]) {
      for (let s = 0; s < H[0] - 0.004; s += STITCH) {
        for (const sg of [1, -1]) {
          const x0 = s * sg, x1 = (s + dashLen) * sg;
          const yy = (x) => H[1] - 0.004 * (1 - (x / H[0]) * (x / H[0])) + off;
          seg([x0, yy(x0)], [x1, yy(x1)]);
        }
      }
    }
    // cuffs: two rows
    const C1 = sp.C1, dir = sp.dir, perp = sp.perp;
    for (const off of [0.016, 0.022]) {
      // start on a dash boundary so colour stitches line up with the normal map dents
      for (let qq = Math.ceil(1.003 / STITCH) * STITCH - 1; qq < 0.085; qq += STITCH) {
        const base = (qv) => [C1[0] - dir[0] * off + perp[0] * qv, C1[1] - dir[1] * off + perp[1] * qv];
        for (const sg of [1, -1]) {
          const a = base(qq), b = base(qq + dashLen);
          seg([a[0] * sg, a[1]], [b[0] * sg, b[1]]);
        }
      }
    }
    // neckline: two rows just below the rib
    const neck = side > 0 ? sp.frontNeck : sp.backNeck;
    for (const off of [0.0045, 0.009]) {
      let acc = 0, on = true;
      for (let i = 0; i < neck.length - 1; i++) {
        const a = neck[i], b = neck[i + 1];
        const tx = b[0] - a[0], ty = b[1] - a[1];
        const L = Math.hypot(tx, ty);
        const nx = ty / L, ny = -tx / L; // into the panel
        const steps = Math.max(1, Math.ceil(L / 0.0015));
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps;
          const p0 = [a[0] + tx * t0 + nx * off, a[1] + ty * t0 + ny * off];
          const p1 = [a[0] + tx * t1 + nx * off, a[1] + ty * t1 + ny * off];
          if (on) seg(p0, p1);
          acc += L / steps;
          const lim = on ? dashLen : STITCH - dashLen;
          if (acc >= lim) { acc = 0; on = !on; }
        }
      }
    }
    ctx.stroke();

    // edit frame: drawn into the fabric so it bends with the cloth
    if (o.selected && box) {
      const pad = (0.006 / BV.UV_SIZE) * SIZE;
      const [x, y, w, h] = [box[0] - pad, box[1] - pad, box[2] + pad * 2, box[3] + pad * 2];
      const accent = '#2B6BE8';
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 9;
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      ctx.setLineDash([22, 12]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      const hs = (0.011 / BV.UV_SIZE) * SIZE;
      for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 5;
        ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
      }
      // move cross in the middle
      const mx = x + w / 2, my = y + h / 2, ms = hs * 0.9;
      ctx.fillStyle = 'rgba(43,107,232,0.9)';
      ctx.beginPath();
      ctx.arc(mx, my, ms, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(mx - ms * 0.55, my); ctx.lineTo(mx + ms * 0.55, my);
      ctx.moveTo(mx, my - ms * 0.55); ctx.lineTo(mx, my + ms * 0.55);
      ctx.stroke();
    }
  };

  /* ---------- sample logo (so the preview is never empty) ---------- */
  BV.makeSampleLogo = function () {
    const c = canvas(640, 640);
    const ctx = c.getContext('2d');
    const cx = 320, cy = 320;
    ctx.strokeStyle = '#1c2b3a';
    ctx.fillStyle = '#1c2b3a';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, 290, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, 258, 0, Math.PI * 2);
    ctx.stroke();
    // bird
    ctx.fillStyle = '#d0582b';
    ctx.beginPath();
    ctx.moveTo(170, 300);
    ctx.quadraticCurveTo(260, 200, 330, 250);
    ctx.quadraticCurveTo(400, 170, 480, 190);
    ctx.quadraticCurveTo(410, 230, 380, 300);
    ctx.quadraticCurveTo(330, 350, 250, 330);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1c2b3a';
    ctx.textAlign = 'center';
    ctx.font = '700 84px Manrope, sans-serif';
    ctx.fillText('KESTREL', cx, 430);
    ctx.font = '600 36px Manrope, sans-serif';
    ctx.fillText('COFFEE ROASTERS', cx, 482);
    return c;
  };
})();
