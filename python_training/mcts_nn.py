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
    
    def select_child(self, c_puct: float = 1.5, pass_q_bias: float = 0.0):
        """Select child using PUCT algorithm (AlphaZero-style).

        `pass_q_bias` is added to the q_value of any pass child during selection.
        This is the rootEndingBonusPoints mechanism (KataGo searchhelpers.cpp:351-423):
        a small Q-value penalty on pass moves at the root, scaled by how much
        territory is still unsettled. Pass at root with lots of neutral cells
        looks worse than the same Q from a real move. Caller passes 0 at non-root.
        """
        best_score = -float('inf')
        best_child = None

        sqrt_parent_visits = math.sqrt(self.visit_count)

        for child in self.children:
            if child.visit_count == 0:
                q_value = 0.0
            else:
                q_value = child.mean_value

            # Apply ending bonus (negative bias on pass) at root.
            if child.move == -1 and pass_q_bias != 0.0:
                q_value = q_value + pass_q_bias

            # PUCT formula
            u_value = c_puct * child.prior * sqrt_parent_visits / (1 + child.visit_count)
            score = q_value + u_value

            if score > best_score:
                best_score = score
                best_child = child

        return best_child
    
    def expand(self, policy_probs: np.ndarray, valid_moves: List[int],
               suppress_pass: bool = False,
               prune_useless_mask: Optional[List[bool]] = None):
        """Expand node with policy network priors.

        `suppress_pass=True` damps the pass prior to ~0 (KataGo shouldSuppressPass).
        `prune_useless_mask` (per-valid-move bool) damps that move's prior to ~0
        when set — used by KataGo's rootPruneUselessMoves: after the opponent
        passes, moves into our own settled (pass-alive) territory are useless
        and should not be considered.
        """
        self.is_expanded = True

        # Pass child
        pass_prob = policy_probs[-1] if len(policy_probs) == len(valid_moves) + 1 else 0.01
        if suppress_pass:
            pass_prob = pass_prob * 1e-6
        pass_board = self.board.clone()
        pass_board.play_move(-1)
        self.children.append(MCTSNode(pass_board, parent=self, move=-1, prior=pass_prob))

        # Real-move children, with optional per-move pruning
        for i, (move, prob) in enumerate(zip(valid_moves, policy_probs[:len(valid_moves)])):
            if prune_useless_mask is not None and i < len(prune_useless_mask) and prune_useless_mask[i]:
                prob = prob * 1e-6
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
        add_dirichlet_noise: bool = True,
        root_ending_bonus_points: float = 0.5,
    ):
        self.model = model
        self.device = device
        self.num_simulations = num_simulations
        self.c_puct = c_puct
        self.temperature = temperature
        self.add_dirichlet_noise = add_dirichlet_noise
        # KataGo selfplay8b.cfg:152 default. Penalty (in pseudo-points) applied
        # to pass moves at the root, converted to a Q-value bias scaled by the
        # amount of unsettled territory.
        self.root_ending_bonus_points = root_ending_bonus_points

        self.model.to(device)
        self.model.eval()
        self.last_root: Optional[MCTSNode] = None  # Exposed for debugging / sanity tests

    def search(self, root_board: HexBoard) -> Tuple[int, np.ndarray]:
        """
        Run MCTS search from root position
        
        Returns:
            best_move: selected move
            visit_distribution: visit counts for training
        """
        root = MCTSNode(root_board)

        # Single NN evaluation at root — gives us policy, value, and the
        # ownership predictions used for pass-suppression decisions.
        policy, value, ownership = self._evaluate_position(root_board)
        valid_moves = root_board.get_valid_moves()

        # NN-ownership-driven pass logic (KataGo cpp/search/searchhelpers.cpp):
        #   - shouldSuppressPass: if any legal move lies on unsettled territory
        #     (|ownership| < 0.95), the pass prior is heavily damped.
        #   - rootEndingBonusPoints: pass Q-bias scales with unsettled-cell
        #     count, so even if pass slips through prior damping, its Q-value
        #     looks worse than a real move on unsettled territory.
        # For an untrained net, ownership ~ 0 everywhere → strong pass suppression
        # (correct: untrained net shouldn't pass). As training progresses and
        # the net learns ownership, suppression naturally lifts in settled regions.
        OWNERSHIP_SETTLED_THRESHOLD = 0.95  # KataGo's threshold
        unsettled_count = int((np.abs(ownership) < OWNERSHIP_SETTLED_THRESHOLD).sum())
        suppress_pass = any(
            abs(ownership[m]) < OWNERSHIP_SETTLED_THRESHOLD for m in valid_moves
        ) if valid_moves else False
        root_pass_q_bias = -self.root_ending_bonus_points * 0.01 * unsettled_count

        # rootPruneUselessMoves (KataGo cpp/search/searchhelpers.cpp:318-334):
        # If the opponent has just passed, the moves into our OWN settled
        # territory are pointless dame-fills — damp their priors so we either
        # pass (settle the game) or play in contested/opponent areas.
        # Threshold (own ownership ≥ 0.95 from current player's perspective).
        opponent_just_passed = (
            len(root_board.move_history) > 0
            and root_board.move_history[-1][0] == -1
        )
        prune_useless_mask = None
        if opponent_just_passed and valid_moves:
            sign = 1 if root_board.current_player == 'black' else -1
            prune_useless_mask = [
                (sign * float(ownership[m])) >= OWNERSHIP_SETTLED_THRESHOLD
                for m in valid_moves
            ]

        root.expand(policy, valid_moves,
                    suppress_pass=suppress_pass,
                    prune_useless_mask=prune_useless_mask)

        # Add Dirichlet noise to root (for exploration)
        if self.add_dirichlet_noise:
            self._add_exploration_noise(root)

        # Run simulations
        for _ in range(self.num_simulations):
            node = root

            # Selection: traverse tree (apply root-only pass bias on first hop)
            while not node.is_leaf() and not node.board.is_finished():
                bias = root_pass_q_bias if node is root else 0.0
                node = node.select_child(self.c_puct, pass_q_bias=bias)
            
            # Expansion and evaluation
            if not node.board.is_finished():
                policy, value, _ = self._evaluate_position(node.board)
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

        self.last_root = root  # Expose for debugging / sanity tests

        # Return visit distribution for training
        visit_dist = np.zeros(root_board.num_vertices + 1)  # +1 for pass
        for move, count in zip(moves, visit_counts):
            if move == -1:
                visit_dist[-1] = count
            else:
                visit_dist[move] = count
        visit_dist = visit_dist / visit_dist.sum()
        
        return best_move, visit_dist
    
    def _evaluate_position(self, board: HexBoard) -> Tuple[np.ndarray, float, np.ndarray]:
        """Evaluate position with neural network. Returns (policy, value, ownership_per_vertex)."""
        data = board.to_graph_data().to(self.device)
        valid_moves = board.get_valid_moves()

        with torch.no_grad():
            policy_logits, value, ownership, score_mean, score_stdev = self.model(data)

            # Policy → softmax over (valid_moves + pass)
            if valid_moves:
                valid_logits = policy_logits[valid_moves].cpu().numpy()
                pass_logit = -2.0
                all_logits = np.concatenate([valid_logits, [pass_logit]])
                exp_logits = np.exp(all_logits - all_logits.max())
                policy = exp_logits / exp_logits.sum()
            else:
                policy = np.array([1.0])

            value = value.item() if value.dim() == 0 else float(value[0])
            ownership_arr = ownership.cpu().numpy()  # [num_vertices]

        return policy, value, ownership_arr
    
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
