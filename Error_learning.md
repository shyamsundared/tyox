# Error Learning Log

This file tracks implementation errors and confusing failures encountered while building Tyox. It records the symptom, why it happened, the change that fixed it, and what was verified. Add future entries here so the project history remains useful as a learning and resume resource.

## Current project status

- The PostgreSQL database selected by `db/.env` was aligned to the current Tyox contract. The CLI's strict verification reported that its marker and schema match the contract.
- `db/db.ts` now loads `db/.env` relative to its own file. Backend and agent imports therefore do not depend on the shell's current directory for `DATABASE_URL`.
- Signup and login routes are registered before the generic chat route so Express dispatches them correctly.
- A read-only query through the backend succeeded after the environment fix. An empty signup request reached the signup handler and returned its expected validation response.
- The currently observed unconnected-driver error came from an agent process that was started before the environment-loading fix; restart that process to construct a client with the configured URL.
- Frontend production build and backend/agent scoped TypeScript checks succeeded during this pass.
- A real signup-and-chat end-to-end flow has not yet been exercised. No test account was created during diagnosis.
- Prisma reports no versioned migrations in the migration graph. The current database was updated directly; add migration packages before relying on repeatable upgrades across environments.

## Errors and fixes

### 1. Database contract described another project's schema

**Symptom:** The checked-in migration snapshot described generic `User` and `Post` models, while Tyox uses users, projects, conversation histories, messages, and todos. The live database also contained unrelated objects such as `Market`, `Order`, and `Fills`. Its user identifiers and fields did not match the current Tyox contract.

**Cause:** This project was pointed at a PostgreSQL database previously used by another project, and its schema/migration metadata had not been brought in line with Tyox.

**Fix:** Rewrote `db/schema.prisma`, emitted `schema.json` and `schema.d.ts`, then applied the current contract to the configured database and advanced the local `db` reference.

**Data impact:** The user explicitly authorized replacing the old schema. Prisma's preview listed destructive operations, including dropping the unrelated tables, old user columns, and old enum types. The database update applied 30 operations. This removed the old project's data and structures in that target database.

**Verification:** `bun prisma db verify --strict` reported that the database marker and schema match the Tyox contract. `bun prisma migration status` reported no migrations found; the database is aligned, but future schema changes still need versioned migrations.

**Learning:** Emitting a Prisma contract only updates generated contract artifacts. It does not apply a schema to PostgreSQL. Inspect the target and migration plan before applying a schema update, because aligning an unrelated database can drop its data.

### 2. Signup was routed into the chat endpoint

**Symptom:** Clicking **Create account** appeared to do nothing, and the page showed `message is required`.

**Cause:** Express evaluates routes in registration order. The generic `POST /api/v1/:projectid` chat route was registered before `POST /api/v1/signup`. Express treated `signup` as a project ID and ran the chat handler, which expects a `message` body.

**Fix:** Moved the exact `/api/v1/signup` and `/api/v1/login` handlers above the generic `/:projectid` handler in `backend/index.ts`.

**Verification:** After the running backend was refreshed, `POST /api/v1/signup` with an empty JSON body returned `400` with `username and password are required`, proving the request reached signup validation instead of chat validation. A real account creation was not performed as part of this check.

**Learning:** Put specific routes before parameterized catch-all routes, or constrain the parameter route so it cannot match reserved names. When a button seems inert, check the browser Network panel and confirm which route handled the request.

### 3. Environment loading depended on the working directory

**Symptom:** The ORM reported `Database error while reading contract marker` when the backend was started from the repository root, even though Prisma CLI verification had succeeded.

**Cause:** `db/db.ts` used `import 'dotenv/config'`, which reads `.env` from the process's current working directory. The connection string is stored in `db/.env`, so starting from the repository root did not set `DATABASE_URL`. The non-null assertion in `process.env['DATABASE_URL']!` only affects TypeScript; it does not ensure the variable exists at runtime.

**Fix:** `db/db.ts` now calls `dotenv.config` with a path resolved from `import.meta.dir`, so it loads `db/.env` regardless of the command's working directory. Existing process environment variables keep precedence because dotenv does not override them by default.

**Verification:** From the repository root, `DATABASE_URL` was initially absent and an ORM read failed. After the change, it loaded from `db/.env`; a read-only ORM query succeeded, and a read-only request through the running backend returned `200`.

**Learning:** Environment files are not automatically discovered relative to the source file. Make the path explicit or ensure the deployment environment injects the required variables. Validate required configuration at startup to get a direct error instead of an indirect database-marker error.

### 4. `Postgres driver not connected` after an unset connection URL

**Symptom:** The runtime reported `Postgres driver not connected. Call connect(binding) before acquireConnection or execute`.

**Cause:** The Prisma facade connects lazily. When the client is constructed without a usable URL/binding, the first operation cannot acquire a connection. In this project the missing `DATABASE_URL` from the working-directory issue was the underlying configuration problem; the non-null TypeScript assertion did not fix it.

**Fix:** Load `db/.env` before constructing the module-level `postgres<Contract>` client, as described above. With a valid URL, the facade connects on its first query; application code does not need to call `connect(binding)` manually for this configuration.

**Verification:** A fresh read-only ORM query from the repository root succeeded once the database URL was loaded and local database access was allowed.

**Learning:** Distinguish a missing runtime binding from a schema mismatch. A marker-read wrapper can hide the lower-level connection cause; inspect the connection configuration and retry with the exact same runtime client after fixing it.

### 5. Root TypeScript check included personal practice code

**Symptom:** `bunx tsc --noEmit` at the repository root reported `prac/agent_index.ts(22,37): error TS1109: Expression expected`.

**Cause:** The root TypeScript configuration includes the personal `prac/` practice folder, which currently contains intentionally incomplete code. This is separate from the backend, agent, and frontend application source.

**Fix/status:** `prac/` was left untouched as requested. The root `tsconfig.json` now excludes the practice folder from the application TypeScript project.

**Verification:** Frontend, backend, and agent TypeScript checks passed when run against their own `tsconfig.json` files before this configuration change. The root check was not rerun after adding the exclusion.

