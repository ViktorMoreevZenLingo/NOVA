#!/usr/bin/env bash
# Builds the 2-minute NOVA Coach pitch video from the real recordings.
#   COACH_WAV=... PULSE_WAV=... COACH_CALL_JSON=... PULSE_CALL_JSON=... PHONE_MP4=... FE_MP4=demo/output/coach-*/nova-coach-demo.mp4 \
#   FFMPEG=ffmpeg PLAYWRIGHT_MODULE=... CHROME_CHANNEL=chrome demo/pitch/render.sh
# ElevenLabs narrates the text-only parts (hook, description captions, outro); the call recordings are
# never re-narrated. Set ELEVENLABS_API_KEY (and optionally ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL).
# Clips are cached in demo/pitch/.vo-cache so reruns don't re-hit the API.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# Load ElevenLabs (and any other) secrets from demo/pitch/.env if present. Already-set env wins.
[ -f "$here/.env" ] && { set -a; . "$here/.env"; set +a; }
out="$(cd "$here/.." && pwd)/output/pitch-$(date -u +%Y-%m-%dT%H-%M-%S)"
work="$out/work"; mkdir -p "$work/media"
FF="${FFMPEG:-ffmpeg}"
enc() { "$FF" -y -loglevel error "$@" -an -c:v libx264 -preset fast -crf 18 -g 1 -pix_fmt yuv420p -r 30; }
# Phone screen recording (portrait), all-intra for exact seeking.
enc -i "$PHONE_MP4" -vf "scale=400:-2,fps=30" "$work/media/phone.mp4"
# FE clips: name start end (seconds in the local FE recording).
while read -r name from to; do
  enc -ss "$from" -to "$to" -i "$FE_MP4" -vf "fps=30" "$work/media/$name.mp4"
done <<CLIPS
f1 28.5 34.6
f2 45.5 50.6
f3 68.5 76.6
f4 86.8 92.4
f5 100.8 105.9
f6 112.8 117.9
f7 125.8 131.9
CLIPS
cat > "$work/inputs.json" <<JSON
{"ffmpeg": "$FF", "ffprobe": "${FFPROBE:-ffprobe}", "coach_wav": "$COACH_WAV", "pulse_wav": "$PULSE_WAV", "coach_json": "${COACH_CALL_JSON:-}", "pulse_json": "${PULSE_CALL_JSON:-}", "phone_offset": ${PHONE_OFFSET:-8}}
JSON
python3 "$here/build.py" "$work"
node "$here/render.mjs" "$work"
"$FF" -y -loglevel error -framerate 30 -i "$work/frames/%05d.jpg" -i "$work/audio.wav" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart "$out/nova-coach-pitch.mp4"
echo "$out/nova-coach-pitch.mp4"
