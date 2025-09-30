
# Weather Visuals Investigation

> **Team note:** Keep this plan current after any further weather fixes or experiments—add new findings, tooling, and regressions here so the next investigator starts with the latest context.

## Observed Gaps
- The main render loop instantiates `createWeatherManager` and advances it every frame, yet nothing in gameplay ever schedules a preset beyond the default `clear_skies`, so weather state never changes during normal play.【F:src/main.js†L187-L214】【F:src/main.js†L433-L447】
- Developer tooling keeps track of override suppression flags on the shared `scene.userData.weather` object, but those flags are only toggled through console commands, meaning gameplay has no awareness of when manual overrides should pause or resume automated rotation.【F:src/player/dev-commands.js†L76-L89】【F:src/player/dev-commands.js†L1653-L1714】
- The underwater HUD is appended directly to the DOM during boot so it is always visible when players enter water, whereas the weather system lacks an equivalent in-game driver to prove particles are active without relying on console commands.【F:src/main.js†L32-L68】

## Manual Testing Symptoms
- The `/weather debug` subcommand reads particle-system statistics and prints whether any emitters labeled “weather” are alive, but the command must be rerun manually and provides no guidance on why emitters failed to appear.【F:src/player/dev-commands.js†L1532-L1587】
- When `particleSystem.emit` returns a falsy handle, `spawnPrecipitationEffect` records a failure count and (as of May 2025) queues a follow-up attempt that the overlay reports as a pending retry, keeping testers aware of self-healing behaviour without rerunning console probes.【F:src/world/weather/weather-manager.js†L258-L363】【F:src/ui/weather-debug-overlay.js†L86-L143】
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

## 2025-05 Regression Coverage Updates
- Added a node:test case that boots the real GPU billboard particle system, applies the `misty_rain` preset, and advances both managers until `particleSystem.getDebugInfo()` reports active “weather” emitters—proving end-to-end precipitation spawning works without mocks.【F:src/world/__tests__/weather-manager.test.js†L1-L127】
- Remaining gaps: the suite still lacks automated checks for aurora ribbons, anchor repositioning against live player controls, and rotation-harness scheduling edge cases—these should follow once we expose lightweight test doubles for those systems.
- Missing precipitation handles now trigger scheduled retries that are stored on `scene.userData.weather.pendingPrecipitationRetries`, increment `precipitationRecoveryAttempts`, and surface upcoming retry windows plus reasons in the overlay so live sessions show when the system will self-heal.【F:src/world/weather/weather-manager.js†L258-L381】【F:src/ui/weather-debug-overlay.js†L86-L143】

> **Reminder for reviewers:** please continue keeping this remediation plan up to date whenever you touch weather logic or diagnostics so future investigators inherit an accurate coverage map. Be especially diligent about updating the new retry/overlay notes whenever precipitation recovery logic or diagnostics evolve.

Please continue appending follow-up findings or configuration changes here whenever the harness or emitter settings evolve.

## 2025-06 Misty Rain Visual Pass
- Retuned `createWeatherRainEmitter` with a brighter cyan-to-white color ramp, additive blending, and an increased spawn budget so misty rain stands out alongside the water bubble effects.【F:src/rendering/particles/weather-rain.js†L9-L52】
- The end-to-end precipitation regression test now requires the live rain emitter to reach at least 18 active particles, matching the new readability targets.【F:src/world/__tests__/weather-manager.test.js†L170-L198】
- **Reminder:** keep this section updated whenever precipitation visuals or thresholds change so QA can track expectation shifts alongside the documented plan.

## 2025-07 Raindrop Overlay Diagnostics
- Added a lightweight screen-space raindrop overlay that tracks the camera, scales with precipitation intensity, and is created or disposed alongside rain emitters so `/weather misty_rain` always renders a visible drizzle cue for testers.【F:src/rendering/effects/raindrop-overlay.js†L1-L147】【F:src/world/weather/weather-manager.js†L262-L407】
- Exposed `/weather overlay` developer-console controls to toggle the overlay, adjust manual intensity, or reset to automatic behaviour for quick regression probes without touching presets.【F:src/player/dev-commands.js†L1443-L1542】
- **Reminder:** keep this remediation plan current whenever the overlay visuals or tooling change so future weather investigators inherit accurate guidance.

