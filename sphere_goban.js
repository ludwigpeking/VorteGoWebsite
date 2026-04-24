// Spheric Goban — 3D test page.
// Mirrors the 2D pipeline in sketch.js:
//   1. Build a sphere of triangles (subdivided icosahedron).
//   2. Randomly remove edges between triangle pairs to form quads.
//   3. Quadrangulate: each remaining triangle -> 3 quads, each quad -> 4 quads.
//   4. Relaxation: van der Waals-style pair potential (edge & quad-diagonal
//      rest lengths), each step projected back to the unit sphere.

// ---- State ----
let vertices = []; // { id, pos: p5.Vector (unit sphere) }
let triangles = []; // { id, verts: [a,b,c], active }
let quads = []; // { id, verts: [a,b,c,d], active }
let edgesMap = null; // Map<key, {a, b, tris:[...]}> for topology lookup
let showVerts = true;
let relaxState = null; // cached pairs during a relax run

const SPHERE_R = 200; // render radius (internal positions are unit-normalized)

// ---- Icosphere construction ----
function buildIcosphere(level) {
  vertices = [];
  triangles = [];
  quads = [];

  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
    [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
    [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
  ];
  for (const [x, y, z] of raw) addVertexUnit(x, y, z);

  const baseFaces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  let faces = baseFaces.map((f) => f.slice());

  // Subdivide `level` times. Cache midpoints to dedupe across faces.
  for (let iter = 0; iter < level; iter++) {
    const midCache = new Map();
    const nextFaces = [];
    const midOf = (a, b) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      if (midCache.has(key)) return midCache.get(key);
      const va = vertices[a].pos, vb = vertices[b].pos;
      const id = addVertexUnit(va.x + vb.x, va.y + vb.y, va.z + vb.z);
      midCache.set(key, id);
      return id;
    };
    for (const [a, b, c] of faces) {
      const ab = midOf(a, b), bc = midOf(b, c), ca = midOf(c, a);
      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nextFaces;
  }

  for (let i = 0; i < faces.length; i++) {
    triangles.push({ id: i, verts: faces[i].slice(), active: true });
  }
  rebuildEdgeMap();
}

function addVertexUnit(x, y, z) {
  const m = Math.hypot(x, y, z);
  const pos = new p5.Vector(x / m, y / m, z / m);
  const id = vertices.length;
  vertices.push({ id, pos });
  return id;
}

// ν=3 geodesic subdivision of the icosahedron. Each face -> 9 sub-triangles
// via 6 edge-thirds (shared with adjacent faces) + 1 centroid (face-local).
// Final icosphere has 92 verts / 180 triangles → 362 verts post-quadrangulation,
// which sits roughly between level-1 (162) and level-2 (642).
function buildIcosphereFreq3() {
  vertices = [];
  triangles = [];
  quads = [];

  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
    [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
    [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
  ];
  for (const [x, y, z] of raw) addVertexUnit(x, y, z);

  const baseFaces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];

  // Edge-third cache. Canonical key is min-id first. Stored value is
  // [id_closer_to_minVert, id_closer_to_maxVert]. Lookup with (a, b) in any
  // order returns [closer_to_a, closer_to_b].
  const thirds = new Map();
  const getThirds = (a, b) => {
    const min = a < b ? a : b, max = a < b ? b : a;
    const key = min + '_' + max;
    let pair = thirds.get(key);
    if (!pair) {
      const vmin = vertices[min].pos, vmax = vertices[max].pos;
      const pNearMin = addVertexUnit(
        2 * vmin.x + vmax.x, 2 * vmin.y + vmax.y, 2 * vmin.z + vmax.z);
      const pNearMax = addVertexUnit(
        vmin.x + 2 * vmax.x, vmin.y + 2 * vmax.y, vmin.z + 2 * vmax.z);
      pair = [pNearMin, pNearMax];
      thirds.set(key, pair);
    }
    return a < b ? pair : [pair[1], pair[0]];
  };

  for (const [A, B, C] of baseFaces) {
    const [mAB1, mAB2] = getThirds(A, B); // mAB1 closer to A, mAB2 closer to B
    const [mBC1, mBC2] = getThirds(B, C);
    const [mCA1, mCA2] = getThirds(C, A);
    const va = vertices[A].pos, vb = vertices[B].pos, vc = vertices[C].pos;
    const ctr = addVertexUnit(va.x + vb.x + vc.x, va.y + vb.y + vc.y, va.z + vb.z + vc.z);

    // 6 up-tris + 3 down-tris = 9 sub-triangles covering the face.
    // Barycentric corners mapping:
    //   A = (3,0,0), B = (0,3,0), C = (0,0,3)
    //   mAB1 = (2,1,0), mAB2 = (1,2,0)
    //   mBC1 = (0,2,1), mBC2 = (0,1,2)
    //   mCA1 = (1,0,2), mCA2 = (2,0,1)
    //   ctr  = (1,1,1)
    const subTris = [
      // Up-tris (6): corners (i+1,j,k), (i,j+1,k), (i,j,k+1) for i+j+k=2
      [A, mAB1, mCA2], [mAB1, mAB2, ctr], [mCA2, ctr, mCA1],
      [mAB2, B, mBC1], [ctr, mBC1, mBC2], [mCA1, mBC2, C],
      // Down-tris (3): corners (i+1,j+1,k), (i,j+1,k+1), (i+1,j,k+1) for i+j+k=1
      [mAB1, ctr, mCA2], [mAB2, mBC1, ctr], [ctr, mBC2, mCA1],
    ];
    for (const st of subTris) {
      triangles.push({ id: triangles.length, verts: st, active: true });
    }
  }

  rebuildEdgeMap();
}

// ---- Topology ----
function edgeKey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }

