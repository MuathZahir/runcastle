#!/usr/bin/env bash
#
# make-gif.sh — stitch the worker's step screenshots into a short demo GIF.
# The worker saves PNGs to .afk/shots/NN-label.png (NN = zero-padded order); this
# turns them into .afk/demo.gif. No-op if there are no screenshots.
#
set -uo pipefail
SHOTS=.afk/shots
OUT=.afk/demo.gif
shopt -s nullglob
files=("$SHOTS"/*.png)
[ ${#files[@]} -eq 0 ] && { echo "make-gif: no screenshots, skipping"; exit 0; }

# ~1.2s per frame, scaled to a sane width, with a good palette.
ffmpeg -y -framerate 0.85 -pattern_type glob -i "$SHOTS/*.png" \
  -vf "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$OUT" >/dev/null 2>&1 && echo "make-gif: wrote $OUT (${#files[@]} frames)" || echo "make-gif: ffmpeg failed (non-fatal)"
