"""
Benson's algorithm (Benson 1976) for unconditionally-alive group detection,
plus area scoring that uses the Benson result to determine final ownership.

Ported from KataGo's calculateAreaForPla (cpp/game/board.cpp:1882-2100) and
countAreaScoreWhiteMinusBlack (cpp/game/boardhistory.cpp:576-614). KataGo calls
calculateArea with nonPassAliveStones=True, safeBigTerritories=True,
unsafeBigTerritories=True for final selfplay scoring (area scoring, TAX_NONE).

Graph-agnostic: works on any adjacency dict {vid: set(neighbor_vids)}.

References:
- https://senseis.xmp.net/?BensonsAlgorithm
- KataGo source (Benson comment at cpp/game/board.cpp:1891).
"""

from typing import Dict, Set, Tuple, Iterable, Hashable

Vid = Hashable
Color = str  # 'black' or 'white'
Stones = Dict[Vid, Color]
Adjacency = Dict[Vid, Set[Vid]]

KOMI = 7.5  # matches sketch.js computeTrompTaylorScore


def _build_chains(stones: Stones, adj: Adjacency, color: Color) -> Tuple[list, Dict[Vid, int]]:
    """Return (list_of_chain_vid_sets, vid_to_chain_index) for chains of `color`."""
    chains: list = []
    vid_to_chain: Dict[Vid, int] = {}
    for vid in adj:
        if stones.get(vid) != color or vid in vid_to_chain:
            continue
        chain: Set[Vid] = set()
        stack = [vid]
        while stack:
            v = stack.pop()
            if v in chain:
                continue
            chain.add(v)
            vid_to_chain[v] = len(chains)
            for nid in adj[v]:
                if nid not in chain and stones.get(nid) == color:
                    stack.append(nid)
        chains.append(chain)
    return chains, vid_to_chain


def _build_regions(stones: Stones, adj: Adjacency, color: Color,
                   vid_to_chain: Dict[Vid, int]) -> list:
    """Find maximal connected regions of non-`color` points. For each region,
    record:
      - points: set of vids in the region (empty or opposite color)
      - bordering_chains: set of `color` chain indices adjacent to the region
      - vital_chains: subset of bordering_chains for which every *empty* point
        in the region is adjacent to some stone of that chain (Benson vitality).
    """
    regions: list = []
    visited: Set[Vid] = set()
    for vid in adj:
        if vid in visited or stones.get(vid) == color:
            continue
        points: Set[Vid] = set()
        bordering: Set[int] = set()
        stack = [vid]
        while stack:
            v = stack.pop()
            if v in points:
                continue
            points.add(v)
            for nid in adj[v]:
                if stones.get(nid) == color:
                    bordering.add(vid_to_chain[nid])
                elif nid not in points:
                    stack.append(nid)
        visited |= points

        # Vital chains: chains adjacent to *every* empty point in this region.
        vital: Set[int] = set(bordering)
        for p in points:
            if stones.get(p) is not None:
                continue  # opp stone inside — does not constrain vitality (std Go)
            adj_chains: Set[int] = set()
            for nid in adj[p]:
                if stones.get(nid) == color:
                    adj_chains.add(vid_to_chain[nid])
            vital &= adj_chains
            if not vital:
                break

        regions.append({
            'points': points,
            'bordering_chains': bordering,
            'vital_chains': vital,
        })
    return regions


