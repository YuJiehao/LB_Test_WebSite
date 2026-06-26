# Control Plane Subagent-Driven Development Progress Ledger

**Branch**: `feature/control-plane`
**Plan**: `docs/superpowers/plans/2026-06-26-control-plane-plan.md`
**Design**: `docs/superpowers/specs/2026-06-26-control-plane-design.md`
**Started**: 2026-06-26

## Conventions

- Control plane source lives in `control-plane/` subdir of LB_Test_WebSite
- App-side changes go in `lib/k8s/` subdir
- Each task = implementer subagent + task reviewer subagent
- Update this file when each task review comes back clean

## Pre-Flight Fixes Applied (2026-06-26)

1. Phase 7 file paths: `lib/k8s/k8s-startup.js` + `lib/k8s/k8s-informer.js` (not `src/`)
2. Phase 7 RBAC: dropped `resourceNames` field; rely on `role=fault-state` label selector only
3. Phase 5 partials symlink: path becomes `control-plane/ → ../views/partials/`
4. Phase 6: removed PDB (single replica is no-op)

## Phase 1 — Backend Foundation

### Task 1.1: Project scaffold + healthz
- status: **DONE** (commits 38a0ae2..42ee029, review clean)
- TDD: 3 commits (RED `1f9c2fa` → GREEN `efc4c60` → REFACTOR `42ee029`)
- Test: 1/1 pass (supertest, real HTTP)
- **Minor findings (record for final review):**
  - `ejs` declared in `package.json` but unused (YAGNI: remove or defer)
  - `parseInt(PORT, 10) || 3000` falsy-coercion for `PORT=0`
  - `npm run lint` script references ESLint config that doesn't exist yet
  - No `control-plane/.gitignore` (node_modules covered at root, but nested is conventional)
  - No graceful-shutdown hook in `server.js`
  - RED-phase discipline: failure was "missing test script" not "missing server module"

### Task 1.2: K8s API client loader
- status: **DONE** (commits 42ee029..5621620, review clean after trailing-newline fix)
- TDD: 3 commits (RED `41b245a` → GREEN `1cf78f8` → REFACTOR `5086e3b`) + fix `5621620`
- Test: 4/4 pass (3 new k8s-client tests + 1 server test, all green)
- **Library API deviation**: brief said `loadInCluster`; used `KubeConfig.prototype.loadFromCluster` (0.22.x does not export `loadInCluster`). Approved by reviewer as justified adaptation. JSDoc explains.
- **Minor findings (record for final review):**
  - Wrapped error discards original stack (use `cause: err` Node 16.9+)
  - `pods`/`configMaps` share same `CoreV1Api` instance — mutations visible across both
  - Inherited ESLint config missing (already in Task 1.1 findings)

### Task 1.3: List Pods by label selector
- status: **DONE** (commits 5621620..529b0ce, review clean)
- TDD: 3 commits (RED `7d94fff` → GREEN `6f4df76` → REFACTOR `529b0ce`)
- Test: 6/6 pass (2 new pods tests + 4 prior)
- **Minor findings (record for final review):**
  - Signature drift: brief said 2-arg `listPods(client, selector)`, impl is 3-arg `(client, selector, namespace)` — defensible, but worth aligning brief for future tasks
  - No test for missing `podIP` (Pending state) — `toPlainPod` would return `ip: undefined`
  - Inherited minor from prior tasks (no ESLint config)

### Task 1.4: List fault-state ConfigMaps
- status: **DONE** (commits 529b0ce..e261633 + trailing-newline fix, review clean)
- TDD: 3 commits (RED `9ea3e7e` → GREEN `9866562` → REFACTOR `e261633`)
- Test: 11/11 pass (5 new configmaps tests + 6 prior)
- **Process note**: original subagent was killed by 429 token-plan error mid-task; controller applied fix and wrote the report
- **Minor findings (record for final review):**
  - Trailing-newline fix `5621620`-style needed again (`configmaps.js` end-of-file)
  - `podName` fallback returns raw `meta.name` when prefix doesn't match — could be `undefined` for clarity
  - `configmaps.js` re-exports `FAULT_STATE_LABEL` / `FAULT_STATE_NAME_PREFIX` from `labels.js` — slight abstraction leak
  - No test for `err.response?.statusCode === 404` path
  - No test for `pod` label vs name-strip precedence branches
  - No test for non-numeric `slowDelayMs` → `parseInt0` fallback