## 2025-08 Rain Overlay Visibility Tuning
- Boosted the automatic raindrop overlay scaling (min `0.24`, scale `0.95`, max `1.35`) so rainy presets, including `/weather misty_rain`, now drive the effect close to full strength without relying on manual overrides.【F:src/world/weather/weather-manager.js†L68-L115】【F:src/world/weather/weather-manager.js†L229-L248】
- Switched the raindrop shader to additive blending with a `0.55` opacity multiplier to increase contrast when precipitation particles are occluded, providing a clearer fallback cue for QA when rain volumes underperform.【F:src/rendering/effects/raindrop-overlay.js†L1-L86】
- Added a unit test that locks the overlay intensity maths to the new tuning so future adjustments must update this plan and QA expectations in tandem—treat the stronger overlay as the fallback visibility requirement during manual checks.【F:src/world/__tests__/weather-manager.test.js†L1-L138】

## 2025-09 High-Contrast Rain Refresh
> _Historical note:_ superseded by the 2025-10 bright-streak shader but retained here so we remember why the earlier pass existed.
- Reworked `createWeatherRainEmitter` with thicker billboards, a dark-to-ice-blue color ramp, and normal blending so rain streaks retain contrast during daylight scenes.【F:src/rendering/particles/weather-rain.js†L1-L92】
- Increased spawn and lifetime budgets to keep at least 30 active particles during the regression harness and renamed the debug label to `WeatherRainEmitter/HighContrast` so tooling can confirm the look is active.【F:src/rendering/particles/weather-rain.js†L1-L92】【F:src/world/__tests__/weather-manager.test.js†L160-L230】
- Updated the regression test to assert both the higher particle floor and the high-contrast label—future changes must update this plan *and* the test expectations together to avoid silent drift.【F:src/world/__tests__/weather-manager.test.js†L160-L230】
- **QA checklist (legacy):**
  - Trigger `/weather misty_rain` (or cycle via the harness) at midday lighting and verify streaks remain visible against bright terrain.
  - Confirm the weather debug overlay reports the `WeatherRainEmitter/HighContrast` label and at least 30 active particles once the emitter stabilises.
  - Re-run `/weather debug` to ensure the darker-core ramp remains readable when the overlay is disabled, noting any deviations here.
- **Reminder:** When retuning rain visuals or thresholds, update this section, the automated test expectations, and any overlay heuristics so QA retains a single source of truth.

## 2025-10 Bright-Streak Rain Shader
- Swapped the rain fragment shader to `weather-rain-streak.glsl.js`, introducing wind-tilt, streak-noise, and highlight-width uniforms so we can tune sheen and gusts without rebuilding the emitter.【F:src/rendering/particles/weather-rain.js†L1-L109】【F:src/rendering/shaders/weather-rain-streak.glsl.js†L1-L54】
- `createWeatherRainEmitter` now feeds those uniforms, thickens the base billboard width to ~0.35–0.45 m, and renames the debug label to `WeatherRainEmitter/BrightStreakPass` to match the new look.【F:src/rendering/particles/weather-rain.js†L13-L109】【F:src/world/__tests__/weather-manager.test.js†L206-L231】
- Manual precipitation overrides (`scene.userData.weather.manualOverrides.precipitation`) can force intensity or wind parameters at runtime so `/weather` QA scripts can probe edge cases; the manager keeps snapshots in emitter diagnostics.【F:src/world/weather/weather-manager.js†L300-L430】【F:src/world/weather/weather-manager.js†L930-L1074】【F:src/world/__tests__/weather-manager.test.js†L120-L205】
- Regression coverage now locks the bright-streak label, a 34-particle floor, and uniform override behaviour so shader tweaks stay visible in CI.【F:src/world/__tests__/weather-manager.test.js†L198-L264】
- **QA checklist:**
  - Trigger `/weather misty_rain` under daylight; ensure the overlay reports `WeatherRainEmitter/BrightStreakPass` with ≥34 active particles after stabilisation.【F:src/world/__tests__/weather-manager.test.js†L206-L231】
  - Use `/weather` overrides (or edit `scene.userData.weather.manualOverrides.precipitation`) to test gust extremes—verify wind tilt, streak noise, and highlight width respond live via the overlay and rain visuals.【F:src/world/weather/weather-manager.js†L300-L430】【F:src/world/weather/weather-manager.js†L1012-L1115】
  - Keep `/weather debug` handy to confirm manual overrides propagate into the emitter summaries (uniform readouts now surface in diagnostics).【F:src/world/weather/weather-manager.js†L1260-L1310】

