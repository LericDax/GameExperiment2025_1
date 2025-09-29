
# Weather Visuals Investigation

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

# Weather Remediation Investigation

## Current Findings
- Weather presets only advance when developers call `/weather`, so the runtime remains on `clear_skies` even though the weather manager is stepped every frame. The biome-driven rotation helpers exist but are never invoked from the main loop.
- Precipitation emitters still fail silently when particle handles are missing; the previous logging is easy to miss and no HUD reflects the failure counts.
- Unlike the underwater HUD (which uses a dedicated DOM overlay), weather diagnostics previously wrote only to `scene.userData`, leaving QA without real-time confirmation of active emitters or suppression state.

## Instrumentation Added
- Weather state now persists counters, anchor timestamps, and suppression metadata directly on `scene.userData.weather` so runtime tools can see failure spikes without clobbering earlier diagnostics.
- A dedicated weather diagnostic HUD is wired through `registerDiagnosticOverlay`, mirroring the always-on underwater overlay pattern so QA immediately sees active presets, suppression status, emitter/particle counts, anchor recency, and failure history.
- The `/weather` developer command updates the shared weather state when suppression toggles occur, keeping console overrides and on-screen diagnostics aligned.

## Outstanding Work Orders
1. **Automate biome-driven weather rotation** — sample the player’s biome during the animation loop and advance rotations with `resolveBiomeWeatherRotation` plus `scheduleWeatherChange`, pausing when overrides are suppressed.
2. **Backfill precipitation emitter coverage** — add unit tests for `createWeatherManager` that assert precipitation emitters spawn handles and that failure counters increment when handles are missing.
3. **Audit particle label consistency** — ensure rain, snow, and aurora emitters expose a uniform `debugLabel` prefix so the new HUD and `/weather debug` can always identify weather emitters across future presets.