**Learning:** Keep playgrounds and experiments outside a production TypeScript project's compilation scope, or give them their own configuration. An error in a practice file should not block checks of the application.

### 6. Local database access was blocked by the command sandbox

**Symptom:** The first local PostgreSQL dry run failed with `EPERM` while connecting to `localhost:5432`.

**Cause:** The command sandbox did not allow network access to the local PostgreSQL server. This was an execution permission issue, not a bad schema or database credential.

**Fix:** Re-ran database inspection/update commands with the required local database access permission. The preview then connected and displayed the destructive operations before the authorized update.

**Learning:** Separate operating-system/tool permission errors from application configuration errors. Do not infer that PostgreSQL is down solely from a sandboxed connection failure.

### 7. The running agent kept a database client created before the fix

**Symptom:** After fixing the database URL loading, the user still saw `Postgres driver not connected. Call connect(binding) before acquireConnection or execute`.

**Cause:** The backend on port 3000 had been restarted after the change, but the agent process on port 3001 was still running with its old in-memory database client. Process inspection showed the agent started at 15:34 while `db/db.ts` was updated at 15:50; the backend process started at 15:52. Changing a source file does not replace a module-level client in an already-running process unless that process uses hot reload.

**Fix:** Restart the agent process from its own directory so Bun also loads `agent/.env` for `GEMINI_API_KEY`; `db/db.ts` now independently loads `db/.env` for `DATABASE_URL`:

```sh
cd /Users/shyam/projects/tyox/agent
bun run index.ts
```

Stop the old process on port 3001 first (Ctrl+C in the terminal where it is running).

**Verification:** A fresh read-only query from the `agent/` directory succeeded with `DATABASE_URL` present. The existing server process was confirmed to predate the database loader change. Restart is still required to replace that old in-memory client.

**Learning:** Restart every long-running service that imports a changed singleton module. The backend and agent each import their own `db` module instance in separate processes, so restarting only one does not update the other.

### 8. Bun package changes could not write to the default temporary directory

**Symptom:** While removing unused packages and moving TypeScript declaration packages to development dependencies, Bun reported `bun is unable to write files to tempdir: PermissionDenied`.

**Cause:** Bun's package-management operation needed temporary files in the configured temp directory, but that write was denied in this environment.

**Fix:** Retry the package operation with `TMPDIR=/private/tmp`, a writable temporary directory for this workspace.

**Verification:** Bun could write a small file to `/private/tmp`, but package add/remove still returned the same temp-directory permission error. Lockfile-only regeneration succeeded for `db`, `frontend`, and the root package. After restoring the original agent/backend lockfiles and reconciling their manifests, `TMPDIR=/private/tmp bun install --cwd agent --lockfile-only` and the matching backend command both succeeded. No application build or typecheck was run during this cleanup.

**Learning:** Package-manager failures can come from the tool's temp-file permissions rather than a bad package name or broken dependency graph. Preserve the error, then retry with an explicitly writable temp directory.

### 9. A package edit did not match the manifest's current contents

**Symptom:** A combined patch to move type packages failed with `Failed to find expected lines`.

**Cause:** Earlier `bun remove` commands had already removed some of the packages from `package.json`, so the patch expected stale contents.

**Fix:** Re-read each manifest and apply changes against its current contents instead of assuming the earlier package operation made no changes.

**Verification:** The failed patch made no file changes. The manifests were re-read before preparing a corrected edit.

**Learning:** After a command partially succeeds, inspect the files before retrying or applying a patch. Package managers can save a lockfile or manifest before failing later in their install step.

### 10. The agent's shell tool schema and registry used different names

**Symptom:** Static review found that a model request for the shell tool would not match the agent's tool map, so the lookup would report an unknown tool.

**Cause:** The model tool schema called it `Bash_tool`, while the implementation registered it as `Bash_Tool`. Tool names are exact string keys.

**Fix:** Use the same `Bash_Tool` name in the schema and implementation, and give the tool definitions and implementations clear, consistent names.

**Verification:** Static inspection confirms both names now match. The agent was not run as part of this cleanup, so the fix has not been exercised in a live request.

**Learning:** Keep externally supplied tool names and internal registry keys in one shared constant or derive the map key from the definition to avoid case-sensitive mismatches.

## Checks run during this pass

| Check | Result |
|---|---|
| `bun prisma contract emit` | Passed; generated the contract JSON and TypeScript declarations. |
| `bun prisma db update --dry-run` | Passed after local DB access was allowed; showed the expected destructive replacement plan. |
| `bun prisma db verify --strict` | Passed; database schema and marker match the contract. |
| `bun prisma migration status` | No migrations found; direct schema alignment is complete, versioned migration history remains future work. |
| Frontend `bun run build` | Passed. |
| Backend and agent scoped `tsc --noEmit` | Passed. |
| Root `bunx tsc --noEmit` | Fails only because the root config includes the incomplete `prac/agent_index.ts`. |
| Backend read-only ORM/API query | Passed after `db/.env` loading was made independent of current directory. |

## Template for future entries

```md
### N. Short error title

**Symptom:** Exact error or user-visible behavior.

**Cause:** The specific code/configuration reason.

**Fix:** What changed, including the file or command.

**Verification:** The check that demonstrated the fix.

**Learning:** The reusable lesson.
```

### 11. The repository does not have a local `main` branch

**Symptom:** `git rev-parse --verify main` returned `fatal: Needed a single revision` while checking which branch the current work is based on.

**Cause:** This repository names its base branch `master`; there is no local branch named `main`. The current branch is `codex/qna-persistence`.

**Fix:** Compare against `master` (or `origin/master`) in branch and diff commands. `git branch -vv` shows the available local branches and their upstreams.

### 12. Bun's production build tried to bundle a runtime configuration URL

**Symptom:** The first `bun run --cwd frontend build` for deployment failed with `Could not resolve: "/config.js"` from `frontend/src/index.html`.

**Cause:** The HTML build bundles script references as part of the frontend. `/config.js` was intended to be an endpoint created by the running server, but it did not exist as a source file for Bun's build step.