function rebuildEdgeMap() {
  edgesMap = new Map();
  const addEdge = (a, b, faceKind, faceId) => {
    const k = edgeKey(a, b);
    let e = edgesMap.get(k);
    if (!e) { e = { a: Math.min(a, b), b: Math.max(a, b), faces: [] }; edgesMap.set(k, e); }
    e.faces.push({ kind: faceKind, id: faceId });
  };
  for (const t of triangles) if (t.active) {
    addEdge(t.verts[0], t.verts[1], 'tri', t.id);
    addEdge(t.verts[1], t.verts[2], 'tri', t.id);
    addEdge(t.verts[2], t.verts[0], 'tri', t.id);
  }
  for (const q of quads) if (q.active) {
    const v = q.verts;
    addEdge(v[0], v[1], 'quad', q.id);
    addEdge(v[1], v[2], 'quad', q.id);
    addEdge(v[2], v[3], 'quad', q.id);
    addEdge(v[3], v[0], 'quad', q.id);
  }
}

// ---- Step 2: merge adjacent triangle pairs into quads ----
// Find a (near-)perfect matching on the triangle face-adjacency graph. For the
// icosphere (3-regular, bridgeless) a perfect matching is guaranteed to exist
// by Petersen's theorem, so any leftover triangle after step 2 becomes a
// visible 3-valent "propeller" star after quadrangulation — we want zero.
//
// Strategy: run K trials of a min-degree greedy heuristic with randomized
// tie-breaking; keep the trial with the fewest leftovers. Min-degree alone
// gets close; random restarts finish it off.
function mergeTrianglesRandomly() {
  rebuildEdgeMap();

  // Fixed adjacency (pre-merge). All entries are symmetric and unchanging
  // across trials — we just copy into a mutable Map<id, Set> per trial.
  const fixedAdj = new Map();
  for (const t of triangles) if (t.active) fixedAdj.set(t.id, []);
  for (const e of edgesMap.values()) {
    const tris = e.faces.filter((f) => f.kind === 'tri');
    if (tris.length === 2) {
      fixedAdj.get(tris[0].id).push(tris[1].id);
      fixedAdj.get(tris[1].id).push(tris[0].id);
    }
  }

  const origActive = triangles.map((t) => t.active);
  const origQuadsLen = quads.length;
  const totalTris = fixedAdj.size;
  const maxMerges = Math.floor(totalTris / 2);

  let bestCount = -1;
  let bestActive = null;
  let bestNewQuads = null;
  const TRIALS = 50;

  for (let trial = 0; trial < TRIALS; trial++) {
    // Reset to pre-merge state.
    for (let i = 0; i < triangles.length; i++) triangles[i].active = origActive[i];
    quads.length = origQuadsLen;

    const adj = new Map();
    for (const [id, arr] of fixedAdj) adj.set(id, new Set(arr));

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
      const bestId = ties[(Math.random() * ties.length) | 0];
      const nbrArr = Array.from(adj.get(bestId));
      const partnerId = nbrArr[(Math.random() * nbrArr.length) | 0];

      const t1 = triangles[bestId], t2 = triangles[partnerId];
      const shared = t1.verts.filter((v) => t2.verts.includes(v));
      const c1 = t1.verts.find((v) => !shared.includes(v));
      const c2 = t2.verts.find((v) => !shared.includes(v));
      t1.active = false; t2.active = false;
      quads.push({ id: quads.length, verts: [c1, shared[0], c2, shared[1]], active: true });
      merged++;

      for (const n of adj.get(bestId))    adj.get(n)?.delete(bestId);
      for (const n of adj.get(partnerId)) adj.get(n)?.delete(partnerId);
      adj.delete(bestId);
      adj.delete(partnerId);
    }

    if (merged > bestCount) {
      bestCount = merged;
      bestActive = triangles.map((t) => t.active);
      bestNewQuads = quads.slice(origQuadsLen);
      if (merged === maxMerges) break; // perfect matching — stop early
    }
  }

  // Restore best trial.
  for (let i = 0; i < triangles.length; i++) triangles[i].active = bestActive[i];
  quads.length = origQuadsLen;
  for (const q of bestNewQuads) quads.push(q);

  rebuildEdgeMap();
  console.log(`[merge] ${bestCount}/${maxMerges} pairs matched, ${totalTris - 2 * bestCount} tris leftover`);
  return bestCount;
}

