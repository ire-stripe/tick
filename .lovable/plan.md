## Fix stale Morning Brief when switching regions

### The bug
When you switch from Italy (which has a brief cached and playing) to CEE (which has no brief yet), the CEE panel briefly shows Italy's audio in the Morning Brief card — same URL, same progress `0:08 / 4:16`. It's not real playback of CEE; it's the Italy audio still marked "active" while wearing a CEE label.

### Root cause
`RegionPanel` reuses the same mounted `AudioPlayer` across regions and does not clear the `episodes` state before fetching the new region. So during the switch:

1. `displayRegion` flips to `cee`, but `episodes` still holds the Italy row.
2. `AudioPlayer` computes `baseAudioUrl` from that stale Italy episode.
3. Its `isActive` check (`player.episode.audioUrl === audioUrl`) matches the currently-playing Italy audio in the global context.
4. Result: CEE's card renders Italy's progress + play state until CEE's own fetch completes (and if CEE has no episode, it never corrects — it just sits there showing Italy's playhead).

### Fix
Two small changes in `src/components/RegionPanel.tsx`:

1. Clear `episodes` (and `latest`/`today`) at the start of the load effect so the player can't render a previous region's audio.
2. Remount `AudioPlayer` with `key={displayRegion}` so its internal `resolvedUrl`, voice-loading, and language state reset cleanly on region change.

That's enough — `AudioPlayer` already gates `isActive` on episode URL, so once episodes is empty for CEE it will correctly show "Generating today's brief…" and the mini-player keeps showing Italy playing.

### Files
- `src/components/RegionPanel.tsx` — reset lists at fetch start; add `key={displayRegion}` to `<AudioPlayer />`.

No backend changes.
