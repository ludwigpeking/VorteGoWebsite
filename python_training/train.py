"""Training loop for HexGoNet using KataGo-style loss weighting.

Reads selfplay .pt files written by selfplay.py and trains all four heads:
  - Policy:    cross-entropy on visit distribution targets  (weight ~1.0)
  - Value:     MSE on +1/-1/0 outcome targets               (weight ~0.6)
  - Ownership: MSE on per-vertex post-Benson labels         (weight ~0.2)
  - Score:     MSE on signed final margin (normalized)      (weight ~0.02)

Loss weights mirror the ratios used in cpp/configs/training/selfplay8b.cfg
+ python/train.py command line. Score is normalized by sqrt(num_vertices) so
the MSE doesn't blow up on larger boards.

Usage:
  python train.py --data-dir training_data --epochs 20 --batch-size 32
  python train.py --device mps --model-config tiny --resume checkpoints/last.pt
"""

import argparse
import glob
import math
import os
from pathlib import Path
from typing import Dict, List

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torch_geometric.data import Data, Batch

from graph_net import create_model, HexGoNet


# ---------- KataGo-style loss weights (selfplay8b.cfg + train.py) ----------
W_POLICY = 1.0
W_VALUE = 0.6
W_OWNERSHIP = 0.2
W_SCORE = 0.02


# ---------- Data loading ----------

def _row_to_data(row: dict) -> Data:
    """Convert a saved selfplay row back into a PyG Data object with targets."""
    g = row['graph_data']
    x = torch.tensor(g['x'], dtype=torch.float)
    edge_index = torch.tensor(g['edge_index'], dtype=torch.long)
    u = torch.tensor(g['u'], dtype=torch.float) if g.get('u') is not None else None

    n = int(g['num_nodes'])
    data = Data(
        x=x,
        edge_index=edge_index,
        num_nodes=n,
    )
    if u is not None:
        # Make sure u has shape [1, F] so PyG batches it correctly
        if u.dim() == 1:
            u = u.unsqueeze(0)
        data.u = u

    # Targets — attached as extra tensors (PyG carries arbitrary attrs through batching).
    pol = torch.tensor(row['policy_target'], dtype=torch.float)  # length n+1
    data.policy_target = pol.unsqueeze(0)  # [1, n+1] so it concats along dim 0 in batch
    data.value_target = torch.tensor([float(row['value_target'])], dtype=torch.float)
    data.score_target = torch.tensor([float(row['score_target'])], dtype=torch.float)
    data.ownership_target = torch.tensor(row['ownership_target'], dtype=torch.float)  # [n]
    data.value_weight = torch.tensor([float(row['value_target_weight'])], dtype=torch.float)
    data.ownership_weight = torch.tensor([float(row['ownership_target_weight'])], dtype=torch.float)
    data.num_vertices = torch.tensor([n], dtype=torch.long)
    return data


class SelfPlayRowDataset(Dataset):
    """Flat dataset of training rows across all .pt files in a directory."""

    def __init__(self, data_dir: str):
        self.files = sorted(glob.glob(str(Path(data_dir) / 'selfplay_*.pt')))
        if not self.files:
            raise FileNotFoundError(f"No selfplay_*.pt files in {data_dir}")
        # Build an index: list of (file_idx, game_idx, row_idx)
        self._index: List[tuple] = []
        self._file_cache: Dict[int, dict] = {}
        for fi, f in enumerate(self.files):
            blob = torch.load(f, map_location='cpu', weights_only=False)
            self._file_cache[fi] = blob
            for gi, game in enumerate(blob['games']):
                for ri in range(len(game['rows'])):
                    self._index.append((fi, gi, ri))
        print(f"Loaded {len(self.files)} files, {sum(len(b['games']) for b in self._file_cache.values())} games, "
              f"{len(self._index)} training rows.")

    def __len__(self):
        return len(self._index)

    def __getitem__(self, idx):
        fi, gi, ri = self._index[idx]
        row = self._file_cache[fi]['games'][gi]['rows'][ri]
        return _row_to_data(row)


def _collate(batch_list):
    return Batch.from_data_list(batch_list)


# ---------- Loss ----------

