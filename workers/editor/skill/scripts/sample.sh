#!/bin/bash
# usage: sample.sh <footage_dir> <outdir> < list of clip filenames (one per line)
# length gates: <=15s 4 frames, <=120s 6, else 10. One row per clip, 8 rows per sheet.
# Prints each row's frame times so a frame on the sheet can be traced back to a second in the clip.
B="$1"; rm -rf "$2"; mkdir -p "$2/f"; O="$(cd "$2" && pwd)"; r=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  r=$((r+1)); dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$B/$f")
  n=$(awk -v d="$dur" 'BEGIN{print (d<=15)?4:(d<=120)?6:10}'); line="row$r $f:"
  for k in 0 1 2 3 4 5 6 7 8 9; do out="$O/f/$(printf %03d_%02d $r $k).jpg"
    if [ $k -lt $n ]; then t=$(awk -v d="$dur" -v k=$k -v n=$n 'BEGIN{printf "%.2f", d*(k+0.5)/n}'); line="$line $t"
      ffmpeg -v error -y -ss "$t" -i "$B/$f" -frames:v 1 -vf "scale=144:256:force_original_aspect_ratio=decrease,pad=144:256:(ow-iw)/2:(oh-ih)/2" "$out" </dev/null
    else ffmpeg -v error -y -f lavfi -i color=black:s=144x256 -frames:v 1 "$out" </dev/null; fi
  done; echo "$line"
done
cd "$O/f" || exit 1; total=$r; s=0; start=1
while [ $start -le $total ]; do s=$((s+1)); mkdir -p "../s$s"; end=$((start+7)); rows=0
  for i in $(seq $start $end); do [ $i -le $total ] && { cp $(printf %03d $i)_*.jpg "../s$s/"; rows=$((rows+1)); }; done
  ffmpeg -v error -y -framerate 1 -pattern_type glob -i "../s$s/*.jpg" -vf "tile=10x$rows" -frames:v 1 -q:v 5 "../sheet$s.jpg" </dev/null; start=$((end+1)); done
ls "$O"/sheet*.jpg
