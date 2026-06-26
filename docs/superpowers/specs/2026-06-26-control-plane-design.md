# Control Plane for K8s Fault Injection — Design

**Date**: 2026-06-26
**Status**: Design (approved for implementation planning)
**Owner**: YuJiehao
**Project**: LB_Test_WebSite (load-balancer-test) v1.8+

## Context

`app.js` provides 6 fault-injection modes (`none` / `http_500` / `http_503` / `slow` / `wrong_body` / `reset`) for testing F5 load balancer behaviour. Today the fault state lives **in each Pod's process memory** and is changed by `POST /api/fault`, which only affects the Pod that receives the request.

This creates three problems:

1. **No Pod selection from outside the cluster.** Operators can only inject into whichever Pod the LoadBalancer happens to route to. To target Pod-1 specifically, you must know its IP and bypass the LB.
2. **No aggregated view.** `GET /api/fault` returns only the local Pod's state. There is no way to see all Pods' states at once.
3. **State evaporates on Pod restart.** In-memory state is lost on process restart (liveness probe failure, HPA scale-down, manual redeploy).

The user wants a **control plane** that lets a single operator select Pods by various targeting modes, inject or clear faults, see all Pods' states in real time, and have state survive Pod restarts.

## Goals

- Select target Pods with **four granularities**: single Pod / all Pods / label selector / percentage canary
- Apply a fault mode to selected Pods **atomically from the operator's perspective** (operator presses one button; control plane fans out)
- Persist desired state in **K8s ConfigMaps** so Pod restarts restore state
- Aggregate live state from **all Pods** into a single dashboard
- **Recognise and reconcile** faults injected directly to a Pod via NodePort (existing path stays usable)
- Survive control-plane restarts (graceful recovery from in-memory state)

## Non-Goals (YAGNI for v1)

- Multi-cluster control
- Scheduled fault injection ("inject at 09:00 tomorrow")
- Per-user RBAC (single shared Basic Auth is sufficient for v1)
- Historical chart / dashboard analytics (live table + audit log only)
- WebSocket-based push (SSE is enough for one-way state feed)
- High availability (single replica of control plane is fine)

## Architecture Overview

```
┌─────────────────┐         ┌──────────────────────┐
│  SRE / Tester   │ ──HTTPS─→│  Ingress (Basic Auth)│
│  (browser)      │         │  nginx.ingress...    │
└─────────────────┘         └──────────┬───────────┘
                                        │
                                        ▼
                        ┌────────────────────────────┐
                        │   Control Plane Service    │
                        │   (Node.js + Express)      │
                        │                            │
                        │   - REST API               │
                        │   - EJS dashboard          │
                        │   - SSE for live updates   │
                        │                            │
                        │   ServiceAccount:          │
                        │     lb-control-plane       │
                        │     (configmap-writer RBAC)│
                        └───┬──────────────────┬─────┘
                            │                  │
              ┌─K8s API─────┘                  └─HTTP (poll)──┐
              │  patch ConfigMap                              │
              ▼                                               ▼
   ┌─────────────────────┐                    ┌────────────────────────┐
   │ fault-state-<pod-1> │ ←── informer ────→ │  Pod-1 (app.js)         │
   │ fault-state-<pod-2> │ ←── informer ────→ │  Pod-2 (app.js)         │
   └─────────────────────┘                    └────────────────────────┘
```

### Trust boundaries

- **Browser → Control Plane**: HTTPS, Basic Auth via Ingress
- **Control Plane → K8s API**: in-cluster ServiceAccount `lb-control-plane` with `Role` granting `get/list/watch/create/update/patch/delete` on `configmaps` **scoped by label selector `role=fault-state`** (no wildcard access to other ConfigMaps in the namespace)
- **Control Plane → Pod**: HTTP to `http://<pod-ip>:3000/api/fault` (in-cluster, no auth — Pod trusts control plane because Pod IPs are not externally reachable without explicit NetworkPolicy allowing it)
- **Pod → K8s API (read-only)**: `ServiceAccount` on the app Deployment with `Role` granting `get/watch` on `configmaps` filtered by `resourceNames: ["fault-state-<pod-name>"]` and label selector `role=fault-state`

