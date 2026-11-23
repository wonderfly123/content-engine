/**
 * AI voice-over: speaks a script in the reviewer's cloned voice with the local voice-clone tool
 * (Chatterbox, in the video folder's skill/voice-clone). Runs on this machine only, like the rest of reel review.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { jobsDir } from "./store";

/** Loading the model from the external drive alone can take a few minutes. */
const TIMEOUT_MS = 15 * 60 * 1000;

/** The voice-clone tool's folder: VOICE_CLONE_DIR, or skill/voice-clone beside the jobs folder. */
export function voiceCloneDir(): string {
  return process.env.VOICE_CLONE_DIR ?? path.join(path.dirname(jobsDir()), "skill", "voice-clone");
}

/** The recording the voice is cloned from, relative to the tool's folder unless absolute. */
function referencePath(dir: string): string {
  return path.resolve(dir, process.env.VOICE_CLONE_REF ?? path.join("refs", "jordan-a.wav"));
}

let running = false;

/** Speaks `text` and returns the audio as a WAV file's bytes. One at a time: the model is heavy. */
export async function generateVoiceover(text: string): Promise<Buffer> {
  const dir = voiceCloneDir();
  const python = path.join(dir, "venv", "bin", "python");
  const script = path.join(dir, "say.py");
  const ref = referencePath(dir);
  for (const file of [python, script, ref]) {
    try {
      await fs.access(file);
    } catch {
      throw new Error(`The voice tool is missing ${file}. Is the video drive plugged in?`);
    }
  }
  if (running) throw new Error("An AI voice-over is already being generated. Wait for it to finish.");
  running = true;
  const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ai-voice-")), "take.wav");
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(python, [script, ref, out, text], { cwd: dir, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
        if (!err) return resolve();
        const last = stderr.trim().split("\n").filter(Boolean).pop();
        reject(new Error(err.killed ? "The AI voice took too long and was stopped." : `The AI voice failed: ${last ?? err.message}`));
      });
    });
    return await fs.readFile(out);
  } finally {
    running = false;
    await fs.rm(path.dirname(out), { recursive: true, force: true });
  }
}