**Fix:** The HTML now contains a small API URL placeholder. The production Bun server replaces it with the JSON-escaped `TYOX_API_URL` value when it serves `dist/index.html`. This keeps one built frontend image configurable for each Railway environment.

**Verification:** `bun run --cwd frontend build` succeeded and generated `dist/index.html`, JavaScript, and CSS assets. `bun run typecheck` also passed after the fix.

**Learning:** Distinguish build-time assets from runtime configuration. A URL served by the production server should not be treated as a source file that the bundler must resolve.

### 13. Local frontend server smoke check could not bind a port

**Symptom:** Starting the production frontend locally failed with `Failed to start server. Is port ... in use?` for ports 3302 and 43891. `lsof -nP -iTCP:43891 -sTCP:LISTEN` found no process listening on the second port.

**Cause/status:** The error text suggests a port conflict, but the port inspection did not confirm one. The local execution environment may be preventing the server from binding; this check does not establish whether the app can bind in Railway.

**Fix/status:** No application change was made based on an unconfirmed cause. The typecheck and production asset build both pass. A production Docker container later returned `200` for `/health` and `200` for `/`, with `TYOX_API_URL` injected into the HTML. The host-only bind failure did not reproduce inside the container.

**Learning:** Don't treat `EADDRINUSE` as proof that another process owns a port without checking the listener. Sandboxed environments can restrict network operations, so separate local tool limits from a production runtime failure.

### 14. Docker initially sent local development files as build context

**Symptom:** The first Docker image build began transferring a context larger than 1 GB, including local practice/output and dependency folders. I stopped it before the image build completed.

**Cause:** The repository did not have a root `.dockerignore`, so Docker sent the whole checkout to the builder even though each service image only needs a few source folders. That also risked including local `.env` files in the build context.

**Fix:** Added a root `.dockerignore` excluding dependencies, build output, local generated projects, `prac/`, `output/`, secrets, and personal learning files.

**Verification:** The first transfer was stopped before completion. After adding `.dockerignore`, the context was about 5 MB and the backend, agent, and frontend images all built successfully. No container was deployed.

**Learning:** Docker sends its build context before executing `COPY`. Exclude secrets and large local-only folders at the repository root, even when Dockerfiles copy only selected source paths.

**Verification:** `git rev-list --left-right --count master...HEAD` returned `0 1`: `master` has zero commits unique to it relative to this branch, and the current branch has one unique commit. `git log master..HEAD` shows that commit.

**Learning:** Do not assume a repository uses `main`; check the branch list first. Branch history comparisons show committed changes only, so inspect `git status` separately for uncommitted work.

### 12. Progress summaries appeared as `undefined` in the UI

**Symptom:** The agent's initial progress update displayed `undefined` instead of readable status text.

**Cause:** Gemini thought summaries are optional arrays of content blocks, not strings. Earlier code interpolated the entire summary as a string, which can turn an absent value into the literal text `undefined`. The frontend also allowed update events to continue into the normal chat-message handler.

**Fix:** Extract only text blocks from the summary, skip empty or literal `undefined` values, and make the frontend handle update events as status only before returning. Render status inside the conversation panel but outside the message list, and clear it when a new request starts or completes.

**Verification:** The frontend production build, agent TypeScript check, and backend source-file TypeScript check passed. The backend project-wide `tsc -p tsconfig.json` check failed on existing generated recipe-app files under `output/projects/...` (type-only imports, browser globals, DOM event target types, and possibly undefined fixture data); those files are outside this progress-update change. A live browser request was not run, so confirm the displayed status by restarting the agent and frontend dev servers and sending a prompt.

**Learning:** Check an SDK's declared data shape before formatting it. Handle progress events on a separate UI path so they do not become conversation messages.

### 13. Express request body was called like a function

**Symptom:** Creating a project returned `TypeError: req.body is not a function` at `backend/index.ts:98`.

**Cause:** Express's JSON middleware parses the request payload and assigns the resulting object to `req.body`. The route called it as `req.body()`, which attempts to invoke that object as a function.

**Fix:** Read the parsed payload as a property with `const body = req.body;`, then pass that object to the Zod schema.

**Verification:** The focused backend TypeScript check (`bunx tsc --noEmit --strict --skipLibCheck --target ESNext --module Preserve --moduleResolution bundler --types bun index.ts`) passed. This confirms the route compiles; a live project-creation request was not run.

**Learning:** In Express, middleware such as `express.json()` populates `req.body`; it is data, not a method.

### 14. Bun and npm could not initially install the E2B SDK

**Symptom:** `bun add e2b` failed with `bun is unable to write files to tempdir: PermissionDenied`, including a retry with `TMPDIR=/private/tmp`. An `npm install e2b --save` attempt did not finish in the restricted network environment and was interrupted.

**Cause:** The default workspace sandbox denied Bun's temporary-file operation, while npm could not complete its registry request.

**Fix:** Install the official E2B SDK with Bun's approved elevated package-install path. The agent manifest and lockfile now include `e2b`.

**Verification:** The SDK installed successfully as `e2b@2.53.1`; the agent TypeScript check passed after integration.

**Learning:** Package-manager temp-file or network failures do not necessarily indicate a dependency problem. Try the supported package manager with the required filesystem/network access before editing manifests by hand.

### 15. E2B_API_KEY was missing during the initial live check

**Symptom:** The integration's TypeScript check and frontend build passed, but the first E2B configuration check found no `E2B_API_KEY`.

**Cause:** `agent/.env` does not currently provide `E2B_API_KEY`.

**Fix:** The user added the E2B API key to `agent/.env`. The workspace manager also checks for this configuration and returns a direct setup message if it is missing.

**Verification:** The initial presence check returned false without reading or printing the key. After the user added it, the live sandbox smoke tests passed for sandbox creation, file read/write, command execution, and metadata-based reconnection.

**Learning:** A successful compile proves SDK types line up, but it does not prove credentials or sandbox operations work in the account; verify them with a short sandbox lifecycle check.

### 16. The E2B project directory was not writable at the filesystem root