// ---- Step 3: quadrangulation (tri -> 3 quads, quad -> 4 quads) ----
function quadrangulate() {
  const midCache = new Map();
  const getMid = (a, b) => {
    const k = edgeKey(a, b);
    if (midCache.has(k)) return midCache.get(k);
    const va = vertices[a].pos, vb = vertices[b].pos;
    const id = addVertexUnit(va.x + vb.x, va.y + vb.y, va.z + vb.z);
    midCache.set(k, id);
    return id;
  };
  const getCenter = (verts) => {
    let x = 0, y = 0, z = 0;
    for (const vid of verts) { const p = vertices[vid].pos; x += p.x; y += p.y; z += p.z; }
    return addVertexUnit(x, y, z);
  };

  const newQuads = [];
  for (const t of triangles) {
    if (!t.active) continue;
    const [a, b, c] = t.verts;
    const mab = getMid(a, b), mbc = getMid(b, c), mca = getMid(c, a);
    const ctr = getCenter(t.verts);
    newQuads.push([a, mab, ctr, mca]);
    newQuads.push([b, mbc, ctr, mab]);
    newQuads.push([c, mca, ctr, mbc]);
    t.active = false;
  }
  for (const q of quads) {
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
  // Drop the (now all-inactive) originals and rebuild clean.
  triangles = [];
  quads = newQuads.map((v, i) => ({ id: i, verts: v, active: true }));
  rebuildEdgeMap();
}

// ---- Step 4: area-weighted centroid relaxation ----
// Mirrors sketch.js `relaxVertices` (line 1724). For each vertex, compute the
// area-weighted average of its incident quads' centroids and move the vertex
// a fraction `strength` toward it. Jacobi style: all new positions computed
// from the old snapshot, then applied. On the sphere we renormalize after
// each move so the vertex stays on the unit sphere.
//
// Why this works where Coulomb didn't: the rest length `L` in Coulomb is a
// single scalar target that can't simultaneously satisfy 162 different edge
// lengths on a sphere with mixed valence singularities. Area-weighted
// centroid smoothing has no such scalar target — each quad just wants to be
// "regular relative to itself", which is what the sphere geometry can
// actually accommodate.
function buildAdjacentFaces() {
  const N = vertices.length;
  const adjFaces = new Array(N);
  for (let i = 0; i < N; i++) adjFaces[i] = [];
  for (const q of quads) {
    if (!q.active) continue;
    for (const vid of q.verts) adjFaces[vid].push(q.id);
  }
  return adjFaces;
}

function computeQuadAreaAndCentroid3D(verts) {
  const a = vertices[verts[0]].pos;
  const b = vertices[verts[1]].pos;
  const c = vertices[verts[2]].pos;
  const d = vertices[verts[3]].pos;
  // Non-planar quads on a sphere: split into triangles ABC + ACD.
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const adx = d.x - a.x, ady = d.y - a.y, adz = d.z - a.z;
  const n1x = aby * acz - abz * acy;
  const n1y = abz * acx - abx * acz;
  const n1z = abx * acy - aby * acx;
  const n2x = acy * adz - acz * ady;
  const n2y = acz * adx - acx * adz;
  const n2z = acx * ady - acy * adx;
  const area = 0.5 * (Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z) +
                      Math.sqrt(n2x * n2x + n2y * n2y + n2z * n2z));
  return {
    area,
    cx: (a.x + b.x + c.x + d.x) * 0.25,
    cy: (a.y + b.y + c.y + d.y) * 0.25,
    cz: (a.z + b.z + c.z + d.z) * 0.25,
  };
}

