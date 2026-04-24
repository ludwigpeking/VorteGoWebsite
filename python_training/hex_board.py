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
        self.quads = data.get('quads', [])  # Game adjacency is derived from these
        self.triangles = data.get('triangles', [])

        # Build topology
        self.num_vertices = len(self.vertices)
        self.vertex_neighbors = self._build_adjacency()
        self.edge_index = self._build_edge_index()
        
        # Game state
        self.stones = {}  # vid -> 'black' or 'white'
        self.current_player = 'black'
        self.pass_count = 0
        self.move_history = []
        self.move_number = 0
        # Ko: positional, single-step, mirroring sketch.js. After each stone
        # placement we remember the board map from BEFORE that placement; the
        # next placement is rejected if its resulting map equals this one.
        self.previous_board_state: Optional[Dict[int, str]] = None
        # Single-stone ko hint, exposed as an NN input feature. Set to the
        # captured stone's vid when a move captures exactly one opponent stone.
        # Not consulted for legality (full ko check uses previous_board_state).
        self.ko_point: Optional[int] = None
        
    def _build_adjacency(self) -> Dict[int, Set[int]]:
        """Build neighbor sets the way the web game does.

        The JS game (common.js:rebuildEdgesFromFaces) derives adjacency from the
        goban's `quads` and `triangles` — each face contributes cyclic edges between
        its vertices. The top-level `peers` field on each vertex is NOT game
        adjacency (confirmed: on Shumi 0/127 vertices match between peers and
        quads-based neighbors). Using `peers` here desyncs Python rules from the
        web engine and makes trained models learn a different game.
        """
        adj: Dict[int, Set[int]] = {v['id']: set() for v in self.vertices}

        for q in self.quads:
            verts = q['verts'] if isinstance(q, dict) else q
            active = q.get('active', True) if isinstance(q, dict) else True
            if not active:
                continue
            n = len(verts)
            for i in range(n):
                a, b = verts[i], verts[(i + 1) % n]
                adj[a].add(b)
                adj[b].add(a)

        for t in self.triangles:
            verts = t['verts'] if isinstance(t, dict) else t
            active = t.get('active', True) if isinstance(t, dict) else True
            if not active:
                continue
            for i in range(3):
                a, b = verts[i], verts[(i + 1) % 3]
                adj[a].add(b)
                adj[b].add(a)

        # Fallback: if no faces were defined, fall back to top-level `edges`.
        # (Old gobans that pre-date quads may rely on this.)
        if not self.quads and not self.triangles and self.edges:
            for edge in self.edges:
                if not edge.get('active', True):
                    continue
                a, b = edge['a'], edge['b']
                adj[a].add(b)
                adj[b].add(a)

        # Respect invisible vertices (exclude from adjacency map entirely)
        for v in self.vertices:
            if v.get('visible', True) is False:
                adj.pop(v['id'], None)

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
        """Fast clone: share immutable topology (vertices/quads/neighbors/edge_index),
        copy only mutable game state. The goban structure never changes during a
        game, so rebuilding adjacency in __init__ on every MCTS clone is pure
        waste. Before this fix, each clone was O(quads) ≈ 108 ops × 6000+
        clones/move on Shumi — dominant bottleneck."""
        new_board = HexBoard.__new__(HexBoard)
        # Share immutable topology by reference (never mutated during play).
        new_board.vertices = self.vertices
        new_board.edges = self.edges
        new_board.quads = self.quads
        new_board.triangles = self.triangles
        new_board.num_vertices = self.num_vertices
        new_board.vertex_neighbors = self.vertex_neighbors
        new_board.edge_index = self.edge_index
        # Copy mutable game state.
        new_board.stones = self.stones.copy()
        new_board.current_player = self.current_player
        new_board.pass_count = self.pass_count
        new_board.move_history = self.move_history.copy()
        new_board.move_number = self.move_number
        new_board.previous_board_state = (
            dict(self.previous_board_state) if self.previous_board_state is not None else None
        )
        new_board.ko_point = self.ko_point
        return new_board
    
    def get_valid_moves(self) -> List[int]:
        """Get list of legal moves (vertex IDs)"""
        moves = []
        for vid in self.vertex_neighbors.keys():
            if vid not in self.stones and self.is_legal_move(vid):
                moves.append(vid)
        return moves
    
    def _group_and_liberties_in(self, stones: Dict[int, str], seed: int) -> Tuple[Set[int], int]:
        """Return (group, num_liberties) for the group containing `seed` in the given
        stones dict. Works on any stones map, not just self.stones, so we can use it
        on simulated post-move states."""
        if seed not in stones:
            return set(), 0
        color = stones[seed]
        group: Set[int] = set()
        liberties: Set[int] = set()
        queue = [seed]
        while queue:
            v = queue.pop()
            if v in group:
                continue
            group.add(v)
            for nid in self.vertex_neighbors.get(v, ()):
                if nid not in stones:
                    liberties.add(nid)
                elif stones[nid] == color and nid not in group:
                    queue.append(nid)
        return group, len(liberties)

    def _simulate_move(self, vid: int) -> Optional[Tuple[Dict[int, str], List[int]]]:
        """Simulate placing a stone at vid for the current player.

        Mirrors sketch.js:placeStone (lines ~2275–2343):
          1. Place the stone.
          2. Remove opponent groups that have zero liberties after the placement.
          3. Reject as SUICIDE if the placed stone's own group has zero liberties.
          4. Reject as KO if the resulting board map equals previous_board_state.

        Returns (new_stones_map, captured_vids) if legal, otherwise None.
        """
        if vid in self.stones:
            return None

        new_stones = dict(self.stones)
        new_stones[vid] = self.current_player
        opponent = 'white' if self.current_player == 'black' else 'black'

        captured: List[int] = []
        captured_set: Set[int] = set()
        for nid in self.vertex_neighbors.get(vid, ()):
            if new_stones.get(nid) == opponent and nid not in captured_set:
                group, libs = self._group_and_liberties_in(new_stones, nid)
                if libs == 0:
                    captured.extend(group)
                    captured_set.update(group)

        for c in captured_set:
            del new_stones[c]

        # Suicide check — must be done AFTER captures (a move that kills opponents
        # is not suicide even if its own neighbors were all enemies).
        if vid in new_stones:
            _, my_libs = self._group_and_liberties_in(new_stones, vid)
            if my_libs == 0:
                return None

        # Ko check — positional, one-step memory (matches sketch.js boardStatesEqual).
        if self.previous_board_state is not None and new_stones == self.previous_board_state:
            return None

        return new_stones, captured

    def is_legal_move(self, vid: int) -> bool:
        """Legal iff the full simulation (suicide + ko) passes."""
        return self._simulate_move(vid) is not None

    def play_move(self, vid: int) -> bool:
        """Play a move. Returns True on success, False if illegal."""
        if vid == -1:  # Pass
            self.pass_count += 1
            self.current_player = 'white' if self.current_player == 'black' else 'black'
            self.move_history.append((-1, None))
            self.move_number += 1
            # JS does NOT reset previous_board_state on pass — ko restrictions persist.
            return True

        sim = self._simulate_move(vid)
        if sim is None:
            return False

        new_stones, captured = sim
        board_before_this_move = dict(self.stones)
        self.stones = new_stones
        self.previous_board_state = board_before_this_move
        self.ko_point = captured[0] if len(captured) == 1 else None
        self.move_history.append((vid, list(captured)))
        self.move_number += 1
        self.pass_count = 0
        self.current_player = 'white' if self.current_player == 'black' else 'black'
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
    
    def score(self, komi: float = 7.5) -> Tuple[str, float, Dict[int, int]]:
        """Final area score using Benson pass-alive detection.

        Returns (winner, margin, ownership_map) where:
          - winner: 'black' | 'white' | 'draw'
          - margin: non-negative |white_score - black_score|
          - ownership_map: dict vid -> {+1 black, -1 white, 0 neutral}

        This is the canonical end-of-game scoring used for both legacy
        get_winner() and for training-target generation (ownership labels).
        """
        # Local import to avoid circular dependency at module load
        from bensons_algorithm import score_board
        return score_board(self.stones, self.vertex_neighbors, komi=komi)

    def get_winner(self) -> str:
        """Backwards-compatible alias — returns the winner string only."""
        winner, _, _ = self.score()
        return winner