**Symptom:** The first live E2B smoke test could create a sandbox, but file writes failed and shell commands reported that `/workspace` did not exist. The bootstrap `mkdir -p /workspace` returned a non-zero exit code because the default sandbox user could not create a top-level directory.

**Cause:** The implementation assumed the sandbox user could create `/workspace` at the filesystem root and did not check the bootstrap command's exit status.

**Fix:** Put the project workspace under the sandbox's writable `/tmp/tyox-project` directory and fail sandbox setup with the command output if directory creation fails.

**Verification:** The repeated live smoke test passed: the real E2B workspace manager created a project sandbox, wrote and read a nested file, and ran `pwd` with `/tmp/tyox-project` as its working directory. A second check cleared the process cache and successfully reconnected to the same sandbox through metadata. Both temporary sandboxes were killed in cleanup.

**Learning:** A sandbox isolates host access, but it still has its own user permissions. Use a writable working directory and check setup command exit codes.

### 17. The first E2B API call could not reach the E2B service

**Symptom:** The first sandbox smoke test returned `Was there a typo in the url or port?` from the E2B SDK.

**Cause:** The default command environment blocked outbound access to the E2B API, even though the E2B key was present.

**Fix:** Run the short verification command with approved network access. The app itself will also need outbound access to the E2B API when provisioning sandboxes.

**Verification:** The approved live smoke tests passed and their temporary sandboxes were killed afterward.

**Learning:** Distinguish missing credentials from blocked network access; the SDK may report network failures in generic URL/port terms.

### 18. The app preview could not start because there was no React project manifest

**Symptom:** The agent returned a standalone `index.html`, then the preview runner reported `I couldn't find a valid package.json in the project workspace.`

**Cause:** A new E2B project workspace started empty, and the agent was free to write a single HTML file instead of a runnable React app. The preview runner needs a project manifest with a start script and React/Vite dependencies.

**Fix:** Seed each newly created E2B workspace with a Vite + React + TypeScript starter (`package.json`, Vite config, HTML entry, TypeScript entry point, and starter component/styles), install its packages during project creation, and describe the expected React source files in the agent's tool instructions. Existing E2B workspaces are not reseeded.

**Verification:** The starter and project-creation flow have been implemented. A full project-creation-to-browser-preview run has not yet been performed.

**Learning:** A file named `index.html` alone is not a React project. Initialize the project structure and dependencies before asking an agent to modify it, then run that project through its development server.

### 19. E2B treated an expected status check as a failed command

**Symptom:** App initialization or preview returned the generic message `exit status 1` when checking whether `node_modules` or the preview server existed.

**Cause:** E2B's `commands.run()` throws a `CommandExitError` whenever a command exits nonzero. A normal shell check such as `test -d node_modules` exits with status 1 when the directory is absent, so control left the setup function before it could install dependencies or start the server.

**Fix:** Make expected presence checks always exit successfully and print an explicit result (`installed`/`missing`, `ready`/`not-ready`). Capture the development server's stdout and stderr, and include that output when startup times out.

**Verification:** The checks and diagnostic paths have been updated. A full live preview retry has not yet been performed.

**Learning:** With E2B commands, a nonzero exit is an exception, not just a result object to inspect. Expected negative checks should report their result without failing the process.

### 20. Vite rejected the E2B preview hostname

**Symptom:** Opening the preview displayed `Blocked request. This host ("4173-….e2b.app") is not allowed.`

**Cause:** Vite checks the incoming `Host` header against `server.allowedHosts`. E2B assigns a different preview hostname to each sandbox, so Vite's default allowlist did not include the URL returned by E2B.

**Fix:** When Tyox starts Vite, it now passes the exact E2B hostname through Vite's `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` environment variable. It checks the existing server using that hostname and restarts a Vite process that responds with the blocked-host status. This avoids allowing every hostname, which Vite warns can create DNS-rebinding risk.

**Verification:** Updated the affected E2B sandbox's `vite.config.ts` with its exact preview host, restarted Vite with the exact host in `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, and confirmed a request using that `Host` header returned HTTP 200. Future Tyox Vite starts pass their sandbox-specific hostname through the same variable.

**Learning:** A server can be listening and still reject requests based on their host header. Check the public proxy hostname as well as the local port, and allow only the host the application actually needs.

### 21. The E2B preview port closed shortly after startup

**Symptom:** The sandbox remained running, but opening its E2B URL returned `502 Bad Gateway` and `Connection refused on port 4173`.

**Cause:** Tyox launched Vite as a background E2B command with `timeoutMs: 15_000`. E2B applies that timeout to the process itself, so it killed the dev server after 15 seconds even though the sandbox was still alive.

**Fix:** Give the background Vite process the same 30-minute lifetime as its sandbox. A later project request can restart the preview if it has stopped.

**Verification:** The preview process timeout was changed to 30 minutes. Restarted Vite in the affected sandbox and confirmed the E2B host returned HTTP 200 immediately and again 18 seconds later, beyond the previous 15-second timeout. A later inspection also found the app and esbuild processes still running after 12 minutes.

**Learning:** A background command still has a lifetime limit. Set it long enough for the service you intend to keep running, and keep that lifetime consistent with the sandbox lifecycle.

### 22. Vite's esbuild worker disconnected while transforming React code

**Symptom:** Vite displayed `[plugin:vite:esbuild] The service is no longer running: write EPIPE` for `src/main.tsx`.

**Cause:** Vite delegates TSX transforms to a separate esbuild service process. The earlier E2B background server command had a 15-second execution timeout, which could terminate the command and its child worker while Vite still tried to use it. This followed the preview server lifetime issue recorded above.

**Fix:** Keep the preview command alive for 30 minutes, restart Vite, and pass the sandbox-specific E2B host into Vite's allowed-host setting when starting it.

**Verification:** In the affected sandbox, Vite and esbuild were both running after 12 minutes. Requesting `/src/main.tsx` with the E2B host returned HTTP 200 and transformed TSX successfully.

**Learning:** A web server can still accept requests while one of its helper processes has died. Check the failing worker and request a transformed source file, not just the root page, when debugging a React dev server.

### 23. The generated stylesheet imported Tailwind without installing its Vite integration

