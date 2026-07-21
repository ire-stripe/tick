import { useEffect, useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Language } from "@/lib/regions";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { AudioProgressBar } from "@/components/AudioProgressBar";
import { loadSettings } from "@/lib/userSettings";

type Voice = "female" | "male";

type Episode = {
  audio_url: string | null;
  male_audio_url: string | null;
  date: string;
  duration_seconds: number | null;
  script: string | null;
  language_code: string;
};

interface Props {
  episodes: Episode[];
  languages?: Language[];
  regionId: string;
  regionName: string;
  regionFlags: string;
}

function fmt(t: number) {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const AudioPlayer = ({ episodes, languages, regionId, regionName, regionFlags }: Props) => {
  const langs = languages && languages.length > 0 ? languages : [{ code: "en", label: "EN" }];
  const player = useAudioPlayer();

  const [lang, setLang] = useState<string>(() => {
    if (player.episode && player.episode.regionId === regionId) return player.episode.languageCode;
    const prefs = loadSettings();
    if (prefs.language === "local") {
      const local = langs.find((l) => l.code !== "en");
      if (local) return local.code;
    }
    return langs[0].code;
  });

  useEffect(() => {
    if (player.episode && player.episode.regionId === regionId) {
      setLang(player.episode.languageCode);
    } else {
      const prefs = loadSettings();
      if (prefs.language === "local") {
        const local = langs.find((l) => l.code !== "en");
        setLang(local ? local.code : langs[0].code);
      } else {
        setLang(langs[0].code);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId]);

  // IMPORTANT: do NOT fall back across languages here. If the selected language
  // has no episode row, we intentionally return null so the UI can show
  // "Audio unavailable" (or the script) rather than silently playing the EN one.
  const episode = useMemo<Episode | null>(() => {
    if (!episodes || episodes.length === 0) return null;
    return episodes.find((e) => e.language_code === lang) ?? null;
  }, [episodes, lang]);

  const femaleUrl = episode?.audio_url ?? null;
  const maleUrl = episode?.male_audio_url ?? null;
  const script = episode?.script ?? null;
  const date = episode?.date ?? new Date().toISOString();
  const durationHint = episode?.duration_seconds ?? null;

  const [voice, setVoiceState] = useState<Voice>(() => loadSettings().voice);
  const setVoice = (v: Voice) => {
    if (v === voice) return;
    if (v === "male" && !maleUrl) return; // not available yet
    setVoiceState(v);
  };

  // Voice fallback within the same language is fine (male → female).
  const audioUrl = voice === "male" ? (maleUrl ?? femaleUrl) : (femaleUrl ?? maleUrl);
  const effectiveVoice: Voice = voice === "male" && maleUrl ? "male" : "female";


  const isActive = !!(
    player.episode &&
    audioUrl &&
    player.episode.regionId === regionId &&
    episode &&
    player.episode.languageCode === episode.language_code &&
    player.episode.audioUrl === audioUrl
  );
  const currentTime = isActive ? player.currentTime : 0;
  const total = isActive ? player.duration || durationHint || 0 : durationHint || 0;
  const playing = isActive && player.playing;

  // If the resolved URL changes while this episode is the active one (voice toggle mid-play), keep playing.
  useEffect(() => {
    if (!audioUrl || !episode) return;
    if (
      player.episode &&
      player.episode.regionId === regionId &&
      player.episode.languageCode === episode.language_code &&
      player.episode.audioUrl !== audioUrl
    ) {
      player.play({
        audioUrl, regionId, regionName, regionFlags,
        languageCode: episode.language_code, date: episode.date, duration: episode.duration_seconds,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  const toggle = () => {
    if (!audioUrl || !episode) return;
    if (isActive) {
      player.toggle();
    } else {
      player.play({
        audioUrl,
        regionId,
        regionName,
        regionFlags,
        languageCode: episode.language_code,
        date: episode.date,
        duration: episode.duration_seconds,
      });
    }
  };

  const ordinal = (n: number) => {
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  };
  const _d = new Date(date);
  const _weekday = _d.toLocaleDateString(undefined, { weekday: "long" });
  const _month = _d.toLocaleDateString(undefined, { month: "short" });
  const dateLabel = `${_weekday} ${ordinal(_d.getDate())} ${_month}`;

  const displayScript = script?.replace(/\[pause\]/gi, "").replace(/\n{2,}/g, "\n\n").trim();

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setTranscriptOpen(false);
    setCopied(false);
  }, [regionId, lang]);
  const copyTranscript = async () => {
    if (!displayScript) return;
    try {
      await navigator.clipboard.writeText(displayScript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const pillClass = (active: boolean, disabled = false) =>
    "px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider border transition-colors " +
    (disabled
      ? "bg-transparent text-muted-foreground/40 border-white/10 cursor-not-allowed"
      : active
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-transparent text-muted-foreground border-white/15 hover:text-foreground hover:border-white/30");

  const maleDisabled = !maleUrl;

  return (
    <div className="glass rounded-2xl p-6 md:p-8">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
        🎙️ Morning Brief
      </div>
      <h2 className="text-xl md:text-2xl font-bold mb-3">{dateLabel}</h2>

      <div className="flex items-center gap-2 mb-5">
        {langs.length > 1 && (
          <div className="flex gap-1.5">
            {langs.map((l) => (
              <button key={l.code} onClick={() => setLang(l.code)} className={pillClass(lang === l.code)}>
                {l.label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => setVoice("female")}
            className={pillClass(effectiveVoice === "female")}
          >
            Female
          </button>
          <button
            type="button"
            onClick={() => setVoice("male")}
            disabled={maleDisabled}
            title={maleDisabled ? "Available tomorrow" : undefined}
            aria-disabled={maleDisabled}
            className={pillClass(effectiveVoice === "male", maleDisabled)}
          >
            Male
          </button>
        </div>
      </div>


      {audioUrl ? (
        <div className="flex items-center gap-5">
          <button
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="h-14 w-14 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform"
          >
            {playing ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <AudioProgressBar
              currentTime={currentTime}
              duration={total}
              onSeek={(t) => {
                if (isActive) player.seek(t);
              }}
            />
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
              <span>{fmt(currentTime)} / {fmt(total || 0)}</span>
              <div className="flex gap-1">
                {[1, 1.5, 2].map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={player.speed === r ? "default" : "ghost"}
                    className="h-6 px-2 text-[10px]"
                    onClick={() => player.setSpeed(r)}
                  >
                    {r}x
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : displayScript ? (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
            Read the briefing (audio unavailable)
          </div>
          <div className="max-h-72 overflow-y-auto pr-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {displayScript}
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          Brief unavailable — not enough stories today.
        </div>
      )}

      {audioUrl && displayScript && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {transcriptOpen ? "Hide transcript" : "Show transcript"}
          </button>
          {transcriptOpen && (
            <div className="mt-3 relative rounded-lg bg-white/[0.03] border border-white/5 p-3 pr-10">
              <button
                type="button"
                onClick={copyTranscript}
                aria-label="Copy transcript"
                className="absolute top-2 right-2 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                title={copied ? "Copied!" : "Copy transcript"}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              {copied && (
                <div className="absolute top-10 right-2 text-[10px] px-1.5 py-0.5 rounded bg-foreground text-background">
                  Copied!
                </div>
              )}
              <div
                className="max-h-[300px] overflow-y-auto text-muted-foreground whitespace-pre-wrap"
                style={{ fontSize: 14, lineHeight: 1.6 }}
              >
                {displayScript}
              </div>
            </div>
          )}
        </div>
      )}
    </div>

  );
};
