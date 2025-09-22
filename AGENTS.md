# Repository Guidelines

## Project Structure
- The Vite workspace in `three-demo/` is now the **sole application entry point**.
  - All gameplay modules live under `three-demo/src/`.
  - The root `index.html` only documents how to launch the Vite dev server or serve the production build.
- When modifying code under `three-demo/src/`, make sure it continues to work with the Vite tooling (dev server and build output).

## Code Style
- Use modern ES modules everywhere (`import`/`export` syntax, no CommonJS).
- Prefer named exports when possible; default exports are reserved for module entry points.
- Follow Prettier defaults for formatting (2-space indentation, semicolons, trailing commas where valid, and single quotes for strings).
- Keep shared logic (`three-demo/src/`) free of DOM-specific code—DOM setup lives in the entry files.
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
- The root `index.html` is informational only; always use the Vite dev server or build output for testing.

## PR Message Expectations
- Provide a concise bullet summary of the functional changes, referencing the main modules you touched.
- List every command you ran (tests, builds, linters) with their outcomes.
- Call out any follow-up work or limitations that reviewers should know about.

## Extending These Rules
- If a subdirectory needs more specific guidance later, add another `AGENTS.md` within that folder. Nested instructions override the broader rules above for files in their subtree.
