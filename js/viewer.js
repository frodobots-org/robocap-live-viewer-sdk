(() => {
  "use strict";

  const MTX_WEBRTC_PORT = 8889;
  const MTX_HLS_PORT = 8888;

  // Same display order as robo-cap PreviewGrid (3×2 layout)
  const CHANNELS = [
    { id: "ch1", index: 1, label: "Left Front" },
    { id: "ch2", index: 2, label: "Left Eye" },
    { id: "ch5", index: 5, label: "Right Front" },
    { id: "ch4", index: 4, label: "Left Side" },
    { id: "ch0", index: 0, label: "Right Eye" },
    { id: "ch3", index: 3, label: "Right Side" },
  ];

  const ICON_EXPAND =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"></path></svg>';

  const state = {
    sessions: new Map(),
    desired: [false, false, false, false, false, false],
    switchInFlight: false,
    started: false,
    demoMode: new URLSearchParams(window.location.search).has("demo"),
    expandedSession: null,
  };

  const $ = (selector) => document.querySelector(selector);

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function host() {
    return window.RobocapViewer?.getHost?.() || "192.168.11.1";
  }

  function useDevProxy() {
    return window.RobocapViewer?.useDevProxy?.() === true;
  }

  function withProxyHost(url) {
    if (!useDevProxy()) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}host=${encodeURIComponent(host())}`;
  }

  function whepUrl(path, port) {
    if (useDevProxy()) return withProxyHost(`/proxy/webrtc/${path}/whep`);
    return `http://${host()}:${port || MTX_WEBRTC_PORT}/${path}/whep`;
  }

  function hlsUrl(path) {
    if (useDevProxy()) {
      return withProxyHost(`/proxy/hls/${path}/index.m3u8?cookieCheck=1`);
    }
    return `http://${host()}:${MTX_HLS_PORT}/${path}/index.m3u8?cookieCheck=1`;
  }

  function readerUrl(path) {
    if (useDevProxy()) return withProxyHost(`/proxy/webrtc/${path}`);
    return `http://${host()}:${MTX_WEBRTC_PORT}/${path}`;
  }

  function whepFetchInit(body) {
    const headers = { "Content-Type": "application/sdp" };
    const proxy = window.RobocapViewer?.proxyHeaders?.();
    if (proxy) Object.assign(headers, proxy);
    return { method: "POST", headers, body };
  }

  function setTileStatus(session, status, label) {
    const el = session.root.querySelector("[data-status]");
    if (!el) return;
    el.className = `camera-status is-${status}`;
    el.textContent = label;
  }

  function closePeer(session) {
    const wrap = session.root.querySelector(".camera-video-wrap");
    if (wrap) {
      wrap.innerHTML = '<video data-video autoplay playsinline muted></video>';
      session.video = wrap.querySelector("[data-video]");
    } else if (session.video) {
      session.video.srcObject = null;
      session.video.removeAttribute("src");
      session.video.load();
    }

    if (session.pc) {
      try {
        session.pc.getReceivers().forEach((r) => r.track?.stop());
        session.pc.close();
      } catch (_) {
        /* ignore */
      }
      session.pc = null;
    }

    session.playing = false;
    session.mode = null;
  }

  function waitForIceGathering(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const onChange = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", onChange);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", onChange);
      window.setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }, 2000);
    });
  }

  async function applyPreviewSwitch(desired, reason) {
    if (state.demoMode) {
      return {
        errcode: 0,
        payload: {
          ready: desired.slice(),
          webrtc_port: MTX_WEBRTC_PORT,
        },
      };
    }

    if (!window.RobocapViewer?.isConnected?.()) {
      throw new Error("not_connected");
    }

    if (state.switchInFlight) return null;
    state.switchInFlight = true;

    try {
      const reply = await window.RobocapViewer.callService("preview_switch", {
        channels: desired,
      });
      console.log(`preview_switch ${reason || ""}`, reply);
      return reply;
    } finally {
      state.switchInFlight = false;
    }
  }

  async function playHls(session) {
    closePeer(session);
    session.mode = "hls";
    setTileStatus(session, "loading", "HLS");

    const video = session.video;
    video.src = hlsUrl(session.path);

    await new Promise((resolve, reject) => {
      const onPlaying = () => {
        cleanup();
        session.playing = true;
        setTileStatus(session, "live", "Live");
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("hls_failed"));
      };
      const cleanup = () => {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("playing", onPlaying);
      video.addEventListener("error", onError);
      video.play().catch(onError);
    });
  }

  async function playReaderEmbed(session) {
    closePeer(session);
    session.mode = "embed";
    setTileStatus(session, "loading", "Embed");

    const wrap = session.root.querySelector(".camera-video-wrap");
    if (!wrap) throw new Error("no_wrap");

    wrap.innerHTML = `<iframe src="${readerUrl(session.path)}" title="${session.label}"></iframe>`;
    session.playing = true;
    setTileStatus(session, "live", "Live");
  }

  async function playWhep(session, webrtcPort) {
    closePeer(session);
    session.mode = "whep";
    setTileStatus(session, "loading", "Connecting");

    const pc = new RTCPeerConnection({ iceServers: [] });
    session.pc = pc;

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addEventListener("track", (event) => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      session.video.srcObject = stream;
      session.playing = true;
      setTileStatus(session, "live", "Live");
    });

    pc.addEventListener("connectionstatechange", () => {
      if (!session.pc) return;
      if (session.pc.connectionState === "failed") {
        setTileStatus(session, "error", "Failed");
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const response = await fetch(
      whepUrl(session.path, webrtcPort),
      whepFetchInit(pc.localDescription.sdp),
    );

    if (!response.ok) {
      throw new Error(`whep_${response.status}`);
    }

    const answerSdp = await response.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  async function playSession(session, webrtcPort) {
    if (state.demoMode) {
      setTileStatus(session, "idle", "Demo");
      return;
    }

    if (window.RobocapViewer?.isRecording?.()) {
      setTileStatus(session, "error", "Recording");
      return;
    }

    try {
      await playWhep(session, webrtcPort);
    } catch (error) {
      console.warn(`${session.path} WHEP failed, trying HLS`, error);
      try {
        await playHls(session);
      } catch (hlsError) {
        console.warn(`${session.path} HLS failed, trying embed`, hlsError);
        try {
          await playReaderEmbed(session);
        } catch (embedError) {
          console.error(`${session.path} all playback failed`, embedError);
          closePeer(session);
          setTileStatus(session, "error", "Offline");
        }
      }
    }
  }

  async function startAllStreams() {
    if (state.started) return;
    state.started = true;

    if (state.demoMode) {
      state.sessions.forEach((session) => setTileStatus(session, "idle", "Demo"));
      return;
    }

    if (window.RobocapViewer?.isRecording?.()) {
      state.sessions.forEach((session) => setTileStatus(session, "error", "Recording"));
      return;
    }

    const desired = [true, true, true, true, true, true];
    state.sessions.forEach((session) => setTileStatus(session, "loading", "Starting"));

    let reply;
    try {
      reply = await applyPreviewSwitch(desired, "start-all");
    } catch (error) {
      console.error("preview_switch failed", error);
      state.sessions.forEach((session) => setTileStatus(session, "error", "Failed"));
      state.started = false;
      return;
    }

    if (!reply || reply.errcode !== 0) {
      const blocked = reply?.errmsg === "recording";
      state.sessions.forEach((session) =>
        setTileStatus(session, "error", blocked ? "Recording" : "Failed"),
      );
      state.started = false;
      return;
    }

    state.desired = desired.slice();
    const ready = Array.isArray(reply.payload?.ready) ? reply.payload.ready : [];
    const webrtcPort = Number(reply.payload?.webrtc_port) || MTX_WEBRTC_PORT;

    await Promise.all(
      CHANNELS.map(async (channel) => {
        const session = state.sessions.get(channel.id);
        if (!session) return;

        if (!ready[channel.index]) {
          setTileStatus(session, "error", "Not ready");
          return;
        }

        await playSession(session, webrtcPort);
      }),
    );
  }

  async function stopAllStreams(reason) {
    state.sessions.forEach((session) => {
      closePeer(session);
      setTileStatus(session, "idle", reason || "Stopped");
    });

    const hadStreams = state.desired.some(Boolean);
    state.desired = [false, false, false, false, false, false];
    state.started = false;

    if (hadStreams && window.RobocapViewer?.isConnected?.() && !state.demoMode) {
      await applyPreviewSwitch(state.desired, reason || "stop-all").catch(() => {});
    }
  }

  function buildTile(channel) {
    const article = document.createElement("article");
    article.className = "camera-tile";
    article.dataset.path = channel.id;
    article.innerHTML = `
      <div class="camera-tile-head">
        <span class="camera-label">${channel.label}</span>
        <div class="camera-tile-actions">
          <span class="camera-status is-idle" data-status>Idle</span>
          <button type="button" class="icon-btn tile-expand-btn" data-expand title="Fullscreen this camera" aria-label="Fullscreen this camera">${ICON_EXPAND}</button>
        </div>
      </div>
      <div class="camera-video-wrap" data-video-wrap title="Click to fullscreen">
        <video data-video autoplay playsinline muted></video>
      </div>
    `;

    const session = {
      path: channel.id,
      index: channel.index,
      label: channel.label,
      root: article,
      video: article.querySelector("[data-video]"),
      pc: null,
      playing: false,
      mode: null,
    };

    article.querySelector("[data-expand]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleTileFullscreen(session);
    });

    article.querySelector("[data-video-wrap]")?.addEventListener("click", () => {
      if (session.playing || session.mode === "embed") {
        toggleTileFullscreen(session);
      }
    });

    state.sessions.set(channel.id, session);
    return article;
  }

  function renderGrid() {
    const grid = $("#cameraGrid");
    if (!grid) return;
    grid.innerHTML = "";
    state.sessions.clear();
    CHANNELS.forEach((channel) => grid.appendChild(buildTile(channel)));
  }

  function exitFullscreen() {
    if (!fullscreenElement()) return;
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }

  async function enterFullscreen(el) {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }

  function toggleTileFullscreen(session) {
    const tile = session.root;
    const active = fullscreenElement() === tile;

    if (active) {
      exitFullscreen();
      return;
    }

    if (fullscreenElement() && fullscreenElement() !== tile) {
      exitFullscreen();
    }

    enterFullscreen(tile).catch((error) => {
      console.warn("Tile fullscreen failed", error);
    });
  }

  function toggleGridFullscreen() {
    const grid = $("#cameraGrid");
    if (!grid) return;

    const active = fullscreenElement() === grid;

    if (active) {
      exitFullscreen();
      return;
    }

    if (fullscreenElement() && fullscreenElement() !== grid) {
      exitFullscreen();
    }

    enterFullscreen(grid).catch((error) => {
      console.warn("Grid fullscreen failed", error);
    });
  }

  function onFullscreenChange() {
    const active = fullscreenElement();
    state.expandedSession = null;

    state.sessions.forEach((session) => {
      session.root.classList.toggle("is-expanded", active === session.root);
      const btn = session.root.querySelector("[data-expand]");
      if (btn) {
        btn.title = active === session.root ? "Exit fullscreen (Esc)" : "Fullscreen this camera";
        btn.setAttribute(
          "aria-label",
          active === session.root ? "Exit fullscreen" : "Fullscreen this camera",
        );
      }
    });

    if (active?.classList?.contains("camera-tile")) {
      state.expandedSession = active.dataset.path;
    }

    const gridBtn = $("#fullscreenBtn");
    if (gridBtn) {
      const gridActive = active?.id === "cameraGrid";
      gridBtn.title = gridActive ? "Exit grid fullscreen (Esc)" : "Fullscreen all cameras";
      gridBtn.setAttribute(
        "aria-label",
        gridActive ? "Exit grid fullscreen" : "Fullscreen all cameras",
      );
    }
  }

  function bindEvents() {
    $("#fullscreenBtn")?.addEventListener("click", toggleGridFullscreen);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);

    window.addEventListener("robocap:connected", () => {
      startAllStreams();
    });

    window.addEventListener("robocap:disconnected", () => {
      stopAllStreams("Disconnected");
    });

    window.addEventListener("robocap:recording", (event) => {
      if (event.detail?.isRecording) {
        stopAllStreams("Recording");
      } else if (window.RobocapViewer?.isConnected?.()) {
        startAllStreams();
      }
    });

    window.addEventListener("pagehide", () => stopAllStreams("leave"));
    window.addEventListener("beforeunload", () => stopAllStreams("leave"));
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderGrid();
    bindEvents();
  });
})();
