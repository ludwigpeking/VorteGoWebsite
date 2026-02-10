# README for Python Training Infrastructure

## Overview

This directory contains the machine learning infrastructure for training a strong Go AI for irregular hexagonal boards using Graph Neural Networks (GNN).

## Key Features

✅ **Topology-Agnostic**: Works with any goban structure (variable vertex degrees, irregular shapes)
✅ **Graph Neural Networks**: Uses PyTorch Geometric for efficient graph operations
✅ **Fast MCTS**: Neural network-guided search with batching
✅ **Self-Play Training**: Generates training data through self-play
✅ **GPU Accelerated**: Optimized for CUDA

## Architecture

### Files

- `hex_board.py`: Board representation and game logic
- `graph_net.py`: Graph Neural Network architecture (GCN/GAT)
- `mcts_nn.py`: Monte Carlo Tree Search with neural network
- `selfplay.py`: Self-play engine for data generation
- `train.py`: Training loop (TODO)
- `requirements.txt`: Python dependencies

### Neural Network

**Input**: Graph representation of board
- Node features: stone color, age, liberties, ko, degree, player
- Edge connectivity: varies per goban
- Global features: move number, pass count

**Architecture**:
```
Input Embedding → Residual Tower (20 blocks) → Policy + Value Heads
                   (GCN or GAT layers)
```

**Outputs**:
- Policy: probability distribution over moves
- Value: win probability (-1 to +1)

## Setup

### 1. Install Dependencies

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows

# Install PyTorch with CUDA
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Install PyTorch Geometric
pip install torch-geometric

# Install other dependencies
pip install -r requirements.txt
```

### 2. Verify Installation

```bash
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
python -c "import torch_geometric; print('PyTorch Geometric OK')"
```

## Usage

### Generate Self-Play Data

Start with a small, fast model to generate initial data:

```bash
python selfplay.py \
  --gobans-dir ../gobans \
  --output-dir training_data \
  --num-games 100 \
  --model-config tiny \
  --simulations 400 \
  --device cuda
```

**Parameters**:
- `--model-config`: Model size (tiny/small/medium/large/huge)
- `--simulations`: MCTS visits per move (400-800 for training)
- `--num-games`: Number of games to generate

**Expected Output**:
```
Found 13 goban presets
Creating new tiny model...
Generating 100 self-play games...

Game 1/100 - Shumi... ✓ 87 moves, winner: black
Game 2/100 - Hoshikage... ✓ 142 moves, winner: white
...
```

### Train Neural Network (TODO)

```bash
python train.py \
  --data-dir training_data \
  --model-config medium \
  --batch-size 32 \
  --epochs 100 \
  --device cuda
```

## Model Configurations

| Config | Hidden Dim | Blocks | Params | Speed | Strength |
|--------|-----------|--------|---------|-------|----------|
| tiny   | 128       | 10     | ~500K   | Fast  | Weak     |
| small  | 192       | 15     | ~1.5M   | Fast  | Fair     |
| medium | 256       | 20     | ~3M     | Medium| Good     |
| large  | 320       | 30     | ~7M     | Slow  | Strong   |
| huge   | 384       | 40     | ~12M    | Slowest| Strongest|

**Recommendation**: Start with `tiny` or `small` for testing, then scale to `medium` or `large` for serious training.

## Training Pipeline (KataGo-style)

```
1. Self-Play → Generate games with current best model
2. Shuffle → Mix and shuffle training data  
3. Train → Update neural network
4. Export → Convert to inference format
5. Gatekeeper → Test new model vs current best
6. Repeat → Loop continues indefinitely
```

## Performance Expectations

### With Tiny Model (128 dim, 10 blocks):
- **Self-play speed**: ~10-20 games/hour (400 sims/move)
- **Training time**: ~5 min/epoch on RTX 3070
- **Strength**: Will beat pure random, weak against heuristics

### With Medium Model (256 dim, 20 blocks):
- **Self-play speed**: ~5-10 games/hour (800 sims/move)  
- **Training time**: ~15 min/epoch on RTX 3070
- **Strength**: Should reach amateur dan after ~50k games

### With Large Model (320 dim, 30 blocks):
- **Self-play speed**: ~2-5 games/hour (800 sims/move)
- **Training time**: ~30 min/epoch on RTX 3070
- **Strength**: Potential for strong amateur/weak pro

## Hardware Requirements

**Minimum** (for testing):
- GPU: RTX 2060 or equivalent (6GB VRAM)
- RAM: 16GB
- Storage: 50GB

**Recommended** (for serious training):
- GPU: RTX 3070 or better (8GB+ VRAM)
- RAM: 32GB
- Storage: 200GB SSD

**Optimal** (for fast training):
- GPU: RTX 4090 or A100 (24GB VRAM)
- RAM: 64GB
- Storage: 500GB NVMe SSD

## Next Steps

1. ✅ Generate initial self-play data with random model
2. ⬜ Implement training loop
3. ⬜ Implement data shuffling
4. ⬜ Implement gatekeeper testing
5. ⬜ Set up distributed training (optional)
6. ⬜ Export to ONNX for fast inference
7. ⬜ Integrate with web interface

## Differences from Standard Go

**Challenges**:
- Variable topology (vertices have 3, 5, or 6 neighbors)
- Different board sizes and shapes
- No standard opening patterns

**Solutions**:
- Graph Neural Networks (handle variable topology naturally)
- Train on all goban types simultaneously
- Network learns topology-independent features

## References

- KataGo: https://github.com/lightvector/KataGo
- PyTorch Geometric: https://pytorch-geometric.readthedocs.io/
- AlphaZero paper: https://arxiv.org/abs/1712.01815
