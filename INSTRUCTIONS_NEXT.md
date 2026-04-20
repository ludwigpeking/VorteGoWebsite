# VorteGo — Next-round Instructions

Captured for future implementation; not yet built.

## 1. Goban canvas — responsive margins

On smaller devices the goban currently sits inside an excessive fixed margin
that wastes screen real estate. The margin around the board should be
**proportional to the canvas size** (e.g. a percentage of the smaller of
canvas width/height), not a fixed pixel value, so the board scales to fill
small viewports.

## 2. Goban canvas — wide-tablet layout (iPad-class)

On widths large enough that the side menu doesn't collapse to the
mobile bottom-sheet but the menu still overlays the canvas (typical iPad),
the menu currently covers part of the goban.

Fix: when a side menu is shown, **shift the canvas to the right by
`menu_width / 2`** (i.e. center the canvas in the area to the right of the
menu) so the menu cannot block any board area.

The mobile and the small-desktop layouts already work; this is the
in-between range that needs the offset.

## 3. Whose-turn UI — active warning instead of passive label

Replace the static "Turn: Black" / "Turn: White" label with an **active
visual cue when it's THIS user's turn**. Suggested treatment:

- A clearly-coloured banner / pulsing badge / highlight ring around the
  player's own stone-pot or score area when waiting for their move.
- The opponent-turn state should be visually muted (no banner).
- Optionally pair with a short toast / system sound when the turn flips
  to the local player.

Goal: at a glance the user always knows "it's me / it's them" without
reading text.

## 4. Game-room invitation flow + "random color" rule

### 4a. Multi-player rooms

A room can have more than two players (spectators / waiting players).
Today the player-selection UI gets chaotic when more than two are
present.

### 4b. Host-driven challenge flow

Replace the current ambiguous "start" with an explicit invitation:

1. **Host proposes the rules** (color, board, komi, time control, etc.)
   and **picks one specific player in the room** to invite.
2. The invited player gets a confirmation prompt ("Accept / Decline").
3. The game only starts after the invitee confirms.
4. The other players in the room remain spectators or wait for the next
   match.

### 4c. New rule: "Random Color"

Add **Random Color** to the rule set. When chosen, the server randomly
assigns black/white to the host and the invitee at game start.

## 5. End-of-game — mutual confirmation

Currently scoring concludes as soon as one player ends marking. Change to:

- **Both players must click "Finish Marking"** (or equivalent) for the
  game to actually conclude.
- Until both confirm, the marking phase remains live and either player
  can adjust dead-stone marks.
- Once both confirm, the server computes the score and announces:
  > **"XXX wins by X.5 points!"**

## 6. Time control — 30 s + 5 byō-yomi periods

Per player:

- **30 seconds** countdown per move.
- A player has **5 reserved countdowns** (think byō-yomi).
- Each move that consumes the full 30 s without a stone being played
  spends one reserved countdown (and the next 30 s starts).
- When all 5 reserved countdowns are spent and the timer expires again,
  the player loses by **超时负 (timeout)**.

Display: visible per-player countdown clock + remaining-period count.

## 7. Quit-during-turn

If a player **leaves the game room while it is their turn**:

- The countdown does NOT pause; it continues running on the server.
- When their reserved countdowns are exhausted by the timer, the result
  is **超时负 (timeout loss)** for the absent player.
- The opponent is shown the same end-of-game result UI as a normal win.

## 8. Game result — warning-box delivery

When the game ends (by score, resignation, or timeout), display the
result to **both** players as a **modal warning box** that they must
explicitly dismiss, not a passive panel update. Wording examples:

- "XXX wins by 4.5 points!"
- "XXX wins by 超时 (timeout)."
- "XXX wins by resignation."

## 9. Remove unused playmode buttons

In play mode, these buttons are not useful and should be removed from
the menu:

- **Save Game**
- **Load Game**
- **Load Game Review**

(Game records are now handled via the server-side records flow accessible
from the lobby; in-room save/load buttons add clutter.)
