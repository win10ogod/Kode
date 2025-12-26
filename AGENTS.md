# AGENTS.md

## Commands
- Install: `bun install`
- Dev: `bun run dev`
- Build: `bun run build`
- Clean: `bun run clean`
- Lint: `bun run lint` (fix: `bun run lint:fix`)
- Format: `bun run format` (check: `bun run format:check`)
- Typecheck: `bun run typecheck`
- Test: `bun test`
- Single test: `bun test path/to/test` or `bun test -t "name"`

## Code Style
- TypeScript/TSX, React (Ink); use existing module aliases from `tsconfig.json`.
- Prefer existing utilities; do not add new deps without confirming in `package.json`.
- Keep edits consistent with Prettier/ESLint; run format/lint on changes.
- Favor clear error messages and graceful degradation; avoid logging secrets.
- ASCII-only edits unless file already uses Unicode.
- No Cursor/Copilot rules found.