**Symptom:** Vite displayed `[plugin:vite:css] [postcss] ENOENT: no such file or directory, open 'tailwindcss'` while loading `src/index.css`.

**Cause:** The generated CSS imported Tailwind with `@import "tailwindcss"`, but the project's package manifest had neither the Tailwind package nor its Vite plugin. The CSS import could not resolve the framework or generate its utility classes.

**Fix:** Include `tailwindcss` and `@tailwindcss/vite` in the starter dependencies and register `tailwindcss()` in `vite.config.ts`. Add the same packages and plugin to the affected existing project.

**Verification:** Updated the starter template, installed the two packages in the affected sandbox, registered the Vite plugin, and restarted Vite. Requesting `/src/index.css` with the E2B host returned HTTP 200 and included generated Tailwind CSS; the response contained no ENOENT error.

**Learning:** A CSS framework import is not self-installing; the framework and the build-tool integration must be declared and configured together.

### 24. Vite lost its esbuild worker while transforming a generated component

**Symptom:** The preview showed `[plugin:vite:esbuild] The service is no longer running` while loading `/tmp/tyox-project/src/components/TechSection.tsx`.

**Cause:** Vite asks a separate esbuild worker process to transform TypeScript/JSX. This message means Vite tried to write to that worker over a pipe after the worker had stopped. It does not by itself identify why the worker stopped, and it is not proof that `TechSection.tsx` has a syntax error. Possible causes include the sandbox or preview process stopping, resource exhaustion, or a worker crash; the E2B sandbox logs and process state are needed to distinguish them.

**Fix:** Not yet verified. Restarting the preview process (or the sandbox if its processes are unhealthy) is the immediate recovery. If the error returns, inspect E2B sandbox logs and process state around the failure before changing the component. A browser refresh alone does not restart esbuild.

**Verification:** Pending. The supplied stack trace contains no E2B sandbox logs or resource data, so the exact cause and successful recovery have not been confirmed.

**Learning:** `write EPIPE` means a process wrote to a pipe whose reader had exited. Find out why the worker exited before treating the file named in the stack trace as the root cause.

### 25. The repository-wide whitespace check found an unrelated blank line

**Symptom:** `git diff --check` reported `agent/types.ts:46: new blank line at EOF` while checking the preview recovery changes.

**Cause:** `agent/types.ts` already had a local formatting edit that added an extra blank line at the end of the file. The preview recovery files themselves did not produce whitespace-check warnings.

**Fix:** No source change was made as part of this task. The `agent/types.ts` formatting edit should be reviewed and cleaned up separately before committing.

**Verification:** Running `git diff --check` on `agent/output.ts` and `agent/preview.ts` passed. The full working-tree check still reports the unrelated `agent/types.ts` warning.

**Learning:** When a repository-wide check fails, identify which changed file caused it; a clean diff for the feature files does not guarantee every unrelated working-tree change is clean.

### 26. TypeScript could not prove a test dependency version existed

**Symptom:** The agent type check reported `Type 'string | undefined' is not assignable to type 'string'` when adding test dependency versions to the generated project's manifest.

**Cause:** With `noUncheckedIndexedAccess` enabled, looking up a version in a string-keyed object may return `undefined`, even when the key came from a list computed from that object.

**Fix:** Store the looked-up version in a local variable and check it before assigning it to `devDependencies`.

**Verification:** The type check was rerun after the change; final result is recorded with this implementation.

**Learning:** A key from a derived array does not narrow the type of a later object lookup. Check the value where it is used, or structure the data so TypeScript can retain the key/value relationship.

### 27. A new preview deadline argument was missing at one call site

**Symptom:** The agent TypeScript check reported `Expected 3 arguments, but got 2` at the project initialization route after preview startup was updated to require a deadline.

**Cause:** The main agent loop passed its shared deadline to preview startup, but the separate project initialization route still used the old two-argument call.

**Fix:** The initialization route now creates its own five-minute deadline, applies it to workspace initialization, and passes it into preview startup.

**Verification:** Reran `tsc --noEmit -p agent/tsconfig.json`; it passed after updating the call site.

**Learning:** When a helper gains a required argument, search for every call site, including setup or initialization routes outside the main request path.

### 28. The agent run reached its five-minute deadline

**Symptom:** The frontend received `The agent request exceeded its 5-minute time limit` without a completed response.

**Cause:** The whole run had reached the configured deadline. That alone does not show whether Gemini, context counting, validation, or preview startup took the longest. No app terminal session was attached when this was inspected, so the exact phase could not be confirmed. The context manager also made multiple token-count API calls while trimming a large history, which could add avoidable delay.

**Fix:** Contexts with a small serialized size now skip the remote count call. Larger contexts use a token-count request capped at eight seconds; trimming uses a conservative serialized-byte limit and makes at most one final count request. The five-minute end-to-end deadline remains in place.

**Verification:** The agent TypeScript check and whitespace check passed. A live generation retry is still needed to confirm the runtime duration.

**Learning:** A total-request timeout prevents indefinite waits but does not identify the slow phase. Record phase timings alongside the request deadline so later timeouts point to the operation that consumed the budget.

### 29. Agent and backend repeated the same validation work

**Symptom:** Requests could spend several minutes “checking” and then hit the five-minute deadline without a final response.

**Cause:** The agent instructions told Gemini to run tests and the build, and the backend ran those same checks again before preview. On failure, the backend allowed up to two repair attempts, each followed by another test/build pass. The agent tool loop also had no limit on model turns or tool calls.

**Fix:** The agent now writes tests but leaves running tests/build to backend validation; the Bash tool also rejects those verification commands. The backend allows one repair attempt, and agent runs stop after six model turns or twelve tool calls. This bounds repeated verification as well as the existing five-minute wall-clock limit.

**Verification:** The agent TypeScript check and whitespace check passed. A live generated-project run is still needed to confirm end-to-end timing.

**Learning:** Choose one owner for each verification step. Running the same tests in both the agent and orchestration layers multiplies work, especially when repairs trigger another validation pass.

### 30. The agent turn cap stopped a valid request before it finished

