import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { registerAudioSource, stopOtherSources } from "@/lib/audioBus";

const BRIEF_SOURCE_ID = "brief";

export type PlayerEpisode = {
  audioUrl: string;
  regionId: string;
  regionName: string;
  regionFlags: string;
  languageCode: string;
  date: string;
  duration: number | null;
  voice?: "female" | "male";
};

type Ctx = {
  episode: PlayerEpisode | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  play: (ep: PlayerEpisode) => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  setSpeed: (r: number) => void;
  stop: () => void;
};

const AudioCtx = createContext<Ctx | null>(null);

export const AudioPlayerProvider = ({ children }: { children: ReactNode }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [episode, setEpisode] = useState<PlayerEpisode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeedState] = useState(1);

  if (!audioRef.current && typeof Audio !== "undefined") {
    const a = new Audio();
    a.preload = "metadata";
    audioRef.current = a;
  }

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrentTime(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    return registerAudioSource(BRIEF_SOURCE_ID, () => {
      const a = audioRef.current;
      if (a && !a.paused) a.pause();
    });
  }, []);

  const play: Ctx["play"] = (ep) => {
    const a = audioRef.current;
    if (!a) return;
    stopOtherSources(BRIEF_SOURCE_ID);
    if (!episode || episode.audioUrl !== ep.audioUrl) {
      a.src = ep.audioUrl;
      setDuration(ep.duration ?? 0);
      setCurrentTime(0);
    }
    setEpisode(ep);
    a.playbackRate = speed;
    void a.play();
  };

  const pause = () => audioRef.current?.pause();

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !episode) return;
    if (a.paused) {
      stopOtherSources(BRIEF_SOURCE_ID);
      void a.play();
    } else a.pause();
  };

  const seek = (t: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = t;
    setCurrentTime(t);
  };

  const setSpeed = (r: number) => {
    setSpeedState(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  };

  const stop = () => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    setEpisode(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  return (
    <AudioCtx.Provider
      value={{ episode, playing, currentTime, duration, speed, play, pause, toggle, seek, setSpeed, stop }}
    >
      {children}
    </AudioCtx.Provider>
  );
};

export const useAudioPlayer = () => {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
  return ctx;
};
