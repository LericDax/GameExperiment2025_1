
# Weather Visuals Investigation

> **Team note:** Keep this plan current after any further weather fixes or experiments—add new findings, tooling, and regressions here so the next investigator starts with the latest context.

## Observed Gaps
- The main render loop instantiates `createWeatherManager` and advances it every frame, yet nothing in gameplay ever schedules a preset beyond the default `clear_skies`, so weather state never changes during normal play.【F:src/main.js†L187-L214】【F:src/main.js†L433-L447】
- Developer tooling keeps track of override suppression flags on the shared `scene.userData.weather` object, but those flags are only toggled through console commands, meaning gameplay has no awareness of when manual overrides should pause or resume automated rotation.【F:src/player/dev-commands.js†L76-L89】【F:src/player/dev-commands.js†L1653-L1714】
- The underwater HUD is appended directly to the DOM during boot so it is always visible when players enter water, whereas the weather system lacks an equivalent in-game driver to prove particles are active without relying on console commands.【F:src/main.js†L32-L68】

## Manual Testing Symptoms
- The `/weather debug` subcommand reads particle-system statistics and prints whether any emitters labeled “weather” are alive, but the command must be rerun manually and provides no guidance on why emitters failed to appear.【F:src/player/dev-commands.js†L1532-L1587】
- When `particleSystem.emit` returns a falsy handle, `spawnPrecipitationEffect` records a failure count and logs a warning, yet there is no proactive signal to surface the failure to players beyond consulting diagnostics after the fact.【F:src/world/weather/weather-manager.js†L338-L370】
- Active precipitation emitters anchor themselves to the player each frame, so if spawning succeeds we expect to see rain or snow volumes following the camera; the absence of any visuals implies either emitters are not spawned, are culled immediately, or are suppressed before they can update.【F:src/world/weather/weather-manager.js†L338-L420】【F:src/world/weather/weather-manager.js†L500-L551】

## Candidate Root Causes
1. **No gameplay driver for weather rotation** – Without a biome-aware scheduler, the manager stays on `clear_skies`, so precipitation never spawns unless testers intervene through the console.【F:src/main.js†L433-L447】【F:src/world/weather/weather-manager.js†L555-L569】
2. **Suppression state not integrated with runtime** – Console commands can freeze weather by forcing `overridesSuppressed`, but gameplay lacks logic to respect or clear that flag, leading to mismatches between developer expectations and automated behavior.【F:src/player/dev-commands.js†L76-L89】【F:src/player/dev-commands.js†L1653-L1714】
3. **Emitter spawn reliability unverified** – The rain and snow emitters expose debug labels and configuration hooks, yet there is no automated harness confirming that `particleSystem.emit` succeeds or that the emitter persists long enough to render.【F:src/rendering/particles/weather-rain.js†L8-L51】【F:src/world/weather/weather-manager.js†L338-L420】

## Proposed Diagnostic Tooling
- **Weather rotation harness** – Add a small developer utility (invoked from the console or a debug hotkey) that cycles through the resolved biome rotation, calls `scheduleWeatherChange`, and streams overlay updates so we can observe whether emitters appear, similar to how the underwater overlay permanently resides on screen.【F:src/world/weather/weather-manager.js†L555-L569】【F:src/main.js†L32-L68】
- **Real-time emitter probe** – Extend the diagnostic overlay to poll `particleSystem.getDebugInfo()` every frame, highlighting when precipitation emitters fail to register or immediately dispose, providing parity with the automated underwater bubble feedback loop.【F:src/ui/weather-debug-overlay.js†L1-L94】【F:src/world/weather/weather-manager.js†L591-L620】
- **Unit-test scaffolding** – Mock the particle system within Jest to assert that `setWeather('misty_rain')` issues at least one `emit` call and to simulate failure paths, ensuring regressions are caught in CI rather than by manual QA.【F:src/world/weather/weather-manager.js†L338-L370】【F:src/world/weather/weather-manager.js†L506-L569】

## 2025-04 Diagnostic Harness Progress
- `createWeatherManager` now exposes `startRotationHarness`, `stopRotationHarness`, and `getRotationHarnessStatus`, which drive automated preset cycling, schedule follow-up transitions, and record rotation metadata on `scene.userData.weather` for the overlay.【F:src/world/weather/weather-manager.js†L232-L911】
- The developer console gained `/weather harness [start|once|stop|status]`, sampling the player’s current biome, resolving its weather rotation, and toggling the harness while clearing manual suppression flags so automated cycles are visible immediately.【F:src/player/dev-commands.js†L1508-L1669】
- The weather debug overlay now streams particle-system diagnostics every frame, reporting precipitation emitter particle counts, retry windows, last failure reasons, and harness timing so testers can watch the system recover without rerunning console commands.【F:src/ui/weather-debug-overlay.js†L1-L156】【F:src/world/weather/weather-manager.js†L872-L940】
- Rain emitters were retuned (higher particle budget, longer lifetimes, faster anchor updates) to match the reliability of the underwater bubble effects and guarantee visible spawn when the harness cycles into rain-heavy presets.【F:src/rendering/particles/weather-rain.js†L9-L53】【F:src/rendering/particles/water-effects.js†L46-L80】

Please continue appending follow-up findings or configuration changes here whenever the harness or emitter settings evolve.

## Work Orders
1. **Gameplay-driven rotation**
   - Sample the player’s biome each frame (reusing the `sampleBiomeAt` helper from `/weather status`) and resolve the preset rotation with `resolveBiomeWeatherRotation`, storing timing metadata per biome.【F:src/player/dev-commands.js†L1532-L1562】【F:src/world/weather/weather-manager.js†L76-L127】
   - Trigger `scheduleWeatherChange` when the active preset expires or the biome changes, skipping work while `overridesSuppressed` is true so developer overrides remain authoritative.【F:src/world/weather/weather-manager.js†L555-L569】【F:src/player/dev-commands.js†L1653-L1714】
   - Persist the last automatically applied preset on `scene.userData.weather` so the diagnostic overlay and console output remain synchronized.【F:src/world/weather/weather-manager.js†L310-L324】
2. **Emitter validation tooling**
   - Implement the weather rotation harness described above, exposing metrics (last spawn time, emitter count, particle totals) without requiring manual console commands.【F:src/world/weather/weather-manager.js†L338-L420】【F:src/ui/weather-debug-overlay.js†L1-L125】
   - Add verbose logging or counters around `particleSystem.emit` to capture initialization failures, mirroring the underwater system’s always-on UI feedback for easier triage.【F:src/world/weather/weather-manager.js†L338-L370】【F:src/main.js†L32-L68】
3. **Regression coverage**
   - Create `src/world/__tests__/weather-manager.test.js` that mocks `particleSystem.emit` to verify precipitation emitters spawn and that failure counters increment when handles are missing.【F:src/world/weather/weather-manager.js†L338-L370】【F:src/world/weather/weather-manager.js†L506-L569】
   - Integrate the new suite into the existing `npm test` workflow so CI guards against future weather visual regressions.【F:package.json†L6-L11】

