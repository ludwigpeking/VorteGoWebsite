"""
Generate and immediately visualize a single game
"""

import sys
import os
sys.path.append(os.path.dirname(__file__))

from hex_board import HexBoard
from graph_net import create_model
from mcts_nn import FastMCTS
import torch
import json
from pathlib import Path

def play_one_game_and_export(goban_path: str, simulations: int = 10):
    """Play one game and export to JSON immediately"""
    
    print(f"\n{'='*60}")
    print(f"Playing game on: {Path(goban_path).name}")
    print(f"MCTS simulations per move: {simulations}")
    print(f"{'='*60}\n")
    
    # Load board
    board = HexBoard(goban_path)
    print(f"Board loaded: {board.num_vertices} vertices")
    
    # Create model
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Device: {device}")
    model = create_model('tiny')
    model.to(device)
    
    # Create MCTS
    mcts = FastMCTS(
        model=model,
        device=device,
        num_simulations=simulations,
        temperature=1.0
    )
    
    # Play game
    game_record = {
        'goban': Path(goban_path).name,
        'moves': [],
        'states': []
    }
    
    move_num = 0
    while not board.is_finished() and move_num < 200:  # Limit to 200 moves
        print(f"Move {move_num + 1}...", end=' ', flush=True)
        
        # Run MCTS
        move, policy = mcts.search(board)
        
        # Record state before move
        game_record['states'].append({
            'move_number': move_num,
            'current_player': board.current_player,
            'num_stones': len(board.stones),
            'black_stones': sum(1 for c in board.stones.values() if c == 'black'),
            'white_stones': sum(1 for c in board.stones.values() if c == 'white')
        })
        
        # Play move
        if move == -1:
            game_record['moves'].append({'player': board.current_player, 'move': 'pass'})
            print(f"{board.current_player} passes")
        else:
            game_record['moves'].append({'player': board.current_player, 'move': move})
            print(f"{board.current_player} plays at {move}")
        
        board.play_move(move)
        move_num += 1
    
    # Game over
    winner = board.get_winner()
    game_record['winner'] = winner
    game_record['total_moves'] = move_num
    
    print(f"\n{'='*60}")
    print(f"Game finished after {move_num} moves")
    print(f"Winner: {winner}")
    print(f"{'='*60}\n")
    
    # Save to JSON
    output_dir = Path('game_review')
    output_dir.mkdir(exist_ok=True)
    
    output_file = output_dir / f"game_{Path(goban_path).stem}.json"
    with open(output_file, 'w') as f:
        json.dump(game_record, f, indent=2)
    
    print(f"✓ Game saved to: {output_file}")
    return game_record

if __name__ == '__main__':
    # Use a small goban for faster testing
    goban_path = '../gobans/Shumi.json'
    
    if not Path(goban_path).exists():
        print(f"Error: {goban_path} not found")
        sys.exit(1)
    
    game = play_one_game_and_export(goban_path, simulations=10)
    
    print("\n" + "="*60)
    print("GAME SUMMARY")
    print("="*60)
    print(f"Total moves: {game['total_moves']}")
    print(f"Winner: {game['winner']}")
    print(f"\nFirst 10 moves:")
    for i, move in enumerate(game['moves'][:10]):
        print(f"  {i+1}. {move['player']}: {move['move']}")