**Symptom:** The frontend reported, `Agent stopped after 6 model turns without finishing. Try a more specific request.`

**Cause:** The six-turn safeguard was too restrictive for normal coding work. Each model response that requests tools, reads files, edits components, or handles validation consumes a turn. A request that needs several files could therefore hit the limit even though it was still making progress.

**Fix:** Raised the cap to 16 model turns and 24 tool actions. The one-repair limit and five-minute end-to-end deadline remain in place, so the agent has room to complete typical requests while still having explicit limits.

**Verification:** Pending a live generation request. The agent TypeScript check and whitespace check should be run after this change.

**Learning:** A safety limit should stop runaway work, not normal multi-step work. Use the request deadline as the primary bound and set turn/tool caps high enough for the expected task size.

### 31. Test setup failed when npm tried to repair generated dependencies

**Symptom:** Preview validation stopped with `Test setup failed while installing dependencies` and npm exited with `Cannot read properties of null (reading 'edgesOut')`. The agent had edited `package.json` to remove or bypass the test runner, but Tyox then tried to restore test dependencies by running `npm install` inside validation.

**Cause:** Validation mutated the generated project's package manifest and invoked npm installation on every request when test dependencies or a test script were missing. The failure occurred in npm's dependency-tree processing before tests, build, or preview could run. The `edgesOut` error is npm's internal failure; the available output does not identify the exact lockfile or dependency that triggered it.

**Fix:** Removed test-runner dependency installation from validation. Tyox invokes the existing local Vitest binary directly, independent of the project's `test` script. If Vitest is not installed, it reports that tests were skipped and proceeds to the production build. Workspace setup separately checks for the actual React build tools and repairs missing starter packages when needed.

**Verification:** `tsc --noEmit -p agent/tsconfig.json` and `git diff --check` passed. A live sandbox run is still needed to confirm build/preview succeed in the affected project.

**Learning:** Request-time validation should use the toolchain initialized with the workspace. Test dependencies should not be installed on every request; if required build tools are missing, repair only the starter toolchain and report that as setup work.

### 32. The build script could not find Vite in the sandbox

**Symptom:** Production build exited with status 127 and `sh: 1: vite: not found`, even though `package.json` contained a `vite build` script.

**Cause:** Workspace setup treated the existence of the `node_modules` directory as proof that dependencies were installed. An earlier failed install can leave that directory behind without creating `node_modules/.bin/vite`, so later initialization and preview checks incorrectly skipped installation. The exact package state in the affected sandbox was not available to inspect.

**Fix:** Workspace setup now verifies the actual local Vite binary (and TypeScript when the build script invokes `tsc`). It restores missing baseline React/Vite/TypeScript/Tailwind dependencies into the manifest while preserving existing scripts and user dependencies, then installs with lockfile parsing disabled. Validation and preview use the same dependency check. The agent prompt also directs the model to preserve the initialized package setup.

**Verification:** `tsc --noEmit -p agent/tsconfig.json` and `git diff --check` passed. A live E2B initialization/build is needed to confirm that the sandbox can recover successfully from the previous partial installation.

**Learning:** A `node_modules` folder can exist after a failed or partial install. Check for the executable the project actually needs, such as `node_modules/.bin/vite`, before concluding that setup is complete.

### 33. A context-compaction placeholder was written into `App.tsx`

**Symptom:** Vite's React Babel parser failed at line 1 of `src/App.tsx`. The file began with `[Previous file contents omitted to fit the context budget.]`, which is plain text and not valid TSX.

**Cause:** The context manager replaced the content argument of older `Write_File` calls with that marker to reduce prompt size. Although it changed only the conversation history, the model could later reuse the placeholder as if it were file content. The supplied parse error confirms the placeholder reached the project file.

**Fix:** Context compaction now removes old file-write calls together with their matching tool results instead of changing a write's content to a fake value. It also avoids truncating retained write arguments. The system instruction tells the agent to read files before editing and never use omitted-content markers as source. The write tool rejects the exact placeholder with a clear recovery instruction.

**Verification:** The first TypeScript check caught that `Step` is a union and not every step has an `id`; narrowing while collecting write-call IDs fixed it. The agent TypeScript check and whitespace check then passed. A live generation is needed to confirm the marker no longer reaches an E2B project file.

**Learning:** A placeholder used to shorten model history can become executable input if it is placed inside a tool argument. For code, remove the old tool call/result pair or summarize it separately; never substitute fake source text into a write call.

### 34. The configured Gemini model reached its daily free-tier quota

**Symptom:** Gemini returned `429 Rate limit exceeded for model gemini-3.5-flash-lite` after the project reached the model's 500-request daily free-tier limit.

**Cause:** The agent and context token counter both used the same fixed model ID, so all requests consumed quota against that model. This is a provider quota, not an agent loop or E2B sandbox failure.

**Fix:** Changed the shared model ID to Google's current stable Gemini 3.8 Flash model, recommended for agentic and software-engineering workloads. Both generation and token counting now use the new model through `AGENT_MODEL`.

**Verification:** `tsc --noEmit -p agent/tsconfig.json` and `git diff --check` passed. The new model's availability and quota depend on the user's Google AI Studio project; a live API request is needed to confirm access.

**Learning:** Model quotas are model- and project-specific. Changing models can move requests to a different quota, but it does not guarantee unlimited or higher free-tier usage; check the active quota in AI Studio.

### 35. The running backend kept requesting the old Gemini model

**Symptom:** After the source model was changed, the API error still named `gemini-3.5-flash-lite` and reported its daily free-tier quota.

**Cause:** The source already named `gemini-3.8-flash`, so an error naming the old model means the running agent process had not loaded the updated source (or was configured separately). The active project needs an explicit free-tier default and a clear way to override it.

**Fix:** Set the default to `gemini-3.1-flash-lite`, which Google currently lists with free-tier pricing, and made it configurable through `GEMINI_MODEL`. Both generation and context counting read the same setting. Restart the agent process so it loads the new default.

**Verification:** `tsc --noEmit -p agent/tsconfig.json` and `git diff --check` passed. A live request is still needed to confirm the API project has remaining quota for this model.

