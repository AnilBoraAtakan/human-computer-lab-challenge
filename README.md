# Luma

A curious desk lamp that notices attention, speaks, remembers objects, and checks the scene again after acting. The body uses the supplied five-joint URDF and STL. Its light and movement are simulated; its camera and microphone are real.

## Run on Ubuntu 24.04

Use Node.js **24 or newer** and a current Chrome/Chromium browser with WebGL2 enabled. Install Node from [nodejs.org](https://nodejs.org/en/download) if `node --version` is older; Ubuntu's default Node package may be too old. No Python, ROS, CUDA, or discrete GPU is required.

```sh
sudo apt update
sudo apt install espeak-ng
npm ci
npm run setup
cp .env.example .env
```

Create a [Gemini API key](https://aistudio.google.com/apikey), then edit `.env` locally:

```dotenv
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-3.5-flash-lite
PORT=3000
```

```sh
npm start
```

Open **http://localhost:3000** on the same laptop. Click **Start session** and allow the camera; allow the microphone when recording for the first time. The server binds to loopback only. `npm run dev` restarts it after server edits; restart manually after changing `.env`.

The model download is approximately 3.6 MB; npm dependencies are approximately 73 MB on the development machine. Internet is needed for installation and Gemini requests. Account quotas and model availability vary; check [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). ChatGPT Plus does not supply an API key for this application. Keep `.env` out of Git.

On macOS the application uses the built-in `say` command. On Ubuntu it generates speech with `espeak-ng` and plays it through the browser's selected speaker. A browser voice is a fallback if local synthesis is unavailable.

## Continuous demonstration

Keep one session open so observations remain available.

1. **Engage:** face the camera for a second. Luma turns, brightens, chimes, and greets you. Look away for two seconds; it dims and settles when idle.
2. **Remember:** hold up a distinct object. Click the microphone, wait for **Listening**, say “Remember this blue mug,” then click again. A memory card should record what the camera actually sees. Wait for the reply to finish.
3. **Recall:** remove the object and ask aloud “What color was the mug I showed you?” Luma should distinguish memory from current sight.
4. **Act and check:** show it again and say “Find the mug, look toward it, then check whether it is still there.” Watch **Observe → Act → Check**. Removing the object during motion should produce a missing or uncertain result after the new camera observation.
5. **Celebrate:** say “Play a little music and celebrate.” Luma sways with a short synthesized melody.

Microphone recording is click-to-start/click-to-send, capped at 15 seconds. Typed prompts are useful for isolating vision from speech problems. **Test movement** runs a clearly labeled local body preview. **Stop** freezes movement, stops audio, and releases camera/microphone. **Pause session** also releases devices and gently settles the body. Hiding the tab pauses sensing.

## Verification and troubleshooting

```sh
npm test
npm run check
npm run format:check
npm audit --omit=dev
```

Tests cover joint bounds and trajectory limits, attention hysteresis, memory retention, fresh-frame ordering, cancellation, malformed model output, and provider overload/quota handling. Provider calls in unit/integration tests are mocked; these tests do not prove live perception quality.

- **Key needed:** edit `.env`, restart the server, then reload the page.
- **Quota / provider busy / timeout:** the UI reports the failure without marking a goal complete. Wait and retry; use the model configured in `.env`. Camera attention and movement preview remain local.
- **Camera/mic denied:** check localhost permissions and the selected OS input device. Close other applications holding the camera. If using a Snap-packaged browser, check its camera/audio permissions too.
- **Attention unavailable:** run `npm run setup`, reload, and use Chrome/Chromium. A face must be large enough and approximately frontal; this is a head-orientation heuristic, not calibrated eye gaze.
- **No voice:** install `espeak-ng`, check OS/browser sound output, and keep **Voice on** checked.
- **Session expired after restart:** reload the page. Memory is deliberately in-process and does not survive a restart or reload.

**Under the shade → Export session measurements** downloads timing, engagement-event, FPS, and server-resource diagnostics. It excludes images, audio, transcripts, and object descriptions. See the [two-page technical note](docs/TECHNICAL_NOTE.pdf) ([Markdown source](docs/TECHNICAL_NOTE.md)) for measured results and limitations.

## Design and data

- `public/`: interface, robot controller, local attention worker, audio and camera orchestration.
- `server.js`, `src/`: validated interaction protocol, Gemini adapter, local speech, bounded session memory.
- `tests/`: deterministic regression tests; `scripts/setup.mjs`: local model installation.
- `docs/`: original challenge requirements and technical note.

Attention frames stay on-device. A request sends one JPEG snapshot, the utterance, and bounded text memory/history to Gemini. A goal sends a second snapshot after execution. Recorded microphone clips go to Gemini for transcription. There is no continuous cloud video stream. The server retains text memory in RAM and does not save camera/audio recordings; macOS speech output uses a temporary WAV removed after reading. **Clear** deletes the session's memory and conversation.

## Attribution and scope

Robot URDF/STL/image: supplied challenge assets. Rendering: [Three.js](https://threejs.org/) and [URDFLoader](https://github.com/gkjohnson/urdf-loaders). Local perception: [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker). Cloud perception: [Gemini API](https://ai.google.dev/gemini-api/docs). Speech: [eSpeak NG](https://github.com/espeak-ng/espeak-ng) or macOS system voice. Sound effects and melody are generated with Web Audio; no external audio assets are used. Dependencies retain their upstream licenses. AI-assisted coding was used; architecture choices, validation, and limitations are documented for review.

This is a time-boxed kinematic prototype. Dynamics, collision avoidance, calibrated camera-to-robot geometry, persistent identity-aware memory, wake-word detection, and offline language/vision are intentionally outside scope.
