// Training Data Review - local JSON viewer
// Loads training-data JSONs produced by the Python pipeline
// (random_games format or mcts_sanity_test format) and replays them on the board.

let gameReviewData = null;
let currentGameIndex = -1;
let currentMoveIndex = -1;
let isPlayingBack = false;
let playbackSpeed = 800; // milliseconds per move
let reviewGameRecord = null; // Normalized record of the currently-loaded game

document.addEventListener('DOMContentLoaded', () => {
  const menuTrainingReviewBtn = document.getElementById('menuTrainingDataReview');
  const trainingJsonFileInput = document.getElementById('trainingJsonFileInput');
  const closeGameReviewBtn = document.getElementById('closeGameReviewBtn');
  const reviewPlayBtn = document.getElementById('reviewPlayBtn');
  const reviewPauseBtn = document.getElementById('reviewPauseBtn');
  const reviewFirstBtn = document.getElementById('reviewFirstBtn');
  const reviewPrevBtn = document.getElementById('reviewPrevBtn');
  const reviewNextBtn = document.getElementById('reviewNextBtn');
  const reviewLastBtn = document.getElementById('reviewLastBtn');
  const moveSlider = document.getElementById('moveSlider');
  const speedSlider = document.getElementById('speedSlider');

  if (menuTrainingReviewBtn) {
    menuTrainingReviewBtn.addEventListener('click', openGameReviewModal);
  }
  if (trainingJsonFileInput) {
    trainingJsonFileInput.addEventListener('change', handleTrainingJsonFile);
  }
  if (closeGameReviewBtn) {
    closeGameReviewBtn.addEventListener('click', closeGameReviewModal);
  }
  if (reviewPlayBtn) {
    reviewPlayBtn.addEventListener('click', startPlayback);
  }
  if (reviewPauseBtn) {
    reviewPauseBtn.addEventListener('click', pausePlayback);
  }
  if (reviewFirstBtn) {
    reviewFirstBtn.addEventListener('click', () => goToMove(0));
  }
  if (reviewPrevBtn) {
    reviewPrevBtn.addEventListener('click', () => {
      if (currentMoveIndex > 0) goToMove(currentMoveIndex - 1);
    });
  }
  if (reviewNextBtn) {
    reviewNextBtn.addEventListener('click', () => {
      if (reviewGameRecord && currentMoveIndex < reviewGameRecord.moves.length - 1) {
        goToMove(currentMoveIndex + 1);
      }
    });
  }
  if (reviewLastBtn) {
    reviewLastBtn.addEventListener('click', goToEnd);
  }
  if (moveSlider) {
    moveSlider.addEventListener('input', (e) => {
      if (currentGameIndex >= 0 && reviewGameRecord) {
        const moveIndex = Math.floor((parseInt(e.target.value) / 100) * reviewGameRecord.moves.length);
        goToMove(moveIndex);
      }
    });
  }
  if (speedSlider) {
    speedSlider.addEventListener('input', (e) => {
      playbackSpeed = parseInt(e.target.value);
      document.getElementById('speedDisplay').textContent = `${(playbackSpeed / 1000).toFixed(1)}s/move`;
    });
  }
});

function openGameReviewModal() {
  const modal = document.getElementById('gameReviewModal');
  modal.style.display = 'block';
  // Reset list / status — no auto-fetch; user must pick a local JSON file.
  document.getElementById('gameReviewList').innerHTML =
    '<div style="color: #888;">Pick a JSON file above to load games.</div>';
  document.getElementById('gameReviewDetails').innerHTML =
    '<div style="color: #888;">No game selected.</div>';
  const status = document.getElementById('trainingJsonStatus');
  if (status) status.textContent = '';
}

function closeGameReviewModal() {
  const modal = document.getElementById('gameReviewModal');
  modal.style.display = 'none';
  pausePlayback();
  currentGameIndex = -1;
  currentMoveIndex = -1;
  reviewGameRecord = null;
  const panel = document.getElementById('mctsInfoPanel');
  if (panel) panel.style.display = 'none';
}

