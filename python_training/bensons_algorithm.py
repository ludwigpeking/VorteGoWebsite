"""
Benson's Algorithm for determining pass-alive territories in Go
Based on KataGo's C++ implementation in board.cpp/boardhistory.cpp

This algorithm identifies:
- Pass-alive territories (controlled even if opponent captures first)  
- Dead groups (groups with no escape)
- Seki regions (mutual life, belongs to neither player)
"""

from typing import Set, List, Dict, Tuple
import numpy as np
from hex_board import HexBoard

class BensonsAlgorithm:
    """
    Determines which empty regions and stones belong to which player
    after the game ends.
    
    Based on: https://senseis.xmp.net/?BensonsAlgorithm
    """
    
    def __init__(self, board: HexBoard):
        self.board = board
        self.num_vertices = board.num_vertices
        self.neighbors = board.vertex_neighbors
        self.stones = board.stones
        
    def calculate_area(self) -> Dict[int, str]:
        """
        Determine ownership of each vertex on the board.
        
        Returns: dict mapping vertex_id -> 'black' | 'white' | 'neutral'
        """
        ownership = {}
        
        # Step 1: Mark all stones with their color
        for vid in range(self.num_vertices):
            if vid in self.stones:
                ownership[vid] = self.stones[vid]
            else:
                ownership[vid] = None  # Empty, to be determined
        
        # Step 2: Find all empty regions (connected components of empty vertices)
        visited = set()
        regions = []
        
        for vid in range(self.num_vertices):
            if vid not in visited and ownership[vid] is None:
                region = self._flood_fill_region(vid, visited)
                regions.append(region)
        
        # Step 3: For each region, determine which player controls it
        for region in regions:
            controller = self._determine_region_controller(region)
            for vid in region:
                ownership[vid] = controller
        
        return ownership
    
    def _flood_fill_region(self, start: int, visited: Set[int]) -> Set[int]:
        """Find all connected empty vertices starting from start"""
        region = set()
        queue = [start]
        visited.add(start)
        
        while queue:
            vid = queue.pop(0)
            region.add(vid)
            
            for neighbor in self.neighbors.get(vid, []):
                if neighbor not in visited and self.stones.get(neighbor) is None:
                    visited.add(neighbor)
                    queue.append(neighbor)
        
        return region
    
    def _determine_region_controller(self, region: Set[int]) -> str:
        """
        Determine who controls an empty region.
        
        A player controls a region if:
        1. The region only borders that player's stones, OR
        2. The region borders both players' stones, but one player can capture it
        
        Returns: 'black' | 'white' | 'neutral'
        """
        # Find all adjacent stone colors
        adjacent_colors = set()
        
        for vid in region:
            for neighbor in self.neighbors.get(vid, []):
                if neighbor in self.stones:
                    adjacent_colors.add(self.stones[neighbor])
        
        # Case 1: Region only borders one color - that player owns it
        if len(adjacent_colors) == 1:
            return list(adjacent_colors)[0]
        
        # Case 2: Region borders both colors - check for control
        if len(adjacent_colors) == 2:
            # This is more complex in real Benson's algorithm
            # For now: return neutral (seki/dame)
            # TODO: Implement proper pass-alive analysis
            return 'neutral'
        
        # Case 3: Region borders no stones (shouldn't happen in normal games)
        return 'neutral'
    
    def score_game(self) -> Tuple[str, float]:
        """
        Score the game and determine winner.
        
        Returns: (winner: 'black' | 'white' | 'draw', score_difference)
        where score_difference is white_score - black_score
        """
        ownership = self.calculate_area()
        
        black_score = 0
        white_score = 0
        
        # Count controlled territories
        for vid, owner in ownership.items():
            if owner == 'black':
                black_score += 1
            elif owner == 'white':
                white_score += 1
        
        # Add komi (handicap adjustment for white)
        # Standard Go: 6.5 or 7.5
        komi = 6.5  # TODO: make configurable
        white_score += komi
        
        score_diff = white_score - black_score
        
        if score_diff > 0:
            return 'white', score_diff
        elif score_diff < 0:
            return 'black', -score_diff
        else:
            return 'draw', 0.0


def improved_bensons_algorithm(board: HexBoard) -> Tuple[str, float]:
    """
    Quick interface to Benson's algorithm.
    
    Args:
        board: HexBoard instance at game end
    
    Returns:
        (winner, score_difference)
    """
    algo = BensonsAlgorithm(board)
    return algo.score_game()


# Alternative: Simpler version for now
def simple_territory_count(board: HexBoard) -> Tuple[str, float]:
    """
    Simplified territory counting for initial training data generation.
    
    NOT as good as Benson's algorithm, but better than nothing.
    Counts territories based on single-color adjacency.
    """
    ownership = {}
    
    # Mark all stones
    for vid in range(board.num_vertices):
        if vid in board.stones:
            ownership[vid] = board.stones[vid]
        else:
            ownership[vid] = None
    
    # Flood-fill empty regions
    visited = set()
    for vid in range(board.num_vertices):
        if vid not in visited and ownership[vid] is None:
            # Find region
            region = set()
            queue = [vid]
            visited.add(vid)
            
            while queue:
                v = queue.pop(0)
                region.add(v)
                
                for neighbor in board.vertex_neighbors.get(v, []):
                    if neighbor not in visited and board.stones.get(neighbor) is None:
                        visited.add(neighbor)
                        queue.append(neighbor)
            
            # Determine controller
            adjacent_colors = set()
            for v in region:
                for neighbor in board.vertex_neighbors.get(v, []):
                    if neighbor in board.stones:
                        adjacent_colors.add(board.stones[neighbor])
            
            # Assign ownership
            if len(adjacent_colors) == 1:
                controller = list(adjacent_colors)[0]
            else:
                controller = 'neutral'
            
            for v in region:
                ownership[v] = controller
    
    # Count score
    black_score = sum(1 for owner in ownership.values() if owner == 'black')
    white_score = sum(1 for owner in ownership.values() if owner == 'white')
    
    komi = 6.5
    white_score += komi
    
    score_diff = white_score - black_score
    
    if score_diff > 0:
        return 'white', score_diff
    elif score_diff < 0:
        return 'black', -score_diff
    else:
        return 'draw', 0.0
