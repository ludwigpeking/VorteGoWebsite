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
        
        # Policy head
        self.policy_conv = GCNConv(hidden_dim, 128)
        self.policy_bn = nn.BatchNorm1d(128)
        self.policy_fc = nn.Linear(128, 1)  # Per-node move probability
        
        # Value head
        self.value_conv = GCNConv(hidden_dim, 64)
        self.value_bn = nn.BatchNorm1d(64)
        # Global pooling + FC layers
        self.value_fc1 = nn.Linear(64 + 64, 256)  # 64 from graph + 64 from global
        self.value_fc2 = nn.Linear(256, 1)
        
    def forward(self, data: Data) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass
        
        Args:
            data: PyTorch Geometric Data object with:
                - x: node features [num_nodes, input_dim]
                - edge_index: edge connectivity [2, num_edges]
                - u: global features [batch_size, 2] or [2]
                - batch: batch assignment for nodes
        
        Returns:
            policy_logits: [num_nodes] move probabilities
            value: [batch_size] win probability
        """
        x, edge_index = data.x, data.edge_index
        u = data.u if hasattr(data, 'u') else None
        batch = data.batch if hasattr(data, 'batch') else torch.zeros(x.size(0), dtype=torch.long, device=x.device)
        
        # Embed input
        x = self.input_embed(x)
        
        # Handle global features - ensure correct dimensions
        if u is not None:
            # If u is 1D [2], reshape to [1, 2]
            if u.dim() == 1:
                u = u.unsqueeze(0)
            u_embed = self.global_embed(u)
        else:
            num_graphs = batch.max().item() + 1
            u_embed = torch.zeros((num_graphs, 64), device=x.device, dtype=x.dtype)
        
        # Residual tower
        for block in self.blocks:
            x = block(x, edge_index)
        
        # Policy head
        policy = self.policy_conv(x, edge_index)
        policy = self.policy_bn(policy)
        policy = F.relu(policy)
        policy_logits = self.policy_fc(policy).squeeze(-1)  # [num_nodes]
        
        # Value head
        value = self.value_conv(x, edge_index)
        value = self.value_bn(value)
        value = F.relu(value)
        
        # Global pooling (aggregate all nodes per graph)
        value_pooled = global_mean_pool(value, batch)  # [batch_size, 64]
        
        # Concatenate with global features
        value_cat = torch.cat([value_pooled, u_embed], dim=1)
        
        value = F.relu(self.value_fc1(value_cat))
        value = torch.tanh(self.value_fc2(value))  # [batch_size, 1]
        
        return policy_logits, value.squeeze(-1)
    
    def predict(self, data: Data, valid_moves: list) -> Tuple[torch.Tensor, float]:
        """
        Predict for single board state
        
        Returns:
            policy: [num_valid_moves] probability distribution over valid moves
            value: scalar win probability
        """
        self.eval()
        with torch.no_grad():
            policy_logits, value = self.forward(data)
            
            # Filter to valid moves and apply softmax
            if valid_moves:
                valid_logits = policy_logits[valid_moves]
                policy = F.softmax(valid_logits, dim=0)
            else:
                policy = torch.zeros(1)
            
            return policy, value.item()

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
