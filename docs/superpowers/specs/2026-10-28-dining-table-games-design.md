# Dining Table Games — Design

**Date:** 2026-10-28
**Status:** Approved. Phase 1 (the frame and chess) and Phase 2 (backgammon) implemented; Go to come.

## Goal

Three 1-vs-1 games on the Sala's dining table for the party: **chess**, **backgammon** and **Go 9×9**. Two visitors sit opposite each other and play on a flat board on screen; everyone in the flat sees the game on the table in 3D, live. It builds on the multiplayer (`2026-10-25-multiplayer-design.md`), seats (sitting on chairs, `seats.json`) and the party host work (`2026-10-28-party-host-guest-list-design.md`): the same Trystero room, no server.

Built in three phases, each its own plan, review and pull request, each playable on its own:

1. The shared frame (slots, seats, sharing, the overlay, the 3D board base) **plus chess**.
2. **Backgammon.**
3. **Go 9×9.**

## The table

- The dining table has six chairs, three a side facing each other: `Dining chair N0`–`N2` (facing south) and `S0`–`S2` (facing north), at the same spots in both kitchen layouts. Each facing pair is a **slot** about 55 cm wide and 80 cm deep:

  | Slot | Chairs | Game |
  |---|---|---|
  | 0 | N0 / S0 | Chess |
  | 1 | N1 / S1 | Backgammon |
  | 2 | N2 / S2 | Go 9×9 |

