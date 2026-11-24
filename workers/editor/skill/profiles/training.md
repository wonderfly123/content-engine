# Training profile

For footage of sport or physical practice: a workout, sparring, pad work, a class, a game, a run. Often one or
two long takes from a phone on a tripod, where most of the take is waiting and a few seconds are the reason it
was filmed. The job is to find those seconds.

## What makes a moment worth using (strongest first)

1. **Clean contact**: a kick, punch, knee or elbow landing; a ball struck; a lift locked out; a takedown.
2. **Combinations and exchanges**: two or more actions in a row, attack and answer, a full rep or set at speed.
3. **Power and speed you can see**: the pad jumping, a body moved by a hit, an explosive start, a full extension.
4. **Skill details**: footwork into a strike, a check, a slip, a clean technique close to the camera.
5. **The person and the room**: a coach talking, a glove touch, a breath between rounds, a laugh. One or two, as
   breathers, or to open or close.

Counts against a moment: walking, circling with nothing thrown, resetting, adjusting gear, waiting for a partner,
backs to the camera, the action hidden behind someone, and the first and last seconds of a clip.

## Finding the moments

- Use `moments.py`: its strongest windows are where limbs move fastest and pads or bags are hit hardest. Look at
  every window you might use with `sample.sh` (`clip|from|to`), and take the shot only when the frames show the
  strike or rep itself. Start about half a second before the action and end just after it lands or finishes, so
  the whole movement is in the shot. Never cut away in the middle of a combination.
- Spread shots across the take (early, middle and late), unless one stretch is clearly the best.
- When the person is in the footage, favour the moments where they are the one doing the action.

## Pacing

Use `held` with `fit.py`. A strike needs its wind-up and its landing: shots run 2 to 4 seconds, a long
combination or exchange up to 6. A 15s cut is 4 to 6 shots; a 30s cut is 8 to 12. Do not chop an exchange into
one-second pieces, and do not speed people up.

## Structure

- **Hook**: the single best hit or exchange, or the coach or athlete talking when a clip was filmed for that
  (keep its sound; see SKILL.md, "Sound from the clips").
- **Order**: loose. Build from technique to the hardest exchanges; end on the strongest hit or a clear finish
  (a glove touch, a last rep, a breath).
- **One camera position** is normal here. Keep it alive by changing what happens (kicks, hands, clinch, defence),
  and crop in (`crop_x`) for one or two shots when the frame allows it.
