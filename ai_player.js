// AI Player using MCTS for Hexagonal Go

class HexGoAI {
  constructor() {
    this.mcts = null;
    this.thinking = false;
  }

  initialize() {
    // Create game context for MCTS
    const gameContext = {
      // Get all valid moves for current state
      getValidMoves: (gameState) => {
        const moves = [];
        for (const v of vertices) {
          if (v.visible === false) continue;
          if (gameState.stones.has(v.id)) continue;
          
          // Check if move is legal (not suicide, not ko)
          if (this.isLegalMove(v.id, gameState)) {
            moves.push(v.id);
          }
        }
        // Always can pass
        moves.push('pass');
        return moves;
      },

      // Make a move and return new state
      makeMove: (gameState, move) => {
        const newStones = new Map(gameState.stones);
        const newPlayer = gameState.player === 'black' ? 'white' : 'black';
        let newKoState = null;
        let newPassCount = gameState.passCount;
        
        if (move === 'pass') {
          newPassCount++;
          return {
            stones: newStones,
            player: newPlayer,
            koState: newKoState,
            passCount: newPassCount
          };
        }
        
        newPassCount = 0;
        newStones.set(move, gameState.player);
        
        // Check for captures
        const capturedStones = [];
        const v = vertices[move];
        for (const nid of v.neighbors) {
          if (newStones.get(nid) === newPlayer) {
            const liberties = this.countLiberties(nid, newStones);
            if (liberties === 0) {
              this.captureGroupSimulation(nid, newStones, capturedStones);
            }
          }
        }
        
        // Ko detection: if exactly 1 stone captured, that's potential ko point
        if (capturedStones.length === 1) {
          newKoState = capturedStones[0];
        }
        
        return {
          stones: newStones,
          player: newPlayer,
          koState: newKoState,
          passCount: newPassCount
        };
      },

      // Clone game state
      cloneState: (gameState) => {
        return {
          stones: new Map(gameState.stones),
          player: gameState.player,
          koState: gameState.koState,
          passCount: gameState.passCount
        };
      },

      // Evaluate position (1 = player wins, 0 = player loses)
      evaluate: (finalState, originalPlayer) => {
        // Use Tromp-Taylor scoring
        const score = this.tromp_taylor_score_simulation(finalState.stones);
        
        if (originalPlayer === 'black') {
          return score.black > score.white ? 1 : 0;
        } else {
          return score.white > score.black ? 1 : 0;
        }
      },

      // Heuristic move selection for playouts
      selectHeuristicMove: (gameState, moves) => {
        // Score each move by heuristics
        const scoredMoves = moves.map(move => ({
          move,
          score: this.evaluateMoveHeuristic(move, gameState)
        }));

        // Sort by score descending
        scoredMoves.sort((a, b) => b.score - a.score);

        // Use weighted random selection (bias toward good moves)
        // Top moves have higher probability
        const totalWeight = scoredMoves.reduce((sum, m, idx) => 
          sum + Math.exp(-idx * 0.3), 0);
        
        let random = Math.random() * totalWeight;
        for (let i = 0; i < scoredMoves.length; i++) {
          random -= Math.exp(-i * 0.3);
          if (random <= 0) return scoredMoves[i].move;
        }
        
        return scoredMoves[0].move;
      }
    };

    this.mcts = new MCTS(gameContext);
  }

  // Evaluate move quality with heuristics
  evaluateMoveHeuristic(vid, gameState) {
    if (vid === 'pass') return -100; // Avoid passing unless necessary
    
    let score = 0;
    const v = vertices[vid];
    const player = gameState.player;
    const opponent = player === 'black' ? 'white' : 'black';
    
    // 1. Capture moves are very good
    for (const nid of v.neighbors) {
      if (gameState.stones.get(nid) === opponent) {
        const libs = this.countLiberties(nid, gameState.stones, vid);
        if (libs === 0) {
          score += 50; // Capture!
        } else if (libs === 1) {
          score += 20; // Put in atari
        }
      }
    }
    
    // 2. Save own stones from atari
    for (const nid of v.neighbors) {
      if (gameState.stones.get(nid) === player) {
        const libs = this.countLiberties(nid, gameState.stones);
        if (libs === 1) {
          score += 30; // Save from atari
        }
      }
    }
    
    // 3. Extend from existing stones (connectivity)
    let adjacentFriendly = 0;
    let adjacentEmpty = 0;
    for (const nid of v.neighbors) {
      const stone = gameState.stones.get(nid);
      if (stone === player) adjacentFriendly++;
      else if (!stone) adjacentEmpty++;
    }
    score += adjacentFriendly * 5; // Prefer connecting
    score += adjacentEmpty * 2; // Prefer having liberties
    
    // 4. Avoid suicide (already filtered but double-check)
    if (adjacentEmpty === 0 && adjacentFriendly === 0) {
      score -= 1000; // Very bad
    }
    
    // 5. Small random factor for variety
    score += Math.random() * 5;
    
    return score;
  }

