# Graph representation for hexagonal Go boards
# Handles irregular topology - works with any goban structure

import numpy as np
import torch
from torch_geometric.data import Data
import json
from typing import List, Dict, Set, Tuple, Optional

class HexBoard:
    """Represents a hexagonal Go board with irregular topology"""
    
    def __init__(self, goban_file: str = None, goban_data: dict = None):
        """
        Initialize from either:
        - goban_file: path to JSON preset (e.g., "Shumi.json")
        - goban_data: dict with vertices and edges
        """
        if goban_file:
            with open(goban_file, 'r') as f:
                data = json.load(f)
        else:
            data = goban_data
        
        self.vertices = data['vertices']
        self.edges = data.get('edges', [])  # May not exist in your format
        
        # Build topology
        self.num_vertices = len(self.vertices)
        self.vertex_neighbors = self._build_adjacency()
        self.edge_index = self._build_edge_index()
        
        # Game state
        self.stones = {}  # vid -> 'black' or 'white'
        self.current_player = 'black'
        self.ko_point = None
        self.pass_count = 0
        self.move_history = []
        self.move_number = 0
        
    def _build_adjacency(self) -> Dict[int, Set[int]]:
        """Build neighbor sets for each vertex using peers or edges"""
        adj = {}
        
        for v in self.vertices:
            vid = v['id']
            if v.get('visible', True) is False:
                continue
            
            neighbors = set()
            
            # Use 'peers' if available (your format)
            if 'peers' in v:
                neighbors = set(v['peers'])
                neighbors.discard(vid)  # Remove self-reference
            # Otherwise use edges
            elif self.edges:
                for edge in self.edges:
                    if not edge.get('active', True):
                        continue
                    a, b = edge['a'], edge['b']
                    if a == vid:
                        neighbors.add(b)
                    elif b == vid:
                        neighbors.add(a)
            
            adj[vid] = neighbors
        
        return adj
    
    def _build_edge_index(self) -> torch.Tensor:
        """Build edge_index tensor for PyTorch Geometric [2, num_edges]"""
        edges = []
        seen = set()
        
        for vid, neighbors in self.vertex_neighbors.items():
            for nid in neighbors:
                edge_key = tuple(sorted([vid, nid]))
                if edge_key not in seen:
                    edges.append([vid, nid])
                    edges.append([nid, vid])
                    seen.add(edge_key)
        
        if not edges:
            return torch.zeros((2, 0), dtype=torch.long)
        
        return torch.tensor(edges, dtype=torch.long).t().contiguous()
    
    def clone(self):
        """Deep copy of board state"""
        new_board = HexBoard(goban_data={'vertices': self.vertices, 'edges': self.edges})
        new_board.stones = self.stones.copy()
        new_board.current_player = self.current_player
        new_board.ko_point = self.ko_point
        new_board.pass_count = self.pass_count
        new_board.move_history = self.move_history.copy()
        new_board.move_number = self.move_number
        return new_board
    
    def get_valid_moves(self) -> List[int]:
        """Get list of legal moves (vertex IDs)"""
        moves = []
        for vid in self.vertex_neighbors.keys():
            if vid not in self.stones and self.is_legal_move(vid):
                moves.append(vid)
        return moves
    
    def is_legal_move(self, vid: int) -> bool:
        """Check if move is legal (not suicide, not ko)"""
        if vid in self.stones:
            return False
        
        if self.ko_point == vid:
            return False
        
        # Check suicide: must have liberty or capture opponent
        has_liberty = False
        would_capture = False
        
        for nid in self.vertex_neighbors[vid]:
            if nid not in self.stones:
                has_liberty = True
            elif self.stones[nid] != self.current_player:
                # Check if would capture opponent
                if self._count_liberties(nid, exclude=vid) == 0:
                    would_capture = True
        
        return has_liberty or would_capture
    
    def play_move(self, vid: int) -> bool:
        """
        Play a stone at vertex vid
        Returns True if successful, False if illegal
        """
        if vid == -1:  # Pass
            self.pass_count += 1
            self.current_player = 'white' if self.current_player == 'black' else 'black'
            self.move_history.append((-1, None))
            self.move_number += 1
            self.ko_point = None
            return True
        
        if not self.is_legal_move(vid):
            return False
        
        self.pass_count = 0
        self.stones[vid] = self.current_player
        
        # Check for captures
        captured = []
        opponent = 'white' if self.current_player == 'black' else 'black'
        for nid in self.vertex_neighbors[vid]:
            if self.stones.get(nid) == opponent:
                if self._count_liberties(nid) == 0:
                    captured_group = self._capture_group(nid)
                    captured.extend(captured_group)
        
        # Ko detection: if exactly 1 stone captured, that's ko point
        self.ko_point = captured[0] if len(captured) == 1 else None
        
        self.move_history.append((vid, captured))
        self.move_number += 1
        self.current_player = opponent
        
        return True
    
    def _count_liberties(self, vid: int, exclude: Optional[int] = None) -> int:
        """Count liberties of group containing vid"""
        if vid not in self.stones:
            return 0
        
        color = self.stones[vid]
        visited = set()
        queue = [vid]
        liberties = set()
        
        while queue:
            v = queue.pop(0)
            if v in visited:
                continue
            visited.add(v)
            
            for nid in self.vertex_neighbors[v]:
                if nid == exclude:
                    continue
                
                if nid not in self.stones:
                    liberties.add(nid)
                elif self.stones[nid] == color and nid not in visited:
                    queue.append(nid)
        
        return len(liberties)
    
    def _capture_group(self, vid: int) -> List[int]:
        """Capture group containing vid, return list of captured stones"""
        if vid not in self.stones:
            return []
        
        color = self.stones[vid]
        captured = []
        visited = set()
        queue = [vid]
        
        while queue:
            v = queue.pop(0)
            if v in visited:
                continue
            visited.add(v)
            captured.append(v)
            del self.stones[v]
            
            for nid in self.vertex_neighbors[v]:
                if self.stones.get(nid) == color and nid not in visited:
                    queue.append(nid)
        
        return captured
    
    def is_finished(self) -> bool:
        """Check if game is over (both players passed)"""
        return self.pass_count >= 2
    
    def to_graph_data(self) -> Data:
        """
        Convert board state to PyTorch Geometric Data object
        
        Node features:
        - Stone color (3 channels: empty, black, white)
        - Stone age (1 channel: normalized move recency)
        - Liberties (1 channel: log-scaled)
        - Ko point (1 channel: binary)
        - Vertex degree (1 channel: normalized, helps with variable topology)
        - Player to move (1 channel: binary)
        Total: 8 node features
        """
        node_features = []
        
        for vid in range(self.num_vertices):
            if vid not in self.vertex_neighbors:
                # Invisible vertex
                node_features.append([0] * 8)
                continue
            
            # Stone color (one-hot)
            if vid not in self.stones:
                stone = [1, 0, 0]  # Empty
            elif self.stones[vid] == 'black':
                stone = [0, 1, 0]  # Black
            else:
                stone = [0, 0, 1]  # White
            
            # Stone age (recency)
            age = 0.0
            for i, (move_vid, _) in enumerate(reversed(self.move_history)):
                if move_vid == vid:
                    age = 1.0 - (i / max(len(self.move_history), 1))
                    break
            
            # Liberties (log-scaled)
            if vid in self.stones:
                libs = self._count_liberties(vid)
                lib_feature = np.log1p(libs) / 3.0  # Normalize
            else:
                lib_feature = 0.0
            
            # Ko point
            ko = 1.0 if vid == self.ko_point else 0.0
            
            # Vertex degree (normalized by max degree 6)
            degree = len(self.vertex_neighbors[vid]) / 6.0
            
            # Player to move
            player = 1.0 if self.current_player == 'black' else 0.0
            
            node_features.append(stone + [age, lib_feature, ko, degree, player])
        
        x = torch.tensor(node_features, dtype=torch.float)
        
        # Global features
        # Move number (normalized)
        move_num = self.move_number / 300.0  # Assume max ~300 moves
        
        # Pass count
        pass_ct = self.pass_count / 2.0
        
        u = torch.tensor([[move_num, pass_ct]], dtype=torch.float)  # Shape [1, 2] for batch
        
        return Data(
            x=x,
            edge_index=self.edge_index,
            u=u,
            num_nodes=self.num_vertices,
            batch=torch.zeros(self.num_vertices, dtype=torch.long)
        )
    
    def get_winner(self) -> str:
        """
        Determine winner using proper territory calculation.
        Uses Benson's Algorithm concepts for more accurate endgame evaluation.
        
        Returns 'black', 'white', or 'draw'
        """
        # Import here to avoid circular dependency
        from bensons_algorithm import simple_territory_count
        
        winner, _ = simple_territory_count(self)
        return winner
