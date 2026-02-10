# Simplified self-play that doesn't rely on neural network for untrained models
# Uses random playouts until we have initial training data

import sys
import os
sys.path.append(os.path.dirname(__file__))

from hex_board import HexBoard
import random
import json
from pathlib import Path
import torch
import numpy as np

def play_random_game(goban_path: str, max_moves: int = 500):
    """
    Play a game using random valid moves (no MCTS, no NN)
    This generates initial training data before the NN is trained
    """
    board = HexBoard(goban_path)
    
    game_record = {
        'goban_name': Path(goban_path).stem,  # Name without extension
        'moves': [],
        'num_stones_per_move': [],
        'winner': None,
        'passes': 0,
        'final_score': None
    }
    
    move_count = 0
    
    while move_count < max_moves:
        valid_moves = board.get_valid_moves()
        
        board_fullness = len(board.stones) / board.num_vertices
        num_valid = len(valid_moves)
        
        # Allow passing more liberally - let players decide naturally
        # Pass becomes increasingly likely as board fills up
        can_pass = len(valid_moves) > 0  # Only if moves available
        pass_probability = 0.0
        
        if board_fullness > 0.9:
            pass_probability = 0.3  # 30% chance to pass when board nearly full
        elif board_fullness > 0.8:
            pass_probability = 0.15  # 15% chance when board is full
        elif board_fullness > 0.6:
            pass_probability = 0.05  # 5% chance in mid-game
        # else: very unlikely to pass in early game
        
        if can_pass and random.random() < pass_probability:
            move = -1  # Pass
        elif valid_moves:
            move = random.choice(valid_moves)
        else:
            # No valid moves - must pass
            move = -1
        
        # Record move as simple string
        move_str = 'pass' if move == -1 else str(move)
        game_record['moves'].append(move_str)
        game_record['num_stones_per_move'].append(len(board.stones))
        
        board.play_move(move)
        move_count += 1
        
        # Check for game end (two consecutive passes) using board's pass count
        if board.is_finished():
            break
    
    # Determine winner
    winner = board.get_winner()
    game_record['winner'] = winner
    game_record['passes'] = board.pass_count  # Store final pass count from board
    game_record['total_moves'] = move_count
    
    return game_record, board

def generate_random_games(num_games: int, gobans_dir: str = None):
    """Generate multiple random games for initial training"""
    import glob
    
    if gobans_dir is None:
        # Find gobans directory relative to workspace root
        script_dir = Path(__file__).parent
        gobans_dir = script_dir.parent / 'gobans'
    
    goban_files = glob.glob(str(Path(gobans_dir) / '*.json'))
    if not goban_files:
        print(f"Error: No goban files found in {gobans_dir}")
        return []
    
    print(f"Generating {num_games} random games from {len(goban_files)} gobans...")
    
    games = []
    for i in range(num_games):
        goban = random.choice(goban_files)
        print(f"Game {i+1}/{num_games} - {Path(goban).name}...", end=' ', flush=True)
        
        try:
            game_record, final_board = play_random_game(goban)
            games.append(game_record)
            print(f"✓ {game_record['total_moves']} moves, winner: {game_record['winner']}")
        except Exception as e:
            print(f"✗ Error: {e}")
    
    return games

if __name__ == '__main__':
    # Generate initial training games
    games = generate_random_games(20)
    
    # Save to JSON with wrapper
    output_dir = Path('game_review')
    output_dir.mkdir(exist_ok=True)
    
    output_file = output_dir / 'random_games.json'
    output_data = {'games': games}
    with open(output_file, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"\n✓ Saved {len(games)} games to {output_file}")
    
    # Print statistics
    if games:
        move_counts = [g['total_moves'] for g in games]
        print(f"\nGame length statistics:")
        print(f"  Min: {min(move_counts)} moves")
        print(f"  Max: {max(move_counts)} moves")
        print(f"  Average: {sum(move_counts)/len(move_counts):.1f} moves")