**Learning:** A source edit does not change a running process until it reloads. Confirm the model name in the actual error after restart; it should match the configured model.

### 36. A repeated 429 still identified the previous model

**Symptom:** A later request again returned a 429 naming `gemini-3.5-flash-lite`, even though the checked-in default was `gemini-3.1-flash-lite` and no `GEMINI_MODEL` setting was found in the project's `.env` files.

**Cause:** The running agent is still serving code or environment from before the model change. The source repository cannot update a process that was not restarted. The local execution sandbox also denied the process-list command (`ps`), so I could not inspect the active PID from this session.

**Fix:** The agent startup log now prints the selected model name. Stop the old agent process and start it again with `bun run dev:agent`; its startup line should show `model: gemini-3.1-flash-lite`.

**Verification:** `tsc --noEmit -p agent/tsconfig.json` and `git diff --check` passed. The active process could not be independently inspected from this session.

**Learning:** When a runtime error reports a model different from the source default, first verify which process is answering requests. Changing the source or switching models again cannot affect an old process.

### 37. Adding S3 required a writable temporary directory for Bun

**Symptom:** The first `bun add @aws-sdk/client-s3` attempt failed before dependency resolution with `Bun is unable to write files to tempdir: PermissionDenied`. Retrying with `TMPDIR=/private/tmp` failed the same way.

**Cause:** The local Bun process could not write to its configured temporary directory in the restricted workspace environment.

**Fix:** Retried the dependency installation with the approved elevated command. Bun installed `@aws-sdk/client-s3` and updated `agent/package.json` and `agent/bun.lock`.

**Verification:** `tsc --noEmit -p agent/tsconfig.json` and `git diff --check` passed after implementing storage. Live S3 upload and restore remain unverified because no bucket or AWS credentials were provided for this project.

**Learning:** Package-management failures can occur before network resolution if the package manager cannot create temporary files. Confirm the failure stage before troubleshooting package versions or connectivity.

### 38. Project source snapshots are persisted to S3

**Purpose:** E2B sandboxes expire, so a generated project needs durable storage to restore its source into a replacement sandbox.

**Implementation:** Added `@aws-sdk/client-s3` and a storage module. Tyox archives the workspace to a compressed S3 object at `{S3_PREFIX}/{projectId}/workspace.tar.gz`. It excludes `node_modules`, `.git`, build output, caches, logs, and `.env` files. New E2B workspaces restore that object before falling back to the starter. Initial project setup saves the starter snapshot, and the agent saves a new snapshot after completing edits and before validation. A failed upload is surfaced in the streamed status/final message without preventing the generated app's build and preview checks.

**Configuration:** Set `S3_BUCKET` and `AWS_REGION` in `agent/.env`; credentials use the AWS SDK's default provider chain. `S3_PREFIX` is optional and defaults to `tyox/projects`. The bucket should remain private with `s3:GetObject` and `s3:PutObject` access scoped to the project prefix.

**Verification:** Agent TypeScript and whitespace checks passed. A live restore/upload could not be verified without project AWS configuration. S3 bucket versioning can retain earlier object versions; this implementation does not create Git commits or diffs.

**Learning:** Keep the sandbox as the execution workspace and S3 as the durable source snapshot. Exclude dependency folders and secrets, and persist a complete archive before exposing the project as complete.

### 39. Patch edits failed when the assumed file context did not match

**Symptom:** An `apply_patch` attempt failed to update `agent/package.json` because it expected an existing `scripts` object. A later documentation patch also failed because the expected README sentence did not exactly match the current file.

**Cause:** The patch was written from an assumed file shape instead of the actual current contents. `apply_patch` verifies its context before changing a file, so stale or incorrect context makes the patch fail safely.

**Fix:** Read the current package manifest and search for the exact README text, then apply smaller patches anchored to existing content.

**Verification:** The changes were applied after inspecting the files. This MinIO setup has not yet been run against a local Docker daemon.

**Learning:** When a patch fails to match, inspect the live file before retrying; do not broaden the patch blindly.

### 40. MinIO image pull failure made the bucket command fail secondarily

**Symptom:** Docker returned `401 UNAUTHORIZED` while resolving the configured MinIO image. Running `bun run s3:bucket` then failed with `ECONNREFUSED` at `localhost:9000`.

**Cause:** The MinIO Community Server moved to source-only distribution, and its upstream GitHub repository was later archived. The old prebuilt image reference is no longer a dependable local setup. Since the object-store container never started, no S3 endpoint was listening; this was not an AWS SDK credential failure.

**Fix:** Replaced the local container with RustFS, which exposes an S3-compatible API. The AWS SDK integration and bucket creation command still target the same local endpoint. Compose now includes a health check and waits for readiness before the bucket command.

**Verification:** `docker compose --env-file agent/.env -f compose.local-s3.yaml config`, agent TypeScript checking, and `git diff --check` passed. A live image pull, startup, and bucket creation have not been run in this environment.

**Learning:** When a dependent command reports connection refused, first verify that its service actually started. Registry image availability errors occur before application credentials or bucket logic.

### 41. Documentation patch context did not match exactly

**Symptom:** Several patch attempts to change the local object-store instructions failed because the expected paragraph did not exactly match the file, including a capitalization mismatch.

**Cause:** The patch included a long paragraph copied from memory rather than anchoring only on the exact lines currently in the README.

**Fix:** Read the current paragraph and apply a smaller replacement with exact capitalization and text.

**Verification:** The documentation change applied successfully after inspecting the file.

**Learning:** For long documentation lines, patch only the smallest exact section needed; verify the literal source text before retrying.

### 42. Initial CI checks found type errors and a misleading Bun command

**Symptom:** The first repository-wide TypeScript check picked up generated files under the ignored `backend/projects` directory and found an invalid event-union access in `backend/index.ts`. The first root check/build scripts also printed Bun's usage help instead of running the target script, while returning exit code 0.

**Cause:** The backend TypeScript config did not exclude generated project workspaces, an SSE persistence branch assumed every event had a `message` field, and Bun's `--cwd` option was placed before `run` rather than after it.

