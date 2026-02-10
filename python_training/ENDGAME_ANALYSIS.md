# Critical Issue: Endgame Scoring in HexGoban Self-Play

## The Problem You Identified

Without proper endgame handling, all self-play data is "bullshit" - meaningless for training. This is CRITICAL.

## What KataGo Does (from C++ code analysis)

### 1. **Benson's Algorithm for Territory Evaluation**
   - Not simple flood-fill counting
   - Determines "pass-alive" territories (territoriesyou control even if opponent passes)
   - Identifies non-pass-alive stones (groups that can be captured)
   - Handles complex cases: seki, dame, false eyes
   - Location: `Board::calculateArea()` and `Board::calculateAreaForPla()` in board.cpp

### 2. **Game End Conditions**
   - Two consecutive passes END the game
   - Game state tracks `consecutiveEndingPasses` counter
   - After 2 passes, board is evaluated for game result
   - Location: `BoardHistory::makeBoardMoveAssumeLegal()` tracks pass counts

### 3. **Scoring Rules**
   - Area scoring: count all stones + controlled territory
   - Territory scoring: count only empty controlled territory
   - Komi (handicap adjustment)
   - Supports multiple rulesets (Japanese, Chinese, Tromp-Taylor)
   - Location: `BoardHistory::endAndScoreGameNow()` in boardhistory.cpp

### 4. **Key Functions in KataGo**
   ```cpp
   Board::calculateArea()           // Main territory evaluation function
   Board::calculateAreaForPla()     // Territory calculation per player
   Board::calculateAreaForPlaWithoutBuildingRegions()  // Optimized version
   BoardHistory::endAndScoreGameNow()  // Final scoring when game ends
   BoardHistory::endGameIfAllPassAlive()  // Check if all territory is decided
   ```

## Why Your Current Implementation Fails

Your `get_winner()` method:
```python
def get_winner(self) -> str:
    # Simple flood-fill territory counting
    # Missing: Benson's algorithm for pass-alive determination
    # Missing: Proper seki detection
    # Missing: Dead stone recognition
```

Problems:
1. **Doesn't identify pass-alive territories** - territories you control even if opponent captures first
2. **Doesn't detect seki** - mutual life that belongs to neither player
3. **Doesn't recognize dead groups** - groups that have no way to survive
4. **Doesn't handle false eyes** - empty regions that aren't real territory
5. **Simple territory count is wrong** for most positions

## Solution Options

### Option A: Implement Benson's Algorithm in Python (Complex)
- Replicate KataGo's C++ territory calculation
- Proper implementation: ~300-500 lines of careful code
- Handle: pass-alive detection, vital regions, internal spaces
- Effort: 4-6 hours of careful coding

### Option B: Use KataGo's C++ Directly (Recommended)
- Call KataGo's C++ engine from Python via subprocess
- Let KataGo handle endgame evaluation
- Send board position → get territory assignment
- Effort: 2-3 hours to integrate

### Option C: Use Simpler Endgame Rule (Temporary)
- Use random playouts to completion (both players make random moves)
- Ensures moves continue until natural game end
- Count final score using simple rules
- Generates valid training data (albeit with weaker signals)
- Effort: 1 hour
- Trade-off: Weaker training data but faster iteration

## Recommendation

Start with **Option C** (random playouts) to get the pipeline working, then upgrade to **Option B** (KataGo C++ integration) for production training.

Don't use your current territory counting - it's too broken.
