// Monte Carlo Tree Search for Hexagonal Go
// Topology-agnostic implementation

class MCTSNode {
  constructor(gameState, parent = null, move = null) {
    this.gameState = gameState; // {stones: Map, player: 'black'/'white', koState, passCount}
    this.parent = parent;
    this.move = move; // vertex id or 'pass'
    this.children = [];
    this.visits = 0;
    this.wins = 0; // from perspective of parent's player
    this.untriedMoves = null; // will be populated on first expansion
  }

  isFullyExpanded() {
    return this.untriedMoves !== null && this.untriedMoves.length === 0;
  }

  isTerminal() {
    return this.gameState.passCount >= 2;
  }

  ucb1(explorationConstant = 1.41) {
    if (this.visits === 0) return Infinity;
    const exploitation = this.wins / this.visits;
    const exploration = Math.sqrt(Math.log(this.parent.visits) / this.visits);
    return exploitation + explorationConstant * exploration;
  }

  bestChild(explorationConstant = 1.41) {
    return this.children.reduce((best, child) => 
      child.ucb1(explorationConstant) > best.ucb1(explorationConstant) ? child : best
    );
  }

  mostVisitedChild() {
    return this.children.reduce((best, child) => 
      child.visits > best.visits ? child : best
    );
  }
}

class MCTS {
  constructor(gameContext) {
    // gameContext provides: vertices, edges, getValidMoves(), makeMove(), simulate(), evaluate()
    this.context = gameContext;
    this.explorationConstant = 1.41;
  }

  // Main MCTS search
  search(rootState, iterations = 1000) {
    const rootNode = new MCTSNode(rootState);
    
    for (let i = 0; i < iterations; i++) {
      let node = rootNode;
      
      // Selection - traverse tree using UCB1
      while (!node.isTerminal() && node.isFullyExpanded()) {
        node = node.bestChild(this.explorationConstant);
      }
      
      // Expansion - add one child
      if (!node.isTerminal()) {
        node = this.expand(node);
      }
      
      // Simulation - random playout
      const result = this.simulate(node.gameState);
      
      // Backpropagation - update statistics
      this.backpropagate(node, result);
    }
    
    // Return best move (most visited)
    if (rootNode.children.length === 0) return 'pass';
    return rootNode.mostVisitedChild().move;
  }

  expand(node) {
    // Initialize untried moves on first expansion
    if (node.untriedMoves === null) {
      node.untriedMoves = this.context.getValidMoves(node.gameState);
    }
    
    if (node.untriedMoves.length === 0) return node;
    
    // Pick random untried move
    const moveIndex = Math.floor(Math.random() * node.untriedMoves.length);
    const move = node.untriedMoves.splice(moveIndex, 1)[0];
    
    // Create child node
    const newState = this.context.makeMove(node.gameState, move);
    const childNode = new MCTSNode(newState, node, move);
    node.children.push(childNode);
    
    return childNode;
  }

  simulate(gameState) {
    // Fast random playout until game ends (both players pass)
    let state = this.context.cloneState(gameState);
    let consecutivePasses = state.passCount;
    let moveCount = 0;
    const maxMoves = 300; // Prevent infinite games
    
    while (consecutivePasses < 2 && moveCount < maxMoves) {
      const moves = this.context.getValidMoves(state);
      
      if (moves.length === 0) {
        // Must pass
        state = this.context.makeMove(state, 'pass');
        consecutivePasses++;
      } else {
        // Random move
        const move = moves[Math.floor(Math.random() * moves.length)];
        state = this.context.makeMove(state, move);
        consecutivePasses = (move === 'pass') ? consecutivePasses + 1 : 0;
      }
      
      moveCount++;
    }
    
    // Evaluate final position (return 1 if current player wins, 0 if loses)
    return this.context.evaluate(state, gameState.player);
  }

  backpropagate(node, result) {
    let currentNode = node;
    let currentResult = result;
    
    while (currentNode !== null) {
      currentNode.visits++;
      currentNode.wins += currentResult;
      
      // Flip result for parent (opponent's perspective)
      currentResult = 1 - currentResult;
      currentNode = currentNode.parent;
    }
  }
}