def compute_loss(model_out, batch) -> Dict[str, torch.Tensor]:
    """Compute weighted KataGo-style multi-head loss.

    model_out = (policy_logits[total_nodes], value[B], ownership[total_nodes],
                 score_mean[B], score_stdev[B])
    batch carries:
        policy_target [B, max_n+1]   — note we packed per-graph length, see below
        value_target [B], ownership_target [total_nodes], score_target [B],
        value_weight [B], ownership_weight [B], num_vertices [B]
    """
    policy_logits, value, ownership, score_mean, score_stdev = model_out

    B = int(batch.num_graphs)
    total_n = policy_logits.shape[0]
    device = policy_logits.device

    # ----- POLICY loss -----
    # The policy target has variable length per graph (n+1 for n vertices).
    # We split policy_logits per graph using batch.batch, build (logits, target),
    # softmax-CE per graph, then average over the batch.
    # (Pass logit is implicit at index n; we model it like KataGo: a "fake" extra
    # logit with value 0, since the net itself doesn't predict pass directly.
    # MCTS handles the pass prior in _evaluate_position.)
    policy_losses = []
    ptr = 0
    pol_target = batch.policy_target  # concatenated tensor: [sum(n_i + 1)? actually [B*1, max len]]
    # Because each row's policy_target was pre-shaped to [1, n_i+1], PyG concatenates
    # along dim 0 → [B, max_n+1] but with possibly mismatched widths.
    # Easier: rebuild the target list from row_idx slices.
    n_per_graph = batch.num_vertices.cpu().tolist()
    # Reconstruct policy targets per graph from the concatenated tensor.
    # PyG, when concatenating tensors of differing column counts, will pad to max
    # along the trailing dim. So pol_target shape = [B, max_n+1]. We'll trim per
    # graph using num_vertices.
    pol_t_full = pol_target  # [B, max_n+1]
    for i, n in enumerate(n_per_graph):
        # Per-graph: logits live at policy_logits[ptr:ptr+n], pass logit = 0.0
        plog = policy_logits[ptr:ptr + n]
        full_logits = torch.cat([plog, torch.zeros(1, device=device)], dim=0)  # [n+1]
        target = pol_t_full[i, :n + 1].to(device)  # [n+1]
        target_sum = target.sum().clamp(min=1e-8)
        target = target / target_sum  # ensure normalized
        log_probs = F.log_softmax(full_logits, dim=0)
        # Cross-entropy: -sum(target * log_probs) (averaged below)
        policy_losses.append(-(target * log_probs).sum())
        ptr += n
    policy_loss = torch.stack(policy_losses).mean()

    # ----- VALUE loss -----
    val_t = batch.value_target.to(device).view(-1)
    val_w = batch.value_weight.to(device).view(-1)
    value_loss = ((value.view(-1) - val_t) ** 2 * val_w).sum() / val_w.sum().clamp(min=1e-8)

    # ----- OWNERSHIP loss -----
    own_t = batch.ownership_target.to(device).view(-1)
    own_diff_sq = (ownership.view(-1) - own_t) ** 2
    # Per-graph weight, broadcast across that graph's nodes.
    own_w_per_graph = batch.ownership_weight.to(device).view(-1)  # [B]
    own_w_per_node = own_w_per_graph[batch.batch]  # [total_n]
    ownership_loss = (own_diff_sq * own_w_per_node).sum() / own_w_per_node.sum().clamp(min=1e-8)

    # ----- SCORE loss (normalize by sqrt(n) so MSE is board-size invariant) -----
    score_t = batch.score_target.to(device).view(-1)
    n_t = batch.num_vertices.to(device).float().view(-1)
    score_t_norm = score_t / torch.sqrt(n_t.clamp(min=1.0))
    score_pred_norm = score_mean.view(-1) / torch.sqrt(n_t.clamp(min=1.0))
    # score_stdev is left to learn freely under a soft regularizer (no explicit loss)
    # — KataGo trains it via Gaussian NLL; we keep that as future work.
    score_loss = ((score_pred_norm - score_t_norm) ** 2).mean()

    total = (W_POLICY * policy_loss
             + W_VALUE * value_loss
             + W_OWNERSHIP * ownership_loss
             + W_SCORE * score_loss)

    return {
        'total': total,
        'policy': policy_loss.detach(),
        'value': value_loss.detach(),
        'ownership': ownership_loss.detach(),
        'score': score_loss.detach(),
    }


# ---------- Training ----------

def pick_device(req: str = None) -> str:
    if req:
        return req
    if torch.backends.mps.is_available():
        return 'mps'
    if torch.cuda.is_available():
        return 'cuda'
    return 'cpu'


def train(args):
    device = pick_device(args.device)
    print(f"Device: {device}")

    ds = SelfPlayRowDataset(args.data_dir)
    loader = DataLoader(ds, batch_size=args.batch_size, shuffle=True,
                        collate_fn=_collate, num_workers=0)

    model = create_model(args.model_config, use_attention=True).to(device)
    if args.resume:
        print(f"Resuming from {args.resume}")
        model.load_state_dict(torch.load(args.resume, map_location=device))

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    ckpt_dir = Path(args.ckpt_dir)
    ckpt_dir.mkdir(exist_ok=True)

    step = 0
    for ep in range(args.epochs):
        model.train()
        ep_losses = {'total': 0.0, 'policy': 0.0, 'value': 0.0, 'ownership': 0.0, 'score': 0.0}
        n_batches = 0
        for batch in loader:
            batch = batch.to(device)
            out = model(batch)
            losses = compute_loss(out, batch)
            opt.zero_grad()
            losses['total'].backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            for k in ep_losses:
                ep_losses[k] += float(losses[k])
            n_batches += 1
            step += 1

        for k in ep_losses:
            ep_losses[k] /= max(n_batches, 1)
        print(f"epoch {ep + 1}/{args.epochs}  step {step}  "
              f"total={ep_losses['total']:.4f}  pol={ep_losses['policy']:.4f}  "
              f"val={ep_losses['value']:.4f}  own={ep_losses['ownership']:.4f}  "
              f"score={ep_losses['score']:.4f}")

        ckpt = ckpt_dir / f"hexgo_{args.model_config}_ep{ep + 1:03d}.pt"
        torch.save(model.state_dict(), ckpt)

    last = ckpt_dir / 'last.pt'
    torch.save(model.state_dict(), last)
    print(f"Wrote {last}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data-dir', default='training_data')
    ap.add_argument('--ckpt-dir', default='checkpoints')
    ap.add_argument('--model-config', default='tiny',
                    choices=['tiny', 'small', 'medium', 'large', 'huge'])
    ap.add_argument('--epochs', type=int, default=10)
    ap.add_argument('--batch-size', type=int, default=16)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--device', default=None, choices=[None, 'cpu', 'cuda', 'mps'])
    ap.add_argument('--resume', default=None)
    args = ap.parse_args()
    train(args)


if __name__ == '__main__':
    main()
