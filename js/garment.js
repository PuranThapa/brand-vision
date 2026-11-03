/*
 * BrandVision · garment.js
 * Builds a tee procedurally, the way a real one is sewn:
 *   1. a flat front pattern piece and a flat back pattern piece (2D outline)
 *   2. both pieces are "inflated" and meet at the seams (shoulder, sleeve, side)
 *   3. open edges (neck, cuffs, hem) stay open like real fabric
 *   4. a ribbed collar band is attached around the neckline
 * Every 3D position is a pure function of its flat (x, y) position, so the two
 * panels always stay stitched together, even while the cloth is waving.
 */
(function () {
  'use strict';
  const BV = (window.BV = window.BV || {});
  const PI = Math.PI;

  /* ---------- small math helpers ---------- */
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  function hash(x, y) {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return h - Math.floor(h);
  }
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  }
  function fbm(x, y) {
    return noise2(x, y) * 0.6 + noise2(x * 2.07 + 5.2, y * 2.07 + 1.3) * 0.3 + noise2(x * 4.3 + 9.1, y * 4.3 + 3.7) * 0.1;
  }
  BV.math = { clamp, lerp, smooth, noise2 };

  /* ---------- outline sampling ---------- */
  function line(a, b, step) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.ceil(L / step));
    const o = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      o.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    }
    return o;
  }
  function quad(a, c, b, step) {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1]);
    const n = Math.max(2, Math.ceil(L / step));
    const o = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = 1 - t;
      o.push([s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]]);
    }
    return o;
  }
  const mirror = (pts) => pts.map((p) => [-p[0], p[1]]).reverse();

  /* ---------- pattern definition ---------- */
  function makeSpec(type, opts) {
    const vneck = type === 'vneck';
    const polo = vneck && !!(opts && opts.collar); // V neck with collar becomes a polo front
    const fitted = !!(opts && opts.fitted); // slim women's cut
    const cropped = !!(opts && opts.cropped); // short body, ends near the waist
    const nw = (vneck && !polo ? 0.086 : polo ? 0.08 : 0.078) + (fitted && !polo ? 0.006 : 0); // half width of the neck opening
    const ny = 0.372; // top of shoulder at the neck
    const NR = [nw, ny];
    const S = fitted ? [0.19, 0.338] : [0.207, 0.336]; // shoulder point
    const ang = ((fitted ? -56 : -52) * PI) / 180; // sleeve angle
    const dir = [Math.cos(ang), Math.sin(ang)];
    const perp = [dir[1], -dir[0]]; // points down and inward
    const sleeveLen = fitted ? 0.118 : 0.165, cuffW = fitted ? 0.074 : 0.088;
    const C1 = [S[0] + dir[0] * sleeveLen, S[1] + dir[1] * sleeveLen]; // cuff top
    const C2 = [C1[0] + perp[0] * cuffW, C1[1] + perp[1] * cuffW]; // cuff bottom
    const A = fitted ? [0.18, 0.19] : [0.198, 0.178]; // armpit
    const H = [fitted ? (cropped ? 0.172 : 0.19) : 0.216, cropped ? -0.2 : -0.372]; // hem corner
    const W = [fitted ? 0.166 : (A[0] + H[0]) / 2 - 0.006, cropped ? -0.06 : -0.1]; // waist point on the side seam
    const bodyW = fitted ? 0.18 : 0.215;
    const st = 0.005;

    function neck(depth, v) {
      const pts = [];
      const n = 64;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (v) {
          const x = -nw + 2 * nw * t;
          const s = Math.abs(x) / nw;
          // straight V with a tiny curve near the shoulder
          const y = ny - depth * (1 - s) - 0.006 * Math.sin(s * PI) * (1 - s);
          pts.push([x, y]);
        } else {
          const th = (t - 0.5) * PI;
          pts.push([nw * Math.sin(th), ny - depth * Math.pow(Math.cos(th), 1.15)]);
        }
      }
      return pts;
    }

    const out = [-dir[1], dir[0]];
    const shoulderR = line(NR, S, st);
    const sleeveTopR = quad(S, [(S[0] + C1[0]) / 2 + out[0] * 0.011, (S[1] + C1[1]) / 2 + out[1] * 0.011], C1, st);
    const cuffR = line(C1, C2, st);
    const underR = quad(C2, [(C2[0] + A[0]) / 2 - 0.002, (C2[1] + A[1]) / 2 - 0.004], A, st);
    // side seam through the waist point, with smooth (cosine) easing so the waist reads as a curve
    const sideR = [];
    {
      const seg = (a, b, n) => {
        for (let i = 0; i < n; i++) {
          const t = i / n, k = (1 - Math.cos(t * PI)) / 2;
          sideR.push([lerp(a[0], b[0], k), lerp(a[1], b[1], t)]);
        }
      };
      seg(A, W, Math.ceil((A[1] - W[1]) / st));
      seg(W, H, Math.ceil((W[1] - H[1]) / st));
      sideR.push(H);
    }
    const hem = [];
    {
      const n = Math.ceil((2 * H[0]) / st);
      for (let i = 0; i <= n; i++) {
        const x = H[0] - (2 * H[0] * i) / n;
        hem.push([x, H[1] - 0.004 * (1 - (x / H[0]) * (x / H[0]))]);
      }
    }

    function assemble(neckPts) {
      const edges = [
        { pts: neckPts, seam: false, tag: 'neck' },
        { pts: shoulderR, seam: true, tag: 'shoulder' },
        { pts: sleeveTopR, seam: true },
        { pts: cuffR, seam: false, tag: 'cuff' },
        { pts: underR, seam: true },
        { pts: sideR, seam: true },
        { pts: hem, seam: false, tag: 'hem' },
        { pts: mirror(sideR), seam: true },
        { pts: mirror(underR), seam: true },
        { pts: mirror(cuffR), seam: false, tag: 'cuff' },
        { pts: mirror(sleeveTopR), seam: true },
        { pts: mirror(shoulderR), seam: true, tag: 'shoulder' },
      ];
      const poly = [];
      const seam = [], open = [], neckS = [], shoulder = [];
      for (const e of edges) {
        for (let i = 0; i < e.pts.length - 1; i++) {
          poly.push(e.pts[i]);
          const seg = [e.pts[i][0], e.pts[i][1], e.pts[i + 1][0], e.pts[i + 1][1]];
          (e.seam ? seam : open).push(...seg);
          if (e.tag === 'neck') neckS.push(...seg);
          if (e.tag === 'shoulder') shoulder.push(...seg);
        }
      }
      const all = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        all.push(a[0], a[1], b[0], b[1]);
      }
      return {
        poly,
        segAll: new Float64Array(all),
        segSeam: new Float64Array(seam),
        segOpen: new Float64Array(open),
        segNeck: new Float64Array(neckS),
        segShoulder: new Float64Array(shoulder),
      };
    }

    // polo: round neck with the top of the placket left open (a small V down to the 2nd button)
    function poloNeck(depth, w0, openY) {
      const round = neck(depth, false);
      const left = round.filter((p) => p[0] <= -w0);
      const right = round.filter((p) => p[0] >= w0);
      const a = left[left.length - 1], b = right[0];
      const tip = [0, openY];
      const l1 = line(a, tip, 0.004), l2 = line(tip, b, 0.004);
      return [...left, ...l1.slice(1), ...l2.slice(1, -1), ...right];
    }
    const PK = { w0: 0.021, open: 0.252 };
    const frontNeck = polo ? poloNeck(0.066, PK.w0, PK.open) : vneck ? neck(0.162, true) : neck(0.084, false);
    const backNeck = neck(0.024, false);
    return {
      type, vneck, polo, fitted, cropped, bodyW, W, nw, ny, S, A, C1, C2, H, dir, perp,
      placket: polo
        ? { top: ny - 0.066, open: PK.open, w0: PK.w0, bottom: 0.17, half: 0.017, buttons: [[0, 0.214], [-0.0135, 0.274]] }
        : null,
      frontNeck, backNeck, hem,
      front: assemble(frontNeck),
      back: assemble(backNeck),
    };
  }

  /* ---------- geometry helpers ---------- */
  function segDist(px, py, s) {
    let best = 1e9;
    for (let i = 0; i < s.length; i += 4) {
      const ax = s[i], ay = s[i + 1], bx = s[i + 2], by = s[i + 3];
      const ex = bx - ax, ey = by - ay;
      const L = ex * ex + ey * ey;
      let t = L > 0 ? ((px - ax) * ex + (py - ay) * ey) / L : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ax + ex * t - px, dy = ay + ey * t - py;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  function segClosest(px, py, s) {
    let best = 1e9, bx0 = px, by0 = py;
    for (let i = 0; i < s.length; i += 4) {
      const ax = s[i], ay = s[i + 1], ex = s[i + 2] - ax, ey = s[i + 3] - ay;
      const L = ex * ex + ey * ey;
      let t = L > 0 ? ((px - ax) * ex + (py - ay) * ey) / L : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + ex * t, cy = ay + ey * t;
      const d = (cx - px) * (cx - px) + (cy - py) * (cy - py);
      if (d < best) { best = d; bx0 = cx; by0 = cy; }
    }
    return [bx0, by0];
  }
  function inside(px, py, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  // Regular grid inside the outline; edge vertices are snapped onto the outline
  function triangulate(piece, g) {
    const poly = piece.poly;
    let maxX = 0, minY = 1e9, maxY = -1e9;
    for (const p of poly) {
      maxX = Math.max(maxX, Math.abs(p[0]));
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const half = Math.ceil(maxX / g) + 1;
    const nx = half * 2 + 1;
    const y0 = minY - g;
    const ny = Math.ceil((maxY - minY) / g) + 3;
    const ins = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) ins[j * nx + i] = inside((i - half) * g, y0 + j * g, poly) ? 1 : 0;

    const id = new Int32Array(nx * ny).fill(-1);
    const verts = [];
    const vid = (i, j) => {
      const k = j * nx + i;
      if (id[k] < 0) {
        let px = (i - half) * g, py = y0 + j * g;
        if (!ins[k]) [px, py] = segClosest(px, py, piece.segAll);
        id[k] = verts.length / 2;
        verts.push(px, py);
      }
      return id[k];
    };
    const tris = [];
    const addTri = (a, b, c) => {
      if (!(ins[a[1] * nx + a[0]] || ins[b[1] * nx + b[0]] || ins[c[1] * nx + c[0]])) return;
      tris.push(vid(a[0], a[1]), vid(b[0], b[1]), vid(c[0], c[1]));
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const A = [i, j], B = [i + 1, j], C = [i + 1, j + 1], D = [i, j + 1];
        if (i < half) { addTri(A, B, C); addTri(A, C, D); }
        else { addTri(A, B, D); addTri(B, C, D); }
      }
    }
    // drop slivers that snapping folded over
    const idx = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 2, b = tris[t + 1] * 2, c = tris[t + 2] * 2;
      const area = (verts[b] - verts[a]) * (verts[c + 1] - verts[a + 1]) - (verts[c] - verts[a]) * (verts[b + 1] - verts[a + 1]);
      if (area > 1e-9) idx.push(tris[t], tris[t + 1], tris[t + 2]);
    }
    return { verts, idx };
  }

  /* ---------- shape functions ---------- */
  function sleeveness(x, y, sp) {
    const ax = Math.abs(x);
    const S = sp.S, A = sp.A, C2 = sp.C2;
    let ex = A[0] - S[0], ey = A[1] - S[1];
    let L = Math.hypot(ex, ey);
    const sd = ((ax - S[0]) * -ey + (y - S[1]) * ex) / L;
    let ux = C2[0] - A[0], uy = C2[1] - A[1];
    L = Math.hypot(ux, uy);
    const sa = ((ax - A[0]) * -uy + (y - A[1]) * ux) / L;
    return smooth(-0.004, 0.026, sd) * smooth(-0.012, 0.006, sa);
  }

  // Depth (distance from the middle plane) of a point of a panel
  function depth(x, y, dSeam, sl, side, sp) {
    const fit = sp.fitted;
    const R = fit ? 0.075 : 0.085;
    const t = Math.min(dSeam / R, 1);
    const prof = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
    const bx = clamp(Math.abs(x) / sp.bodyW, 0, 1);
    const round = (1 - bx * bx) * smooth(0, 0.07, dSeam);
    let z = (side > 0 ? (fit ? 0.094 : 0.104) : fit ? 0.088 : 0.096) * prof;
    z += (side > 0 ? 0.026 : 0.018) * round;
    if (side > 0 && (fit || sp.cropped)) {
      // women's bust shaping (fitted and cropped cuts), fuller D cup volume:
      // two rounded forms, fabric bridging across the centre (no dip),
      // a gentle slope above and a softer drape below
      const ax = Math.abs(x), apexX = 0.074, apexY = 0.118;
      const gx = ax < apexX ? 0.82 + 0.18 * smooth(0, apexX, ax) : Math.exp(-((ax - apexX) * (ax - apexX)) / (2 * 0.05 * 0.05));
      const dy = y - apexY;
      const gy = Math.exp(-(dy * dy) / (2 * (dy > 0 ? 0.07 : 0.085) ** 2));
      z += 0.064 * gx * gy * smooth(0, 0.05, dSeam);
    } else if (side > 0) z += 0.011 * Math.exp(-((y - 0.15) * (y - 0.15)) / 0.012) * round; // chest
    else z += 0.007 * Math.exp(-((y - 0.2) * (y - 0.2)) / 0.01) * round; // shoulder blades
    if (fit) z *= 1 - 0.16 * Math.exp(-((y - sp.W[1]) * (y - sp.W[1])) / 0.008); // waist
    return z * lerp(1, 0.5, sl);
  }

  // Static wrinkles: soft drape, hem ripples and armpit folds
  function folds(x, y, sl, side, sp) {
    const s = side > 0 ? 0 : 17.3;
    let f = fbm(x * 6.5 + s, y * 6.5 - s) * 0.0042 + noise2(x * 21 + s, y * 21) * 0.0011;
    // hem ripples
    f += 0.0055 * smooth(sp.H[1] + 0.17, sp.H[1], y) * Math.sin(Math.abs(x) * 31 + fbm(x * 3 + s, y * 3) * 2.6 + side);
    // diagonal drape lines from both armpits
    const ax = Math.abs(x), A = sp.A;
    const dx = ax - A[0], dy = y - A[1];
    const d = Math.hypot(dx, dy);
    const a = Math.atan2(dy, -dx);
    f -= 0.0042 * Math.exp(-d / 0.075) * (0.5 + 0.5 * Math.sin(a * 8 + 1.1 + s)) * (1 - sl);
    // soft bunching across the sleeve near the armhole
    f += 0.0025 * sl * Math.sin((ax - sp.S[0]) * 70 + y * 40 + s);
    return f;
  }

  function hemFlare(x, y, sl, sp) {
    return x * (1 + (sp.fitted ? 0.02 : 0.035) * smooth(sp.H[1] + 0.32, sp.H[1], y) * (1 - sl));
  }

  /* ---------- builders ---------- */
  const UV_SIZE = 0.8; // world units covered by the panel texture
  BV.UV_SIZE = UV_SIZE;

  function buildPanel(sp, side) {
    const piece = side > 0 ? sp.front : sp.back;
    const tri = triangulate(piece, 0.0068);
    const n = tri.verts.length / 2;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const cOut = new Float32Array(n * 3), cIn = new Float32Array(n * 3);
    const hang = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = tri.verts[i * 2], y = tri.verts[i * 2 + 1];
      const dS = segDist(x, y, piece.segSeam);
      const dO = segDist(x, y, piece.segOpen);
      const dN = segDist(x, y, piece.segNeck);
      const sl = sleeveness(x, y, sp);
      let z = depth(x, y, dS, sl, side, sp);
      z += folds(x, y, sl, side, sp) * smooth(0, 0.035, dS) * smooth(0, 0.035, dN);
      pos[i * 3] = hemFlare(x, y, sl, sp);
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = side * z;
      let u = (x + UV_SIZE / 2) / UV_SIZE;
      if (side < 0) u = 1 - u;
      uv[i * 2] = u;
      uv[i * 2 + 1] = (y + UV_SIZE / 2) / UV_SIZE;
      // baked occlusion
      const dA = Math.hypot(Math.abs(x) - sp.A[0], y - sp.A[1]);
      let ao = 1 - 0.32 * Math.exp(-dA / 0.03) - 0.16 * Math.exp(-dN / 0.012);
      cOut[i * 3] = cOut[i * 3 + 1] = cOut[i * 3 + 2] = ao;
      const ai = 0.22 + 0.78 * Math.exp(-dO / 0.075);
      cIn[i * 3] = cIn[i * 3 + 1] = cIn[i * 3 + 2] = ai;
      hang[i] = clamp(segDist(x, y, piece.segShoulder) / 0.62, 0, 1);
    }
    const idx = tri.idx.slice();
    if (side < 0) for (let t = 0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
    return { pos, uv, idx, cOut, cIn, hang };
  }

  // Ribbed neck band, built from the front and back necklines
  function buildCollar(sp) {
    const zs = [1, 1, 0.97, 0.935, 0.9];
    const pos = [], uv = [], idx = [], hang = [];
    const rows = 5;
    for (const side of [1, -1]) {
      const piece = side > 0 ? sp.front : sp.back;
      const pts = side > 0 ? sp.frontNeck : sp.backNeck;
      const bw = side < 0 ? 0.015 : sp.vneck ? 0.017 : 0.019;
      const offs = [-0.0045, 0, bw * 0.55, bw, bw + 0.0018];
      const base = pos.length / 3;
      let arc = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b[0] - a[0], ty = b[1] - a[1];
        const tl = Math.hypot(tx, ty);
        tx /= tl; ty /= tl;
        let nx = -ty, ny = tx; // into the neck hole
        if (sp.vneck && side > 0 && Math.abs(p[0]) < 1e-6) { nx = 0; ny = 1; }
        let miter = 1;
        if (sp.vneck && side > 0) miter = 1 / Math.max(0.45, Math.abs(ny) > 0.01 ? Math.hypot(nx, ny) : 1);
        if (i > 0) arc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
        const dS = segDist(p[0], p[1], piece.segSeam);
        const z0 = depth(p[0], p[1], dS, 0, side, sp) + 0.0016;
        for (let r = 0; r < rows; r++) {
          const ox = p[0] + nx * offs[r] * miter, oy = p[1] + ny * offs[r] * miter;
          pos.push(ox, oy + (r === rows - 1 ? 0.0006 : 0), side * z0 * zs[r]);
          uv.push(arc / 0.0024, r / (rows - 1));
          hang.push(0);
        }
      }
      for (let i = 0; i < pts.length - 1; i++) {
        for (let r = 0; r < rows - 1; r++) {
          const a = base + i * rows + r, b = base + (i + 1) * rows + r, c = b + 1, d = a + 1;
          if (side > 0) idx.push(a, b, c, a, c, d);
          else idx.push(a, c, b, a, d, c);
        }
      }
    }
    return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx, hang: new Float32Array(hang) };
  }

  // Exact height of the panel surface (incl. wrinkles) at a flat point
  function surfaceZ(sp, side, x, y) {
    const piece = side > 0 ? sp.front : sp.back;
    const dS = segDist(x, y, piece.segSeam);
    const dN = segDist(x, y, piece.segNeck);
    const sl = sleeveness(x, y, sp);
    return depth(x, y, dS, sl, side, sp) + folds(x, y, sl, side, sp) * smooth(0, 0.035, dS) * smooth(0, 0.035, dN);
  }

  // Normal of the panel surface, pointing away from the body
  function surfaceNormal(sp, side, x, y) {
    const h = 0.0025;
    const piece = side > 0 ? sp.front : sp.back;
    const fx = (surfaceZ(sp, side, x + h, y) - surfaceZ(sp, side, x - h, y)) / (2 * h);
    const fy = (surfaceZ(sp, side, x, y + h) - surfaceZ(sp, side, x, y - h)) / (2 * h);
    let n = [-fx, -fy, side];
    let l = Math.hypot(n[0], n[1], n[2]);
    n = [n[0] / l, n[1] / l, n[2] / l];
    // on the shoulder ridge the fabric faces up, across the seam
    const ridge = 1 - smooth(0, 0.025, segDist(x, y, piece.segShoulder));
    if (ridge > 0) {
      const sg = x < 0 ? -1 : 1;
      const dx = (sp.S[0] - sp.nw) * sg, dy = sp.S[1] - sp.ny; // along the seam, outward
      const dl = Math.hypot(dx, dy);
      const up = [-dy / dl, dx / dl, 0]; // perpendicular to the seam
      if (up[1] < 0) { up[0] = -up[0]; up[1] = -up[1]; }
      n = [lerp(n[0], up[0], ridge), lerp(n[1], up[1], ridge), lerp(n[2], 0, ridge)];
      l = Math.hypot(n[0], n[1], n[2]);
      n = [n[0] / l, n[1] / l, n[2] / l];
    }
    return n;
  }
  function surfacePoint(sp, side, x, y) {
    return [x, y, side * surfaceZ(sp, side, x, y)];
  }

  // Polo collar: a stand rises around the neck, rolls over at the top, and the
  // fall arches out and down, touching the shirt only near its outer edge.
  // At the front the two collar points meet above a short button placket.
  function buildPoloCollar(sp) {
    const fn = sp.frontNeck, bn = sp.backNeck;
    const gap = sp.placket.w0 - 1e-4; // collar ends where the open placket starts
    const withNormals = (pts) =>
      pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const tx = b[0] - a[0], ty = b[1] - a[1];
        const l = Math.hypot(tx, ty) || 1;
        return { p, n: [-ty / l, tx / l] };
      });
    // normals from the round part only, so the open V does not skew the collar points
    const bN = withNormals(bn);
    const strip = [
      ...withNormals(fn.filter((p) => p[0] <= -gap)).reverse().map((q) => ({ ...q, side: 1 })),
      ...bN.map((q) => ({ ...q, side: -1 })),
      ...withNormals(fn.filter((p) => p[0] >= gap)).reverse().map((q) => ({ ...q, side: 1 })),
    ];
    let L = 0;
    const arcs = strip.map((q, i) => {
      if (i > 0) L += Math.hypot(q.p[0] - strip[i - 1].p[0], q.p[1] - strip[i - 1].p[1]);
      return L;
    });
    // vertical axis through the middle of the neck opening
    const zf = surfaceZ(sp, 1, 0, fn[(fn.length - 1) / 2][1]);
    const zb = -surfaceZ(sp, -1, 0, bn[(bn.length - 1) / 2][1]);
    const zc = (zf + zb) / 2;

    const rowsT = [0.25, 0.5, 0.75, 1];
    const pos = [], uv = [], hang = [], idx = [];
    const edges = [];
    let run = null, rows = 0;
    const hangAt = (side, x, y) => clamp(segDist(x, y, (side > 0 ? sp.front : sp.back).segShoulder) / 0.62, 0, 1);

    strip.forEach((q, i) => {
      const { p, side } = q;
      const fromEnd = Math.min(arcs[i], L - arcs[i]);
      const e = side > 0 ? 1 - smooth(0, 0.11, fromEnd) : 0; // 1 at the collar points
      const sg = p[0] < 0 ? -1 : 1;
      const B = surfacePoint(sp, side, p[0], p[1]);
      let rx = B[0], rz = B[2] - zc;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;

      const hS = lerp(0.021, 0.019, e); // stand height
      // where the fall lands on the shirt (flat pattern coordinates)
      let ox = -q.n[0], oy = -q.n[1];
      const dN = Math.hypot(Math.abs(p[0]) - sp.nw, p[1] - sp.ny);
      const wN = 1 - smooth(0, 0.04, dN);
      const sdx = (sp.S[0] - sp.nw) * sg, sdy = sp.S[1] - sp.ny, sdl = Math.hypot(sdx, sdy);
      ox = lerp(ox, sdx / sdl, wN); oy = lerp(oy, sdy / sdl, wN);
      const ol = Math.hypot(ox, oy) || 1;
      ox /= ol; oy /= ol;
      const fallW = lerp(0.041, 0.06, Math.pow(e, 1.5));
      const E2 = [p[0] + ox * fallW + sg * 0.005 * e, p[1] + oy * fallW - 0.012 * e * e]; // points spread open
      const Es = surfacePoint(sp, side, E2[0], E2[1]);
      const En = surfaceNormal(sp, side, E2[0], E2[1]);
      const E = [Es[0] + En[0] * 0.0035, Es[1] + En[1] * 0.0035, Es[2] + En[2] * 0.0035];

      const pt = (r, h) => [B[0] + rx * r, B[1] + h, B[2] + rz * r];
      const S0 = pt(0, 0), S1 = pt(-0.0015, hS * 0.5), S2 = pt(-0.003, hS);
      const R1 = pt(0.0012, hS + 0.0038), R2 = pt(0.0065, hS + 0.0022);
      // the fall arcs outward between the roll and the edge
      const C = [
        (R2[0] + E[0]) / 2 + rx * 0.011, (R2[1] + E[1]) / 2 + 0.006, (R2[2] + E[2]) / 2 + rz * 0.011,
      ];
      const bez = (t) => {
        const s = 1 - t;
        return [0, 1, 2].map((k) => s * s * R2[k] + 2 * s * t * C[k] + t * t * E[k]);
      };
      const fall = rowsT.map(bez);
      // rim: thickness at the collar edge, tucked back under
      const back = [R2[0] - E[0], R2[1] - E[1], R2[2] - E[2]];
      const bl = Math.hypot(back[0], back[1], back[2]) || 1;
      const rim = [E[0] + (back[0] / bl) * 0.003 - En[0] * 0.0018, E[1] + (back[1] / bl) * 0.003 - En[1] * 0.0018, E[2] + (back[2] / bl) * 0.003 - En[2] * 0.0018];

      const col = [S0, S1, S2, R1, R2, ...fall, rim];
      rows = col.length;
      const hB = hangAt(side, p[0], p[1]), hE = hangAt(side, E2[0], E2[1]);
      col.forEach((v, k) => {
        pos.push(v[0], v[1], v[2]);
        uv.push(arcs[i] / 0.0024, k / (col.length - 1));
        const t = k < 5 ? 0 : k === col.length - 1 ? 1 : rowsT[k - 5];
        hang.push(lerp(hB, hE, t));
      });
      if (!run || run.side !== side) { run = { side, pts: [] }; edges.push(run); }
      run.pts.push(E2);
    });
    for (let i = 0; i < strip.length - 1; i++) {
      for (let r = 0; r < rows - 1; r++) {
        const a = i * rows + r, b = (i + 1) * rows + r;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
    return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx, hang: new Float32Array(hang), edges };
  }

  function buildButtons(sp) {
    return sp.placket.buttons.map(([x, y]) => {
      const p = surfacePoint(sp, 1, x, y);
      const n = surfaceNormal(sp, 1, x, y);
      return { p, n, hang: clamp(segDist(x, y, sp.front.segShoulder) / 0.62, 0, 1) };
    });
  }

  BV.insidePanel = function (x, y, spec, side) {
    return inside(x, y, (side > 0 ? spec.front : spec.back).poly);
  };

  BV.buildGarment = function (type, opts) {
    const spec = makeSpec(type, opts);
    return {
      spec,
      front: buildPanel(spec, 1),
      back: buildPanel(spec, -1),
      collar: spec.polo ? null : buildCollar(spec),
      foldCollar: spec.polo ? buildPoloCollar(spec) : null,
      buttons: spec.polo ? buildButtons(spec) : [],
    };
  };

  /* ---------- runtime cloth motion ---------- */
  // p: { twist, ripple, flare, swing, breeze, t }
  BV.deform = function (base, hang, out, p) {
    const n = hang.length;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const x = base[k], y = base[k + 1], z = base[k + 2];
      const w = hang[i];
      if (w <= 0) { out[k] = x; out[k + 1] = y; out[k + 2] = z; continue; }
      const ww = w * w;
      const r = Math.hypot(x, z);
      const phi = Math.atan2(z, x);
      const wave =
        p.ripple * ww * Math.sin(phi * 4 + y * 15 - p.t * 7.5) +
        p.breeze * w * (Math.sin(phi * 3 + y * 9 - p.t * 1.7 + Math.sin(p.t * 0.6 + x * 4)) * 0.7 +
          Math.sin(phi * 5 - y * 13 + p.t * 2.3) * 0.3);
      const rr = r * (1 + p.flare * ww) + wave;
      const ang = phi - p.twist * Math.pow(w, 1.4);
      out[k] = rr * Math.cos(ang);
      out[k + 1] = y + p.flare * ww * 0.04;
      out[k + 2] = rr * Math.sin(ang) + p.swing * ww;
    }
  };
})();
