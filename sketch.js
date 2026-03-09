// Hexagonal Goban editor using p5.js
// Modes: move-vertex (default), delete-edge, select (view only)

const spacing = 50;
let hexRadius = 10; // yields 9 vertices per edge (can be changed for random generation)
// sqrt3 is defined in common.js

let vertices = []; // {id,x,y,type,q,r,neighbors:Set,triangles:Set,quads:Set,peers:number[]}
let edges = [];    // {id,a,b,mid:{x,y},active:true}
let edgeByKey = new Map(); // key "a,b" sorted -> edge id
let edgeTris = new Map();  // key "a,b" -> triangle ids touching
let triangles = []; // {id,verts:[...],active:true}
let quads = [];     // {id,verts:[...],active:true}

let hoverVertex = null;
let hoverEdge = null;
let dragging = null;
let mode = 'move-vertex';
let currentScreen = 'room-menu'; // room-menu, preset, random, editor, play

// Go game state
let gameStones = new Map(); // vid -> 'black' or 'white'
let stoneOrder = new Map(); // vid -> move order (1-indexed)
let currentPlayer = 'black'; // whose turn
let capturedBlack = 0;
let capturedWhite = 0;
let previousBoardState = null; // For Ko rule - stores the board state after the last move
let showStoneIndices = false; // Toggle stone indices display
let lastMoveWasPass = false; // Track if previous move was a pass
let gameEnded = false; // True when both players pass consecutively
let deadStones = new Set(); // Set of vertex IDs marked as dead
let markingDeadStones = false; // True when in dead stone marking mode

let relaxing = false;
let relaxFrame = 0;
let relaxMaxFrames = 20;
let relaxationStrength = spacing * 0.0008; // Scale relative to grid spacing (50 * 0.0008 = 0.04)
let whi = null; // whitehole image
let bhi = null; // blackhole image
let woodTexture = null; // wood texture for goban border
let coverImage = null; // cover image for menu background

let autoRemoving = false;
let autoRemoveIterations = 0;
let autoRemoveMaxIterations = 1000;
let autoRemoveRetries = 0;
let autoRemoveMaxRetries = 50;
let autoRemoveStartSnapshot = null;
let saveLoadStatusEl = null;
let komi = 7.5; // current game komi

let canvasCreated = false;
// Keep canvas sized to the viewport
function ensureCanvas() {
  const w = windowWidth;
  const h = windowHeight;
  if (!canvasCreated) {
    const c = createCanvas(w, h);
    c.parent('app');
    canvasCreated = true;
  } else {
    resizeCanvas(w, h);
  }
}

// Helper: safely set display on an element
function setDisplay(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.display = value;
}

// Preset gobans data - will be loaded from files
const presetGobans = {};

function preload() {
  whi = loadImage('images/whitehole.png');
  bhi = loadImage('images/blackhole.png');
  woodTexture = loadImage('images/wood_texture.png');
  coverImage = loadImage('images/coverImagePlaceholder.png');
}

// Undo/Redo stacks - separated by mode
let gobanUndoStack = [];  // For goban editing (vertices, edges, faces)
let gobanUndoIndex = -1;

let gameUndoStack = [];   // For stone placement/captures in play mode
let gameUndoIndex = -1;

// dirAxial is defined in common.js

function setup() {
  // Don't create canvas yet - wait for room menu selection
  noLoop();
  setupMenuListeners();
}

function setupMenuListeners() {
  // Room menu
  document.getElementById('menuRandomGoban')?.addEventListener('click', startRandomGoban);
  document.getElementById('menuPresetGoban')?.addEventListener('click', showPresetMenu);
  document.getElementById('menuDesignGoban')?.addEventListener('click', startDesignMode);
  document.getElementById('menuLoadGoban')?.addEventListener('click', startLoadGoban);
  document.getElementById('menuSettings')?.addEventListener('click', showSettings);
  
  // Preset menu
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => loadPresetGoban(e.target.dataset.preset));
  });
  document.getElementById('backToMenuFromPreset')?.addEventListener('click', showMainMenu);
  
  // Random menu
  document.getElementById('regenerateBtn')?.addEventListener('click', generateRandomGoban);
  document.getElementById('acceptRandomBtn')?.addEventListener('click', acceptRandomGoban);
  
  // Editor buttons
  document.getElementById('backToMenuBtn')?.addEventListener('click', showMainMenu);
}

// Switch visible section inside the single room panel
function showPanelSection(section) {
  // section: 'roomMenu' | 'random' | 'edit' | 'play'
  setDisplay('sectionRoomMenu', section === 'roomMenu' ? 'block' : 'none');
  setDisplay('sectionRandom',   section === 'random'   ? 'block' : 'none');
  setDisplay('sectionEdit',     section === 'edit'     ? 'block' : 'none');
  setDisplay('sectionPlay',     section === 'play'     ? 'block' : 'none');
  setDisplay('backToMenuBtn',   section !== 'roomMenu' ? 'block' : 'none');
}

// Show the game rules dialog before starting a multiplayer game.
// If not in a room or not the owner, calls startFn immediately with current defaults.
function showRulesDialog(startFn) {
  if (!window.multiplayerState?.active || !window.multiplayerState?.isOwner) {
    startFn({ komi, colorMode: 'owner-black' });
    return;
  }
  const modal = document.getElementById('gameRulesModal');
  if (!modal) { startFn({ komi, colorMode: 'owner-black' }); return; }

  // Pre-fill with current komi
  const komiInput = document.getElementById('komiInput');
  if (komiInput) komiInput.value = komi;

  modal.style.display = 'flex';

  const close = () => { modal.style.display = 'none'; };
  document.getElementById('gameRulesClose').onclick = close;

  document.getElementById('gameRulesConfirm').onclick = () => {
    const k = parseFloat(komiInput ? komiInput.value : 7.5);
    const colorMode = document.getElementById('colorModeSelect').value;
    komi = isNaN(k) ? 7.5 : Math.round(k * 2) / 2; // snap to 0.5
    close();
    // Update komi label
    const komiDisplay = document.getElementById('komiDisplay');
    if (komiDisplay) komiDisplay.textContent = komi;
    // Send rules to room
    if (window.multiplayerSendRules) window.multiplayerSendRules({ komi, colorMode });
    startFn({ komi, colorMode });
  };
}

function showMainMenu() {
  document.getElementById('presetMenu').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  const placeholder = document.getElementById('roomPlaceholder');
  if (placeholder) placeholder.style.display = 'flex';
  showPanelSection('roomMenu');
  currentScreen = 'room-menu';
  
  // Clear play mode and stones when returning to menu
  if (mode === 'play') {
    mode = 'move-vertex';
    gameStones.clear();
    currentPlayer = 'black';
    capturedBlack = 0;
    capturedWhite = 0;
  }
  
  noLoop();
}

function showPresetMenu() {
  document.getElementById('presetMenu').style.display = 'block';
  document.getElementById('app').style.display = 'none';
  showPanelSection('roomMenu');
  currentScreen = 'preset';
}