async function handleTrainingJsonFile(evt) {
  const file = evt.target.files && evt.target.files[0];
  const status = document.getElementById('trainingJsonStatus');
  if (!file) return;
  status.textContent = `Reading ${file.name}...`;
  let raw;
  try {
    const text = await file.text();
    raw = JSON.parse(text);
  } catch (err) {
    status.textContent = `Parse error: ${err.message}`;
    status.style.color = '#f66';
    document.getElementById('gameReviewList').innerHTML =
      `<div style="color:#f66;">Failed to parse JSON: ${err.message}</div>`;
    return;
  }
  try {
    gameReviewData = normalizeReviewData(raw);
  } catch (err) {
    status.textContent = `Format error: ${err.message}`;
    status.style.color = '#f66';
    return;
  }
  status.style.color = '#8c8';
  status.textContent = `Loaded ${gameReviewData.games.length} game(s) from ${file.name}`;
  displayGameList();
}

// Normalize both JSON formats into: { games: [{ goban_name, moves: [...], winner, detailedMoves?, meta? }] }
//  - Old format (random_games.json / selfplay batches):
//      { games: [{ goban_name, moves: ["42","pass",...], winner, ... }] }
//  - New format (mcts_sanity_test.py single-game):
//      { goban: "Shumi.json", moves: [{move_num, player, move, top5_by_visits, ...}], winner, ... }
function normalizeReviewData(raw) {
  if (raw && Array.isArray(raw.games)) {
    // Old format — already close enough; just ensure move strings.
    return {
      games: raw.games.map((g) => ({
        goban_name: g.goban_name || (g.goban ? String(g.goban).replace(/\.json$/i, '') : 'Unknown'),
        moves: (g.moves || []).map((m) => (typeof m === 'string' ? m : String(m))),
        winner: g.winner || 'unknown',
        total_moves: g.total_moves || (g.moves || []).length,
        detailedMoves: null,
        meta: { format: 'batch', ...g },
      })),
    };
  }
  if (raw && Array.isArray(raw.moves) && raw.moves.length && typeof raw.moves[0] === 'object') {
    // New sanity-test format — detailed single game.
    const gobanName = (raw.goban || 'Unknown').replace(/\.json$/i, '');
    const movesStr = raw.moves.map((m) => (m.move === 'pass' ? 'pass' : String(m.move)));
    return {
      games: [
        {
          goban_name: gobanName,
          moves: movesStr,
          winner: raw.winner || 'unknown',
          total_moves: raw.total_moves || movesStr.length,
          detailedMoves: raw.moves, // keep the full detail array for the MCTS panel
          meta: {
            format: 'sanity',
            sims_per_move: raw.sims_per_move,
            device: raw.device,
            total_time_sec: raw.total_time_sec,
            avg_sec_per_move: raw.avg_sec_per_move,
            margin_white_minus_black: raw.margin_white_minus_black,
            terminated_reason: raw.terminated_reason,
            num_vertices: raw.num_vertices,
          },
        },
      ],
    };
  }
  throw new Error('Unrecognized JSON shape (expected {games:[...]} or {moves:[{...}]})');
}

