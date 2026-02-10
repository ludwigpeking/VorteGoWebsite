"""
Fast self-play for testing - uses very few MCTS simulations
"""

import sys
import os
sys.path.append(os.path.dirname(__file__))

from selfplay import SelfPlayEngine
from graph_net import create_model
from pathlib import Path
import glob
import torch

def main():
    print("=" * 60)
    print("FAST SELF-PLAY TEST (10 simulations per move)")
    print("=" * 60)
    
    # Find goban files
    gobans_dir = Path('../gobans')
    goban_files = glob.glob(str(gobans_dir / '*.json'))
    
    if not goban_files:
        print(f"Error: No goban files found in {gobans_dir}")
        return
    
    print(f"Found {len(goban_files)} goban files")
    
    # Create model
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Device: {device}")
    
    model = create_model('tiny')
    model.to(device)
    print("Model created (tiny config)")
    
    # Create engine with minimal simulations
    engine = SelfPlayEngine(
        model=model,
        goban_files=goban_files,
        device=device,
        num_simulations=10,  # Very few simulations for speed
        temperature_threshold=15  # Lower threshold for faster games
    )
    
    print("\nGenerating 3 test games...")
    print("Expected time: ~2-5 minutes\n")
    
    games = engine.generate_games(
        num_games=3,
        save_dir=Path('training_data_test'),
        save_every=1
    )
    
    print("\n" + "=" * 60)
    print("FAST TEST COMPLETE!")
    print("=" * 60)
    print(f"✓ {len(games)} games generated")
    print(f"✓ Data saved to training_data_test/")
    print("\nIf this worked, you can run full training with more simulations.")

if __name__ == '__main__':
    main()