function startRandomGoban() {
  document.getElementById('presetMenu').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  const placeholder = document.getElementById('roomPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  showPanelSection('random');
  currentScreen = 'random';

  ensureCanvas();

  generateRandomGoban();
}

function generateRandomGoban() {
  hexRadius = 10; // Use standard size (9 vertices per edge)
  buildGrid();
  
  document.getElementById('randomStatus').textContent = 'Generating goban...';
  document.getElementById('regenerateBtn').style.display = 'none';
  document.getElementById('acceptRandomBtn').style.display = 'none';
  
  // Apply quadrangulation
  setTimeout(() => {
    applyGuaranteedQuadrangulation();
    
    // Start relaxation for 30 steps
    relaxMaxFrames = 30;
    relaxing = true;
    relaxFrame = 0;
    loop();
    
    // After relaxation completes, show buttons
    setTimeout(() => {
      document.getElementById('randomStatus').textContent = 'Goban generated!';
      document.getElementById('regenerateBtn').style.display = 'inline-block';
      document.getElementById('acceptRandomBtn').style.display = 'inline-block';
    }, 30 * 50); // Approximate time for 30 frames
  }, 100);
}

function acceptRandomGoban() {
  showRulesDialog(() => {
    mode = 'play';
    gameStones.clear();
    currentPlayer = 'black';
    capturedBlack = 0;
    capturedWhite = 0;
    initGameHistory();
    updateGameUI();
    showPanelSection('play');
    currentScreen = 'play';
    setupPlayButtons();
    redraw();
    if (window.multiplayerSyncState) window.multiplayerSyncState();
  });
}

function startDesignMode() {
  document.getElementById('app').style.display = 'block';
  document.getElementById('presetMenu').style.display = 'none';
  const placeholder = document.getElementById('roomPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  showPanelSection('edit');
  currentScreen = 'editor';

  ensureCanvas();

  hexRadius = 10;
  buildGrid();
  captureState('initial');
  updateUiCounts();
  setupEditorButtons();
  redraw();
}

function loadPresetGoban(presetName) {
  document.getElementById('presetMenu').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  const placeholder = document.getElementById('roomPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  currentScreen = 'play';

  ensureCanvas();

  // Map preset names to their JSON files
  const presetFiles = {
    'shumi': 'gobans/Shumi.json',
    'shumi_large': 'gobans/Shumi_Large.json',
    'kimon': 'gobans/Kimon.json',
    'jingan': 'gobans/Jin-gan_relaxed.json',
    'yugen': 'gobans/Yuken_relaxed.json',
    'hoshikage': 'gobans/Hoshikage_relaxed.json',
    'hoshikuzu': 'gobans/Hoshikuzu_relaxed.json',
    'enten': 'gobans/Enten_relaxed.json',
  };

  const filePath = presetFiles[presetName];
  if (!filePath) {
    alert(`Preset "${presetName}" not found`);
    showMainMenu();
    return;
  }

  // Load the goban from JSON file
  fetch(filePath)
    .then(response => {
      if (!response.ok) throw new Error(`Failed to load ${filePath}`);
      return response.json();
    })
    .then(data => {
      restoreGoban(data);
      // Center and fit the loaded goban to canvas
      centerAndFitGoban();
      // Show rules dialog then start play mode
      showRulesDialog(() => {
        mode = 'play';
        gameStones.clear();
        currentPlayer = 'black';
        capturedBlack = 0;
        capturedWhite = 0;
        initGameHistory();
        showPanelSection('play');
        setupPlayButtons();
        updateGameUI();
        redraw();
        if (window.multiplayerSyncState) window.multiplayerSyncState();
      });
    })
    .catch(err => {
      alert(`Error loading preset: ${err.message}`);
      showMainMenu();
    });
}

function showSettings() {
  // Settings screen - placeholder for now
  alert('Settings - coming soon');
}

function changeGobanSize(newRadius) {
  hexRadius = newRadius;
  buildGrid();
  captureState('initial');
  updateUiCounts();
  redraw();
}

function relaxForFrames(frames) {
  // Perform relaxation synchronously
  for (let i = 0; i < frames; i++) {
    relaxVertices(1);
  }
}

function setupEditorButtons() {
  // Wire up mode buttons
  const moveModeBtn = document.getElementById('moveModeBtn');
  const deleteEdgeModeBtn = document.getElementById('deleteEdgeModeBtn');
  const selectModeBtn = document.getElementById('selectModeBtn');
  
  if (moveModeBtn) moveModeBtn.addEventListener('click', () => {
    mode = 'move-vertex';
    updateUiMode();
    redraw();
  });
  
  if (deleteEdgeModeBtn) deleteEdgeModeBtn.addEventListener('click', () => {
    mode = 'delete-edge';
    updateUiMode();
    redraw();
  });
  
  if (selectModeBtn) selectModeBtn.addEventListener('click', () => {
    mode = 'select';
    updateUiMode();
    redraw();
  });
  
  // Wire up size buttons
  const sizeBtn6 = document.getElementById('sizeBtn6');
  const sizeBtn8 = document.getElementById('sizeBtn8');
  const sizeBtn10 = document.getElementById('sizeBtn10');
  
  if (sizeBtn6) sizeBtn6.addEventListener('click', () => changeGobanSize(6));
  if (sizeBtn8) sizeBtn8.addEventListener('click', () => changeGobanSize(8));
  if (sizeBtn10) sizeBtn10.addEventListener('click', () => changeGobanSize(10));
  
  // Wire up the relax button
  const relaxBtn = document.getElementById('relaxBtn');
  if (relaxBtn) {
    relaxBtn.addEventListener('click', startRelaxation);
  }
  
  // Wire up undo/redo buttons
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.addEventListener('click', undoStep);
  if (redoBtn) redoBtn.addEventListener('click', redoStep);
  
  // Wire up auto remove button
  const autoRemoveBtn = document.getElementById('autoRemoveBtn');
  if (autoRemoveBtn) {
    autoRemoveBtn.addEventListener('click', startAutoRemoveEdges);
  }

  saveLoadStatusEl = document.getElementById('saveLoadStatus');

  // Wire up save/load buttons
  const saveBtn = document.getElementById('saveBtn');
  const loadBtn = document.getElementById('loadBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveGoban);
  if (loadBtn) loadBtn.addEventListener('click', loadGoban);
  
  // Wire up play mode button
  const playBtn = document.getElementById('playBtn');
  if (playBtn) playBtn.addEventListener('click', togglePlayMode);
  
  updateUndoUI();
}

function setupPlayButtons() {
  const undoBtn = document.getElementById('gameUndoBtn');
  const redoBtn = document.getElementById('gameRedoBtn');
  const saveGameBtn = document.getElementById('saveGameBtn');
  const loadGameBtn = document.getElementById('loadGameBtn');
  const toggleIndicesBtn = document.getElementById('toggleIndicesBtn');
  const scoreBtn = document.getElementById('scoreBtn');
  const passBtn = document.getElementById('passBtn');
  const aiMoveBtn = document.getElementById('aiMoveBtn');
  const finishMarkingBtn = document.getElementById('finishMarkingBtn');

  if (undoBtn) undoBtn.onclick = undoStep;
  if (redoBtn) redoBtn.onclick = redoStep;
  if (saveGameBtn) saveGameBtn.onclick = saveGame;
  if (loadGameBtn) {
    saveLoadStatusEl = document.getElementById('gameLoadStatus');
    loadGameBtn.onclick = loadGame;
  }
  if (toggleIndicesBtn) {
    toggleIndicesBtn.onclick = () => {
      showStoneIndices = !showStoneIndices;
      toggleIndicesBtn.textContent = showStoneIndices ? 'Hide Stone Indices' : 'Show Stone Indices';
      redraw();
    };
  }
  if (passBtn) {
    passBtn.onclick = () => handlePass(false);
  }
  if (aiMoveBtn) {
    aiMoveBtn.onclick = async () => {
      if (hexGoAI.thinking || gameEnded) return;
      const move = await hexGoAI.makeMove(2000); // Increased to 2000 iterations
      if (move === 'pass') {
        handlePass(false);
      } else {
        placeStone(move);
      }
    };
    if (window.multiplayerState?.active) {
      aiMoveBtn.disabled = true;
      aiMoveBtn.textContent = 'AI Move (offline)';
    }
  }
  if (finishMarkingBtn) {
    finishMarkingBtn.onclick = finishMarkingDeadStones;
  }
  if (scoreBtn) {
    scoreBtn.onclick = () => {
      const score = computeTrompTaylorScore();
      renderScore(score);
    };
  }

  updateUndoUI();
}

function saveGame() {
  const data = {
    version: 1,
    type: 'game',
    timestamp: new Date().toISOString(),
    hexRadius,
    spacing,
    // Goban structure
    vertices: vertices.map((v) => ({
      id: v.id,
      x: v.x,
      y: v.y,
      type: v.type,
      q: v.q ?? 0,
      r: v.r ?? 0,
      peers: v.peers ?? [v.id, v.id, v.id],
    })),
    quads: quads.filter((q) => q.active).map((q) => ({ verts: [...q.verts] })),
    // Game state
    gameStones: Array.from(gameStones.entries()), // Convert Map to array
    stoneOrder: Array.from(stoneOrder.entries()), // Convert Map to array
    currentPlayer: currentPlayer,
    capturedBlack: capturedBlack,
    capturedWhite: capturedWhite,
    previousBoardState: previousBoardState ? Array.from(previousBoardState.entries()) : null,
    // Move history
    gameUndoStack: gameUndoStack.map((snapshot) => ({
      label: snapshot.label,
      stones: Array.from(snapshot.stones.entries()),
      stoneOrder: Array.from(snapshot.stoneOrder.entries()),
      currentPlayer: snapshot.currentPlayer,
      capturedBlack: snapshot.capturedBlack,
      capturedWhite: snapshot.capturedWhite,
      previousBoardState: snapshot.previousBoardState ? Array.from(snapshot.previousBoardState.entries()) : null,
    })),
    gameUndoIndex: gameUndoIndex,
  };

  const fname = `game_${Date.now()}.json`;
  saveJSON(data, fname);
  if (saveLoadStatusEl) saveLoadStatusEl.textContent = `Saved ${fname}`;
}

function loadGame() {
  const picker = createFileInput(handleFile, false);
  picker.elt.accept = 'application/json';
  picker.elt.click();

  function handleFile(file) {
    if (file?.type === 'application' && file.subtype === 'json') {
      const data = file.data || file.string;
      try {
        const json = typeof data === 'string' ? JSON.parse(data) : data;
        if (json.type === 'game') {
          // Restore goban first
          restoreGoban(json);
          // Then restore game state and history
          restoreGameFromData(json);
          // Switch to play mode
          mode = 'play';
          currentScreen = 'play';
          showPanelSection('play');
          setupPlayButtons();
          updateGameUI();
          redraw();
          if (window.multiplayerSyncState) window.multiplayerSyncState();
          if (saveLoadStatusEl) saveLoadStatusEl.textContent = 'Game loaded';
        } else {
          if (saveLoadStatusEl) saveLoadStatusEl.textContent = 'Not a game file';
        }
      } catch (e) {
        console.error('Failed to load game', e);
        if (saveLoadStatusEl) saveLoadStatusEl.textContent = 'Load failed';
      }
    }
    picker.remove();
  }
}

function restoreGameFromData(data) {
  // Restore game state
  gameStones = new Map(data.gameStones);
  stoneOrder = new Map(data.stoneOrder || []);
  currentPlayer = data.currentPlayer;
  capturedBlack = data.capturedBlack;
  capturedWhite = data.capturedWhite;
  previousBoardState = data.previousBoardState ? new Map(data.previousBoardState) : null;

  // Restore game history
  gameUndoStack = data.gameUndoStack.map((snapshot) => ({
    type: 'game',
    label: snapshot.label,
    stones: new Map(snapshot.stones),
    stoneOrder: new Map(snapshot.stoneOrder || []),
    currentPlayer: snapshot.currentPlayer,
    capturedBlack: snapshot.capturedBlack,
    capturedWhite: snapshot.capturedWhite,
    previousBoardState: snapshot.previousBoardState ? new Map(snapshot.previousBoardState) : null,
  }));
  gameUndoIndex = data.gameUndoIndex;
}

function windowResized() {
  if (canvasCreated) {
    const oldCX = width / 2;
    const oldCY = height / 2;
    ensureCanvas();
    const dx = width / 2 - oldCX;
    const dy = height / 2 - oldCY;
    if ((dx !== 0 || dy !== 0) && vertices.length > 0) {
      for (const v of vertices) {
        v.x += dx;
        v.y += dy;
      }
    }
    redraw();
  }
}

function draw() {
  clear();
  drawGobanBorder();
  drawSectors();
  drawFaces();
  drawEdges();
  drawVertices();
  drawSymbols();
  if (mode === 'play') {
    drawStones();
    drawStonePreview();
  }
  
  if (relaxing) {
    relaxFrame++;
    updateRelaxStatus();
    if (relaxFrame < relaxMaxFrames) {
      relaxVertices(1); // single iteration per frame
    } else {
      relaxing = false;
      relaxFrame = 0;
      updateRelaxStatus();
      updateUiCounts();
      noLoop();
    }
  }
  
  if (autoRemoving) {
    autoRemoveIterations++;
    const deleted = autoRemoveEdgesStep();
    const triCount = triangles.filter((t) => t.active).length;
    
    // Check if we're done (no more edges deleted in this pass)
    if (deleted === 0) {
      // One pass done, check if we got full quads
      if (triCount === 0) {
        // Success! Full quads achieved
        autoRemoving = false;
        autoRemoveStartSnapshot = null;
        updateAutoRemoveStatus();
        updateUiCounts();
        noLoop();
      } else if (autoRemoveRetries < autoRemoveMaxRetries) {
        // Failed, retry with different random shuffle
        autoRemoveRetries++;
        autoRemoveIterations = 0;
        restoreSnapshot(autoRemoveStartSnapshot);
        updateAutoRemoveStatus();
      } else {
        // Max retries exceeded, revert completely
        autoRemoving = false;
        alert(`Failed to achieve full quads after ${autoRemoveMaxRetries} attempts. Reverting.`);
        restoreSnapshot(autoRemoveStartSnapshot);
        autoRemoveStartSnapshot = null;
        updateAutoRemoveStatus();
        updateUiCounts();
        noLoop();
      }
    }
    updateAutoRemoveStatus();
    redraw();
  }
}

// ---- Grid construction ----
function buildGrid() {
  vertices = [];
  edges = [];
  edgeByKey.clear();
  edgeTris.clear();
  triangles = [];
  quads = [];

  const coordToId = new Map();
  let vid = 0;
  for (let q = -hexRadius; q <= hexRadius; q++) {
    for (let r = -hexRadius; r <= hexRadius; r++) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > hexRadius) continue;
      const pos = axialToPixel(q, r);
      let type;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) === hexRadius) {
        type = 'edge';
      } else {
        type = 'inner';
      }
      vertices.push({
        id: vid,
        q, r,
        x: pos.x,
        y: pos.y,
        type,
        neighbors: new Set(),
        triangles: new Set(),
        quads: new Set(),
        peers: [],
      });
      coordToId.set(keyCoord(q, r), vid);
      vid++;
    }
  }

  // Neighbors and edges
  for (const v of vertices) {
    for (const d of dirAxial) {
      const nq = v.q + d[0];
      const nr = v.r + d[1];
      const nid = coordToId.get(keyCoord(nq, nr));
      if (nid !== undefined) {
        v.neighbors.add(nid);
        if (v.id < nid) addEdge(v.id, nid);
      }
    }
  }

  // Triangles
  let tid = 0;
  for (const v of vertices) {
    for (let i = 0; i < 6; i++) {
      const n1 = neighborId(v, coordToId, dirAxial[i]);
      const n2 = neighborId(v, coordToId, dirAxial[(i + 1) % 6]);
      if (n1 === null || n2 === null) continue;
      if (v.id < n1 && v.id < n2) {
        const triId = tid++;
        const verts = [v.id, n1, n2];
        triangles.push({ id: triId, verts, active: true });
        verts.forEach((id) => vertices[id].triangles.add(triId));
        addEdgeTriangle(verts[0], verts[1], triId);
        addEdgeTriangle(verts[1], verts[2], triId);
        addEdgeTriangle(verts[2], verts[0], triId);
      }
    }
  }

  // Sector peers (triplets rotated by 120 and 240 degrees)
  for (const v of vertices) {
    const rot1 = rotateAxial120(v.q, v.r);
    const rot2 = rotateAxial240(v.q, v.r);
    const id1 = coordToId.get(keyCoord(rot1.q, rot1.r));
    const id2 = coordToId.get(keyCoord(rot2.q, rot2.r));
    v.peers = [v.id, id1 ?? v.id, id2 ?? v.id];
  }

  updateUiMode();
}

