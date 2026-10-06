# Deploy viewer for multiple PCs (no Node/npm on each PC)

Browsers **cannot** use a local `file://` HTML file to talk to RoboCap — you will see CORS / `origin 'null'` errors. That is a browser security rule, not something JavaScript on the page can bypass.

**What works without npm on operator PCs:** host the viewer **once** on the RoboCap device (or any web server on the device). Every PC only needs a browser and the RoboCap WiFi.

## Recommended: on-device URL

1. Copy the static viewer into the device web root (see below).
2. Each PC joins `Robocap_*` WiFi (password `12345678`).
3. Each PC opens the same URL in Chrome/Edge/Safari:

   **http://192.168.11.1/viewer/**

No install on the PCs. Up to many simultaneous browsers is fine (same as the main device web UI).

## Copy files to the device

### Option A — ship with firmware (developers)

From this repo:

```bash
cd robo-cap-viewer
chmod +x scripts/sync-to-device-www.sh
./scripts/sync-to-device-www.sh
```

That updates `web/www/viewer/` in omni-specs. Rebuild/install the device image so `/opt/www/viewer/` is on the cap.

### Option B — manual copy (one-time IT)

Copy this folder to the device (paths vary by image; often under `/opt/www/`):

```
viewer/
  index.html
  css/styles.css
  js/device.js
  js/viewer.js
  js/mqtt.min.js
```

Use SCP, USB, or your admin tools. Do **not** copy `server.js`, `package.json`, or `node_modules`.

## Development on a PC (optional)

Use `npm start` only on **one** dev machine when you are testing from `localhost` or a non-device URL. Operator PCs should use **http://192.168.11.1/viewer/** instead.

## Custom device IP

If the cap is not at `192.168.11.1`, use the Host field in the header after opening the viewer from that device’s HTTP URL, or open the page from the correct hostname so it auto-detects.

## Stream mode

When hosted on the device (`http://<device-ip>/viewer/`), streams prefer the built-in MediaMTX **embed** player (iframe) first to avoid cross-port CORS on WHEP. Force embed-only with `?embed` on the URL.
