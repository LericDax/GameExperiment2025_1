# Procedural Block World

This project hosts a browser-based sandbox inspired by classic block-building games. The entire runtime now lives inside the Vite workspace (`three-demo/`), which provides both the development server and production build pipeline. The root `index.html` simply documents how to launch those workflows.

## Features

- Dedicated texture engine that layers fractal noise, Worley cells, and analytic patterns to craft deterministic block materials.
- Deterministic, procedurally generated textures for every block type.

- Streaming chunk manager that expands the world as you explore.
- Water buoyancy, oxygen tracking, and fall damage to ground the traversal loop.
- Enhanced lighting pass with ACES filmic tone mapping, soft shadows, and a fill light for richer visuals.
- Responsive HUD overlay that surfaces health, oxygen, and contextual status messaging.

## Art Assets

Artists can drop hand-authored overrides into `three-demo/src/textures/nonprocedural/`. See the README in that folder for naming and tiling conventions so the runtime picks up your textures automatically.

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

## World Configuration

- Consult [WORLD_CONFIGURATION.md](WORLD_CONFIGURATION.md) for a complete breakdown of every configurable world option, including default ranges and the supported override workflow.

## Controls
- `WASD` / arrow keys – movement
- `Space` – jump (or swim upwards when underwater)
- `Shift` – sprint on land, dive while swimming
- Mouse – look around
- Keep an eye on the lower-left HUD for health, oxygen, and contextual status alerts.

## Developer Console

The sandbox ships with an in-game console so you can script quick diagnostics without leaving play mode:

- Press the **Backquote** key (`\`` on US keyboards) to toggle the overlay. The same key or `Esc` will close it so you can return to pointer lock. 【F:three-demo/src/ui/command-console.js†L6-L12】【F:three-demo/src/main.js†L307-L337】
- Console commands always start with `/`. Type `/help` to list everything that is currently registered or `/help <command>` to drill into usage and options. 【F:three-demo/src/ui/command-console.js†L200-L240】【F:three-demo/src/ui/command-console.js†L355-L377】

### Command highlights

Commands are grouped by the kind of developer workflow they support:

- **Navigation & positioning** – `/whereami` prints your coordinates and biome, `/goto <x> <y> <z>` teleports to a specific block, `/goto biome <biome id|label>` warps you to the nearest matching biome (omit the name to list valid identifiers), `/look <yaw> <pitch>` snaps the camera orientation (degrees by default), and `/unstuck` nudges you toward the nearest safe tile if you clip into geometry. 【F:three-demo/src/player/dev-commands.js†L675-L901】
- **Player state & HUD** – `/godmode` and `/fly` toggle invulnerability and free-flight, `/heal [amount]` and `/oxygen [amount]` set vital stats directly, and `/status [message]` updates or clears the HUD status banner. 【F:three-demo/src/player/dev-commands.js†L826-L917】
- **Diagnostics** – `/scan` casts a ray to inspect the block you are looking at, `/scan column <x> <z>` audits a whole column, and `/scan watch …` keeps logging visibility as the scene evolves. 【F:three-demo/src/player/dev-commands.js†L717-L777】
- **ASCII tooling** – `/asciimap` renders a top-down ASCII slice, `/asciioptions` saves default radii/offsets/watch cadence, and `/asciiwatch` keeps the map refreshing on demand. 【F:three-demo/src/player/dev-commands.js†L919-L1039】
- **VFX inspection** – `/vfx overlay [on|off|toggle]` adds a particle debugging overlay, while `/vfx list` dumps live emitter and fluid surface stats to the console. 【F:three-demo/src/player/dev-commands.js†L780-L823】

### Weather presets

Cold biomes now ship with bespoke snow, aurora, and whiteout presets that can be inspected directly from the console. Use `/weather soft_snowfall` to summon calm crystalline flakes—the DOM overlay now switches to a dedicated snow mode with dense `snowflake`/`snowpuff` element pools driven by the `--snowflake-density`/`--snowpuff-density` CSS variables—`/weather polar_aurora` to flood the sky with layered ribbon curtains that billow across two depth bands, `/weather polar_blizzard` to stress-test extreme katabatic squalls that push the snow overlay toward its intensity ceiling, or `/weather aurora_snowfall` to blend both effects. Once you are satisfied with the manual checks, run `/weather on` to resume automated rotation so the manager can schedule the new presets naturally. 【F:three-demo/src/world/weather/weather-manager.js†L20-L190】【F:three-demo/src/world/weather/weather-manager.js†L430-L540】【F:three-demo/src/world/weather/weather-manager.js†L2220-L2335】【F:three-demo/src/ui/weather-overlay-controller.js†L1-L456】【F:three-demo/index.html†L120-L360】【F:three-demo/src/player/dev-commands.js†L1508-L1714】

## Performance Instrumentation

When the sandbox is running in the Vite dev server, the browser exposes a debug namespace at `window.__VOXEL_DEBUG__`. You can launch an automated "perf flight" from the DevTools console to gather renderer and world metrics while the avatar flies forward for a fixed window. 【F:three-demo/src/main.js†L250-L318】

1. Open the page in a Chromium- or Firefox-based browser via `npm run dev`.
2. Open DevTools and switch to the **Console** tab.
3. Call `window.__VOXEL_DEBUG__.perfFlight.run()` or pass overrides such as:
   ```js
   window.__VOXEL_DEBUG__.perfFlight.run({
     durationMs: 45000,       // total capture time in milliseconds
     sampleIntervalMs: 250,   // minimum gap between samples (0 uses every frame)
   })
   ```
   The method returns a promise that resolves with the aggregated summary once the flight ends. 【F:three-demo/src/devtools/perf-flight-harness.js†L118-L213】

While the flight runs, an overlay appears in the top-right corner showing elapsed time, average and instant FPS, draw call counts, triangle counts, and chunk/block coverage to help you gauge scene complexity at a glance. The resolved summary mirrors those fields—`fps`, `delta`, renderer `renderCalls` and `triangles`, plus chunk/voxel counts—along with per-frame samples so you can chart the data externally. 【F:three-demo/src/devtools/perf-flight-harness.js†L43-L195】

To start a run automatically on page load, append `?perfFlight=auto` to the URL. The harness will fire once the world boots, displaying the same overlay and logging the summary to the console when complete. 【F:three-demo/src/main.js†L282-L304】

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