function addEdge(a, b) {
  const id = edges.length;
  const pa = vertices[a];
  const pb = vertices[b];
  const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  edges.push({ id, a, b, mid, active: true });
  edgeByKey.set(edgeKey(a, b), id);
}

function addEdgeTriangle(a, b, triId) {
  const k = edgeKey(a, b);
  if (!edgeTris.has(k)) edgeTris.set(k, []);
  edgeTris.get(k).push(triId);
}

function neighborId(v, coordToId, delta) {
  const nq = v.q + delta[0];
  const nr = v.r + delta[1];
  const nid = coordToId.get(keyCoord(nq, nr));
  return nid === undefined ? null : nid;
}

// ---- Geometry helpers ----
function axialToPixel(q, r) {
  const sqrt3 = Math.sqrt(3);
  const x = spacing * q + spacing / 2 * r + width / 2;
  const y = spacing * sqrt3 / 2 * r + height / 2;
  return { x, y };
}

function rotateAxial120(q, r) {
  // 120-degree rotation in axial (pointy-top) coordinates
  return { q: -q - r, r: q };
}

function rotateAxial240(q, r) {
  // 240-degree rotation (two steps of 120)
  return { q: r, r: -q - r };
}

function rotateVec(x, y, deg) {
  const rad = deg * Math.PI / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c - y * s, y: x * s + y * c };
}

function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function keyCoord(q, r) {
  return `${q},${r}`;
}

// ---- Interaction ----
function mouseMoved() {
  updateHover();
}

function mousePressed() {
  if (mode === 'delete-edge' && hoverEdge !== null) {
    deleteEdgeMirrored(hoverEdge);
    redraw();
    return;
  }
  if (mode === 'play' && hoverVertex !== null) {
    // Compute move permission inline so it's always based on live state,
    // not a potentially-stale canMove flag that depends on event timing.
    if (window.multiplayerState?.active) {
      const ms = window.multiplayerState;
      const isSpectator = (ms.role || '').toLowerCase() === 'spectator';
      const hasOpponent = (ms.memberCount || 0) >= 2;
      let allowed;
      if (isSpectator) {
        allowed = false;
      } else if (ms.color === 'study') {
        allowed = true;                         // study: both move freely
      } else if (!ms.color) {
        allowed = !hasOpponent;                 // no color yet: free if solo
      } else {
        // Enforce turn order: player can only click on their own turn.
        // currentPlayer is the live JS variable, always up-to-date.
        allowed = !hasOpponent || ms.color === currentPlayer;
      }
      console.log('[MP click] color:', ms.color, 'currentPlayer:', currentPlayer, 'memberCount:', ms.memberCount, 'hasOpponent:', hasOpponent, 'allowed:', allowed);
      if (!allowed) return;
    }
    if (markingDeadStones) {
      toggleDeadStone(hoverVertex);
    } else {
      placeStone(hoverVertex);
    }
    redraw();
    return;
  }
  if (mode === 'move-vertex' && hoverVertex !== null) {
    const v = vertices[hoverVertex];
    if (v.type === 'edge' || v.type === 'center') return;
    dragging = hoverVertex;
  }
}

function mouseDragged() {
  if (dragging === null) return;
  const dx = movedX;
  const dy = movedY;
  moveVertexMirrored(dragging, dx, dy);
  redraw();
}

function mouseReleased() {
  if (dragging !== null) {
    window.dragStateCapture = false;
  }
  dragging = null;
}

function handlePass(isRemote = false) {
  if (gameEnded || markingDeadStones) return;
  
  if (lastMoveWasPass) {
    // Two consecutive passes - game ends
    gameEnded = true;
    markingDeadStones = true;
    document.getElementById('gameStatusRow').style.display = 'block';
    document.getElementById('gameStatus').textContent = 'Game ended. Mark dead stones.';
    document.getElementById('deadStoneRow').style.display = 'block';
    console.log('Game ended - both players passed. Mark dead stones.');
  } else {
    lastMoveWasPass = true;
    currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
    updateGameUI();
    console.log(`${currentPlayer === 'white' ? 'Black' : 'White'} passed.`);
  }
  if (!isRemote && window.multiplayerSendPass) {
    window.multiplayerSendPass();
  }
}

function toggleDeadStone(vid) {
  if (!gameStones.has(vid)) return;
  
  const group = getGroup(vid);
  const allDead = Array.from(group).every(v => deadStones.has(v));
  
  if (allDead) {
    // Unmark as dead
    for (const v of group) {
      deadStones.delete(v);
    }
  } else {
    // Mark as dead
    for (const v of group) {
      deadStones.add(v);
    }
  }
  
  redraw();
}

function finishMarkingDeadStones() {
  markingDeadStones = false;
  document.getElementById('deadStoneRow').style.display = 'none';
  document.getElementById('gameStatusRow').style.display = 'none';
  
  // Automatically compute and display final score
  const score = computeTrompTaylorScore();
  renderScore(score);
  redraw();
}

function keyPressed() {
  if (key === 'v' || key === 'V') mode = 'move-vertex';
  if (key === 'e' || key === 'E') mode = 'delete-edge';
  if (key === 's' || key === 'S') mode = 'select';
  if (key === 'p' || key === 'P') togglePlayMode();
  if (key === 'r' || key === 'R') startRelaxation();
  if ((key === 'z' || key === 'Z') && keyIsDown(CONTROL)) {
    if (keyIsDown(SHIFT)) redoStep();
    else undoStep();
  }
  updateUiMode();
  redraw();
}

function updateHover() {
  hoverVertex = pickVertex(mouseX, mouseY);
  hoverEdge = mode === 'delete-edge' ? pickEdge(mouseX, mouseY) : null;
  updateUiHover();
  redraw();
}

function pickVertex(mx, my) {
  const radius = 9;
  for (const v of vertices) {
    const d2 = (v.x - mx) ** 2 + (v.y - my) ** 2;
    if (d2 < radius * radius) return v.id;
  }
  return null;
}

function pickEdge(mx, my) {
  const thresh = 10;
  for (const e of edges) {
    if (!e.active) continue;
    const tris = edgeTris.get(edgeKey(e.a, e.b)) || [];
    const activeTris = tris.filter((t) => triangles[t]?.active);
    if (activeTris.length !== 2) continue; // only deletable when merging into quad
    const d = dist(mx, my, e.mid.x, e.mid.y);
    if (d < thresh) return e.id;
  }
  return null;
}

// ---- Editing operations ----
function moveVertexMirrored(vid, dx, dy) {
  // Capture state only on first frame of drag
  if (!window.dragStateCapture) {
    captureState('vertex-move');
    window.dragStateCapture = true;
  }
  const base = vertices[vid];
  if (base.type === 'edge' || base.type === 'center') return;
  const peers = base.peers;
  for (let i = 0; i < peers.length; i++) {
    const pid = peers[i];
    if (pid === undefined || pid === null) continue;
    const v = vertices[pid];
    if (!v) continue;
    let delta = { x: dx, y: dy };
    if (i === 1) delta = rotateVec(dx, dy, 120);
    if (i === 2) delta = rotateVec(dx, dy, 240);
    v.x += delta.x;
    v.y += delta.y;
  }
  refreshEdgeMidpoints(base.peers);
}

