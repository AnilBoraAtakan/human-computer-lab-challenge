import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const run = promisify(execFile);

export async function localSpeech(text) {
  if (process.platform === "darwin") {
    const dir = await mkdtemp(join(tmpdir(), "luma-voice-"));
    try {
      const path = join(dir, "speech.wav");
      await run(
        "/usr/bin/say",
        [
          "-v",
          "Samantha",
          "--file-format=WAVE",
          "--data-format=LEI16@22050",
          "-o",
          path,
          text,
        ],
        { timeout: 15000 },
      );
      return await readFile(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  try {
    const { stdout } = await run(
      "espeak-ng",
      ["--stdout", "-v", "en-us", "-s", "165", "--", text],
      { encoding: "buffer", maxBuffer: 8 * 1024 * 1024, timeout: 15000 },
    );
    return stdout;
  } catch (error) {
    throw Object.assign(
      new Error(
        error.code === "ENOENT"
          ? "Local voice is missing. Install espeak-ng (sudo apt install espeak-ng), or use browser voice."
          : "Local speech generation failed.",
      ),
      { status: 503 },
    );
  }
}
