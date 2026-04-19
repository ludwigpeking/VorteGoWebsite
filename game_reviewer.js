// Game Review & Inspection Tool
// Loads and displays recorded games move-by-move on the visual board

let gameReviewData = null;
let currentGameIndex = -1;
let currentMoveIndex = -1;
let isPlayingBack = false;
let playbackSpeed = 800; // milliseconds per move
let reviewGameRecord = null; // Store original game record for review

document.addEventListener('DOMContentLoaded', () => {
  const loadGameReviewBtn = document.getElementById('loadGameReviewBtn');
  const closeGameReviewBtn = document.getElementById('closeGameReviewBtn');
  const reviewPlayBtn = document.getElementById('reviewPlayBtn');
  const reviewPauseBtn = document.getElementById('reviewPauseBtn');
  const reviewFirstBtn = document.getElementById('reviewFirstBtn');
  const reviewPrevBtn = document.getElementById('reviewPrevBtn');
  const reviewNextBtn = document.getElementById('reviewNextBtn');
  const reviewLastBtn = document.getElementById('reviewLastBtn');
  const moveSlider = document.getElementById('moveSlider');
  const speedSlider = document.getElementById('speedSlider');

  if (loadGameReviewBtn) {
    loadGameReviewBtn.addEventListener('click', openGameReviewModal);
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

async function openGameReviewModal() {
  console.log('Opening game review modal...');
  const modal = document.getElementById('gameReviewModal');
  modal.style.display = 'block';
  
  // Load game review data
  try {
    console.log('Fetching game_review/random_games.json...');
    const response = await fetch('game_review/random_games.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    gameReviewData = await response.json();
    console.log('Loaded games:', gameReviewData.games ? gameReviewData.games.length : 0);
    displayGameList();
  } catch (error) {
    console.error('Failed to load game review data:', error);
    document.getElementById('gameReviewList').innerHTML = `<div style="color: #f00;">Error loading games: ${error.message}</div>`;
  }
}

function closeGameReviewModal() {
  console.log('Closing game review modal...');
  const modal = document.getElementById('gameReviewModal');
  modal.style.display = 'none';
  pausePlayback();
  currentGameIndex = -1;
  currentMoveIndex = -1;
  reviewGameRecord = null;
}

async function openGameReviewModal() {
  const modal = document.getElementById('gameReviewModal');
  modal.style.display = 'block';
  
  // Load game review data
  try {
    const response = await fetch('game_review/random_games.json');
    gameReviewData = await response.json();
    displayGameList();
  } catch (error) {
    console.error('Failed to load game review data:', error);
    document.getElementById('gameReviewList').innerHTML = '<div style="color: #f00;">Error loading games</div>';
  }
}

function closeGameReviewModal() {
  const modal = document.getElementById('gameReviewModal');
  modal.style.display = 'none';
  pausePlayback();
  currentGameIndex = -1;
  currentMoveIndex = -1;
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
      
      // Close the modal
      document.getElementById('gameReviewModal').style.display = 'none';
      
      // Load the goban using the existing restoreGoban function
      restoreGoban(gobanData);
      console.log('Goban restored');
      
      // Switch to play view
      currentScreen = 'play';
      document.getElementById('menu').style.display = 'none';
      document.getElementById('uiPlay').style.display = 'block';
      
      // Clear any existing game state
      gameStones.clear();
      stoneOrder.clear();
      currentPlayer = 'black';
      capturedBlack = 0;
      capturedWhite = 0;
      gameEnded = false;
      markingDeadStones = false;
      deadStones.clear();
      showStoneIndices = false;
      
      // Show review controls in the UI panel
      setupReviewControls();
      
      // Start at first move
      console.log('Going to first move');
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
    gameStatus.innerHTML = `Reviewing: ${reviewGameRecord.total_moves} moves | Winner: ${reviewGameRecord.winner.toUpperCase()}`;
  }
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

  // Reset board state
  gameStones.clear();
  stoneOrder.clear();
  currentPlayer = 'black';
  capturedBlack = 0;
  capturedWhite = 0;
  gameEnded = false;
  lastMoveWasPass = false;
  
  // Replay moves up to moveIndex
  let moveNum = 0;
  let passCount = 0;
  for (let i = 0; i <= moveIndex; i++) {
    const moveStr = game.moves[i];
    if (moveStr === 'pass') {
      passCount++;
      lastMoveWasPass = true;
    } else {
      const vertexId = parseInt(moveStr);
      gameStones.set(vertexId, currentPlayer);
      stoneOrder.set(vertexId, ++moveNum);
      passCount = 0;
      lastMoveWasPass = false;
    }
    
    // Alternate players
    currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
  }
  
  // Check if game ended
  if (passCount >= 2) {
    gameEnded = true;
  }
  
  // Update UI elements
  const moveStr = game.moves[moveIndex];
  const movePlayer = (moveIndex % 2) === 0 ? 'Black' : 'White';
  document.getElementById('gameTurn').innerHTML = 
    `<span style="color: #ff8800;">REVIEW</span><br>Move ${moveIndex + 1}/${game.moves.length}<br>${movePlayer}: ${moveStr}`;
  document.getElementById('capBlack').textContent = capturedBlack;
  document.getElementById('capWhite').textContent = capturedWhite;
  
  // Show game status
  const gameStatus = document.getElementById('gameStatus');
  if (gameStatus) {
    gameStatus.innerHTML = `${game.goban_name} | Winner: ${game.winner.toUpperCase()}`;
  }
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