function displayGameList() {
  const listDiv = document.getElementById('gameReviewList');
  if (!gameReviewData || !gameReviewData.games) {
    listDiv.innerHTML = '<div style="color: #f00;">No games found</div>';
    return;
  }

  let html = '<table style="width: 100%; border-collapse: collapse; font-size: 13px;">';
  html += '<thead><tr style="background: #333; position: sticky; top: 0;"><th style="padding: 8px; text-align: left; border-bottom: 1px solid #555;">Game</th><th style="padding: 8px; text-align: right; border-bottom: 1px solid #555;">Moves</th><th style="padding: 8px; text-align: right; border-bottom: 1px solid #555;">Winner</th></tr></thead>';
  html += '<tbody>';

  gameReviewData.games.forEach((game, idx) => {
    const moveCount = game.moves.length;
    const winner = game.winner || 'N/A';
    const goboan = game.goban_name || 'Unknown';
    const selected = idx === currentGameIndex ? ' style="background: #444;"' : '';
    html += `<tr${selected} style="cursor: pointer; border-bottom: 1px solid #333; transition: background 0.2s;" onclick="selectGame(${idx})">`;
    html += `<td style="padding: 8px;">${goboan}</td>`;
    html += `<td style="padding: 8px; text-align: right;">${moveCount}</td>`;
    html += `<td style="padding: 8px; text-align: right; color: ${winner === 'white' ? '#ddd' : '#333'}; font-weight: bold;">${winner.toUpperCase()}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  listDiv.innerHTML = html;
}

function selectGame(gameIndex) {
  console.log('Selecting game:', gameIndex);
  currentGameIndex = gameIndex;
  currentMoveIndex = -1;
  pausePlayback();
  
  const game = gameReviewData.games[gameIndex];
  reviewGameRecord = game;
  console.log('Game record:', game);
  
  // Load the goban file to initialize the board display
  const gobanPath = `gobans/${game.goban_name}.json`;
  console.log('Loading goban from:', gobanPath);
  
  fetch(gobanPath)
    .then(response => {
      console.log('Goban response:', response.status);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(gobanData => {
      console.log('Goban data loaded, vertices:', gobanData.vertices ? gobanData.vertices.length : 'none');

      // Close the modal.
      document.getElementById('gameReviewModal').style.display = 'none';

      // Use the blessed entry: applyGameSnapshot(). It handles canvas creation,
      // DOM visibility (#app / #roomPlaceholder), mode='play', currentScreen='play',
      // showPanelSection('play'), setupPlayButtons(), and the final redraw.
      // We pass an empty-state game-record snapshot so no moves are auto-replayed —
      // our goToMove() will drive the current-move state instead.
      if (typeof window.applyGameSnapshot !== 'function') {
        alert('applyGameSnapshot not available on this page — cannot enter review mode.');
        return;
      }
      const emptyState = {
        ...gobanData,
        gameStones: [],
        stoneOrder: [],
        currentPlayer: 'black',
        capturedBlack: 0,
        capturedWhite: 0,
        previousBoardState: null,
        gameUndoStack: [],
        gameUndoIndex: -1,
      };
      window.applyGameSnapshot({
        type: 'game-record',
        initialGoban: emptyState,
        moves: [],
      });
      console.log('Snapshot applied — entering review mode');

      setupReviewControls();
      goToMove(0);
    })
    .catch(error => {
      console.error('Failed to load goban:', error);
      alert(`Error loading goban: ${game.goban_name}\n${error.message}`);
    });
}

function setupReviewControls() {
  // Add review status to UI
  const gameTurnEl = document.getElementById('gameTurn');
  if (gameTurnEl && reviewGameRecord) {
    gameTurnEl.innerHTML = `<span style="color: #ff8800;">REVIEW MODE</span><br>${reviewGameRecord.goban_name}`;
  }

  // Update game status to show we're in review
  const gameStatusRow = document.getElementById('gameStatusRow');
  const gameStatus = document.getElementById('gameStatus');
  if (gameStatusRow && gameStatus && reviewGameRecord) {
    gameStatusRow.style.display = 'block';
    const meta = reviewGameRecord.meta || {};
    let header = `Reviewing: ${reviewGameRecord.total_moves} moves | Winner: ${(reviewGameRecord.winner || 'unknown').toUpperCase()}`;
    if (meta.format === 'sanity' && meta.sims_per_move) {
      header += ` | ${meta.sims_per_move} sims/move on ${meta.device || '?'}`;
    }
    gameStatus.innerHTML = header;
  }

  // MCTS panel: only visible when we actually have detailed per-move data
  const panel = document.getElementById('mctsInfoPanel');
  if (panel) {
    panel.style.display = (reviewGameRecord && reviewGameRecord.detailedMoves) ? 'block' : 'none';
  }
}

function renderMctsInfo(moveIndex) {
  const panel = document.getElementById('mctsInfoPanel');
  const content = document.getElementById('mctsInfoContent');
  if (!panel || !content || !reviewGameRecord || !reviewGameRecord.detailedMoves) return;
  const d = reviewGameRecord.detailedMoves[moveIndex];
  if (!d) {
    content.textContent = '(no data for this move)';
    return;
  }
  const top5 = (d.top5_by_visits || []).map(
    (r) => `  ${String(r.move).padStart(5)}  visits=${String(r.visits).padStart(3)}  prior=${Number(r.prior).toFixed(3)}  q=${Number(r.q).toFixed(3)}`
  ).join('\n');
  const inv = (d.invariants || []).map(
    (i) => `  ${i.passed ? '✓' : '✗'} ${i.name} (${i.detail})`
  ).join('\n');
  const lines = [
    `Move ${d.move_num}  ${d.player}  -> ${d.move}`,
    `Root V=${d.root_value_est}  captures=${d.captured_count}  legal=${d.legal_count_before}  MCTS ${d.mcts_time_sec}s`,
    `Children expanded: ${d.root_children_expanded}`,
    `Top-5 by visits:`,
    top5 || '  (none)',
    inv ? `Invariants:\n${inv}` : '',
  ].filter(Boolean);
  content.textContent = lines.join('\n');
}

function displayGameDetails(gameIndex) {
  const game = gameReviewData.games[gameIndex];
  const detailsDiv = document.getElementById('gameReviewDetails');
  
  if (!game) {
    detailsDiv.innerHTML = '<div style="color: #888;">Invalid game</div>';
    return;
  }

  const moveCount = game.moves.length;
  const lastMove = game.moves[moveCount - 1] || {};
  const passes = game.passes || 0;

  let html = '<div style="line-height: 1.8;">';
  html += `<div><strong>Goban:</strong> ${game.goban_name || 'Unknown'}</div>`;
  html += `<div><strong>Total Moves:</strong> ${moveCount}</div>`;
  html += `<div><strong>Consecutive Passes:</strong> ${passes}</div>`;
  html += `<div><strong>Winner:</strong> <span style="color: ${game.winner === 'white' ? '#ddd' : '#333'}; font-weight: bold;">${(game.winner || 'Unknown').toUpperCase()}</span></div>`;
  
  // Calculate territory information
  if (game.final_score !== undefined) {
    const scoreStr = String(game.final_score);
    html += `<div><strong>Score:</strong> ${scoreStr}</div>`;
  }

  // Show some moves summary
  html += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #555;"><strong>Move Summary:</strong></div>`;
  html += `<div style="font-size: 12px; max-height: 150px; overflow-y: auto;">`;
  
  // Show first 10 and last 10 moves
  const moversToShow = [];
  for (let i = 0; i < Math.min(10, moveCount); i++) {
    moversToShow.push(`${i + 1}: ${game.moves[i]}`);
  }
  if (moveCount > 20) {
    moversToShow.push('...');
    for (let i = Math.max(10, moveCount - 10); i < moveCount; i++) {
      moversToShow.push(`${i + 1}: ${game.moves[i]}`);
    }
  } else if (moveCount > 10) {
    for (let i = 10; i < moveCount; i++) {
      moversToShow.push(`${i + 1}: ${game.moves[i]}`);
    }
  }
  
  html += moversToShow.map(m => `<div style="margin: 2px 0; color: #aaa;">${m}</div>`).join('');
  html += '</div>';
  html += '</div>';

  detailsDiv.innerHTML = html;
}

function showGamePlayback() {
  document.getElementById('gameReviewPlayback').style.display = 'block';
}

function goToMove(moveIndex) {
  if (currentGameIndex < 0 || !reviewGameRecord) return;

  const game = reviewGameRecord;
  moveIndex = Math.max(0, Math.min(moveIndex, game.moves.length - 1));
  currentMoveIndex = moveIndex;

  // Reset game state for a fresh replay. We route each move through the game's
  // own placeStone() / handlePass() so captures and Ko are applied correctly;
  // otherwise the board shown here would show all stones ever placed, including
  // ones that were actually captured.
  if (typeof gameStones !== 'undefined' && gameStones.clear) gameStones.clear();
  if (typeof stoneOrder !== 'undefined' && stoneOrder.clear) stoneOrder.clear();
  if (typeof currentPlayer !== 'undefined') currentPlayer = 'black';
  if (typeof capturedBlack !== 'undefined') capturedBlack = 0;
  if (typeof capturedWhite !== 'undefined') capturedWhite = 0;
  if (typeof previousBoardState !== 'undefined') previousBoardState = null;
  if (typeof gameEnded !== 'undefined') gameEnded = false;
  if (typeof lastMoveWasPass !== 'undefined') lastMoveWasPass = false;

  let passCount = 0;
  let lastMoveStr = '';
  for (let i = 0; i <= moveIndex; i++) {
    const moveStr = game.moves[i];
    lastMoveStr = moveStr;
    if (moveStr === 'pass') {
      if (typeof handlePass === 'function') {
        handlePass(true);
      } else if (typeof currentPlayer !== 'undefined') {
        currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
      }
      passCount++;
    } else {
      const vertexId = parseInt(moveStr);
      if (typeof placeStone === 'function') {
        // placeStone uses currentPlayer and handles player alternation + captures.
        placeStone(vertexId, { remote: true });
      } else if (typeof gameStones !== 'undefined') {
        // Fallback (should not happen on this page).
        gameStones.set(vertexId, currentPlayer);
        currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
      }
      passCount = 0;
    }
  }
  if (passCount >= 2 && typeof gameEnded !== 'undefined') gameEnded = true;

  // Update header UI
  const movePlayer = (moveIndex % 2) === 0 ? 'Black' : 'White';
  const gameTurnEl = document.getElementById('gameTurn');
  if (gameTurnEl) {
    gameTurnEl.innerHTML =
      `<span style="color: #ff8800;">REVIEW</span><br>Move ${moveIndex + 1}/${game.moves.length}<br>${movePlayer}: ${lastMoveStr}`;
  }
  const capBlackEl = document.getElementById('capBlack');
  const capWhiteEl = document.getElementById('capWhite');
  if (capBlackEl && typeof capturedBlack !== 'undefined') capBlackEl.textContent = capturedBlack;
  if (capWhiteEl && typeof capturedWhite !== 'undefined') capWhiteEl.textContent = capturedWhite;

  // Bottom status line
  const gameStatus = document.getElementById('gameStatus');
  if (gameStatus) {
    gameStatus.innerHTML = `${game.goban_name} | Winner: ${(game.winner || 'unknown').toUpperCase()}`;
  }

  // If the loaded JSON has per-move MCTS details, refresh the panel.
  renderMctsInfo(moveIndex);

  // p5 sketch uses noLoop() — must trigger redraw manually after state changes.
  if (typeof redraw === 'function') redraw();
}

function goToEnd() {
  if (currentGameIndex < 0 || !reviewGameRecord) return;
  const game = reviewGameRecord;
  pausePlayback();
  goToMove(game.moves.length - 1);
}

function startPlayback() {
  if (currentGameIndex < 0) return;
  if (isPlayingBack) return;
  
  isPlayingBack = true;
  playNextMove();
}

function playNextMove() {
  if (!isPlayingBack || currentGameIndex < 0) return;
  
  const game = reviewGameRecord;
  if (currentMoveIndex < game.moves.length - 1) {
    goToMove(currentMoveIndex + 1);
    setTimeout(playNextMove, playbackSpeed);
  } else {
    isPlayingBack = false;
  }
}

function pausePlayback() {
  isPlayingBack = false;
}

// Keyboard controls for review mode
document.addEventListener('keydown', (e) => {
  if (currentGameIndex < 0 || !reviewGameRecord) return;
  
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (currentMoveIndex > 0) goToMove(currentMoveIndex - 1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (currentMoveIndex < reviewGameRecord.moves.length - 1) goToMove(currentMoveIndex + 1);
  } else if (e.key === ' ') {
    e.preventDefault();
    if (isPlayingBack) pausePlayback();
    else startPlayback();
  }
});

// Auto-load games on page load if in play mode
window.addEventListener('load', () => {
  // This ensures the event listeners are set up
});
