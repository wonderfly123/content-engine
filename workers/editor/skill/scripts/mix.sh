#!/bin/bash
# usage: mix.sh <preview.mp4> <track> <audio_start_seconds>
# Lays the track under a rendered (silent) preview, in place: from audio_start (beatfit.py prints it),
# loudness-normalised for phones (-14 LUFS, peaks under -1.5 dBTP), 50 ms fade in, short fade out at the end.
# The picture is copied untouched, so the cuts stay exactly on the beat.
V="$1"; T="$2"; S="$3"
{ [ -f "$V" ] && [ -f "$T" ] && [ -n "$S" ]; } || { echo "FAIL usage: mix.sh <preview.mp4> <track> <audio_start>"; exit 1; }
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V") || { echo "FAIL cannot read $V"; exit 1; }
FS=$(awk -v d="$D" 'BEGIN{f=(d>6?1.5:d/4); printf "%.3f", d-f}'); FD=$(awk -v d="$D" 'BEGIN{printf "%.3f", (d>6?1.5:d/4)}')
TMP="${V%.mp4}.mix.mp4"
ffmpeg -v error -y -i "$V" -ss "$S" -i "$T" -map 0:v:0 -map 1:a:0 -c:v copy -t "$D" \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.05,afade=t=out:st=$FS:d=$FD,apad" \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$TMP" </dev/null || { rm -f "$TMP"; echo "FAIL mixing"; exit 1; }
mv "$TMP" "$V"
echo "$(basename "$V") with music from ${S}s, $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V")s"
