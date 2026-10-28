# TV Draw and Guess — Design

**Date:** 2026-10-28
**Status:** Implemented

## Goal

A party game on the Sala's TV, part of piece E of the party (`2026-10-28-party-host-guest-list-design.md`): **draw and guess**. One player draws a secret word, the others type guesses; the drawing shows live on the TV for everyone in the flat. Up to about six players, in the same Trystero room as the multiplayer, no server.

Not in this piece: other TV games, video in sync, screen sharing, custom or non-English words, more than one game at a time.

## The TV

- The Sala TV (`Screen_sala-tv`, 1.86 × 1.05 m) faces the corner sofa. Today a click steps it on, through its channels, then off, and the channel is shared.
- **Clicking the TV now opens the TV panel** (prompt "Click: TV"; "Tap: TV" on touch). **T** opens and closes it from anywhere. The panel holds:
  - the remote: **On/Off** and **Next channel**, doing what clicking did, shared as now;
  - the game: who has joined, **Join** / **Leave**, and **Start** once two or more have joined and no game runs.
- The monitor and laptop keep their click.
- While a game runs the TV shows the game whatever its channel, and can't be switched off (the remote's buttons are disabled with "A game is on"). When the game ends the TV shows the final scores for 15 s, then its channel again (or goes dark if it was off).

## Joining

- **Join** in the TV panel makes you a player; **Leave** stops it. Joining is each visitor's own flag, sent to everyone and to each newcomer.
- Two or more joined and no game running: any player can press **Start**.
- Joining during a game: you can guess straight away, and you're added to the end of the drawing order.
- Leaving during a game (the button, closing the tab, or the existing 15 s timeout) takes you out of the order; your score stays on the board.
- Fewer than two players left: the game ends and the scores so far are shown.

## A game

- The drawing order is the players in arrival order when Start is pressed; each player draws **once**.
- A turn:
  1. **Choosing:** the drawer sees three random words from the built-in list (none used earlier in the game) and picks one within 15 s, or one is picked for them. Everyone else sees "Ana is choosing a word".
  2. **Drawing:** 80 s. The drawer draws; the others guess. The word shows as blanks (`_ _ _   _ _ _ _`, spaces kept). One letter is revealed at 50 % of the time and another at 75 % (never more than half the letters).
  3. **Reveal:** the turn ends when the time runs out or every guesser has it. The word shows to all for 5 s with the points of the turn, then the next drawer's turn starts.
- **Guessing:** a guess is compared to the word ignoring case, accents, surrounding spaces and hyphens. A correct guess scores the guesser **100–300** (300 at the start of the drawing time, falling linearly to 100 at its end, rounded to 10) and the drawer **50**. A guess one edit away (Levenshtein 1, words of 4 letters or more) tells only the guesser "close!". Wrong guesses appear in a feed for all players; a correct one appears as "Ana guessed it!". A player who has it can't guess again that turn. Guesses are at most 40 characters.
- **The end:** after the last turn, the final scores show on the TV and the panels for 15 s, highest first, ties sharing a place.
- If the drawer leaves, their turn ends at once: no more points (those already won stay), the word isn't revealed, and the game moves to the next drawer.

## The words

- `web/src/draw-words.ts`: a few hundred simple, drawable English nouns (cat, bicycle, volcano, toothbrush…), lowercase, one or two words, no duplicates.

## Drawing

- The drawer's panel has a square-ish canvas (4:3, like the TV's drawing area), **eight colours**, **two pen sizes**, an **eraser** (paints white), **Undo** (the last stroke) and **Clear**. Mouse, pen and touch draw; on touch the panel takes the touches so they don't walk or look.
- A drawing is a list of strokes: colour, size and points in a 0–1000 grid on both axes. The drawer's browser sends the stroke in progress about every 50 ms (the new points only), and Undo and Clear as their own messages.
- The TV and every player's panel draw the same strokes. The panel scales them to its canvas, the TV to its drawing area.

## On the TV

- Drawing area on a white card on the left two thirds; down the right: the scores (players in score order, the drawer marked with a pencil, a tick on those who guessed this turn), and at the top the blanks or the word and the time left.
- Choosing: the drawer's name and "is choosing a word". Reveal: "The word was *volcano*" over the drawing. End: the leaderboard, big.
- The TV's light keeps following its picture (a mostly white card makes it bright and neutral).

## The panels (players only)

- The TV panel turns into the game panel during a game, for players: the drawing (same as the TV), the blanks or the word, the time, the scores, the guess feed.
  - Drawer: the canvas takes input and the tools show; the word is spelled out. While choosing, the three words as buttons.
  - Guesser: a guess box (Enter sends) under the feed.
- The panel can be closed (Close, Esc, or T) and reopened at any time; the game goes on. While it is open the movement keys don't move the player (as for the table games) and typing in the guess box never triggers the walkthrough's keys.
- Phones: the panel is nearly full width; the canvas fills it, the feed and guess box below.
- Onlookers (not joined) see the game on the TV only; the TV panel shows them the lobby and the remote.

## Sharing

- A new message kind, **`draw`**. Older visitors ignore it: they see the TV's channel, not the game.
- **One owner at a time.** The game's state — players, order, whose turn, phase, time left, scores, who has guessed, the blanks, the feed's last lines — is held and sent by its **owner**: the current drawer's browser. The **secret word never leaves the drawer's browser** until the reveal. When the turn ends, the owner sends the state with the next drawer as owner; that browser takes over.
- **The game leader** is the player who arrived first (the same rule as the party host, among the players). When the owner leaves, the leader ends that turn early and passes the turn on as owner. If the leader is the one who left, the next earliest takes the role; every browser works it out alone from the same data.
- Each state carries the game id and a sequence number; a browser accepts a state for the running game with a higher number, or a new game (a Start) when none runs. Times are sent as the time left, so no clocks need to agree.
- **Guesses go only to the owner**, which judges them and sends the feed line (or "guessed it") to all, and "close!" to the guesser alone.
- Strokes come only from the current drawer. A newcomer, or a player whose panel reopens, gets the state and the whole drawing from the owner.

## Known limits

- A tampered browser could read the word while it draws (it's the drawer's), or send itself points. Fine among friends.
- Two players who can't reach each other (strict networks without TURN) won't see each other's guesses or drawing.
- A drawer whose tab is hidden longer than 15 s counts as gone: their turn ends.

## Testing

- Unit tests: the game's rules (order, turns, choosing timeout, hints, scoring by time, all-guessed ending, reveal, the end, ties), guess matching (case, accents, hyphens, close), joining and leaving mid-game, the owner hand-over and the leader taking over, accepting and rejecting `draw` states; the drawing model (strokes, undo, clear, scaling); the word list (no duplicates, lowercase, drawable length).
- By hand: three tabs on one `?room=`, a whole game; a fourth tab joining mid-game; the drawer's tab closing mid-turn; on a phone-sized viewport drawing with touch.
- The README's controls and "Visitors together" describe the game and T.
