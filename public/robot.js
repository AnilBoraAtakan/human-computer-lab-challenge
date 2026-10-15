import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import URDFLoader from "/vendor/urdf-loader/src/URDFLoader.js";
import {
  HOME,
  REST,
  COLORS,
  safePose,
  trajectorySeconds,
  interpolatePose,
  orientPose,
} from "./control.js";

export class LampBody {
  constructor(container, onTelemetry) {
    this.container = container;
    this.onTelemetry = onTelemetry;
    this.pose = { ...REST };
    this.limits = {};
    this.generation = 0;
    this.lightLevel = 0.18;
    this.targetLight = 0.18;
    this.lightColor = new THREE.Color(COLORS.warm);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#172425");
    this.scene.fog = new THREE.Fog("#172425", 3, 8);
    this.camera = new THREE.PerspectiveCamera(37, 1, 0.01, 30);
    this.camera.up.set(0, 0, 1);
    // The supplied head faces -X at its neutral yaw; meet it from the front.
    this.camera.position.set(-1.95, 0, 0.7);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D model of the supplied five-joint lamp",
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-0.08, 0, 0.34);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 3;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.enablePan = false;
    this.scene.add(new THREE.HemisphereLight("#ecfffb", "#283532", 2.1));
    const key = new THREE.DirectionalLight("#fff1d2", 3);
    key.position.set(-2, -3, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {
      left: -1.3,
      right: 1.3,
      top: 1.3,
      bottom: -1.3,
      near: 0.1,
      far: 8,
    });
    key.shadow.bias = -0.0006;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#a1d7cd", 2);
    rim.position.set(1, 2, 2);
    this.scene.add(rim);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: "#283936", roughness: 0.95 }),
    );
    floor.receiveShadow = true;
    floor.position.z = -0.008;
    this.scene.add(floor);
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.4, 0.022, 80),
      new THREE.MeshStandardMaterial({ color: "#43534c", roughness: 0.8 }),
    );
    platform.rotation.x = Math.PI / 2;
    platform.position.z = -0.018;
    platform.receiveShadow = true;
    this.scene.add(platform);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.41, 0.412, 100),
      new THREE.MeshBasicMaterial({
        color: "#657365",
        transparent: true,
        opacity: 0.5,
      }),
    );
    ring.position.z = -0.006;
    this.scene.add(ring);
    this.spot = new THREE.SpotLight(COLORS.warm, 5, 2.5, 0.65, 0.7, 1.5);
    this.scene.add(this.spot, this.spot.target);
    this.glow = new THREE.PointLight(COLORS.warm, 0.2, 0.5);
    this.scene.add(this.glow);
    this.resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width && height) {
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
    });
    this.resize.observe(container);
    this.last = performance.now();
    this.lastTelemetry = 0;
    this.frames = 0;
    this.fps = 0;
    this.renderer.setAnimationLoop((now) => this.tick(now));
  }
  async load() {
    const response = await fetch("/robot/dummy_lamp_5dof.urdf");
    if (!response.ok)
      throw new Error("Supplied robot model could not be loaded.");
    const xml = await response.text();
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    for (const joint of doc.querySelectorAll('joint[type="revolute"]')) {
      const hard = joint.querySelector("limit"),
        soft = joint.querySelector("safety_controller");
      this.limits[joint.getAttribute("name")] = {
        lower: Number(
          soft?.getAttribute("soft_lower_limit") ?? hard.getAttribute("lower"),
        ),
        upper: Number(
          soft?.getAttribute("soft_upper_limit") ?? hard.getAttribute("upper"),
        ),
        velocity: Number(hard.getAttribute("velocity")),
      };
    }
    const manager = new THREE.LoadingManager();
    const loaded = new Promise((resolve, reject) => {
      manager.onLoad = resolve;
      manager.onError = (path) =>
        reject(new Error(`Robot mesh failed to load: ${path}`));
    });
    const loader = new URDFLoader(manager);
    this.robot = loader.parse(xml, "/robot/");
    await loaded;
    this.robot.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          obj.material = obj.material.clone();
          obj.material.roughness = 0.45;
          obj.material.metalness = 0.08;
        }
      }
    });
    this.robot.links.light_emitter_link.visible = false;
    this.emitters = [];
    this.robot.links.lamp_head_link.traverse((obj) => {
      if (obj.isMesh && obj.material?.name === "fixture_light")
        this.emitters.push(obj.material);
    });
    this.scene.add(this.robot);
    this.robot.setJointValues(this.pose);
    this.ready = true;
    return this;
  }
  tick(now) {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (this.motion) {
      // A capped integration clock prevents background-tab jumps exceeding velocity limits.
      this.motion.elapsed += dt;
      this.pose = interpolatePose(
        this.motion.from,
        this.motion.to,
        this.motion.elapsed / this.motion.duration,
      );
      if (this.motion.elapsed >= this.motion.duration) {
        const done = this.motion.resolve;
        this.motion = null;
        done(true);
      }
    }
    if (this.robot) {
      this.robot.setJointValues(this.pose);
      this.robot.updateMatrixWorld(true);
      const emitter = this.robot.links.light_emitter_link;
      if (emitter) {
        emitter.getWorldPosition(this.spot.position);
        this.glow.position.copy(this.spot.position);
        const direction = new THREE.Vector3(1, 0, 0).transformDirection(
          emitter.matrixWorld,
        );
        this.spot.target.position.copy(this.spot.position).add(direction);
      }
    }
    this.lightLevel +=
      (this.targetLight - this.lightLevel) * Math.min(dt * 4, 1);
    this.spot.intensity = this.lightLevel * 5;
    this.spot.color.copy(this.lightColor);
    this.glow.intensity = this.lightLevel * 0.2;
    this.glow.color.copy(this.lightColor);
    for (const mat of this.emitters ?? []) {
      mat.emissive.copy(this.lightColor);
      mat.emissiveIntensity = this.lightLevel * 2;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (now - this.lastTelemetry >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastTelemetry));
      this.frames = 0;
      this.lastTelemetry = now;
      this.onTelemetry?.({
        pose: this.pose,
        fps: this.fps,
        brightness: this.lightLevel,
      });
    }
  }
  light(level, color = "warm") {
    this.targetLight = Math.min(1, Math.max(0, level));
    this.lightColor.set(COLORS[color] || COLORS.warm);
  }
  move(target, seconds = 0.5) {
    if (!this.ready) return Promise.resolve(false);
    if (this.motion) this.motion.resolve(false);
    const to = { ...this.pose, ...safePose(target, this.limits) };
    return new Promise((resolve) => {
      this.motion = {
        from: { ...this.pose },
        to,
        elapsed: 0,
        duration: trajectorySeconds(this.pose, to, this.limits, seconds),
        resolve,
      };
    });
  }
  stop() {
    this.generation++;
    if (this.motion) {
      this.motion.resolve(false);
      this.motion = null;
    }
  }
  async execute(actions, { onAction, sound } = {}) {
    const generation = ++this.generation;
    for (let i = 0; i < actions.length; i++) {
      if (generation !== this.generation) return false;
      const action = actions[i];
      onAction?.(action, i);
      if (action.type === "orient") {
        this.light(action.brightness, action.color);
        await this.move(
          orientPose(action.x, action.y),
          action.duration_ms / 1000,
        );
      } else if (action.type === "light") {
        this.light(action.brightness, action.color);
        await this.move(this.pose, action.duration_ms / 1000);
      } else if (action.type === "rest") {
        this.light(0.15, "warm");
        await this.move(REST, 0.8);
      } else if (action.type === "nod") {
        const original = { ...this.pose };
        await this.move(
          { ...original, head_pitch_joint: original.head_pitch_joint + 0.18 },
          0.35,
        );
        if (generation !== this.generation) return false;
        await this.move(original, 0.35);
      } else if (action.type === "celebrate") {
        this.light(0.9, "rose");
        sound?.("music");
        for (const yaw of [-0.22, 0.22, -0.16, 0]) {
          if (generation !== this.generation) return false;
          await this.move(
            { ...HOME, base_yaw_joint: yaw, neck_yaw_joint: -yaw * 0.4 },
            0.45,
          );
        }
        this.light(0.7, "warm");
      }
    }
    return generation === this.generation;
  }
}
