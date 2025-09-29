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
