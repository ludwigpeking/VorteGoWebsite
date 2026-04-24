# Graph Neural Network for Hexagonal Go
# Topology-agnostic architecture using PyTorch Geometric

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv, GATv2Conv, global_mean_pool, global_add_pool
from torch_geometric.data import Data, Batch
from typing import Tuple

class ResidualGCNBlock(nn.Module):
    """Residual block with graph convolution"""
    
    def __init__(self, hidden_dim: int, activation='relu'):
        super().__init__()
        self.conv1 = GCNConv(hidden_dim, hidden_dim)
        self.bn1 = nn.BatchNorm1d(hidden_dim)
        self.conv2 = GCNConv(hidden_dim, hidden_dim)
        self.bn2 = nn.BatchNorm1d(hidden_dim)
        self.activation = nn.ReLU() if activation == 'relu' else nn.Mish()
        
    def forward(self, x, edge_index):
        identity = x
        
        out = self.conv1(x, edge_index)
        out = self.bn1(out)
        out = self.activation(out)
        
        out = self.conv2(out, edge_index)
        out = self.bn2(out)
        
        out = out + identity  # Residual connection
        out = self.activation(out)
        
        return out

class ResidualGATBlock(nn.Module):
    """Residual block with graph attention - better for variable degree"""
    
    def __init__(self, hidden_dim: int, heads: int = 4, activation='relu'):
        super().__init__()
        # Multi-head attention, concatenate then project back
        self.conv1 = GATv2Conv(hidden_dim, hidden_dim // heads, heads=heads, concat=True)
        self.bn1 = nn.BatchNorm1d(hidden_dim)
        self.conv2 = GATv2Conv(hidden_dim, hidden_dim // heads, heads=heads, concat=True)
        self.bn2 = nn.BatchNorm1d(hidden_dim)
        self.activation = nn.ReLU() if activation == 'relu' else nn.Mish()
        
    def forward(self, x, edge_index):
        identity = x
        
        out = self.conv1(x, edge_index)
        out = self.bn1(out)
        out = self.activation(out)
        
        out = self.conv2(out, edge_index)
        out = self.bn2(out)
        
        out = out + identity
        out = self.activation(out)
        
        return out

class HexGoNet(nn.Module):
    """
    Graph Neural Network for Hexagonal Go
    
    Architecture:
    - Input embedding
    - Residual tower (GCN or GAT blocks)
    - Policy head (move probabilities)
    - Value head (win probability)
    
    Handles variable topology naturally through graph operations
    """
    
    def __init__(
        self,
        input_dim: int = 8,
        hidden_dim: int = 256,
        num_blocks: int = 20,
        use_attention: bool = True,
        heads: int = 4,
        activation: str = 'mish'
    ):
        super().__init__()
        
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.use_attention = use_attention
        
        # Input embedding
        self.input_embed = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU() if activation == 'relu' else nn.Mish()
        )
        
        # Global feature embedding (move number, pass count, etc.)
        self.global_embed = nn.Sequential(
            nn.Linear(2, 64),  # 2 global features
            nn.ReLU() if activation == 'relu' else nn.Mish()
        )
        
        # Residual tower
        self.blocks = nn.ModuleList()
        for _ in range(num_blocks):
            if use_attention:
                self.blocks.append(ResidualGATBlock(hidden_dim, heads, activation))
            else:
                self.blocks.append(ResidualGCNBlock(hidden_dim, activation))
        
        # Policy head — per-vertex scalar
        self.policy_conv = GCNConv(hidden_dim, 128)
        self.policy_bn = nn.BatchNorm1d(128)
        self.policy_fc = nn.Linear(128, 1)

        # Value head — global scalar in [-1, 1]
        self.value_conv = GCNConv(hidden_dim, 64)
        self.value_bn = nn.BatchNorm1d(64)
        self.value_fc1 = nn.Linear(64 + 64, 256)  # 64 from graph + 64 from global
        self.value_fc2 = nn.Linear(256, 1)

        # Ownership head — per-vertex scalar in [-1, 1] (KataGo's per-intersection
        # ownership prediction, conv_ownership in model_pytorch.py:1405). Trained
        # against post-Benson final ownership labels (+1 black, -1 white, 0 neutral).
        self.ownership_conv = GCNConv(hidden_dim, 64)
        self.ownership_bn = nn.BatchNorm1d(64)
        self.ownership_fc = nn.Linear(64, 1)

        # Score head — two scalars per graph: (score_mean, score_stdev).
        # score_mean is the predicted final |white_score - black_score|;
        # score_stdev is uncertainty (positive). Mirrors KataGo's whiteLead +
        # whiteScoreMean / scoreStdev outputs (nninputs.h:122-126).
        self.score_conv = GCNConv(hidden_dim, 32)
        self.score_bn = nn.BatchNorm1d(32)
        self.score_fc1 = nn.Linear(32 + 64, 128)
        self.score_mean_fc = nn.Linear(128, 1)
        self.score_stdev_fc = nn.Linear(128, 1)

    def forward(self, data: Data) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Forward pass.

        Returns:
            policy_logits:  [total_nodes]      per-vertex move logits
            value:          [batch_size]       win probability in [-1, 1]
            ownership:      [total_nodes]      per-vertex ownership in [-1, 1]
            score_mean:     [batch_size]       expected final score margin
            score_stdev:    [batch_size]       score uncertainty (positive)
        """
        x, edge_index = data.x, data.edge_index
        u = data.u if hasattr(data, 'u') else None
        batch = data.batch if hasattr(data, 'batch') else torch.zeros(x.size(0), dtype=torch.long, device=x.device)

        # Embed input
        x = self.input_embed(x)

        # Handle global features
        if u is not None:
            if u.dim() == 1:
                u = u.unsqueeze(0)
            u_embed = self.global_embed(u)
        else:
            num_graphs = batch.max().item() + 1
            u_embed = torch.zeros((num_graphs, 64), device=x.device, dtype=x.dtype)

        # Residual tower
        for block in self.blocks:
            x = block(x, edge_index)

        # --- Policy head ---
        p = self.policy_conv(x, edge_index)
        p = self.policy_bn(p)
        p = F.relu(p)
        policy_logits = self.policy_fc(p).squeeze(-1)  # [total_nodes]

        # --- Value head ---
        v = self.value_conv(x, edge_index)
        v = self.value_bn(v)
        v = F.relu(v)
        v_pooled = global_mean_pool(v, batch)  # [batch_size, 64]
        v_cat = torch.cat([v_pooled, u_embed], dim=1)
        v = F.relu(self.value_fc1(v_cat))
        value = torch.tanh(self.value_fc2(v)).squeeze(-1)  # [batch_size]

        # --- Ownership head ---
        o = self.ownership_conv(x, edge_index)
        o = self.ownership_bn(o)
        o = F.relu(o)
        ownership = torch.tanh(self.ownership_fc(o).squeeze(-1))  # [total_nodes]

        # --- Score head ---
        s = self.score_conv(x, edge_index)
        s = self.score_bn(s)
        s = F.relu(s)
        s_pooled = global_mean_pool(s, batch)  # [batch_size, 32]
        s_cat = torch.cat([s_pooled, u_embed], dim=1)
        s_hidden = F.relu(self.score_fc1(s_cat))
        score_mean = self.score_mean_fc(s_hidden).squeeze(-1)  # [batch_size], unbounded
        # Stdev must be positive — softplus + small offset for numerical stability.
        score_stdev = F.softplus(self.score_stdev_fc(s_hidden).squeeze(-1)) + 1e-3

        return policy_logits, value, ownership, score_mean, score_stdev

    def predict(self, data: Data, valid_moves: list) -> Tuple[torch.Tensor, float]:
        """Backwards-compatible single-state predict — returns (policy, value)
        like the pre-C1 API. Use forward() directly to get all heads."""
        self.eval()
        with torch.no_grad():
            policy_logits, value, _own, _sm, _ss = self.forward(data)
            if valid_moves:
                valid_logits = policy_logits[valid_moves]
                policy = F.softmax(valid_logits, dim=0)
            else:
                policy = torch.zeros(1)
            return policy, value.item() if value.dim() == 0 else value[0].item()

def create_model(
    config: str = 'medium',
    use_attention: bool = True
) -> HexGoNet:
    """
    Create model with predefined configurations
    
    Configs:
    - tiny: 128 dim, 10 blocks (fast, for testing)
    - small: 192 dim, 15 blocks
    - medium: 256 dim, 20 blocks (default)
    - large: 320 dim, 30 blocks
    - huge: 384 dim, 40 blocks (strongest, slowest)
    """
    configs = {
        'tiny': {'hidden_dim': 128, 'num_blocks': 10},
        'small': {'hidden_dim': 192, 'num_blocks': 15},
        'medium': {'hidden_dim': 256, 'num_blocks': 20},
        'large': {'hidden_dim': 320, 'num_blocks': 30},
        'huge': {'hidden_dim': 384, 'num_blocks': 40},
    }
    
    cfg = configs.get(config, configs['medium'])
    
    return HexGoNet(
        input_dim=8,
        hidden_dim=cfg['hidden_dim'],
        num_blocks=cfg['num_blocks'],
        use_attention=use_attention,
        heads=4,
        activation='mish'
    )
