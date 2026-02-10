# HexGoban Self-Play Architecture
# Based on KataGo insights from C++ and Python implementations

## Key Learnings from KataGo:

1. **Game History Tracking**
   - KataGo uses BoardHistory to track:
     * moveHistory: chronological list of all moves
     * consecutiveEndingPasses: count consecutive passes
     * Game ends when: 2 consecutive passes OR explicit end condition
   - This is SEPARATE from passing probability

2. **Pass Handling Philosophy**
   - KataGo does NOT restrict passing early
   - Instead, it tracks consecutive passes
   - Game ends naturally when 2 passes occur
   - The neural network LEARNS when passing is good/bad through training

3. **Self-Play Flow**
   - Generate games using MCTS + NN
   - NN gives move probabilities (including pass)
   - MCTS selects moves with tree search
   - Game ends when 2 consecutive passes made
   - All games are stored in training data
   - Network trains on these games and learns naturally

4. **Why Our Approach Failed**
   - Untrained network outputs random values
   - We tried to force "correct" behavior (restricting pass)
   - But the issue is we also need to track consecutive passes!
   - Game should end on 2 passes, not 1

## Solution: Track Consecutive Passes
- Change HexBoard.is_finished() to track consecutive passes
- Allow 2 passes to end the game (standard Go rule)
- Let untrained network output whatever - structure constrains behavior
