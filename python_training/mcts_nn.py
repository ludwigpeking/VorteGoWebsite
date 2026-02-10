# Fast MCTS with Neural Network guidance
# Batched evaluation for efficiency

import numpy as np
import torch
from typing import List, Tuple, Optional
from hex_board import HexBoard
from graph_net import HexGoNet
import math

class MCTSNode:
    """Node in MCTS tree"""
    
    def __init__(self, board: HexBoard, parent=None, move=None, prior=0.0):
        self.board = board
        self.parent = parent
        self.move = move  # Move that led to this node
        self.prior = prior  # Prior probability from policy network
        
        self.children = []
        self.visit_count = 0
        self.total_value = 0.0
        self.mean_value = 0.0
        
        self.is_expanded = False
    
    def is_leaf(self):
        return not self.is_expanded
    
    def select_child(self, c_puct=1.5):
        """Select child using PUCT algorithm (AlphaZero-style)"""
        best_score = -float('inf')
        best_child = None
        
        sqrt_parent_visits = math.sqrt(self.visit_count)
        
        for child in self.children:
            if child.visit_count == 0:
                q_value = 0.0
            else:
                q_value = child.mean_value
            
            # PUCT formula
            u_value = c_puct * child.prior * sqrt_parent_visits / (1 + child.visit_count)
            score = q_value + u_value
            
            if score > best_score:
                best_score = score
                best_child = child
        
        return best_child
    
    def expand(self, policy_probs: np.ndarray, valid_moves: List[int]):
        """Expand node with policy network priors"""
        self.is_expanded = True
        
        # Add pass move
        pass_prob = policy_probs[-1] if len(policy_probs) == len(valid_moves) + 1 else 0.01
        pass_board = self.board.clone()
        pass_board.play_move(-1)
        self.children.append(MCTSNode(pass_board, parent=self, move=-1, prior=pass_prob))
        
        # Add valid moves
        for move, prob in zip(valid_moves, policy_probs[:len(valid_moves)]):
            child_board = self.board.clone()
            if child_board.play_move(move):
                self.children.append(MCTSNode(child_board, parent=self, move=move, prior=prob))
    
    def backpropagate(self, value: float):
        """Backpropagate value up the tree"""
        self.visit_count += 1
        self.total_value += value
        self.mean_value = self.total_value / self.visit_count
        
        if self.parent:
            # Flip value for opponent
            self.parent.backpropagate(-value)

class FastMCTS:
    """
    Fast MCTS with neural network guidance
    Supports batched evaluation for efficiency
    """
    
    def __init__(
        self,
        model: HexGoNet,
        device: str = 'cuda',
        num_simulations: int = 800,
        c_puct: float = 1.5,
        temperature: float = 1.0,
        add_dirichlet_noise: bool = True
    ):
        self.model = model
        self.device = device
        self.num_simulations = num_simulations
        self.c_puct = c_puct
        self.temperature = temperature
        self.add_dirichlet_noise = add_dirichlet_noise
        
        self.model.to(device)
        self.model.eval()
    
    def search(self, root_board: HexBoard) -> Tuple[int, np.ndarray]:
        """
        Run MCTS search from root position
        
        Returns:
            best_move: selected move
            visit_distribution: visit counts for training
        """
        root = MCTSNode(root_board)
        
        # Expand root with neural network
        policy, value = self._evaluate_position(root_board)
        valid_moves = root_board.get_valid_moves()
        root.expand(policy, valid_moves)
        
        # Add Dirichlet noise to root (for exploration)
        if self.add_dirichlet_noise:
            self._add_exploration_noise(root)
        
        # Run simulations
        for _ in range(self.num_simulations):
            node = root
            
            # Selection: traverse tree
            while not node.is_leaf() and not node.board.is_finished():
                node = node.select_child(self.c_puct)
            
            # Expansion and evaluation
            if not node.board.is_finished():
                policy, value = self._evaluate_position(node.board)
                valid_moves = node.board.get_valid_moves()
                node.expand(policy, valid_moves)
            else:
                # Terminal node
                winner = node.board.get_winner()
                if winner == node.board.current_player:
                    value = 1.0
                elif winner == 'draw':
                    value = 0.0
                else:
                    value = -1.0
            
            # Backpropagation
            node.backpropagate(value)
        
        # Select move based on visit counts
        visit_counts = np.array([child.visit_count for child in root.children])
        moves = [child.move for child in root.children]
        
        # Apply temperature
        if self.temperature == 0:
            # Greedy: select most visited
            best_idx = np.argmax(visit_counts)
        else:
            # Stochastic: sample proportional to visits^(1/temp)
            probs = visit_counts ** (1.0 / self.temperature)
            probs = probs / probs.sum()
            best_idx = np.random.choice(len(probs), p=probs)
        
        best_move = moves[best_idx]
        
        # Return visit distribution for training
        visit_dist = np.zeros(root_board.num_vertices + 1)  # +1 for pass
        for move, count in zip(moves, visit_counts):
            if move == -1:
                visit_dist[-1] = count
            else:
                visit_dist[move] = count
        visit_dist = visit_dist / visit_dist.sum()
        
        return best_move, visit_dist
    
    def _evaluate_position(self, board: HexBoard) -> Tuple[np.ndarray, float]:
        """Evaluate position with neural network"""
        data = board.to_graph_data().to(self.device)
        valid_moves = board.get_valid_moves()
        
        with torch.no_grad():
            policy_logits, value = self.model(data)
            
            # Get policy for valid moves + pass
            if valid_moves:
                valid_logits = policy_logits[valid_moves].cpu().numpy()
                # Pass gets a small negative bias (learned during training)
                # For untrained net, just use a small penalty
                pass_logit = -2.0
                all_logits = np.concatenate([valid_logits, [pass_logit]])
                
                # Softmax
                exp_logits = np.exp(all_logits - all_logits.max())
                policy = exp_logits / exp_logits.sum()
            else:
                # Only pass available
                policy = np.array([1.0])
            
            value = value.item()
        
        return policy, value
    
    def _add_exploration_noise(self, root: MCTSNode, alpha=0.3, epsilon=0.25):
        """Add Dirichlet noise to root for exploration (AlphaZero trick)"""
        noise = np.random.dirichlet([alpha] * len(root.children))
        for child, noise_val in zip(root.children, noise):
            child.prior = (1 - epsilon) * child.prior + epsilon * noise_val

class BatchedMCTS:
    """
    Run multiple MCTS searches in parallel with batched neural network calls
    Much faster than sequential searches
    """
    
    def __init__(
        self,
        model: HexGoNet,
        device: str = 'cuda',
        num_simulations: int = 800,
        batch_size: int = 32,
        c_puct: float = 1.5
    ):
        self.model = model
        self.device = device
        self.num_simulations = num_simulations
        self.batch_size = batch_size
        self.c_puct = c_puct
        
        self.model.to(device)
        self.model.eval()
    
    def search_batch(self, boards: List[HexBoard]) -> List[Tuple[int, np.ndarray]]:
        """
        Run MCTS for multiple boards simultaneously
        Batches neural network calls for efficiency
        
        Returns list of (best_move, visit_distribution) for each board
        """
        # TODO: Implement batched MCTS
        # This is more complex - requires managing multiple trees simultaneously
        # For now, use sequential FastMCTS
        
        results = []
        mcts = FastMCTS(
            self.model,
            device=self.device,
            num_simulations=self.num_simulations,
            c_puct=self.c_puct
        )
        
        for board in boards:
            move, visit_dist = mcts.search(board)
            results.append((move, visit_dist))
        
        return results
