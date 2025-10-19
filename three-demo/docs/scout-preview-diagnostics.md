# Scout Preview Streaming Diagnostics

Widened scout shells increase the amount of temporary geometry we stream before a full chunk activates. QA can now monitor those buffers directly in-game to ensure memory headroom is healthy before a build ships.

## Developer console command

Use the `/chunkmem` command from the in-game developer console to print the current streaming totals.

```
/chunkmem
```

The command reports:

- `Loaded` – total chunks currently resident in the scene.
- `scout detail` – how many of those chunks are still using the lightweight scout meshes.
- `tracked previews` – the number of scout previews with memory metrics attached (should match the scout count when generation is caught up).
- A per-buffer breakdown of vertex, color, and index memory plus the combined total. When at least one scout is active, the line also shows the average preview footprint per chunk so you can project total usage for larger scout rings.

Re-run the command after flying around test sectors to confirm we are not breaching the agreed safety margin for preview buffers.

## Programmatic stats

For automated soak scenarios you can call the new `chunkManager.getStreamingStats()` helper. It returns the same totals that power `/chunkmem`, including:

- `loadedChunkCount`
- `scoutChunkCount`
- `previewMemory.vertexBytes`, `previewMemory.colorBytes`, `previewMemory.indexBytes`
- `previewMemory.totalBytes`
- `previewMemory.perChunkAverageBytes`

The debug snapshot (`chunkManager.debugSnapshot()`) now embeds these stats as well, so existing tooling that already polls the snapshot will pick up the new metrics automatically.

## QA checklist

1. Load into the target biome ring and allow scouts to populate.
2. Run `/chunkmem` to capture a baseline total and per-chunk average.
3. Expand the scout shell (fly, teleport, or use automated sweeps) until the maximum intended radius is active.
4. Re-run `/chunkmem` and verify the total preview memory remains below the release cap agreed with engineering.
5. Document the totals alongside your build validation notes for regression tracking.
