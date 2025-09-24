# Procedural Block World

This project hosts a browser-based sandbox inspired by classic block-building games. The entire runtime now lives inside the Vite workspace (`three-demo/`), which provides both the development server and production build pipeline. The root `index.html` simply documents how to launch those workflows.

## Features

- Dedicated texture engine that layers fractal noise, Worley cells, and analytic patterns to craft deterministic block materials.
- Deterministic, procedurally generated textures for every block type.

- Streaming chunk manager that expands the world as you explore.
- Water buoyancy, oxygen tracking, and fall damage to ground the traversal loop.
- Enhanced lighting pass with ACES filmic tone mapping, soft shadows, and a fill light for richer visuals.
- Responsive HUD overlay that surfaces health, oxygen, and contextual status messaging.

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
