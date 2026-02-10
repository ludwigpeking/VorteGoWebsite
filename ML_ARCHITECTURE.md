# Machine Learning Architecture for Hexagonal VorteGo

## Overview
Adapting KataGo's architecture for irregular hexagonal topology requires replacing spatial convolutions with graph neural networks while maintaining KataGo's proven training methodology.

## Key Differences from Standard Go

### 1. **Topology Challenge**
- **Standard Go**: Regular 19×19 grid → 2D convolutions work perfectly
- **VorteGo**: Irregular hexagonal graph with variable vertex degrees (3, 5, or 6 neighbors)
- **Solution**: Replace CNNs with Graph Convolutional Networks (GCN) or Graph Attention Networks (GAT)

### 2. **Variable Board Sizes**
- Each preset goban has different size/shape
- Must handle gobans from ~100 to ~300+ vertices
- Need dynamic graph structures, not fixed-size tensors

## Proposed Architecture

### Input Representation
```
Node Features (per vertex):
- Stone color: [empty, black, white] (one-hot, 3 channels)
- Stone age: recency of placement (1 channel, normalized)
- Liberties: number of liberties for group (1 channel, log-scaled)
- Ko point: is this the ko point? (1 channel, binary)
- Player to move: current player (1 channel, binary)
- Move number: normalized move count (1 channel)
Total: ~8-12 node features per vertex

Edge Features (per edge):
- Active/inactive edge (1 channel, binary)
- Edge type: face type it belongs to (triangle/quad, 2 channels one-hot)

Global Features:
- Current player
- Ko state exists
- Pass count
- Komi value
- Board size info
```

### Network Architecture

#### Option A: Graph Convolutional Network (GCN)
```
Input: Graph(V, E, node_features, edge_features)

Trunk:
├── Graph Embed Layer (project to hidden_dim=256)
├── Residual Tower (20 blocks):
│   ├── GraphConv(256 → 256)
│   ├── BatchNorm
│   ├── ReLU/Mish
│   ├── GraphConv(256 → 256)
│   ├── BatchNorm
│   └── Residual Connection
└── Policy Head + Value Head

Policy Head:
├── GraphConv(256 → 128)
├── ReLU
├── GraphConv(128 → 1)
└── Softmax over valid vertices + pass

Value Head:
├── GlobalPooling (sum/mean aggregation)
├── FC(256 → 256)
├── ReLU
├── FC(256 → 1)
└── Tanh (win probability)
```

#### Option B: Graph Attention Network (GAT) - Better for irregular topology
```
Same structure as GCN but:
- Replace GraphConv with GraphAttention layers
- Learns importance weights for each neighbor
- Better handles vertices with varying degrees (3/5/6)
```

### GPU Optimization Strategy

**Current Problem**: JavaScript MCTS is slow (~2-3 seconds per move)

**Solution Stack**:

1. **Use PyTorch Geometric for Training**
   - GPU-accelerated graph operations
   - Batching multiple graphs efficiently
   - Fast message passing

2. **Fast Inference Options**:
   - **Option A**: ONNX export → ONNX Runtime (supports graph ops)
   - **Option B**: TorchScript → libtorch (C++ inference)
   - **Option C**: TensorFlow.js with custom graph ops
   - **Recommended**: ONNX Runtime with GPU support

3. **Optimized MCTS**:
   - Batch neural network queries (evaluate 32-64 positions at once)
   - Use value network to reduce rollout depth
   - Policy network to guide selection
   - Target: <0.1s per move with GPU

## Training Pipeline (Following KataGo)

### Phase 1: Self-Play Engine
```python
# Adapted from KataGo's cpp/katago selfplay
while True:
    # Load latest model
    model = load_latest_model()
    
    # Play game with MCTS guided by neural network
    game = HexGame(goban=random_preset())
    
    while not game.is_finished():
        # MCTS with neural network
        policy_probs, value = model(game.state)
        move = mcts_search(game.state, policy_probs, value, visits=800)
        
        # Store training data
        save_training_example(
            graph=game.graph_representation(),
            policy=mcts_policy_distribution,
            value=final_game_result  # backfilled after game ends
        )
        
        game.play(move)
    
    # Save game to training queue
    save_game_data()
```

### Phase 2: Data Shuffling
```python
# Adapted from python/shuffle.py
# Shuffle data from multiple self-play games
# Create training batches with:
# - Temporal diversity (mix recent and old games)
# - Position diversity (different stages of game)
# - Goban diversity (mix different preset gobans)
```

