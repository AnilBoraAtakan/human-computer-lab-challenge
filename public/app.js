import { LampBody } from "./robot.js";
import { AttentionGate, HOME, REST, orientPose } from "./control.js";

const $ = (id) => document.getElementById(id);
const video = $("camera");
const gate = new AttentionGate();
let sessionId,
  config,
  body,
  cameraStream,
  micStream,
  worker,
  detectorReady = false,
  detectionPending = false;
let busy = false,
  started = false,
  recording = false,
  recorder,
  recordingTimer,
  workerTimer,
  statusTimer;
let generation = 0,
  controller,
  playingAudio,
  speechResolve,
  audioContext,
  lastGreeting = -Infinity;
let latestFace = null,
  lastDetectionAt = 0,
  attentionMs = [],
  turnMeasurements = [],
  events = [],
  audioNodes = [];
let memory = [],
  state = "resting",
  sessionStartedAt = new Date().toISOString();
const labels = {
  resting: "Resting",
  ready: "With you",
  listening: "Listening",
  thinking: "Thinking",
  acting: "Moving with intention",
  checking: "Taking another look",
  speaking: "Speaking",
  paused: "Paused",
};
const copy = {
  resting: [
    "A QUIET MOMENT",
    "I’m here when you are.",
    "Look toward the camera when you’d like to connect.",
  ],
  ready: [
    "I SEE YOU",
    "You have my attention.",
    "Show me an object, or tell me what’s on your mind.",
  ],
  listening: [
    "ALL EARS",
    "Go on, I’m listening.",
    "Click the microphone again when you’re done.",
  ],
  thinking: [
    "CONNECTING THE DOTS",
    "Let me take a look…",
    "Making sense of your words and the scene.",
  ],
  acting: [
    "A LITTLE INTENTION",
    "Let’s look a little closer.",
    "A small movement, with a reason behind it.",
  ],
  checking: [
    "ONE MORE LOOK",
    "Has anything changed?",
    "Checking a fresh camera frame after moving.",
  ],
  speaking: [
    "A THOUGHT TO SHARE",
    "Here’s what I noticed.",
    "A little observation, just for you.",
  ],
  paused: [
    "TAKING A BREATHER",
    "Everything is still.",
    "Start a new session whenever you’re ready.",
  ],
};

