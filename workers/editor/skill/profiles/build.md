# Build profile

For footage of something being made or assembled, with no talking to camera.

## What makes a moment worth using (strongest first)

1. **Change you can see**: a piece placed, a panel lifted, a line drawn.
2. **Reveal**: the finished thing, or a step back that shows scale.
3. **Hands and tools in action**: close and purposeful.
4. **People reacting**: a smile, a look at the result.
5. **Texture and detail**: close-ups of material or finish, used as breathers.

Counts against a moment: camera shake or refocusing, someone blocking the shot, nothing happening,
and the first and last second of a clip (phone being raised or lowered).

## Structure

- **Hook**: the first one to two seconds is the strongest visual in the cut, usually the finished result.
- **Order**: chronological after the hook; end on the finished result from a different moment or angle.
- **Before/after pairs**: the same subject from a similar position at different stages. Flag them in the scan and cut them together.
- **Variety**: no source range used twice in a cut (`fit.py` enforces this); alternate wide and close.
- **Long takes**: use both real-speed moments and timelapse stretches from the same clip. Split a long
  build take into consecutive timelapse stages with real-speed close-ups between them.

## Pacing

| Cut length | Shot length | Timelapse share |
|---|---|---|
| 15s | about 1s (0.8 to 1.6s) | a few shots |
| 30s | 1.5 to 2s | about a third |
| 45s | 2 to 3s | about half |
| 60s | 2.5 to 3.5s | half or more |

Timelapse speeds that worked: 4x to 8x for pans, 30x to 100x for assembly stretches, up to 500x for takes over 10 minutes.

## Rules learned from review

- **Pan rule**: when a clip only shows its subject by panning across it, use the whole pan sped up, never a slice.
  A one-second slice of a twelve-second pan read as "a random box".
- **Same camera position repeated** (for example a locked-off wide of a room) gets monotonous. Break it with
  real-speed moments, and say so in the reply when a segment has no other angles.
- **Crop for clips that are not 9:16**: set `crop_x` (0 = left, 0.5 = centre, 1 = right) to keep the action,
  such as the pen in a lettering close-up, in frame.