## 2025-11 Parallax Rain Overlay Controls
- Rebuilt the screen-space raindrop fragment shader with three parallaxed streak layers, wind-driven tilt, and sparkle pulses, exposing uniforms for wind speed, streak density, and sparkle gain so QA can see gust variations even when world particles underperform.【F:src/rendering/effects/raindrop-overlay.js†L1-L192】
- Weather manager now derives overlay wind/density/sparkle from precipitation configs (with clamps), persists the applied values on `scene.userData.weather.raindropOverlay`, and exposes manual setters for `/weather overlay` to tweak wind and density live.【F:src/world/weather/weather-manager.js†L229-L540】【F:src/world/weather/weather-manager.js†L1267-L1752】
- `/weather overlay wind|density` commands apply those manual overrides, extend the status readout, and a new regression checks the clamps, metadata persistence, and override clearing so CI guards the documented intensity scale—update this plan alongside future tuning shifts.【F:src/player/dev-commands.js†L1780-L1900】【F:src/world/__tests__/weather-manager.test.js†L132-L268】
- **Reminder:** keep this section synchronized whenever you touch the overlay shader, uniform maths, or console tooling so QA expectations, metadata snapshots, and tests stay aligned.

## 2025-12 Rain Splash Layer
- Introduced `createWeatherRainSplashEmitter`, a short-lived additive spark emitter that jitters around the player using the active precipitation radius so rainy presets now feature upward splash bursts near ground contact.【F:src/rendering/particles/weather-rain-splashes.js†L1-L54】
- Weather manager spawns the splash layer alongside rain streaks, anchors it with the same radius/height offsets, and stops both handles together when presets change, preventing orphan emitters during retries.【F:src/world/weather/weather-manager.js†L1193-L1428】【F:src/world/weather/weather-manager.js†L1849-L1886】
- Regression coverage now asserts that rainy presets surface a splash handle, validates it is disposed when weather clears, and updates retry expectations to account for the extra emitter—future tweaks must adjust these tests and this plan in tandem.【F:src/world/__tests__/weather-manager.test.js†L83-L158】【F:src/world/__tests__/weather-manager.test.js†L430-L640】
- **QA checklist:**
  - Trigger `/weather misty_rain` (or cycle via the harness) and stand near ground; confirm bright streaks are accompanied by fast upward splash sparks within the precipitation radius, concentrated around the player’s feet.【F:src/rendering/particles/weather-rain-splashes.js†L15-L47】
  - Watch the weather debug overlay for both the bright-streak and splash debug labels, ensuring the splash handle appears/disappears as presets switch and that retries clean up the previous layer.【F:src/world/weather/weather-manager.js†L1334-L1418】【F:src/world/__tests__/weather-manager.test.js†L94-L158】
  - **Reminder:** Keep this splash section current whenever you retune intensity, spawn budgets, or cleanup logic so QA and diagnostics stay aligned.

## 2025-12 Fallback Rain Billboard
- Added `createWeatherRainBillboardEmitter` as the default rain streak path, keeping the bright-streak shader opt-in while exposing the new `WeatherRainEmitter/BillboardFallback` label for diagnostics and overlays.【F:src/rendering/particles/weather-rain.js†L1-L118】【F:src/world/weather/weather-manager.js†L1395-L1565】
- Weather manager now records both the fallback and splash layers on `scene.userData.weather.precipitationLayers`, and regression tests confirm the metadata clears and repopulates as emitters stop, retry, and recover.【F:src/world/weather/weather-manager.js†L520-L611】【F:src/world/__tests__/weather-manager.test.js†L83-L210】
- The end-to-end particle harness now looks for the fallback label with a 30-particle floor, restoring QA confidence when the bright shader is disabled.【F:src/world/__tests__/weather-manager.test.js†L720-L816】

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

