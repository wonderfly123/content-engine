#!/bin/bash
# usage: sample.sh <footage_dir> <outdir> < list of clips, one per line: `clip.mov` or `clip.mov|from|to`
# A whole clip gets a frame about every 5 seconds (4 frames up to 15s, 10 up to 50s, at most 60), ten per row,
# so a long clip takes several rows. `clip.mov|from|to` looks closely at that stretch instead: 10 frames
# (20 when it is over 6s), which is how to find the exact second a moment happens.
# Prints each row's frame times so a frame on the sheet can be traced back to a second in the clip.
# 8 rows per sheet (sheet1.jpg, sheet2.jpg, ...).
B="$1"; rm -rf "$2"; mkdir -p "$2/f"; O="$(cd "$2" && pwd)"; r=0
VF="scale=144:256:force_original_aspect_ratio=decrease,pad=144:256:(ow-iw)/2:(oh-ih)/2"
while IFS='|' read -r f from to; do
  [ -z "$f" ] && continue
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$B/$f" 2>/dev/null)
  [ -z "$dur" ] && { echo "skip $f: cannot be read"; continue; }
  if [ -n "$from" ] && [ -n "$to" ]; then
    a=$(awk -v a="$from" 'BEGIN{printf "%.2f", (a<0)?0:a}'); b=$(awk -v b="$to" -v d="$dur" 'BEGIN{printf "%.2f", (b>d)?d:b}')
    n=$(awk -v a="$a" -v b="$b" 'BEGIN{print (b-a>6)?20:10}'); label="$f ${a}-${b}s"
  else
    a=0; b="$dur"; label="$f"
    n=$(awk -v d="$dur" 'BEGIN{n=(d<=15)?4:(d<=50)?10:int(d/5+0.999); print (n>60)?60:n}')
  fi
  k=0
  while [ $k -lt $n ]; do
    r=$((r+1)); line="row$r $label:"
    for c in 0 1 2 3 4 5 6 7 8 9; do out="$O/f/$(printf %04d_%02d $r $c).jpg"
      if [ $k -lt $n ]; then t=$(awk -v a="$a" -v b="$b" -v k=$k -v n=$n 'BEGIN{printf "%.2f", a+(b-a)*(k+0.5)/n}'); line="$line $t"
        ffmpeg -v error -y -ss "$t" -i "$B/$f" -frames:v 1 -vf "$VF" "$out" </dev/null
        [ -f "$out" ] || ffmpeg -v error -y -f lavfi -i color=black:s=144x256 -frames:v 1 "$out" </dev/null
      else ffmpeg -v error -y -f lavfi -i color=black:s=144x256 -frames:v 1 "$out" </dev/null; fi
      k=$((k+1))
    done; echo "$line"
  done
done
[ $r -eq 0 ] && { echo "FAIL nothing to sample"; exit 1; }
cd "$O/f" || exit 1; total=$r; s=0; start=1
while [ $start -le $total ]; do s=$((s+1)); mkdir -p "../s$s"; end=$((start+7)); rows=0
  for i in $(seq $start $end); do [ $i -le $total ] && { cp $(printf %04d $i)_*.jpg "../s$s/"; rows=$((rows+1)); }; done
  ffmpeg -v error -y -framerate 1 -pattern_type glob -i "../s$s/*.jpg" -vf "tile=10x$rows" -frames:v 1 -q:v 5 "../sheet$s.jpg" </dev/null; start=$((end+1)); done
ls "$O"/sheet*.jpg