## Components

### C1. Control Plane Deployment (new)

| Field | Value |
|-------|-------|
| Image | `172.20.20.250/webapps/lb-fault-control-plane:v1.0` |
| Replicas | 1 |
| Port | 8080 |
| Resources | requests: 64Mi/50m, limits: 128Mi/200m |
| Probes | `GET /healthz` on 8080 |
| ServiceAccount | `lb-control-plane` |
| Service | `lb-control-plane-service` (ClusterIP, port 80 → 8080) |

### C2. Control Plane Ingress (new)

| Annotation | Value |
|------------|-------|
| `kubernetes.io/ingress.class` | `nginx` |
| `nginx.ingress.kubernetes.io/auth-type` | `basic` |
| `nginx.ingress.kubernetes.io/auth-secret` | `lb-control-plane-auth` |
| `nginx.ingress.kubernetes.io/auth-realm` | `LB Fault Control Plane` |

Host: e.g. `fault-control.lb-test.local` (operator-configurable via Ingress `host` field).

### C3. app.js changes (minimal)

Add the following without touching existing endpoints:

1. **Startup hook**: read own ConfigMap `fault-state-<pod-name>` (pod name injected via downward API `metadata.name`); set initial `faultState` from it
2. **Informer**: watch own ConfigMap for changes; call existing `setFaultMode()` on change
3. **Audit-friendly `updatedBy`**: when setFaultMode is called from informer, pass `updatedBy = "control-plane"`

Existing endpoints (`GET /health`, `POST /api/fault`, `GET /api/fault`, `GET /api/fault/stream`) remain unchanged for backwards compatibility.

### C4. K8s Resources Created by Control Plane at Startup

On first launch the control plane performs a one-time reconciliation:

1. List all Pods with label `app=load-balancer-test` in its namespace
2. For each Pod, check if ConfigMap `fault-state-<pod-name>` exists
3. If missing, create it with default data: `{"mode":"none","slowDelayMs":"60000","updatedAt":"","updatedBy":"control-plane-bootstrap"}`

Label applied to all ConfigMaps: `app=load-balancer-test, role=fault-state`.

## Data Flow

### Happy path: user injects `http_500` to a single Pod

```
Browser  POST /api/fault/apply
         { target: { type: "single", pod: "pod-xyz-abc" },
           mode: "http_500", slowDelayMs: 60000 }
    │
    ▼
Control Plane
    │
    ├─→ K8s API: patch ConfigMap fault-state-pod-xyz-abc
    │       data.mode = "http_500"
    │       data.slowDelayMs = "60000"
    │       data.updatedAt = "2026-06-26 10:30:00"
    │       data.updatedBy = "admin"   (from Basic Auth user)
    │
    ├─→ Audit ring buffer: append entry
    │
    └─→ Async (every 3s): poll each Pod's /api/fault to detect drift

Pod-xyz-abc app
    │
    ├─→ Informer onChange → setFaultMode("http_500", "control-plane")
    ├─→ Pause WS ticks, change /health behaviour
    └─→ SSE broadcast fault_state (existing behaviour)
                │
                ▼
        Browser table updates row in real time
```

### Four target granularities

| Type | Implementation |
|------|----------------|
| `single` | `kubectl patch configmap fault-state-<pod> -p ...` |
| `all` | Loop `patch` over discovered Pods in parallel (Promise.all, max 5 concurrent) |
| `selector` | `kubectl get pods -l <selector> -o name` → loop |
| `canary` | `hash(pod-name) % 100 < N%` to pick subset (deterministic & reproducible) |

### Canary selection algorithm

```js
function selectCanary(pods, percent) {
  return pods.filter(pod =>
    Math.abs(hashCode(pod.metadata.name)) % 100 < percent
  );
}
```

Pod-name hashing is deterministic so re-applying the same percentage always picks the same Pods — useful for reproducible chaos tests.

## Control Plane REST API (v1 surface)

