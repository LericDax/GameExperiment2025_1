# Repository Guidelines

## Project Structure
- This repo has **two entry points**:
  - The root-level `index.html` is a static CDN-friendly entry that loads modules from `src/` directly in the browser.
  - The `three-demo/` directory contains a Vite-powered playground (`npm run dev`) that also consumes the shared `../src/` modules.
- When changing anything under `src/`, verify that both entry points continue to work:
  - Avoid bundler-only globals or Node-specific APIs in shared modules.
  - Keep import paths relative and extensionless so they resolve in both the browser (via CDN) and Vite.
  - If a change requires environment-specific code, gate it behind runtime checks inside the entry files rather than inside `src/`.

## Code Style
- Use modern ES modules everywhere (`import`/`export` syntax, no CommonJS).
- Prefer named exports when possible; default exports are reserved for module entry points.
- Follow Prettier defaults for formatting (2-space indentation, semicolons, trailing commas where valid, and single quotes for strings).
- Keep shared logic (`src/`) free of DOM-specific code—DOM setup lives in the entry files.
- When editing an existing file, keep any intentional local deviations but leave a comment explaining why if you must diverge.

## Tooling & Mandatory Commands
- Install dependencies for the Vite demo before running commands:
  ```sh
  cd three-demo
  npm install
  ```
- During development you can run the playground with:
  ```sh
  npm run dev
  ```
  This serves the app at `http://localhost:5173/` by default.
- Before submitting changes, ensure the demo still builds:
  ```sh
  npm run build
  ```
- The static build can be checked by opening the root `index.html` in a browser (use a local web server if your browser blocks module imports from `file://`).

## PR Message Expectations
- Provide a concise bullet summary of the functional changes, referencing the main modules you touched.
- List every command you ran (tests, builds, linters) with their outcomes.
- Call out any follow-up work or limitations that reviewers should know about.

## Extending These Rules
- If a subdirectory needs more specific guidance later, add another `AGENTS.md` within that folder. Nested instructions override the broader rules above for files in their subtree.
