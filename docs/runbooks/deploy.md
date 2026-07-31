# Deployment and rollback runbook

Use this runbook only after the user explicitly authorizes a deployment. A commit, push, and Cloudflare deployment are separate actions and must be reported separately.

## Scope

- Cloudflare application/API Worker: `app.yintsun66.com` and `api.yintsun66.com`
- Worker project: `backend/`
- Compatibility GitHub Pages site remains a separate deployment path for the root static files.

## Pre-deployment checklist

1. Confirm the approved scope and exact files in `git diff`.
2. Confirm no secrets, raw mail, personal data, private artifacts, or unintended lockfile changes are in the diff.
3. Preserve unrelated staged/unstaged/untracked work.
4. Run from repository root:

   ```powershell
   node --check backend-client.js
   Set-Location backend
   pnpm run typecheck
   pnpm test
   pnpm run build
   ```

5. Inspect `git diff --check` and `git status --short`.

## Commit

Only when approved:

```powershell
git add -- <approved files>
git commit -m "type(scope): concise change"
```

Do not stage generated directories such as `backend/public/`, `backend/dist/`, or `backend/worker-configuration.d.ts`.

## Deploy Cloudflare Worker

From `backend/`:

```powershell
pnpm run build
pnpm exec wrangler deploy
```

This uploads Worker code and generated static assets. It must not be used to change D1 migrations, secrets, email routing, bindings, or account plan settings unless those changes were separately approved.

## Verify

Use a cache-busting asset request and the health endpoint:

```powershell
$asset = Invoke-WebRequest -UseBasicParsing -Uri ("https://app.yintsun66.com/backend-client.js?verify=" + [Guid]::NewGuid())
$health = Invoke-WebRequest -UseBasicParsing -Uri "https://api.yintsun66.com/api/v1/health"
$asset.StatusCode
$health.Content
```

Also verify the changed UI/function with the appropriate authorized test account. Do not create an RFQ or real outbound email merely as a deployment check unless the user explicitly authorizes it.

## Rollback

Only when explicitly authorized:

1. Open Cloudflare Dashboard → **Workers & Pages** → `fcn-quote-api` → **Deployments**.
2. Select the last known-good Worker version and use Cloudflare’s rollback action.
3. Re-run the health and changed-asset verification above.
4. Record the reason, previous/current Worker version IDs, and verification result in `docs/HANDOFF.md`.

Do not use destructive Git commands as a substitute for a production rollback.