function setState(next) {
  state = next;
  $("state-label").textContent = labels[next];
  const [kicker, title, description] = copy[next];
  $("stage-kicker").textContent = kicker;
  $("caption").textContent = title;
  $("caption-detail").textContent = description;
  $("state-dot").style.background =
    {
      ready: "#b6d997",
      listening: "#f4bd90",
      thinking: "#9bc5f0",
      checking: "#9bc5f0",
      paused: "#a29f91",
    }[next] || "#cfbd90";
}
function notice(text = "", error = false) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
  $("notice").classList.toggle("error", error);
}
function message(role, text) {
  $("conversation").querySelector(".conversation-empty")?.remove();
  const row = document.createElement("div");
  row.className = `message-row ${role}`;
  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "YOU" : "✳";
  const content = document.createElement("div");
  content.className = "message-content";
  const label = document.createElement("small");
  label.textContent = role === "user" ? "YOU" : "LUMA";
  const textEl = document.createElement("p");
  textEl.textContent = text;
  content.append(label, textEl);
  row.append(avatar, content);
  $("conversation").append(row);
  while ($("conversation").children.length > 40)
    $("conversation").firstChild.remove();
  $("conversation").scrollTop = $("conversation").scrollHeight;
}
function activity(title, detail = "") {
  $("activity").querySelector(".activity-empty")?.remove();
  const row = document.createElement("div");
  row.className = "activity-item";
  const dot = document.createElement("span");
  dot.className = "activity-dot";
  const text = document.createElement("p"),
    strong = document.createElement("strong");
  strong.textContent = title;
  text.append(strong);
  if (detail) text.append(document.createTextNode(` · ${detail}`));
  const time = document.createElement("small");
  time.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  row.append(dot, text, time);
  $("activity").prepend(row);
  while ($("activity").children.length > 20) $("activity").lastChild.remove();
  // No camera frames, speech recordings, object descriptions, or utterances in exported metrics.
  events.push({ event: title, at: Date.now() });
  events = events.slice(-100);
}
function updateMemory(items) {
  memory = items;
  $("memory-count").textContent = items.length;
  $("memory").replaceChildren();
  if (!items.length) {
    const div = document.createElement("div");
    div.className = "empty-memory";
    div.innerHTML =
      "<span>◈</span><p>Every object has a little story.</p><small>Show me something and ask me to remember it.</small>";
    $("memory").append(div);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "memory-item";
    const icon = document.createElement("span");
    icon.className = "object-icon";
    icon.textContent = "◈";
    const content = document.createElement("div");
    content.className = "object-content";
    const title = document.createElement("strong");
    title.textContent = item.label;
    const description = document.createElement("p");
    description.textContent = item.description;
    const time = document.createElement("small");
    time.textContent = `Observed ${new Date(item.last_seen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${item.observations} sighting${item.observations === 1 ? "" : "s"}`;
    content.append(title, description, time);
    row.append(icon, content);
    $("memory").append(row);
  }
}
async function api(path, data, signal) {
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers:
      data instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
    signal,
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(failure.error || `Request failed (${response.status}).`);
  }
  return response.json();
}
function controls() {
  const ready = body?.ready && sessionId;
  $("start").disabled = !ready || (busy && !started);
  $("stop").disabled = !ready;
  $("forget").disabled = !ready;
  $("send").disabled = busy || recording || !body?.ready;
  $("microphone").disabled = (busy && !recording) || !body?.ready;
  $("preview").disabled = busy || recording || !body?.ready;
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.disabled = busy || recording || !ready;
  });
}
function sound(kind) {
  if (!$("voice").checked) return;
  audioContext ??= new AudioContext();
  audioContext.resume();
  const notes =
    kind === "music"
      ? [
          [261.63, 0, 0.22],
          [329.63, 0.2, 0.22],
          [392, 0.4, 0.3],
          [523.25, 0.7, 0.42],
          [392, 1.2, 0.22],
          [523.25, 1.45, 0.6],
        ]
      : [
          [523.25, 0, 0.15],
          [659.25, 0.14, 0.25],
        ];
  const start = audioContext.currentTime;
  for (const [frequency, delay, duration] of notes) {
    const osc = audioContext.createOscillator(),
      gain = audioContext.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start + delay);
    gain.gain.linearRampToValueAtTime(0.045, start + delay + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + delay + duration);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(start + delay);
    osc.stop(start + delay + duration + 0.02);
    audioNodes.push(osc);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      audioNodes = audioNodes.filter((node) => node !== osc);
    };
  }
}
function stopVoice() {
  if (playingAudio) {
    playingAudio.pause();
    playingAudio = null;
  }
  speechSynthesis.cancel();
  speechResolve?.();
  speechResolve = null;
  for (const node of audioNodes) {
    try {
      node.stop();
    } catch {
      /* Already ended. */
    }
  }
  audioNodes = [];
}
async function speak(text, token, signal) {
  if (!$("voice").checked || token !== generation) return;
  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!response.ok) throw new Error("Local voice is unavailable.");
    const blob = await response.blob();
    if (token !== generation) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    playingAudio = audio;
    try {
      await new Promise((resolve, reject) => {
        let timeout;
        const finish = (error) => {
          clearTimeout(timeout);
          audio.onended = null;
          audio.onerror = null;
          if (speechResolve === finish) speechResolve = null;
          error ? reject(error) : resolve();
        };
        speechResolve = finish;
        audio.onended = () => finish();
        audio.onerror = () => finish(new Error("Audio playback failed."));
        timeout = setTimeout(() => {
          audio.pause();
          finish();
        }, 25000);
        audio.play().catch(finish);
      });
    } finally {
      URL.revokeObjectURL(url);
      if (playingAudio === audio) playingAudio = null;
    }
  } catch (error) {
    if (token !== generation || error.name === "AbortError") return;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) {
      notice(
        "Voice output is unavailable. Install espeak-ng on Ubuntu or enable a browser voice.",
        true,
      );
      return;
    }
    await new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.04;
      const timeout = setTimeout(resolve, 22000);
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      utterance.onend = done;
      utterance.onerror = done;
      speechResolve = done;
      speechSynthesis.speak(utterance);
    });
    activity("Browser voice fallback");
  }
}
function capture() {
  if (!started || !video.videoWidth || video.readyState < 2) return null;
  const canvas = document.createElement("canvas");
  const scale = Math.min(
    1,
    480 / Math.max(video.videoWidth, video.videoHeight),
  );
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return {
    image: canvas.toDataURL("image/jpeg", 0.65),
    captured_at: Date.now(),
  };
}
function assertCurrent(token) {
  if (token !== generation) throw new DOMException("Cancelled", "AbortError");
}
function settle() {
  setState(started && gate.engaged ? "ready" : started ? "resting" : "paused");
  if (!gate.engaged) {
    body.light(0.18);
    body.move(REST, 0.7);
  }
}
async function runTurn(text) {
  if (busy || recording || !text.trim()) return;
  if (!config?.configured) {
    notice(
      "Add your Gemini API key to the local .env file and restart the server. The robot and local attention can already be tested.",
      true,
    );
    return;
  }
  busy = true;
  const token = ++generation;
  controller = new AbortController();
  controls();
  notice();
  stopVoice();
  body.stop();
  const start = performance.now();
  let firstReplyMs;
  message("user", text);
  $("message").value = "";
  setState("thinking");
  body.light(0.5, "blue");
  activity(
    "Observing",
    started ? "Fresh camera snapshot" : "Text and prior memory only",
  );
  try {
    const plan = await api(
      "/api/turn",
      { session_id: sessionId, text, frame: capture() },
      controller.signal,
    );
    assertCurrent(token);
    firstReplyMs = Math.round(performance.now() - start);
    message("assistant", plan.reply);
    updateMemory(plan.memory);
    activity("Plan received", plan.evidence);
    setState("acting");
    const [executed] = await Promise.all([
      body.execute(plan.actions, {
        sound,
        onAction: (action, i) =>
          activity(
            `Action ${i + 1}: ${action.type}`,
            action.type === "orient"
              ? `image position ${action.x.toFixed(2)}, ${action.y.toFixed(2)}`
              : action.color,
          ),
      }),
      speak(plan.reply, token, controller.signal),
    ]);
    assertCurrent(token);
    if (!executed) throw new DOMException("Cancelled", "AbortError");
    if (plan.requires_verification) {
      const completedAt = Date.now();
      setState("checking");
      body.light(0.5, "blue");
      // Wait for a camera frame after execution, not a reused video buffer.
      await freshVideoFrame(controller.signal);
      assertCurrent(token);
      const frame = capture();
      if (!frame)
        throw new Error(
          "Camera unavailable for the required fresh observation. Goal remains unverified.",
        );
      activity("Fresh check", "Camera sampled after the action sequence");
      const result = await api(
        "/api/verify",
        {
          session_id: sessionId,
          turn_id: plan.turn_id,
          completed_at: completedAt,
          frame,
        },
        controller.signal,
      );
      assertCurrent(token);
      updateMemory(result.memory);
      message("assistant", result.reply);
      activity(`Goal ${result.status.replace("_", " ")}`, result.evidence);
      body.light(
        result.status === "confirmed" ? 0.8 : 0.45,
        result.status === "confirmed" ? "mint" : "warm",
      );
      setState("speaking");
      await speak(result.reply, token, controller.signal);
    }
    assertCurrent(token);
    const elapsed = Math.round(performance.now() - start);
    turnMeasurements.push({
      first_reply_ms: firstReplyMs,
      total_ms: elapsed,
      goal: plan.requires_verification,
      at: Date.now(),
    });
    $("turn-latency").textContent =
      `${(firstReplyMs / 1000).toFixed(1)}s to reply · ${(elapsed / 1000).toFixed(1)}s total`;
  } catch (error) {
    if (token === generation && error.name !== "AbortError") {
      notice(error.message, true);
      activity("Turn interrupted", error.message);
      await api("/api/cancel", { session_id: sessionId }).catch(() => {});
    }
  } finally {
    if (token === generation) {
      busy = false;
      controls();
      settle();
    }
  }
}
function freshVideoFrame(signal) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let id;
    const finish = (error) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (id != null) video.cancelVideoFrameCallback?.(id);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timeout = setTimeout(
      () =>
        finish(
          new Error("No fresh camera frame arrived. Goal remains unverified."),
        ),
      3000,
    );
    signal.addEventListener("abort", abort, { once: true });
    const next = () => {
      if (Date.now() <= start) {
        id = video.requestVideoFrameCallback(next);
      } else finish();
    };
    if (video.requestVideoFrameCallback)
      id = video.requestVideoFrameCallback(next);
    else setTimeout(() => finish(), 200);
  });
}
async function engage() {
  if (busy || recording || !started) return;
  body.stop();
  body.light(0.75, "warm");
  body.move(orientPose(latestFace?.x ?? 0.5, 0.5), 0.7);
  setState("ready");
  if (performance.now() - lastGreeting < 18000) return;
  lastGreeting = performance.now();
  sound("greeting");
  activity("Connected", "Sustained attention");
  const text = "Oh, hello! Show me something. I’d love to take a look.";
  message("assistant", text);
  busy = true;
  controls();
  const token = ++generation;
  controller = new AbortController();
  try {
    await speak(text, token, controller.signal);
  } finally {
    if (token === generation) {
      busy = false;
      controls();
      settle();
    }
  }
}
function handleObservation(data) {
  detectionPending = false;
  latestFace = data;
  lastDetectionAt = performance.now();
  attentionMs.push(data.duration_ms);
  attentionMs = attentionMs.slice(-300);
  $("vision-ms").textContent = `${Math.round(data.duration_ms)} ms`;
  $("face-time").textContent = `${Math.round(data.duration_ms)} ms`;
  $("attention-label").textContent = data.facing
    ? "Facing me"
    : data.present
      ? "Looking elsewhere"
      : "Looking for you";
  const transition = gate.update(data.facing, performance.now());
  if (transition === "engage") engage();
  if (transition === "disengage") {
    activity("Attention moved away");
    if (!busy && !recording) {
      body.stop();
      body.light(0.18);
      body.move(REST, 0.8);
      setState("resting");
    }
  }
}
async function startCamera() {
  if (started) {
    await pause();
    return;
  }
  $("start").disabled = true;
  const token = generation;
  notice();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15, max: 20 },
      },
      audio: false,
    });
    assertCurrent(token);
    video.srcObject = cameraStream;
    await video.play();
    started = true;
    gate.reset();
    video.classList.add("active");
    $("camera-placeholder").hidden = true;
    $("attention-label").hidden = false;
    $("camera-status").textContent = "LIVE · ON DEVICE";
    $("start").textContent = "Pause session";
    setState("resting");
    activity("Camera connected", "Attention stays local");
    audioContext ??= new AudioContext();
    await audioContext.resume();
    if (!worker) {
      worker = new Worker("/attention-worker.js");
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          detectorReady = true;
          activity("Attention ready", "Local face landmarks");
        }
        if (data.type === "observation" && started) handleObservation(data);
        if (data.type === "error") {
          detectionPending = false;
          detectorReady = false;
          notice(
            `Attention tracking is unavailable: ${data.message}. Camera snapshots and conversation still work.`,
            true,
          );
          $("attention-label").textContent = "Attention unavailable";
        }
      };
      worker.onerror = () => {
        notice(
          "Attention worker failed. Run npm run setup and reload in Chrome.",
          true,
        );
        detectorReady = false;
      };
      worker.postMessage({ type: "init" });
    }
    clearInterval(workerTimer);
    workerTimer = setInterval(async () => {
      if (started && performance.now() - lastDetectionAt > 2000) {
        const transition = gate.update(false, performance.now());
        if (transition === "disengage" && !busy && !recording) settle();
      }
      if (
        !started ||
        !detectorReady ||
        detectionPending ||
        video.readyState < 2 ||
        document.hidden
      )
        return;
      detectionPending = true;
      try {
        const bitmap = await createImageBitmap(video);
        worker.postMessage(
          { type: "frame", bitmap, timestamp: performance.now() },
          [bitmap],
        );
      } catch {
        detectionPending = false;
      }
    }, 170);
  } catch (error) {
    if (error.name !== "AbortError")
      notice(
        `Camera could not start: ${error.message}. Allow camera access for localhost in your browser.`,
        true,
      );
    cameraStream?.getTracks().forEach((track) => track.stop());
    started = false;
  } finally {
    $("start").disabled = false;
  }
}
async function cancelTurn() {
  generation++;
  controller?.abort();
  body?.stop();
  stopVoice();
  if (recording) stopRecording(false);
  busy = false;
  controls();
  if (sessionId)
    await api("/api/cancel", { session_id: sessionId }).catch(() => {});
}
async function pause({ settleBody = true } = {}) {
  const cancelled = cancelTurn();
  started = false;
  clearInterval(workerTimer);
  detectionPending = false;
  gate.reset();
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.srcObject = null;
  video.classList.remove("active");
  $("camera-placeholder").hidden = false;
  $("attention-label").hidden = true;
  $("camera-status").textContent = "CAMERA OFF";
  $("start").textContent = "Start session";
  body.light(0.15);
  if (settleBody) body.move(REST, 0.8);
  setState("paused");
  activity("Session paused", "Camera and microphone released");
  await cancelled;
}
async function toggleRecording() {
  if (recording) {
    stopRecording(true);
    return;
  }
  if (busy) return;
  if (!config?.configured) {
    notice(
      "Speech recognition needs a configured API key. Add it to .env and restart the server.",
      true,
    );
    return;
  }
  const token = ++generation;
  busy = true;
  controls();
  try {
    notice();
    stopVoice();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    assertCurrent(token);
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
      (value) => MediaRecorder.isTypeSupported(value),
    );
    recorder = new MediaRecorder(
      micStream,
      type ? { mimeType: type } : undefined,
    );
    const recordingStream = micStream;
    const chunks = [];
    const currentRecorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      recordingStream.getTracks().forEach((track) => track.stop());
      if (micStream === recordingStream) micStream = null;
      if (!currentRecorder.sendResult || token !== generation) return;
      busy = true;
      controls();
      setState("thinking");
      $("input-hint").textContent = "Transcribing your words…";
      controller = new AbortController();
      try {
        const audio = new Blob(chunks, {
          type: currentRecorder.mimeType.split(";")[0],
        });
        const form = new FormData();
        form.append("audio", audio, "recording.webm");
        const result = await api("/api/transcribe", form, controller.signal);
        assertCurrent(token);
        busy = false;
        if (!result.text.trim()) {
          notice(
            "I didn’t catch any words. Please try speaking a little closer to the microphone.",
          );
          settle();
        } else {
          activity(
            "Heard you",
            `${(result.latency_ms / 1000).toFixed(1)}s transcription`,
          );
          await runTurn(result.text);
        }
      } catch (error) {
        if (token === generation && error.name !== "AbortError") {
          notice(error.message, true);
          busy = false;
          settle();
        }
      } finally {
        controls();
        $("input-hint").textContent =
          "Click the microphone to speak. Click again to send.";
      }
    };
    recorder.start();
    busy = false;
    recording = true;
    setState("listening");
    body.light(0.75, "warm");
    body.move(HOME, 0.5);
    $("microphone").classList.add("recording");
    $("microphone").setAttribute("aria-label", "Stop recording and send");
    $("input-hint").textContent =
      "Listening… click the microphone to send. Maximum 15 seconds.";
    controls();
    recordingTimer = setTimeout(() => stopRecording(true), 15000);
  } catch (error) {
    micStream?.getTracks().forEach((track) => track.stop());
    if (token === generation) {
      busy = false;
      controls();
      if (error.name !== "AbortError")
        notice(`Microphone could not start: ${error.message}`, true);
    }
  }
}
function stopRecording(send) {
  clearTimeout(recordingTimer);
  recording = false;
  busy = send;
  if (recorder?.state === "recording") {
    recorder.sendResult = send;
    recorder.stop();
  }
  $("microphone").classList.remove("recording");
  $("microphone").setAttribute("aria-label", "Start microphone recording");
  controls();
}
async function refreshStatus() {
  try {
    config = await api("/api/status");
    $("connection").textContent = config.configured
      ? "Gemini configured"
      : "Key needed";
    const dot = document.createElement("i");
    $("connection").prepend(dot);
    $("connection").classList.toggle("online", config.configured);
    $("rss").textContent = `${config.rss_mb} MB`;
  } catch {
    $("connection").textContent = "Server offline";
  }
}
async function init() {
  try {
    body = new LampBody($("stage"), ({ pose, fps }) => {
      $("fps").textContent = `${fps} fps`;
      $("joints").textContent = Object.entries(pose)
        .map(
          ([name, value]) =>
            `${name.replace("_joint", "")}: ${value.toFixed(2)} rad`,
        )
        .join(" · ");
    });
    await body.load();
    activity("Body ready", "Supplied URDF · bounded joint motion");
    ({ session_id: sessionId } = await api("/api/session", {}));
    await refreshStatus();
    controls();
    if (!config.configured)
      notice(
        "The lamp is ready to explore. Add a Gemini API key to .env and restart to enable live vision and conversation.",
      );
    statusTimer = setInterval(refreshStatus, 15000);
  } catch (error) {
    notice(error.message, true);
  }
}
$("start").onclick = startCamera;
$("stop").onclick = async () => {
  await pause({ settleBody: false });
  body.light(0.2);
  setState("paused");
  activity("Stopped", "Motion and audio cancelled");
};
$("voice").onchange = () => {
  if (!$("voice").checked) stopVoice();
  $("voice").nextElementSibling.textContent = $("voice").checked
    ? "Voice on"
    : "Voice off";
};
$("microphone").onclick = toggleRecording;
$("message-form").onsubmit = (e) => {
  e.preventDefault();
  runTurn($("message").value);
};
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.onclick = () => runTurn(button.dataset.prompt);
});
$("preview").onclick = async () => {
  busy = true;
  controls();
  const token = ++generation;
  body.stop();
  setState("acting");
  activity("Movement preview", "Manual test; no perception or memory");
  try {
    await body.execute(
      [
        {
          type: "orient",
          x: 0.3,
          y: 0.5,
          brightness: 0.8,
          color: "warm",
          duration_ms: 800,
        },
        { type: "nod" },
        { type: "celebrate" },
      ],
      { sound },
    );
  } finally {
    if (token === generation) {
      busy = false;
      controls();
      settle();
    }
  }
};
$("forget").onclick = async () => {
  await cancelTurn();
  if (sessionId) await fetch(`/api/session/${sessionId}`, { method: "DELETE" });
  ({ session_id: sessionId } = await api("/api/session", {}));
  updateMemory([]);
  $("conversation").replaceChildren();
  activity("Memory cleared", "Session observations and conversation removed");
  settle();
};
$("help").onclick = () => $("guide").showModal();
$("close-guide").onclick = () => $("guide").close();
$("export").onclick = async () => {
  const server = await api("/api/metrics").catch(() => null);
  const result = {
    session_started: sessionStartedAt,
    exported_at: new Date().toISOString(),
    user_agent: navigator.userAgent,
    cpu_threads: navigator.hardwareConcurrency,
    browser_memory_gb_hint: navigator.deviceMemory ?? null,
    provider: config?.provider,
    renderer_fps_latest: body.fps,
    attention_inference_ms: attentionMs,
    turns: turnMeasurements,
    events,
    server,
    caveat:
      "Observed development-machine measurements; not a controlled benchmark or Ubuntu certification. Engagement ground-truth trials must be recorded separately.",
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "luma-session-measurements.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && started) pause();
});
window.addEventListener("beforeunload", () => {
  cameraStream?.getTracks().forEach((t) => t.stop());
  micStream?.getTracks().forEach((t) => t.stop());
  worker?.terminate();
  clearInterval(statusTimer);
});
controls();
init();
