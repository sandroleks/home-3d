import type { Ambience } from './audio';

export const CONFIG = {
  assetsBase: 'assets/',
  /** The kitchen walled off, as it is now (?kitchen=wall, K): its own export, inside assetsBase. */
  kitchenWallAssets: 'variants/kitchen-wall/',
  dracoPath: 'draco/',
  /** The Basis transcoder for the models' KTX2 textures (scripts/copy-draco.mjs puts it there). */
  basisPath: 'basis/',
  walkSpeed: 1.4,
  runSpeed: 2.8,
  mouseSensitivity: 0.0022,
  doorDuration: 0.6,
  /** Seconds for a glazed door's leaf to slide open or shut. */
  slidingDoorDuration: 0.9,
  /** Metres the player keeps from a sliding leaf (walls: the player's radius). */
  slidingLeafRadius: 0.1,
  /** Seconds for the turntable's platter to come up to speed, or to stop. */
  spinUp: 1.2,
  /** Seconds for a drawer or cupboard door to open or close. */
  movableDuration: 0.45,
  lightFadeDuration: 0.4,
  /** Detail on plain materials (details.ts), matched by name: per kind, the tile's size (m), how much darker its low
   * parts are (base colour), the normal map's slope scale, and its strength on the surface. */
  details: {
    match: {
      plaster: /plaster|ceiling|paint|concrete|limewash/i,
      fabric: /fabric|boucle|linen|duvet|curtain|rug|wool|felt|coat|cushion|throw|towel|blanket/i,
      wood: /birch|plywood|pine|wood/i,
    },
    /** Warp and weft threads across a fabric tile. */
    threads: 48,
    kinds: {
      plaster: { tile: 2, depth: 0.16, relief: 3, normalScale: 0.6 },
      fabric: { tile: 0.3, depth: 0.5, relief: 6, normalScale: 1 },
      wood: { tile: 0.8, depth: 0.28, relief: 2, normalScale: 0.4 },
    },
  },
  /** Anisotropic filtering on surface textures (capped at what the GPU takes); phones get `touch.anisotropy`. */
  anisotropy: 8,
  /** Mirrors draw their reflection at this share of the screen's resolution: a whole second view of the flat. */
  mirrorScale: 0.5,
  /** Packed lamp textures one lightmapped material can take (the pipeline's MAX_PACKS). */
  maxPacks: 3,
  /** Share of each room's own baked lamp light that is always there, lights off or not: light spilling in from elsewhere, so unlit rooms keep their shape rather than going flat or black. */
  lightSpill: 0.02,
  /** The soft dark patch under loose things and the table's pieces (contact-shadow.ts): how dark, how far past the
   * footprint it reaches (×; boards: less), and how far (m) above the surface it is drawn. */
  contactShadow: { opacity: 0.55, spread: 1.5, boardSpread: 1.12, lift: 0.002 },
  interactDistance: 2.5,
  /** Sitting and lying (seats.ts): click a seat or the bed, C to sit on the floor; moving stands you up. */
  seats: {
    /** Eye height (m) above the seat or floor sitting, and above the mattress lying down. */
    sitEye: 0.72,
    lieEye: 0.2,
    /** Metres the eyes are back from the spot's middle: a seated back, a head on the pillow. */
    sitBack: 0.1,
    lieBack: 0.45,
    /** Where the view starts lying down: looking along the bed and up toward the ceiling (radians). */
    liePitch: 0.5,
    /** Seconds to sit down, lie down or stand up. */
    transition: 0.45,
    /** Metres in front of a seat where standing up puts you (or the nearest free spot to it). */
    standStep: 0.6,
    /** A spot is taken when another visitor sits or lies within this many metres of it. */
    takenRadius: 0.3,
  },
  /** Blender renders at +0.5 EV; the walkthrough runs 0.8 EV brighter than the Cycles references, which read too dark on screen. */
  exposure: Math.pow(2, 1.3),
  /** Cycles' diffuse light pass is outgoing/albedo; three.js wants irradiance (×π). */
  lightmapScale: Math.PI,
  // The room-environment reflections, scaled by the sky; higher values add light Cycles doesn't have. Only for what
  // isn't lightmapped (glass, a switched-off screen): lightmapped surfaces reflect their room's probes (`reflections`).
  envIntensity: 0.0015,
  /** Lightmapped surfaces' reflections (lightmaps.ts ProbeBinding): 1 is as the probes were rendered; the reflection
   * follows the baked light where it is, up to maxGain times the light at the probe. The stand-in room environment
   * (no probes yet) shows a room this reflective: what surrounds a surface sends back about that share of its light. */
  reflections: { intensity: 1, maxGain: 2, standInAlbedo: 0.2 },
  /** The daytime sky at the horizon, seen through the windows. */
  skyColor: '#cfdbe6',
  sky: {
    zenith: '#7ea6d4',
    sunsetZenith: '#5a6f9e',
    nightZenith: '#04070f',
    /** Around the sun: faint and white by day, strong and orange near sunset. */
    dayGlow: '#fff4dc',
    sunsetGlow: '#ff9a4a',
    /** Angular radius of the drawn disc in degrees; the real sun's is 0.27, too small to see at this resolution. */
    sunRadius: 0.8,
    /** Share of the month's mean cloud cover that is drawn: the mean includes overcast days, which the typical day's light doesn't show. */
    cloudScale: 0.6,
    /** Cloud cover with real lighting off. */
    flatCloudCover: 0.25,
  },
  /** Near/far of the surroundings pass: the building's own facade is just below the windows, the sea kilometres out. */
  surroundingsNear: 0.3,
  surroundingsFar: 20000,
  /** Surroundings meshes thinner than this (m) are ground layers that share one plane. */
  surroundingsFlatHeight: 0.01,
  verticalFov: 70,
  /** Degrees. Tall screens (a phone held upright) widen the vertical field of view so at least this much shows across. */
  minHorizontalFov: 50,
  /** Phones and tablets (no mouse): drag the left side to walk, the right side to look, tap to use. */
  touch: {
    /** Share of the screen's width, from the left, where a touch becomes the walking stick. */
    stickArea: 0.5,
    /** CSS px from the stick's centre to its ring: a push to the ring walks at full speed. */
    stickRadius: 56,
    /** Share of the radius that does nothing, so a resting thumb doesn't drift. */
    deadZone: 0.12,
    /** Pushing past this many radii runs. */
    runPush: 1.5,
    /** Radians of turn per CSS px dragged. */
    lookSensitivity: 0.005,
    /** A touch that moves less than this (CSS px) and lifts within tapTime (ms) is a tap. */
    tapSlop: 10,
    tapTime: 300,
    /** Phones have far less GPU memory than desktops: lightmaps above this size are halved on load, and the sun's shadow map is smaller. */
    maxLightmapSize: 1024,
    shadowMapSize: 2048,
    anisotropy: 4,
  },
  sun: {
    /** Seconds of sun per real second while playing: one hour every two seconds. */
    playRate: 1800,
    nudgeMinutes: 15,
    nudgeDays: 7,
    shadowMapSize: 4096,
    /** Degrees the sun moves before its shadows are redrawn: while the time-lapse plays the clock changes every frame,
     * and a full redraw of the shadow map each frame costs more than the rest of the frame. */
    shadowStep: 0.3,
    /** How far toward the sun (m) shadow casters are collected; a 10 m building's shadow at 3 degrees reaches about 190 m. */
    shadowReach: 200,
    shadowBias: -0.00002,
    shadowNormalBias: 0.01,
    /** Share of the sunlight entering a room that comes back as an even fill, per m² of floor. Tuned against Cycles references: winter-morning bedroom and summer-evening Sala within about 1%. */
    bounce: 0.04,
    /** Global scale on the baked sky layer, fitted against Cycles (0.38). Not a double pi: bake.Lighting._sky swaps the Sky Texture for a flat colour, so the bake world shines from every direction, including below the horizon, and the baked scene has no ground (prepare_scene removes the neighbourhood and building). Windows therefore get full sky radiance in their lower half, while the Cycles references render the full .blend, where ground and neighbours block it. The proper fix is a horizon in the bake world (sky above, black below), then a re-bake and re-fit. */
    skyGain: 0.38,
    /** The sun's colour at the horizon; white above 30 degrees. */
    warmColor: '#ffb070',
    sunsetSky: '#f2a46b',
    nightSky: '#0d1424',
    /** Even light on top of the bake (three ambient intensity; pi gives full albedo), so corners and windowless rooms aren't black. Fades from day to night over civil twilight. */
    ambient: { day: 0.15, night: 0.03, color: '#fff2e2' },
  },
  /** Real lighting off: the same even daylight whatever the date and time. */
  flatLighting: {
    /** Baked sky layer brightness; real days run from about 0.5 (winter sunset) to 4.7 (summer noon). */
    sky: 3,
    ambient: 0.15,
    /** The neighbourhood's lighting (W/m²) and the sun's direction (degrees) outside. */
    outsideSun: { elevation: 50, azimuth: 200, watts: 500 },
    outsideSky: 150,
  },
  /** Visitors see each other: WebRTC between their browsers, found through public Nostr relays (Trystero), no server. */
  multiplayer: {
    appId: 'apartment-walkthrough',
    /** Everyone on the site shares this room; `?room=<name>` gives a group one of its own. */
    room: 'apartment',
    /** Where TURN credentials come from (`api/turn.ts`), for visitors whose networks block a direct connection, and
     * how long (ms) to wait for them before joining without. */
    turn: { url: 'api/turn', timeout: 3000 },
    /** Poses sent per second while moving or turning, and while still (a heartbeat). */
    poseRate: 15,
    idleRate: 1,
    /** Seconds without a pose before a visitor's avatar is removed. */
    staleAfter: 15,
    /** Times a second the open guest list looks again at who is in which room and who is talking. */
    guestListRate: 4,
    /** Time constant (s) of the avatars' motion smoothing between poses. */
    smoothing: 0.1,
    maxNameLength: 24,
    defaultName: 'Guest',
    /** Each visitor's colour, picked from here by their peer id: pastels, the first a caramel after the reindeer's brown. */
    colours: ['#e2bc94', '#f7b2c4', '#a9d4f5', '#b5e5b0', '#fde29b', '#cdb6f2', '#ffc4a0', '#9fe3d6'],
    /** The visitors' figures (`creatures.ts`): little toy animals, about 1.6 m to the antler tips at scale 1. */
    creature: {
      scale: 1,
      /** Metres between the top of the figure and its name label, and the label's width and height. */
      labelGap: 0.18,
      label: [0.9, 0.16] as [number, number],
      /** Metres walked per walk cycle (a step with each pair of legs). */
      stride: 0.75,
      /** The figure's brightness in an unlit room at night, as a share of its full colour. */
      darkest: 0.25,
      /** The baked sky level at which daylight shows a figure in full colour (night 0, a summer noon about 4.7). */
      daylight: 1.5,
      /** How much a lamp lights a figure in its room, against the room's ceiling light. */
      lamp: 0.7,
      /** Metres the body bounces with each step. */
      bounce: 0.05,
      /** Time constant (s) of sitting down, lying down and getting up. */
      settle: 0.15,
      /** The googly pupils: how stiff and how damped their spring is (lower damping wobbles longer), and how far they roll (radians). */
      googly: { stiffness: 80, damping: 3.2, range: 0.55 },
      /** Seconds between blinks, at random within this range, and how long one lasts. */
      blink: [2, 6] as [number, number],
      blinkTime: 0.16,
    },
    /** Proximity voice (voice.ts): how voices fall off with distance, how walls muffle them, and how a voice opens
     * its animal's mouth. */
    voice: {
      /** The voices' bus, against the other sounds. */
      level: 1,
      /** Metres within which a voice is at full level, how fast it falls off beyond, and where it stops falling. */
      refDistance: 1.5,
      rolloff: 1.2,
      maxDistance: 15,
      /** Wall checks per second per voice, and seconds a change in walls takes to fade in. */
      occlusionRate: 10,
      occlusionFade: 0.15,
      /** Metres within which hits along the ray count as one wall (both faces of it). */
      mergeHits: 0.3,
      /** Gain and low-pass cutoff (Hz) for 0, 1, 2 and 3 or more walls or closed doors in the way. */
      walls: [[1, 20000], [0.5, 1800], [0.25, 900], [0.12, 500]] as [number, number][],
      /** A voice's loudness as a mouth: the RMS of silence and of a full voice, seconds to open and to close, and the
       * level above which the "With …" line marks them talking, held for `hold` seconds. */
      talk: { floor: 0.01, full: 0.12, rise: 0.03, fall: 0.12, shown: 0.25, hold: 0.5 },
      /** Radians the body nods forward at full voice. */
      nod: 0.06,
    },
  },
  /** The games on the dining table (games.ts): chess at N0/S0, backgammon at N1/S1, Go at N2/S2; the S chair plays white. */
  games: {
    /** Each slot's middle (x, z): halfway between its two chairs' spots in seats.json (z 3.2), and level with them,
     * except slot 0, 10 cm toward the table's end to clear the fruit bowl, slot 1, 4.5 cm toward it to sit between
     * the bowl (to x 1.58) and the mug and books (from x 1.93), and slot 2, 6 cm toward it to clear the table runner
     * under the mug and books (x 1.85 to 2.25). */
    slots: [[1.15, 3.2], [1.755, 3.2], [2.41, 3.2]] as [number, number][],
    /** The table top's height (m): the model's dining table. */
    tableTop: 0.76,
    /** A visitor is in a game chair when seated within this many metres of its spot (poses are sent to the mm). */
    chairRadius: 0.05,
    /** Seconds a game sent by another visitor waits for its two players to show in their chairs here. */
    pendingFor: 5,
    /** Seconds a piece takes to slide to its square (and a Go stone to drop onto its point, or lift off). */
    slide: 0.3,
    /** The chessboard: its size, the wooden border and its thickness (m), and the colours. */
    chess: {
      size: 0.4, border: 0.02, thickness: 0.015,
      white: '#efe6d2', black: '#4a3b33', light: '#e8d5b0', dark: '#9c6b4a', wood: '#6b4630',
    },
    /** The backgammon case (m): its size across (x) and deep (z), the rim, bar and tray widths, the floor's thickness
     * and the walls' height above it; the checkers' radius and thickness, the dice's size, how long a roll tumbles
     * (s), and the colours. A travel case: the fruit bowl, the mug and the books leave 34 cm across at slot 1. */
    backgammon: {
      width: 0.3, depth: 0.28, rim: 0.012, bar: 0.018, tray: 0.03, base: 0.01, wall: 0.018,
      checker: 0.0085, thickness: 0.005, die: 0.012, tumble: 0.6,
      wood: '#6b4630', felt: '#33493b', light: '#e8d5b0', dark: '#9c6b4a', white: '#efe6d2', black: '#4a3b33', pips: '#2a2622',
    },
    /** The Go board (m): its size, the margin outside the outer lines, its thickness; the stones' radius and height,
     * how far a new stone drops onto its point, and the colours. 28 cm: the runner and the table's rounded end leave
     * x 2.25 to about 2.72 at slot 2. */
    go: {
      size: 0.28, margin: 0.02, thickness: 0.025, stone: 0.014, height: 0.009, drop: 0.03,
      wood: '#d8b077', lines: '#3b2c1e', white: '#f2eee4', black: '#2b2a28',
    },
  },
  /** The things in the drawers and cupboards that visitors pick up, put down and throw (props.ts). */
  props: {
    /** Height (m) a leaving visitor's held thing is dropped from, straight down onto whatever is under where they were. */
    leaveHeight: 1,
    /** Light inside a drawer or cupboard, as a share of the room's. */
    insideLight: 0.6,
    /** The object under the crosshair, this much brighter. */
    highlight: 1.35,
    /** Where the held object is: right, down and forward (m) from the eye. */
    hand: [0.2, -0.24, -0.45] as [number, number, number],
    /** Another visitor's: forward and down (m) from their animal's mouth. */
    otherHand: [0.18, 0.08] as [number, number],
    /** A throw's speed (m/s) at a tap and at full strength, reached after `chargeTime` s held. */
    throwSpeed: [2, 7] as [number, number],
    chargeTime: 1,
    /** Spin (rad/s) a throw gives, about the axis across its flight. */
    throwSpin: 6,
    /** A received throw faster than this many times full strength is slowed to it. */
    maxSpeedFactor: 1.5,
    /** A drop lets go this far (m) in front of the eye and below it. */
    dropAhead: 0.3,
    dropBelow: 0.6,
    ghostOpacity: 0.35,
    /** Seconds the "someone else took it" note stays up. */
    noticeTime: 1.5,
    /** A received change counted more than this far ahead of the one known is refused (a forged count would lock it). */
    maxJump: 1000,
    physics: {
      gravity: 9.81,
      /** Longest step (s): a fast throw mustn't pass through a thin shelf. */
      step: 1 / 120,
      /** Share of the speed into a surface that comes back from a floor, and from a wall. */
      restitution: 0.3,
      wallRestitution: 0.4,
      /** Share of the speed along a surface kept through a bounce. */
      friction: 0.6,
      /** Slowing (m/s²) while sliding, and the speed it stops at. */
      slideFriction: 3,
      stopSpeed: 0.05,
      /** A rebound slower than this (m/s) and it slides instead. */
      restSpeed: 0.5,
      maxBounces: 4,
      /** Landing faster than this (m/s), a tall thing tips over. A drop from the hand lands slower. */
      tipSpeed: 5,
      /** Seconds before a flight is set down where it is. */
      maxFlight: 6,
      /** Below this height (m) a thing has fallen out of the flat: it goes home. */
      floorCatch: -1,
      /** A surface whose normal points up at least this much (its y) is one to land on. */
      upNormal: 0.7,
      /** How far below a sliding thing its surface may be (m) before it falls off the edge. */
      support: 0.03,
      /** The flying ball's radius at most (m). */
      radiusCap: 0.06,
    },
    place: {
      /** A surface to put things on faces up at least this much (cos 45°). */
      upNormal: 0.707,
      /** How far the surface under each corner may be from the one aimed at (m). */
      support: 0.015,
    },
  },
  /** Draw and guess on the Sala TV (draw-rules.ts, draw-game.ts): the phases' times, the points, the hints, sharing. */
  draw: {
    /** Seconds to choose a word, to draw it, to see it revealed, and to see the final scores. */
    choose: 15,
    drawing: 80,
    reveal: 5,
    end: 15,
    /** A right guess scores `most` at the start of the drawing time, falling to `least` at its end, rounded to
     * `step`; the drawer scores `drawer` for each. */
    most: 300,
    least: 100,
    step: 10,
    drawer: 50,
    /** Shares of the drawing time at which a letter of the word shows (never more than half its letters). */
    hints: [0.5, 0.75] as number[],
    /** Words to choose from, and the lines the feed keeps. */
    choices: 3,
    feed: 8,
    /** Seconds between the drawer's batches of stroke points. */
    strokeEvery: 0.05,
  },
  /** The wine on the kitchen's back counter (wine.ts) and getting drunk on it (drunk.ts). */
  wine: {
    /** Where the bottle stands (x, z): on the back counter between the sink and the hob, the same in both kitchens;
     * the worktop's height (m), and where the glass stands from the bottle (x, z). */
    at: [-2.95, 4.3] as [number, number],
    counterTop: 0.9,
    glass: [0.07, -0.13] as [number, number],
    /** Drunkenness each sip adds, the most it builds up to (effects top out at 1, so more only lasts longer), and how
     * much wears off a second: three minutes from fully drunk to sober. */
    sip: 0.25,
    max: 1.5,
    soberRate: 1 / 180,
    /** Seconds the bottle takes to lift, tip toward you and set back down. */
    sipTime: 1,
    /** The view fully drunk: roll, yaw and pitch sway (radians), sideways and up-down sway (m), how fast it all
     * wanders (one sway every 1/speed seconds or so), and the blur (CSS px). */
    wobble: { roll: 0.09, yaw: 0.05, pitch: 0.03, side: 0.05, bob: 0.02, speed: 0.35 },
    blur: 3,
    /** Drinking too fast: more than `sips` sips within `window` seconds blacks you out. The view fades to black over
     * `fade` s, stays black `hold` s (you sink to the floor meanwhile) and comes back over `wake` s, still fully drunk. */
    blackout: { sips: 10, window: 120, fade: 1.5, hold: 4, wake: 2.5 },
    /** A drunk visitor's animal fully drunk: how far it tilts side to side and forward and back (radians). */
    sway: { roll: 0.22, pitch: 0.1 },
    colours: { glass: '#1f3a26', label: '#efe4cc', capsule: '#6e1424', wine: '#5a0d1c', stemware: '#dfe8ea' },
  },
  /** The shooting range on the Varanda, the office's balcony (range-*.ts): the rack and the Start button, the round,
   * the targets and how they fly. Metres and seconds; the targets fly beyond the railing, toward −z. */
  range: {
    /** The room the rifle stays in: stepping out of it puts the rifle back. */
    room: 'varanda',
    /** Where the rack and the button stand on the balcony floor (x, z), at the railing's east end, clear of the
     * balcony door; and the floor's height. */
    rack: [2.85, -8.85] as [number, number],
    button: [2.85, -8.35] as [number, number],
    floor: 0,
    /** The countdown, the round, and how long its final scores show. */
    countdown: 3,
    length: 60,
    end: 10,
    /** How close two starts are (ms) to count as pressed at once: the lower round id then wins; further apart, the
     * earlier start does. */
    crossing: 2000,
    /** Hits kept for a round not heard of yet, oldest dropped first. */
    pending: 64,
    /** The bolt cycle between shots; the kick's ease back (s); where the rifle is held in view (camera space, m). */
    cycle: 0.6,
    kickTime: 0.18,
    hold: [0.2, -0.24, -0.4] as [number, number, number],
    /** The railing's line (z) and the balcony's middle across (x). Targets fly `near`..`far` beyond the railing and
     * up to `across` to either side of the middle. */
    rail: -9.09,
    middle: 1.73,
    near: 12,
    far: 30,
    across: 14,
    /** Gravity on the clays, lighter than real so they hang a little, and the height they fall away to, below the
     * railing and out of sight. */
    gravity: 8,
    drop: -4,
    /** A drone's zig-zag: how far it bobs up and down (m) and how fast (rad/s), and how far it swings toward and away
     * (m) and how fast; and a multiplier on the drone's phase for the swing, so the two don't move in step. */
    zigzag: { rise: 1.2, riseRate: 2.6, swing: 2, swingRate: 1.1, skew: 0.7 },
    /** Each kind: its points, its size, its hit zone's radius (larger than it looks, for iron sights), how long it
     * flies, and the height it starts at (a drone's, give or take 3 m). */
    kinds: {
      clay: { points: 10, size: 0.55, hit: 0.85, time: [2.5, 4] as [number, number], launch: -3 },
      gold: { points: 30, size: 0.4, hit: 0.65, time: [1.8, 2.4] as [number, number], launch: 1 },
      drone: { points: 50, size: 0.75, hit: 1.0, time: [5, 7] as [number, number], launch: 7 },
    },
    /** The round's targets: one every `gap` s or so (±20 %) from `first` s until `last` s before the end, in pairs
     * from `pairsFrom` of the way through, `gold` of them gold; and `drones` drones spread across the round. */
    schedule: { first: 0.5, last: 4.5, gap: 1.6, pairsFrom: 0.5, gold: 0.125, drones: 3 },
    /** How long another's tracer shows, a hit's shards fall, and its points float up. */
    tracer: 0.12,
    shards: 1.6,
    float: 1.2,
    colours: {
      wood: '#6b4a2e', metal: '#2c2e31', clay: '#f06a1d', gold: '#f2c335', drone: '#3a3f46', rotor: '#9aa1a8',
      button: '#c8161d', lit: '#ff4a3d', housing: '#f2c335', flash: '#ffd88a', tracer: '#fff2c4',
    },
  },
  /** The office's Nanoleaf panels (nanoleaf.ts): a gradient between two hues (0..1: teal to magenta, through blue)
   * drifting across the panels, `speed` radians a second, `spread` radians a metre along the wall. `glow` scales the
   * panels' baked glow so the colours stay deep instead of clipping to white. */
  nanoleaf: { hues: [0.47, 0.83] as [number, number], speed: 0.45, spread: 4.5, saturation: 1, lightness: 0.5, glow: 0.22 },
  /** Philips Hue scenes (hue.ts): the menu in the sun panel, H steps through them in the room you're in. */
  hue: {
    /** Colour temperature the lamps were baked at (model_details.py: 3000 K ceilings, 2700 K lamps). */
    bakedKelvin: 2850,
    /** The most a colour scene lifts any channel of the baked light (hue.ts tintFor): more washes deep colours out. */
    colourGain: 1.5,
    /** For linking the flat's real bridge later: its address and app key, and each room id's Hue room (group) id.
     * Until then (bridge null) scenes only change the walkthrough. */
    bridge: null as string | null,
    appKey: '',
    rooms: {} as Record<string, string>,
  },
  /** Optional display names by room id, e.g. { sala: 'Living room' }. */
  roomNames: {} as Record<string, string>,
  /** How prompts name each lamp group ("Click: turn floor lamp on"); otherwise its name with spaces for hyphens. */
  lampNames: {
    'bar-shelves': 'shelf lights', workbench: 'workbench light', 'bedside-left': 'bedside lamp', 'bedside-right': 'bedside lamp',
    'screen-bar': 'monitor light', 'wall-lights': 'wall lights', nanoleaf: 'Nanoleaf panels', niche: 'shelf light',
  } as Record<string, string>,
  /** The TV, monitor and laptop: picture size in px and brightness. The light they cast is baked (SCREEN_LIGHT_WATTS). */
  screens: {
    sizes: { tv: [512, 288], monitor: [512, 288], laptop: [384, 240] } as Record<string, [number, number]>,
    /** Multiplies the picture: above 1 the brightest parts bloom. */
    brightness: 1.25,
    /** Pictures redraw this often (per second), and only within this distance (m). */
    fps: 30,
    maxDistance: 10,
    fade: 0.25,
  },
  /** Soft glow around small lit fixtures (bulbs, lampshades, ceiling diffusers): one camera-facing sprite each. */
  halos: {
    /** Brightness, times the fixture's glow colour and its lamp's level. */
    strength: 0.35,
    /** Sprite size relative to the fixture, and its limits in m. */
    size: 2.2,
    minSize: 0.25,
    maxSize: 1.1,
    /** Glowing surfaces larger than this (m) get no halo: LED strips, a pair of wall lights sharing a material. */
    maxFixture: 0.7,
  },
  /** Rooms whose ambience isn't the default quiet room tone. */
  roomAmbience: { varanda: 'outdoor', marquise: 'outdoor', cozinha: 'kitchen', lavandaria: 'kitchen' } as Record<string, Ambience>,
  audio: {
    base: 'assets/audio/',
    /** Bus levels for one-shot effects, footsteps, room ambience and music. */
    effects: 0.5,
    steps: 0.35,
    ambience: 0.4,
    music: 0.25,
    /** Seconds. */
    ambienceFade: 1.5,
    /** The music fading in when the turntable starts and out when it stops. */
    musicFade: 1.5,
    muteFade: 0.2,
    /** Metres between footsteps, and before the first one after standing still. */
    stride: 0.7,
    runStride: 0.9,
    firstStep: 0.25,
    /** The rifle's shot, made in code (sound.ts): a burst of noise this long (s), decaying with this time constant,
     * low-passed at `cutoff` Hz; its level, and the distance (m) it is heard at full level from another shooter. */
    shot: { length: 0.45, decay: 0.07, cutoff: 2400, level: 0.9, reach: 4 },
    /** The instruments visitors play (instrument-sound.ts). */
    instruments: 0.7,
  },
  /** Playing the studio's instruments (instruments.ts, instrument-sound.ts). */
  instruments: {
    /** The C the 18 note keys start on before Z and X shift them, and the notes each instrument has (MIDI). */
    base: { piano: 60, synth: 48, 'electric guitar': 48, 'bass guitar': 36, ukulele: 60 },
    range: {
      piano: [21, 108], synth: [24, 96], 'electric guitar': [40, 86], 'bass guitar': [28, 67], ukulele: [60, 84],
    } as Record<string, [number, number]>,
    /** ms from one string to the next in a strum. */
    strumGap: { piano: 0, synth: 0, 'electric guitar': 14, 'bass guitar': 0, ukulele: 22 },
    /** Metres from an instrument within which it is heard at full level; it fades beyond, as a voice does. */
    reach: 1.5,
    /** Notes sounding at once, all instruments together; past it the oldest stops. */
    polyphony: 40,
    /** Seconds a held note sounds at most: a key whose release never came (a visitor gone mid-note). */
    maxHold: 30,
    /** A guitar, bass or ukulele in hand (instruments.ts, carryPose), in the hand's frame (x right, y up, -z ahead):
     * which way its neck points and its strings face, and where its middle is from the hand (m). */
    carry: { neck: [-1, 0.45, -0.25], face: [0.1, 0.75, 0.6], at: [-0.1, -0.08, -0.05] } as {
      neck: [number, number, number]; face: [number, number, number]; at: [number, number, number];
    },
  },
};
