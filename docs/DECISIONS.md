# Design decisions

Each entry: the problem, the options, the choice, and why.

## D1. Gradual TypeScript migration with `allowJs`

- **Problem:** the backend is plain CommonJS JavaScript. The plan asks for new modules (agent, RAG, MCP) in TypeScript without rewriting working code.
- **Options:** (a) rewrite everything in TS now; (b) Node's built-in type stripping; (c) `tsc` with `allowJs` compiling JS and TS together into `dist/`, `tsx` in development.
- **Choice:** (c).
- **Why:** JS and TS files can `require` each other, so files are converted only when touched. Type stripping does not support every TS feature and does not type-check. `tsc --noEmit` gives a real type-check step in CI.

## D2. Move the frontend from Create React App to Vite

- **Problem:** CRA (`react-scripts`) is deprecated and pins Jest 27. The plan asks for Vitest.
- **Options:** keep CRA and add Vitest beside it; eject; migrate to Vite.
- **Choice:** Vite, with Vitest sharing the same config.
- **Why:** one build tool for dev, build and tests; much faster startup. The cost was small: renaming two entry files, moving `index.html`, and renaming `REACT_APP_*` env vars to `VITE_*`.

## D3. Own migration runner instead of a migration library

- **Problem:** the schema only existed as a SQL block in the README.
- **Options:** node-pg-migrate, Knex, Prisma, a small runner.
- **Choice:** a ~60-line runner (`backend/db/migrate.js`) applying `.sql` or `.js` files in order and recording them in `schema_migrations`, guarded by an advisory lock.
- **Why:** the app uses raw `pg` everywhere, some migrations need code (creating roles with passwords from env), and a small runner is easy to explain line by line.