def benson_pass_alive(stones: Stones, adj: Adjacency, color: Color) -> Set[Vid]:
    """Return set of vids belonging to pass-alive chains of `color`.

    Benson's unconditional life: a set of chains is unconditionally alive if
    every chain in the set has at least 2 "vital" regions that are bordered
    only by chains in the set. Iteratively shrink from all chains by removing
    any chain that currently fails this criterion.
    """
    chains, vid_to_chain = _build_chains(stones, adj, color)
    if not chains:
        return set()
    regions = _build_regions(stones, adj, color, vid_to_chain)

    alive: Set[int] = set(range(len(chains)))
    while True:
        removed = set()
        for ci in alive:
            count = 0
            for r in regions:
                if not r['bordering_chains'].issubset(alive):
                    continue
                if ci in r['vital_chains']:
                    count += 1
                    if count >= 2:
                        break
            if count < 2:
                removed.add(ci)
        if not removed:
            break
        alive -= removed

    result: Set[Vid] = set()
    for ci in alive:
        result |= chains[ci]
    return result


def score_board(stones: Stones, adj: Adjacency, komi: float = KOMI
                ) -> Tuple[str, float, Dict[Vid, int]]:
    """Area-score the board using Benson pass-alive detection.

    Returns (winner, margin, ownership) where:
      - winner: 'black' | 'white' | 'draw'
      - margin: non-negative score difference (|white - black|)
      - ownership: dict vid -> {+1 black-owned, -1 white-owned, 0 neutral}

    Logic mirrors KataGo's countAreaScoreWhiteMinusBlack with
    nonPassAliveStones=True, safeBigTerritories=True, unsafeBigTerritories=True:
    - Pass-alive stones own their point.
    - A region (empty cells + non-pass-alive stones) bordered by pass-alive
      chains of only one color, with only that color's non-pass-alive stones
      inside, is owned by that color (captured stones become their color).
    - Mixed regions: empty stays neutral; stones keep their own color.
    """
    alive_black = benson_pass_alive(stones, adj, 'black')
    alive_white = benson_pass_alive(stones, adj, 'white')
    pass_alive = alive_black | alive_white

    ownership: Dict[Vid, int] = {vid: 0 for vid in adj}
    for vid in alive_black:
        ownership[vid] = 1
    for vid in alive_white:
        ownership[vid] = -1

    # Flood-fill through non-pass-alive vertices (both empty and non-pass-alive stones).
    visited: Set[Vid] = set(pass_alive)
    for vid in adj:
        if vid in visited:
            continue

        region: Set[Vid] = set()
        border_alive_colors: Set[str] = set()
        inside_stone_colors: Set[str] = set()
        stack = [vid]
        while stack:
            v = stack.pop()
            if v in region:
                continue
            region.add(v)
            sc = stones.get(v)
            if sc is not None:
                inside_stone_colors.add(sc)
            for nid in adj[v]:
                if nid in alive_black:
                    border_alive_colors.add('black')
                elif nid in alive_white:
                    border_alive_colors.add('white')
                elif nid not in region:
                    stack.append(nid)
        visited |= region

        all_colors = border_alive_colors | inside_stone_colors
        if all_colors == {'black'}:
            for v in region:
                ownership[v] = 1
        elif all_colors == {'white'}:
            for v in region:
                ownership[v] = -1
        else:
            # Mixed or empty — empties stay neutral, non-pass-alive stones keep own color.
            for v in region:
                c = stones.get(v)
                if c == 'black':
                    ownership[v] = 1
                elif c == 'white':
                    ownership[v] = -1
                else:
                    ownership[v] = 0

    # Tally
    black_score = sum(1 for o in ownership.values() if o > 0)
    white_score = sum(1 for o in ownership.values() if o < 0) + komi
    diff = white_score - black_score  # positive → white wins
    if diff > 0:
        return 'white', diff, ownership
    if diff < 0:
        return 'black', -diff, ownership
    return 'draw', 0.0, ownership


# --- Backwards-compatible wrappers used elsewhere in the training code ---

def simple_territory_count(board) -> Tuple[str, float]:
    """Legacy entry point — now routes through the Benson path."""
    winner, margin, _ = score_board(board.stones, board.vertex_neighbors, komi=KOMI)
    return winner, margin


def improved_bensons_algorithm(board) -> Tuple[str, float]:
    """Alias kept for external callers."""
    return simple_territory_count(board)
