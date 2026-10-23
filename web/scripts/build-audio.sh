#!/usr/bin/env bash
# Builds web/public/assets/audio/ from the downloaded CC0 sources listed in its CREDITS.md.
# Usage: scripts/build-audio.sh <dir with the unzipped Kenney packs and the two OpenGameArt WAVs>
set -euo pipefail
SRC=${1:?usage: build-audio.sh <source dir>}
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/assets/audio"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

ff() { ffmpeg -v error -y "$@"; }

# One-shot effects: mono (they're placed in space), 96 kbps.
effect() { ff -i "$1" -ac 1 -ar 44100 -c:a libmp3lame -b:a 96k "$OUT/$2.mp3"; }

# A seamless 30 s loop from the first 33 s of a WAV: the last 3 s crossfade into the first 3 s.
seamless() { # <wav> <name> <mono|stereo> <bitrate>
  ff -i "$1" -t 33 -filter_complex "
    [0:a]aformat=sample_rates=44100:channel_layouts=$3,asplit=3[a][b][c];
    [a]atrim=3:30,asetpts=PTS-STARTPTS[mid];
    [b]atrim=30:33,asetpts=PTS-STARTPTS,afade=t=out:d=3[tail];
    [c]atrim=0:3,asetpts=PTS-STARTPTS,afade=t=in:d=3[head];
    [tail][head]amix=inputs=2:normalize=0[xf];
    [mid][xf]concat=n=2:v=0:a=1" -c:a libmp3lame -b:a "$4" "$OUT/$2.mp3"
}

effect "$SRC/kenney_rpg-audio/Audio/doorOpen_1.ogg" door-open
effect "$SRC/kenney_rpg-audio/Audio/creak1.ogg" door-close
effect "$SRC/kenney_rpg-audio/Audio/doorClose_2.ogg" door-latch
effect "$SRC/kenney_ui-audio/Audio/click3.ogg" switch
for i in 0 1 2 3 4; do effect "$SRC/kenney_impact-sounds/Audio/footstep_wood_00$i.ogg" "step-$((i + 1))"; done

# Outdoor: birds from the park recording over a low, distant-traffic rumble.
ff -ss 60 -t 33 -i "$SRC/park_ambience_birds.wav" -f lavfi -t 33 -i "anoisesrc=color=brown:amplitude=0.6:seed=7" \
  -filter_complex "[1:a]lowpass=f=250,volume=0.25,aformat=channel_layouts=stereo[r];[0:a][r]amix=inputs=2:normalize=0" \
  -ar 44100 "$TMP/outdoor.wav"
seamless "$TMP/outdoor.wav" ambience-outdoor stereo 128k

# Kitchen: soft room noise plus a fridge-compressor hum (100 Hz and harmonics).
ff -f lavfi -t 33 -i "anoisesrc=color=pink:amplitude=0.02:seed=3" \
  -f lavfi -t 33 -i "sine=f=100" -f lavfi -t 33 -i "sine=f=200" -f lavfi -t 33 -i "sine=f=300" \
  -filter_complex "[0:a]lowpass=f=1500[n];[1:a]volume=0.05[h1];[2:a]volume=0.025[h2];[3:a]volume=0.01[h3];[n][h1][h2][h3]amix=inputs=4:normalize=0" \
  -ac 1 -ar 44100 "$TMP/kitchen.wav"
seamless "$TMP/kitchen.wav" ambience-kitchen mono 64k

# Room: very quiet, dark noise; the city faintly through the windows.
ff -f lavfi -t 33 -i "anoisesrc=color=brown:amplitude=0.08:seed=5" -af "lowpass=f=600" -ac 1 -ar 44100 "$TMP/room.wav"
seamless "$TMP/room.wav" ambience-room mono 64k

# Music: already a loop.
ff -i "$SRC/in_the_lobby.wav" -ar 44100 -c:a libmp3lame -b:a 128k "$OUT/music.mp3"
