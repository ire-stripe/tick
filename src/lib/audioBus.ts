// Cross-source audio coordinator: ensures only one audio source plays at a time.
// Each audio source (morning brief, article listen) registers a stop callback
// with a unique source id. When one source starts playing, it calls
// `stopOtherSources(myId)` to pause every other registered source.

type StopFn = () => void;
const stops = new Map<string, StopFn>();

export function registerAudioSource(id: string, stop: StopFn): () => void {
  stops.set(id, stop);
  return () => {
    if (stops.get(id) === stop) stops.delete(id);
  };
}

export function stopOtherSources(activeId: string) {
  for (const [id, stop] of stops) {
    if (id !== activeId) {
      try {
        stop();
      } catch {
        /* ignore */
      }
    }
  }
}
