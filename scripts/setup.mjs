import { mkdir, access, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const url =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const path = new URL("../public/models/face_landmarker.task", import.meta.url);
await mkdir(new URL("../public/models/", import.meta.url), { recursive: true });
try {
  await access(path);
  console.log("Face landmarks model already installed.");
} catch {
  console.log("Downloading the local face landmarks model (~3.6 MB)…");
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path, bytes);
  console.log(
    `Installed ${bytes.length} bytes. SHA-256: ${createHash("sha256").update(bytes).digest("hex")}`,
  );
}
