// Star Domination — 3D spherical goban, rendered with three.js.
//
// The mesh is generated with the same icosphere → triangle-merge →
// quadrangulation → compensated area-weighted relaxation pipeline as before.
// Rendering, input, and the render loop are all in three.js now, so we get
// reliable texture-mapped spheres, scene.background images, lighting that
// actually behaves, Raycaster picking, and a request-animation-frame loop.
// p5 is not involved in this mode.
//
// Integration with sketch.js:
//   - window.__sdGetGameStones() / __sdGetCurrentPlayer() / __sdGetVertices()
//     / __sdGetQuads() / __sdGetMode() — getters (sketch.js let-scoped state).
//   - window.__sdSetHoverVertex(vid) — setter for hoverVertex.
//   - window.__sdTryPlaceStone(vid) — runs mode check + tryPlaceAtHover.

(function () {
  'use strict';

  const SD = {};
  window.StarDomination = SD;

  // ---- State ----
  SD.active = false;
  SD.R = 250;                 // display radius in world units
  SD.camYaw = 0;
  SD.camPitch = 0.35;
  // Narrow FOV + long camera distance = near-isometric / telephoto look.
  SD.camFovDeg = 24;
  SD.camDist = 2400;           // placeholder — overridden by fitCamDist() at activate
  // Opponent's camera state, set via window.StarDomination.onOpponentCamera
  // (socket-synced in multiplayer). Null when single-player or before the
  // first opponent update arrives.
  SD.opponentEye = null;
  SD._lastCameraEmit = 0;
  SD.dragging = false;
  SD.lastMouse = { x: 0, y: 0 };
  SD.hoverVid = null;
  SD.avgEdge = null;

  // three.js handles
  SD.scene = null;
  SD.camera = null;
  SD.renderer = null;
  SD.canvas = null;
  SD.globeMesh = null;
  SD.wireframeMesh = null;
  SD.hoverRing = null;
  SD.stoneMeshes = new Map();  // vid -> three.Mesh
  SD.keyLight = null;
  SD.fillLight = null;
  SD.ambientLight = null;
  SD.rafId = null;
  SD.sceneReady = false;

  // Mesh data kept in-module (pure-data form: {x,y,z} unit-sphere coords + quad index tuples)
  let _meshVerts = [];         // generator output + internal scratch
  let _meshQuads = [];

  // ==============================================================
  // Mesh generation — unchanged math from the p5 version. Pure data in,
  // pure data out. No three.js involved here.
  // ==============================================================

  function buildIcosphere(level) {
    const verts = [];
    const addV = (x, y, z) => {
      const m = Math.hypot(x, y, z);
      verts.push({ x: x / m, y: y / m, z: z / m });
      return verts.length - 1;
    };
    const t = (1 + Math.sqrt(5)) / 2;
    [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
     [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
     [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .forEach(([x, y, z]) => addV(x, y, z));

    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    for (let k = 0; k < level; k++) {
      const mc = new Map();
      const mid = (a, b) => {
        const key = a < b ? a * 1e6 + b : b * 1e6 + a;
        if (mc.has(key)) return mc.get(key);
        const va = verts[a], vb = verts[b];
        const id = addV(va.x + vb.x, va.y + vb.y, va.z + vb.z);
        mc.set(key, id);
        return id;
      };
      const next = [];
      for (const [a, b, c] of faces) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }
    return { verts, faces };
  }

  function buildIcosphereFreq3() {
    const verts = [];
    const addV = (x, y, z) => {
      const m = Math.hypot(x, y, z);
      verts.push({ x: x / m, y: y / m, z: z / m });
      return verts.length - 1;
    };
    const t = (1 + Math.sqrt(5)) / 2;
    [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
     [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
     [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .forEach(([x, y, z]) => addV(x, y, z));
    const baseFaces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const thirds = new Map();
    const getThirds = (a, b) => {
      const min = a < b ? a : b, max = a < b ? b : a;
      const key = min + '_' + max;
      let pair = thirds.get(key);
      if (!pair) {
        const vmin = verts[min], vmax = verts[max];
        const pNearMin = addV(2 * vmin.x + vmax.x, 2 * vmin.y + vmax.y, 2 * vmin.z + vmax.z);
        const pNearMax = addV(vmin.x + 2 * vmax.x, vmin.y + 2 * vmax.y, vmin.z + 2 * vmax.z);
        pair = [pNearMin, pNearMax];
        thirds.set(key, pair);
      }
      return a < b ? pair : [pair[1], pair[0]];
    };
    const faces = [];
    for (const [A, B, C] of baseFaces) {
      const [mAB1, mAB2] = getThirds(A, B);
      const [mBC1, mBC2] = getThirds(B, C);
      const [mCA1, mCA2] = getThirds(C, A);
      const va = verts[A], vb = verts[B], vc = verts[C];
      const ctr = addV(va.x + vb.x + vc.x, va.y + vb.y + vc.y, va.z + vb.z + vc.z);
      faces.push(
        [A, mAB1, mCA2], [mAB1, mAB2, ctr], [mCA2, ctr, mCA1],
        [mAB2, B, mBC1], [ctr, mBC1, mBC2], [mCA1, mBC2, C],
        [mAB1, ctr, mCA2], [mAB2, mBC1, ctr], [ctr, mBC2, mCA1],
      );
    }
    return { verts, faces };
  }

  // Internal mutable state during pipeline
  let _verts = [];
  let _tris = [];
  let _quads = [];

  function edgeKey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }

  function rebuildEdgeFaceMap() {
    const m = new Map();
    const add = (a, b, kind, id) => {
      const k = edgeKey(a, b);
      let e = m.get(k);
      if (!e) { e = { a: Math.min(a, b), b: Math.max(a, b), faces: [] }; m.set(k, e); }
      e.faces.push({ kind, id });
    };
    for (const t of _tris) if (t.active) {
      add(t.verts[0], t.verts[1], 'tri', t.id);
      add(t.verts[1], t.verts[2], 'tri', t.id);
      add(t.verts[2], t.verts[0], 'tri', t.id);
    }
    for (const q of _quads) if (q.active) {
      const v = q.verts;
      add(v[0], v[1], 'quad', q.id); add(v[1], v[2], 'quad', q.id);
      add(v[2], v[3], 'quad', q.id); add(v[3], v[0], 'quad', q.id);
    }
    return m;
  }

  function mergeTrianglesRandomly() {
    const em = rebuildEdgeFaceMap();
    const fixed = new Map();
    for (const t of _tris) if (t.active) fixed.set(t.id, []);
    for (const e of em.values()) {
      const ts = e.faces.filter((f) => f.kind === 'tri');
      if (ts.length === 2) {
        fixed.get(ts[0].id).push(ts[1].id);
        fixed.get(ts[1].id).push(ts[0].id);
      }
    }
    const origActive = _tris.map((t) => t.active);
    const origQuadsLen = _quads.length;
    const total = fixed.size;
    const maxMerges = Math.floor(total / 2);
    let bestCount = -1, bestActive = null, bestNewQuads = null;

    for (let trial = 0; trial < 50; trial++) {
      for (let i = 0; i < _tris.length; i++) _tris[i].active = origActive[i];
      _quads.length = origQuadsLen;
      const adj = new Map();
      for (const [id, arr] of fixed) adj.set(id, new Set(arr));
      let merged = 0;
      while (true) {
        let bestDeg = Infinity;
        const ties = [];
        for (const [id, nbrs] of adj) {
          const d = nbrs.size;
          if (d === 0) continue;
          if (d < bestDeg) { bestDeg = d; ties.length = 0; ties.push(id); }
          else if (d === bestDeg) ties.push(id);
        }
        if (ties.length === 0) break;
        const a = ties[(Math.random() * ties.length) | 0];
        const nbrs = Array.from(adj.get(a));
        const b = nbrs[(Math.random() * nbrs.length) | 0];
        const ta = _tris[a], tb = _tris[b];
        const shared = ta.verts.filter((v) => tb.verts.includes(v));
        const c1 = ta.verts.find((v) => !shared.includes(v));
        const c2 = tb.verts.find((v) => !shared.includes(v));
        ta.active = false; tb.active = false;
        _quads.push({ id: _quads.length, verts: [c1, shared[0], c2, shared[1]], active: true });
        merged++;
        for (const n of adj.get(a)) adj.get(n)?.delete(a);
        for (const n of adj.get(b)) adj.get(n)?.delete(b);
        adj.delete(a); adj.delete(b);
      }
      if (merged > bestCount) {
        bestCount = merged;
        bestActive = _tris.map((t) => t.active);
        bestNewQuads = _quads.slice(origQuadsLen);
        if (merged === maxMerges) break;
      }
    }
    for (let i = 0; i < _tris.length; i++) _tris[i].active = bestActive[i];
    _quads.length = origQuadsLen;
    for (const q of bestNewQuads) _quads.push(q);
  }

  function quadrangulate() {
    const midCache = new Map();
    const addV = (x, y, z) => {
      const m = Math.hypot(x, y, z);
      _verts.push({ x: x / m, y: y / m, z: z / m });
      return _verts.length - 1;
    };
    const getMid = (a, b) => {
      const k = edgeKey(a, b);
      if (midCache.has(k)) return midCache.get(k);
      const va = _verts[a], vb = _verts[b];
      const id = addV(va.x + vb.x, va.y + vb.y, va.z + vb.z);
      midCache.set(k, id);
      return id;
    };
    const getCenter = (verts) => {
      let x = 0, y = 0, z = 0;
      for (const vid of verts) { const p = _verts[vid]; x += p.x; y += p.y; z += p.z; }
      return addV(x, y, z);
    };
    const newQuads = [];
    for (const t of _tris) {
      if (!t.active) continue;
      const [a, b, c] = t.verts;
      const mab = getMid(a, b), mbc = getMid(b, c), mca = getMid(c, a);
      const ctr = getCenter(t.verts);
      newQuads.push([a, mab, ctr, mca]);
      newQuads.push([b, mbc, ctr, mab]);
      newQuads.push([c, mca, ctr, mbc]);
      t.active = false;
    }
    for (const q of _quads) {
      if (!q.active) continue;
      const [a, b, c, d] = q.verts;
      const mab = getMid(a, b), mbc = getMid(b, c), mcd = getMid(c, d), mda = getMid(d, a);
      const ctr = getCenter(q.verts);
      newQuads.push([a, mab, ctr, mda]);
      newQuads.push([b, mbc, ctr, mab]);
      newQuads.push([c, mcd, ctr, mbc]);
      newQuads.push([d, mda, ctr, mcd]);
      q.active = false;
    }
    _tris = [];
    _quads = newQuads.map((v, i) => ({ id: i, verts: v, active: true }));
  }

  function relaxMesh(iterations) {
    const N = _verts.length;
    const adjFaces = new Array(N);
    for (let i = 0; i < N; i++) adjFaces[i] = [];
    for (const q of _quads) if (q.active) for (const vid of q.verts) adjFaces[vid].push(q.id);
    const strength = 0.2, compK = 0.18, minTarget = 0.4;
    for (let it = 0; it < iterations; it++) {
      const em = rebuildEdgeFaceMap();
      const degree = new Array(N).fill(0);
      for (const e of em.values()) { degree[e.a]++; degree[e.b]++; }
      const qd = new Array(_quads.length);
      for (let i = 0; i < _quads.length; i++) {
        const q = _quads[i];
        if (!q.active) { qd[i] = null; continue; }
        const a = _verts[q.verts[0]], b = _verts[q.verts[1]];
        const c = _verts[q.verts[2]], d = _verts[q.verts[3]];
        const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
        const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
        const adx = d.x - a.x, ady = d.y - a.y, adz = d.z - a.z;
        const n1x = aby * acz - abz * acy, n1y = abz * acx - abx * acz, n1z = abx * acy - aby * acx;
        const n2x = acy * adz - acz * ady, n2y = acz * adx - acx * adz, n2z = acx * ady - acy * adx;
        const area = 0.5 * (Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z) +
                            Math.sqrt(n2x * n2x + n2y * n2y + n2z * n2z));
        let deficit = 0;
        for (const vid of q.verts) deficit += (4 - (degree[vid] || 0));
        qd[i] = {
          area, mult: Math.max(minTarget, 1 + compK * deficit),
          cx: (a.x + b.x + c.x + d.x) * 0.25,
          cy: (a.y + b.y + c.y + d.y) * 0.25,
          cz: (a.z + b.z + c.z + d.z) * 0.25,
        };
      }
      const targets = new Array(N);
      for (let vid = 0; vid < N; vid++) {
        const faces = adjFaces[vid];
        if (faces.length === 0) { targets[vid] = null; continue; }
        let wx = 0, wy = 0, wz = 0, tw = 0;
        for (const fid of faces) {
          const d = qd[fid];
          if (!d || d.area <= 0) continue;
          const w = d.area / d.mult;
          wx += d.cx * w; wy += d.cy * w; wz += d.cz * w; tw += w;
        }
        targets[vid] = tw > 0 ? { x: wx / tw, y: wy / tw, z: wz / tw } : null;
      }
      for (let vid = 0; vid < N; vid++) {
        const t = targets[vid];
        if (!t) continue;
        const v = _verts[vid];
        v.x += (t.x - v.x) * strength;
        v.y += (t.y - v.y) * strength;
        v.z += (t.z - v.z) * strength;
        const m = Math.hypot(v.x, v.y, v.z);
        if (m > 0) { v.x /= m; v.y /= m; v.z /= m; }
      }
    }
  }

  SD.generateMesh = function (size) {
    const s = size || 'small';
    let ico;
    if (s === 'medium') ico = buildIcosphereFreq3();
    else if (s === 'large') ico = buildIcosphere(2);
    else ico = buildIcosphere(1);
    _verts = ico.verts.slice();
    _tris = ico.faces.map((f, i) => ({ id: i, verts: f.slice(), active: true }));
    _quads = [];
    mergeTrianglesRandomly();
    quadrangulate();
    const iters = s === 'large' ? 1600 : (s === 'medium' ? 1400 : 1200);
    relaxMesh(iters);
    const out = {
      verts: _verts.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      quads: _quads.filter((q) => q.active).map((q) => ({ verts: q.verts.slice() })),
    };
    _meshVerts = out.verts;
    _meshQuads = out.quads;
    return out;
  };

  // ==============================================================
  // three.js scene setup + render loop
  // ==============================================================

  function panelFootprintPx() {
    if (typeof window === 'undefined') return 0;
    if (window.innerWidth <= 600) return 0;
    const el = document.getElementById('roomPanel');
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.left >= window.innerWidth) return 0;
    return Math.min(window.innerWidth, rect.right);
  }

  // Visible diagnostic banner — appears on-screen when 3D activation fails
  // or reports surprising state. Invaluable for mobile debugging where you
  // can't easily hit DevTools.
  function showDiagnostic(msg, isError) {
    let el = document.getElementById('sdDiag');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sdDiag';
      el.style.cssText =
        'position:fixed; top:10px; left:50%; transform:translateX(-50%); ' +
        'z-index:9999; max-width:90vw; padding:10px 14px; ' +
        'background:rgba(0,0,0,0.85); color:#ffe; font:12px/1.4 monospace; ' +
        'border-radius:8px; white-space:pre-wrap; pointer-events:auto; ' +
        'border:1px solid rgba(255,255,255,0.2);';
      el.addEventListener('click', () => el.remove());
      document.body.appendChild(el);
    }
    el.style.borderColor = isError ? '#f55' : 'rgba(255,255,255,0.2)';
    el.style.color = isError ? '#fee' : '#ffe';
    el.textContent = msg;
  }

  function initThreeScene() {
    if (SD.sceneReady) return true;
    if (typeof THREE === 'undefined') {
      showDiagnostic(
        'StarDomination: three.js failed to load.\n' +
        'Check that three.min.js is present in the site root and that the\n' +
        'browser isn\'t blocking it (service worker, privacy mode, etc).',
        true
      );
      console.error('[StarDomination] three.js not loaded');
      return false;
    }
    // Sanity-check WebGL support before creating a renderer — iOS/older
    // Android browsers sometimes have WebGL disabled or throw during
    // context creation.
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl');
      if (!gl) {
        showDiagnostic(
          'StarDomination: WebGL unavailable in this browser.\n' +
          'The 3D goban requires WebGL. Try a different browser or enable\n' +
          'hardware acceleration in your current one.',
          true
        );
        return false;
      }
    } catch (err) {
      showDiagnostic('StarDomination: WebGL probe threw: ' + err.message, true);
      return false;
    }

    SD.canvas = document.createElement('canvas');
    SD.canvas.id = 'sdCanvas';
    // Positioning + stacking; DO NOT set width/height in vw/vh here — mobile
    // browsers change the effective viewport when the URL bar hides/shows,
    // which makes vh unreliable. We let three.js write explicit pixel sizes
    // below (setSize with updateStyle=true, the default).
    SD.canvas.style.cssText =
      'position:fixed; top:0; left:0; ' +
      'z-index:2; display:none; touch-action:none; background:transparent;';
    document.body.appendChild(SD.canvas);

    try {
      SD.renderer = new THREE.WebGLRenderer({
        canvas: SD.canvas,
        antialias: true,
        alpha: false,
      });
    } catch (err) {
      showDiagnostic(
        'StarDomination: WebGLRenderer construction failed.\n' + err.message,
        true
      );
      return false;
    }
    // Cap pixel ratio at 2 — some mobile devices report DPR of 3 or more,
    // which creates backing buffers large enough to crash low-end GPUs.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    SD.renderer.setPixelRatio(dpr);
    // updateStyle=true (default) so the canvas element's CSS width/height
    // get set in pixels — avoids mobile vh quirks.
    const iw = Math.max(1, window.innerWidth);
    const ih = Math.max(1, window.innerHeight);
    SD.renderer.setSize(iw, ih);
    // three.js r155+ defaults to linear color space which makes scenes
    // look dark and flat. Output to sRGB so our colours/textures display
    // as expected.
    if ('outputColorSpace' in SD.renderer && THREE.SRGBColorSpace) {
      SD.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if ('outputEncoding' in SD.renderer && THREE.sRGBEncoding) {
      SD.renderer.outputEncoding = THREE.sRGBEncoding;
    }

    SD.scene = new THREE.Scene();

    // Cover image as scene background — three.js handles this natively as
    // a fullscreen, non-transforming background. No depth/alpha gotchas.
    const loader = new THREE.TextureLoader();
    loader.load('images/coverImage.png', (tex) => {
      if (!SD.scene) return;
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      SD.scene.background = tex;
    });

    SD.camera = new THREE.PerspectiveCamera(
      SD.camFovDeg, iw / ih, 1, 20000
    );

    // Soft player lights: each player's directional light produces a smooth
    // lit hemisphere — natural gradient, no hard edge. Two-player games
    // have both lights at their respective camera positions (synced via
    // socket), so each player can see where the other is looking by the
    // second lit zone on the globe.
    SD.ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    SD.scene.add(SD.ambientLight);
    SD.keyLight = new THREE.DirectionalLight(0xffe8a8, 2.8);
    SD.scene.add(SD.keyLight);
    SD.scene.add(SD.keyLight.target);
    SD.fillLight = new THREE.DirectionalLight(0xa8c0ff, 2.8);
    SD.fillLight.visible = false; // on only when an opponent is present
    SD.scene.add(SD.fillLight);
    SD.scene.add(SD.fillLight.target);

    // Input listeners — attached once, gated by SD.active.
    SD.canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    SD.canvas.addEventListener('wheel', onWheel, { passive: false });
    SD.canvas.addEventListener('dblclick', onDoubleClick);
    // Touch — mirrors mouse for orbit; double-tap triggers placement.
    SD.canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    SD.canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    SD.canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('resize', onResize);
    // Mobile browsers fire orientation/resize events at slightly different
    // times when the URL bar hides/shows — listen to both to stay sized.
    window.addEventListener('orientationchange', onResize);

    SD.sceneReady = true;
    return true;
  }

  function buildSphereObjects() {
    // Clean up any existing meshes
    if (SD.globeMesh) {
      SD.scene.remove(SD.globeMesh);
      SD.globeMesh.geometry.dispose();
      SD.globeMesh.material.dispose();
      SD.globeMesh = null;
    }
    if (SD.wireframeMesh) {
      SD.scene.remove(SD.wireframeMesh);
      SD.wireframeMesh.geometry.dispose();
      SD.wireframeMesh.material.dispose();
      SD.wireframeMesh = null;
    }
    for (const mesh of SD.stoneMeshes.values()) {
      SD.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    SD.stoneMeshes.clear();
    if (SD.hoverRing) {
      SD.scene.remove(SD.hoverRing);
      SD.hoverRing.geometry.dispose();
      SD.hoverRing.material.dispose();
      SD.hoverRing = null;
    }

    // Wood-textured globe. MeshPhongMaterial responds to DirectionalLight +
    // AmbientLight out of the box without needing an environment map —
    // gives obvious shading variation across the sphere.
    const loader = new THREE.TextureLoader();
    const woodTex = loader.load('images/wood_texture.png');
    woodTex.wrapS = THREE.RepeatWrapping;
    woodTex.wrapT = THREE.RepeatWrapping;
    if ('colorSpace' in woodTex && THREE.SRGBColorSpace) {
      woodTex.colorSpace = THREE.SRGBColorSpace;
    }
    // Globe at full R; arc-projected edges live just outside (ARC_R below)
    // so there's no visible gap between the wood surface and the grid lines.
    const globeGeom = new THREE.SphereGeometry(SD.R, 64, 32);
    const globeMat = new THREE.MeshPhongMaterial({
      map: woodTex, shininess: 8, specular: 0x3a3228,
    });
    SD.globeMesh = new THREE.Mesh(globeGeom, globeMat);
    SD.scene.add(SD.globeMesh);

    // Wireframe: each edge is subdivided into many short segments, each of
    // which has its endpoints projected back onto the unit sphere. The
    // result closely approximates a great-circle arc, so edges visually wrap
    // the sphere surface instead of cutting through it as straight chords.
    // At N=14 subsegments the arc is indistinguishable from a true geodesic
    // at any sensible zoom level, while rendering as a single LineSegments.
    const V = _meshVerts, Q = _meshQuads;
    const N_ARC = 14;
    // Tiny positive offset above the globe surface so line pixels beat the
    // globe in the depth test without z-fighting. 0.1% of R is ~0.25 units
    // on a 250-unit radius — subpixel on screen.
    const ARC_R = SD.R * 1.001;
    const positions = [];
    const drawn = new Set();
    let sumLen = 0, nEdges = 0;

    const projectOnto = (x, y, z) => {
      const m = Math.hypot(x, y, z) || 1;
      return { x: (x / m) * ARC_R, y: (y / m) * ARC_R, z: (z / m) * ARC_R };
    };

    for (const q of Q) {
      for (let k = 0; k < 4; k++) {
        const a = q.verts[k], b = q.verts[(k + 1) % 4];
        const key = a < b ? a * 1e6 + b : b * 1e6 + a;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const pa = V[a], pb = V[b];
        // Sample N_ARC+1 points along the great-circle arc. Lerp in 3D and
        // normalise — gives a slight non-uniform parameterisation along the
        // arc, but visually identical to slerp at this subdivision count.
        let prev = projectOnto(pa.x, pa.y, pa.z);
        const firstPt = prev;
        for (let i = 1; i <= N_ARC; i++) {
          const t = i / N_ARC;
          const lx = pa.x * (1 - t) + pb.x * t;
          const ly = pa.y * (1 - t) + pb.y * t;
          const lz = pa.z * (1 - t) + pb.z * t;
          const p = projectOnto(lx, ly, lz);
          positions.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
          prev = p;
        }
        // For the stone-size heuristic we still want the straight chord
        // length between the two original endpoints.
        const dx = firstPt.x - prev.x, dy = firstPt.y - prev.y, dz = firstPt.z - prev.z;
        sumLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
        nEdges++;
      }
    }
    SD.avgEdge = nEdges > 0 ? sumLen / nEdges : SD.R * 0.15;
    const wireGeom = new THREE.BufferGeometry();
    wireGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x241a0e, transparent: true, opacity: 0.95,
    });
    SD.wireframeMesh = new THREE.LineSegments(wireGeom, wireMat);
    SD.scene.add(SD.wireframeMesh);

    // Hover ring — created lazily on first hover.
  }

  function eyePos() {
    return eyeFrom(SD.camYaw, SD.camPitch, SD.camDist);
  }

  function eyeFrom(yaw, pitch, dist) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    return { x: dist * cp * sy, y: dist * sp, z: dist * cp * cy };
  }

  // Compute the camera-distance range such that the sphere always fits
  // the current viewport (both axes). All values depend on viewport aspect
  // so portrait mobile gets a farther base than landscape desktop.
  function camDistBounds() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const tanHalf = Math.tan((SD.camFovDeg * Math.PI / 180) / 2);
    const minFit = SD.R / (tanHalf * Math.min(aspect, 1));
    return {
      base: minFit * 1.25,
      min:  minFit * 1.05,
      max:  minFit * 4.0,
    };
  }

  function clampCamDist() {
    const b = camDistBounds();
    if (SD.camDist < b.min) SD.camDist = b.min;
    if (SD.camDist > b.max) SD.camDist = b.max;
  }

  function updateCamera() {
    const eye = eyePos();

    // Build the camera's right + up basis (using world up = +Y).
    const fw = { x: -eye.x, y: -eye.y, z: -eye.z };
    const fm = Math.hypot(fw.x, fw.y, fw.z) || 1;
    fw.x /= fm; fw.y /= fm; fw.z /= fm;
    // right = forward × (0, 1, 0)
    let rx = -fw.z, ry = 0, rz = fw.x;
    const rm = Math.hypot(rx, ry, rz) || 1;
    rx /= rm; ry /= rm; rz /= rm;
    // up = right × forward
    const ux = ry * fw.z - rz * fw.y;
    const uy = rz * fw.x - rx * fw.z;
    const uz = rx * fw.y - ry * fw.x;

    const tanHalf = Math.tan((SD.camFovDeg * Math.PI / 180) / 2);
    const worldPerPx = 2 * SD.camDist * tanHalf / window.innerHeight;

    // Panel offset — shifts the sphere away from whichever side of the
    // screen the panel covers, so it's centred in the visible area.
    //   Desktop: panel is on the LEFT, width up to ~320px → shift RIGHT.
    //   Mobile : panel is at the BOTTOM, 30vh tall        → shift UP.
    const isMobile = window.innerWidth <= 600;
    const xOffsetPx = isMobile ? 0 : panelFootprintPx() / 2;
    const yOffsetPx = isMobile ? (window.innerHeight * 0.3) / 2 : 0;

    // To make the sphere appear offset in some +direction on screen, the
    // camera needs to translate in the opposite direction (so origin lies
    // off-axis). Negative scalars → camera shifts opposite of the intended
    // sphere-shift.
    const xShift = -xOffsetPx * worldPerPx; // sphere shift RIGHT
    const yShift = -yOffsetPx * worldPerPx; // sphere shift UP (camera down)

    const sx = rx * xShift + ux * yShift;
    const sy = ry * xShift + uy * yShift;
    const sz = rz * xShift + uz * yShift;

    SD.camera.position.set(eye.x + sx, eye.y + sy, eye.z + sz);
    SD.camera.lookAt(sx, sy, sz);

    // Lights — key from viewer, fill from antipode when 2 players
    SD.keyLight.position.set(eye.x, eye.y, eye.z);
    SD.keyLight.target.position.set(0, 0, 0);
    SD.keyLight.target.updateMatrixWorld();
    const ms = window.multiplayerState;
    const twoPlayer = ms && ms.active && (ms.memberCount || 0) >= 2;
    if (twoPlayer && SD.opponentEye) {
      const eo = eyeFrom(SD.opponentEye.yaw, SD.opponentEye.pitch, SD.opponentEye.dist);
      SD.fillLight.position.set(eo.x, eo.y, eo.z);
      SD.fillLight.visible = true;
    } else if (twoPlayer) {
      // Opponent in room but no camera update yet — mirror viewer for now.
      SD.fillLight.position.set(-eye.x, -eye.y, -eye.z);
      SD.fillLight.visible = true;
    } else {
      SD.fillLight.visible = false;
    }

    SD.fillLight.target.position.set(0, 0, 0);
    SD.fillLight.target.updateMatrixWorld();

  }

  function updateStones() {
    const stones = (typeof window.__sdGetGameStones === 'function')
      ? window.__sdGetGameStones() : null;
    if (!stones) return;

    const V = _meshVerts;
    const stoneRadius = SD.avgEdge * 0.35;
    const stoneSquash = 0.3;
    const lift = 1 + (stoneRadius / SD.R) * stoneSquash * 0.5;

    // Remove stones for verts no longer occupied
    for (const [vid, mesh] of SD.stoneMeshes) {
      if (!stones.has(vid)) {
        SD.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        SD.stoneMeshes.delete(vid);
      }
    }
    // Add/update stones. World position is simply p * R — the globe is at
    // world origin, and the panel-shift only moves the CAMERA, not the
    // world, so we don't add any offset here.
    const makeStoneMat = (color) => (color === 'black')
      ? new THREE.MeshPhongMaterial({ color: 0x121218, shininess: 18, specular: 0x2a2a30 })
      : new THREE.MeshPhongMaterial({ color: 0xf0f0ea, shininess: 20, specular: 0x9a9a95 });

    stones.forEach((color, vid) => {
      const p = V[vid];
      if (!p) return;
      let mesh = SD.stoneMeshes.get(vid);
      if (!mesh) {
        const geom = new THREE.SphereGeometry(stoneRadius, 20, 14);
        mesh = new THREE.Mesh(geom, makeStoneMat(color));
        mesh.userData.color = color;
        SD.scene.add(mesh);
        SD.stoneMeshes.set(vid, mesh);
      } else if (mesh.userData.color !== color) {
        mesh.material.dispose();
        mesh.material = makeStoneMat(color);
        mesh.userData.color = color;
      }
      mesh.position.set(p.x * SD.R * lift, p.y * SD.R * lift, p.z * SD.R * lift);
      const n = new THREE.Vector3(p.x, p.y, p.z);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      mesh.scale.set(1, stoneSquash, 1);
    });
  }

  function updateHoverRing() {
    const V = _meshVerts;
    if (SD.hoverVid === null || !V || !V[SD.hoverVid]) {
      if (SD.hoverRing) SD.hoverRing.visible = false;
      return;
    }
    const p = V[SD.hoverVid];
    if (!SD.hoverRing) {
      const inner = SD.avgEdge * 0.32;
      const outer = SD.avgEdge * 0.38;
      const geom = new THREE.RingGeometry(inner, outer, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x202838, side: THREE.DoubleSide,
        transparent: true, opacity: 0.9,
      });
      SD.hoverRing = new THREE.Mesh(geom, mat);
      SD.scene.add(SD.hoverRing);
    }
    const lift = 1.003;
    SD.hoverRing.position.set(
      p.x * SD.R * lift,
      p.y * SD.R * lift,
      p.z * SD.R * lift
    );
    const n = new THREE.Vector3(p.x, p.y, p.z);
    SD.hoverRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    SD.hoverRing.visible = true;

    const turn = (typeof window.__sdGetCurrentPlayer === 'function')
      ? window.__sdGetCurrentPlayer() : 'black';
    SD.hoverRing.material.color.setHex(turn === 'white' ? 0xf5f5f0 : 0x202838);
  }

  function animate() {
    if (!SD.active) return;
    SD.rafId = requestAnimationFrame(animate);
    updateCamera();
    updateStones();
    updateHoverRing();
    // Throttled opponent-camera sync: emit at most every 100 ms when
    // we're in a multiplayer room. No-op in single-player.
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    if (now - SD._lastCameraEmit > 100 &&
        typeof window.__sdEmitCamera === 'function' &&
        window.multiplayerState && window.multiplayerState.active) {
      window.__sdEmitCamera(SD.camYaw, SD.camPitch, SD.camDist);
      SD._lastCameraEmit = now;
    }
    SD.renderer.render(SD.scene, SD.camera);
  }

  // ==============================================================
  // Input
  // ==============================================================

  function onMouseDown(e) {
    if (!SD.active) return;
    SD.dragging = true;
    SD.lastMouse.x = e.clientX;
    SD.lastMouse.y = e.clientY;
    // Explicit click-to-select: the press position is what the user wants
    // selected. Without this the hover marker only follows the mouse cursor,
    // so a quick click that lands on a vertex without lingering over it
    // first wouldn't register, and the user would have to slow-drag onto
    // the vertex to "land" the hover before clicking.
    const vid = pickVertexFromPointer(e.clientX, e.clientY);
    console.log('[SD] mousedown → pickVertex returned vid =', vid);
    if (vid !== null) {
      SD.hoverVid = vid;
      if (typeof window.__sdSetHoverVertex === 'function') {
        window.__sdSetHoverVertex(vid);
      }
    }
  }

  function onMouseMove(e) {
    if (!SD.active) return;
    // ONLY clicking selects a vertex (see onMouseDown / onTouchEnd). Mouse
    // movement without a button held down does nothing — no hover-follow.
    // This matches the mobile tap-to-select flow exactly.
    if (!SD.dragging) return;
    const dx = e.clientX - SD.lastMouse.x;
    const dy = e.clientY - SD.lastMouse.y;
    SD.camYaw -= dx * 0.008;
    // Drag-down → camera tilts up (pitch increases) → we see more of the
    // top of the sphere. Conventional 3D-orbit direction.
    SD.camPitch += dy * 0.008;
    const limit = Math.PI / 2 - 0.05;
    if (SD.camPitch > limit) SD.camPitch = limit;
    if (SD.camPitch < -limit) SD.camPitch = -limit;
    SD.lastMouse.x = e.clientX;
    SD.lastMouse.y = e.clientY;
  }

  function onMouseUp() {
    SD.dragging = false;
  }

  function onWheel(e) {
    if (!SD.active) return;
    e.preventDefault();
    SD.camDist *= Math.exp(e.deltaY * 0.001);
    clampCamDist();
  }

  function onDoubleClick(e) {
    if (!SD.active) return;
    const vid = pickVertexFromPointer(e.clientX, e.clientY);
    console.log('[SD] dblclick → pickVertex returned vid =', vid);
    if (vid !== null && typeof window.__sdTryPlaceStone === 'function') {
      window.__sdTryPlaceStone(vid);
    }
  }

  function onResize() {
    if (!SD.sceneReady || !SD.active) return;
    SD.renderer.setSize(window.innerWidth, window.innerHeight);
    SD.camera.aspect = window.innerWidth / window.innerHeight;
    SD.camera.updateProjectionMatrix();
    // Aspect-dependent zoom range — re-clamp in case we were zoomed in
    // close on landscape and then rotated to portrait (sphere would
    // overflow horizontally without a re-clamp).
    clampCamDist();
  }

  // ---- Touch handlers ----
  // Tap vs. drag disambiguation for 3D mode:
  //   Single touch, no significant movement, released → TAP: pick the vertex
  //     under the finger and set it as hoverVertex. The floating mobile
  //     "Place Stone" button then confirms placement.
  //   Single touch that moves more than a threshold → DRAG: orbit the camera.
  //   Two touches → pinch zoom.
  // This differs from desktop (where double-click places directly) but
  // matches the existing 2D mobile flow of select-then-confirm.
  const TAP_MOVE_THRESHOLD_PX2 = 12 * 12;   // squared — beyond this = drag
  let _touchStart = null;                    // { x, y } — initial touch position
  let _pinchPrevDist = null;

  function onTouchStart(e) {
    if (!SD.active) return;
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      SD.dragging = false; // not a drag yet — upgraded if the finger moves
      _touchStart = { x: t.clientX, y: t.clientY };
      SD.lastMouse.x = t.clientX;
      SD.lastMouse.y = t.clientY;
    } else if (e.touches.length === 2) {
      SD.dragging = false;
      _touchStart = null;
      const a = e.touches[0], b = e.touches[1];
      _pinchPrevDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
  }

  function onTouchMove(e) {
    if (!SD.active) return;
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      if (!SD.dragging && _touchStart) {
        const dx0 = t.clientX - _touchStart.x;
        const dy0 = t.clientY - _touchStart.y;
        if (dx0 * dx0 + dy0 * dy0 > TAP_MOVE_THRESHOLD_PX2) {
          SD.dragging = true;
        }
      }
      if (SD.dragging) {
        const dx = t.clientX - SD.lastMouse.x;
        const dy = t.clientY - SD.lastMouse.y;
        SD.camYaw -= dx * 0.008;
        SD.camPitch += dy * 0.008;
        const limit = Math.PI / 2 - 0.05;
        if (SD.camPitch > limit) SD.camPitch = limit;
        if (SD.camPitch < -limit) SD.camPitch = -limit;
        SD.lastMouse.x = t.clientX;
        SD.lastMouse.y = t.clientY;
      }
    } else if (e.touches.length === 2 && _pinchPrevDist !== null) {
      const a = e.touches[0], b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = _pinchPrevDist / (d || 1);
      SD.camDist *= ratio;
      // Zoom clamp adapts to viewport aspect so the sphere always fits.
      clampCamDist();
      _pinchPrevDist = d;
    }
  }

  function onTouchEnd(e) {
    if (!SD.active) return;
    if (e.touches.length === 0) {
      // All fingers lifted. If this was a plain tap (no drag, no pinch),
      // pick the vertex under the start point and advertise it as the
      // hoverVertex — the floating Place Stone button will confirm.
      if (!SD.dragging && _touchStart) {
        const vid = pickVertexFromPointer(_touchStart.x, _touchStart.y);
        console.log('[SD] touch tap → pickVertex returned vid =', vid,
                    'at (', _touchStart.x, ',', _touchStart.y, ')');
        if (vid !== null) {
          SD.hoverVid = vid;
          if (typeof window.__sdSetHoverVertex === 'function') {
            window.__sdSetHoverVertex(vid);
          }
        }
      } else {
        console.log('[SD] touchend — no tap (dragging=', SD.dragging,
                    ', _touchStart=', _touchStart, ')');
      }
      SD.dragging = false;
      _touchStart = null;
      _pinchPrevDist = null;
    } else if (e.touches.length === 1) {
      _pinchPrevDist = null;
      const t = e.touches[0];
      _touchStart = { x: t.clientX, y: t.clientY };
      SD.dragging = false;
      SD.lastMouse.x = t.clientX;
      SD.lastMouse.y = t.clientY;
    }
  }

  // Raycaster-based vertex picking. Cast ray from mouse → sphere surface →
  // find nearest mesh vertex (max dot with hit direction relative to sphere
  // centre).
  function pickVertexFromPointer(clientX, clientY) {
    const V = _meshVerts;
    if (!V || V.length === 0 || !SD.globeMesh) return null;
    const rect = SD.canvas.getBoundingClientRect();
    const mx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: mx, y: my }, SD.camera);
    const hits = raycaster.intersectObject(SD.globeMesh);
    if (hits.length === 0) return null;
    const hit = hits[0].point;
    // Globe is at world origin; hit is already relative to sphere centre.
    const hm = Math.hypot(hit.x, hit.y, hit.z) || 1;
    const hu = { x: hit.x / hm, y: hit.y / hm, z: hit.z / hm };
    let best = -1, bestDot = 0.9;
    for (let i = 0; i < V.length; i++) {
      const p = V[i];
      const d = p.x * hu.x + p.y * hu.y + p.z * hu.z;
      if (d > bestDot) { bestDot = d; best = i; }
    }
    return best >= 0 ? best : null;
  }

  // ==============================================================
  // Lifecycle
  // ==============================================================

  // Called by multiplayer.js when the opponent broadcasts their orbit
  // state. We keep (yaw, pitch, dist) and use the derived world position
  // for the opponent's spotlight — so each player's spotlight actually
  // lights the hemisphere they're looking at.
  SD.onOpponentCamera = function (payload) {
    if (!payload) return;
    const y = typeof payload.yaw === 'number' ? payload.yaw : 0;
    const p = typeof payload.pitch === 'number' ? payload.pitch : 0;
    const d = typeof payload.dist === 'number' ? payload.dist : SD.camDist;
    SD.opponentEye = { yaw: y, pitch: p, dist: d };
  };

  // Multiplayer re-entry: the opponent's client receives the goban via
  // applyGameSnapshot, which writes pos3 onto the game's vertex array.
  // This hook pulls that pos3 data into the module-private mesh buffers
  // so the three.js pipeline can render it without regenerating.
  SD.useMeshFromGameState = function () {
    const V = (typeof window.__sdGetVertices === 'function')
      ? window.__sdGetVertices() : [];
    const Q = (typeof window.__sdGetQuads === 'function')
      ? window.__sdGetQuads() : [];
    _meshVerts = V.map((v) => (v && v.pos3)
      ? { x: v.pos3.x, y: v.pos3.y, z: v.pos3.z }
      : { x: 1, y: 0, z: 0 });
    _meshQuads = Q.filter((q) => q.active).map((q) => ({ verts: q.verts.slice() }));
  };

  // Move the mobile Place-Stone button out of #roomPanel (where it sits in
  // the HTML) and into <body> so it's in the root stacking context. Inside
  // the panel, its z-index is bounded by the panel's z-index (20), which
  // can make it render below the three.js canvas under some stacking-context
  // quirks. As a direct child of body, its z-index is absolute.
  function ensureConfirmButtonOnBody() {
    const btn = document.getElementById('mobileConfirmBtn');
    if (!btn) return null;
    if (btn.parentElement !== document.body) {
      document.body.appendChild(btn);
    }
    return btn;
  }

  SD.activate = function () {
    if (!initThreeScene()) return;
    buildSphereObjects();
    SD.active = true;
    SD.hoverVid = null;
    SD.camYaw = 0;
    SD.camPitch = 0.35;
    SD.camDist = camDistBounds().base;
    SD.opponentEye = null;
    ensureConfirmButtonOnBody();
    // Defensive: force the confirm button to show on mobile 3D no matter
    // what path (host start vs guest applyGameSnapshot) brought us here.
    if (window.innerWidth <= 600) {
      const btn = document.getElementById('mobileConfirmBtn');
      if (btn) btn.style.display = 'block';
    }
    SD.canvas.style.display = 'block';
    // Make sure size is fresh in case of a resize while hidden.
    SD.renderer.setSize(window.innerWidth, window.innerHeight);
    SD.camera.aspect = window.innerWidth / window.innerHeight;
    SD.camera.updateProjectionMatrix();
    if (SD.rafId) cancelAnimationFrame(SD.rafId);

    // Self-check diagnostic — auto-hides after 3s. Exposes the likely
    // failure modes (zero-size canvas, WebGL context loss, mesh missing)
    // so a mobile user can at least see WHAT'S wrong when the globe
    // doesn't appear.
    const rect = SD.canvas.getBoundingClientRect();
    const glOk = !!(SD.renderer && SD.renderer.getContext && SD.renderer.getContext());
    const diag =
      'SD active=' + SD.active +
      '\ncanvas=' + Math.round(rect.width) + 'x' + Math.round(rect.height) +
      ' at (' + Math.round(rect.left) + ',' + Math.round(rect.top) + ')' +
      '\nvp=' + window.innerWidth + 'x' + window.innerHeight +
      ' dpr=' + (window.devicePixelRatio || 1).toFixed(2) +
      '\nwebgl=' + (glOk ? 'ok' : 'FAILED') +
      '\nverts=' + (_meshVerts ? _meshVerts.length : 0) +
      ' quads=' + (_meshQuads ? _meshQuads.length : 0) +
      '\n(tap to dismiss)';
    showDiagnostic(diag, !glOk);
    setTimeout(() => {
      const el = document.getElementById('sdDiag');
      if (el) el.remove();
    }, 4500);

    animate();
  };

  SD.stop = function () {
    SD.active = false;
    SD.hoverVid = null;
    if (SD.rafId) { cancelAnimationFrame(SD.rafId); SD.rafId = null; }
    if (SD.canvas) SD.canvas.style.display = 'none';
  };
})();
