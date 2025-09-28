# Procedural Block World

This project hosts a browser-based sandbox inspired by classic block-building games. The entire runtime now lives inside the Vite workspace (`three-demo/`), which provides both the development server and production build pipeline. The root `index.html` simply documents how to launch those workflows.

## Features

- Dedicated texture engine that layers fractal noise, Worley cells, and analytic patterns to craft deterministic block materials.
- Deterministic, procedurally generated textures for every block type.

- Streaming chunk manager that expands the world as you explore.
- Water buoyancy, oxygen tracking, and fall damage to ground the traversal loop.
- Enhanced lighting pass with ACES filmic tone mapping, soft shadows, and a fill light for richer visuals.
- Responsive HUD overlay that surfaces health, oxygen, and contextual status messaging.

## Audio
The sandbox ships with a lightweight background music pipeline so developers can quickly audition new tracks:

- Drop `.mp3` or `.wav` files into `three-demo/src/sounds/music/tracks/`. The build will automatically bundle every file in that directory and expose it to the in-game playlist.
- Track titles are generated from the filenames (underscores and hyphens are converted to spaces and casing is normalized), so name the assets the way you want them to appear in the UI.

When at least one track is present, the HUD adds a volume widget that surfaces:

- A play/pause toggle that controls the currently selected song.
- A volume slider with immediate feedback for balancing music against other sound effects.
- A "next track" button that cycles through the available playlist in order.

On first load, the widget shows a hint explaining that music will autoplay once tracks are detected in the directory. The hint disappears after interaction so you can rely on it only during initial setup.

## Development Workflow
The Vite demo is the recommended way to iterate on the experience:

1. Install dependencies once:
   ```bash
   cd three-demo
   npm install
   ```
2. Start the development server with hot module replacement:
   ```bash
   npm run dev
   ```
3. Open the provided local URL in a modern browser. The Vite entry point serves the modules from `three-demo/src/`, so changes are reflected instantly.

## Controls
- `WASD` / arrow keys – movement
- `Space` – jump (or swim upwards when underwater)
- `Shift` – sprint on land, dive while swimming
- Mouse – look around
- Keep an eye on the lower-left HUD for health, oxygen, and contextual status alerts.

## Building for Production
To create an optimized build via Vite:

```bash
cd three-demo
npm run build
```

The output is written to `three-demo/dist/` and can be hosted on any static web server.

## Voxel Object JSON Notes
- `ignoreBiomeTint` (boolean, optional): when `true`, the object's voxels render using their explicit `tint` values without
  additional biome- or altitude-based color grading. Use this for foliage or decorations that should preserve author-defined
  hues regardless of the surrounding biome lighting.
