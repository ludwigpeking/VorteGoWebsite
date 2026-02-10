# HexGoban Python Training Pipeline

## Overview

This directory contains the complete machine learning pipeline for training an AI to play Hexagonal Go.

**Key Principle**: All game data must have proper endgame handling to be meaningful for training.

## Architecture

```
hex_board.py           → Board representation with irregular hexagonal topology
bensons_algorithm.py   → Territory scoring (determines winners correctly)
generate_random_games.py → Generate initial training data
graph_net.py          → Graph Neural Network (GNN) for move prediction
mcts_nn.py            → Monte Carlo Tree Search with neural network guidance
selfplay.py           → Self-play engine for generating training data
export_games.py       → Export games to human-readable formats
train.py              → (TODO) Training loop for the GNN
```

## Quick Start

### 1. Generate Initial Training Data

```bash
python generate_random_games.py
```

This generates 20 games using random playouts. Each game:
- Runs until 2 consecutive passes (standard Go ending rule)
- Uses Benson's algorithm for proper territory evaluation
- Produces a valid winner determination
- Is saved to `game_review/random_games.json`

### 2. Scale Up Data Generation

For actual training, generate 100+ games:

```bash
# Edit generate_random_games.py line ~105:
# Change: games = generate_random_games(20)
# To: games = generate_random_games(100)

python generate_random_games.py
```

### 3. Train the Neural Network

```bash
python train.py -traindir ./models -pos-len 19 -batch-size 32 -epochs 10
```

(Training script not yet implemented)

### 4. Use for Better Self-Play

Once the network is trained:

```bash
python selfplay.py --num-games 100 --model-config tiny --simulations 100
```

## Key Files Explained

### `hex_board.py`
- Represents the hexagonal board with irregular topology
- Handles move legality (no suicide, ko rules)
- Tracks game history and consecutive passes
- **Critical**: Properly ends game after 2 consecutive passes

### `bensons_algorithm.py`
- Implements territory identification
- **Critical**: Determines which player owns which empty regions
- Scores games with komi adjustment
- Ensures training signal is valid

### `generate_random_games.py`
- Creates initial training games
- Uses random playouts (not AI - ensures completion)
- Evaluates games with proper territory scoring
- Outputs valid JSON game records

### `graph_net.py`
- Graph Neural Network architecture
- Handles irregular hexagonal topology naturally
- Inputs: board state as graph with node features
- Outputs: move probabilities (policy) + game outcome (value)

### `mcts_nn.py`
- Monte Carlo Tree Search with neural network guidance
- Uses PUCT algorithm (AlphaZero-style)
- Much faster than pure rollout-based MCTS
- Requires trained neural network

### `selfplay.py`
- Complete self-play engine
- Generates training games using MCTS + NN
- Saves games in PyTorch format
- Handles multiple gobans (board presets)

## Data Format

Generated games are stored in JSON:

```json
{
  "goban": "Shumi.json",
  "moves": [
    {"player": "black", "move": 33},
    {"player": "white", "move": 91},
    ...
  ],
  "num_stones_per_move": [1, 2, 3, ...],
  "winner": "white",
  "total_moves": 150
}
```

## Performance Expectations

### Random Playouts (Initial Data)
- Speed: ~0.5-2 seconds per game (CPU)
- Quality: Low (random moves)
- Valid: YES (proper endgame handling)
- Use case: Bootstrap training data

### MCTS + Untrained NN
- Speed: 5-30 seconds per game (depends on simulations)
- Quality: Low (no training yet)
- Valid: YES
- Use case: Generate data for first training run

### MCTS + Trained NN
- Speed: 10-60 seconds per game
- Quality: Moderate-High
- Valid: YES
- Use case: Main self-play training loop

## Important Notes

### Why Random Playouts are NOT "Bullshit Data"

1. **Games End Properly**: 2 consecutive passes = game over
2. **Scoring is Correct**: Benson's algorithm determines winners fairly
3. **Complete Records**: All moves, territories, and outcomes are recorded
4. **Valid Signal**: Network learns from legitimate game sequences

### The Training Loop

```
Iteration 1:
  Generate 100 random games (proper endgame handling)
  ↓
  Train GNN (100 games is enough for initial model)
  ↓
  
Iteration 2:
  Use trained GNN + MCTS for self-play
  Generate 500 games (much better quality)
  ↓
  Train GNN (500 games improves model further)
  ↓
  
Iteration 3+:
  Continue improving
```

## Troubleshooting

### "Game ends in 7 moves"
- **Old issue**: MCTS was choosing pass too early
- **Fix**: Use random playouts instead
- **Root cause**: Untrained network outputs random values

### "Winner determination is wrong"
- Check: `bensons_algorithm.py` territory identification
- Verify: Territory is correctly assigned to single-color neighbors
- Debug: Print ownership map and verify visually

### "Games don't end"
- Check: Is `hex_board.pass_count >= 2` working?
- Verify: Moves are being recorded correctly
- Debug: Print move history and pass counts

## Next Steps

1. ✅ Generate valid training data (DONE)
2. ⏳ Implement `train.py` for neural network training
3. ⏳ Use trained network for better self-play
4. ⏳ Implement batched MCTS for speed
5. ⏳ Export trained model for browser use

## References

- **Benson's Algorithm**: https://senseis.xmp.net/?BensonsAlgorithm
- **AlphaGo**: Silver et al., 2016 (MCTS + neural networks)
- **KataGo**: https://github.com/lightvector/KataGo (reference implementation)
- **Graph Neural Networks**: For irregular topology handling

## Author Notes

The core insight from analyzing KataGo: **proper endgame handling is non-negotiable for meaningful training data**.

Every design decision (game ending, territory scoring, winner determination) reflects lessons from KataGo's C++ implementation.
