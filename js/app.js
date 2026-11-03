/*
 * BrandVision · app.js
 * Scene, studio lighting, drag interaction, cloth motion and the control panel.
 * Runs fully offline: open index.html directly in the browser.
 */
(function () {
  'use strict';
  const BV = window.BV;
  const { clamp, lerp } = BV.math;
  const $ = (s) => document.querySelector(s);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- state ---------- */
  const PLACES = {
    front: {
      center: { cx: 0, cy: 0.12, w: 0.17 },
      left: { cx: 0.098, cy: 0.208, w: 0.072 }, // wearer's left = viewer's right
      right: { cx: -0.098, cy: 0.208, w: 0.072 },
    },
    back: {
      upper: { cx: 0, cy: 0.275, w: 0.1 },
      center: { cx: 0, cy: 0.08, w: 0.2 },
    },
  };
  const state = {
    garment: 'crew',
    collar: false, // polo collar, V neck only
    cropped: false, // short body
    fitted: false, // slim women's cut
    color: '#F4F3EF',
    logo: null,
    logoName: '',
    sample: true,
    front: { pos: 'center', size: 1, dy: 0 },
    back: { pos: 'upper', size: 1, dy: 0 },
    breeze: !reduceMotion,
    spin: false,
  };

  /* ---------- WebGL check ---------- */
  const canvasEl = $('#view');
  const testCtx = document.createElement('canvas');
  if (!(testCtx.getContext('webgl2') || testCtx.getContext('webgl'))) {
    $('#skeleton').hidden = true;
    $('#noGL').hidden = false;
    return;
  }

  /* ---------- renderer and scene ---------- */
  THREE.ColorManagement.legacyMode = false;
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.NoToneMapping; // keep brand colours accurate
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  let camDist = 2.05, camDistTarget = 2.05;
  const LOOK_Y = -0.01;

  // soft studio reflections: a room with large softboxes, prefiltered once
  (function studio() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 12), new THREE.MeshBasicMaterial({ color: 0x6f6f6c, side: THREE.BackSide }));
    env.add(room);
    const box = (w, h, x, y, z, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    box(4, 3, -3, 2.5, 4, 5); // key
    box(3, 3, 4.5, 0.5, 2, 2.2); // fill
    box(6, 1.5, 0, 3.9, 0, 3); // top
    box(3, 3, 0, 1, -5, 2.6); // rim
    scene.environment = pmrem.fromScene(env, 0.035).texture;
    pmrem.dispose();
  })();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b3a8, 0.3));
  const key = new THREE.DirectionalLight(0xfffaf3, 0.82);
  key.position.set(-1.1, 1.7, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -0.6; sc.right = 0.6; sc.top = 0.6; sc.bottom = -0.6; sc.near = 0.5; sc.far = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 5;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xf2f5ff, 0.3);
  fill.position.set(1.8, 0.3, 1.4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.55);
  rim.position.set(0.6, 1.3, -2.2);
  scene.add(rim);

  // soft floor shadow
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const floorShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.75, 0.32),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 })
  );
  floorShadow.rotation.x = -Math.PI / 2;
  floorShadow.position.y = -0.56;
  scene.add(floorShadow);

  const tee = new THREE.Group(); // turns with the user's drag
  scene.add(tee);
  const garmentGroup = new THREE.Group(); // the floating tee
  tee.add(garmentGroup);

  /* ---------- textures and materials ---------- */
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const grain = BV.makeGrain();
  const panelCanvas = { front: document.createElement('canvas'), back: document.createElement('canvas') };
  const panelTex = {};
  for (const k of ['front', 'back']) {
    panelCanvas[k].width = panelCanvas[k].height = BV.TEX_SIZE;
    const t = new THREE.CanvasTexture(panelCanvas[k]);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = maxAniso;
    panelTex[k] = t;
  }
  let fabricNormal = null;
  const normalCache = new Map(); // hem and cuff detail depend on the cut
  function applyFabricNormal() {
    const key = `${state.fitted}-${state.cropped}`;
    let tex = normalCache.get(key);
    if (!tex) {
      tex = new THREE.CanvasTexture(BV.makeFabricNormal(garment.spec));
      tex.anisotropy = maxAniso;
      normalCache.set(key, tex);
    }
    if (tex === fabricNormal) return;
    fabricNormal = tex;
    for (const m of [mat.front, mat.back, mat.inner]) {
      m.normalMap = tex;
      m.normalScale = new THREE.Vector2(0.45, 0.45);
      m.needsUpdate = true;
    }
  }

  const ribTex = new THREE.CanvasTexture(BV.makeRibNormal());
  ribTex.wrapS = ribTex.wrapT = THREE.RepeatWrapping;
  ribTex.anisotropy = maxAniso;

  const fabricProps = {
    roughness: 0.94,
    metalness: 0,
    sheen: 0.55,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 0.35,
    vertexColors: true,
  };
  const mat = {
    front: new THREE.MeshPhysicalMaterial(Object.assign({ map: panelTex.front }, fabricProps)),
    back: new THREE.MeshPhysicalMaterial(Object.assign({ map: panelTex.back }, fabricProps)),
    inner: new THREE.MeshStandardMaterial({ side: THREE.BackSide, roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: 0.3 }),
    collar: new THREE.MeshPhysicalMaterial({
      side: THREE.DoubleSide, roughness: 0.92, sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffffff),
      normalMap: ribTex, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.55,
    }),
    button: new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 0.8 }),
  };

  /* ---------- garment meshes ---------- */
  let parts = []; // { geo, base, hang }
  let garment = null;

  function geometry(data, colorAttr) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.pos), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    if (colorAttr) g.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    g.setIndex(data.idx);
    g.computeVertexNormals();
    return g;
  }

  function buildTee(type) {
    for (const c of garmentGroup.children.slice()) {
      garmentGroup.remove(c);
      if (c.userData.ownsGeo) c.geometry.dispose();
    }
    parts = [];
    garment = BV.buildGarment(type, { collar: state.collar, cropped: state.cropped, fitted: state.fitted });
    applyFabricNormal();

    for (const side of ['front', 'back']) {
      const d = garment[side];
      const outerGeo = geometry(d, d.cOut);
      const innerGeo = new THREE.BufferGeometry();
      innerGeo.setAttribute('position', outerGeo.attributes.position);
      innerGeo.setAttribute('normal', outerGeo.attributes.normal);
      innerGeo.setAttribute('uv', outerGeo.attributes.uv);
      innerGeo.setAttribute('color', new THREE.BufferAttribute(d.cIn, 3));
      innerGeo.setIndex(outerGeo.index);

      const outer = new THREE.Mesh(outerGeo, mat[side]);
      outer.castShadow = outer.receiveShadow = true;
      outer.userData.ownsGeo = true;
      const inner = new THREE.Mesh(innerGeo, mat.inner);
      inner.receiveShadow = true;
      inner.userData.ownsGeo = true;
      outer.frustumCulled = inner.frustumCulled = false;
      garmentGroup.add(outer, inner);
      parts.push({ geo: outerGeo, base: d.pos, hang: d.hang });
      outer.userData.panel = side;
      pickables[side] = outer;
    }
    pickables.collar = null;
    if (garment.collar) {
      const cg = geometry(garment.collar, null);
      const collar = new THREE.Mesh(cg, mat.collar);
      collar.castShadow = collar.receiveShadow = true;
      collar.frustumCulled = false;
      collar.userData.ownsGeo = true;
      garmentGroup.add(collar);
      parts.push({ geo: cg, base: garment.collar.pos, hang: garment.collar.hang });
      pickables.collar = collar;
    }
    // placket buttons (polo front)
    for (const b of garment.buttons) {
      const g = new THREE.CylinderGeometry(0.0062, 0.0058, 0.0024, 24, 1);
      g.rotateX(Math.PI / 2);
      g.lookAt(new THREE.Vector3(b.n[0], b.n[1], b.n[2]));
      g.translate(b.p[0] + b.n[0] * 0.0016, b.p[1] + b.n[1] * 0.0016, b.p[2] + b.n[2] * 0.0016);
      const base = new Float32Array(g.attributes.position.array);
      const m = new THREE.Mesh(g, mat.button);
      m.castShadow = true;
      m.frustumCulled = false;
      m.userData.ownsGeo = true;
      garmentGroup.add(m);
      parts.push({ geo: g, base, hang: new Float32Array(base.length / 3).fill(b.hang) });
    }
    pickables.foldCollar = null;
    if (garment.foldCollar) {
      const fg = geometry(garment.foldCollar, null);
      const fc = new THREE.Mesh(fg, mat.collar);
      fc.castShadow = true; // self shadowing on thin folds causes stripes, so it only casts
      fc.receiveShadow = false;
      fc.frustumCulled = false;
      fc.userData.ownsGeo = true;
      garmentGroup.add(fc);
      parts.push({ geo: fg, base: garment.foldCollar.pos, hang: garment.foldCollar.hang });
      pickables.foldCollar = fc;
    }
    // the cloth moves a little, so give ray picking some slack
    for (const p of parts) {
      p.geo.computeBoundingSphere();
      p.geo.boundingSphere.radius *= 1.25;
    }
  }
  const pickables = {};

  /* ---------- painting ---------- */
  function placement(which) {
    const s = state[which];
    if (s.pos === 'none') return null;
    if (s.pos === 'custom') return { cx: s.custom.cx, cy: s.custom.cy + s.dy, w: PLACES[which][s.base].w * s.size };
    const p = PLACES[which][s.pos];
    let cy = p.cy;
    const polo = state.garment === 'vneck' && state.collar;
    if (which === 'front' && s.pos === 'center' && state.garment === 'vneck' && !polo) cy -= 0.035;
    // keep chest logos clear of the polo placket
    if (which === 'front' && s.pos === 'center' && polo) cy -= 0.04;
    // keep the upper back print clear of the fold down collar
    if (which === 'back' && s.pos === 'upper' && polo) cy -= 0.04;
    return { cx: p.cx, cy: cy + s.dy, w: p.w * s.size };
  }
  function paint(which) {
    const list = which ? [which] : ['front', 'back'];
    for (const k of list) {
      BV.paintPanel(panelCanvas[k], k === 'front' ? 1 : -1, {
        color: state.color,
        logo: state.logo,
        place: placement(k),
        spec: garment.spec,
        grain,
        selected: selected === k,
        shadowLines: garment.foldCollar
          ? garment.foldCollar.edges.filter((e) => (e.side > 0) === (k === 'front')).map((e) => e.pts)
          : null,
      });
      panelTex[k].needsUpdate = true;
    }
    const c = new THREE.Color(state.color);
    mat.collar.color.copy(c).multiplyScalar(0.97);
    mat.inner.color.copy(c).multiplyScalar(0.82);
    mat.button.color.copy(c).lerp(new THREE.Color(0xffffff), 0.12);
    // light tees get a softer sheen so they do not look plastic
    const lum = BV.luminance(state.color);
    for (const m of [mat.front, mat.back, mat.collar]) {
      m.sheen = lum > 0.6 ? 0.12 : 0.3;
      m.sheenColor.copy(c).lerp(new THREE.Color(0xffffff), 0.25);
    }
  }

  /* ---------- interaction ---------- */
  let yaw = reduceMotion ? 0.32 : -1.4, yawVel = 0, targetYaw = 0.32;
  let pitch = 0.04, pitchTarget = 0.04, pitchVel = 0;
  let dragging = false, lastMove = 0;
  const pointers = new Map();
  let pinchStart = 0, pinchDist0 = 0;

  // cloth springs
  const cloth = { twist: 0, twistV: 0, ripple: 0, flare: 0, swing: 0, swingV: 0, t: 0, breeze: 0 };
  let drop = reduceMotion ? 0 : 0.06, dropV = 0;
  let teeLift = 0; // shorter tees are moved down so they stay centred

  /* ---------- logo editing: pick the fabric under the pointer ---------- */
  let selected = null; // 'front' | 'back' | null
  let edit = null; // { which, mode: 'move' | 'resize', offX, offY, d0, size0 }
  let down = null; // { x, y, moved }
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const HANDLE = 0.016; // grab radius of a corner handle, in fabric units

  // returns { which, x, y } in flat pattern coordinates, or null
  function pick(e) {
    const r = canvasEl.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    scene.updateMatrixWorld(); // positions as of now, not as of the last drawn frame
    raycaster.setFromCamera(ndc, camera);
    const targets = [pickables.front, pickables.back];
    if (pickables.collar) targets.push(pickables.collar);
    if (pickables.foldCollar) targets.push(pickables.foldCollar);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit || !hit.uv || !hit.object.userData.panel) return null;
    const which = hit.object.userData.panel;
    const U = BV.UV_SIZE;
    const u = which === 'back' ? 1 - hit.uv.x : hit.uv.x;
    return { which, x: u * U - U / 2, y: hit.uv.y * U - U / 2 };
  }
  function logoBox(which) {
    const pl = placement(which);
    if (!pl || !state.logo) return null;
    const hw = pl.w / 2, hh = (pl.w * state.logo.height) / state.logo.width / 2;
    return { cx: pl.cx, cy: pl.cy, hw, hh };
  }
  function hitTest(h) {
    if (!h) return null;
    const b = logoBox(h.which);
    if (!b) return null;
    if (selected === h.which) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1])
        if (Math.hypot(h.x - (b.cx + sx * b.hw), h.y - (b.cy + sy * b.hh)) < HANDLE) return 'resize';
    }
    const pad = 0.006;
    if (Math.abs(h.x - b.cx) < b.hw + pad && Math.abs(h.y - b.cy) < b.hh + pad) return 'move';
    return null;
  }
  function select(which) {
    if (selected === which) return;
    const prev = selected;
    selected = which;
    if (prev) paint(prev);
    if (which) {
      paint(which);
      state.spin = false;
      syncToggles();
      yawVel = 0;
      targetYaw = null;
    }
    $('#editTip').hidden = !which;
    if (which) announce(`Editing the ${which} logo. Drag to move it, drag a corner to resize, press Escape when done.`);
  }
  // switch a preset spot into a free position the user can drag
  function toCustom(which) {
    const s = state[which];
    if (s.pos === 'custom') return;
    const pl = placement(which);
    s.base = s.pos;
    s.custom = { cx: pl.cx, cy: pl.cy };
    s.pos = 'custom';
    s.dy = 0;
    $(`#${which}Y`).value = 0;
    document.querySelectorAll(`[data-${which}]`).forEach((x) => x.setAttribute('aria-checked', 'false'));
  }
  function moveLogo(which, cx, cy) {
    const sp = garment.spec;
    if (!BV.insidePanel(cx, cy, sp, which === 'front' ? 1 : -1)) return false;
    state[which].custom.cx = cx;
    state[which].custom.cy = cy;
    schedulePaint(which);
    return true;
  }
  function setSize(which, v) {
    const pct = Math.round(clamp(v, 0.3, 2.2) * 100);
    state[which].size = pct / 100;
    $(`#${which}Size`).value = pct;
    $(`#${which}SizeOut`).textContent = `${pct}%`;
    schedulePaint(which);
  }

  canvasEl.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvasEl.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStart = camDistTarget;
      dragging = false;
      edit = null;
      return;
    }
    down = { x: e.clientX, y: e.clientY, moved: false };
    hideHint();
    const h = pick(e);
    const mode = hitTest(h);
    if (mode) {
      select(h.which);
      toCustom(h.which);
      const b = logoBox(h.which);
      edit = {
        which: h.which, mode,
        offX: b.cx - h.x, offY: b.cy - h.y,
        d0: Math.max(0.005, Math.hypot(h.x - b.cx, h.y - b.cy)),
        size0: state[h.which].size,
      };
      canvasEl.style.cursor = mode === 'resize' ? 'nwse-resize' : 'grabbing';
      return;
    }
    dragging = true;
    targetYaw = null;
    lastMove = performance.now();
    canvasEl.classList.add('grabbing');
  });
  canvasEl.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      // hover: show what a press would do
      if (e.pointerType === 'mouse') {
        const m = hitTest(pick(e));
        canvasEl.style.cursor = m === 'resize' ? 'nwse-resize' : m === 'move' ? 'move' : '';
      }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist0 > 0) camDistTarget = clamp((pinchStart * pinchDist0) / d, 1.05, 3.2);
      return;
    }
    if (edit) {
      const h = pick(e);
      if (!h || h.which !== edit.which) return; // stay on the same side of the tee
      if (edit.mode === 'move') moveLogo(edit.which, h.x + edit.offX, h.y + edit.offY);
      else {
        const s = state[edit.which].custom;
        setSize(edit.which, (edit.size0 * Math.hypot(h.x - s.cx, h.y - s.cy)) / edit.d0);
      }
      return;
    }
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max(8, now - lastMove) / 1000;
    lastMove = now;
    const dYaw = dx * 0.0105;
    yaw += dYaw;
    yawVel = lerp(yawVel, clamp(dYaw / dt, -14, 14), 0.55);
    pitchTarget = clamp(pitchTarget + dy * 0.0035, -0.3, 0.38);
  });
  const endDrag = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      // a tap on bare fabric or background ends editing
      if (!edit && down && !down.moved && selected) select(null);
      if (edit) canvasEl.style.cursor = '';
      edit = null;
      down = null;
      dragging = false;
      canvasEl.classList.remove('grabbing');
    }
  };
  canvasEl.addEventListener('pointerup', endDrag);
  canvasEl.addEventListener('pointercancel', endDrag);
  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    camDistTarget = clamp(camDistTarget * Math.exp(e.deltaY * 0.0012), 1.05, 3.2);
  }, { passive: false });

  // keyboard: arrows turn the tee, or nudge the selected logo
  canvasEl.addEventListener('keydown', (e) => {
    if (selected) {
      const step = e.shiftKey ? 0.02 : 0.004;
      const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (mv) {
        e.preventDefault();
        toCustom(selected);
        // on the back, the viewer's left is the pattern's right
        const sx = selected === 'back' ? -1 : 1;
        const c = state[selected].custom;
        moveLogo(selected, c.cx + mv[0] * step * sx, c.cy + mv[1] * step);
        return;
      }
      if (e.key === 'Escape') { select(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const w = selected;
        select(null);
        document.querySelector(`[data-${w}="none"]`).click();
        return;
      }
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      targetYaw = null;
      yawVel += e.key === 'ArrowLeft' ? -2.2 : 2.2;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selected && document.activeElement !== canvasEl) select(null);
  });
  $('#editDone').addEventListener('click', () => select(null));

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function viewTo(angle) {
    targetYaw = yaw + wrap(angle - yaw);
    state.spin = false;
    syncToggles();
  }

  /* ---------- frame loop ---------- */
  let last = performance.now();
  let needsNormals = true;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // rotation
    if (dragging) {
      if (now - lastMove > 60) yawVel *= Math.exp(-14 * dt);
    } else if (targetYaw !== null) {
      yawVel += (targetYaw - yaw) * 26 * dt;
      yawVel *= Math.exp(-7.5 * dt);
      yaw += yawVel * dt;
      if (Math.abs(targetYaw - yaw) < 0.0005 && Math.abs(yawVel) < 0.002) { yaw = targetYaw; yawVel = 0; }
    } else {
      if (state.spin) yawVel = lerp(yawVel, 0.5, 1 - Math.exp(-2 * dt));
      else yawVel *= Math.exp(-2.4 * dt);
      yaw += yawVel * dt;
    }
    const prevPitch = pitch;
    pitch = lerp(pitch, pitchTarget, 1 - Math.exp(-8 * dt));
    pitchVel = (pitch - prevPitch) / Math.max(dt, 1e-3);
    if (!dragging) pitchTarget = lerp(pitchTarget, 0.04, 1 - Math.exp(-1.2 * dt));

    // cloth: the hem lags behind the turn, overshoots, then settles
    const twistTarget = clamp(yawVel * 0.075, -0.55, 0.55);
    const ta = (twistTarget - cloth.twist) * 48 - cloth.twistV * 4.2;
    cloth.twistV += ta * dt;
    cloth.twist += cloth.twistV * dt;
    const sa = (clamp(-pitchVel * 0.05, -0.05, 0.05) - cloth.swing) * 40 - cloth.swingV * 4;
    cloth.swingV += sa * dt;
    cloth.swing += cloth.swingV * dt;
    const rTarget = Math.min(0.0105, Math.abs(yawVel) * 0.0026 + Math.abs(cloth.twistV) * 0.0035 + Math.abs(cloth.swingV) * 0.02);
    cloth.ripple = lerp(cloth.ripple, rTarget, 1 - Math.exp(-(rTarget > cloth.ripple ? 8 : 1.6) * dt));
    cloth.flare = lerp(cloth.flare, Math.min(0.08, yawVel * yawVel * 0.004), 1 - Math.exp(-4 * dt));
    cloth.breeze = lerp(cloth.breeze, state.breeze ? 0.0022 : 0, 1 - Math.exp(-2 * dt));
    cloth.t += dt * (1 + Math.min(3, Math.abs(yawVel) * 0.6));

    const moving =
      Math.abs(cloth.twist) > 1e-4 || Math.abs(cloth.twistV) > 1e-4 || cloth.ripple > 1e-5 ||
      cloth.flare > 1e-5 || Math.abs(cloth.swing) > 1e-5 || cloth.breeze > 1e-5;
    if (moving || needsNormals) {
      for (const p of parts) {
        const attr = p.geo.attributes.position;
        BV.deform(p.base, p.hang, attr.array, cloth);
        attr.needsUpdate = true;
        p.geo.computeVertexNormals();
      }
      needsNormals = moving;
    }

    // drop in when the garment changes
    const da = -drop * 90 - dropV * 11;
    dropV += da * dt;
    drop += dropV * dt;

    tee.rotation.y = yaw;
    tee.rotation.x = pitch * 0.55;
    teeLift = lerp(teeLift, state.cropped ? -0.075 : 0, 1 - Math.exp(-6 * dt));
    tee.position.y = 0.012 + drop + teeLift;
    camDist = lerp(camDist, camDistTarget, 1 - Math.exp(-10 * dt));
    camera.position.set(0, LOOK_Y + 0.04 + pitch * 0.25, camDist);
    camera.lookAt(0, LOOK_Y, 0);

    renderer.render(scene, camera);
    if (!ready) markReady();
    requestAnimationFrame(frame);
  }

  function resize() {
    const r = canvasEl.parentElement.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    // keep the whole tee in view on narrow screens
    camera.fov = camera.aspect < 0.8 ? 28 / Math.max(0.55, camera.aspect / 0.8) : 28;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvasEl.parentElement);

  /* ---------- UI ---------- */
  let ready = false;
  function markReady() {
    ready = true;
    $('#skeleton').classList.add('done');
    setTimeout(() => ($('#skeleton').hidden = true), 600);
  }

  let hintTimer = setTimeout(hideHint, 9000);
  function hideHint() {
    clearTimeout(hintTimer);
    $('#hint').classList.add('gone');
  }

  // garment switch
  const segBtns = document.querySelectorAll('[data-garment]');
  segBtns.forEach((b) =>
    b.addEventListener('click', () => {
      if (state.garment === b.dataset.garment) return;
      state.garment = b.dataset.garment;
      segBtns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      $('.seg').dataset.active = state.garment;
      select(null);
      syncCollar();
      rebuild(true);
      announce(state.garment === 'vneck' ? 'Showing the V neck tee' : 'Showing the round neck tee');
    })
  );

  function rebuild(kick) {
    buildTee(state.garment);
    paint();
    needsNormals = true;
    if (kick && !reduceMotion) {
      drop = 0.035;
      cloth.twistV += 2.4;
    }
  }

  // fold down collar switch (V neck only)
  const collarSwitch = $('#collarSwitch');
  function syncCollar() {
    const v = state.garment === 'vneck';
    collarSwitch.disabled = !v;
    collarSwitch.setAttribute('aria-checked', String(v && state.collar));
    $('#collarNote').textContent = v
      ? 'Polo collar with a two button placket.'
      : 'Available on the V neck tee. Switch to it at the top.';
  }
  // fit switches: cropped and fitted work on both tees
  for (const [id, keyName, on, off] of [
    ['cropSwitch', 'cropped', 'Cropped length on', 'Regular length'],
    ['fitSwitch', 'fitted', 'Fitted cut on', 'Regular cut'],
  ]) {
    const el = $('#' + id);
    el.addEventListener('click', () => {
      state[keyName] = !state[keyName];
      el.setAttribute('aria-checked', String(state[keyName]));
      select(null);
      rebuild(true);
      announce(state[keyName] ? on : off);
    });
  }

  collarSwitch.addEventListener('click', () => {
    if (state.garment !== 'vneck') return;
    state.collar = !state.collar;
    syncCollar();
    rebuild(false);
    if (!reduceMotion) cloth.twistV += 1.2;
    if (targetYaw === null && !state.spin) viewTo(0.32);
    announce(state.collar ? 'Collar added' : 'Collar removed');
  });

  // chips
  function bindChips(group, which) {
    const chips = document.querySelectorAll(`[data-${group}]`);
    chips.forEach((c) =>
      c.addEventListener('click', () => {
        state[which].pos = c.dataset[group];
        state[which].dy = 0;
        $(`#${which}Y`).value = 0;
        if (state[which].pos === 'none' && selected === which) select(null);
        chips.forEach((x) => x.setAttribute('aria-checked', String(x === c)));
        $(`#${which}Adjust`).classList.toggle('off', state[which].pos === 'none');
        paint(which);
        if (which === 'back' && state.back.pos !== 'none') viewTo(Math.PI);
        if (which === 'front' && state.front.pos !== 'none') viewTo(0.32);
      })
    );
  }
  bindChips('front', 'front');
  bindChips('back', 'back');

  // sliders (painting is throttled to one redraw per frame)
  const pending = new Set();
  function schedulePaint(which) {
    if (!pending.size) requestAnimationFrame(() => { pending.forEach((w) => paint(w)); pending.clear(); });
    pending.add(which);
  }
  for (const which of ['front', 'back']) {
    $(`#${which}Size`).addEventListener('input', (e) => {
      state[which].size = e.target.value / 100;
      $(`#${which}SizeOut`).textContent = `${e.target.value}%`;
      schedulePaint(which);
    });
    $(`#${which}Y`).addEventListener('input', (e) => {
      state[which].dy = e.target.value / 1000;
      schedulePaint(which);
    });
  }

  // colours
  const swatches = document.querySelectorAll('.swatch[data-color]');
  function setColor(hex, name) {
    state.color = hex;
    swatches.forEach((s) => s.setAttribute('aria-checked', String(s.dataset.color.toLowerCase() === hex.toLowerCase())));
    $('#colorName').textContent = name || hex.toUpperCase();
    paint();
  }
  swatches.forEach((s) => s.addEventListener('click', () => setColor(s.dataset.color, s.dataset.name)));
  $('#customColor').addEventListener('input', (e) => setColor(e.target.value, 'Custom ' + e.target.value.toUpperCase()));

  // view bar
  $('#vFront').addEventListener('click', () => viewTo(0));
  $('#vSide').addEventListener('click', () => viewTo(-Math.PI / 2));
  $('#vBack').addEventListener('click', () => viewTo(Math.PI));
  $('#tBreeze').addEventListener('click', () => { state.breeze = !state.breeze; syncToggles(); });
  $('#tSpin').addEventListener('click', () => { state.spin = !state.spin; if (state.spin) targetYaw = null; syncToggles(); });
  function syncToggles() {
    $('#tBreeze').setAttribute('aria-pressed', String(state.breeze));
    $('#tSpin').setAttribute('aria-pressed', String(state.spin));
  }

  /* ---------- logo upload ---------- */
  const fileInput = $('#logoFile');
  const drop0 = $('#drop');
  const MAX_BYTES = 20 * 1024 * 1024;

  function showError(msg) {
    const el = $('#logoError');
    el.textContent = msg;
    el.hidden = !msg;
  }

  // trim transparent padding and cap the size
  function prepareLogo(img) {
    const max = 1400;
    const s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (data[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    if (x1 < 0) return null;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, -x0, -y0);
    let opaqueCorners = 0;
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) if (data[(y * w + x) * 4 + 3] > 250) opaqueCorners++;
    return { canvas: out, opaque: opaqueCorners === 4 };
  }

  function loadFile(file) {
    showError('');
    if (!file) return;
    if (!/^image\//.test(file.type)) return showError('That file is not an image. Use a PNG with a transparent background.');
    if (file.size > MAX_BYTES) return showError('Upload failed. The file is over 20 MB.');
    drop0.classList.add('loading');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = prepareLogo(img);
      URL.revokeObjectURL(url);
      drop0.classList.remove('loading');
      if (!r) return showError('This image is fully transparent. Pick a file that has visible artwork.');
      setLogo(r.canvas, file.name, false);
      if (r.opaque) showError('This logo has a solid background, so a box will print around it. A transparent PNG looks cleaner.');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      drop0.classList.remove('loading');
      showError('This image could not be read. Try exporting it again as PNG.');
    };
    img.src = url;
  }

  function setLogo(cnv, name, sample) {
    state.logo = cnv;
    state.logoName = name;
    state.sample = sample;
    const thumb = $('#logoThumb');
    thumb.width = 96; thumb.height = 96;
    const t = thumb.getContext('2d');
    t.clearRect(0, 0, 96, 96);
    const s = Math.min(80 / cnv.width, 80 / cnv.height);
    t.drawImage(cnv, (96 - cnv.width * s) / 2, (96 - cnv.height * s) / 2, cnv.width * s, cnv.height * s);
    $('#logoName').textContent = sample ? 'Sample logo' : name;
    $('#logoMeta').textContent = sample ? 'Upload yours to replace it' : `${cnv.width} × ${cnv.height} px, trimmed`;
    $('#logoCard').hidden = false;
    $('#removeLogo').hidden = sample;
    if (state.front.pos === 'none' && state.back.pos === 'none') document.querySelector('[data-front="center"]').click();
    paint();
    announce(sample ? 'Sample logo applied' : `${name} applied to the tee`);
  }

  fileInput.addEventListener('change', (e) => { loadFile(e.target.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop0.addEventListener(ev, (e) => { e.preventDefault(); drop0.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop0.addEventListener(ev, (e) => { e.preventDefault(); drop0.classList.remove('over'); }));
  drop0.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  // dropping anywhere on the stage works too
  const stage = $('#stage');
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });
  $('#removeLogo').addEventListener('click', () => {
    select(null);
    state.logo = null;
    $('#logoCard').hidden = true;
    showError('');
    paint();
    announce('Logo removed');
  });

  /* ---------- save image ---------- */
  $('#saveBtn').addEventListener('click', () => {
    renderer.render(scene, camera);
    const w = canvasEl.width, h = canvasEl.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--stage').trim() || '#ECEBE7';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(canvasEl, 0, 0);
    const a = document.createElement('a');
    a.download = `BrandVision-${state.garment === 'vneck' ? 'v-neck' : 'round-neck'}.png`;
    a.href = out.toDataURL('image/png');
    a.click();
    announce('Image saved to your downloads');
  });

  function announce(msg) {
    const el = $('#status');
    el.textContent = msg;
  }


  /* ---------- boot ---------- */
  // let the skeleton paint first, then do the heavy texture work
  requestAnimationFrame(() =>
    setTimeout(() => {
      buildTee(state.garment);
      const go = () => {
        setLogo(BV.makeSampleLogo(), 'Sample logo', true);
        syncToggles();
        syncCollar();
        resize();
        requestAnimationFrame(frame);
      };
      // wait for the font so the sample logo text renders in Manrope
      (document.fonts && document.fonts.load ? document.fonts.load('700 84px Manrope') : Promise.resolve()).then(go, go);
    }, 30)
  );
})();
