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
let pendingVertex = null; // mobile: vertex selected by drag, persists until confirmed
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
let relaxMode = 'standard'; // 'standard' | 'compensated' | 'coulomb'
let coulombDebug = null; // { vid, forces: [{ px, py, fx, fy, w }], net: { fx, fy } }
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
// Keep canvas sized to the viewport (on mobile, leave bottom 30% for the panel)
function canvasHeight() {
  return windowWidth <= 600 ? Math.floor(windowHeight * 0.7) : windowHeight;
}

// Measure actual inter-vertex distance from the first live edge (scales with board zoom)
function effectiveSpacing() {
  for (const e of edges) {
    if (!e.active) continue;
    const a = vertices[e.a], b = vertices[e.b];
    if (a && b) return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  }
  return spacing;
}

// Find the nearest vertex to (px, py) with no radius limit — used for touch
function nearestVertex(px, py) {
  let best = null, bestDist = Infinity;
  for (const v of vertices) {
    if (v.visible === false) continue;
    const d = (v.x - px) ** 2 + (v.y - py) ** 2;
    if (d < bestDist) { bestDist = d; best = v.id; }
  }
  return best;
}

function ensureCanvas() {
  const w = windowWidth;
  const h = canvasHeight();
  const in3D = !!(window.StarDomination && window.StarDomination.active);
  // In 3D mode, three.js owns its own canvas — just hide the p5 canvas so
  // it doesn't render on top of it. In 2D mode, ensure the p5 canvas exists
  // and is visible.
  const existing = document.querySelector('#app canvas.p5Canvas');
  if (in3D) {
    if (existing) existing.style.display = 'none';
    return;
  }
  if (!canvasCreated) {
    const c = createCanvas(w, h);
    c.parent('app');
    canvasCreated = true;
  } else {
    if (existing) existing.style.display = '';
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

  // Expose hooks the three.js star-domination renderer needs to read/write
  // sketch.js's let-scoped state and invoke the game-rules pipeline.
  window.__sdGetGameStones = () => gameStones;
  window.__sdGetCurrentPlayer = () => currentPlayer;
  window.__sdGetVertices = () => vertices;
  window.__sdGetQuads = () => quads;
  window.__sdGetMode = () => mode;
  window.__sdSetHoverVertex = (v) => { hoverVertex = v; };
  window.__sdTryPlaceStone = (vid) => {
    if (mode !== 'play') return false;
    hoverVertex = vid;
    return tryPlaceAtHover();
  };
  // Exposed for multiplayer.js so leaving the room can reset the canvas.
  window.ensureCanvas = ensureCanvas;
}

function setupMenuListeners() {
  // Room menu
  document.getElementById('menuRandomGoban')?.addEventListener('click', startRandomGoban);
  document.getElementById('menuPresetGoban')?.addEventListener('click', showPresetMenu);
  document.getElementById('menuStarDomination')?.addEventListener('click', showStarDominationMenu);
  document.getElementById('menuDesignGoban')?.addEventListener('click', startDesignMode);
  document.getElementById('menuLoadGoban')?.addEventListener('click', startLoadGoban);
  document.getElementById('menuSettings')?.addEventListener('click', showSettings);
  document.getElementById('backToMenuFromSD')?.addEventListener('click', showMainMenu);
  document.querySelectorAll('#starDominationMenu [data-sd-size]').forEach((btn) => {
    btn.addEventListener('click', () => loadStarDominationGoban(btn.dataset.sdSize));
  });

  // Preset menu — scoped to #presetMenu so .preset-btn buttons reused in
  // sibling menus (like #starDominationMenu) don't also trigger loadPresetGoban.
  document.querySelectorAll('#presetMenu .preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => loadPresetGoban(e.target.dataset.preset));
  });
  document.getElementById('backToMenuFromPreset')?.addEventListener('click', showMainMenu);

  // Random menu
  document.getElementById('regenerateBtn')?.addEventListener('click', generateRandomGoban);
  document.getElementById('acceptRandomBtn')?.addEventListener('click', acceptRandomGoban);

  // Editor buttons
  document.getElementById('backToMenuBtn')?.addEventListener('click', showMainMenu);

  // Play-mode buttons — wired once here so their handlers survive any DOM
  // text updates (e.g. i18n language changes). Per-game state (enable/disable,
  // label toggles) still happens in setupPlayButtons().
  document.getElementById('gameUndoBtn')?.addEventListener('click', undoStep);
  document.getElementById('gameRedoBtn')?.addEventListener('click', redoStep);
  document.getElementById('passBtn')?.addEventListener('click', () => handlePass(false));
  document.getElementById('finishMarkingBtn')?.addEventListener('click', finishMarkingDeadStones);
  document.getElementById('scoreBtn')?.addEventListener('click', () => {
    const score = computeTrompTaylorScore();
    renderScore(score);
  });
  document.getElementById('toggleIndicesBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('toggleIndicesBtn');
    showStoneIndices = !showStoneIndices;
    if (btn) btn.textContent = window.t ? t(showStoneIndices ? 'play.hideStoneIndices' : 'play.showStoneIndices') : (showStoneIndices ? 'Hide Stone Indices' : 'Show Stone Indices');
    redraw();
  });
  document.getElementById('aiMoveBtn')?.addEventListener('click', async () => {
    if (hexGoAI.thinking || gameEnded) return;
    markLocalRecordUsedAI();
    const move = await hexGoAI.makeMove(2000);
    if (move === 'pass') handlePass(false);
    else placeStone(move);
  });
}

// Switch visible section inside the single room panel
function showPanelSection(section) {
  // section: 'roomMenu' | 'random' | 'edit' | 'play'
  setDisplay('sectionRoomMenu', section === 'roomMenu' ? 'block' : 'none');
  setDisplay('sectionRandom',   section === 'random'   ? 'block' : 'none');
  setDisplay('sectionEdit',     section === 'edit'     ? 'block' : 'none');
  setDisplay('sectionPlay',     section === 'play'     ? 'block' : 'none');
  setDisplay('backToMenuBtn',   section !== 'roomMenu' ? 'block' : 'none');
  // Show confirm button only on mobile in play mode
  const confirmBtn = document.getElementById('mobileConfirmBtn');
  if (confirmBtn) {
    confirmBtn.style.display = (section === 'play' && windowWidth <= 600) ? 'block' : 'none';
  }
}

