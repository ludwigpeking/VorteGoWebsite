# Mesh Relaxation Algorithm / 网格松弛算法

A van der Waals–style force-directed relaxation that pulls the goban mesh
toward an even lattice. Lives in `relaxVerticesCoulomb` in `sketch.js`.

一种类 van der Waals 力导向松弛算法，用于把棋盘网格拉回到均匀格点结构。
代码位于 `sketch.js` 中的 `relaxVerticesCoulomb` 函数。

---

## Motivation / 背景

The goban editor lets users warp vertices freely, which quickly yields
mangled quads and triangles. We want a "tidy" button that nudges the mesh
back toward a regular lattice — keeping the topology, only moving the
movable (non-boundary) vertices.

棋盘编辑器允许用户自由拖拽顶点，很容易产生扭曲的四边形和三角形。我们需要一个
"整理" 按钮，在保持拓扑不变的前提下，把可移动（非边界）顶点推回到规整的格点上。

Earlier attempts used only Hookean edge springs (too local — diagonals
inside a quad could collapse) or pure Coulomb repulsion on all face-sharing
pairs (no attraction at long range → the mesh drifts apart chaotically).
The current algorithm combines both into a single pair potential with a
well-defined rest length.

早期尝试只用边上的 Hookean 弹簧（太局部——四边形的对角线可能塌陷），或者在所有同面顶点对
之间使用纯 Coulomb 排斥（没有远距离吸引 → 网格混乱发散）。当前算法把两者合并成一个
单一的、具有明确平衡距离的对势函数。

---

## Topology: face-sharing pairs / 拓扑：同面顶点对

For each vertex V, we build the set of partner vertices by taking the
union of all vertices that share a face (quad or triangle) with V.
A vertex can belong to 1–6 faces, so its partner set can be quite large.
Every pair gets a weight = number of faces the two vertices co-inhabit.

对每个顶点 V，把 V 所在的所有面（四边形或三角形）中的其他顶点取并集，作为 V 的
相互作用伙伴集合。一个顶点可能属于 1 到 6 个面，所以伙伴集合可能较大。
每对顶点的权重 = 它们共同所在的面数。

We classify each pair by its role in the face topology:

我们按拓扑角色区分顶点对：

| Pair type / 类型      | Rest length / 平衡距离 |
|-----------------------|------------------------|
| Face edge / 面的边    | `L`                    |
| Quad diagonal / 四边形对角线 | `L · √2`         |

where `L` is the mean length of all currently active edges (so the lattice
adapts to whatever scale the user is working at).

其中 `L` 是当前所有激活边的平均长度（所以算法会自适应用户当前的缩放尺度）。

If a pair appears as both an edge and a diagonal across different faces,
the edge rest length wins (shorter beats longer).

如果同一对顶点在不同面中既作为边又作为对角线出现，以较短的边长度为平衡距离。

---

## Pair potential / 对势函数

For each face-sharing pair at distance `r` with rest length `rest` and
weight `w`, the outward-positive force is:

对每个同面顶点对（距离 `r`，平衡距离 `rest`，权重 `w`），沿外向方向的标量力：

```
f_rep    = w · Q² · (1/r² − 1/rest²)   when r < rest, else 0
f_spring = −w · k · (r − rest)
f_total  = f_rep + f_spring
```

- **Repulsion** (`f_rep`): 1/r² short-range push, truncated at `r = rest`
  so it never fights the spring past equilibrium. Strong when close.
- **Spring** (`f_spring`): Hookean, zero at `r = rest`, pulls inward when
  `r > rest`, pushes out when `r < rest`.
- **Equilibrium**: both terms vanish exactly at `r = rest`. No residual force.

- **排斥力** (`f_rep`)：1/r² 短程斥力，在 `r = rest` 处截断，使其不会在平衡点之外
  与弹簧对抗。距离越近，排斥越强。
- **弹簧力** (`f_spring`)：胡克弹簧，在 `r = rest` 时为零；`r > rest` 时把两点拉近，
  `r < rest` 时把两点推开。
- **平衡点**：两项在 `r = rest` 处同时归零，没有残余力。

Default constants in `sketch.js`:

