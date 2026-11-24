#!/bin/bash
# usage: mix.sh <preview.mp4> <track|none> <audio_start_seconds> [music_db]
# Lays the sound under a rendered preview, in place. The picture is copied untouched, so the cuts stay on the beat.
# - Music only: the track from audio_start (beatfit.py prints it), loudness-normalised for phones (-14 LUFS,
#   peaks under -1.5 dBTP), 50 ms fade in, short fade out at the end.
# - When render.sh left <preview>.voice.wav (shots that keep their own sound): the voice is evened out and the
#   music drops under it while someone is speaking, then comes back up. What went into the mix is kept beside the
#   preview as <preview>.music.wav and <preview>.said.wav, so soundcheck.py can measure one against the other.
# - music_db (optional, e.g. -6): turns the music down by that much for the whole cut. Only when soundcheck.py
#   says the music is too loud under the voice.
# - Track `none`: only the shots' own sound (needs <preview>.voice.wav).
V="$1"; T="$2"; S="${3:-0}"; G="${4:-0}"; VO="${V%.mp4}.voice.wav"
[[ "$G" =~ ^-?[0-9]+(\.[0-9]+)?$ ]] || { echo "FAIL music_db must be a number like -6"; exit 1; }
rm -f "${V%.mp4}.music.wav" "${V%.mp4}.said.wav"
[ -f "$V" ] && [ -n "$T" ] || { echo "FAIL usage: mix.sh <preview.mp4> <track|none> <audio_start>"; exit 1; }
[ "$T" = "none" ] || [ -f "$T" ] || { echo "FAIL no such track: $(basename "$T")"; exit 1; }
[ "$T" = "none" ] && [ ! -f "$VO" ] && { echo "FAIL nothing to mix: no track and no shot keeps its own sound"; exit 1; }
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V") || { echo "FAIL cannot read $V"; exit 1; }
FS=$(awk -v d="$D" 'BEGIN{f=(d>6?1.5:d/4); printf "%.3f", d-f}'); FD=$(awk -v d="$D" 'BEGIN{printf "%.3f", (d>6?1.5:d/4)}')
TMP="${V%.mp4}.mix.mp4"
MUSIC="loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,volume=${G}dB,afade=t=in:d=0.05,afade=t=out:st=$FS:d=$FD,apad"
VOICE="highpass=f=90,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000,apad"
OUTA="-c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart"
if [ "$T" = "none" ]; then
  ffmpeg -v error -y -i "$V" -i "$VO" -map 0:v:0 -map 1:a:0 -c:v copy -t "$D" -af "$VOICE" $OUTA "$TMP" </dev/null || { rm -f "$TMP"; echo "FAIL mixing"; exit 1; }
  what="its own sound only"
elif [ -f "$VO" ]; then
  ffmpeg -v error -y -i "$V" -ss "$S" -i "$T" -i "$VO" -filter_complex \
    "[1:a]$MUSIC[m];[2:a]$VOICE,asplit=3[v1][v2][v3];[m][v1]sidechaincompress=threshold=0.008:ratio=20:attack=10:release=500,asplit=2[duck][d2];[duck][v2]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.84[a]" \
    -map 0:v:0 -map "[a]" -c:v copy -t "$D" $OUTA "$TMP" \
    -map "[d2]" -t "$D" -ac 1 -ar 16000 -c:a pcm_s16le "${V%.mp4}.music.wav" -map "[v3]" -t "$D" -ac 1 -ar 16000 -c:a pcm_s16le "${V%.mp4}.said.wav" </dev/null || { rm -f "$TMP"; echo "FAIL mixing"; exit 1; }
  what="music from ${S}s, lowered under the shots that keep their own sound"
else
  ffmpeg -v error -y -i "$V" -ss "$S" -i "$T" -map 0:v:0 -map 1:a:0 -c:v copy -t "$D" -af "$MUSIC" $OUTA "$TMP" </dev/null || { rm -f "$TMP"; echo "FAIL mixing"; exit 1; }
  what="music from ${S}s"
fi
mv "$TMP" "$V"
echo "$(basename "$V") with $what, $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V")s"
