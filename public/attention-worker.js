let detector;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      // A classic worker allows MediaPipe's WASM loader to use importScripts.
      const { FaceLandmarker, FilesetResolver } = await import(
        "/vendor/mediapipe/vision_bundle.mjs"
      );
      const files = await FilesetResolver.forVisionTasks(
        "/vendor/mediapipe/wasm",
      );
      detector = await FaceLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/models/face_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: error.message });
    }
  } else if (data.type === "frame") {
    const start = performance.now();
    try {
      const result = detector.detectForVideo(data.bitmap, data.timestamp);
      const face = result.faceLandmarks[0];
      let observation = { present: false, facing: false };
      if (face) {
        const left = face[33],
          right = face[263],
          nose = face[1],
          chin = face[152],
          top = face[10];
        const span = Math.abs(right.x - left.x);
        const offset =
          Math.abs(nose.x - (left.x + right.x) / 2) / Math.max(span, 0.01);
        const vertical = (nose.y - top.y) / Math.max(chin.y - top.y, 0.01);
        observation = {
          present: true,
          facing:
            span > 0.06 && offset < 0.32 && vertical > 0.3 && vertical < 0.82,
          x: nose.x,
          y: nose.y,
          yaw_proxy: offset,
        };
      }
      self.postMessage({
        type: "observation",
        ...observation,
        duration_ms: performance.now() - start,
      });
    } catch (error) {
      self.postMessage({ type: "error", message: error.message });
    } finally {
      data.bitmap.close();
    }
  }
};