function relaxSphereOnce(ctx) {
  const { adjFaces, strength, ids, compK, minTarget } = ctx;

  // (1) Per-vertex graph degree (count of incident edges in current topology).
  //     This is what drives the degree-deficit compensation: a valence-3
  //     vertex in a quad mesh is "crowded" (ideal valence is 4), so quads
  //     touching it should settle larger; a valence-5/6 vertex is "starved"
  //     and its quads should settle smaller.
  const N = vertices.length;
  const degree = new Array(N).fill(0);
  for (const e of edgesMap.values()) { degree[e.a]++; degree[e.b]++; }

  // (2) Per-quad area, centroid, and targetMultiplier = max(minTarget,
  //     1 + compK · Σ(4 − degree_of_corner)). Same formula as 2D
  //     relaxVerticesCompensated.
  const quadData = new Array(quads.length);
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i];
    if (!q.active) { quadData[i] = null; continue; }
    const qd = computeQuadAreaAndCentroid3D(q.verts);
    let deficit = 0;
    for (const vid of q.verts) deficit += (4 - (degree[vid] || 0));
    qd.targetMultiplier = Math.max(minTarget, 1 + compK * deficit);
    quadData[i] = qd;
  }

  // (3) Per-vertex target = (area / targetMultiplier)-weighted centroid avg.
  //     Dividing by targetMultiplier reduces the pull from quads that WANT to
  //     be bigger (low-degree corners) so they naturally grow, and amplifies
  //     the pull from quads that want to be smaller (high-degree corners).
  const targets = new Array(ids.length);
  for (let idx = 0; idx < ids.length; idx++) {
    const vid = ids[idx];
    const faces = adjFaces[vid];
    if (faces.length === 0) { targets[idx] = null; continue; }
    let wx = 0, wy = 0, wz = 0, totalW = 0;
    for (const fid of faces) {
      const qd = quadData[fid];
      if (!qd || qd.area <= 0) continue;
      const weight = qd.area / qd.targetMultiplier;
      wx += qd.cx * weight;
      wy += qd.cy * weight;
      wz += qd.cz * weight;
      totalW += weight;
    }
    targets[idx] = totalW > 0
      ? { x: wx / totalW, y: wy / totalW, z: wz / totalW }
      : null;
  }

  // (4) Apply and renormalize onto the unit sphere. Radial component of the
  //     displacement is cancelled by the renormalize step.
  for (let idx = 0; idx < ids.length; idx++) {
    const t = targets[idx];
    if (!t) continue;
    const v = vertices[ids[idx]].pos;
    v.x += (t.x - v.x) * strength;
    v.y += (t.y - v.y) * strength;
    v.z += (t.z - v.z) * strength;
    const m = Math.hypot(v.x, v.y, v.z);
    if (m > 0) { v.x /= m; v.y /= m; v.z /= m; }
  }
}

function makeRelaxContext() {
  return {
    adjFaces: buildAdjacentFaces(),
    strength: 0.2,   // fraction of the displacement applied per iteration
    compK: 0.18,     // deficit compensation strength (matches 2D)
    minTarget: 0.4,  // floor on targetMultiplier, prevents collapse
    ids: vertices.map((v) => v.id),
  };
}

