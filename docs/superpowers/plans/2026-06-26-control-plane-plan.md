# Control Plane for K8s Fault Injection — Implementation Plan

**Date**: 2026-06-26
**Status**: Ready to execute
**Design**: [`docs/superpowers/specs/2026-06-26-control-plane-design.md`](../specs/2026-06-26-control-plane-design.md)
**Owner**: YuJiehao

## Overview

This plan implements the approved control plane design in 7 phases. Each phase delivers a runnable milestone; each task follows strict TDD (RED → GREEN → REFACTOR). Repository layout follows the design's "Repository Layout" section: a **new repo** `lb-fault-control-plane/` for the control plane service, plus targeted **edits to the existing LB_Test_WebSite repo** for the app-side informer integration.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Node.js 18 LTS |
| Web framework | Express 4.18 (mirrors existing app) |
| View engine | EJS |
| K8s client | `@kubernetes/client-node` (official) |
| Test framework | Jest + supertest (HTTP) + `@kubernetes/client-node` mock |
| Container | Alpine-based, multi-stage Dockerfile |
| Linter | ESLint with `airbnb-base` |

## Repository Layout

```
# New repo: lb-fault-control-plane/
lb-fault-control-plane/
├── package.json
├── Dockerfile
├── .dockerignore
├── .eslintrc.json
├── jest.config.js
├── src/
│   ├── server.js              # Express bootstrap
│   ├── config.js              # Env vars + constants
│   ├── k8s/
│   │   ├── client.js          # K8s API client loader
│   │   ├── pods.js            # Pod listing
│   │   ├── configmaps.js      # ConfigMap CRUD + reconcile
│   │   └── rbac.js            # ServiceAccount wiring (manifests only)
│   ├── fault/
│   │   ├── targets.js         # Target selection (single/all/selector/canary)
│   │   ├── apply.js           # ConfigMap patch orchestrator
│   │   └── poll.js            # Per-Pod state polling + drift detection
│   ├── events/
│   │   ├── bus.js             # Internal event emitter
│   │   ├── audit.js           # In-memory ring buffer
│   │   └── sse.js             # SSE endpoint
│   ├── api/
│   │   ├── routes.js          # REST endpoints
│   │   └── dashboard.js       # EJS page
│   └── views/
│       ├── layout.ejs
│       ├── dashboard.ejs
│       └── partials/          # copied/symlinked from LB_Test_WebSite/public/css + views/partials
├── k8s/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── serviceaccount.yaml
│   ├── role.yaml
│   └── rolebinding.yaml
└── tests/
    ├── unit/
    └── integration/
```

## Phase 1 — Backend Foundation

**Goal**: A control plane service that boots, exposes a healthz probe, can talk to the K8s API, and reconciles fault-state ConfigMaps on startup.

**Done when**:
- `npm test` passes all unit tests
- `node src/server.js` starts and `GET /healthz` returns 200
- Service can authenticate against the K8s API (verified locally with `kind`)
- On startup, the service lists existing `app=load-balancer-test` Pods and creates a `fault-state-<pod-name>` ConfigMap for any that don't have one

### Task 1.1: Project scaffold + healthz

