# Contributing

## Branch Model

- `main` is production.
- `development` is integration/staging.
- `feature/*` branches are active work.

## Workflow

1. Pull latest changes before starting.

   ```sh
   git checkout development
   git pull origin development
   ```

2. Create a feature branch from `development`.

   ```sh
   git checkout -b feature/your-feature-name
   ```

3. Keep changes small and focused.

4. Run validation before opening a pull request.

   ```sh
   bun run typecheck
   bun run build
   ```

5. Open a pull request into `development`.

6. Merge `development` into `main` only after validation.

## Project Safety

- Preserve existing app behavior unless a change request says otherwise.
- Do not modify database schema or persistent data contracts without explicit approval.
- Do not add dependencies without explaining why.
- Keep OCR, watcher, import, and CPT logic scoped to their feature branches.
