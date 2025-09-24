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
The Vite demo is the recommended way to iterate on the experience. QA engineers looking for the headless automation hooks can skip ahead to [Headless QA tooling](#headless-qa-tooling) once the server is running.

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

## Headless QA tooling
The development build wires a debug namespace into `window.__VOXEL_DEBUG__` so that automated scripts can drive the in-game console and ASCII renderer without interacting with the HUD. This namespace is only attached when `import.meta.env.DEV` is `true`, so always run the Vite dev server during headless test runs.

### Prerequisites
1. Start the dev server from the project root:
   ```bash
   cd three-demo
   npm run dev -- --host 0.0.0.0
   ```
   The `--host` flag makes the server reachable from external runners such as Playwright workers.
2. Point your headless browser or automation harness at the served URL (default `http://localhost:5173/`). Wait for the scene to finish loading before issuing debug commands.
3. In the browser context, guard against the namespace being absent in production builds:
   ```js
   const { commandConsole, ascii } = window.__VOXEL_DEBUG__ ?? {};
   if (!commandConsole || !ascii) {
     throw new Error('Debug helpers unavailable – ensure the dev server is running.');
   }
   ```

### Controlling the developer console
`window.__VOXEL_DEBUG__.commandConsole` exposes the same API that backs the in-game console overlay. The most common helpers are:

- `commandConsole.execute('/command args')` – normalizes the leading slash and routes the command through the registered command handlers.【F:three-demo/src/player/dev-commands.js†L942-L969】
- `commandConsole.list()` – returns the available commands with descriptions and usage strings for quick introspection.【F:three-demo/src/player/dev-commands.js†L964-L969】
- `commandConsole.onLog(listener)` – subscribes to console output so headless scripts can assert on the resulting text stream.【F:three-demo/src/player/dev-commands.js†L968-L969】

Example (Playwright):

```ts
await page.evaluate(() => {
  const { commandConsole } = window.__VOXEL_DEBUG__;
  commandConsole.execute('/asciioptions radius=20');
  commandConsole.execute('/asciimap');
});
```

### Working with ASCII captures
The `window.__VOXEL_DEBUG__.ascii` helpers make it easy to render, watch, and format ASCII snapshots of the world.【F:three-demo/src/player/dev-commands.js†L905-L941】

- `ascii.render(overrides?)` renders a single frame, writes it to the console, and returns the raw view data. Pass overrides such as `{ radius: 24, lowerOffset: -2, upperOffset: 2 }` to adjust the sampling volume.
- `ascii.on(listener)` / `ascii.off(listener)` register listeners for `/asciiwatch` updates. Each callback receives events containing the latest view data.
- `ascii.startFrame()` starts `/asciiwatch on frame` (updates every render frame), while `ascii.startInterval(ms)` starts `/asciiwatch on <ms>` using interval ticks. Call `ascii.stop()` to halt the watch loop.
- `ascii.options()` and `ascii.setOptions(overrides)` read or mutate the default radius/offset configuration.
- `ascii.format(view)` formats a captured view into the printable string returned by `/asciimap`.

#### Example: capturing `/asciimap`
1. Ensure `/asciioptions` are set as needed via `commandConsole.execute`.
2. Trigger the capture and pull the formatted result into your test harness:
   ```ts
   const asciiSnapshot = await page.evaluate(() => {
     const { ascii } = window.__VOXEL_DEBUG__;
     const view = ascii.render({ radius: 16 });
     return ascii.format(view);
   });
   console.log(asciiSnapshot);
   ```

#### Example: configuring `/asciiwatch`
1. Subscribe to watch events inside the page context and resolve a promise once the desired number of frames arrive:
   ```ts
   const frames = await page.evaluate(() => {
     const { ascii } = window.__VOXEL_DEBUG__;
     return new Promise((resolve) => {
       const collected = [];
       const stop = ascii.on((event) => {
         if (event?.view) {
           collected.push(ascii.format(event.view));
         }
         if (collected.length >= 3) {
           stop();
           ascii.stop();
           resolve(collected);
         }
       });
       ascii.startInterval(250);
     });
   });
   ```
2. The returned `frames` array now contains stringified ASCII slices suitable for snapshot assertions or log storage.

#### Example: issuing `/scan`
The `/scan` command traces a ray or column through the world and reports intersected voxels.【F:three-demo/src/player/dev-commands.js†L586-L705】

```ts
await page.evaluate(() => {
  const { commandConsole } = window.__VOXEL_DEBUG__;
  // Trace 10 units forward with a downward pitch.
  commandConsole.execute('/scan 10 45 -15');
  // Monitor a vertical column under the player.
  commandConsole.execute('/scan column 0 0');
  // Begin a scan watch that logs when visibility changes.
  commandConsole.execute('/scan watch 12 0 -20');
});
```

Hook `commandConsole.onLog` in your automation to capture the emitted `[scan]` lines and assert on their contents.
