#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const httpProxy = require("http-proxy");

const DEFAULT_DEVICE_HOST = process.env.ROBOCAP_HOST || "192.168.11.1";

function isValidDeviceHost(host) {
  if (!host || typeof host !== "string") return false;
  const trimmed = host.trim();
  if (trimmed.length > 253) return false;
  return /^[a-zA-Z0-9.-]+$/.test(trimmed);
}

function resolveDeviceHost(req) {
  const fromHeader = req.headers["x-robocap-host"];
  if (typeof fromHeader === "string" && isValidDeviceHost(fromHeader)) {
    return fromHeader.trim();
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const fromQuery = url.searchParams.get("host");
    if (fromQuery && isValidDeviceHost(fromQuery)) {
      return fromQuery.trim();
    }
  } catch (_) {
    /* ignore */
  }

  return DEFAULT_DEVICE_HOST;
}
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

proxy.on("error", (error, req, res) => {
  console.error("Proxy error:", error.message);
  if (res && !res.headersSent && typeof res.writeHead === "function") {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad gateway — is RoboCap reachable on the device network?");
  }
});

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function proxyWeb(req, res, target) {
  proxy.web(req, res, { target }, (error) => {
    console.error("Proxy web failed:", error.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Proxy error");
    }
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  const deviceHost = resolveDeviceHost(req);

  if (url.startsWith("/api/")) {
    proxyWeb(req, res, `http://${deviceHost}`);
    return;
  }

  if (url.startsWith("/proxy/webrtc/")) {
    req.url = req.url.replace(/^\/proxy\/webrtc/, "") || "/";
    proxyWeb(req, res, `http://${deviceHost}:8889`);
    return;
  }

  if (url.startsWith("/proxy/hls/")) {
    req.url = req.url.replace(/^\/proxy\/hls/, "") || "/";
    proxyWeb(req, res, `http://${deviceHost}:8888`);
    return;
  }

  serveStatic(req, res);
});

server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/proxy/mqtt")) {
    const deviceHost = resolveDeviceHost(req);
    proxy.ws(req, socket, head, { target: `ws://${deviceHost}:8083/mqtt` }, (error) => {
      console.error("MQTT proxy failed:", error.message);
      socket.destroy();
    });
    return;
  }
  socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RoboCap viewer: http://localhost:${PORT}`);
  console.log(`LAN access:       http://<this-pc-ip>:${PORT}`);
  console.log(`Proxying device API/streams (default ${DEFAULT_DEVICE_HOST}, override via UI Host or ?host=)`);
  console.log("Do not open index.html from disk — use the URLs above to avoid CORS.");
});