function relaxSphereBlocking(iterations) {
  const ctx = makeRelaxContext();
  for (let it = 0; it < iterations; it++) relaxSphereOnce(ctx);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---- UI / p5 ----
let cam;
let relaxAnim = null; // { ctx, remaining } while animating

function startRelaxAnim(frames) {
  relaxAnim = { ctx: makeRelaxContext(), remaining: frames };
}

function setup() {
  const cv = createCanvas(windowWidth, windowHeight, WEBGL);
  cv.parent(document.body);
  cam = createCamera();
  cam.setPosition(0, 0, 700);
  cam.lookAt(0, 0, 0);

  document.getElementById('btnReset').onclick = () => { relaxAnim = null; doReset(); };
  document.getElementById('btnMerge').onclick = () => { relaxAnim = null; mergeTrianglesRandomly(); updateInfo(); };
  document.getElementById('btnQuad').onclick = () => { relaxAnim = null; quadrangulate(); updateInfo(); };
  document.getElementById('btnRelax').onclick = () => { startRelaxAnim(2000); };
  document.getElementById('btnAllInOne').onclick = () => {
    relaxAnim = null;
    doReset();
    mergeTrianglesRandomly();
    quadrangulate();
    updateInfo();
    startRelaxAnim(3000);
  };
  document.getElementById('btnToggleVerts').onclick = () => { showVerts = !showVerts; };

  doReset();
}

function doReset() {
  const raw = document.getElementById('levelSel').value;
  if (raw === '1.5') {
    buildIcosphereFreq3();
  } else {
    buildIcosphere(parseInt(raw, 10));
  }
  updateInfo();
}

function updateInfo() {
  document.getElementById('vCount').textContent = vertices.length;
  document.getElementById('tCount').textContent = triangles.filter((t) => t.active).length;
  document.getElementById('qCount').textContent = quads.filter((q) => q.active).length;
  rebuildEdgeMap();
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (const e of edgesMap.values()) {
    const d = p5.Vector.dist(vertices[e.a].pos, vertices[e.b].pos);
    if (d < min) min = d;
    if (d > max) max = d;
    sum += d; n++;
  }
  const fmt = (x) => (isFinite(x) ? x.toFixed(3) : '-');
  document.getElementById('eMin').textContent = fmt(min);
  document.getElementById('eMean').textContent = fmt(n > 0 ? sum / n : NaN);
  document.getElementById('eMax').textContent = fmt(max);
}

function draw() {
  // Advance relaxation animation: do a few Gauss-Seidel iterations per frame
  // so the user can watch the mesh tidy up while still being able to orbit.
  if (relaxAnim && relaxAnim.remaining > 0) {
    const stepsPerFrame = 15; // iters per frame — small maxStep needs many sweeps
    const n = Math.min(stepsPerFrame, relaxAnim.remaining);
    for (let i = 0; i < n; i++) relaxSphereOnce(relaxAnim.ctx);
    relaxAnim.remaining -= n;
    if (relaxAnim.remaining <= 0) relaxAnim = null;
    updateInfo();
  }

  background(26);
  ambientLight(50);
  directionalLight(255, 255, 255, 0.5, 0.5, -1);
  orbitControl(2, 2, 0.1);

  // Faint inner sphere as a visual backdrop.
  push();
  noStroke();
  fill(40, 45, 55);
  sphere(SPHERE_R * 0.985, 32, 32);
  pop();

  // Draw every active edge once (from the edge map, so shared edges aren't doubled).
  strokeWeight(1.2);
  for (const e of edgesMap.values()) {
    const hasTri = e.faces.some((f) => f.kind === 'tri');
    stroke(hasTri ? color(120, 200, 255) : color(240, 220, 120));
    const a = vertices[e.a].pos, b = vertices[e.b].pos;
    line(a.x * SPHERE_R, a.y * SPHERE_R, a.z * SPHERE_R,
         b.x * SPHERE_R, b.y * SPHERE_R, b.z * SPHERE_R);
  }

  // Vertices.
  if (showVerts) {
    noStroke();
    fill(255, 255, 255);
    for (const v of vertices) {
      push();
      translate(v.pos.x * SPHERE_R, v.pos.y * SPHERE_R, v.pos.z * SPHERE_R);
      sphere(2.6, 6, 6);
      pop();
    }
  }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }
