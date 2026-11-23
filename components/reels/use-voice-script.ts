"use client";

import { useEffect, useRef, useState } from "react";
import type { ReelCutView } from "@/lib/reels/store";
import { speakableScript } from "@/lib/reels/voice-script";
import { patch } from "./shared";

const SAVE_AFTER_MS = 700;

async function requestScript(job: string, id: string, force: boolean): Promise<string> {
  const res = await fetch("/api/reels/voice-script", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, id, force }) });
  const json = (await res.json().catch(() => ({}))) as { script?: string; error?: string };
  if (!res.ok || !json.script) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.script;
}

/**
 * Cuts waiting for review get their AI voice script written once, in the background, one at a time.
 * Each cut is asked for once per page load; the server keeps the script, so it is never written twice.
 */
export function useWriteMissingScripts(cuts: ReelCutView[], onWritten: () => void): void {
  const asked = useRef(new Set<string>());
  const running = useRef(false);
  const waiting = cuts.filter((c) => (c.stage === "cut_review" || c.stage === "voiceover") && !c.voiceScript?.trim() && !asked.current.has(`${c.job}/${c.id}`));
  const signature = waiting.map((c) => `${c.job}/${c.id}`).join("|");
  useEffect(() => {
    if (!signature || running.current) return;
    running.current = true;
    void (async () => {
      for (const cut of waiting) {
        asked.current.add(`${cut.job}/${cut.id}`);
        await requestScript(cut.job, cut.id, false).then(onWritten, () => undefined);
      }
      running.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}

export interface VoiceScript {
  text: string;
  setText: (text: string) => void;
  writing: boolean;
  error: string | null;
  regenerate: () => void;
}

/**
 * The AI voice script for the cut that is open. It comes from the cut and stays put: choosing another
 * voice-over option does not touch it, the reviewer's edits are saved as they type, and only Regenerate
 * script writes a new one.
 */
export function useVoiceScript(cut: ReelCutView): VoiceScript {
  const [text, setTextState] = useState(cut.voiceScript ?? "");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touched = useRef(false);
  const unsaved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (unsaved.current === null) return;
    const voiceScript = unsaved.current;
    unsaved.current = null;
    void patch({ job: cut.job, id: cut.id, action: "save_voice_script", voiceScript }).catch(() => setError("Your changes to the script could not be saved."));
  };
  const setText = (next: string) => {
    touched.current = true;
    setTextState(next);
    unsaved.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_AFTER_MS);
  };

  const write = async (force: boolean) => {
    setError(null);
    setWriting(true);
    if (force) { if (timer.current) clearTimeout(timer.current); unsaved.current = null; }
    try {
      const script = await requestScript(cut.job, cut.id, force);
      // Anything typed while a first script was being written wins over it.
      if (force || !touched.current) setTextState(script);
    } catch (err) {
      setError(`The script could not be written: ${(err as Error).message}`);
      // Still give them the editor's draft to start from.
      if (!force && !touched.current) setTextState((t) => t || speakableScript(cut.script));
    } finally {
      setWriting(false);
    }
  };

  useEffect(() => {
    if (!cut.voiceScript?.trim()) void write(false);
    return save;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { text, setText, writing, error, regenerate: () => void write(true) };
}