**RED**: Write `tests/unit/server.test.js`:
- Test `GET /healthz` returns 200 with body `OK`
- Run `npm test` — confirm failure (server doesn't exist)

**GREEN**: Create `package.json` with deps (express, ejs, dotenv) + devDeps (jest, supertest, eslint). Implement `src/server.js` with Express + `app.get('/healthz', ...)`. Run test, confirm pass. Commit.

**REFACTOR**: Extract `src/config.js` for `PORT` env var. Re-run tests. Commit.

### Task 1.2: K8s API client loader

**RED**: Write `tests/unit/k8s-client.test.js`:
- Test `loadK8sClient()` returns an object with `pods` and `configMaps` namespaces
- Test it uses in-cluster config when `KUBERNETES_SERVICE_HOST` is set
- Confirm failure

**GREEN**: Implement `src/k8s/client.js` using `loadInCluster` from `@kubernetes/client-node`. Stub the env var in tests. Confirm pass. Commit.

**REFACTOR**: Add JSDoc + error wrapping. Re-run. Commit.

### Task 1.3: List Pods by label selector

**RED**: Write `tests/unit/k8s-pods.test.js`:
- Test `listPods(client, selector)` returns array of `{name, ip, nodeName}`
- Mock `CoreV1Api.listNamespacedPod` to return a fixture
- Confirm failure

**GREEN**: Implement `src/k8s/pods.js` with `listPods(client, labelSelector)`. Map API response to plain objects. Confirm pass. Commit.

**REFACTOR**: Extract a small `toPlainPod(apiPod)` helper. Commit.

### Task 1.4: List fault-state ConfigMaps

**RED**: Write `tests/unit/k8s-configmaps.test.js`:
- Test `listFaultStateConfigMaps(client, namespace)` returns only ConfigMaps with label `role=fault-state`
- Mock API to return a mix of labelled and unlabelled ConfigMaps
- Confirm failure

**GREEN**: Implement `src/k8s/configmaps.js` with `listFaultStateConfigMaps` and `getFaultStateConfigMap(client, namespace, podName)`. Confirm pass. Commit.

**REFACTOR**: DRY the label-selector constant into `src/k8s/labels.js`. Commit.

### Task 1.5: Reconcile ConfigMaps on startup

**RED**: Write `tests/unit/reconcile.test.js`:
- Test `reconcileOnStartup(client, namespace)` creates a `fault-state-<pod-name>` ConfigMap with default data for each Pod that lacks one
- Test it is idempotent: re-running on a fully-reconciled cluster makes zero API calls
- Confirm failure

**GREEN**: Implement `reconcileOnStartup` in `src/k8s/configmaps.js`. Use `create` for missing, skip for present. Confirm pass. Commit.

**REFACTOR**: Extract `defaultFaultState(podName)` helper. Commit.

---

## Phase 2 — Fault Application Path

**Goal**: An operator can POST to the control plane API to apply a fault mode to any selection of Pods; control plane fans out ConfigMap patches in parallel.

**Done when**:
- `POST /api/fault/apply` with `{target: {type: "all"}, mode: "http_500"}` patches every Pod's ConfigMap
- `POST /api/fault/apply` with `{target: {type: "canary", percent: 50}}` patches a deterministic subset
- `POST /api/fault/reset` clears all Pods to `none`
- ConfigMap patches use `resourceVersion` for optimistic locking; 409 conflicts are retried up to 3 times

### Task 2.1: Target selection algorithms

**RED**: Write `tests/unit/targets.test.js`:
- Test `selectTargets({type:"all"}, pods)` returns all pods
- Test `selectTargets({type:"single", pod:"p1"}, pods)` returns only p1
- Test `selectTargets({type:"selector", selector:"app=foo"}, pods)` delegates to K8s API and filters
- Test `selectTargets({type:"canary", percent:50}, [p1,p2])` is deterministic — same input always gives same output
- Test canary 0% returns `[]`; 100% returns all
- Confirm failure

**GREEN**: Implement `src/fault/targets.js` with each selector. Use simple `hashCode(podName) % 100 < percent` for canary. Confirm pass. Commit.

**REFACTOR**: Extract `hashCode(string)` to a util module with a small inline test. Commit.

### Task 2.2: ConfigMap patch with optimistic locking

**RED**: Write `tests/unit/configmap-patch.test.js`:
- Test `patchFaultState(client, namespace, podName, state)` sends a JSON merge patch with correct data
- Test 409 conflict triggers refetch + retry, up to 3 times
- Test 3 consecutive 409s surfaces error to caller
- Mock API. Confirm failure

**GREEN**: Implement `patchFaultState` in `src/k8s/configmaps.js`. Confirm pass. Commit.

**REFACTOR**: Add timeout wrapper around the patch. Commit.

### Task 2.3: Apply orchestrator with parallelism

**RED**: Write `tests/unit/apply.test.js`:
- Test `applyFault(target, mode, slowDelayMs, ctx)` calls `patchFaultState` for each selected Pod
- Test it runs patches with `Promise.all` and caps concurrency at 5
- Test partial failure: if 1 of N pods fails, response includes `{applied, skipped, errors}` arrays
- Confirm failure

**GREEN**: Implement `src/fault/apply.js`. Use a simple `pLimit`-style semaphore (no external dep — inline 20-line implementation). Confirm pass. Commit.

**REFACTOR**: Extract `recordAudit` call from `apply.js` to use the audit module (placeholder for now). Commit.

### Task 2.4: REST routes for apply and reset

**RED**: Write `tests/integration/apply-api.test.js` using supertest:
- Test `POST /api/fault/apply` with valid body returns 200 + `{applied: [...]}`
- Test invalid `mode` returns 400
- Test unknown `target.type` returns 400
- Test `POST /api/fault/reset` returns 200 + clears all
- Mock K8s client at module boundary
- Confirm failure

**GREEN**: Wire `src/api/routes.js` to express. Confirm pass. Commit.

**REFACTOR**: Add request body validation with a small `validateApplyBody()` helper. Commit.

---

## Phase 3 — State Observation

**Goal**: The control plane polls every Pod's actual `/api/fault` endpoint every 3 seconds, detects drift between desired (ConfigMap) and actual (Pod memory) state, and reconciles drift by patching the ConfigMap.

**Done when**:
- A background loop polls all discovered Pods every 3s
- If `actual.updatedBy` does not start with `control-plane` or `reconciled:`, the loop patches the ConfigMap to match actual
- The reconciliation is observable via `/api/pods` (Pod row marked `drift` for one cycle, then `reconciled`)
- Pods that fail to respond are marked `UNKNOWN` and retried with exponential backoff up to 60s

### Task 3.1: Per-Pod state polling

**RED**: Write `tests/unit/poll-pod.test.js`:
- Test `pollPod(pod)` returns `{mode, slowDelayMs, updatedBy, reachable}` by calling `GET http://<pod-ip>:3000/api/fault`
- Test timeout (5s) returns `reachable: false`
- Test connection refused returns `reachable: false`
- Use `nock` to mock HTTP. Confirm failure

**GREEN**: Implement `src/fault/poll.js` with `pollPod(pod)`. Use Node 18's built-in `fetch` with `AbortController` for timeout. Confirm pass. Commit.

**REFACTOR**: Extract `fetchWithTimeout(url, ms)` helper. Commit.

### Task 3.2: Drift detection

**RED**: Write `tests/unit/drift.test.js`:
- Test `detectDrift(desired, actual)` returns `{drift: true, field: "mode"}` if modes differ
- Test returns `{drift: false}` if both `mode` and `slowDelayMs` match
- Test returns `{drift: false}` if actual `updatedBy` starts with `reconciled:`
- Confirm failure

**GREEN**: Implement `detectDrift`. Confirm pass. Commit.

**REFACTOR**: Make it pure (no I/O) for easy unit testing. Commit.

### Task 3.3: Polling loop with backoff

**RED**: Write `tests/integration/poll-loop.test.js`:
- Test loop calls `pollPod` for every Pod on each tick
- Test loop calls `patchFaultState` when `detectDrift` returns `drift: true`
- Test unreachable Pods get exponential backoff (delays 1s, 2s, 4s, 8s, 16s, 32s, 60s, 60s, ...)
- Use fake timers. Confirm failure

**GREEN**: Implement `startPollingLoop(ctx)` in `src/fault/poll.js`. Confirm pass. Commit.

**REFACTOR**: Move backoff state to a `Map<podName, {failures, nextRetryAt}>`. Commit.

---

## Phase 4 — Real-time + Audit

**Goal**: The control plane emits SSE events on every state change and audit log entry, with an in-memory ring buffer of the last 200 audit entries.

**Done when**:
- `GET /api/events` returns `text/event-stream` and emits `pod_state_change`, `drift_detected`, `audit_event` events
- `GET /api/audit?limit=50` returns the most recent N entries
- The ring buffer caps at 200 entries; oldest are evicted
- Buffer is lost on restart (intentional v1)

### Task 4.1: Internal event bus

**RED**: Write `tests/unit/event-bus.test.js`:
- Test `bus.on('pod_state_change', handler)` is called when `bus.emit('pod_state_change', payload)` runs
- Test multiple handlers receive the same event
- Test `off()` removes a handler
- Confirm failure

**GREEN**: Implement `src/events/bus.js` wrapping Node's `EventEmitter`. Confirm pass. Commit.

**REFACTOR**: Wrap with a `typedBus` that accepts payload schemas. Commit.

### Task 4.2: Audit ring buffer

**RED**: Write `tests/unit/audit.test.js`:
- Test `recordAudit(entry)` adds to buffer
- Test `getAudit(limit)` returns at most `limit` most recent entries
- Test buffer caps at 200 — the 201st evicts the oldest
- Confirm failure

**GREEN**: Implement `src/events/audit.js` with a fixed-size array + shift on overflow. Confirm pass. Commit.

**REFACTOR**: Make the cap configurable via `config.AUDIT_BUFFER_SIZE`. Commit.

### Task 4.3: SSE endpoint

**RED**: Write `tests/integration/sse.test.js`:
- Test `GET /api/events` returns `Content-Type: text/event-stream`
- Test client receives an event after `bus.emit('pod_state_change', payload)` is triggered
- Test keep-alive ping is sent every 20s
- Use a small Node SSE client. Confirm failure

**GREEN**: Implement `src/events/sse.js` with the SSE pattern from the existing app (line 484 of app.js as reference). Wire to bus events. Confirm pass. Commit.

**REFACTOR**: Add automatic cleanup of dead subscribers on `write` failure. Commit.

### Task 4.4: Wire audit + bus into apply path

**RED**: Write `tests/integration/audit-emit.test.js`:
- Test a successful `applyFault` triggers an `audit_event` SSE message
- Test `recordAudit` is called with correct shape (timestamp, actor, action, target, mode, result)
- Confirm failure

**GREEN**: Update `src/fault/apply.js` to call `recordAudit` and `bus.emit('audit_event', entry)`. Confirm pass. Commit.

**REFACTOR**: Add `actor` extraction from request (placeholder for now, real Basic Auth user comes in Phase 6). Commit.

---

## Phase 5 — Dashboard UI

**Goal**: A single-page EJS dashboard that shows all Pods in a table, allows targeting and fault application, and updates in real time via SSE.

**Done when**:
- `GET /` renders an EJS page with: filter bar, action panel, Pod table, audit log
- Table updates in real time when SSE events fire
- Injecting a fault via the form posts to `POST /api/fault/apply` and shows a toast on success/failure
- Reuses design tokens, partials, toast system from LB_Test_WebSite via copy or symlink

### Task 5.1: EJS scaffold with reused partials

**RED**: Write `tests/integration/dashboard-render.test.js`:
- Test `GET /` returns 200 HTML containing the page title "LB Fault Control Plane"
- Test the rendered HTML includes the partials: nav, footer
- Confirm failure

**GREEN**: Create `src/views/layout.ejs` + `src/views/dashboard.ejs`. Symlink (or copy on first run) `partials/` from `../LB_Test_WebSite/views/partials/`. Confirm pass. Commit.

**REFACTOR**: Document the symlink strategy in a README. Commit.

### Task 5.2: Pod table + filter

**RED**: Write `tests/integration/dashboard-pods.test.js`:
- Test `GET /` response contains a `<table>` with one row per discovered Pod
- Test the row contains Pod name, current mode, status icon
- Test label-selector input prefilled with `app=load-balancer-test`
- Confirm failure

**GREEN**: Implement the table in `dashboard.ejs` with a server-side initial render of `ctx.pods`. Confirm pass. Commit.

**REFACTOR**: Extract `<%- include('partials/pod-row', {pod}) %>` partial. Commit.

### Task 5.3: Action form (target + mode)

**RED**: Write `tests/integration/dashboard-form.test.js`:
- Test the form has radio buttons for target type (all/single/selector/canary)
- Test the form has a mode `<select>` with all 6 options
- Test the form posts to `/api/fault/apply` on submit
- Confirm failure

**GREEN**: Implement the form. Use progressive enhancement (works without JS first). Confirm pass. Commit.

**REFACTOR**: Add input validation hints (e.g., selector must contain `=`). Commit.

### Task 5.4: Real-time updates via SSE on the client

**RED**: Write `tests/integration/dashboard-sse.test.js` using a headless browser (puppeteer is too heavy; use JSDOM + manual EventSource mock):
- Test that on receiving a `pod_state_change` event, the corresponding row's mode cell updates
- Test that a `drift_detected` event triggers a warn toast
- Confirm failure

**GREEN**: Implement `public/js/dashboard.js` with EventSource listener. Confirm pass. Commit.

**REFACTOR**: Extract `mergeStateChange(rowEl, payload)` for testability. Commit.

---

## Phase 6 — Access Control + Deployment

**Goal**: The control plane is exposed via Ingress with Basic Auth, packaged in a Docker image, and deployable via standard `kubectl apply -f`.

**Done when**:
- `htpasswd` Secret `lb-control-plane-auth` is created and consumed by Ingress
- `curl -u admin:pass https://fault-control.lb-test.local/` returns 200; without auth returns 401
- `docker build` produces a working image
- `kubectl apply -f k8s/` brings up a healthy Deployment

### Task 6.1: Basic Auth Secret

**RED**: This is manifest-only; verification is integration. Write a `tests/integration/auth.test.js`:
- Test that `GET /` on the deployed Ingress without `Authorization` header returns 401
- (Skip if no live cluster — run as part of Phase 7 verification)
- For local: mock the upstream and verify the Ingress template's annotations

**GREEN**: Create `k8s/secret-template.yaml` with documentation on generating htpasswd. Commit. (Real Secret is created at deploy time.)

**REFACTOR**: Add a `Makefile` target `auth-secret` that runs `htpasswd -nbB admin ...` and pipes into `kubectl apply`. Commit.

### Task 6.2: Dockerfile (multi-stage)

**RED**: Write `tests/integration/container.test.js`:
- Test `docker run -p 8080:8080 <image>` starts and `GET /healthz` returns 200 inside the container
- Confirm failure (no Dockerfile yet)

**GREEN**: Write `Dockerfile` with `node:18-alpine` builder stage and final `node:18-alpine` runtime. Pin versions. Confirm pass. Commit.

**REFACTOR**: Add `.dockerignore` to skip `node_modules`, `tests`, `docs`. Commit.

### Task 6.3: K8s manifests

**RED**: N/A (manifests are validated by `kubectl apply --dry-run=client`).

**GREEN**: Write `k8s/deployment.yaml`, `service.yaml`, `ingress.yaml`, `serviceaccount.yaml`, `role.yaml`, `rolebinding.yaml` per the design's "Components" + "Trust boundaries" sections. Use `role=fault-state` label selector in Role. Commit.

**REFACTOR**: Add `podDisruptionBudget` with `minAvailable: 1`. Commit.

---

## Phase 7 — App-side Integration

**Goal**: The existing `app.js` in LB_Test_WebSite reads its own ConfigMap on startup, watches it for changes via informer, and reflects changes in its in-memory `faultState`.

**Done when**:
- After `kubectl apply` of the updated app, each app Pod reads its ConfigMap on boot and sets the initial fault mode
- When the control plane patches a Pod's ConfigMap, the Pod updates its in-memory state within 2 seconds (informer latency)
- The `updatedBy` field in `/api/fault` is `"control-plane"` for informer-driven changes
- RBAC for the app Deployment is scoped to its own ConfigMap only

### Task 7.1: Add @kubernetes/client-node to app

**RED**: N/A (the dependency is just listed; the actual test is 7.2).

**GREEN**: Update `LB_Test_WebSite/package.json` to add `@kubernetes/client-node`. Run `npm install`. Commit.

**REFACTOR**: N/A.

### Task 7.2: ConfigMap read on startup

**RED**: Write `tests/unit/app-startup.test.js` in the LB_Test_WebSite repo (Jest configured for the first time — add `jest.config.js`):
- Test `loadInitialFaultState(podName, k8sClient)` returns `{mode, slowDelayMs}` from the ConfigMap
- Test missing ConfigMap returns `null` (app falls back to `none`)
- Mock `@kubernetes/client-node`. Confirm failure

**GREEN**: Implement `src/k8s-startup.js` in LB_Test_WebSite. Hook into `app.js` startup to call `loadInitialFaultState` before `server.listen`. Confirm pass. Commit.

**REFACTOR**: Make the ConfigMap name derived from downward API env var `POD_NAME`. Commit.

### Task 7.3: Informer watch + onChange

**RED**: Write `tests/unit/app-informer.test.js`:
- Test when the ConfigMap changes, the app's `faultState.mode` is updated
- Test the app calls `setFaultMode(newMode, "control-plane")` with the right `updatedBy`
- Mock the watch API to emit a "MODIFIED" event. Confirm failure

**GREEN**: Implement `src/k8s-informer.js` in LB_Test_WebSite. Use `Watch` from `@kubernetes/client-node`. Wire to existing `setFaultMode`. Confirm pass. Commit.

**REFACTOR**: Add reconnect-with-backoff on watch failure. Commit.

### Task 7.4: Deployment manifest updates

**RED**: N/A (manifests validated at deploy time).

**GREEN**: Update `LB_Test_WebSite/k8s/deployment.yaml`:
- Add downward API env var: `POD_NAME` from `metadata.name`
- Add `serviceAccountName: load-balancer-test-app`
- Create new files: `k8s/serviceaccount.yaml`, `k8s/role.yaml`, `k8s/rolebinding.yaml` scoped to `role=fault-state` label and `resourceNames: ["fault-state-$(POD_NAME)"]`
- Commit.

**REFACTOR**: Document in CLAUDE.md. Commit.

### Task 7.5: End-to-end verification

**RED**: N/A (this is the smoke test that closes the feature).

**GREEN** (verification only, not a code change):
1. Build both images: `docker build` for control plane + existing app
2. Push to `172.20.20.250/webapps/`
3. `kubectl apply -f k8s/` in both repos
4. Open Ingress URL, log in with Basic Auth
5. Verify all Pods show as `none` initially
6. Click "Inject reset" on a single Pod → verify within 5s the row shows `reset` + F5 monitor shows member DOWN
7. Click "Reset All" → verify all rows return to `none` within 5s
8. Run `curl -X POST http://<node-ip>:30080/api/fault -d '{"mode":"http_500"}'` directly to a Pod → verify within 5s the control plane shows the drift + reconciles
9. `kubectl delete pod -l app=lb-fault-control-plane` → verify injected faults remain applied (ConfigMap is source of truth)
10. Capture results in a `docs/superpowers/verification/2026-06-26-control-plane.md`

---

## Out of Scope (YAGNI)

These are explicitly NOT in this plan, cross-referenced from the design's Non-Goals:

- Multi-cluster support
- Scheduled fault injection
- Per-user RBAC (single shared Basic Auth)
- Historical charts / analytics
- WebSocket-based push
- High availability (multiple control plane replicas)
- Prometheus / metrics endpoint

## Verification Strategy (summary)

| Level | Method | When |
|-------|--------|------|
| Unit | Jest (each task) | Every task |
| Integration | supertest + nock | Phases 2, 3, 4, 5 |
| Container | `docker run` + healthz | Phase 6 |
| E2E in K8s | manual dashboard + F5 | Phase 7 |

## Critical Files (Cross-Reference)

| File | Phase | Notes |
|------|-------|-------|
| `lb-fault-control-plane/src/server.js` | 1.1 | Express bootstrap |
| `lb-fault-control-plane/src/k8s/client.js` | 1.2 | K8s client loader |
| `lb-fault-control-plane/src/k8s/pods.js` | 1.3 | Pod listing |
| `lb-fault-control-plane/src/k8s/configmaps.js` | 1.4, 1.5, 2.2 | ConfigMap CRUD + reconcile + patch |
| `lb-fault-control-plane/src/fault/targets.js` | 2.1 | 4-way target selection |
| `lb-fault-control-plane/src/fault/apply.js` | 2.3, 4.4 | Orchestrator + audit emit |
| `lb-fault-control-plane/src/fault/poll.js` | 3.1, 3.3 | Polling + backoff |
| `lb-fault-control-plane/src/events/bus.js` | 4.1 | Internal event bus |
| `lb-fault-control-plane/src/events/audit.js` | 4.2 | Ring buffer |
| `lb-fault-control-plane/src/events/sse.js` | 4.3 | SSE endpoint |
| `lb-fault-control-plane/src/api/routes.js` | 2.4, 5.x | REST + dashboard route |
| `lb-fault-control-plane/k8s/role.yaml` | 6.3 | **Scoped to `role=fault-state` label** |
| `LB_Test_WebSite/src/k8s-startup.js` | 7.2 | New file in existing repo |
| `LB_Test_WebSite/src/k8s-informer.js` | 7.3 | New file in existing repo |
| `LB_Test_WebSite/app.js` | 7.2, 7.3 | Wire startup + informer hooks |
| `LB_Test_WebSite/k8s/deployment.yaml` | 7.4 | Downward API + serviceAccountName |
| `LB_Test_WebSite/k8s/role.yaml` | 7.4 | New, scoped to own ConfigMap name |

## Estimated Effort

| Phase | Tasks | Est. (hours) |
|-------|-------|--------------|
| 1 | 5 | 4-6 |
| 2 | 4 | 5-7 |
| 3 | 3 | 4-5 |
| 4 | 4 | 3-4 |
| 5 | 4 | 5-7 |
| 6 | 3 | 2-3 |
| 7 | 5 | 4-6 |
| **Total** | **28** | **27-38** |

## Execution Notes

- Execute phases in order; each phase's "Done when" must be satisfied before moving on
- Within a phase, tasks are also ordered (later tasks depend on earlier ones' code)
- Commit at every RED, GREEN, and REFACTOR step — keeps git history as a progress log
- The verification step in Phase 7 is the only one that touches a real K8s cluster
- If a test fails for an unexpected reason, **stop and debug** — do not paper over with `it.skip()`