  // Check if move is legal (basic checks)
  isLegalMove(vid, gameState) {
    // Check Ko rule
    if (gameState.koState === vid) return false;
    
    // Check suicide rule (simplified - would capture opponent or has liberties)
    const v = vertices[vid];
    let hasLiberty = false;
    let wouldCapture = false;
    
    for (const nid of v.neighbors) {
      const neighborStone = gameState.stones.get(nid);
      if (!neighborStone) {
        hasLiberty = true;
      } else if (neighborStone !== gameState.player) {
        // Check if this would capture opponent
        const liberties = this.countLiberties(nid, gameState.stones, vid);
        if (liberties === 0) {
          wouldCapture = true;
        }
      }
    }
    
    return hasLiberty || wouldCapture;
  }

  // Count liberties for a group (BFS)
  countLiberties(vid, stones, excludeVertex = null) {
    const visited = new Set();
    const queue = [vid];
    const color = stones.get(vid);
    let liberties = 0;
    const libertySet = new Set();
    
    while (queue.length > 0) {
      const currentVid = queue.shift();
      if (visited.has(currentVid)) continue;
      visited.add(currentVid);
      
      const v = vertices[currentVid];
      for (const nid of v.neighbors) {
        if (nid === excludeVertex) continue;
        
        const neighborStone = stones.get(nid);
        if (!neighborStone) {
          libertySet.add(nid);
        } else if (neighborStone === color && !visited.has(nid)) {
          queue.push(nid);
        }
      }
    }
    
    return libertySet.size;
  }

  // Capture a group (modifies stones map)
  captureGroupSimulation(vid, stones, capturedList) {
    const visited = new Set();
    const queue = [vid];
    const color = stones.get(vid);
    
    while (queue.length > 0) {
      const currentVid = queue.shift();
      if (visited.has(currentVid)) continue;
      visited.add(currentVid);
      
      stones.delete(currentVid);
      capturedList.push(currentVid);
      
      const v = vertices[currentVid];
      for (const nid of v.neighbors) {
        if (stones.get(nid) === color && !visited.has(nid)) {
          queue.push(nid);
        }
      }
    }
  }

  // Simplified Tromp-Taylor scoring for simulation
  tromp_taylor_score_simulation(stones) {
    const controlled = new Map(); // vid -> 'black' or 'white' or 'neutral'
    
    // First pass: assign all stones
    for (const [vid, color] of stones) {
      controlled.set(vid, color);
    }
    
    // Second pass: assign empty points by flood fill
    const visited = new Set(stones.keys());
    
    for (const v of vertices) {
      if (v.visible === false) continue;
      if (visited.has(v.id)) continue;
      
      // BFS to find empty region
      const region = [];
      const queue = [v.id];
      const colors = new Set();
      
      while (queue.length > 0) {
        const vid = queue.shift();
        if (visited.has(vid)) continue;
        visited.add(vid);
        region.push(vid);
        
        const vertex = vertices[vid];
        for (const nid of vertex.neighbors) {
          const stone = stones.get(nid);
          if (stone) {
            colors.add(stone);
          } else if (!visited.has(nid)) {
            queue.push(nid);
          }
        }
      }
      
      // Assign region
      const owner = colors.size === 1 ? Array.from(colors)[0] : 'neutral';
      for (const vid of region) {
        controlled.set(vid, owner);
      }
    }
    
    // Count
    let black = 0, white = 0, neutral = 0;
    for (const [vid, owner] of controlled) {
      if (owner === 'black') black++;
      else if (owner === 'white') white++;
      else neutral++;
    }
    
    white += 7.5; // Komi
    
    return { black, white, neutral };
  }

  // Get current game state
  getCurrentState() {
    return {
      stones: new Map(gameStones),
      player: currentPlayer,
      koState: previousBoardState ? this.findKoPoint() : null,
      passCount: lastMoveWasPass ? 1 : 0
    };
  }

  findKoPoint() {
    // Simple ko detection: find stone that was just captured
    if (!previousBoardState) return null;
    for (const vid of previousBoardState.keys()) {
      if (!gameStones.has(vid)) return vid;
    }
    return null;
  }

  // Main AI move function
  async makeMove(iterations = 1000) {
    if (this.thinking) return null;
    
    this.thinking = true;
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = `AI thinking... (${iterations} simulations)`;
    
    // Initialize if needed
    if (!this.mcts) this.initialize();
    
    // Run MCTS in chunks to not freeze UI
    return new Promise((resolve) => {
      setTimeout(() => {
        const currentState = this.getCurrentState();
        const bestMove = this.mcts.search(currentState, iterations);
        
        this.thinking = false;
        if (statusEl) statusEl.textContent = 'AI move completed';
        resolve(bestMove);
      }, 100); // Small delay to update UI
    });
  }
}

// Global AI instance
const hexGoAI = new HexGoAI();
