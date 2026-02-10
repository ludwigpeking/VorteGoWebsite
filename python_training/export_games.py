# Export self-play games to human-readable formats
# Supports SGF and JSON for visualization

import torch
import json
from pathlib import Path
from typing import List, Dict
import numpy as np

def export_game_to_json(game_data: Dict, output_file: str):
    """
    Export game to JSON format for web visualization
    Compatible with your existing web interface
    """
    # Convert game data to simple format
    export_data = {
        'goban_file': game_data['goban_file'],
        'moves': [],
        'winner': game_data['winner'],
        'num_moves': game_data['num_moves']
    }
    
    # Export moves with additional info
    for i, (move, policy, value) in enumerate(zip(
        game_data['moves'],
        game_data['policies'],
        game_data['values']
    )):
        player = 'black' if i % 2 == 0 else 'white'
        
        move_data = {
            'move_num': i + 1,
            'player': player,
            'vertex_id': int(move) if move != -1 else -1,
            'is_pass': move == -1,
            'value_estimate': float(value),
            'policy_top_moves': _get_top_policy_moves(policy, top_k=5)
        }
        export_data['moves'].append(move_data)
    
    # Save to JSON
    with open(output_file, 'w') as f:
        json.dump(export_data, f, indent=2)
    
    print(f"Exported game to {output_file}")
    return export_data

def _get_top_policy_moves(policy: np.ndarray, top_k: int = 5) -> List[Dict]:
    """Get top K moves from policy distribution"""
    top_indices = np.argsort(policy)[-top_k:][::-1]
    top_probs = policy[top_indices]
    
    moves = []
    for idx, prob in zip(top_indices, top_probs):
        if prob > 0.001:  # Only include significant moves
            moves.append({
                'vertex_id': int(idx) if idx < len(policy) - 1 else -1,
                'probability': float(prob)
            })
    return moves

def export_game_to_sgf(game_data: Dict, goban_data: Dict, output_file: str):
    """
    Export game to SGF format for viewing in Go programs
    Note: SGF is designed for rectangular boards, so this is approximate
    """
    moves = game_data['moves']
    winner = game_data['winner']
    
    # Build SGF
    sgf_lines = []
    sgf_lines.append("(;GM[1]FF[4]")  # Go game
    sgf_lines.append(f"PB[AI Black]PW[AI White]")
    sgf_lines.append(f"RE[{winner.upper()}]")
    sgf_lines.append(f"KM[7.5]")
    sgf_lines.append(f"RU[Tromp-Taylor]")
    sgf_lines.append(f"DT[{game_data.get('timestamp', 'Unknown')}]")
    sgf_lines.append(f"SZ[19]")  # Approximate - hexagonal boards don't fit SGF well
    sgf_lines.append(f"C[Hexagonal Go - {Path(game_data['goban_file']).stem}]")
    
    # Add moves
    for i, move in enumerate(moves):
        player = 'B' if i % 2 == 0 else 'W'
        
        if move == -1:
            sgf_lines.append(f";{player}[]")  # Pass
        else:
            # Map vertex ID to approximate coordinates
            # This is very approximate since hexagonal boards don't map to rectangular
            sgf_lines.append(f";{player}[vertex{move}]")
    
    sgf_lines.append(")")
    
    sgf_content = "".join(sgf_lines)
    
    with open(output_file, 'w') as f:
        f.write(sgf_content)
    
    print(f"Exported game to {output_file} (approximate SGF)")
    return sgf_content

def export_games_from_pt(pt_file: str, output_dir: str = 'exported_games'):
    """
    Load .pt file from selfplay and export all games to JSON/SGF
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    print(f"Loading games from {pt_file}...")
    data = torch.load(pt_file)
    games = data['games']
    
    print(f"Found {len(games)} games")
    
    for i, game in enumerate(games):
        base_name = f"game_{i+1}"
        goban_name = Path(game['goban_file']).stem
        
        # Export to JSON
        json_file = output_dir / f"{base_name}_{goban_name}.json"
        export_game_to_json(game, str(json_file))
        
        print(f"  Game {i+1}: {game['num_moves']} moves, winner: {game['winner']}")
    
    print(f"\n✓ Exported {len(games)} games to {output_dir}/")
    print(f"  You can now visualize these in your web interface!")

def summarize_training_data(data_dir: str = 'training_data'):
    """
    Summarize all training data
    """
    data_dir = Path(data_dir)
    pt_files = list(data_dir.glob('*.pt'))
    
    if not pt_files:
        print(f"No .pt files found in {data_dir}")
        return
    
    print(f"Training Data Summary")
    print("=" * 60)
    print(f"Data directory: {data_dir}")
    print(f"Number of batch files: {len(pt_files)}")
    print()
    
    total_games = 0
    total_moves = 0
    goban_counts = {}
    winner_counts = {'black': 0, 'white': 0, 'draw': 0}
    
    for pt_file in pt_files:
        data = torch.load(pt_file)
        games = data['games']
        total_games += len(games)
        
        for game in games:
            total_moves += game['num_moves']
            winner_counts[game['winner']] += 1
            
            goban_name = Path(game['goban_file']).stem
            goban_counts[goban_name] = goban_counts.get(goban_name, 0) + 1
    
    avg_moves = total_moves / total_games if total_games > 0 else 0
    
    print(f"Total games: {total_games}")
    print(f"Total moves: {total_moves}")
    print(f"Average moves per game: {avg_moves:.1f}")
    print()
    
    print("Winners:")
    for winner, count in winner_counts.items():
        pct = 100 * count / total_games if total_games > 0 else 0
        print(f"  {winner}: {count} ({pct:.1f}%)")
    print()
    
    print("Games by goban:")
    for goban, count in sorted(goban_counts.items(), key=lambda x: -x[1]):
        pct = 100 * count / total_games if total_games > 0 else 0
        print(f"  {goban}: {count} ({pct:.1f}%)")

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Export self-play games')
    parser.add_argument('--data-dir', type=str, default='training_data', help='Training data directory')
    parser.add_argument('--output-dir', type=str, default='exported_games', help='Output directory')
    parser.add_argument('--summary-only', action='store_true', help='Only show summary, no export')
    parser.add_argument('--latest', action='store_true', help='Export only latest batch')
    args = parser.parse_args()
    
    # Show summary
    summarize_training_data(args.data_dir)
    
    if not args.summary_only:
        print()
        print("Exporting games...")
        print("=" * 60)
        
        data_dir = Path(args.data_dir)
        pt_files = sorted(list(data_dir.glob('*.pt')))
        
        if not pt_files:
            print("No data files found!")
        elif args.latest:
            # Export only latest file
            export_games_from_pt(str(pt_files[-1]), args.output_dir)
        else:
            # Export all files
            for pt_file in pt_files:
                print(f"\nProcessing {pt_file.name}...")
                batch_output = Path(args.output_dir) / pt_file.stem
                export_games_from_pt(str(pt_file), str(batch_output))