`sketch.js` 中的默认参数：

```js
Q2            = 0.3 · L²     // repulsion strength / 排斥强度
kSpring       = 0.25         // spring constant / 弹簧劲度
globalDamping = 0.25         // force → displacement / 力→位移 的阻尼
maxStep       = L · 0.02     // per-iteration displacement cap / 每步位移上限
```

---

## Integration: Gauss-Seidel sweep / 求解：Gauss-Seidel 扫描

Each iteration:

每次迭代：

1. Shuffle the list of movable vertex ids (Fisher-Yates).
   对可移动顶点做 Fisher-Yates 洗牌。
2. For each vertex in that order:
   按该顺序处理每个顶点：
   - Accumulate total force from all its partners at their current positions.
     用当前坐标计算所有伙伴施加的合力。
   - Compute displacement `= force · damping`, clamped to `maxStep`.
     位移 `= 合力 · 阻尼`，按 `maxStep` 上限夹紧。
   - Apply the displacement immediately.
     立即施加位移。
3. Refresh edge midpoints for display.
   刷新边中点用于显示。

Gauss-Seidel (update-in-place) converges faster than Jacobi
(batch-then-apply) because later vertices in the sweep already react to
earlier ones' new positions. The random shuffle eliminates any directional
bias a fixed sweep order would introduce.

Gauss-Seidel（就地更新）比 Jacobi（先算完再整体施加）收敛更快，因为同一轮中靠后的
顶点已经能感知到靠前顶点的新位置。随机洗牌消除了固定扫描顺序带来的方向偏置。

Boundary vertices (`v.type === 'edge'`) are never moved — they define the
canvas bounds and act as fixed anchors.

边界顶点（`v.type === 'edge'`）永远不动——它们定义画布边界，充当固定锚点。

---

## Debug visualization / 调试可视化

`coulombDebug` stores one "anchor" vertex id and, each iteration, captures
the full list of per-partner force vectors at that vertex plus the net force.
`drawCoulombDebug()` renders them as arrows:

`coulombDebug` 记录一个调试锚点顶点 id，每次迭代时抓取该顶点上所有伙伴施加的力向量
以及合力。`drawCoulombDebug()` 把它们画成箭头：

- **Red arrow** / 红色箭头：force pointing outward (repulsion dominates) /
  指向外侧的力（排斥主导）
- **Green arrow** / 绿色箭头：force pointing inward (attraction dominates) /
  指向内侧的力（吸引主导）
- **Cyan arrow** / 青色箭头：net force on the anchor / 锚点上的合力

All arrows share a single scale factor `60 / maxMagnitude`, so their lengths
are directly comparable. No clamping — a single huge arrow is a real signal,
not noise.

所有箭头使用统一缩放因子 `60 / maxMagnitude`，所以长度可以直接相互比较。
不做截断——一个超长箭头就是真实的物理信号，不是噪声。

The anchor is chosen on the first Relax click and persists across subsequent
clicks, so you can watch the same vertex evolve. Override via the console:

锚点在第一次点击 Relax 时选定，之后一直保持同一个顶点，方便观察其演化。
可以在控制台手动指定：

```js
window.setCoulombDebugVertex(123);   // set to vertex id 123
window.resetCoulombDebug();          // pick a new random one on next Relax
```

---

## Tuning notes / 调参说明

- If the mesh **oscillates or explodes**: lower `Q2`, lower `globalDamping`,
  or tighten `maxStep`.
  网格**震荡或发散**：降低 `Q2`、降低 `globalDamping`，或收紧 `maxStep`。
- If it **converges too slowly**: raise `kSpring` (stronger pull toward
  rest lengths).
  收敛**太慢**：提高 `kSpring`（把顶点更快拉向平衡距离）。
- If **close-range clumping** survives: raise `Q2` — stronger short-range
  repulsion.
  近距离**抱团**无法分开：提高 `Q2`，加强短程排斥。
- `relaxMaxFrames` in the animation loop controls how many total Gauss-Seidel
  iterations a single Relax click runs.
  动画循环里的 `relaxMaxFrames` 控制单次点击 Relax 一共跑多少轮 Gauss-Seidel。
