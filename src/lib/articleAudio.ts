// Singleton audio player for per-article "Listen" buttons.
// Only one article plays at a time; subscribers can render play/pause state.

import { registerAudioSource, stopOtherSources } from "./audioBus";

type Listener = (state: { id: string | null; playing: boolean }) => void;

const AUDIO_SOURCE_ID = "article";
const audio = typeof Audio !== "undefined" ? new Audio() : null;
let currentId: string | null = null;
const listeners = new Set<Listener>();

function emit() {
  const state = { id: currentId, playing: !!audio && !audio.paused && currentId !== null };
  for (const l of listeners) l(state);
}

if (audio) {
  audio.addEventListener("play", emit);
  audio.addEventListener("pause", emit);
  audio.addEventListener("ended", () => {
    currentId = null;
    emit();
  });
  audio.addEventListener("error", () => {
    currentId = null;
    emit();
  });

  registerAudioSource(AUDIO_SOURCE_ID, () => {
    if (!audio.paused) audio.pause();
    currentId = null;
    emit();
  });
}

export function subscribeArticleAudio(fn: Listener): () => void {
  listeners.add(fn);
  fn({ id: currentId, playing: !!audio && !audio.paused && currentId !== null });
  return () => listeners.delete(fn);
}

export function toggleArticleAudio(id: string, url: string) {
  if (!audio) return;
  if (currentId === id) {
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
    return;
  }
  audio.pause();
  audio.src = url;
  currentId = id;
  stopOtherSources(AUDIO_SOURCE_ID);
  void audio.play().catch(() => {
    currentId = null;
    emit();
  });
  emit();
}

export function stopArticleAudio() {
  if (!audio) return;
  audio.pause();
  currentId = null;
  emit();
}