### Task 1.5: Reconcile ConfigMaps on startup
- status: **DONE** (commits 44b7e96..664e738, review clean after malformed-pod fix)
- TDD: 3 commits (RED `44b7e96` → GREEN `cb392e0` → REFACTOR `58caad7`) + review-fix `664e738`
- Test: 13/13 pass (2 new reconcile + 11 prior)
- **Important fix applied**: reviewer flagged that `pod.name === undefined` would silently create `fault-state-undefined` ConfigMap. Fix filters out malformed pods and surfaces them in `errors[]`. Same for existing CMs with no `podName`.
- **Minor findings (record for final review):**
  - Hard-coded `app=load-balancer-test` selector — defer until a 2nd caller appears
  - `defaultFaultState` includes `apiVersion`/`kind` (redundant but self-documenting)
  - Inherited: trailing-newline pattern, no ESLint config, etc.

## Phase 1 — COMPLETE
- All 5 tasks done; 13/13 tests pass; review clean
- Files created: package.json, src/server.js, src/config.js, src/k8s/{client,pods,configmaps,labels}.js, tests/unit/{server,k8s-client,k8s-pods,k8s-configmaps,reconcile}.test.js
- Ready for Phase 2 to consume
- TDD: 3 commits (RED `44b7e96` → GREEN `cb392e0` → REFACTOR `58caad7`)
- Test: 13/13 pass (2 new reconcile tests + 11 prior)
- **Minor findings (record for final review):**
  - Pod-app selector `app=load-balancer-test` hard-coded in `configmaps.js` — move to `labels.js` if a second caller appears
  - No re-list between Pods and creates — acceptable for one-shot startup, but a future polling loop would need it
  - `defaultFaultState` includes `apiVersion`/`kind` (technically redundant since the client fills them in) — kept for self-description
  - Test fixture for the create call was updated mid-GREEN to add `apiVersion`/`kind`; the diff is mixed into the GREEN commit, not split into a separate "test fix" commit

## Phase 2 — Fault Application Path