| Method | Path | Body / Params | Returns |
|--------|------|---------------|---------|
| `GET` | `/` | — | EJS dashboard |
| `GET` | `/healthz` | — | `200 OK` plain text (Ingress probe) |
| `GET` | `/api/pods` | query: `?selector=app=foo` (optional) | `[{name, ip, node, mode, slowDelayMs, updatedAt, updatedBy, reachable}, ...]` |
| `POST` | `/api/fault/apply` | `{target: {type, pod?, selector?, percent?}, mode, slowDelayMs?}` | `{applied: [pod-names], skipped: [], errors: []}` |
| `POST` | `/api/fault/reset` | — | Resets all Pods to `none` |
| `POST` | `/api/pods/:name/force-sync` | — | Re-pushes Pod's ConfigMap state to its memory (POST /api/fault on Pod) |
| `GET` | `/api/audit` | query: `?limit=50` | Recent audit log entries (in-memory ring buffer, last 200) |
| `GET` | `/api/events` | — | SSE: emits `pod_state_change`, `audit_event`, `drift_detected` |

### Audit log entry shape

```json
{
  "timestamp": "2026-06-26 10:30:00",
  "actor": "admin",
  "action": "apply|reset|external-reconcile|force-sync|bootstrap",
  "target": { "type": "single", "pod": "pod-xyz-abc" },
  "mode": "http_500",
  "slowDelayMs": 60000,
  "result": "ok|partial|failed",
  "detail": "applied to 1/1 pods"
}
```

Stored in an in-memory ring buffer (cap 200). Lost on control-plane restart by design (v1 simplification).

## External Injection Handling (NodePort path)

### Scenario

Operator runs `curl -X POST http://<node-ip>:30080/api/fault -d '{"mode":"reset"}'`. This bypasses the control plane and changes one Pod's in-memory state.

### Detection

Control plane polls `GET /api/fault` on every Pod every 3s. If `updatedBy` does not start with `"control-plane"` (or matches `"reconciled:..."` but is older than the local ConfigMap), treat as drift.

### Reconciliation

Control plane patches the Pod's ConfigMap to match its actual state, setting:

```
data.updatedBy = "reconciled:<original-updatedBy>"
data.reconciledAt = "<ISO timestamp>"
```

UI then shows the affected row with a red border + tooltip "externally modified at 10:35 by client 192.168.1.5".

### Persistence window

- External injection is durable as soon as the next reconcile poll runs (≤3s)
- Within that window, if the Pod restarts, the external injection is lost (ConfigMap not yet patched)
- This is an accepted trade-off in v1 — see "Open Questions" below

### What the app does NOT do

- App **does not write its own ConfigMap** (RBAC stays minimal)
- App **does not** special-case external sources beyond recording `updatedBy`

## UI Design

Single-page dashboard at `/` (EJS template). Reuses existing `partials/` (head, nav, footer, icon), design tokens (`base.css`), toast system (`notice.js`), and SSE pattern.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ 🛡️ LB Fault Control Plane  • admin@team  • last refresh 2s ago │
├─────────────────────────────────────────────────────────────────┤
│ [Label: app=load-balancer-test] [🔄 Refresh] [📊 Pods: 2/2 UP] │
├─────────────────────────────────────────────────────────────────┤
│  Target:  ◉ All  ○ Single ○ Selector ○ Canary 50%              │
│  Mode:    [http_500 ▾]   slowDelayMs: [60000]                  │
│  [💥 Inject]  [♻️ Reset All]                                    │
├─────────────────────────────────────────────────────────────────┤
│ Pod Name           │ Status │ Mode      │ Updated At  │ By      │
│ pod-xyz-abc        │ 🟢 UP  │ none      │ 10:25:31    │ admin   │
│ pod-xyz-def        │ 🔴 DOWN│ reset     │ 10:30:02    │ admin   │
├─────────────────────────────────────────────────────────────────┤
│ 📋 Audit Log (last 50)                                         │
│ 10:30:02  admin  apply reset → pod-xyz-def                     │
│ 10:25:31  admin  reset all                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Status semantics

