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

## Setup and run

Prerequisite: [Node.js](https://nodejs.org/) 18 or newer (includes npm).

1. Clone the repo and enter it:

   ```bash
   git clone https://github.com/frodobots-org/robocap-live-viewer.git
   cd robocap-live-viewer
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open `http://localhost:3000` in your browser.
5. Enter the RoboCap device IP in the **Host** field (default `192.168.11.1`) and click **Connect**.

Optional environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Port the viewer listens on |
| `ROBOCAP_HOST` | `192.168.11.1` | Default device host for the proxy |

Example: `PORT=8080 ROBOCAP_HOST=192.168.11.1 npm start`

## Connect the streams directly (your own player)

You can skip this viewer and open the camera streams in another player (browser, VLC, ffplay, OBS, your own app). The device runs a MediaMTX server and publishes each camera as a path.

1. Connect your computer to the RoboCap WiFi hotspot (`Robocap_*`) or the same LAN as the device. Below, `192.168.11.1` is the default device IP; replace it with yours.
2. Make sure the camera streams are switched on. The device only publishes a stream while its preview is enabled, and it stops while the device is recording. The easiest way is to open this viewer and click **Connect**, which sends the `preview_switch` command over MQTT (`ws://192.168.11.1:8083/mqtt`) for all 6 channels. Keep that tab open while you use the other player.
3. Use the URL for the camera you want:

   | Camera | Path | HLS (VLC, ffplay, `<video>`) | WebRTC page (browser) |
   |--------|------|------------------------------|-----------------------|
   | Right Eye | `ch0` | `http://192.168.11.1:8888/ch0/index.m3u8` | `http://192.168.11.1:8889/ch0` |
   | Left Front | `ch1` | `http://192.168.11.1:8888/ch1/index.m3u8` | `http://192.168.11.1:8889/ch1` |
   | Left Eye | `ch2` | `http://192.168.11.1:8888/ch2/index.m3u8` | `http://192.168.11.1:8889/ch2` |
   | Right Side | `ch3` | `http://192.168.11.1:8888/ch3/index.m3u8` | `http://192.168.11.1:8889/ch3` |
   | Left Side | `ch4` | `http://192.168.11.1:8888/ch4/index.m3u8` | `http://192.168.11.1:8889/ch4` |
   | Right Front | `ch5` | `http://192.168.11.1:8888/ch5/index.m3u8` | `http://192.168.11.1:8889/ch5` |

4. Open it in your player:
   - **VLC:** Media → Open Network Stream → paste the HLS URL.
   - **ffplay:** `ffplay http://192.168.11.1:8888/ch1/index.m3u8`
   - **Browser:** open the WebRTC page URL for low latency.
   - **Custom WebRTC client:** send a WHEP request (POST an SDP offer) to `http://192.168.11.1:8889/ch1/whep`.

Notes:
- HLS has a few seconds of latency; WebRTC/WHEP is lowest latency.
- Calling these URLs from a web page on another origin can hit CORS errors. Use this repo's dev server proxy instead: `http://localhost:3000/proxy/hls/ch1/index.m3u8?host=192.168.11.1` (the viewer adds the `host` query parameter itself).
- If a stream returns 404 or stays blank, the camera preview isn't enabled. Re-connect through the viewer, and make sure the device isn't recording.

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