- The **S chair (the Sala window's side) is white**, the N chair black. In Go black moves first, so the N player starts there.
- Slot centres and the table top's height live in `CONFIG.games`, measured from the chairs and checked in the browser.
- Until a phase ships its game, its slot is just a table place.

## A game's life

- Sitting on a game chair makes you that slot's player for that colour, and opens the overlay for you. With the other chair empty the overlay says "Waiting for an opponent".
- When both chairs are taken and no game is running, a **new game starts**: the white player's browser opens it (see Sharing).
- A game **ends**:
  - by its rules: chess checkmate, stalemate or a draw (repetition, 50 moves, insufficient material, or an agreed draw); backgammon when a player has borne off all 15; Go when both pass in a row, then counting;
  - by resigning;
  - by **either player leaving the chair**, which loses it. A player whose tab closes or times out (the existing 15 s rule) leaves their chair too; every browser sees the chair empty and ends the game the same way.
- The result shows on the overlay ("White wins: checkmate", "Black wins: White left the table") and the final position stays on the table until the next game starts in that slot.
- **Standing up during a game** asks "Stand up and resign?" first. While the overlay is open the movement keys don't move the player, so a stray key can't end a game; standing is through the overlay's Stand up button (or C).
- Only the two seated players can move, and only on their turn. No clocks.

## Rules

Each game is a pure TypeScript module with the same shape: it **replays a list of moves** and answers whose turn it is, which moves are legal now, what the board looks like, and whether the game is over and how. The overlay, the 3D table and the network all go through that shape.

- **Chess** — `chess.js` (BSD-2-Clause, pinned): legal moves, check, castling, en passant, promotion (a picker in the overlay), checkmate, stalemate, threefold repetition, the 50-move rule, insufficient material. Moves are stored as UCI strings (`e2e4`, `e7e8q`). Draw by agreement: an offer and an acceptance are entries in the move list; an offer lapses when the offerer's opponent moves.
- **Backgammon** — our own `backgammon-game.ts`: the standard starting position; the opening roll (one die each, re-rolled on a tie; the higher plays both); then each turn a roll, and moves one die at a time; doubles give four moves; checkers on the bar must enter first; a point with two or more opposing checkers is blocked; a single opposing checker is hit to the bar; bearing off only when all 15 are in the home board, with a higher die bearing off the furthest checker when no exact move exists; a player must use both dice if possible, the larger if only one can be used; no legal move ends the turn. The result names single, gammon or backgammon. No doubling cube.
- **Go 9×9** — our own `go.ts`: placement on an empty point; captures of groups without liberties; no suicide; simple ko (no immediate recapture that repeats the previous position); pass; two passes in a row end the game. Area scoring (stones plus surrounded empty points) with komi 7; the stones on the board count as they stand — players capture dead stones before passing ("play it out"). Captures are shown as prisoners.
- Resign is an entry in every game's move list.

## The overlay (players only)

- A panel in the middle of the screen, opened by sitting on a game chair; the mouse is freed while it's open (as Tab does), and it closes when you stand. The board is SVG, turned so your own side is at the bottom.
- Click (or tap) one of your pieces: its legal targets light up; click one to move. The last move is marked.
  - Chess: promotion opens a picker (queen, rook, bishop, knight).
  - Backgammon: **Roll**, then move checkers one die at a time; the unused dice show; the bar and the bear-off tray are clickable.
  - Go: click a point to place a stone.
- Around the board: both players' names in their colours, whose turn, captured pieces (chess) or prisoners (Go), pip counts (backgammon), and the result.
- Buttons: **Resign**, **Offer draw** / **Accept draw** (chess), **Pass** (Go), **Stand up**.
- Phones: the panel is nearly full width; the board fills it.
- No overlay for onlookers: they watch the table (a phone guest can sit in a free chair to see a board up close).

## On the table (everyone)

- Built in the walkthrough from simple shapes, no Blender export: chess pieces turned from profiles (pawn, rook, bishop, queen, king) and a cut-out knight on a 40 cm board; a wooden 9×9 Go board with drawn lines and slightly flattened stones; an open backgammon travel case (30 × 28 cm: the table's fruit bowl, mug and books leave 34 cm at slot 1) with 24 painted points, 30 checkers and two dice with pips.
- Shaded like the visitors' animals (matcaps), dimmed with the room's light, so they sit in the baked lighting.
- Pieces slide to their squares (about 0.3 s); captured pieces lift off to the side; the dice tumble when rolled.
- Pieces of a kind share geometry and materials; the shader warm-up compiles them at load.
- Each phase adds its board to its slot; slots without a game yet stay empty.

## Sharing

- A new message kind, **`game`**, carries one slot's whole game: `{ slot, id, white, black, moves, end? }` — the game's id (made by the white player's browser when it opens the game), the two players' peer ids, the move list, and how it ended, if it has. Games are small (chess rarely tops 300 short moves), so each change sends the whole list.
- A browser **accepts** a `game` message only when it is the slot's current game (same id) and its move list extends the one it has and replays legally, or when it opens a new game for the two visitors it sees in that slot's chairs. Anything else is ignored. Only the seated side to move adds moves, so two changes can't collide.
- Dice rolls (made in the roller's browser), resignations, and draw offers and acceptances are entries in the move list, like moves. Dice are only as honest as the roller's browser, which is fine among friends.
- Ending because a player left is worked out locally from the empty chair, the same way everywhere. A player's own browser also sends its game once with that end, so a player whose tab was hidden long enough for the others to drop it learns the game is over when it comes back; and a browser that notices it was away longer than the others wait (15 s) ends its own game the same way.
- A newcomer gets the running games with the flat's state: the existing full-state answer sends a `game` message for each slot with a game.
- Visitors on an older version ignore `game`: they see players sitting but no boards (the boards are not in the exported model).

## Known limits

- Dice can be faked by a modified browser.
- Two visitors who can't connect to each other (strict networks without TURN) can't play each other.
- An older visitor sitting on a game chair counts as seated (its pose says so) but can't play; the game waits for a player, or ends when they leave.

## Testing

- Unit tests: each rules module (chess wrapper; Go captures, suicide, ko, scoring; backgammon entering, blocking, hits, both-dice and larger-die rules, doubles, bearing off, gammons); a game's life from seating (start, the end when a chair empties, resign, draw); accepting and rejecting incoming `game` messages.
- By hand, per phase: two tabs at the board for a whole game; a third tab joining mid-game; standing up mid-game; closing a player's tab; on a phone.
- The README's controls and "Visitors together" describe the games.
