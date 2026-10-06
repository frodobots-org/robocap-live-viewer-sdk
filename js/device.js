(() => {
  "use strict";

  const DEFAULT_HOST = "192.168.11.1";
  const HOST_STORAGE_KEY = "robocap-viewer.host";
  const MQTT_PORT = 8083;

  const state = {
    host: resolveHost(),
    deviceId: "",
    mqttClient: null,
    mqttConnected: false,
    isRecording: false,
    pendingServiceWaiters: new Map(),
  };

  let reqIdSeq = 0;

  function nextReqId() {
    const now = Date.now();
    reqIdSeq = Math.max(reqIdSeq + 1, now);
    return reqIdSeq;
  }

  function isFileProtocol() {
    return window.location.protocol === "file:";
  }

  function pageHost() {
    return normalizeHost(window.location.hostname);
  }

  /** Route API/streams through this page's server proxy (avoids browser CORS). */
  function useDevProxy() {
    if (isFileProtocol()) return false;

    const deviceHost = normalizeHost(state.host);
    const currentHost = pageHost();

    if (currentHost !== deviceHost) return true;

    const port = window.location.port;
    if (port && port !== "80" && port !== "443") return true;

    return false;
  }

  function normalizeHost(input) {
    let host = String(input || "").trim();
    if (!host) return DEFAULT_HOST;
    host = host.replace(/^https?:\/\//i, "");
    host = host.split("/")[0];
    host = host.split(":")[0];
    return host || DEFAULT_HOST;
  }

  function resolveHost() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("host")?.trim();
    if (fromQuery) return normalizeHost(fromQuery);

    const fromStorage = localStorage.getItem(HOST_STORAGE_KEY)?.trim();
    if (fromStorage) return normalizeHost(fromStorage);

    if (isFileProtocol()) return DEFAULT_HOST;

    const hostname = window.location.hostname;
    if (!hostname) return DEFAULT_HOST;

    const port = window.location.port;
    const onDeviceWebPort = !port || port === "80" || port === "443";
    if (onDeviceWebPort) return normalizeHost(hostname);

    return DEFAULT_HOST;
  }

  function saveHost(host) {
    localStorage.setItem(HOST_STORAGE_KEY, host);
  }

  function syncHostInput() {
    const input = document.getElementById("hostInput");
    if (input) input.value = state.host;
  }

  function proxyHeaders() {
    if (!useDevProxy()) return undefined;
    return { "X-Robocap-Host": state.host };
  }

  function apiUrl(path) {
    if (useDevProxy() || pageHost() === normalizeHost(state.host)) {
      return path;
    }
    return `http://${state.host}${path}`;
  }

  function mqttUrl() {
    if (useDevProxy()) {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const hostParam = encodeURIComponent(state.host);
      return `${proto}//${window.location.host}/proxy/mqtt?host=${hostParam}`;
    }
    return `ws://${state.host}:${MQTT_PORT}/mqtt`;
  }

  function showFileProtocolHelp() {
    setConnection("error", "Use dev server");
    showOverlay(
      "Open via HTTP, not as a file",
      "This page was opened from disk (file://), which triggers CORS errors. Run npm start in the robo-cap-viewer folder, then open http://localhost:3000 in your browser. Set any device IP in the Host field and click Connect.",
      false,
    );
  }

  function setConnection(status, message) {
    const chip = document.getElementById("connectionChip");
    const text = document.getElementById("connectionText");
    if (!chip || !text) return;

    chip.className = "connection-chip";
    if (status === "ok") chip.classList.add("is-ok");
    else if (status === "error") chip.classList.add("is-error");
    else if (status === "blocked") chip.classList.add("is-blocked");
    else chip.classList.add("is-pending");

    text.textContent = message;
  }

  function setDeviceLabel(id) {
    const el = document.getElementById("deviceLabel");
    if (el) el.textContent = id ? `Device ${id}` : "—";
  }

  function showOverlay(title, message, showRetry = true) {
    const overlay = document.getElementById("connectOverlay");
    const titleEl = document.getElementById("overlayTitle");
    const messageEl = document.getElementById("overlayMessage");
    const retryBtn = document.getElementById("retryBtn");

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (retryBtn) retryBtn.hidden = !showRetry;
    if (overlay) overlay.hidden = false;
  }

  function hideOverlay() {
    const overlay = document.getElementById("connectOverlay");
    if (overlay) overlay.hidden = true;
  }

  function handleServiceReply(serviceName, data) {
    const reqId = Number(data.req_id);
    const waiter = state.pendingServiceWaiters.get(reqId);
    if (!waiter) return;

    window.clearTimeout(waiter.timer);
    state.pendingServiceWaiters.delete(reqId);
    waiter.resolve(data);
  }

  function handleMqttMessage(topic, payload) {
    try {
      const data = JSON.parse(payload.toString());
      const parts = topic.split("/");

      if (parts[2] === "prop" && parts[3] === "all") {
        const props = data?.payload?.value || data?.data || data || {};
        const recording = props.is_recording === true || props.is_recording === 1;
        if (recording !== state.isRecording) {
          state.isRecording = recording;
          window.dispatchEvent(
            new CustomEvent("robocap:recording", { detail: { isRecording: recording } }),
          );
        }
        if (recording) setConnection("blocked", "Recording — preview disabled");
        else if (state.mqttConnected) setConnection("ok", "Live");
        return;
      }

      if (parts[2] === "servicecall-reply") {
        handleServiceReply(parts[3], data);
      }
    } catch (error) {
      console.error("MQTT parse error", error, topic);
    }
  }

  function subscribeTopics() {
    if (!state.mqttClient || !state.deviceId) return;

    const topics = [
      `robocap/${state.deviceId}/prop/all`,
      `robocap/${state.deviceId}/servicecall-reply/#`,
    ];

    topics.forEach((topic) => {
      state.mqttClient.subscribe(topic, (error) => {
        if (error) console.error(`Subscribe failed: ${topic}`, error);
      });
    });
  }

  function connectMqtt() {
    if (!state.deviceId || typeof window.mqtt === "undefined") {
      setConnection("error", "MQTT unavailable");
      return Promise.reject(new Error("mqtt_unavailable"));
    }

    if (state.mqttClient) {
      state.mqttClient.end(true);
      state.mqttClient = null;
    }

    setConnection("pending", "Connecting MQTT…");

    return new Promise((resolve, reject) => {
      const client = window.mqtt.connect(mqttUrl(), {
        protocolVersion: 4,
        keepalive: 60,
        reconnectPeriod: 3000,
        clientId: `RoboCap_Viewer_${Math.random().toString(16).slice(2, 10)}`,
      });

      state.mqttClient = client;

      const onConnect = () => {
        state.mqttConnected = true;
        if (!state.isRecording) setConnection("ok", "Live");
        subscribeTopics();
        window.dispatchEvent(new CustomEvent("robocap:connected"));
        resolve();
      };

      client.on("connect", onConnect);

      client.on("reconnect", () => {
        state.mqttConnected = false;
        setConnection("pending", "Reconnecting…");
      });

      client.on("close", () => {
        state.mqttConnected = false;
        setConnection("pending", "Disconnected");
        window.dispatchEvent(new CustomEvent("robocap:disconnected"));
      });

      client.on("error", (error) => {
        console.error("MQTT error", error);
        setConnection("error", "MQTT error");
        reject(error);
      });

      client.on("message", handleMqttMessage);

      window.setTimeout(() => {
        if (!state.mqttConnected) {
          reject(new Error("mqtt_timeout"));
        }
      }, 15000);
    });
  }

  async function fetchDeviceId() {
    if (isFileProtocol()) {
      showFileProtocolHelp();
      throw new Error("file_protocol");
    }

    setConnection("pending", "Finding device…");
    showOverlay(
      "Connecting to RoboCap",
      `Looking for device at ${state.host}…`,
      false,
    );

    try {
      const response = await fetch(apiUrl("/api/device"), {
        cache: "no-store",
        headers: proxyHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const json = await response.json();
      const id = json?.device_id ? String(json.device_id).trim() : "";
      if (!id) throw new Error("empty device id");

      state.deviceId = id;
      setDeviceLabel(id);
      await connectMqtt();
      hideOverlay();
      return id;
    } catch (error) {
      console.error("Device connect failed", error);
      setConnection("error", "Not connected");

      const corsHint = useDevProxy()
        ? ""
        : " If you see a CORS error in the console, run npm start and open http://localhost:3000 instead.";

      showOverlay(
        "RoboCap not found",
        `Could not reach the device at ${state.host}. Join the Robocap WiFi hotspot, check the Host field, and click Connect.${corsHint}`,
        true,
      );
      throw error;
    }
  }

  function callService(serviceName, payloadObj, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (!state.mqttClient?.connected || !state.deviceId) {
        reject(new Error("mqtt_disconnected"));
        return;
      }

      const requestId = nextReqId();
      const body = JSON.stringify({
        timestamp: Date.now(),
        req_id: requestId,
        payload: payloadObj || {},
      });

      const timer = window.setTimeout(() => {
        state.pendingServiceWaiters.delete(requestId);
        reject(new Error("timeout"));
      }, timeoutMs);

      state.pendingServiceWaiters.set(requestId, { resolve, reject, timer });

      state.mqttClient.publish(
        `robocap/${state.deviceId}/servicecall/${serviceName}`,
        body,
        { qos: 1 },
        (error) => {
          if (!error) return;
          window.clearTimeout(timer);
          state.pendingServiceWaiters.delete(requestId);
          reject(error);
        },
      );
    });
  }

  function isConnected() {
    return Boolean(state.mqttClient?.connected && state.deviceId);
  }

  async function reconnectDevice() {
    const input = document.getElementById("hostInput");
    state.host = normalizeHost(input?.value || state.host);
    saveHost(state.host);
    syncHostInput();

    if (state.mqttClient) {
      state.mqttClient.end(true);
      state.mqttClient = null;
    }
    state.mqttConnected = false;
    state.deviceId = "";
    state.isRecording = false;
    setDeviceLabel("");
    window.dispatchEvent(new CustomEvent("robocap:disconnected"));

    return fetchDeviceId();
  }

  window.RobocapViewer = {
    getHost: () => state.host,
    useDevProxy,
    /** @deprecated use useDevProxy */
    isLocalDev: useDevProxy,
    proxyHeaders,
    getDeviceId: () => state.deviceId,
    isConnected,
    isRecording: () => state.isRecording,
    callService,
    connect: fetchDeviceId,
    reconnect: reconnectDevice,
  };

  document.getElementById("retryBtn")?.addEventListener("click", () => {
    reconnectDevice().catch(() => {});
  });

  document.getElementById("hostForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    reconnectDevice().catch(() => {});
  });

  document.addEventListener("DOMContentLoaded", () => {
    syncHostInput();

    if (new URLSearchParams(window.location.search).has("demo")) {
      state.deviceId = "DEMO";
      state.mqttConnected = true;
      setDeviceLabel("DEMO");
      setConnection("ok", "Demo mode");
      hideOverlay();
      window.dispatchEvent(new CustomEvent("robocap:connected"));
      return;
    }
    fetchDeviceId().catch(() => {});
  });
})();