- 🟢 **UP**: Pod's `/health` returns 200 + `HEALTHY` AND ConfigMap says `none`
- 🔴 **DOWN**: Pod's `/health` returns injected fault response (or ConfigMap says non-`none` and Pod confirms)
- ⚪ **UNKNOWN**: Cannot reach Pod (timeout / connection refused)

### Real-time updates

- SSE `/api/events` pushes `pod_state_change` events; client merges into table
- Toasts on `drift_detected` (warn) and `apply`/`reset` success (info)
- Manual refresh button forces a re-fetch

## Error Handling Matrix

| Failure | Detection | Recovery |
|---------|-----------|----------|
| K8s API unreachable | API call timeout (5s) | Yellow banner "K8s API unreachable, using cached view"; auto-retry with backoff |
| ConfigMap missing for a Pod | `get` returns 404 | Control plane creates it with default state |
| Control plane can't reach Pod HTTP | Poll timeout / connection refused | Mark Pod ⚪ UNKNOWN, exponential backoff (max 60s) |
| Concurrent ConfigMap patch conflict | K8s API returns 409 (resourceVersion mismatch) | Re-fetch + retry up to 3 times; final 409 returned to UI |
| Pod deleted mid-operation | K8s API returns 404 | Delete orphan ConfigMap, remove from UI |
| App's informer disconnects | Library auto-reconnects | On failure, app falls back to 30s poll of ConfigMap |
| Control plane crashes | Liveness probe fails, K8s restarts Pod | On restart: re-list Pods, reconcile ConfigMaps, resume polling |

## Testing Strategy

| Level | Method | Validates |
|-------|--------|-----------|
| Unit (control plane) | Jest | Canary hash selection, audit ring buffer, target parser |
| Unit (app informer) | Jest with mocked K8s client | ConfigMap change → setFaultMode invocation |
| Integration | Local `kind` cluster with 2 app replicas + 1 control plane | End-to-end fault injection via API and via NodePort |
| E2E (real cluster) | Manual via dashboard + F5 monitor | Apply `reset` → F5 marks member DOWN within 1 interval → UI shows DOWN |
| Chaos | `kubectl delete pod -l app=lb-fault-control-plane` | Existing faults remain applied (K8s ConfigMap + app informer handle it); control plane recovers state on restart |

## Open Questions

None at design time. The "3s external-injection drift window" was discussed and **accepted** by the user as a v1 trade-off.

## Repository Layout

This feature touches two artefacts:

1. **New repository / directory**: `lb-fault-control-plane/` — the control plane service
   - Its own `package.json`, Dockerfile, K8s manifests, source tree
   - Re-uses the design tokens and partials pattern from this repo via copying or git submodule
2. **Existing repository** (this repo): LB_Test_WebSite
   - Adds `@kubernetes/client-node` dependency
   - Adds startup hook + informer in `app.js`
   - Adds downward API env var for pod name in `k8s/deployment.yaml`
   - Adds ServiceAccount + Role + RoleBinding for the app Deployment
   - Volume / ConfigMap mount is **not** required (app uses K8s API client, not filesystem)

## Implementation Order (for `writing-plans`)

1. **Backend foundation**: control plane scaffold, K8s API client, ServiceAccount + RBAC
2. **Data layer**: Pod listing, ConfigMap reconcile-on-startup, target selection algorithms
3. **Fault application path**: `POST /api/fault/apply`, `POST /api/fault/reset`, ConfigMap patch + parallelism
4. **State observation**: per-Pod polling loop, drift detection + reconciliation
5. **SSE + audit**: `/api/events`, in-memory ring buffer, event broadcasting
6. **Dashboard UI**: EJS page, table component, target/mode form, toast integration
7. **Ingress + Basic Auth**: Secret, Ingress resource, auth flow
8. **App-side changes** (this repo): ConfigMap read on startup, informer, downward API for pod name, RBAC
9. **Deployment manifests**: Dockerfile, Deployment, Service, RBAC, ServiceAccount
10. **Tests**: unit (Jest) + integration (kind) + chaos scenario