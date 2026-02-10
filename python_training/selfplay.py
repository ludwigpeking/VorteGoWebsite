# Self-play engine for generating training data
# Plays games using MCTS + Neural Network

import torch
import numpy as np
from pathlib import Path
import json
from datetime import datetime
from typing import List, Dict
import glob

from hex_board import HexBoard
from graph_net import HexGoNet, create_model
from mcts_nn import FastMCTS

class SelfPlayEngine:
    """Generate training data through self-play"""
    
    def __init__(
        self,
        model: HexGoNet,
        goban_files: List[str],
        output_dir: str = 'training_data',
        device: str = 'cuda',
        num_simulations: int = 800,
        temperature_threshold: int = 30  # Use temp=1 for first N moves, then temp=0
    ):
        self.model = model
        self.goban_files = goban_files
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.device = device
        self.num_simulations = num_simulations
        self.temperature_threshold = temperature_threshold
        
        self.mcts = FastMCTS(
            model=model,
            device=device,
            num_simulations=num_simulations,
            c_puct=1.5,
            temperature=1.0,
            add_dirichlet_noise=True
        )
    
    def play_game(self, goban_file: str) -> Dict:
        """
        Play one self-play game
        
        Returns dict with:
        - states: list of board states (as graph data)
        - policies: list of MCTS visit distributions
        - winner: final game result
        - moves: list of moves played
        """
        board = HexBoard(goban_file)
        
        states = []
        policies = []
        moves = []
        
        move_num = 0
        
        while not board.is_finished() and move_num < 500:  # Max 500 moves
            # Adjust temperature
            if move_num < self.temperature_threshold:
                self.mcts.temperature = 1.0  # Exploration
            else:
                self.mcts.temperature = 0.0  # Exploitation
            
            # Run MCTS
            move, visit_dist = self.mcts.search(board)
            
            # Store training data
            states.append(board.to_graph_data())
            policies.append(visit_dist)
            moves.append(move)
            
            # Play move
            board.play_move(move)
            move_num += 1
        
        # Get final result
        winner = board.get_winner()
        
        # Assign values: +1 for winner's perspective, -1 for loser
        values = []
        for state_idx, move in enumerate(moves):
            # Determine who played this move
            player = 'black' if state_idx % 2 == 0 else 'white'
            
            if winner == 'draw':
                value = 0.0
            elif winner == player:
                value = 1.0
            else:
                value = -1.0
            
            values.append(value)
        
        return {
            'goban_file': goban_file,
            'states': states,
            'policies': policies,
            'values': values,
            'moves': moves,
            'winner': winner,
            'num_moves': len(moves)
        }
    
    def generate_games(self, num_games: int = 100, save_every: int = 10):
        """Generate multiple self-play games"""
        print(f"\n{'='*60}")
        print(f"SELF-PLAY GENERATION")
        print(f"{'='*60}")
        print(f"Number of games: {num_games}")
        print(f"Goban presets: {len(self.goban_files)}")
        for f in self.goban_files:
            print(f"  - {Path(f).stem}")
        print(f"MCTS simulations: {self.num_simulations}")
        print(f"Device: {self.device}")
        print(f"Output directory: {self.output_dir}")
        print(f"{'='*60}\n")
        
        all_games = []
        
        for game_idx in range(num_games):
            # Randomly select goban
            goban_file = np.random.choice(self.goban_files)
            goban_name = Path(goban_file).stem
            
            print(f"Game {game_idx + 1}/{num_games} - {goban_name}...", end=' ')
            
            try:
                game_data = self.play_game(goban_file)
                all_games.append(game_data)
                
                print(f"✓ {game_data['num_moves']} moves, winner: {game_data['winner']}")
                
                # Save periodically
                if (game_idx + 1) % save_every == 0:
                    self._save_games(all_games, game_idx + 1)
                    print(f"\n  Progress: {game_idx + 1}/{num_games} games completed")
                    print(f"  Average moves/game: {sum(g['num_moves'] for g in all_games) / len(all_games):.1f}\n")
                    all_games = []  # Clear to save memory
                    
            except Exception as e:
                print(f"✗ Error: {e}")
                continue
        
        # Save remaining games
        if all_games:
            self._save_games(all_games, num_games)
        
        print(f"\n{'='*60}")
        print(f"SELF-PLAY COMPLETE!")
        print(f"{'='*60}")
        print(f"✓ {num_games} games generated")
        print(f"✓ Data saved to {self.output_dir}/")
        print(f"\nTo view games:")
        print(f"  python export_games.py --data-dir {self.output_dir}")
        print(f"{'='*60}\n")
    
        
        print(f"\nSelf-play complete! Data saved to {self.output_dir}/")
    
    def _save_games(self, games: List[Dict], batch_num: int):
        """Save games to disk"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = self.output_dir / f"selfplay_batch_{batch_num}_{timestamp}.pt"
        
        # Convert to saveable format
        save_data = {
            'games': []
        }
        
        for game in games:
            # Convert graph Data objects to dict
            game_save = {
                'goban_file': game['goban_file'],
                'states': [self._data_to_dict(s) for s in game['states']],
                'policies': [p.tolist() for p in game['policies']],
                'values': game['values'],
                'moves': game['moves'],
                'winner': game['winner'],
                'num_moves': game['num_moves']
            }
            save_data['games'].append(game_save)
        
        torch.save(save_data, filename)
        print(f"  → Saved {len(games)} games to {filename}")
    
    def _data_to_dict(self, data):
        """Convert PyTorch Geometric Data to dict for saving"""
        return {
            'x': data.x.cpu().numpy().tolist(),
            'edge_index': data.edge_index.cpu().numpy().tolist(),
            'u': data.u.cpu().numpy().tolist() if hasattr(data, 'u') else None,
            'num_nodes': data.num_nodes
        }

def main():
    """Run self-play"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Run self-play for Hexagonal Go')
    parser.add_argument('--gobans-dir', type=str, default='../gobans', help='Directory with goban JSON files')
    parser.add_argument('--output-dir', type=str, default='training_data', help='Output directory')
    parser.add_argument('--num-games', type=int, default=100, help='Number of games to generate')
    parser.add_argument('--model-config', type=str, default='tiny', choices=['tiny', 'small', 'medium', 'large', 'huge'], help='Model size')
    parser.add_argument('--model-path', type=str, default=None, help='Path to trained model (if resuming)')
    parser.add_argument('--simulations', type=int, default=50, help='MCTS simulations per move (start low: 50-100 for untrained models)')
    parser.add_argument('--device', type=str, default='cuda', help='Device (cuda/cpu)')
    args = parser.parse_args()
    
    # Find goban files
    gobans_dir = Path(args.gobans_dir)
    goban_files = glob.glob(str(gobans_dir / '*.json'))
    
    if not goban_files:
        print(f"Error: No goban files found in {gobans_dir}")
        return
    
    print(f"Found {len(goban_files)} goban presets:")
    for f in goban_files:
        print(f"  - {Path(f).name}")
    print()
    
    # Create or load model
    if args.model_path:
        print(f"Loading model from {args.model_path}...")
        model = create_model(args.model_config, use_attention=True)
        model.load_state_dict(torch.load(args.model_path))
    else:
        print(f"Creating new {args.model_config} model...")
        model = create_model(args.model_config, use_attention=True)
        print("  (Using random initialization - will generate random-ish games)")
    
    print()
    
    # Create engine
    engine = SelfPlayEngine(
        model=model,
        goban_files=goban_files,
        output_dir=args.output_dir,
        device=args.device,
        num_simulations=args.simulations,
        temperature_threshold=30
    )
    
    # Generate games
    engine.generate_games(num_games=args.num_games, save_every=10)

if __name__ == '__main__':
    main()
