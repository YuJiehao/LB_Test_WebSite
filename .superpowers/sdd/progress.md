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
- status: pending

### Task 1.3: List Pods by label selector
- status: pending

### Task 1.4: List fault-state ConfigMaps
- status: pending

### Task 1.5: Reconcile ConfigMaps on startup
- status: pending

## Phase 2 — Fault Application Path

### Task 2.1: Target selection algorithms
- status: pending

### Task 2.2: ConfigMap patch with optimistic locking
- status: pending

### Task 2.3: Apply orchestrator with parallelism
- status: pending

### Task 2.4: REST routes for apply and reset
- status: pending

## Phase 3 — State Observation

### Task 3.1: Per-Pod state polling
- status: pending

### Task 3.2: Drift detection
- status: pending

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