// Show the game rules dialog before starting a multiplayer game.
// Solo / non-owner: skip the dialog and call startFn with defaults.
// Multiplayer host: pick komi/color rule and an opponent to invite. The
// startFn is deferred and only runs after the invitee accepts (server emits
// room:rules, which multiplayer.js routes back to the deferred startFn).
function showRulesDialog(startFn) {
  const ms = window.multiplayerState;
  if (!ms?.active || !ms?.isOwner) {
    startFn({ komi, colorMode: 'owner-black' });
    return;
  }
  const modal = document.getElementById('gameRulesModal');
  if (!modal) { startFn({ komi, colorMode: 'owner-black' }); return; }

  const komiInput = document.getElementById('komiInput');
  if (komiInput) komiInput.value = komi;

  const colorModeSelect = document.getElementById('colorModeSelect');
  const opponentRow = document.getElementById('rulesOpponentRow');
  const opponentSelect = document.getElementById('rulesOpponentSelect');
  const opponentHint = document.getElementById('rulesOpponentHint');
  const confirmBtn = document.getElementById('gameRulesConfirm');

  // Populate the opponent dropdown with everyone in the room except self.
  const others = (window.multiplayerOtherMembers && window.multiplayerOtherMembers()) || [];
  if (opponentSelect) {
    opponentSelect.innerHTML = '';
    others.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.clientId;
      opt.textContent = m.name || m.clientId;
      opponentSelect.appendChild(opt);
    });
  }

  // In study mode there's no opponent to invite — game runs locally for both.
  // With no other members, fall back to study (host can play alone).
  const refreshOpponentRow = () => {
    const isStudy = colorModeSelect?.value === 'study';
    const hasOthers = others.length > 0;
    if (opponentRow) opponentRow.style.display = (isStudy || !hasOthers) ? 'none' : 'block';
    if (opponentHint && !hasOthers) opponentHint.textContent = (window.t ? t('rules.noOtherPlayers') : 'No other players in this room yet.');
    if (confirmBtn) {
      confirmBtn.textContent = (window.t ? t(isStudy || !hasOthers ? 'rules.start' : 'rules.sendInvite')
                                          : (isStudy || !hasOthers ? 'Start Game' : 'Send Invitation'));
    }
  };
  if (colorModeSelect) colorModeSelect.onchange = refreshOpponentRow;
  refreshOpponentRow();

  modal.style.display = 'flex';

  const close = () => { modal.style.display = 'none'; };
  document.getElementById('gameRulesClose').onclick = close;

  confirmBtn.onclick = () => {
    const k = parseFloat(komiInput ? komiInput.value : 7.5);
    const colorMode = colorModeSelect ? colorModeSelect.value : 'owner-black';
    komi = isNaN(k) ? 7.5 : Math.round(k * 2) / 2;
    const komiDisplay = document.getElementById('komiDisplay');
    if (komiDisplay) komiDisplay.textContent = komi;

    const isStudy = colorMode === 'study';
    const hasOthers = others.length > 0;

    if (isStudy || !hasOthers) {
      // No invitation flow — start immediately and tell the room directly.
      close();
      if (window.multiplayerSendChallenge) {
        window.multiplayerSendChallenge({ komi, colorMode: isStudy ? 'study' : colorMode }, null, startFn);
      } else {
        startFn({ komi, colorMode });
      }
      return;
    }

    const opponentClientId = opponentSelect ? opponentSelect.value : null;
    if (!opponentClientId) return; // no opponent picked
    close();
    if (window.multiplayerSendChallenge) {
      window.multiplayerSendChallenge({ komi, colorMode }, opponentClientId, startFn);
    } else {
      startFn({ komi, colorMode });
    }
  };
}

function showMainMenu() {
  // Leave 3D mode cleanly if we were in it.
  if (window.StarDomination && window.StarDomination.active) {
    window.StarDomination.stop();
  }

  document.getElementById('presetMenu').style.display = 'none';
  document.getElementById('starDominationMenu').style.display = 'none';
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
  if (window.StarDomination && window.StarDomination.active) {
    window.StarDomination.stop();
  }
  document.getElementById('presetMenu').style.display = 'block';
  document.getElementById('starDominationMenu').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  showPanelSection('roomMenu');
  currentScreen = 'preset';
}

function showStarDominationMenu() {
  if (window.StarDomination && window.StarDomination.active) {
    window.StarDomination.stop();
  }
  document.getElementById('starDominationMenu').style.display = 'block';
  document.getElementById('presetMenu').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  showPanelSection('roomMenu');
  currentScreen = 'starDomination';
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
  
  document.getElementById('randomStatus').textContent = (window.t ? t('random.generating') : 'Generating goban...');
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
      document.getElementById('randomStatus').textContent = (window.t ? t('random.generated') : 'Goban generated!');
      document.getElementById('regenerateBtn').style.display = 'inline-block';
      document.getElementById('acceptRandomBtn').style.display = 'inline-block';
    }, 30 * 50); // Approximate time for 30 frames
  }, 100);
}

function acceptRandomGoban() {
  showRulesDialog(() => enterPlayMode());
}

// Single entry point for "begin a play-mode session". Used by every goban
// loader (random / preset / editor / loaded record) so ordering is identical:
// state reset → currentScreen → panel section → setup → UI refresh → sync.
function enterPlayMode() {
  mode = 'play';
  gameStones.clear();
  currentPlayer = 'black';
  capturedBlack = 0;
  capturedWhite = 0;
  initGameHistory();
  currentScreen = 'play';
  showPanelSection('play');
  setupPlayButtons();
  updateUiMode();
  updateGameUI();           // also calls refreshTurnBanner
  refreshViewportUi();      // mobile confirm button appears now that we're in play mode
  redraw();
  if (window.multiplayerSyncState) window.multiplayerSyncState();
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

  // Make sure the canvas is 2D (in case we're coming back from sphere mode).
  if (window.StarDomination) window.StarDomination.stop();
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
    alert(window.t ? t('alert.presetNotFound', { name: presetName }) : `Preset "${presetName}" not found`);
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
      centerAndFitGoban();
      showRulesDialog(() => enterPlayMode());
    })
    .catch(err => {
      alert(window.t ? t('alert.presetLoadError', { message: err.message }) : `Error loading preset: ${err.message}`);
      showMainMenu();
    });
}