### Task 2.1: Target selection algorithms
- status: **DONE** (commits 664e738..20a64b4, review clean after canary-test fix)
- TDD: 3 commits (RED `4f12fc1` → GREEN `11643b1` → REFACTOR `f4cbdf2`) + canary-fix `20a64b4`
- Test: 8/8 pass (selectTargets 6 + hashCode 2)
- **Important fix applied**: added canary-50% test that uses 100-pod universe and asserts 50±15 — proves "roughly proportional subset" property, not just determinism
- **Minor findings (record for final review):**
  - TDD slip: `hash.js` was created in GREEN, not REFACTOR (extraction already happened — can't un-extract)
  - `buildSelectorPredicate` / `filterBySelector` exported but unused (YAGNI: keep internal until 2nd caller)
  - No test for `ctx.pods` short-circuit path in selector mode
  - Selector returns `[]` instead of throwing when neither `ctx.pods` nor `ctx.client` supplied (defensible, prefer noise on caller bug)
  - Inherited: trailing newlines, no ESLint config

### Task 2.2: ConfigMap patch with optimistic locking
- status: **DONE** (commits 20a64b4..861c8fd, review clean after optimistic-locking fix)
- TDD: 3 commits (RED `f04eea4` → GREEN `f7ff01b` → REFACTOR `d2b4a85`) + review-fix `861c8fd`
- Test: 28/28 pass (4 new configmap-patch tests)
- **Critical fix applied**: reviewer found `resourceVersion` was never passed in patch body — K8s never returned 409, retry loop was dead code. Fix: moved body inside loop, added `metadata.resourceVersion`, updated tests to assert per-attempt version forwarding.
- **Minor findings (record for final review):**
  - `timeoutMs: 0` uses next-tick setTimeout, not true "no timeout" (no real-world use case)
  - Whole-operation timeout covers all retries (not per-attempt) — acceptable for in-cluster
  - No lint config (pre-existing)

### Task 2.3: Apply orchestrator with parallelism
- status: **DONE** (commits 861c8fd..53a310c, review clean after error-handling fix)
- TDD: 3 commits (RED `609f88c` → GREEN `87a6223` → REFACTOR `c0af93f`) + review-fix `53a310c`
- Test: 33/33 pass (5 new apply tests)
- **Important fix applied**: reviewer found `getFaultStateConfigMap` errors not caught — the "never throws" contract was violated. Fix: wrapped whole per-Pod handler in single try/catch.
- **Minor findings (record for final review):**
  - Skipped path (CM is null) has no test coverage
  - Default `updatedBy`/`timeoutMs` fallbacks untested
  - Empty try/catch for audit placeholder (linter noise)

### Task 2.4: REST routes for apply and reset
- status: **DONE** (commits 53a310c..0b07ed9, review clean after mount fix)
- TDD: 3 commits (RED `fb507ba` → GREEN `a100d58` → REFACTOR `a41b982`) + review-fix `0b07ed9`
- Test: 38/38 pass (5 new integration tests)
- **Important fix applied**: reviewer found `mountRoutes` imported but never called — routes 404 in production. Fix: added `start()` with K8s client loading + graceful fallback.
- **Minor findings (record for final review):**
  - `express.json()` registered inside route mount (not app-level)
  - selector/canary validation branches untested
  - Test assertions don't verify `pods` in ctx
  - `jest.clearAllMocks()` after mountRoutes (ordering oddity)

## Phase 2 — COMPLETE
- All 4 tasks done; 38/38 tests pass; reviews clean
- Files created: src/fault/targets.js, src/fault/apply.js, src/util/hash.js, src/api/routes.js
- Modified: src/k8s/configmaps.js, src/config.js, src/server.js

## Phase 3 — State Observation

### Task 3.1: Per-Pod state polling
- status: **DONE** (commits 0b07ed9..6f31d3a, review clean after JSDoc fix)
- TDD: 3 commits (RED `b602eb1` → GREEN `ec58849` → REFACTOR `6aabffb`) + JSDoc fix `6f31d3a`
- Test: 46/46 pass (3 new poll-pod tests)
- **Note**: used `global.fetch` mock instead of nock — lighter deps, reviewer approved
- **Minor findings (record for final review):**
  - `fetchWithTimeout` GREEN impl had timer-cleanup bug (fixed in REFACTOR)
  - JSDoc said `opts.timeoutMs` but param is `timeoutMs` (fixed)

### Task 3.2: Drift detection
- status: **DONE** (commits 6f31d3a..eecb1e7)
- TDD: 3 commits (RED `687005c` → GREEN `f521ef2` → REFACTOR `eecb1e7`)
- Test: 46/46 pass (5 new drift tests)
- **Note**: function was pure from GREEN — REFACTOR was a no-op confirmation
- Added to `src/fault/poll.js` (same module as pollPod — shared domain)

### Task 3.3: Polling loop with backoff
- status: pending

## Phase 4 — Real-time + Audit

### Task 4.1: Internal event bus
- status: pending

### Task 4.2: Audit ring buffer
- status: pending

### Task 4.3: SSE endpoint
- status: pending

### Task 4.4: Wire audit + bus into apply path
- status: pending

## Phase 5 — Dashboard UI

### Task 5.1: EJS scaffold with reused partials
- status: pending

### Task 5.2: Pod table + filter
- status: pending

### Task 5.3: Action form (target + mode)
- status: pending

### Task 5.4: Real-time updates via SSE on the client
- status: pending

## Phase 6 — Access Control + Deployment

### Task 6.1: Basic Auth Secret
- status: pending

### Task 6.2: Dockerfile (multi-stage)
- status: pending

### Task 6.3: K8s manifests
- status: pending

## Phase 7 — App-side Integration

### Task 7.1: Add @kubernetes/client-node to app
- status: pending

### Task 7.2: ConfigMap read on startup
- status: pending

### Task 7.3: Informer watch + onChange
- status: pending

### Task 7.4: Deployment manifest updates
- status: pending

### Task 7.5: End-to-end verification
- status: pending