### Phase 3: Training
```python
# Adapted from python/train.py
model = GraphGoNet(config)
optimizer = Adam(model.parameters(), lr=0.001)

for epoch in range(num_epochs):
    for batch in data_loader:
        # Batch contains multiple graphs
        graphs, policy_targets, value_targets = batch
        
        # Forward pass
        policy_pred, value_pred = model(graphs)
        
        # KataGo-style loss:
        policy_loss = cross_entropy(policy_pred, policy_targets)
        value_loss = mse(value_pred, value_targets)
        
        # KataGo also uses auxiliary targets (territory, score)
        # These help learning even on irregular topology
        
        loss = policy_loss + value_loss
        loss.backward()
        optimizer.step()
```

### Phase 4: Model Export
```python
# Export to inference format
# - ONNX for cross-platform
# - Optimize graph operations
# - Quantize if needed for speed
```

### Phase 5: Gatekeeper
```python
# Test new model vs current best
# Accept if win rate > 52% over 400 games
# Same as KataGo's gatekeeper
```

## Key Adaptations from KataGo

### What Stays the Same:
✅ Self-play training loop
✅ MCTS tree search algorithm
✅ Gatekeeper testing
✅ Data shuffling strategy
✅ Loss functions (policy + value)
✅ Training hyperparameters (as starting point)
✅ Auxiliary training targets (ownership, score)

### What Changes:
🔄 CNN → GNN (graph neural network)
🔄 Fixed 19×19 board → Dynamic graph size
🔄 4-neighbor topology → Variable degree (3/5/6)
🔄 Input representation (graph vs grid)
🔄 Batch processing (graph batching)

## Implementation Phases

### Phase 1: Proof of Concept (1-2 weeks)
- [ ] Build GNN architecture in PyTorch Geometric
- [ ] Create graph dataset from current games
- [ ] Train on small dataset (1000 games)
- [ ] Test inference speed
- [ ] Integrate with MCTS

### Phase 2: Training Infrastructure (2-3 weeks)
- [ ] Self-play engine with neural network
- [ ] Data pipeline (shuffle, augment)
- [ ] Distributed training setup
- [ ] Model versioning and export
- [ ] Gatekeeper implementation

### Phase 3: Optimization (1-2 weeks)
- [ ] Batch inference optimization
- [ ] GPU memory optimization
- [ ] ONNX/TorchScript export
- [ ] Browser integration (if feasible)
- [ ] C++/Python backend option

### Phase 4: Large-Scale Training (ongoing)
- [ ] Generate 100k+ self-play games
- [ ] Train for 1M+ steps
- [ ] Test on different goban sizes
- [ ] Tune hyperparameters
- [ ] Achieve amateur dan strength

## Hardware Requirements

### Minimum (Proof of Concept):
- 1× GPU with 8GB VRAM (RTX 3070 or better)
- 32GB RAM
- 100GB storage

### Recommended (Full Training):
- 2-4× GPUs with 12GB+ VRAM
- 64GB RAM
- 500GB+ SSD storage
- Good cooling

### Inference Only:
- 1× GPU with 4GB VRAM
- Can run on CPU but slower

## Next Steps

1. **Immediate**: Build minimal GNN architecture
2. **Week 1**: Create graph dataset from existing games
3. **Week 1-2**: Train first model on small dataset
4. **Week 2-3**: Implement self-play loop
5. **Week 3-4**: Scale up training

## Code Structure

```
ML_training/
├── models/
│   ├── graph_net.py         # GNN architecture
│   ├── policy_value.py      # Policy/value heads
│   └── config.py            # Model configs
├── data/
│   ├── dataset.py           # Graph dataset
│   ├── augmentation.py      # Data augmentation
│   └── loader.py            # Batch loading
├── training/
│   ├── train.py             # Training loop
│   ├── selfplay.py          # Self-play engine
│   └── gatekeeper.py        # Model testing
├── inference/
│   ├── engine.py            # Inference engine
│   ├── export.py            # Model export
│   └── mcts.py              # MCTS with NN
└── utils/
    ├── graph_utils.py       # Graph operations
    └── game_logic.py        # Game rules
```

## References

- KataGo paper: https://arxiv.org/abs/1902.10565
- PyTorch Geometric: https://pytorch-geometric.readthedocs.io/
- Graph Neural Networks: https://distill.pub/2021/gnn-intro/
- AlphaZero: https://arxiv.org/abs/1712.01815
