#!/usr/bin/env python3
"""
Scale up game generation for neural network training.

This script generates a large number of self-play games with proper
endgame handling, ready for training the GNN.
"""

import subprocess
import sys
from pathlib import Path

def generate_games_for_training():
    """Generate enough games for initial NN training"""
    
    print("="*70)
    print("HEXGOBAN SELF-PLAY TRAINING DATA GENERATION")
    print("="*70)
    print()
    
    # Phase 1: Generate random games (baseline data)
    print("PHASE 1: Generate baseline games with random playouts")
    print("-" * 70)
    print("This generates initial training data with proper endgame handling.")
    print()
    
    phases = [
        {
            'name': 'Baseline Data (Random Playouts)',
            'games': 100,
            'script': 'generate_random_games.py',
            'description': 'Random playouts ensure games end naturally. Proper territory scoring provides valid signals.'
        },
        # After training first NN:
        # {
        #     'name': 'Self-Play Iteration 1 (Untrained NN)',
        #     'games': 500,
        #     'script': 'selfplay_iteration1.py',
        #     'description': 'Self-play with untrained network. Quick feedback loop for model improvement.'
        # },
        # {
        #     'name': 'Self-Play Iteration 2 (Trained NN)',
        #     'games': 1000,
        #     'script': 'selfplay_iteration2.py',
        #     'description': 'Self-play with trained network. Much higher quality games.'
        # },
    ]
    
    for i, phase in enumerate(phases, 1):
        print(f"\n{i}. {phase['name']}")
        print(f"   Target: {phase['games']} games")
        print(f"   Script: {phase['script']}")
        print(f"   Description: {phase['description']}")
        print()
    
    print("="*70)
    print("RUNNING PHASE 1...")
    print("="*70)
    print()
    
    # Actually run the random game generation
    try:
        result = subprocess.run(
            [sys.executable, 'generate_random_games.py'],
            capture_output=False
        )
        if result.returncode != 0:
            print(f"Error: generate_random_games.py failed with code {result.returncode}")
            return False
    except Exception as e:
        print(f"Error running generate_random_games.py: {e}")
        return False
    
    print()
    print("="*70)
    print("PHASE 1 COMPLETE - GAMES GENERATED")
    print("="*70)
    print()
    
    print("Next steps:")
    print("1. Review game_review/random_games.json to verify games are valid")
    print("2. Run: python train_initial_network.py")
    print("   (This will train the GNN on the generated games)")
    print("3. Use the trained network for better self-play")
    print()
    
    return True

if __name__ == '__main__':
    success = generate_games_for_training()
    sys.exit(0 if success else 1)
