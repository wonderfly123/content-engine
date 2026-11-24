#!/bin/bash
# usage: render.sh <footage_dir> <edl.tsv> <out.mp4>
# EDL: file|in|srcdur|speed|cropx(optional 0-1, for sources that are not 9:16)|sound(optional: 1 keeps the clip's own sound)
# 1080x1920, 30 fps, clean cuts. The picture has no audio: mix.sh adds the sound. Software decode (Linux).
# A shot with sound 1 (speed 1 only: someone talking, or sound that matters) has its own sound collected, in
# place, into <out>.voice.wav (silence under every other shot); mix.sh lays the music under it.
# HDR sources (iPhone HLG / PQ, bt2020) are tonemapped to SDR bt709 here, the same chain the optimizer uses, so
# clips can be cut straight from the camera original without washed-out colour.
# A clip with a camera original in <footage_dir>/../originals (see workers/editor/prepare.py) is cut from that
# original: footage/ then only holds the small working copy the shots were chosen on.
# Also writes <out>.check.jpg: the middle frame of every shot in a row, to check each is upright, fills the frame, not black,
# and <out>.review-N.jpg: five frames across every shot, one shot per row (six shots a sheet), to see what happens in it.
B="$1"; E="$2"; OUT="$3"; W="${OUT%.mp4}.segs"; rm -rf "$W"; mkdir -p "$W"; i=0; fail=0; voiced=0; : > "$W/list.txt"; : > "$W/alist.txt"
rm -f "${OUT%.mp4}.voice.wav" "${OUT%.mp4}".review-*.jpg
while IFS='|' read -r f in d sp cx snd; do [ -z "$f" ] && continue; i=$((i+1)); o="$W/seg$(printf %02d $i).mp4"
  # The camera original, when the clip in footage/ is only a working copy of it (same name, same timing).
  src="$B/$f"; [ -f "$B/../originals/$f" ] && src="$B/../originals/$f"
  if [ -n "$cx" ]; then geo="crop=ih*9/16:ih:(iw-ih*9/16)*$cx:0,scale=1080:1920"; else geo="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"; fi
  skip=""; [ "${sp%.*}" -ge 30 ] 2>/dev/null && skip="-skip_frame nokey"
  tm=""; tag=""
  case "$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer,color_primaries -of csv=p=0 "$src" 2>/dev/null)" in
    *smpte2084*|*arib-std-b67*|*bt2020*) tm="zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,"
      tag="-colorspace bt709 -color_primaries bt709 -color_trc bt709" ;;
  esac
  # exact frame count per shot, so cut times never drift
  nfr=$(awk -v d="$d" -v sp="$sp" 'BEGIN{printf "%d", d/sp*30+0.5}'); dx=$(awk -v d="$d" -v sp="$sp" 'BEGIN{printf "%.3f", d+0.2*sp+0.2}')
  ffmpeg -v error -y $skip -ss "$in" -t "$dx" -i "$src" -an -vf "setpts=PTS/$sp,fps=30,$geo,${tm}setsar=1" -frames:v "$nfr" \
    -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p $tag -threads 0 "$o" </dev/null || { echo "FAIL shot $i $f"; fail=1; continue; }
  echo "file '$(basename "$o")'" >> "$W/list.txt"
  sd=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$o")
  ffmpeg -v error -y -ss "$(awk -v d="$sd" 'BEGIN{printf "%.2f", d/2}')" -i "$o" -frames:v 1 -vf scale=100:178 "$W/chk$(printf %02d $i).jpg" </dev/null
  for j in 0 1 2 3 4; do rv="$W/rv$(printf %02d_%d $i $j).jpg"
    ffmpeg -v error -y -ss "$(awk -v d="$sd" -v j=$j 'BEGIN{printf "%.3f", d*(j+0.5)/5}')" -i "$o" -frames:v 1 -vf scale=180:320 "$rv" </dev/null
    [ -f "$rv" ] || ffmpeg -v error -y -f lavfi -i color=black:s=180x320 -frames:v 1 "$rv" </dev/null
  done
  # the shot's sound: its own (sound 1, real speed) or silence, exactly as long as its picture
  adur=$(awk -v n="$nfr" 'BEGIN{printf "%.4f", n/30}'); a="$W/aud$(printf %02d $i).wav"; ok=0
  if [ "$snd" = "1" ]; then
    if awk -v sp="$sp" 'BEGIN{exit !(sp==1)}'; then
      fo=$(awk -v d="$adur" 'BEGIN{printf "%.3f", (d>0.1)?d-0.04:0}')
      if ffmpeg -v error -y -ss "$in" -t "$adur" -i "$src" -vn -map 0:a:0 -af "aresample=48000,afade=t=in:d=0.03,afade=t=out:st=$fo:d=0.04,apad" \
           -t "$adur" -ac 2 -ar 48000 -c:a pcm_s16le "$a" </dev/null 2>/dev/null; then ok=1; voiced=$((voiced+1))
      else echo "WARN shot $i $f: its sound could not be read, it plays without it"; fi
    else echo "WARN shot $i $f: sound is only kept at speed 1, it plays without it"; fi
  fi
  [ $ok -eq 1 ] || ffmpeg -v error -y -f lavfi -i anullsrc=r=48000:cl=stereo -t "$adur" -c:a pcm_s16le "$a" </dev/null
  echo "file '$(basename "$a")'" >> "$W/alist.txt"
done < "$E"
[ "$i" -eq 0 ] && { echo "FAIL empty EDL"; exit 1; }
cols=$(( i > 26 ? i : 26 ))
for k in $(seq $((i+1)) $cols); do ffmpeg -v error -y -f lavfi -i color=black:s=100x178 -frames:v 1 "$W/chk$(printf %02d $k).jpg" </dev/null; done
(cd "$W" && ffmpeg -v error -y -f concat -safe 0 -i list.txt -c copy -movflags +faststart "out.mp4" </dev/null) && mv "$W/out.mp4" "$OUT"
ffmpeg -v error -y -framerate 1 -pattern_type glob -i "$W/chk*.jpg" -vf "tile=${cols}x1" -frames:v 1 "${OUT%.mp4}.check.jpg" </dev/null
s=0; start=1
while [ $start -le $i ]; do s=$((s+1)); end=$((start+5)); [ $end -gt $i ] && end=$i; mkdir -p "$W/r$s"; rows=0
  for k in $(seq $start $end); do ls "$W"/rv$(printf %02d $k)_*.jpg >/dev/null 2>&1 && { cp "$W"/rv$(printf %02d $k)_*.jpg "$W/r$s/"; rows=$((rows+1)); }; done
  [ $rows -gt 0 ] && ffmpeg -v error -y -framerate 1 -pattern_type glob -i "$W/r$s/*.jpg" -vf "tile=5x$rows" -frames:v 1 -q:v 4 "${OUT%.mp4}.review-$s.jpg" </dev/null
  start=$((end+1)); done
if [ $voiced -gt 0 ]; then
  (cd "$W" && ffmpeg -v error -y -f concat -safe 0 -i alist.txt -c:a pcm_s16le "voice.wav" </dev/null) && mv "$W/voice.wav" "${OUT%.mp4}.voice.wav" || { echo "FAIL joining the shots' sound"; fail=1; }
fi
echo "$(basename "$OUT") $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s $i shots, $voiced with their own sound, review sheets: $s"
exit $fail
