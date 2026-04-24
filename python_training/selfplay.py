"""Self-play engine that emits KataGo-style training rows.

Each played game produces N training rows (one per move taken). Each row records:
  - graph_data (x, edge_index, globals) for the position seen by the player
  - policy_target: MCTS visit distribution (length num_vertices + 1, last = pass)
  - value_target: +1 if the player to move ended up winning, -1 if losing, 0 draw
  - ownership_target: per-vertex {+1, -1, 0} from final Benson scoring,
    flipped to current-player perspective (+1 = mine, -1 = opponent's, 0 = neutral)
  - score_target: final signed margin from current-player perspective (positive = ahead)
  - value_target_weight: 1.0 normally; 0 for resigned games (matches KataGo
    cpp/dataio/trainingwrite.cpp:700 — resigned games keep ownership/score
    targets but don't bias the value head).
  - ownership_target_weight: 1.0 (always trained; ownership labels are valid
    even on resigned games since they come from the post-Benson final state).

Refs:
  cpp/dataio/trainingwrite.cpp (target row computation)
  cpp/configs/training/selfplay8b.cfg (loss weights, max_moves, etc.)
"""

import argparse
import glob
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch

from hex_board import HexBoard
from graph_net import HexGoNet, create_model
from mcts_nn import FastMCTS


def _data_to_dict(data) -> dict:
    """Serialize a PyTorch Geometric Data object to plain Python."""
    return {
        'x': data.x.cpu().numpy().tolist(),
        'edge_index': data.edge_index.cpu().numpy().tolist(),
        'u': data.u.cpu().numpy().tolist() if hasattr(data, 'u') and data.u is not None else None,
        'num_nodes': int(data.num_nodes),
    }