**Fix:** Excluded generated workspaces from TypeScript checks, narrowed SSE handling to question and completion events, corrected the root Bun script syntax, and added per-package typecheck commands plus a frontend build command.

**Verification:** `bun run typecheck`, `bun run build`, and `git diff --check` passed. The GitHub Actions workflow itself has not run on GitHub yet. This project currently has no standalone unit-test suite, so CI does not claim to run tests.

**Learning:** CI should check actual tracked source, and a zero exit status is not enough if the command printed help. Verify that each scripted command ran the intended tool and produced meaningful output.

### 43. UI patch failed on duplicate file operations and mismatched text

**Symptom:** The first stylesheet replacement patch tried to delete and add the same path in one operation. Later small patches failed because their expected JSX text differed in spacing from the file.

**Cause:** The patch tool does not allow both delete and add operations for the same path in one patch, and exact-context patches require the source text to match literally.

**Fix:** Split the stylesheet replacement into sequential delete and add operations, then inspect the exact JSX lines and make smaller replacements.

**Verification:** The UI changes were applied and the frontend build and TypeScript checks passed afterward.

**Learning:** For a full file replacement, use separate operations; for small edits, copy the exact current line before constructing the patch.

### 44. Starting a second frontend server hit `EADDRINUSE`

**Symptom:** Running `bun run dev:frontend` failed because port `3002` was already in use.

**Cause:** The frontend development server was already running in another process. Starting another server with the same port caused a local port collision; it was not a code or build failure.

**Fix:** Reused the existing server to inspect the updated UI instead of starting a duplicate process.

**Verification:** Repository typechecks, the frontend production build, and `git diff --check` passed.

**Learning:** Before starting a dev server, check whether one is already listening on its configured port. Reuse it or stop it before starting another instance.

### 45. Bun test server could not bind to port 0

**Symptom:** The backend integration test run failed in `beforeAll` with `EADDRINUSE` while starting the Express app on port `0`. A retry using a Unix-domain socket failed with `EPERM`; teardown also reported that the server was not running.

**Cause:** This local execution environment does not allow test processes to bind TCP or Unix-domain sockets. The failure happens before Express can receive a request, so it does not indicate a route failure.

**Fix:** The test teardown now closes the server only after successful startup. The tests use an ephemeral loopback port, which is suitable for the GitHub Actions runner; local end-to-end execution remains blocked by this environment's socket restriction.

**Verification:** Repository typechecking passed. The same local socket restriction recurred when rerunning `bun run test:backend` after moving route handlers into controller modules. The user previously ran all five tests successfully before that refactor; tests need to be rerun from the user's terminal, and CI must confirm the refactored routes on its runner.

**Learning:** Integration tests need a server lifecycle that matches the runtime. Guard teardown after startup failures and distinguish test-environment network restrictions from application errors.

### 46. Extracted Express controllers lost route-parameter inference

**Symptom:** After moving handlers into controller files, TypeScript reported that `req.params` values could be arrays or undefined when passed to database queries.

**Cause:** Handlers declared outside `router.get()` no longer receive the route-specific parameter types inferred by Express from the route string.

**Fix:** Added explicit parameter types such as `Request<{ projectid: string }>` to handlers that use route parameters.

**Verification:** `bun run typecheck` and `bun run build` passed after the change.

**Learning:** When extracting route callbacks, carry the route parameter names into the controller's `Request` generic so TypeScript preserves the route contract.

### 47. Backend integration tests could not bind their ephemeral HTTP listener

**Symptom:** `bun run --cwd backend test` failed in `beforeAll` with `EADDRINUSE` while calling `app.listen(0)`, before running any test cases. A retry produced the same failure.

**Cause:** The test suite starts a real loopback HTTP server on an OS-assigned port. This execution environment rejected that listener setup, so the requests never reached Express. This is a test-environment networking restriction, not evidence that the new authentication routes failed.

**Fix:** No application workaround was needed. The test command was rerun with loopback access enabled so its OS-assigned test port could bind successfully.

**Verification:** The rerun reached Express and all 9 backend integration tests passed. The initial failures did not execute any test assertions.

**Learning:** Record the stage at which a test fails. A server startup error means test assertions did not run; enabling the required local socket access can distinguish an environment restriction from a route regression.

### 48. Authenticated project routes were blocked by a stale user-check middleware

**Symptom:** After allowing the backend test server to bind its local port, typechecking passed but 3 of 9 backend tests failed. Requests with valid JWTs to create projects and list projects returned `401` instead of reaching their controllers; the project-list ownership test expected `403`.

**Cause:** `checkuser` reads `req.params.id`, but the routes use `/projects` and `/users/:userid/projects`, so `id` is undefined. The middleware also never calls `next()` when its comparison succeeds. JWT authentication itself accepted valid tokens on conversation routes; the request was stopped by this separate middleware.

**Fix:** Removed the stale `checkuser` middleware from project creation and listing routes. Both controllers already use `req.userId` and enforce ownership where needed. The frontend now persists the account alongside the JWT and reloads the user's projects on startup; sign-out clears both values.

**Verification:** After the fix, frontend and backend typechecks passed, all 9 backend integration tests passed (24 assertions), and `git diff --check` passed. The sandboxed test attempt initially hit `EADDRINUSE`; rerunning with local socket access allowed the tests to execute.

**Learning:** Authentication proves who sent a request; route authorization must compare that identity against the correct resource owner. Test both layers, and make sure successful Express middleware calls `next()`.

### 49. Auth form validation details were hidden behind a generic 400 error

**Symptom:** Invalid sign-in or account-creation input returned HTTP 400, but the frontend displayed a generic `Request failed (400)` message.

**Cause:** The auth controllers returned Zod's full error object in a `message` field. The shared frontend request helper only looked for a string in the `error` field, so it could not display the validation issue.

**Fix:** Auth controllers now turn Zod issue messages into a readable `error` string. The frontend request helper also supports APIs that return an error in a `message` field.

**Verification:** Not run yet.

**Learning:** Keep the API's error response shape consistent and make the frontend parse the shape it actually receives; otherwise a useful validation response becomes a vague status-code message.