// 3D spherical goban entry point. Generates the mesh procedurally (no JSON
// file), installs it into vertices/quads, switches the canvas to WEBGL so
// star_domination.js can draw, then follows the normal play-mode flow.
// `size` is 'small' | 'medium' | 'large' — passed through to generateMesh.
function loadStarDominationGoban(size) {
  if (!window.StarDomination) {
    alert('StarDomination module missing');
    showMainMenu();
    return;
  }
  document.getElementById('starDominationMenu').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  const placeholder = document.getElementById('roomPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  currentScreen = 'play';

  // 1. Generate the mesh. This is a one-shot synchronous compute that runs
  // icosphere → merge → quadrangulate → compensated relax. Larger sizes take
  // a noticeable fraction of a second.
  const mesh = window.StarDomination.generateMesh(size || 'small');

  // 2. Install into the game's globals in the format restoreGoban uses, with
  // pos3 attached so the 3D renderer can read it back.
  vertices = [];
  edges = [];
  edgeByKey.clear();
  edgeTris.clear();
  triangles = [];
  quads = [];
  for (let i = 0; i < mesh.verts.length; i++) {
    const p = mesh.verts[i];
    vertices.push({
      id: i,
      x: 0, y: 0, // unused in 3D mode, but some 2D-assuming code may read them
      type: 'inner', q: 0, r: 0,
      neighbors: new Set(),
      triangles: new Set(),
      quads: new Set(),
      peers: [i, i, i],
      visible: true,
      pos3: { x: p.x, y: p.y, z: p.z },
    });
  }
  mesh.quads.forEach((q, idx) => {
    quads.push({ id: idx, verts: q.verts.slice(), active: true });
  });
  rebuildEdgesFromFaces(); // populates vertices[].neighbors from quad edges
  markVisibleVertices();

  // 3. Activate the three.js renderer (spawns its canvas, starts RAF loop)
  //    and hide the p5 canvas.
  window.StarDomination.activate();
  ensureCanvas();
  // p5's draw loop isn't needed for the 3D mode, but leave it running in
  // case other 2D overlays want a redraw later.
  noLoop();

  // 4. Show rules dialog, then enter play mode.
  showRulesDialog(() => enterPlayMode());
}

function showSettings() {
  // Settings screen - placeholder for now
  alert(window.t ? t('alert.settingsComingSoon') : 'Settings - coming soon');
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
  const relaxTestBtn = document.getElementById('relaxTestBtn');
  if (relaxTestBtn) {
    relaxTestBtn.addEventListener('click', startRelaxationTest);
  }
  const relaxCoulombBtn = document.getElementById('relaxCoulombBtn');
  if (relaxCoulombBtn) {
    relaxCoulombBtn.addEventListener('click', startRelaxationCoulomb);
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
  // Handlers are wired once in setupMenuListeners(). Only refresh per-game
  // state here (enable/disable, multiplayer-conditional labels).
  saveLoadStatusEl = document.getElementById('gameLoadStatus');
  const aiMoveBtn = document.getElementById('aiMoveBtn');
  if (aiMoveBtn) {
    if (window.multiplayerState?.active) {
      aiMoveBtn.disabled = true;
      aiMoveBtn.textContent = window.t ? t('play.aiMoveOffline') : 'AI Move (offline)';
    } else {
      aiMoveBtn.disabled = false;
    }
  }
  // Per-player clocks are only shown for competitive multiplayer games where
  // both seats are filled. Solo / study / spectator views hide them.
  const clockBox = document.getElementById('clockBox');
  if (clockBox) {
    const ms = window.multiplayerState;
    const competitive = ms?.active
      && (ms.color === 'black' || ms.color === 'white')
      && (ms.memberCount || 0) >= 2
      && ms.colorMode !== 'study';
    clockBox.style.display = competitive ? 'flex' : 'none';
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
  if (saveLoadStatusEl) saveLoadStatusEl.textContent = window.t ? t('play.savedAs', { name: fname }) : `Saved ${fname}`;
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
          centerAndFitGoban();
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
          if (saveLoadStatusEl) saveLoadStatusEl.textContent = window.t ? t('play.gameLoaded') : 'Game loaded';
        } else {
          if (saveLoadStatusEl) saveLoadStatusEl.textContent = window.t ? t('play.notAGameFile') : 'Not a game file';
        }
      } catch (e) {
        console.error('Failed to load game', e);
        if (saveLoadStatusEl) saveLoadStatusEl.textContent = window.t ? t('play.loadFailed') : 'Load failed';
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

let _resizeRaf = null;
function windowResized() {
  if (!canvasCreated) {
    refreshViewportUi();
    return;
  }
  if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = null;
    const oldCX = width / 2;
    const oldCY = height / 2;
    ensureCanvas();
    if (vertices.length > 0) {
      // In play mode (or after a board has been laid out) keep the goban
      // centered and fit to the new viewport. In editor mode, preserve the
      // user's in-progress layout by only shifting to keep it centered.
      if (currentScreen === 'play' || currentScreen === 'random') {
        centerAndFitGoban();
      } else {
        const dx = width / 2 - oldCX;
        const dy = height / 2 - oldCY;
        if (dx !== 0 || dy !== 0) {
          for (const v of vertices) {
            v.x += dx;
            v.y += dy;
          }
          for (const e of edges) {
            if (!e.active) continue;
            const a = vertices[e.a];
            const b = vertices[e.b];
            if (a && b) e.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          }
        }
      }
    }
    refreshViewportUi();
    redraw();
  });
}

// Refresh viewport-dependent UI bits (mobile confirm button, etc.)
function refreshViewportUi() {
  const confirmBtn = document.getElementById('mobileConfirmBtn');
  if (confirmBtn) {
    // Use window.innerWidth (always fresh) rather than p5's windowWidth —
    // the latter can be stale when p5's draw loop is paused (e.g. in 3D mode).
    const narrow = (window.innerWidth <= 600);
    confirmBtn.style.display = (currentScreen === 'play' && narrow) ? 'block' : 'none';
  }
}

function draw() {
  // 3D spherical goban runs on its own three.js canvas + RAF loop (see
  // star_domination.js). p5's draw path is bypassed entirely in that mode.
  if (window.StarDomination && window.StarDomination.active) {
    return;
  }

  clear();
  drawGobanBorder();
  drawSectors();
  drawFaces();
  drawEdges();
  drawVertices();
  drawSymbols();
  drawCoulombDebug();
  if (mode === 'play') {
    drawStones();
    drawStonePreview();
  }

  if (relaxing) {
    relaxFrame++;
    updateRelaxStatus();
    if (relaxFrame < relaxMaxFrames) {
      if (relaxMode === 'compensated') relaxVerticesCompensated(1);
      else if (relaxMode === 'coulomb') relaxVerticesCoulomb(1);
      else relaxVertices(1);
    } else {
      relaxing = false;
      relaxMode = 'standard';
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
        alert(window.t ? t('alert.autoRemoveFail', { n: autoRemoveMaxRetries }) : `Failed to achieve full quads after ${autoRemoveMaxRetries} attempts. Reverting.`);
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
  // 3D mode: three.js attaches its own DOM mouse listeners, so p5's handler
  // is a no-op in that mode.
  if (window.StarDomination && window.StarDomination.active) return;
  updateHover();
}

// Shared placement logic used by both click (desktop) and confirm button (mobile)
function tryPlaceAtHover() {
  if (hoverVertex === null) return false;
  if (window.multiplayerState?.active) {
    const ms = window.multiplayerState;
    const isSpectator = (ms.role || '').toLowerCase() === 'spectator';
    const hasOpponent = (ms.memberCount || 0) >= 2;
    let allowed;
    if (isSpectator) {
      allowed = false;
    } else if (ms.color === 'study') {
      allowed = true;
    } else if (!ms.color) {
      allowed = !hasOpponent;
    } else {
      allowed = !hasOpponent || ms.color === currentPlayer;
    }
    console.log('[MP place] color:', ms.color, 'currentPlayer:', currentPlayer, 'allowed:', allowed);
    if (!allowed) return false;
  }
  if (markingDeadStones) {
    toggleDeadStone(hoverVertex);
  } else {
    placeStone(hoverVertex);
  }
  return true;
}

function mousePressed() {
  if (window.StarDomination && window.StarDomination.active) return;
  if (mode === 'delete-edge' && hoverEdge !== null) {
    deleteEdgeMirrored(hoverEdge);
    redraw();
    return;
  }
  if (mode === 'play' && hoverVertex !== null) {
    // On mobile, stone placement is handled by the confirm button, not direct tap
    if (windowWidth <= 600) return;
    if (tryPlaceAtHover()) redraw();
    return;
  }
  if (mode === 'move-vertex' && hoverVertex !== null) {
    const v = vertices[hoverVertex];
    if (v.type === 'edge' || v.type === 'center') return;
    dragging = hoverVertex;
  }
}

// Mobile touch: drag finger to select nearest vertex, confirm button to place
function touchStarted(event) {
  // 3D mode: star_domination.js owns touch on its own canvas. Do nothing
  // here or we double-fire and corrupt state.
  if (window.StarDomination && window.StarDomination.active) return;
  // Only intercept touches directly on the canvas — let button/UI taps through
  if (!event || !event.target || event.target.tagName !== 'CANVAS') return;
  if (touches.length === 0) return false;
  const t = touches[0];
  if (t.y > height) return false; // touch is in the panel area — ignore
  if (mode === 'play') {
    hoverVertex = nearestVertex(t.x, t.y);
    pendingVertex = hoverVertex;
    redraw();
  }
  return false; // prevent browser scroll/zoom on canvas
}

function touchMoved(event) {
  if (window.StarDomination && window.StarDomination.active) return;
  if (!event || !event.target || event.target.tagName !== 'CANVAS') return;
  if (touches.length === 0) return false;
  const t = touches[0];
  if (t.y > height) return false;
  if (mode === 'play') {
    hoverVertex = nearestVertex(t.x, t.y);
    pendingVertex = hoverVertex;
    redraw();
  }
  return false;
}

function touchEnded(event) {
  if (window.StarDomination && window.StarDomination.active) return;
  if (!event || !event.target || event.target.tagName !== 'CANVAS') return;
  // Keep pendingVertex alive so the confirm button can use it
  hoverVertex = pendingVertex;
  return false; // prevent browser default only for canvas touches
}

// Called by the mobile confirm button
window.confirmStonePlacement = function () {
  if (mode !== 'play') return;
  // Restore pendingVertex in case hoverVertex was cleared by mouseMoved
  if (hoverVertex === null && pendingVertex !== null) hoverVertex = pendingVertex;
  if (tryPlaceAtHover()) {
    pendingVertex = null;
    hoverVertex = null;
    redraw();
  }
};

function mouseDragged() {
  if (window.StarDomination && window.StarDomination.active) return;
  if (dragging === null) return;
  const dx = movedX;
  const dy = movedY;
  moveVertexMirrored(dragging, dx, dy);
  redraw();
}

function mouseReleased() {
  if (window.StarDomination && window.StarDomination.active) return;
  if (dragging !== null) {
    window.dragStateCapture = false;
  }
  dragging = null;
}

function doubleClicked() {
  // 3D mode: three.js attaches its own dblclick listener.
  if (window.StarDomination && window.StarDomination.active) return;
}

function mouseWheel(event) {
  // 3D mode: three.js handles wheel on its own canvas.
  if (window.StarDomination && window.StarDomination.active) return;
}

function handlePass(isRemote = false) {
  if (gameEnded || markingDeadStones) return;
  
  if (lastMoveWasPass) {
    // Two consecutive passes - game ends
    gameEnded = true;
    markingDeadStones = true;
    document.getElementById('gameStatusRow').style.display = 'block';
    document.getElementById('gameStatus').textContent = window.t ? t('play.gameEnded') : 'Game ended. Mark dead stones.';
    document.getElementById('deadStoneRow').style.display = 'block';
    // Reset finish-marking confirmation state for the new round.
    const finishBtn = document.getElementById('finishMarkingBtn');
    if (finishBtn) finishBtn.disabled = false;
    const progEl = document.getElementById('markingProgress');
    if (progEl) progEl.textContent = '';
    refreshTurnBanner();
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
  if (!isRemote) appendLocalMove({ type: 'pass' });
}

function toggleDeadStone(vid, fromRemote) {
  if (!gameStones.has(vid)) return;

  // Spectators don't get to mark; only the seated players do.
  if (!fromRemote && window.multiplayerState?.active) {
    const c = window.multiplayerState.color;
    if (c !== 'black' && c !== 'white' && c !== 'study') return;
  }

  const group = getGroup(vid);
  const allDead = Array.from(group).every(v => deadStones.has(v));
  const nowDead = !allDead;

  if (allDead) {
    for (const v of group) deadStones.delete(v);
  } else {
    for (const v of group) deadStones.add(v);
  }

  // Mirror the toggle to the other player. Send a single representative vid
  // — the receiver will resolve the same group via getGroup(vid).
  if (!fromRemote && window.multiplayerSendDeadMark) {
    window.multiplayerSendDeadMark(vid, nowDead);
  }

  redraw();
}

// Called by multiplayer.js when the opposing player toggles a dead-stone group.
window.applyRemoteDeadMark = (vid, dead) => {
  if (!markingDeadStones || !gameStones.has(vid)) return;
  const group = getGroup(vid);
  if (dead) {
    for (const v of group) deadStones.add(v);
  } else {
    for (const v of group) deadStones.delete(v);
  }
  redraw();
};

// Called by multiplayer.js when the server confirms one or both finishMarking
// confirmations. Used to update the "waiting for opponent" status text.
window.applyMarkingProgress = (finishedColors) => {
  const el = document.getElementById('markingProgress');
  if (!el) return;
  if (!Array.isArray(finishedColors) || finishedColors.length === 0) {
    el.textContent = '';
    return;
  }
  if (finishedColors.length >= 2) {
    el.textContent = window.t ? t('gameEnd.markingDone') : 'Both players ready.';
  } else {
    el.textContent = window.t ? t('gameEnd.markingWaiting') : 'Waiting for opponent to confirm…';
  }
};

// Called by multiplayer.js when the server emits game:end. Cleans up the
// marking UI; the modal is rendered by multiplayer.js itself.
window.applyGameEnded = (payload) => {
  markingDeadStones = false;
  gameEnded = true;
  const deadStoneRow = document.getElementById('deadStoneRow');
  const gameStatusRow = document.getElementById('gameStatusRow');
  const markingProg = document.getElementById('markingProgress');
  const clockBox = document.getElementById('clockBox');
  if (deadStoneRow) deadStoneRow.style.display = 'none';
  if (gameStatusRow) gameStatusRow.style.display = 'none';
  if (markingProg) markingProg.textContent = '';
  if (clockBox) clockBox.style.display = 'none';
  // Score row stays so players can see the final tally if it was a points win.
  if (payload && (payload.blackTotal != null || payload.whiteTotal != null)) {
    try {
      renderScore({
        blackTotal: payload.blackTotal,
        whiteTotal: payload.whiteTotal,
        komi: payload.komi,
        // best-effort: we don't have the territory breakdown from the server
        blackTerritory: 0, whiteTerritory: 0, neutral: 0,
        blackStones: 0, whiteStones: 0,
      });
    } catch {}
  }
  refreshTurnBanner();
  redraw();
};

function finishMarkingDeadStones() {
  // In multiplayer competitive games, both players must confirm. Don't tear
  // down the marking UI yet — wait for the server's game:end event.
  const ms = window.multiplayerState;
  const competitive = ms?.active && (ms.color === 'black' || ms.color === 'white') && (ms.memberCount || 0) >= 2;

  // Compute current proposed score using local dead-stone marks.
  const score = computeTrompTaylorScore();
  const result = {
    blackTotal: score.blackTotal,
    whiteTotal: score.whiteTotal,
    diff: Math.abs(score.blackTotal - score.whiteTotal),
    winner: score.blackTotal === score.whiteTotal ? 'tie'
          : score.blackTotal > score.whiteTotal ? 'black' : 'white',
    komi: score.komi,
  };

  if (competitive) {
    // Notify server. UI stays in marking mode until both confirmations arrive
    // and the server emits game:end (which calls applyGameEnded).
    if (window.multiplayerSendFinishMarking) window.multiplayerSendFinishMarking(result);
    const finishBtn = document.getElementById('finishMarkingBtn');
    if (finishBtn) finishBtn.disabled = true;
    const progEl = document.getElementById('markingProgress');
    if (progEl) progEl.textContent = window.t ? t('gameEnd.markingWaiting') : 'Waiting for opponent to confirm…';
    renderScore(score); // show local proposed score for feedback
    redraw();
    return;
  }

  // Solo / study path: end the game locally.
  markingDeadStones = false;
  document.getElementById('deadStoneRow').style.display = 'none';
  document.getElementById('gameStatusRow').style.display = 'none';
  renderScore(score);
  redraw();

  if (ms?.active) {
    // Study mode in a room — still let the server know via legacy game:end.
    if (window.multiplayerSendGameEnd) window.multiplayerSendGameEnd(result);
  } else {
    saveLocalRecord(result);
  }
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

function drawCoulombDebug() {
  if (!coulombDebug || coulombDebug.vid == null) return;
  const v = vertices[coulombDebug.vid];
  if (!v) return;

  // Raw magnitudes — no clamping. One global scale so arrows compare honestly.
  // Largest per-frame force maps to ~60 px; everything else is proportional.
  let maxMag = 1e-9;
  for (const f of coulombDebug.forces) {
    const m = Math.hypot(f.fx, f.fy);
    if (isFinite(m) && m > maxMag) maxMag = m;
  }
  const netMag = Math.hypot(coulombDebug.net.fx, coulombDebug.net.fy);
  maxMag = Math.max(maxMag, netMag);
  const scale = 60 / maxMag;

  push();

  // Highlight the anchor vertex.
  noStroke();
  fill(255, 80, 80, 220);
  circle(v.x, v.y, 12);

  // Partner lines (faint) + per-partner force arrows.
  // Red = repulsive (outward from partner), green = attractive (toward partner).
  for (const f of coulombDebug.forces) {
    if (!isFinite(f.fx) || !isFinite(f.fy)) continue;

    stroke(255, 255, 255, 60);
    strokeWeight(1);
    line(v.x, v.y, f.px, f.py);

    const endX = v.x + f.fx * scale;
    const endY = v.y + f.fy * scale;
    // Dot product of force with (v-p) tells us attractive vs repulsive.
    const dx = v.x - f.px, dy = v.y - f.py;
    const outward = f.fx * dx + f.fy * dy > 0;
    if (outward) stroke(255, 70, 70, 220);   // red = repulsive
    else         stroke(90, 220, 120, 220);  // green = attractive
    strokeWeight(2);
    line(v.x, v.y, endX, endY);
    drawArrowHead(v.x, v.y, endX, endY, 6);
  }

  // Net force (cyan, bold).
  if (isFinite(coulombDebug.net.fx) && isFinite(coulombDebug.net.fy)) {
    stroke(90, 230, 255, 240);
    strokeWeight(3);
    const netEndX = v.x + coulombDebug.net.fx * scale;
    const netEndY = v.y + coulombDebug.net.fy * scale;
    line(v.x, v.y, netEndX, netEndY);
    drawArrowHead(v.x, v.y, netEndX, netEndY, 9);
  }

  // Label: id + partner count + max/net magnitudes.
  noStroke();
  fill(255);
  textAlign(LEFT, BOTTOM);
  textSize(12);
  text(`vid=${v.id}  partners=${coulombDebug.forces.length}  maxF=${maxMag.toExponential(2)}  netF=${netMag.toExponential(2)}`, v.x + 10, v.y - 10);

  pop();
}

function drawArrowHead(x1, y1, x2, y2, size) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const baseX = x2 - ux * size;
  const baseY = y2 - uy * size;
  line(x2, y2, baseX + px * size * 0.5, baseY + py * size * 0.5);
  line(x2, y2, baseX - px * size * 0.5, baseY - py * size * 0.5);
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
    alert(window.t ? t('alert.relaxOnlyQuads') : 'Relaxation only available when all faces are quads (no triangles).');
    return;
  }
  captureState('relaxation');
  relaxMode = 'standard';
  relaxing = true;
  relaxFrame = 0;
  updateRelaxStatus();
  loop(); // kick off the draw loop so relaxation animates without waiting for mouse movement
}

function startRelaxationTest() {
  const triCount = triangles.filter((t) => t.active).length;
  if (triCount > 0) {
    alert(window.t ? t('alert.relaxOnlyQuads') : 'Relaxation only available when all faces are quads (no triangles).');
    return;
  }
  captureState('relaxation');
  relaxMode = 'compensated';
  relaxing = true;
  relaxFrame = 0;
  updateRelaxStatus();
  loop();
}

function startRelaxationCoulomb() {
  // Coulomb mode works regardless of face types — it operates only on
  // vertices and active edges, so triangles are fine.
  captureState('relaxation');
  relaxMode = 'coulomb';
  relaxing = true;
  relaxFrame = 0;
  relaxMaxFrames = 60; // more iterations, smaller per-step → stable settling
  // Keep the same debug anchor across runs so the user can watch one vertex
  // settle over time. Only pick fresh if nothing is selected yet or the
  // previous pick is no longer movable.
  const valid = coulombDebug && coulombDebug.vid != null
    && vertices[coulombDebug.vid] && vertices[coulombDebug.vid].type !== 'edge';
  if (!valid) {
    const movable = vertices.filter(v => v.type !== 'edge');
    coulombDebug = movable.length
      ? { vid: movable[(Math.random() * movable.length) | 0].id, forces: [], net: { fx: 0, fy: 0 } }
      : null;
  } else {
    coulombDebug.forces = [];
    coulombDebug.net = { fx: 0, fy: 0 };
  }
  updateRelaxStatus();
  loop();
}

// Console helpers: set a specific vertex or re-randomize the debug anchor.
window.setCoulombDebugVertex = (vid) => {
  if (vertices[vid]) {
    coulombDebug = { vid, forces: [], net: { fx: 0, fy: 0 } };
    redraw();
  }
};
window.resetCoulombDebug = () => {
  const movable = vertices.filter(v => v.type !== 'edge');
  coulombDebug = movable.length
    ? { vid: movable[(Math.random() * movable.length) | 0].id, forces: [], net: { fx: 0, fy: 0 } }
    : null;
  redraw();
};

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

// Experimental: degree-compensated relaxation. Quads touching low-degree
// (3-neighbor) vertices feel crowded, while quads with 5- or 6-neighbor
// corners feel spacious. We bias each quad's target area by the sum of its
// corner degree deficits (4 - degree), so low-degree-cornered quads settle
// larger and high-degree-cornered quads settle smaller.
function relaxVerticesCompensated(iterations) {
  const COMP_K = 0.18; // per-unit deficit compensation strength
  const MIN_TARGET = 0.4;
  for (let it = 0; it < iterations; it++) {
    // Vertex edge-graph degree from active edges.
    const degree = new Array(vertices.length).fill(0);
    for (const e of edges) {
      if (!e.active) continue;
      degree[e.a]++;
      degree[e.b]++;
    }

    for (const q of quads) {
      if (!q.active) continue;
      q.area = calculateQuadArea(q);
      let deficit = 0;
      for (const vid of q.verts) deficit += (4 - (degree[vid] || 0));
      q.targetMultiplier = Math.max(MIN_TARGET, 1 + COMP_K * deficit);
    }

    const adjFaces = new Map();
    for (const v of vertices) adjFaces.set(v.id, []);
    for (const q of quads) {
      if (!q.active) continue;
      for (const vid of q.verts) adjFaces.get(vid).push(q);
    }

    const adjustments = new Map();
    for (const v of vertices) {
      if (v.type === 'edge') continue;
      const faces = adjFaces.get(v.id) || [];
      if (faces.length === 0) continue;

      let weightedX = 0, weightedY = 0, totalWeight = 0;
      for (const face of faces) {
        const centroid = getFaceCentroid(face);
        const weight = (face.area || 1) / (face.targetMultiplier || 1);
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

    adjustments.forEach((centroid, vid) => {
      const v = vertices[vid];
      v.x += (centroid.x - v.x) * relaxationStrength;
      v.y += (centroid.y - v.y) * relaxationStrength;
    });

    refreshAllEdgeMidpoints();
  }
}

// Experimental: force-directed relaxation, van der Waals-like.
//
// Every pair of vertices that co-inhabit a face (quad or triangle) has a
// rest length and interacts through two terms:
//   - Truncated repulsion: Q² · (1/r² − 1/rest²) when r < rest, else 0.
//     Strong when close, smoothly vanishes at r = rest so it never fights
//     the spring past equilibrium.
//   - Hookean spring: k · (r − rest). Zero at r = rest, pulls inward beyond,
//     pushes outward when compressed.
// Rest lengths: edges of a face → L; diagonals of a quad → L·√2. Pair
// weight = number of faces the pair co-inhabits.
//
// Together the two terms define a clean equilibrium at r = rest for every
// face-sharing pair, so the mesh converges to the target lattice instead
// of drifting under unbalanced repulsion.
//
// Update order: Gauss-Seidel — each iteration vertices are visited in a
// freshly-shuffled order and the displacement is applied immediately, so
// later vertices already see the updated positions of earlier ones.
function relaxVerticesCoulomb(iterations) {
  // Mean active-edge length → rest length L.
  let sumLen = 0, edgeCount = 0;
  for (const e of edges) {
    if (!e.active) continue;
    const a = vertices[e.a], b = vertices[e.b];
    sumLen += Math.hypot(a.x - b.x, a.y - b.y);
    edgeCount++;
  }
  const L = edgeCount > 0 ? sumLen / edgeCount : (typeof spacing !== 'undefined' ? spacing : 50);

  const Q2 = 0.3 * L * L;
  const kSpring = 0.25;
  const globalDamping = 0.25;
  const maxStep = L * 0.02;
  const SQRT2 = Math.SQRT2;

  // Build pair map: every face-sharing pair gets a weight (# of faces it
  // co-inhabits) and a rest length. Edge beats diagonal if a pair happens
  // to appear as both (e.g. shared between a quad's edge and another face).
  const N = vertices.length;
  const pairs = new Map(); // key → { a, b, w, rest }
  const keyOf = (a, b) => a < b ? a * N + b : b * N + a;
  const addPair = (a, b, rest) => {
    const k = keyOf(a, b);
    const info = pairs.get(k);
    if (info) {
      info.w += 1;
      if (rest < info.rest) info.rest = rest;
    } else {
      pairs.set(k, { a: Math.min(a, b), b: Math.max(a, b), w: 1, rest });
    }
  };
  const addFace = (verts) => {
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      addPair(verts[i], verts[(i + 1) % n], L);
    }
    if (n === 4) {
      addPair(verts[0], verts[2], L * SQRT2);
      addPair(verts[1], verts[3], L * SQRT2);
    }
  };
  for (const q of quads)     if (q.active) addFace(q.verts);
  for (const t of triangles) if (t.active) addFace(t.verts);

  // Per-vertex partner list with rest length for each partner.
  const partners = new Array(N);
  for (let i = 0; i < N; i++) partners[i] = [];
  for (const info of pairs.values()) {
    partners[info.a].push({ pid: info.b, w: info.w, rest: info.rest });
    partners[info.b].push({ pid: info.a, w: info.w, rest: info.rest });
  }

  // Movable (non-boundary) vertex ids.
  const movable = [];
  for (const v of vertices) if (v.type !== 'edge') movable.push(v.id);

  for (let it = 0; it < iterations; it++) {
    // Fresh random sweep order each iteration (Fisher-Yates).
    for (let i = movable.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = movable[i]; movable[i] = movable[j]; movable[j] = tmp;
    }

    for (const vid of movable) {
      const v = vertices[vid];
      let fxv = 0, fyv = 0;

      const capture = coulombDebug && coulombDebug.vid === vid;
      if (capture) coulombDebug.forces = [];

      for (const { pid, w, rest } of partners[vid]) {
        const p = vertices[pid];
        const dx = v.x - p.x;
        const dy = v.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 === 0) continue;
        const d  = Math.sqrt(d2);
        const ux = dx / d, uy = dy / d;

        // Outward-positive scalar force.
        const rest2 = rest * rest;
        const fRep    = d < rest ? w * Q2 * (1 / d2 - 1 / rest2) : 0;
        const fSpring = -w * kSpring * (d - rest); // <0 when d>rest → inward
        const fScalar = fRep + fSpring;
        const fx = fScalar * ux;
        const fy = fScalar * uy;
        fxv += fx;
        fyv += fy;
        if (capture) coulombDebug.forces.push({ px: p.x, py: p.y, fx, fy, w });
      }
      if (capture) coulombDebug.net = { fx: fxv, fy: fyv };

      let sdx = fxv * globalDamping;
      let sdy = fyv * globalDamping;
      const mag = Math.hypot(sdx, sdy);
      if (mag > maxStep) {
        const s = maxStep / mag;
        sdx *= s; sdy *= s;
      }
      v.x += sdx;
      v.y += sdy;
    }

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
    showRulesDialog(() => enterPlayMode());
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
  const finishBtn = document.getElementById('finishMarkingBtn');
  if (finishBtn) finishBtn.disabled = false;
  const markingProg = document.getElementById('markingProgress');
  if (markingProg) markingProg.textContent = '';
  
  const snapshot = captureGameState('start');
  gameUndoStack = [snapshot];
  gameUndoIndex = 0;
  updateUndoUI();
  if (window.multiplayerSyncState) window.multiplayerSyncState();
  // New game — begin a fresh local record (no-op in multiplayer; server owns those).
  beginLocalRecord();
}

function drawStones() {
  const es = effectiveSpacing();
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
      circle(v.x, v.y, es * 0.76);
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
      circle(v.x, v.y, es * 0.65);
      // Shine effect
      fill(80, 80, 90, isDead ? 60 : 120);
      circle(v.x - es*0.08, v.y - es*0.08, es * 0.25);
    } else {
      if (isDead) {
        fill(250, 250, 245, 100); // Faded for dead stones
      } else {
        fill(250, 250, 245);
      }
      circle(v.x, v.y, es * 0.65);
      // Shadow effect
      fill(200, 200, 195, isDead ? 40 : 80);
      circle(v.x + es*0.06, v.y + es*0.06, es * 0.25);
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
  const es = effectiveSpacing();
  // Draw a preview stone on the hovered vertex
  if (hoverVertex !== null && !gameStones.has(hoverVertex)) {
    const v = vertices[hoverVertex];
    if (v && v.visible !== false) {
      push();
      noStroke();
      if (currentPlayer === 'black') {
        fill(20, 20, 25, 150);
        circle(v.x, v.y, es * 0.65);
        fill(80, 80, 90, 80);
        circle(v.x - es*0.08, v.y - es*0.08, es * 0.25);
      } else {
        fill(250, 250, 245, 150);
        circle(v.x, v.y, es * 0.65);
        fill(200, 200, 195, 60);
        circle(v.x + es*0.06, v.y + es*0.06, es * 0.25);
      }
      pop();
    }
  }

  // Ghost stone following mouse cursor (desktop only)
  if (windowWidth > 600) {
    push();
    noStroke();
    if (currentPlayer === 'black') fill(20, 20, 25, 80);
    else fill(250, 250, 245, 80);
    circle(mouseX, mouseY, es * 0.5);
    pop();
  }
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

  if (!options.remote) {
    appendLocalMove({ type: 'place', vid, color: moveColor });
  }

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

  if (turnEl) turnEl.textContent = window.t ? t(currentPlayer === 'black' ? 'room.black' : 'room.white') : (currentPlayer === 'black' ? 'Black' : 'White');
  if (capBlackEl) capBlackEl.textContent = capturedBlack;
  if (capWhiteEl) capWhiteEl.textContent = capturedWhite;
  if (gameInfoEl) gameInfoEl.textContent = '';
  if (window.multiplayerUpdateTurn) window.multiplayerUpdateTurn();
  refreshTurnBanner();
}

// Visual cue for whose turn it is. Banner is only shown in multiplayer
// competitive games (i.e. local player has a black/white color and an
// opponent is present); hidden for solo / study / spectator / pre-game.
function refreshTurnBanner() {
  const banner = document.getElementById('turnBanner');
  const text = document.getElementById('turnBannerText');
  if (!banner || !text) return;
  const ms = window.multiplayerState;
  const inGame = mode === 'play' && currentScreen === 'play';
  const competitive = ms && ms.active && (ms.color === 'black' || ms.color === 'white') && (ms.memberCount || 0) >= 2 && ms.colorMode !== 'study';

  // Clock box shows only for competitive multiplayer.
  const clockBox = document.getElementById('clockBox');
  if (clockBox) {
    clockBox.style.display = (inGame && competitive && !gameEnded) ? 'flex' : 'none';
  }

  if (!inGame || gameEnded || markingDeadStones) {
    banner.classList.remove('visible', 'turn-yours', 'turn-opponent');
    return;
  }

  const colorWord = (window.t
    ? t(currentPlayer === 'black' ? 'room.black' : 'room.white')
    : (currentPlayer === 'black' ? 'Black' : 'White'));

  banner.classList.add('visible');

  if (!competitive) {
    // Solo / study / spectator — neutral indicator with no pulse / chime.
    banner.classList.add('turn-opponent');
    banner.classList.remove('turn-yours');
    text.textContent = (window.t ? t('play.turn') : 'Turn') + ': ' + colorWord;
    banner.dataset.lastYours = '0';
    return;
  }

  const yours = ms.color === currentPlayer;
  if (yours) {
    banner.classList.add('turn-yours');
    banner.classList.remove('turn-opponent');
    text.textContent = window.t ? t('play.yourTurn', { color: colorWord })
                                 : `Your turn (${colorWord})`;
    if (banner.dataset.lastYours !== '1') {
      try { playTurnChime(); } catch {}
    }
    banner.dataset.lastYours = '1';
  } else {
    banner.classList.add('turn-opponent');
    banner.classList.remove('turn-yours');
    text.textContent = window.t ? t('play.opponentTurn') : 'Waiting for opponent…';
    banner.dataset.lastYours = '0';
  }
}

let _turnAudioCtx = null;
function playTurnChime() {
  if (!('AudioContext' in window || 'webkitAudioContext' in window)) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!_turnAudioCtx) _turnAudioCtx = new Ctx();
  const ctx = _turnAudioCtx;
  if (ctx.state === 'suspended') ctx.resume?.();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(660, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.2);
}

window.refreshTurnBanner = refreshTurnBanner;

// ---- Auto edge removal ----
function startAutoRemoveEdges() {
  const triCount = triangles.filter((t) => t.active).length;
  if (triCount === 0) {
    alert(window.t ? t('alert.noTriangles') : 'No triangles to remove.');
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

function scaleGridByFactor(factor, cx, cy) {
  const centerX = (typeof cx === 'number') ? cx : width / 2;
  const centerY = (typeof cy === 'number') ? cy : height / 2;

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

// Compute layout-aware target center and a canvas margin proportional to the
// smaller canvas dimension. On iPad-class widths (room panel visible but not
// collapsed to bottom-sheet), shift the target center to the right by
// menu_width/2 so the goban is centered in the area to the right of the menu.
function computeBoardLayout() {
  // Margin = small percentage of min(width, height). On a tall narrow phone
  // this prevents huge top/bottom empty space; on a wide canvas it prevents
  // ribbons of side margin.
  const minDim = Math.min(width, height);
  const margin = Math.max(8, minDim * 0.025); // 2.5%, never less than 8px
  let centerX = width / 2;
  const centerY = height / 2;
  const availableWidth = width - 2 * margin;
  const availableHeight = height - 2 * margin;

  // iPad / desktop with side panel: shift the goban center right by half the
  // panel footprint so the menu doesn't cover stones — but DO NOT shrink the
  // goban. If shifting fully would push the right edge past the canvas, clamp
  // the shift so the goban still fits.
  const panelEl = document.getElementById('roomPanel');
  if (panelEl && currentScreen === 'play' && windowWidth > 600) {
    const rect = panelEl.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.right > 0 && rect.left < width) {
      const panelFootprint = Math.min(width, rect.right);
      const naturalRight = width / 2 + availableWidth / 2;
      const rightSlack = Math.max(0, width - margin - naturalRight);
      const desiredShift = panelFootprint / 2;
      const shift = Math.min(desiredShift, rightSlack);
      centerX = width / 2 + shift;
    }
  }
  return { centerX, centerY, availableWidth, availableHeight };
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

  const layout = computeBoardLayout();

  const offsetX = layout.centerX - currentCenterX;
  const offsetY = layout.centerY - currentCenterY;

  // Apply translation
  for (const v of vertices) {
    v.x += offsetX;
    v.y += offsetY;
  }

  // Scale to fit available area (margin proportional to canvas size).
  const scaleX = layout.availableWidth / currentWidth;
  const scaleY = layout.availableHeight / currentHeight;
  const scale = Math.min(scaleX, scaleY);

  // Apply scaling from the layout center (not always width/2 — on iPad the
  // center is shifted right by menu_width/2).
  if (Math.abs(scale - 1.0) > 0.001) {
    scaleGridByFactor(scale, layout.centerX, layout.centerY);
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

// ---- Save/Load Goban (server-backed) ----
function buildCurrentGobanData() {
  return {
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
}

function saveGoban() {
  openGobanModal('save');
}

function startLoadGoban() {
  document.getElementById('app').style.display = 'block';
  document.getElementById('presetMenu').style.display = 'none';
  const placeholder = document.getElementById('roomPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  showPanelSection('edit');
  currentScreen = 'editor';
  if (!canvasCreated) ensureCanvas();
  openGobanModal('load');
}

function loadGoban() {
  openGobanModal('load');
}

function applyLoadedGoban(json) {
  restoreGoban(json);
  centerAndFitGoban();
  if (saveLoadStatusEl) saveLoadStatusEl.textContent = window.t ? t('play.gobanLoaded') : 'Goban loaded';
  mode = 'move-vertex';
  captureState('initial');
  updateUiCounts();
  setupEditorButtons();
  redraw();
}

let _gobanFilter = 'official';
let _gobanSearch = '';

function openGobanModal(mode) {
  const modal = document.getElementById('gobanModal');
  const title = document.getElementById('gobanModalTitle');
  const saveRow = document.getElementById('gobanSaveRow');
  const filterRow = document.getElementById('gobanFilterRow');
  const list = document.getElementById('gobanList');
  const search = document.getElementById('gobanSearchInput');
  const nameInput = document.getElementById('gobanSaveName');
  const t = window.t || ((k) => k);
  if (mode === 'save') {
    title.textContent = t('goban.modal.saveTitle');
    saveRow.style.display = 'block';
    filterRow.style.display = 'flex';
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 50);
  } else {
    title.textContent = t('goban.modal.loadTitle');
    saveRow.style.display = 'none';
    filterRow.style.display = 'flex';
  }
  list.innerHTML = '';
  search.value = _gobanSearch;
  modal.style.display = 'flex';
  refreshGobanList();
  refreshGobanFilterButtons();
}

function refreshGobanFilterButtons() {
  document.querySelectorAll('.goban-filter-btn').forEach((btn) => {
    if (btn.dataset.filter === _gobanFilter) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

async function refreshGobanList() {
  const list = document.getElementById('gobanList');
  const t = window.t || ((k) => k);
  list.textContent = t('records.loading');
  const params = new URLSearchParams({ filter: _gobanFilter });
  if (_gobanSearch) params.set('q', _gobanSearch);
  let data;
  try {
    const res = await fetch('/api/gobans?' + params.toString());
    if (!res.ok) throw new Error('failed');
    data = await res.json();
  } catch (e) {
    list.textContent = t('records.failed');
    return;
  }
  list.innerHTML = '';
  if (!data.gobans.length) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.6';
    empty.textContent = t('goban.modal.empty');
    list.appendChild(empty);
    return;
  }
  data.gobans.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'record-item';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = g.name + (g.official ? ' ★' : '');
    const sub = document.createElement('span');
    sub.style.opacity = '0.7';
    sub.style.fontSize = '12px';
    sub.textContent = ` — ${g.creator}`;
    info.appendChild(title);
    info.appendChild(sub);
    item.appendChild(info);
    const loadBtn = document.createElement('button');
    loadBtn.className = 'ghost-btn';
    loadBtn.textContent = (window.t || ((k) => k))('records.load');
    loadBtn.onclick = async () => {
      const r = await fetch('/api/gobans/' + g.id);
      if (!r.ok) return;
      const full = await r.json();
      applyLoadedGoban(full.data);
      document.getElementById('gobanModal').style.display = 'none';
    };
    item.appendChild(loadBtn);
    list.appendChild(item);
  });
}

async function submitGobanSave() {
  const nameInput = document.getElementById('gobanSaveName');
  const name = (nameInput.value || '').trim();
  const t = window.t || ((k) => k);
  if (!name) {
    nameInput.focus();
    return;
  }
  const res = await fetch('/api/gobans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data: buildCurrentGobanData() }),
  });
  if (res.status === 401) {
    alert(t('records.loginRequiredLoad'));
    return;
  }
  if (!res.ok) {
    alert(t('records.saveFailed') || 'Save failed');
    return;
  }
  if (saveLoadStatusEl) saveLoadStatusEl.textContent = t('goban.modal.saved');
  refreshGobanList();
  nameInput.value = '';
}

function wireGobanModal() {
  const modal = document.getElementById('gobanModal');
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = '1';
  document.getElementById('gobanModalClose').onclick = () => (modal.style.display = 'none');
  document.getElementById('gobanSaveBtn').onclick = submitGobanSave;
  document.getElementById('gobanSaveName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitGobanSave();
  });
  document.querySelectorAll('.goban-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _gobanFilter = btn.dataset.filter;
      refreshGobanFilterButtons();
      refreshGobanList();
    });
  });
  const search = document.getElementById('gobanSearchInput');
  let searchTimer = null;
  search.addEventListener('input', () => {
    _gobanSearch = search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshGobanList, 200);
  });
}
document.addEventListener('DOMContentLoaded', wireGobanModal);

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
      // Preserve 3D position if this is a Star-Domination (spheric) goban.
      pos3: v.pos3 ? { x: v.pos3.x, y: v.pos3.y, z: v.pos3.z } : undefined,
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
  if (undoStatus) undoStatus.textContent = window.t ? t('play.undoStatus', { idx, total: stack.length - 1 }) : `Undo: ${idx}/${stack.length - 1}`;
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
      resultEl.textContent = window.t ? t('play.blackWins', { diff: diff.toFixed(1) }) : `🏆 BLACK WINS by ${diff.toFixed(1)} points!`;
      resultEl.style.color = '#ffffff';
      resultEl.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    } else if (score.whiteTotal > score.blackTotal) {
      resultEl.textContent = window.t ? t('play.whiteWins', { diff: diff.toFixed(1) }) : `🏆 WHITE WINS by ${diff.toFixed(1)} points!`;
      resultEl.style.color = '#ffffff';
      resultEl.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    } else {
      resultEl.textContent = window.t ? t('play.tie') : `TIE GAME!`;
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

// ---- Local game record (solo play only) ----
// Multiplayer records are built server-side from socket events.
// For solo play we build a record in-memory and POST it at game end.
let localRecord = null;
let localRecordUsedAI = false;

function beginLocalRecord() {
  // Only track solo games here — multiplayer records are authoritative on the server.
  if (window.multiplayerState?.active) {
    localRecord = null;
    console.log('[record] solo local record NOT started (multiplayer room active — server owns record)');
    return;
  }
  localRecordUsedAI = false;
  localRecord = {
    startedAt: new Date().toISOString(),
    initialGoban: window.getGameSnapshot ? window.getGameSnapshot() : null,
    moves: [],
  };
  console.log('[record] START  (solo)');
}

function appendLocalMove(move) {
  if (!localRecord) return;
  localRecord.moves.push({ ...move, ts: Date.now() });
  console.log(`[record] move  (solo) #${localRecord.moves.length} ${move.type}${move.vid != null ? ' vid=' + move.vid : ''}${move.color ? ' ' + move.color : ''}`);
}

function markLocalRecordUsedAI() {
  localRecordUsedAI = true;
}

async function saveLocalRecord(result) {
  if (!localRecord) {
    console.log('[record] END (solo) — no active local record to save');
    return;
  }
  try {
    const me = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({}));
    const user = me?.user;
    if (!user) {
      console.log('[record] END (solo) — not logged in, record discarded');
      localRecord = null;
      return;
    }

    const endedAt = new Date();
    const dateStr = endedAt.toISOString().slice(0, 10);
    const timeStr = endedAt.toTimeString().slice(0, 5).replace(':', '-');
    const p1 = user.username;
    const p2 = localRecordUsedAI ? 'AI' : 'local';
    const name = `${p1}_${p2}_${dateStr}_${timeStr}`;

    const body = {
      name,
      data: {
        version: 1,
        type: 'game-record',
        startedAt: localRecord.startedAt,
        endedAt: endedAt.toISOString(),
        endReason: 'consent',
        result: result || null,
        players: { black: { username: p1 }, white: { username: p2 } },
        initialGoban: localRecord.initialGoban,
        moves: localRecord.moves,
      },
    };
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log(`[record] END (solo) saved="${name}" moves=${localRecord.moves.length} status=${res.status}`);
  } catch (e) {
    console.warn('[record] solo save failed:', e);
  } finally {
    localRecord = null;
  }
}

window.beginLocalRecord = beginLocalRecord;
window.appendLocalMove = appendLocalMove;
window.markLocalRecordUsedAI = markLocalRecordUsedAI;
window.saveLocalRecord = saveLocalRecord;

window.getGameSnapshot = () => ({
  version: 1,
  type: 'game',
  timestamp: new Date().toISOString(),
  hexRadius,
  spacing,
  // is3D = true when this is a spheric (Star Domination) goban. Tells the
  // receiving client to spin up three.js instead of the 2D canvas.
  is3D: !!(window.StarDomination && window.StarDomination.active),
  vertices: vertices.map((v) => ({
    id: v.id,
    x: v.x,
    y: v.y,
    type: v.type,
    q: v.q ?? 0,
    r: v.r ?? 0,
    peers: v.peers ?? [v.id, v.id, v.id],
    // pos3 is only present on 3D gobans; preserve it so the receiver can
    // rebuild the sphere in the right shape.
    pos3: v.pos3 ? { x: v.pos3.x, y: v.pos3.y, z: v.pos3.z } : undefined,
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
  // Detect 3D (Star Domination) snapshot — explicit flag or presence of
  // pos3 on any vertex. Tears down any running 3D scene first so we can
  // rebuild from scratch.
  const is3D = !!(data && (data.is3D || (Array.isArray(data.vertices) &&
    data.vertices.some((v) => v && v.pos3))));

  if (window.StarDomination && window.StarDomination.active && !is3D) {
    window.StarDomination.stop();
  }

  if (!canvasCreated) ensureCanvas();
  document.getElementById('app').style.display = 'block';
  const placeholder = document.getElementById('roomPlaceholder');
  if (placeholder) placeholder.style.display = 'none';

  // New record format: {type:'game-record', initialGoban, moves, ...}
  // Replay from the initial goban so the board state reflects every move.
  if (data && data.type === 'game-record' && data.initialGoban) {
    const base = data.initialGoban;
    restoreGoban(base);
    centerAndFitGoban();
    restoreGameFromData(base);
    mode = 'play';
    currentScreen = 'play';
    showPanelSection('play');
    setupPlayButtons();

    // Replay each recorded move through the normal game path. `remote:true`
    // prevents echoing moves back to the multiplayer socket.
    if (Array.isArray(data.moves)) {
      for (const mv of data.moves) {
        if (mv.type === 'place' && mv.vid != null) {
          const prev = currentPlayer;
          if (mv.color) currentPlayer = mv.color;
          placeStone(mv.vid, { remote: true });
          if (!mv.color) currentPlayer = prev;
        } else if (mv.type === 'pass') {
          handlePass(true);
        }
      }
    }
    updateGameUI();
    redraw();
    return;
  }

  // Legacy snapshot format — full board state in one blob.
  restoreGoban(data);
  if (is3D && window.StarDomination) {
    // 3D goban: activate the three.js canvas, ingest mesh data from the
    // pos3 fields restoreGoban already copied into vertices[].
    window.StarDomination.useMeshFromGameState();
    window.StarDomination.activate();
    ensureCanvas(); // hides the p5 canvas while 3D is active
  } else {
    centerAndFitGoban();
  }
  restoreGameFromData(data);
  mode = 'play';
  currentScreen = 'play';
  showPanelSection('play');
  setupPlayButtons();
  updateGameUI();
  refreshViewportUi();  // mobile confirm button for the receiver side
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

// Refresh dynamic strings (turn indicator, undo status, results) when language changes.
window.addEventListener('languagechange', () => {
  if (typeof updateGameUI === 'function') updateGameUI();
  if (typeof updateUndoUI === 'function') updateUndoUI();
  // Re-render winner banner if it's currently visible.
  const resultRow = document.getElementById('resultRow');
  if (resultRow && resultRow.style.display !== 'none' && typeof computeTrompTaylorScore === 'function') {
    try { renderScore(computeTrompTaylorScore()); } catch (e) { /* scoring may not be ready */ }
  }
});