class SelfPlayEngine:
    """Generate self-play games and write KataGo-style training rows."""

    def __init__(
        self,
        model: HexGoNet,
        goban_files: List[str],
        output_dir: str = 'training_data',
        device: str = 'cpu',
        num_simulations: int = 100,
        temperature_threshold: int = 30,
        max_moves: int = 400,
        komi: float = 7.5,
        # Resignation (KataGo cpp/program/play.cpp:1657 + playsettings.h:70).
        # A player resigns when their root value estimate has stayed below
        # `resign_threshold` for `resign_consec_turns` consecutive of THEIR
        # own moves, and we're past the opening (`min_turn_for_resign`).
        # Resigned games keep ownership/score targets but set value_weight=0
        # so the value head isn't biased by truncated games.
        allow_resignation: bool = True,
        resign_threshold: float = -0.98,
        resign_consec_turns: int = 3,
    ):
        self.model = model
        self.goban_files = goban_files
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.device = device
        self.num_simulations = num_simulations
        self.temperature_threshold = temperature_threshold
        self.max_moves = max_moves
        self.komi = komi
        self.allow_resignation = allow_resignation
        self.resign_threshold = resign_threshold
        self.resign_consec_turns = resign_consec_turns

        self.mcts = FastMCTS(
            model=model,
            device=device,
            num_simulations=num_simulations,
            c_puct=1.5,
            temperature=1.0,
            add_dirichlet_noise=True,
        )

    def play_game(self, goban_file: str) -> Dict:
        board = HexBoard(goban_file)
        rows: List[Dict] = []  # one row per move taken

        # Resignation tracking: per-player rolling window of (root_value
        # estimates from THAT PLAYER's perspective). Once a player has
        # resign_consec_turns recent values all below the threshold AND we're
        # past the opening, that player resigns.
        # min_turn_for_resign mirrors KataGo: 1 + boardsize^2/5  (we use
        # num_vertices/5 + 1 — same idea, scaled to graph size).
        recent_root_values = {'black': [], 'white': []}
        min_turn_for_resign = 1 + board.num_vertices // 5
        resigned_player: Optional[str] = None

        terminated_reason = 'two_consecutive_passes'
        for move_num in range(self.max_moves):
            if board.is_finished():
                break

            self.mcts.temperature = 1.0 if move_num < self.temperature_threshold else 0.15

            # Snapshot the position (for the training row) BEFORE we make the move.
            graph_data = board.to_graph_data()
            current_player = board.current_player

            move, visit_dist = self.mcts.search(board)

            # Track root-value estimate for resign decision (from current player's perspective).
            root_value_est = float(self.mcts.last_root.mean_value) if self.mcts.last_root is not None else 0.0
            window = recent_root_values[current_player]
            window.append(root_value_est)
            if len(window) > self.resign_consec_turns:
                window.pop(0)

            rows.append({
                'graph_data': _data_to_dict(graph_data),
                'current_player': current_player,
                'policy_target': visit_dist.tolist(),
                'move_played': int(move),
                'root_value_est': root_value_est,
            })

            board.play_move(move)

            # Resignation check (after the move, so we don't resign on the
            # FIRST below-threshold value — only after consec_turns).
            if (self.allow_resignation
                    and move_num >= min_turn_for_resign
                    and len(window) >= self.resign_consec_turns
                    and all(v < self.resign_threshold for v in window)):
                resigned_player = current_player
                terminated_reason = 'resigned'
                break
        else:
            terminated_reason = 'max_moves_reached'

        # Final scoring via Benson — happens regardless of how the game ended.
        winner, abs_margin, ownership = board.score(komi=self.komi)
        if resigned_player is not None:
            # Override: the resigner loses the game. Score margin is recorded
            # from the Benson final state but the winner is enforced.
            winner = 'white' if resigned_player == 'black' else 'black'
        signed_margin_white = abs_margin if winner == 'white' else (-abs_margin if winner == 'black' else 0.0)

        # Fill in per-row value, ownership, score targets — all from CURRENT
        # player's perspective (KataGo convention).
        for row in rows:
            cp = row['current_player']
            sign = 1 if cp == 'black' else -1  # +1 if I'm black, -1 if I'm white

            # Value: +1 if I won, -1 if I lost, 0 if draw.
            if winner == 'draw':
                row['value_target'] = 0.0
            elif winner == cp:
                row['value_target'] = 1.0
            else:
                row['value_target'] = -1.0

            # Ownership: flip to my perspective. Stored ownership has black=+1.
            # If I'm black, multiply by +1. If white, multiply by -1.
            row['ownership_target'] = [int(o * sign) for o in
                                       (ownership[v] for v in range(len(ownership)))]

            # Score: signed_margin_white is white's lead. From my perspective,
            # multiply by -sign so positive = I'm ahead.
            row['score_target'] = float(-signed_margin_white * sign)

            # Weights: resigned games keep ownership/score targets (those come
            # from the post-Benson final board, which is still valid) but zero
            # the value-head weight to avoid biasing it on truncated outcomes.
            row['value_target_weight'] = 0.0 if resigned_player is not None else 1.0
            row['ownership_target_weight'] = 1.0

        return {
            'goban_file': goban_file,
            'goban_name': Path(goban_file).stem,
            'winner': winner,
            'margin_white_minus_black': float(signed_margin_white),
            'num_moves': len(rows),
            'terminated_reason': terminated_reason,
            'is_resignation': resigned_player is not None,
            'resigned_player': resigned_player,
            'rows': rows,
            # Final ownership (absolute, black=+1) for review/debugging.
            'final_ownership': [int(ownership[v]) for v in range(len(ownership))],
        }

    def generate_games(self, num_games: int = 100, save_every: int = 10):
        print(f"\n{'=' * 64}")
        print("SELF-PLAY GENERATION (KataGo-style training rows)")
        print(f"{'=' * 64}")
        print(f"Games:        {num_games}")
        print(f"Gobans:       {[Path(f).stem for f in self.goban_files]}")
        print(f"MCTS sims:    {self.num_simulations}")
        print(f"Max moves:    {self.max_moves}")
        print(f"Device:       {self.device}")
        print(f"Output:       {self.output_dir}")
        print(f"{'=' * 64}\n")

        batch: List[Dict] = []
        total_rows = 0
        for i in range(num_games):
            goban = np.random.choice(self.goban_files)
            print(f"Game {i + 1}/{num_games}  on  {Path(goban).stem}...", end=' ', flush=True)
            try:
                rec = self.play_game(goban)
                print(f"OK  {rec['num_moves']} moves, winner={rec['winner']}, margin={rec['margin_white_minus_black']:+.1f}")
                batch.append(rec)
                total_rows += rec['num_moves']
                if (i + 1) % save_every == 0:
                    self._flush(batch, i + 1)
                    batch = []
            except Exception as e:
                print(f"FAIL {e}")

        if batch:
            self._flush(batch, num_games)

        print(f"\nDone. {num_games} games, {total_rows} training rows total.")

    def _flush(self, batch: List[Dict], idx: int):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out = self.output_dir / f"selfplay_{idx:05d}_{ts}.pt"
        torch.save({'games': batch, 'komi': self.komi}, out)
        print(f"  -> flushed {len(batch)} games ({sum(g['num_moves'] for g in batch)} rows) -> {out.name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gobans-dir', default='../gobans')
    ap.add_argument('--output-dir', default='training_data')
    ap.add_argument('--num-games', type=int, default=20)
    ap.add_argument('--model-config', default='tiny',
                    choices=['tiny', 'small', 'medium', 'large', 'huge'])
    ap.add_argument('--model-path', default=None)
    ap.add_argument('--simulations', type=int, default=100)
    ap.add_argument('--max-moves', type=int, default=400)
    ap.add_argument('--device', default=None, choices=[None, 'cpu', 'cuda', 'mps'])
    ap.add_argument('--gobans', nargs='*', default=None,
                    help='Specific goban names (without .json) to use; default = all')
    args = ap.parse_args()

    if args.device is None:
        if torch.backends.mps.is_available():
            device = 'mps'
        elif torch.cuda.is_available():
            device = 'cuda'
        else:
            device = 'cpu'
    else:
        device = args.device

    gobans_dir = Path(args.gobans_dir)
    if args.gobans:
        goban_files = [str(gobans_dir / f"{g}.json") for g in args.gobans]
    else:
        goban_files = sorted(glob.glob(str(gobans_dir / '*.json')))

    if not goban_files:
        raise SystemExit(f"No goban files found at {gobans_dir}")

    model = create_model(args.model_config, use_attention=True)
    if args.model_path:
        print(f"Loading weights from {args.model_path}")
        model.load_state_dict(torch.load(args.model_path, map_location='cpu'))

    engine = SelfPlayEngine(
        model=model,
        goban_files=goban_files,
        output_dir=args.output_dir,
        device=device,
        num_simulations=args.simulations,
        max_moves=args.max_moves,
    )
    engine.generate_games(num_games=args.num_games, save_every=10)


if __name__ == '__main__':
    main()
