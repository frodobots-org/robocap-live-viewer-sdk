# RoboCap Live Viewer

A minimal HTML page that shows all **6 live camera streams** when connected to a RoboCap device.

## Features

- 3×2 grid of live camera feeds (same layout as the RoboCap app)
- Auto-connects via MQTT and starts all streams when the device is reachable
- WebRTC/WHEP playback with HLS and embedded reader fallbacks
- Stops preview automatically while the device is recording
- Fullscreen mode for the camera grid
- Single-camera fullscreen — click a live feed or use the expand button on each tile (Esc to exit)

## Camera layout

| Left Front | Left Eye | Right Front |
| Left Side | Right Eye | Right Side |

## Usage

### On the RoboCap device network (recommended)

1. Connect to the RoboCap WiFi hotspot: `Robocap_*` (password: `12345678`)
2. Open `http://192.168.11.1/` if this viewer is deployed on the device, **or**
3. Run the local dev server (includes a proxy to avoid CORS):

```bash
cd robo-cap-viewer
npm install
npm start
```

Then open `http://localhost:3000` (or `http://<your-pc-ip>:3000` on the LAN). **Do not** double-click `index.html` — opening as `file://` causes CORS errors (`origin 'null'`).

Use the **Host** field to set any RoboCap device IP and click **Connect**. The choice is saved in your browser.

The dev server proxies API, MQTT, and stream requests to the host you enter. You can still set a server default with `ROBOCAP_HOST=192.168.11.1 npm start`.

### Demo mode (UI only, no device)

Open with `?demo` to preview the layout without a connected device:

```
http://localhost:3000/?demo
```

## How it works

1. `GET /api/device` — discover device ID
2. MQTT `ws://192.168.11.1:8083/mqtt` — control channel
3. `preview_switch` — enable all 6 camera encoders
4. WHEP `http://192.168.11.1:8889/ch{N}/whep` — low-latency WebRTC streams

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page viewer shell |
| `js/device.js` | Device discovery and MQTT bridge |
| `js/viewer.js` | 6-camera WHEP/HLS playback |
| `css/styles.css` | Dark full-screen camera grid styling |
