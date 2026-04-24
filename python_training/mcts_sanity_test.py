"""
MCTS sanity test: play ONE self-play game sequentially with verbose logging
and fail-fast invariant checks. Goal is to confirm that the MCTS + HexBoard +
HexGoNet pipeline runs end-to-end, not that the (untrained) net plays well.

Run from python_training/:
    python mcts_sanity_test.py                # defaults: Shumi, 50 sims
    python mcts_sanity_test.py --sims 100 --goban Shumi
    python mcts_sanity_test.py --device cpu   # force cpu if MPS acts up
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import torch

from hex_board import HexBoard
from graph_net import create_model
from mcts_nn import FastMCTS, MCTSNode
from bensons_algorithm import benson_pass_alive


def pick_device(requested: str = None) -> str:
    if requested:
        return requested
    if torch.backends.mps.is_available():
        return 'mps'
    if torch.cuda.is_available():
        return 'cuda'
    return 'cpu'


def check_root_invariants(root: MCTSNode, num_sims: int, legal_before: list, strict: bool) -> list:
    """Return list of (name, passed, detail) tuples. If strict and any failed, raise."""
    results = []

    child_visit_sum = sum(c.visit_count for c in root.children)
    results.append((
        'sum(children.visits) == num_sims',
        child_visit_sum == num_sims,
        f'{child_visit_sum} vs {num_sims}',
    ))

    results.append((
        'all priors >= 0',
        all(c.prior >= 0 for c in root.children),
        f'min={min((c.prior for c in root.children), default=0.0):.4f}',
    ))

    prior_sum = sum(c.prior for c in root.children)
    # Dirichlet noise + pass prior on top of softmax over valid moves — should still
    # normalize roughly to 1 but give it a loose tolerance.
    results.append((
        'sum(priors) ~= 1',
        abs(prior_sum - 1.0) < 0.10,
        f'sum={prior_sum:.4f}',
    ))

    child_moves = [c.move for c in root.children]
    results.append((
        'no duplicate child moves',
        len(set(child_moves)) == len(child_moves),
        f'{len(child_moves)} children, {len(set(child_moves))} unique',
    ))

    # Every child move should be either -1 (pass) or one of the legal moves at root.
    legal_set = set(legal_before)
    bad = [m for m in child_moves if m != -1 and m not in legal_set]
    results.append((
        'all child moves legal or pass',
        len(bad) == 0,
        f'illegal children: {bad[:5]}',
    ))

    failed = [(n, d) for n, ok, d in results if not ok]
    if failed and strict:
        raise AssertionError(f"MCTS invariant failure(s): {failed}")
    return results


def top_k_children(root: MCTSNode, k: int = 5) -> list:
    """Top-k children by visit count with visits/prior/Q."""
    sorted_children = sorted(root.children, key=lambda c: c.visit_count, reverse=True)
    rows = []
    for c in sorted_children[:k]:
        rows.append({
            'move': 'pass' if c.move == -1 else int(c.move),
            'visits': int(c.visit_count),
            'prior': round(float(c.prior), 4),
            'q': round(float(c.mean_value), 4),
        })
    return rows


def play_one_game(goban_path: str, sims: int, max_moves: int, device: str,
                  temperature_threshold: int = 30, strict: bool = True) -> dict:
    print(f"\n{'=' * 64}")
    print(f"MCTS SANITY TEST — single sequential self-play game")
    print(f"{'=' * 64}")
    print(f"Goban:       {goban_path}")
    print(f"Device:      {device}")
    print(f"Sims/move:   {sims}")
    print(f"Max moves:   {max_moves}")
    print(f"Temp sched:  1.0 for first {temperature_threshold} moves, then 0.15")
    print(f"Strict mode: {strict}  (asserts on MCTS invariant failures)")
    print()

    board = HexBoard(goban_path)
    num_edges = int(board.edge_index.shape[1] // 2) if board.edge_index.numel() > 0 else 0
    print(f"Board loaded: {board.num_vertices} vertices, {num_edges} undirected edges")

    model = create_model('tiny', use_attention=True).to(device).eval()
    num_params = sum(p.numel() for p in model.parameters())
    print(f"Model:        tiny config, {num_params:,} params (untrained — checking plumbing, not skill)\n")

    mcts = FastMCTS(
        model=model,
        device=device,
        num_simulations=sims,
        c_puct=1.5,
        temperature=1.0,
        add_dirichlet_noise=True,
    )

    record = {
        'goban': Path(goban_path).name,
        'num_vertices': board.num_vertices,
        'sims_per_move': sims,
        'device': device,
        'max_moves': max_moves,
        'moves': [],
        'terminated_reason': None,
    }

    start_time = time.time()
    nn_total_calls = 0

    for move_num in range(max_moves):
        if board.is_finished():
            record['terminated_reason'] = 'two_consecutive_passes'
            print(f"\n[GAME END] Two consecutive passes at move {move_num}.")
            break

        mcts.temperature = 1.0 if move_num < temperature_threshold else 0.15

        player_before = board.current_player
        legal_before = board.get_valid_moves()

        t0 = time.time()
        move, visit_dist = mcts.search(board)
        elapsed = time.time() - t0
        nn_total_calls += sims  # approximate — each sim is one NN eval at expansion

        root = mcts.last_root
        assert root is not None, "MCTS.last_root was not set — search() did not complete"

        invariants = check_root_invariants(root, sims, legal_before, strict=strict)
        root_value = float(root.mean_value)
        top5 = top_k_children(root, k=5)

        # Validate selected move against legality BEFORE playing.
        if move != -1:
            assert move in legal_before, (
                f"MCTS selected illegal move {move} at move_num={move_num}; "
                f"legal count={len(legal_before)}"
            )

        ok = board.play_move(move)
        assert ok, f"play_move({move}) returned False after MCTS selected it"

        captured = board.move_history[-1][1] or []
        n_captured = len(captured) if isinstance(captured, list) else 0

        entry = {
            'move_num': move_num,
            'player': player_before,
            'move': 'pass' if move == -1 else int(move),
            'captured_count': n_captured,
            'legal_count_before': len(legal_before),
            'stones_on_board': len(board.stones),
            'root_value_est': round(root_value, 4),
            'root_children_expanded': len(root.children),
            'top5_by_visits': top5,
            'mcts_time_sec': round(elapsed, 3),
            'invariants': [{'name': n, 'passed': ok, 'detail': d} for (n, ok, d) in invariants],
        }
        record['moves'].append(entry)

        # Per-move console line
        move_str = 'PASS' if move == -1 else f'v{move:>3d}'
        cap_str = f' CAP x{n_captured}' if n_captured > 0 else ''
        inv_fail = sum(1 for (_, ok, _) in invariants if not ok)
        inv_str = '' if inv_fail == 0 else f' ⚠ {inv_fail} inv failed'
        print(f"Move {move_num:>3d}  {player_before:<5s} {move_str}{cap_str}  "
              f"V={root_value:+.3f}  legal={len(legal_before):>3d}  "
              f"t={elapsed:5.2f}s{inv_str}")

        # Show MCTS internals on first 3 moves and every 25th thereafter
        if move_num < 3 or move_num % 25 == 0:
            print(f"    top5: {top5}")
    else:
        record['terminated_reason'] = 'max_moves_reached'
        print(f"\n[GAME END] Hit max_moves={max_moves} without two passes.")

    total_time = time.time() - start_time
    winner, margin, ownership = board.score()
    black_stones = sum(1 for c in board.stones.values() if c == 'black')
    white_stones = sum(1 for c in board.stones.values() if c == 'white')
    total_captured = sum(m['captured_count'] for m in record['moves'])
    pa_black = benson_pass_alive(board.stones, board.vertex_neighbors, 'black')
    pa_white = benson_pass_alive(board.stones, board.vertex_neighbors, 'white')
    black_owned = sum(1 for o in ownership.values() if o > 0)
    white_owned = sum(1 for o in ownership.values() if o < 0)
    neutral = sum(1 for o in ownership.values() if o == 0)
    signed_margin = margin if winner == 'white' else -margin if winner == 'black' else 0.0

    record.update({
        'winner': winner,
        'margin_white_minus_black': round(float(signed_margin), 2),
        'total_moves': len(record['moves']),
        'total_time_sec': round(total_time, 2),
        'avg_sec_per_move': round(total_time / max(len(record['moves']), 1), 3),
        'final_black_stones': black_stones,
        'final_white_stones': white_stones,
        'total_stones_captured': total_captured,
        'approx_nn_evals': nn_total_calls,
        'pass_alive_black': len(pa_black),
        'pass_alive_white': len(pa_white),
        'territory_black': black_owned,
        'territory_white': white_owned,
        'territory_neutral': neutral,
        # Per-vertex ownership map: {vid: int}; useful for the review UI overlay.
        'final_ownership': {int(k): int(v) for k, v in ownership.items()},
    })

    print(f"\n{'=' * 64}")
    print(f"GAME COMPLETE")
    print(f"{'=' * 64}")
    print(f"Terminated:   {record['terminated_reason']}")
    print(f"Moves played: {record['total_moves']}")
    print(f"Total time:   {total_time:.1f}s  ({record['avg_sec_per_move']}s/move avg)")
    print(f"Approx NN evals: {nn_total_calls:,}")
    print(f"Stones on board: black={black_stones}  white={white_stones}  captured-over-game: {total_captured}")
    print(f"Pass-alive groups: black={len(pa_black)}  white={len(pa_white)}")
    print(f"Final ownership: black={black_owned}  white={white_owned}  neutral={neutral}")
    print(f"Winner:       {winner}  (margin: {signed_margin:+.1f} pts, komi=7.5)")

    # Write detailed JSON record for review
    out_dir = Path(os.path.dirname(os.path.abspath(__file__))) / 'game_review'
    out_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    out_path = out_dir / f"mcts_sanity_{Path(goban_path).stem}_{ts}.json"

    def _json_default(o):
        if isinstance(o, np.floating):
            return float(o)
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.bool_):
            return bool(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")

    with open(out_path, 'w') as f:
        json.dump(record, f, indent=2, default=_json_default)
    print(f"\nDetailed trace saved: {out_path}")

    return record


def main():
    ap = argparse.ArgumentParser(description="Single-game MCTS sanity test")
    ap.add_argument('--goban', default='Shumi', help='Goban preset name (without .json)')
    ap.add_argument('--sims', type=int, default=50, help='MCTS simulations per move')
    ap.add_argument('--max-moves', type=int, default=400)
    ap.add_argument('--device', default=None, choices=[None, 'cpu', 'cuda', 'mps'])
    ap.add_argument('--temp-threshold', type=int, default=30,
                    help='Moves with exploration temperature before switching to greedy')
    ap.add_argument('--no-strict', action='store_true',
                    help='Warn on invariant failures instead of asserting')
    args = ap.parse_args()

    here = Path(os.path.dirname(os.path.abspath(__file__)))
    goban_path = (here / '..' / 'gobans' / f'{args.goban}.json').resolve()
    if not goban_path.exists():
        print(f"Error: goban not found: {goban_path}", file=sys.stderr)
        sys.exit(1)

    device = pick_device(args.device)

    try:
        play_one_game(
            goban_path=str(goban_path),
            sims=args.sims,
            max_moves=args.max_moves,
            device=device,
            temperature_threshold=args.temp_threshold,
            strict=not args.no_strict,
        )
    except AssertionError as e:
        print(f"\n[FAIL] {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