function refreshEdgeMidpoints(peerIds) {
  const touched = new Set();
  for (const pid of peerIds) {
    const v = vertices[pid];
    if (!v) continue;
    for (const nid of v.neighbors) {
      const eId = edgeByKey.get(edgeKey(pid, nid));
      if (eId === undefined) continue;
      touched.add(eId);
    }
  }
  for (const eId of touched) {
    const e = edges[eId];
    const a = vertices[e.a];
    const b = vertices[e.b];
    e.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

function deleteEdgeMirrored(edgeId) {
  captureState('edge-delete');
  const e = edges[edgeId];
  if (!e?.active) return;
  const peersA = vertices[e.a].peers;
  const peersB = vertices[e.b].peers;
  const toDelete = new Set();
  for (let i = 0; i < 3; i++) {
    const a = peersA[i];
    const b = peersB[i];
    if (a === undefined || b === undefined) continue;
    const k = edgeKey(a, b);
    const pid = edgeByKey.get(k);
    if (pid !== undefined) toDelete.add(pid);
  }
  for (const id of toDelete) deleteEdgeSingle(id);
  updateUiCounts();
}

function deleteEdgeSingle(edgeId) {
  const edge = edges[edgeId];
  if (!edge?.active) return;
  const k = edgeKey(edge.a, edge.b);
  const tris = (edgeTris.get(k) || []).filter((t) => triangles[t]?.active);
  if (tris.length !== 2) return;
  const [t0, t1] = tris.map((tid) => triangles[tid]);
  const other0 = t0.verts.find((v) => v !== edge.a && v !== edge.b);
  const other1 = t1.verts.find((v) => v !== edge.a && v !== edge.b);
  edge.active = false;
  deactivateTriangle(t0.id);
  deactivateTriangle(t1.id);
  vertices[edge.a].neighbors.delete(edge.b);
  vertices[edge.b].neighbors.delete(edge.a);
  const vIds = [edge.a, other0, edge.b, other1];
  const ordered = orderPolygon(vIds);
  const qid = quads.length;
  quads.push({ id: qid, verts: ordered, active: true });
  ordered.forEach((vid) => vertices[vid].quads.add(qid));
}

function deactivateTriangle(tid) {
  const tri = triangles[tid];
  if (!tri?.active) return;
  tri.active = false;
  tri.verts.forEach((vid) => vertices[vid].triangles.delete(tid));
}

function orderPolygon(ids) {
  const pts = ids.map((id) => ({ id, x: vertices[id].x, y: vertices[id].y }));
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  return pts.map((p) => p.id);
}

// ---- Rendering ----
function drawSectors() {
  // Sector lines removed - they're not needed for the goban
}

function drawGobanBorder() {
  // Draw hexagonal goban border using wood texture
  // Offset outward from edge vertices by spacing/2
  if (!woodTexture) return;
  
  // Find the 6 corner points of the hexagon using all visible vertices
  const cornerPoints = findHexCorners(vertices);
  if (cornerPoints.length < 6) return;
  
  // Calculate offset outward from center
  const offset = spacing / 2;
  // Derive the actual board center from the corner vertices themselves,
  // so the outward direction stays correct even after window resize.
  const centerX = cornerPoints.reduce((s, v) => s + v.x, 0) / cornerPoints.length;
  const centerY = cornerPoints.reduce((s, v) => s + v.y, 0) / cornerPoints.length;
  
  // Create inner and outer corner points
  const corners = cornerPoints.map(v => {
    const dx = v.x - centerX;
    const dy = v.y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist === 0) {
      return { innerX: v.x, innerY: v.y, outerX: v.x, outerY: v.y };
    }
    
    // Normalize direction
    const normX = dx / dist;
    const normY = dy / dist;
    
    return {
      innerX: v.x,
      innerY: v.y,
      outerX: v.x + normX * offset,
      outerY: v.y + normY * offset
    };
  });
  
  // Draw the wood texture as background
  push();
  noStroke();
  
  // Tile the wood texture at 100% scale
  const textureW = woodTexture.width;
  const textureH = woodTexture.height;
  for (let x = -textureW; x < width + textureW; x += textureW) {
    for (let y = -textureH; y < height + textureH; y += textureH) {
      image(woodTexture, x, y);
    }
  }
  
  // Draw the inner hexagon with background color to mask the playing area
  fill(0);
  beginShape();
  vertex(width, height);
  vertex(width, 0);
  vertex(0, 0);
  vertex(0, height);
  vertex(width, height);
  corners.forEach(c => vertex(c.outerX, c.outerY));
  vertex(corners[0].outerX, corners[0].outerY); // close loop
  endShape(CLOSE);
  
  pop();
}

function findHexCorners(edgeVertices) {
  // Find the 6 true corner points of the hexagon purely geometrically
  const centerX = width / 2;
  const centerY = height / 2;
  const allVerts = vertices.filter(v => v.visible !== false);
  
  const angles = [0, 60, 120, 180, 240, 300];
  const corners = [];
  
  for (const angle of angles) {
    const rad = angle * Math.PI / 180;
    const dirX = Math.cos(rad);
    const dirY = Math.sin(rad);
    
    let bestVertex = null;
    let maxProjection = -Infinity;
    
    for (const v of allVerts) {
      const dx = v.x - centerX;
      const dy = v.y - centerY;
      const projection = dx * dirX + dy * dirY;
      
      if (projection > maxProjection) {
        maxProjection = projection;
        bestVertex = v;
      }
    }
    
    if (bestVertex) {
      corners.push(bestVertex);
    }
  }
  
  return corners;
}

function getCanvasCornerBetween(p1, p2) {
  // Check if a canvas corner should be added between two outer points
  const corners = [
    { x: -1, y: -1 },
    { x: width + 1, y: -1 },
    { x: width + 1, y: height + 1 },
    { x: -1, y: height + 1 }
  ];
  
  for (const corner of corners) {
    // Check if corner is on the "outside" between p1 and p2
    const angle1 = Math.atan2(p1.y - height / 2, p1.x - width / 2);
    const angle2 = Math.atan2(p2.y - height / 2, p2.x - width / 2);
    const cornerAngle = Math.atan2(corner.y - height / 2, corner.x - width / 2);
    
    let angleBetween = false;
    if (angle1 < angle2) {
      angleBetween = cornerAngle > angle1 && cornerAngle < angle2;
    } else {
      angleBetween = cornerAngle > angle1 || cornerAngle < angle2;
    }
    
    if (angleBetween) {
      return corner;
    }
  }
  return null;
}

function drawFaces() {
  noStroke();
  // Quads - no fill, just part of the goban
  noFill();
  for (const q of quads) {
    if (!q.active) continue;
    beginShape();
    q.verts.forEach((vid) => vertex(vertices[vid].x, vertices[vid].y));
    endShape(CLOSE);
  }
  // Triangles - no fill, just part of the goban
  noFill();
  for (const t of triangles) {
    if (!t.active) continue;
    beginShape();
    t.verts.forEach((vid) => vertex(vertices[vid].x, vertices[vid].y));
    endShape(CLOSE);
  }
}

function drawEdges() {
  strokeWeight(2);
  for (const e of edges) {
    if (!e.active) continue;
    const tris = edgeTris.get(edgeKey(e.a, e.b)) || [];
    const activeTris = tris.filter((t) => triangles[t]?.active);
    const deletable = activeTris.length === 2;
    const isHover = hoverEdge === e.id;
    if (isHover) {
      stroke(255, 210, 120);
    } else if (mode === 'delete-edge' && deletable) {
      stroke(180, 140, 90, 220);
    } else {
      stroke(80, 80, 80, 180);
    }
    const a = vertices[e.a];
    const b = vertices[e.b];
    line(a.x, a.y, b.x, b.y);
    if (mode === 'delete-edge' && deletable) {
      noStroke();
      fill(isHover ? 255 : 220, 180, 100, isHover ? 240 : 160);
      circle(e.mid.x, e.mid.y, isHover ? 12 : 9);
    }
  }
}

function drawVertices() {
  // Skip drawing vertex circles in play mode
  if (mode === 'play') return;
  
  noStroke();
  for (const v of vertices) {
    if (v.visible === false) continue; // hide unused vertices
    // Show only center vertex and edge vertices, not normal inner vertices
    if (v.type === 'inner' && !(v.q === 0 && v.r === 0)) continue;
    let c;
    if (v.type === 'edge') c = color(120, 190, 255);
    else if (v.q === 0 && v.r === 0) {
      // Center vertex - color by edge count
      const edgeCount = v.neighbors.size;
      if (edgeCount === 6 || edgeCount === 5) c = color(255, 255, 255); // white
      else if (edgeCount === 3) c = color(0, 0, 0); // black
      else c = color(150, 150, 150); // default grey
    } else {
      continue; // skip other inner vertices
    }
    const isHover = hoverVertex === v.id;
    if (isHover) c = color(255, 230, 120);
    fill(c);
    circle(v.x, v.y, 7);
  }
}

// ---- UI wiring ----
function updateUiMode() {
  const el = document.getElementById('mode');
  if (el) el.textContent = mode;
  updateGameUI();
}

function updateUiHover() {
  const el = document.getElementById('hover');
  if (!el) return;
  if (hoverVertex !== null) {
    const v = vertices[hoverVertex];
    if (mode === 'play' && gameStones.has(hoverVertex)) {
      const color = gameStones.get(hoverVertex);
      const liberties = getGroupLiberties(hoverVertex);
      el.textContent = `${color} stone at ${v.id} | liberties: ${liberties}${liberties === 1 ? ' (ATARI!)' : ''}`;
    } else {
      el.textContent = `vertex ${v.id} (${v.type})`;
    }
  } else if (hoverEdge !== null) {
    const e = edges[hoverEdge];
    el.textContent = `edge ${e.a}-${e.b}`;
  } else {
    el.textContent = 'none';
  }
}

function updateUiCounts() {
  const triCount = triangles.filter((t) => t.active).length;
  const quadCount = quads.filter((q) => q.active).length;
  const vertexCount = vertices.filter((v) => v.visible !== false).length;
  const tEl = document.getElementById('triCount');
  const qEl = document.getElementById('quadCount');
  const vEl = document.getElementById('vertexCount');
  if (tEl) tEl.textContent = triCount;
  if (qEl) qEl.textContent = quadCount;
  if (vEl) vEl.textContent = vertexCount;
}

// ---- Relaxation algorithm ----
function startRelaxation() {
  const triCount = triangles.filter((t) => t.active).length;
  if (triCount > 0) {
    alert('Relaxation only available when all faces are quads (no triangles).');
    return;
  }
  captureState('relaxation');
  relaxing = true;
  relaxFrame = 0;
  updateRelaxStatus();
  loop(); // kick off the draw loop so relaxation animates without waiting for mouse movement
}

function updateRelaxStatus() {
  const statusEl = document.getElementById('relaxStatus');
  const btnEl = document.getElementById('relaxBtn');
  if (relaxing) {
    if (statusEl) statusEl.textContent = `Relaxing: ${relaxFrame}/${relaxMaxFrames}`;
    if (btnEl) btnEl.disabled = true;
  } else {
    if (statusEl) statusEl.textContent = '';
    if (btnEl) btnEl.disabled = false;
  }
}

function relaxVertices(iterations) {
  for (let it = 0; it < iterations; it++) {
    // Precalculate face areas once per iteration
    for (const q of quads) {
      if (!q.active) continue;
      q.area = calculateQuadArea(q);
    }

    // Build vertex->adjacent faces map
    const adjFaces = new Map();
    for (const v of vertices) {
      adjFaces.set(v.id, []);
    }
    for (const q of quads) {
      if (!q.active) continue;
      for (const vid of q.verts) {
        adjFaces.get(vid).push(q);
      }
    }

    // Relax ALL vertices based on their own adjacent face centroids
    const adjustments = new Map();
    for (const v of vertices) {
      if (v.type === 'edge') continue;

      const faces = adjFaces.get(v.id) || [];
      if (faces.length === 0) continue;

      // Calculate area-weighted centroid
      let weightedX = 0, weightedY = 0, totalWeight = 0;
      for (const face of faces) {
        const centroid = getFaceCentroid(face);
        const weight = face.area || 1;
        weightedX += centroid.x * weight;
        weightedY += centroid.y * weight;
        totalWeight += weight;
      }

      if (totalWeight > 0) {
        adjustments.set(v.id, {
          x: weightedX / totalWeight,
          y: weightedY / totalWeight,
        });
      }
    }

    // Apply adjustments with strength factor to all vertices
    adjustments.forEach((centroid, vid) => {
      const v = vertices[vid];
      v.x += (centroid.x - v.x) * relaxationStrength;
      v.y += (centroid.y - v.y) * relaxationStrength;
    });

    refreshAllEdgeMidpoints();
  }
}

function calculateQuadArea(quad) {
  // Shoelace formula for polygon area
  let area = 0;
  const n = quad.verts.length;
  for (let i = 0; i < n; i++) {
    const v1 = vertices[quad.verts[i]];
    const v2 = vertices[quad.verts[(i + 1) % n]];
    area += v1.x * v2.y - v2.x * v1.y;
  }
  return Math.abs(area) / 2;
}

function getFaceCentroid(face) {
  let sumX = 0, sumY = 0;
  for (const vid of face.verts) {
    const v = vertices[vid];
    sumX += v.x;
    sumY += v.y;
  }
  return { x: sumX / face.verts.length, y: sumY / face.verts.length };
}

function refreshAllEdgeMidpoints() {
  for (const e of edges) {
    if (!e.active) continue;
    const a = vertices[e.a];
    const b = vertices[e.b];
    e.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

function rebuildEdgesFromFaces() {
  // Clear existing edge structures
  edges = [];
  edgeByKey.clear();
  edgeTris.clear();
  
  // Update vertex neighbors
  vertices.forEach(v => v.neighbors.clear());
  
  // Rebuild edges from active quads
  for (const quad of quads) {
    if (!quad.active) continue;
    
    for (let i = 0; i < quad.verts.length; i++) {
      const v1 = quad.verts[i];
      const v2 = quad.verts[(i + 1) % quad.verts.length];
      
      // Add neighbor relationship
      vertices[v1].neighbors.add(v2);
      vertices[v2].neighbors.add(v1);
      
      // Add edge if not exists
      const key = edgeKey(v1, v2);
      if (!edgeByKey.has(key)) {
        const edgeId = edges.length;
        const mid = {
          x: (vertices[v1].x + vertices[v2].x) / 2,
          y: (vertices[v1].y + vertices[v2].y) / 2
        };
        edges.push({ id: edgeId, a: v1, b: v2, mid, active: true });
        edgeByKey.set(key, edgeId);
      }
    }
  }
}

// ---- Symbol rendering ----
function drawSymbols() {
  for (const v of vertices) {
    if (v.type !== 'inner') continue; // Only on inner vertices
    const edgeCount = v.neighbors.size;

    if (edgeCount === 6 || edgeCount === 5) {
      // White hole
      if (whi) {
        push();
        imageMode(CENTER);
        image(whi, v.x, v.y, edgeCount*15, edgeCount*15);
        pop();
      } else {
        fill(255);
        stroke(200);
        strokeWeight(2);
        circle(v.x, v.y, 12);
      }
    } else if (edgeCount === 3) {
      // Black hole
      if (bhi) {
        push();
        imageMode(CENTER);
        image(bhi, v.x, v.y, edgeCount*15, edgeCount*15);
        pop();
      } else {
        fill(20);
        stroke(100);
        strokeWeight(2);
        circle(v.x, v.y, 12);
      }
    }
  }
}

// ---- Go Game Mode ----
function togglePlayMode() {
  if (mode === 'play') {
    mode = 'move-vertex';
    showPanelSection('edit');
    updateUiMode();
    updateGameUI();
    redraw();
  } else {
    showRulesDialog(() => {
      mode = 'play';
      gameStones.clear();
      currentPlayer = 'black';
      capturedBlack = 0;
      capturedWhite = 0;
      initGameHistory();
      showPanelSection('play');
      setupPlayButtons();
      updateUiMode();
      updateGameUI();
      redraw();
    });
  }
}

// Initialize game history with a baseline snapshot (empty board)
function initGameHistory() {
  stoneOrder.clear(); // Reset stone order tracking
  previousBoardState = null; // Reset Ko state
  lastMoveWasPass = false; // Reset pass tracking
  gameEnded = false; // Reset game ended flag
  deadStones.clear(); // Reset dead stones
  markingDeadStones = false; // Reset marking mode
  
  // Hide game status UI elements
  const gameStatusRow = document.getElementById('gameStatusRow');
  const deadStoneRow = document.getElementById('deadStoneRow');
  const resultRow = document.getElementById('resultRow');
  if (gameStatusRow) gameStatusRow.style.display = 'none';
  if (deadStoneRow) deadStoneRow.style.display = 'none';
  if (resultRow) resultRow.style.display = 'none';
  
  const snapshot = captureGameState('start');
  gameUndoStack = [snapshot];
  gameUndoIndex = 0;
  updateUndoUI();
  if (window.multiplayerSyncState) window.multiplayerSyncState();
}

function drawStones() {
  for (const [vid, color] of gameStones) {
    const v = vertices[vid];
    if (!v || v.visible === false) continue;
    
    const liberties = getGroupLiberties(vid);
    const isAtari = liberties === 1;
    
    // Draw atari warning ring
    if (isAtari) {
      noFill();
      stroke(255, 80, 80);
      strokeWeight(3);
      circle(v.x, v.y, 38);
    }
    
    // Draw stone
    noStroke();
    const isDead = deadStones.has(vid);
    
    if (color === 'black') {
      if (isDead) {
        fill(20, 20, 25, 100); // Faded for dead stones
      } else {
        fill(20, 20, 25);
      }
      circle(v.x, v.y, spacing*0.65);
      // Shine effect
      fill(80, 80, 90, isDead ? 60 : 120);
      circle(v.x - 4, v.y - 4, spacing*0.25);
    } else {
      if (isDead) {
        fill(250, 250, 245, 100); // Faded for dead stones
      } else {
        fill(250, 250, 245);
      }
      circle(v.x, v.y, spacing*0.65);
      // Shadow effect
      fill(200, 200, 195, isDead ? 40 : 80);
      circle(v.x + 3, v.y + 3, spacing*0.25);
    }
    
    // Draw X on dead stones
    if (isDead) {
      stroke(255, 100, 100);
      strokeWeight(3);
      const size = 10;
      line(v.x - size, v.y - size, v.x + size, v.y + size);
      line(v.x + size, v.y - size, v.x - size, v.y + size);
      noStroke();
    }
    
    // Show stone index (move order) if enabled
    if (showStoneIndices && !isDead) {
      const order = stoneOrder.get(vid);
      if (order !== undefined) {
        textAlign(CENTER, CENTER);
        textSize(14);
        if (color === 'black') {
          fill(255, 255, 255); // White text on black stone
        } else {
          fill(20, 20, 25); // Black text on white stone
        }
        text(order, v.x, v.y);
      }
    }
    
    // Show liberties (chi) on hover
    if (hoverVertex === vid) {
      fill(255, 200, 80);
      noStroke();
      textAlign(CENTER, CENTER);
      textSize(12);
      text(liberties, v.x, v.y - 20);
    }
  }
}

function drawStonePreview() {
  // Draw a preview stone following the mouse cursor
  if (hoverVertex !== null && !gameStones.has(hoverVertex)) {
    const v = vertices[hoverVertex];
    if (v && v.visible !== false) {
      push();
      noStroke();
      
      if (currentPlayer === 'black') {
        fill(20, 20, 25, 150);
        circle(v.x, v.y, spacing*0.65);
        fill(80, 80, 90, 80);
        circle(v.x - 4, v.y - 4, spacing*0.25);
      } else {
        fill(250, 250, 245, 150);
        circle(v.x, v.y, spacing*0.65);
        fill(200, 200, 195, 60);
        circle(v.x + 3, v.y + 3, spacing*0.25);
      }
      
      pop();
    }
  }
  
  // Also draw a ghost stone at mouse cursor
  push();
  noStroke();
  if (currentPlayer === 'black') {
    fill(20, 20, 25, 80);
  } else {
    fill(250, 250, 245, 80);
  }
  circle(mouseX, mouseY, spacing*0.5);
  pop();
}

// Helper: capture game state for undo/redo in play mode
function captureGameState(moveDescription) {
  const snapshot = {
    type: 'game',
    label: moveDescription,
    stones: new Map(gameStones), // Copy of stone placements
    stoneOrder: new Map(stoneOrder), // Copy of move order
    currentPlayer: currentPlayer,
    capturedBlack: capturedBlack,
    capturedWhite: capturedWhite,
    previousBoardState: previousBoardState ? new Map(previousBoardState) : null,
  };
  return snapshot;
}

function restoreGameState(snapshot) {
  if (snapshot.type !== 'game') return;
  gameStones = new Map(snapshot.stones);
  stoneOrder = new Map(snapshot.stoneOrder || []);
  currentPlayer = snapshot.currentPlayer;
  capturedBlack = snapshot.capturedBlack;
  capturedWhite = snapshot.capturedWhite;
  previousBoardState = snapshot.previousBoardState ? new Map(snapshot.previousBoardState) : null;
  updateGameUI();
  redraw();
}

function placeStone(vid, options = {}) {
  // Can't place on occupied vertex
  if (gameStones.has(vid)) return;
  
  // Can't place on invisible vertices
  const v = vertices[vid];
  if (v.visible === false) return;
  
  const moveColor = currentPlayer;
  const opponent = currentPlayer === 'black' ? 'white' : 'black';
  
  // Save board state BEFORE this move for Ko detection on the next move
  const boardBeforeThisMove = new Map(gameStones);
  
  // Tentatively place the stone to test validity
  gameStones.set(vid, currentPlayer);
  
  // Find which opponent groups would be captured
  const neighbors = Array.from(v.neighbors);
  const capturedGroups = [];
  
  for (const nid of neighbors) {
    if (gameStones.get(nid) === opponent) {
      const liberties = getGroupLiberties(nid);
      if (liberties === 0) {
        // This group would be captured
        const group = getGroup(nid);
        capturedGroups.push(group);
      }
    }
  }
  
  // Remove captured groups temporarily to check our own liberties
  const tempCaptured = [];
  for (const group of capturedGroups) {
    for (const gvid of group) {
      tempCaptured.push(gvid);
      gameStones.delete(gvid);
    }
  }
  
  // Check if our own move is suicide (no liberties after captures)
  const ourLiberties = getGroupLiberties(vid);
  
  if (ourLiberties === 0) {
    // Suicide move - not allowed, revert everything
    gameStones.delete(vid);
    // Restore captured stones
    for (const gvid of tempCaptured) {
      gameStones.set(gvid, opponent);
    }
    // Show warning in console instead of blocking alert
    console.warn('❌ Suicide move not allowed!');
    return;
  }
  
  // Check Ko rule: would this move recreate the previous board position?
  console.log('Ko check:', {
    hasPrevious: !!previousBoardState,
    currentSize: gameStones.size,
    previousSize: previousBoardState?.size,
    isEqual: previousBoardState ? boardStatesEqual(gameStones, previousBoardState) : false
  });
  
  if (previousBoardState && boardStatesEqual(gameStones, previousBoardState)) {
    // Ko violation - revert everything
    gameStones.delete(vid);
    // Restore captured stones
    for (const gvid of tempCaptured) {
      gameStones.set(gvid, opponent);
    }
    console.warn('❌ Ko rule violation! Cannot immediately recapture.');
    return;
  }
  
  // Valid move - make captures permanent
  for (const gvid of tempCaptured) {
    if (opponent === 'black') capturedBlack++;
    else capturedWhite++;
  }
  
  // Save the board state from BEFORE this move for Ko detection
  // (so next move can't recreate this pre-move state)
  previousBoardState = boardBeforeThisMove;
  
  // Record move order (count existing stones + 1)
  const moveOrder = gameStones.size;
  stoneOrder.set(vid, moveOrder);
  
  // Reset pass tracking since a stone was played
  lastMoveWasPass = false;
  
  // Switch player (the next player to move)
  currentPlayer = opponent;
  
  // Valid move - capture to game history with correct next-to-move turn
  const moveDesc = moveColor === 'black' ? '⚫' : '⚪';
  captureGameMove(moveDesc);
  
  updateGameUI();
  if (!options.remote && window.multiplayerSendMove) {
    window.multiplayerSendMove(vid, moveColor);
  }
}

function getGroup(vid) {
  // BFS to find all connected stones of same color
  const color = gameStones.get(vid);
  if (!color) return new Set();
  
  const group = new Set([vid]);
  const queue = [vid];
  
  while (queue.length > 0) {
    const curr = queue.shift();
    const v = vertices[curr];
    
    for (const nid of v.neighbors) {
      if (gameStones.get(nid) === color && !group.has(nid)) {
        group.add(nid);
        queue.push(nid);
      }
    }
  }
  
  return group;
}

function getGroupLiberties(vid) {
  // Get the group
  const group = getGroup(vid);
  const liberties = new Set();
  
  // Check all empty neighbors of all stones in the group
  for (const gvid of group) {
    const v = vertices[gvid];
    for (const nid of v.neighbors) {
      if (!gameStones.has(nid) && vertices[nid].visible !== false) {
        liberties.add(nid);
      }
    }
  }
  
  return liberties.size;
}

function boardStatesEqual(state1, state2) {
  // Compare two board states (Maps of vid -> color)
  if (state1.size !== state2.size) return false;
  
  for (const [vid, color] of state1) {
    if (state2.get(vid) !== color) return false;
  }
  
  return true;
}

function updateGameUI() {
  const turnEl = document.getElementById('gameTurn');
  const capBlackEl = document.getElementById('capBlack');
  const capWhiteEl = document.getElementById('capWhite');
  const gameInfoEl = document.getElementById('gameInfo');

  if (turnEl) turnEl.textContent = currentPlayer === 'black' ? 'Black' : 'White';
  if (capBlackEl) capBlackEl.textContent = capturedBlack;
  if (capWhiteEl) capWhiteEl.textContent = capturedWhite;
  if (gameInfoEl) {
    if (mode === 'play') {
      gameInfoEl.textContent = `Turn: ${currentPlayer.toUpperCase()} | Captured: Black ${capturedBlack}, White ${capturedWhite}`;
    } else {
      gameInfoEl.textContent = '';
    }
  }
  if (window.multiplayerUpdateTurn) window.multiplayerUpdateTurn();
}

// ---- Auto edge removal ----
function startAutoRemoveEdges() {
  const triCount = triangles.filter((t) => t.active).length;
  if (triCount === 0) {
    alert('No triangles to remove.');
    return;
  }
  
  // Apply the guaranteed quadrangulation pipeline
  applyGuaranteedQuadrangulation();
}

function applyGuaranteedQuadrangulation() {
  captureState('quadrangulation');
  
  // STEP 1: Keep only inner radius=4 region (vertices are reduced by half)
  const targetRadius = Math.floor(hexRadius / 2);
  deactivateFacesOutsideRadius(targetRadius);

  // STEP 1.5: Mark border vertices before scaling/subdivision
  markBorderVertices(targetRadius);
  
  // STEP 2: Double the spacing (so subdivision will bring it back to normal)
  scaleGridByFactor(2.0);
  
  // STEP 3: Try to merge adjacent triangles randomly
  const mergeResult = mergeTrianglesRandomly();
  
  // STEP 4: Subdivide ALL remaining faces (doubles vertices, halves effective spacing back to normal)
  subdivideFaces();
  
  // STEP 5: Remove all inactive triangles and old edges
  cleanupInactiveElements();

  // STEP 6: Find border vertices using neighbor count (geometric truth)
  // This MUST happen AFTER subdivision because axial coords (q,r) are invalid
  findAndMarkBorderVertices();

  // Mark which vertices are actually used (to hide stray ones when drawing)
  markVisibleVertices();
  
  updateUiCounts();
  redraw();
}

function scaleGridByFactor(factor) {
  const centerX = width / 2;
  const centerY = height / 2;
  
  // Scale all vertex positions from center
  for (const v of vertices) {
    const dx = v.x - centerX;
    const dy = v.y - centerY;
    v.x = centerX + dx * factor;
    v.y = centerY + dy * factor;
  }
  
  // Update edge midpoints
  for (const e of edges) {
    if (!e.active) continue;
    const a = vertices[e.a];
    const b = vertices[e.b];
    e.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

function centerAndFitGoban() {
  // Find bounding box of all visible vertices
  const visibleVerts = vertices.filter(v => v.visible !== false);
  if (visibleVerts.length === 0) return;
  
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (const v of visibleVerts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  
  const currentCenterX = (minX + maxX) / 2;
  const currentCenterY = (minY + maxY) / 2;
  const currentWidth = maxX - minX;
  const currentHeight = maxY - minY;
  
  const targetCenterX = width / 2;
  const targetCenterY = height / 2;
  
  const offsetX = targetCenterX - currentCenterX;
  const offsetY = targetCenterY - currentCenterY;
  
  // Apply translation
  for (const v of vertices) {
    v.x += offsetX;
    v.y += offsetY;
  }
  
  // Calculate scale to fit with some margin (90% of canvas)
  const availableWidth = width * 0.9;
  const availableHeight = height * 0.9;
  const scaleX = availableWidth / currentWidth;
  const scaleY = availableHeight / currentHeight;
  const scale = Math.min(scaleX, scaleY, 1.0);
  
  // Apply scaling from center
  if (scale < 1.0) {
    scaleGridByFactor(scale);
  }
  
  // Update edge midpoints
  for (const e of edges) {
    if (!e.active) continue;
    const a = vertices[e.a];
    const b = vertices[e.b];
    e.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

function cleanupInactiveElements() {
  // Remove all inactive triangles
  triangles = triangles.filter(t => t.active);
  
  // Keep all quads (they're all active after subdivision)
  // Rebuild edges completely from active quads only
  rebuildEdgesFromFaces();
}

function markVisibleVertices() {
  const used = new Set();
  for (const q of quads) {
    if (!q.active) continue;
    q.verts.forEach((vid) => used.add(vid));
  }
  vertices.forEach((v, idx) => {
    v.visible = used.has(idx);
  });
}

// ---- Save/Load Goban ----
function saveGoban() {
  const data = {
    version: 1,
    hexRadius,
    spacing,
    vertices: vertices.map((v) => ({
      id: v.id,
      x: v.x,
      y: v.y,
      type: v.type,
      q: v.q ?? 0,
      r: v.r ?? 0,
      peers: v.peers ?? [v.id, v.id, v.id],
    })),
    quads: quads.filter((q) => q.active).map((q) => ({ verts: [...q.verts] })),
  };

  const fname = `goban_${Date.now()}.json`;
  saveJSON(data, fname);
  if (saveLoadStatusEl) saveLoadStatusEl.textContent = `Saved ${fname}`;
}

function startLoadGoban() {
  // Set up editor environment first
  document.getElementById('app').style.display = 'block';
  document.getElementById('presetMenu').style.display = 'none';
  const placeholder = document.getElementById('roomPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  showPanelSection('edit');
  currentScreen = 'editor';
  
  if (!canvasCreated) {
    ensureCanvas();
  }
  
  // Now open file picker
  const picker = createFileInput(handleFile, false);
  picker.elt.accept = 'application/json';
  picker.elt.click();

  function handleFile(file) {
    if (file?.type === 'application' && file.subtype === 'json') {
      const data = file.data || file.string;
      try {
        const json = typeof data === 'string' ? JSON.parse(data) : data;
        
        // Check if it's a game save or just a goban save
        if (json.type === 'game') {
          // Load as game
          restoreGoban(json);
          restoreGameFromData(json);
          mode = 'play';
          currentScreen = 'play';
          showPanelSection('play');
          setupPlayButtons();
          updateGameUI();
          if (window.multiplayerSyncState) window.multiplayerSyncState();
          if (saveLoadStatusEl) saveLoadStatusEl.textContent = 'Game loaded';
        } else {
          // Load as goban only
          restoreGoban(json);
          if (saveLoadStatusEl) saveLoadStatusEl.textContent = 'Goban loaded';
          
          // Initialize editor UI after loading
          mode = 'move-vertex';
          captureState('initial');
          updateUiCounts();
          setupEditorButtons();
        }
        redraw();
      } catch (e) {
        console.error('Failed to load file', e);
        if (saveLoadStatusEl) saveLoadStatusEl.textContent = 'Load failed';
      }
    }
    picker.remove();
  }
}

function loadGoban() {
  const picker = createFileInput(handleFile, false);
  picker.elt.accept = 'application/json';
  picker.elt.click();

  function handleFile(file) {
    if (file?.type === 'application' && file.subtype === 'json') {
      const data = file.data || file.string;
      try {
        const json = typeof data === 'string' ? JSON.parse(data) : data;
        
        // Check if it's a game save or just a goban save
        if (json.type === 'game') {
          // Load as game
          restoreGoban(json);
          restoreGameFromData(json);
          mode = 'play';
          currentScreen = 'play';
          showPanelSection('play');
          setupPlayButtons();
          updateGameUI();
          if (window.multiplayerSyncState) window.multiplayerSyncState();
          if (saveLoadStatusEl) saveLoadStatusEl.textContent = 'Game loaded';
        } else {
          // Load as goban only
          restoreGoban(json);
          if (saveLoadStatusEl) saveLoadStatusEl.textContent = 'Loaded goban';
          
          // Initialize editor UI after loading
          mode = 'move-vertex';
          captureState('initial');
          updateUiCounts();
          setupEditorButtons();
        }
        redraw();
      } catch (e) {
        console.error('Failed to load goban', e);
        if (saveLoadStatusEl) saveLoadStatusEl.textContent = 'Load failed';
      }
    }
    picker.remove();
  }
}

function restoreGoban(data) {
  // Reset structures
  vertices = [];
  edges = [];
  edgeByKey.clear();
  edgeTris.clear();
  triangles = [];
  quads = [];

  // Restore vertices
  data.vertices.forEach((v) => {
    vertices.push({
      id: v.id,
      x: v.x,
      y: v.y,
      type: v.type,
      q: v.q ?? 0,
      r: v.r ?? 0,
      neighbors: new Set(),
      triangles: new Set(),
      quads: new Set(),
      peers: v.peers ?? [v.id, v.id, v.id],
      visible: true,
    });
  });

  // Restore quads
  if (Array.isArray(data.quads)) {
    data.quads.forEach((q, idx) => {
      quads.push({ id: idx, verts: [...q.verts], active: true });
    });
  }

  // Rebuild edges and mark visibility
  rebuildEdgesFromFaces();
  markVisibleVertices();
  updateUiCounts();
  redraw();
  captureState('load');
}

function deactivateFacesOutsideRadius(maxRadius) {
  // Deactivate all triangles and quads that have any vertex outside maxRadius
  for (const tri of triangles) {
    if (!tri.active) continue;
    const hasOutsideVertex = tri.verts.some(vid => {
      const v = vertices[vid];
      const dist = Math.max(Math.abs(v.q), Math.abs(v.r), Math.abs(-v.q - v.r));
      return dist > maxRadius;
    });
    if (hasOutsideVertex) {
      tri.active = false;
    }
  }
  
  for (const quad of quads) {
    if (!quad.active) continue;
    const hasOutsideVertex = quad.verts.some(vid => {
      const v = vertices[vid];
      const dist = Math.max(Math.abs(v.q), Math.abs(v.r), Math.abs(-v.q - v.r));
      return dist > maxRadius;
    });
    if (hasOutsideVertex) {
      quad.active = false;
    }
  }
}

function markBorderVertices(borderRadius) {
  // Mark all vertices at exactly borderRadius distance as 'edge' type
  for (const v of vertices) {
    const dist = Math.max(Math.abs(v.q), Math.abs(v.r), Math.abs(-v.q - v.r));
    if (dist === borderRadius) {
      v.type = 'edge';
    }
  }
}

function findAndMarkBorderVertices() {
  for (const v of vertices) {
    if (v.visible) {
      v.type = 'inner';
    }
  }
  
  for (const v of vertices) {
    if (!v.visible) continue;
    const neighborCount = v.neighbors.size;
    if (neighborCount < 6) {
      v.type = 'edge';
    }
  }
}

function mergeTrianglesRandomly() {
  // Build all possible triangle pairs that share an edge
  const pairs = [];
  for (let i = 0; i < triangles.length; i++) {
    if (!triangles[i]?.active) continue;
    for (let j = i + 1; j < triangles.length; j++) {
      if (!triangles[j]?.active) continue;
      
      const shared = triangles[i].verts.filter(v => triangles[j].verts.includes(v));
      if (shared.length === 2) {
        pairs.push([i, j, shared]);
      }
    }
  }
  
  // Shuffle pairs randomly
  shuffleArray(pairs);
  
  const merged = new Set();
  let mergeCount = 0;
  
  for (const [triAId, triBId, shared] of pairs) {
    if (merged.has(triAId) || merged.has(triBId)) continue;
    if (!triangles[triAId]?.active || !triangles[triBId]?.active) continue;
    
    // Find the edge connecting them
    const edgeId = edgeByKey.get(edgeKey(shared[0], shared[1]));
    if (edgeId !== undefined && edges[edgeId]?.active) {
      deleteEdgeSingle(edgeId);
      mergeCount++;
      merged.add(triAId).add(triBId);
    }
  }
  
  return { merged: mergeCount };
}

function subdivideFaces() {
  // Create a map to store edge midpoints (to avoid duplicates)
  const edgeMidpoints = new Map();
  
  const getOrCreateMidpoint = (vid1, vid2) => {
    const key = edgeKey(vid1, vid2);
    if (edgeMidpoints.has(key)) {
      return edgeMidpoints.get(key);
    }
    
    const v1 = vertices[vid1];
    const v2 = vertices[vid2];
    const newId = vertices.length;
    
    // If both vertices are on border, midpoint is also on border
    const isBorder = (v1.type === 'edge' && v2.type === 'edge');
    
    const newVertex = {
      id: newId,
      x: (v1.x + v2.x) / 2,
      y: (v1.y + v2.y) / 2,
      q: 0, r: 0, // Subdivided vertices don't have hex coordinates
      type: isBorder ? 'edge' : 'inner',
      neighbors: new Set(),
      triangles: new Set(),
      quads: new Set(),
      peers: [newId, newId, newId], // Self-reference (no rotation symmetry)
    };
    
    vertices.push(newVertex);
    edgeMidpoints.set(key, newId);
    return newId;
  };
  
  const getFaceCenter = (vertIds) => {
    let sumX = 0, sumY = 0;
    for (const vid of vertIds) {
      sumX += vertices[vid].x;
      sumY += vertices[vid].y;
    }
    const newId = vertices.length;
    const newVertex = {
      id: newId,
      x: sumX / vertIds.length,
      y: sumY / vertIds.length,
      q: 0, r: 0,
      type: 'inner',
      neighbors: new Set(),
      triangles: new Set(),
      quads: new Set(),
      peers: [newId, newId, newId],
    };
    vertices.push(newVertex);
    return newId;
  };
  
  const newQuads = [];
  
  // Subdivide all active triangles
  for (const tri of triangles) {
    if (!tri.active) continue;
    
    const verts = tri.verts; // [v0, v1, v2]
    
    // Create edge midpoints
    const mid01 = getOrCreateMidpoint(verts[0], verts[1]);
    const mid12 = getOrCreateMidpoint(verts[1], verts[2]);
    const mid20 = getOrCreateMidpoint(verts[2], verts[0]);
    
    // Create face center
    const center = getFaceCenter(verts);
    
    // Create 3 quads (one for each original vertex)
    newQuads.push({
      id: quads.length + newQuads.length,
      verts: orderPolygon([verts[0], mid01, center, mid20]),
      active: true
    });
    newQuads.push({
      id: quads.length + newQuads.length,
      verts: orderPolygon([verts[1], mid12, center, mid01]),
      active: true
    });
    newQuads.push({
      id: quads.length + newQuads.length,
      verts: orderPolygon([verts[2], mid20, center, mid12]),
      active: true
    });
    
    tri.active = false; // Deactivate original triangle
  }
  
  // Subdivide all active quads
  for (const quad of quads) {
    if (!quad.active) continue;
    
    const verts = quad.verts; // [v0, v1, v2, v3]
    
    // Create edge midpoints
    const mid01 = getOrCreateMidpoint(verts[0], verts[1]);
    const mid12 = getOrCreateMidpoint(verts[1], verts[2]);
    const mid23 = getOrCreateMidpoint(verts[2], verts[3]);
    const mid30 = getOrCreateMidpoint(verts[3], verts[0]);
    
    // Create face center
    const center = getFaceCenter(verts);
    
    // Create 4 quads (one for each original vertex)
    newQuads.push({
      id: quads.length + newQuads.length,
      verts: orderPolygon([verts[0], mid01, center, mid30]),
      active: true
    });
    newQuads.push({
      id: quads.length + newQuads.length,
      verts: orderPolygon([verts[1], mid12, center, mid01]),
      active: true
    });
    newQuads.push({
      id: quads.length + newQuads.length,
      verts: orderPolygon([verts[2], mid23, center, mid12]),
      active: true
    });
    newQuads.push({
      id: quads.length + newQuads.length,
      verts: orderPolygon([verts[3], mid30, center, mid23]),
      active: true
    });
    
    quad.active = false; // Deactivate original quad
  }
  
  // Add all new quads
  newQuads.forEach(q => {
    quads.push(q);
    q.verts.forEach(vid => vertices[vid].quads.add(q.id));
  });
  
  // Rebuild edges and edge maps
  rebuildEdgesFromFaces();
}

function autoRemoveEdgesStep() {
  // PASS 1: Try standard merging (edges with exactly 2 triangles)
  const edges_to_delete = [];
  
  for (const [edgeKeyStr, triIds] of edgeTris) {
    const activeTris = triIds.filter((triId) => triangles[triId]?.active);
    if (activeTris.length === 2) {
      const edgeId = edgeByKey.get(edgeKeyStr);
      if (edgeId !== undefined && edges[edgeId]?.active) {
        edges_to_delete.push(edgeId);
      }
    }
  }

  shuffleArray(edges_to_delete);

  const merged_tris = new Set();
  let deleted = 0;

  for (const edgeId of edges_to_delete) {
    const edge = edges[edgeId];
    if (!edge?.active) continue;
    
    const edgeKeyStr = edgeKey(edge.a, edge.b);
    const triIds = (edgeTris.get(edgeKeyStr) || []).filter((t) => triangles[t]?.active);
    
    if (triIds.length !== 2) continue;
    const [tri1Id, tri2Id] = triIds;
    
    if (merged_tris.has(tri1Id) || merged_tris.has(tri2Id)) continue;

    deleteEdgeSingle(edgeId);
    deleted++;
    merged_tris.add(tri1Id).add(tri2Id);
  }
  
  // PASS 2: If we still have triangles, try greedy fallback (any shared pair)
  const triCount = triangles.filter((t) => t.active).length;
  if (triCount > 0 && deleted === 0) {
    
    // Find ANY pair of triangles that share an edge
    const pairs = [];
    for (let i = 0; i < triangles.length; i++) {
      if (!triangles[i]?.active) continue;
      for (let j = i + 1; j < triangles.length; j++) {
        if (!triangles[j]?.active) continue;
        
        const shared = triangles[i].verts.filter(v => triangles[j].verts.includes(v));
        if (shared.length === 2) {
          pairs.push([i, j, shared]);
        }
      }
    }
    
    shuffleArray(pairs);
    const merged_tris_fallback = new Set();
    
    for (const [triAId, triBId, shared] of pairs) {
      if (merged_tris_fallback.has(triAId) || merged_tris_fallback.has(triBId)) continue;
      if (!triangles[triAId]?.active || !triangles[triBId]?.active) continue;
      
      // Find edge connecting them
      const edgeId = edgeByKey.get(edgeKey(shared[0], shared[1]));
      if (edgeId !== undefined && edges[edgeId]?.active) {
        deleteEdgeSingle(edgeId);
        deleted++;
        merged_tris_fallback.add(triAId).add(triBId);
        
        if (deleted >= 10) break;
      }
    }
  }

  return deleted;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function updateAutoRemoveStatus() {
  const statusEl = document.getElementById('autoRemoveStatus');
  const btnEl = document.getElementById('autoRemoveBtn');
  if (autoRemoving) {
    if (statusEl) statusEl.textContent = `Removing: iter ${autoRemoveIterations}, retry ${autoRemoveRetries}/${autoRemoveMaxRetries}`;
    if (btnEl) btnEl.disabled = true;
  } else {
    if (statusEl) statusEl.textContent = '';
    if (btnEl) btnEl.disabled = false;
  }
}

// ---- Symbol rendering ----

// ---- Undo/Redo system ----
function captureStateSnapshot() {
  // Returns a snapshot without adding to undo stack (for temp saves like auto-remove retries)
  return {
    vertices: vertices.map(v => ({
      id: v.id, q: v.q, r: v.r, x: v.x, y: v.y, type: v.type,
      neighbors: new Set(v.neighbors), triangles: new Set(v.triangles),
      quads: new Set(v.quads), peers: [...v.peers],
    })),
    edges: edges.map(e => ({
      id: e.id, a: e.a, b: e.b, mid: { x: e.mid.x, y: e.mid.y }, active: e.active,
    })),
    triangles: triangles.map(t => ({
      id: t.id, verts: [...t.verts], active: t.active,
    })),
    quads: quads.map(q => ({
      id: q.id, verts: [...q.verts], active: q.active, area: q.area,
    })),
  };
}

// Helper functions to get the correct undo stack for current mode
function getCurrentUndoStack() {
  return mode === 'play' ? gameUndoStack : gobanUndoStack;
}

function getCurrentUndoIndex() {
  return mode === 'play' ? gameUndoIndex : gobanUndoIndex;
}

function setCurrentUndoIndex(val) {
  if (mode === 'play') {
    gameUndoIndex = val;
  } else {
    gobanUndoIndex = val;
  }
}

function captureState(actionLabel) {
  // Route to appropriate capture function based on mode
  if (mode === 'play') {
    captureGameMove(actionLabel);
  } else {
    captureGobanEdit(actionLabel);
  }
}

function captureGobanEdit(actionLabel) {
  const stack = gobanUndoStack;
  const idx = gobanUndoIndex;
  
  // Truncate redo stack
  stack.splice(idx + 1);
  
  // Create snapshot
  const snapshot = captureStateSnapshot();
  snapshot.label = actionLabel;
  
  stack.push(snapshot);
  gobanUndoIndex++;
  updateUndoUI();
}

function captureGameMove(moveDesc) {
  const stack = gameUndoStack;
  const idx = gameUndoIndex;
  
  // Truncate redo stack
  stack.splice(idx + 1);
  
  // Capture game state
  const snapshot = captureGameState(moveDesc);
  stack.push(snapshot);
  gameUndoIndex++;
  updateUndoUI();
}

function undoStep() {
  const stack = getCurrentUndoStack();
  let idx = getCurrentUndoIndex();
  
  if (idx <= 0) return; // No undo available
  idx--;
  setCurrentUndoIndex(idx);
  restoreSnapshot(stack[idx]);
}

function redoStep() {
  const stack = getCurrentUndoStack();
  let idx = getCurrentUndoIndex();
  
  if (idx >= stack.length - 1) return; // No redo available
  idx++;
  setCurrentUndoIndex(idx);
  restoreSnapshot(stack[idx]);
}

function restoreSnapshot(snapshot) {
  // Route to appropriate restore based on snapshot type
  if (snapshot.type === 'game') {
    restoreGameState(snapshot);
  } else {
    restoreGobanSnapshot(snapshot);
  }
}

function restoreGobanSnapshot(snapshot) {
  // Clear and rebuild data structures
  vertices = snapshot.vertices.map(v => ({
    id: v.id, q: v.q, r: v.r, x: v.x, y: v.y, type: v.type,
    neighbors: new Set(v.neighbors), triangles: new Set(v.triangles),
    quads: new Set(v.quads), peers: v.peers,
  }));
  
  edges = snapshot.edges.map(e => ({
    id: e.id, a: e.a, b: e.b, mid: { x: e.mid.x, y: e.mid.y }, active: e.active,
  }));
  
  // Rebuild edgeByKey and edgeTris
  edgeByKey.clear();
  edgeTris.clear();
  edges.forEach(e => {
    edgeByKey.set(edgeKey(e.a, e.b), e.id);
  });
  
  triangles = snapshot.triangles.map(t => ({
    id: t.id, verts: t.verts, active: t.active,
  }));
  
  quads = snapshot.quads.map(q => ({
    id: q.id, verts: q.verts, active: q.active, area: q.area,
  }));
  
  // Rebuild edge-triangle mapping
  triangles.forEach(t => {
    if (!t.active) return;
    const [v0, v1, v2] = t.verts;
    addEdgeTriangleMapped(v0, v1, t.id);
    addEdgeTriangleMapped(v1, v2, t.id);
    addEdgeTriangleMapped(v2, v0, t.id);
  });
  
  updateUiCounts();
  updateUndoUI();
  redraw();
}

function addEdgeTriangleMapped(a, b, triId) {
  const k = edgeKey(a, b);
  if (!edgeTris.has(k)) edgeTris.set(k, []);
  edgeTris.get(k).push(triId);
}

function updateUndoUI() {
  const stack = getCurrentUndoStack();
  const idx = getCurrentUndoIndex();

  const undoBtn = mode === 'play'
    ? document.getElementById('gameUndoBtn')
    : document.getElementById('undoBtn');
  const redoBtn = mode === 'play'
    ? document.getElementById('gameRedoBtn')
    : document.getElementById('redoBtn');
  const undoStatus = mode === 'play'
    ? document.getElementById('gameUndoStatus')
    : document.getElementById('undoStatus');

  if (undoBtn) undoBtn.disabled = idx <= 0;
  if (redoBtn) redoBtn.disabled = idx >= stack.length - 1;
  if (undoStatus) undoStatus.textContent = `Undo: ${idx}/${stack.length - 1}`;
}

function subdivideMesh() {
    let newFaces = []; 

    faces.forEach((face) => {
        // 1. Get/Create edge midpoints
        let midpoints = [];
        for (let i = 0; i < face.vertices.length; i++) {
            let v1 = face.vertices[i];
            let v2 = face.vertices[(i + 1) % face.vertices.length];
            midpoints.push(getOrCreateEdgeMidpoint(v1, v2));
        }

        // 2. Create face center
        let centerVertex = createFaceCenter(face.vertices);

        // 3. Form new quads connecting Vertices -> Midpoints -> Center
        for (let i = 0; i < face.vertices.length; i++) {
            let newQuadVertices = [
                face.vertices[i],
                midpoints[i],
                centerVertex,
                midpoints[(i - 1 + midpoints.length) % midpoints.length],
            ];
            newFaces.push(new Face(newQuadVertices));
        }
    });

    faces = newFaces; // Replace old mixed faces with guaranteed quads
}

function getOrCreateEdgeMidpoint(v1, v2) {
    // Unique key for the edge between two vertices
    let edgeKey = `${Math.min(v1.index, v2.index)}-${Math.max(v1.index, v2.index)}`;
    
    if (edgeMidpointMap.has(edgeKey)) {
        return edgeMidpointMap.get(edgeKey);
    } else {
        let midpoint = new SubdivVertex((v1.x + v2.x) / 2, (v1.y + v2.y) / 2);
        if (v1.edgy && v2.edgy) midpoint.edgy = true; // Keep boundaries sharp
        subdivVertices.push(midpoint);
        edgeMidpointMap.set(edgeKey, midpoint);
        return midpoint;
    }
}

function relaxVertexPosition(vertex, strength = 0.08) {
    if (vertex.edgy || !vertex.adjacentFaces || vertex.adjacentFaces.length === 0) return;

    let weightedSumX = 0, weightedSumY = 0, totalWeight = 0;

    vertex.adjacentFaces.forEach((face) => {
        let centroid = getFaceCentroid(face);
        let weight = face.area;

        weightedSumX += centroid.x * weight;
        weightedSumY += centroid.y * weight;
        totalWeight += weight;
    });

    if (totalWeight > 0) {
        vertex.x += (weightedSumX / totalWeight - vertex.x) * strength;
        vertex.y += (weightedSumY / totalWeight - vertex.y) * strength;
    }
}

function computeTrompTaylorScore() {
  let blackStones = 0;
  let whiteStones = 0;
  
  for (const [vid, color] of gameStones.entries()) {
    if (deadStones.has(vid)) continue;
    if (color === 'black') blackStones++;
    else whiteStones++;
  }

  let blackTerritory = 0;
  let whiteTerritory = 0;
  let neutral = 0;

  const visited = new Set();

  for (const v of vertices) {
    if (v.visible === false) continue;
    const vid = v.id;
    const hasLiveStone = gameStones.has(vid) && !deadStones.has(vid);
    if (hasLiveStone || visited.has(vid)) continue;

    let regionSize = 0;
    const queue = [vid];
    visited.add(vid);
    const borderingColors = new Set();

    while (queue.length) {
      const curr = queue.pop();
      regionSize++;
      const cv = vertices[curr];
      for (const nid of cv.neighbors) {
        const nv = vertices[nid];
        if (!nv || nv.visible === false) continue;
        const hasLiveNeighbor = gameStones.has(nid) && !deadStones.has(nid);
        if (hasLiveNeighbor) {
          borderingColors.add(gameStones.get(nid));
        } else if (!visited.has(nid)) {
          visited.add(nid);
          queue.push(nid);
        }
      }
    }

    if (borderingColors.size === 1) {
      const owner = borderingColors.has('black') ? 'black' : 'white';
      if (owner === 'black') blackTerritory += regionSize;
      else whiteTerritory += regionSize;
    } else {
      neutral += regionSize;
    }
  }

  const KOMI = 7.5;
  const blackTotal = blackStones + blackTerritory;
  const whiteTotal = whiteStones + whiteTerritory + KOMI;

  return {
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    neutral,
    blackTotal,
    whiteTotal,
    komi: KOMI,
  };
}

function renderScore(score) {
  const bEl = document.getElementById('scoreBlack');
  const wEl = document.getElementById('scoreWhite');
  const nEl = document.getElementById('scoreNeutral');
  const resultEl = document.getElementById('gameResult');
  const resultRow = document.getElementById('resultRow');
  
  if (bEl) bEl.textContent = `${score.blackTotal} (stones ${score.blackStones} + territory ${score.blackTerritory})`;
  if (wEl) wEl.textContent = `${score.whiteTotal} (stones ${score.whiteStones} + territory ${score.whiteTerritory} + komi ${score.komi})`;
  if (nEl) nEl.textContent = `${score.neutral}`;
  
  // Display winner prominently
  if (resultEl && resultRow) {
    const diff = Math.abs(score.blackTotal - score.whiteTotal);
    if (score.blackTotal > score.whiteTotal) {
      resultEl.textContent = `🏆 BLACK WINS by ${diff.toFixed(1)} points!`;
      resultEl.style.color = '#ffffff';
      resultEl.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    } else if (score.whiteTotal > score.blackTotal) {
      resultEl.textContent = `🏆 WHITE WINS by ${diff.toFixed(1)} points!`;
      resultEl.style.color = '#ffffff';
      resultEl.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    } else {
      resultEl.textContent = `TIE GAME!`;
      resultEl.style.color = '#ffdd00';
    }
    resultRow.style.display = 'block';
  }
}

window.getCurrentPlayer = () => currentPlayer;
window.getCurrentMode = () => mode;

// Called by multiplayer.js when the player joins a new room, to clear any
// leftover game state (panel section, scores, result rows) from a previous game.
window.resetToRoomMenu = () => {
  showPanelSection('roomMenu');
  currentScreen = 'room-menu';
  if (mode === 'play') {
    mode = 'move-vertex';
    gameStones.clear();
    currentPlayer = 'black';
    capturedBlack = 0;
    capturedWhite = 0;
  }
  // Hide end-game UI rows that may still be visible from the previous game
  const gameStatusRow = document.getElementById('gameStatusRow');
  const deadStoneRow  = document.getElementById('deadStoneRow');
  const resultRow     = document.getElementById('resultRow');
  if (gameStatusRow) gameStatusRow.style.display = 'none';
  if (deadStoneRow)  deadStoneRow.style.display  = 'none';
  if (resultRow)     resultRow.style.display      = 'none';
  noLoop();
};

window.getGameSnapshot = () => ({
  version: 1,
  type: 'game',
  timestamp: new Date().toISOString(),
  hexRadius,
  spacing,
  vertices: vertices.map((v) => ({
    id: v.id,
    x: v.x,
    y: v.y,
    type: v.type,
    q: v.q ?? 0,
    r: v.r ?? 0,
    peers: v.peers ?? [v.id, v.id, v.id],
  })),
  quads: quads.filter((q) => q.active).map((q) => ({ verts: [...q.verts] })),
  gameStones: Array.from(gameStones.entries()),
  stoneOrder: Array.from(stoneOrder.entries()),
  currentPlayer,
  capturedBlack,
  capturedWhite,
  previousBoardState: previousBoardState ? Array.from(previousBoardState.entries()) : null,
  gameUndoStack: gameUndoStack.map((snapshot) => ({
    label: snapshot.label,
    stones: Array.from(snapshot.stones.entries()),
    stoneOrder: Array.from(snapshot.stoneOrder.entries()),
    currentPlayer: snapshot.currentPlayer,
    capturedBlack: snapshot.capturedBlack,
    capturedWhite: snapshot.capturedWhite,
    previousBoardState: snapshot.previousBoardState ? Array.from(snapshot.previousBoardState.entries()) : null,
  })),
  gameUndoIndex,
});

window.applyGameSnapshot = (data) => {
  if (!canvasCreated) ensureCanvas();
  document.getElementById('app').style.display = 'block';
  const placeholder = document.getElementById('roomPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  restoreGoban(data);
  restoreGameFromData(data);
  mode = 'play';
  currentScreen = 'play';
  showPanelSection('play');
  setupPlayButtons();
  updateGameUI();
  redraw();
};

window.applyRemoteMove = (move) => {
  if (!move || move.type !== 'place') return;
  const originalPlayer = currentPlayer;
  const beforeSize = gameStones.size;
  currentPlayer = move.color;
  placeStone(move.vid, { remote: true });
  if (gameStones.size === beforeSize) {
    currentPlayer = originalPlayer;
  }
};

window.applyRemotePass = () => {
  handlePass(true);
};

// Called by multiplayer.js after every incoming game:move to refresh UI and board
window.updateGameUIRemote = () => {
  updateGameUI();
  redraw();
};