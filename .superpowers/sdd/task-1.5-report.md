# Task 1.5 Report — Reconcile ConfigMaps on startup

**Status:** DONE
**Branch:** `feature/control-plane`
**Date:** 2026-06-26
**Commits:** `44b7e96` (RED) → `cb392e0` (GREEN) → `58caad7` (REFACTOR)

## What was implemented

Two new exports in `control-plane/src/k8s/configmaps.js`:

- `reconcileOnStartup(client, namespace)` — lists Pods with `app=load-balancer-test`, lists existing fault-state ConfigMaps, and creates a default `fault-state-<pod>` ConfigMap for every Pod that lacks one. Returns `{created: string[], skipped: string[], errors: Array<{podName, error}>}`. Errors during create are captured per-Pod (one failure does not abort the rest of the sweep) but rethrown errors from the listing calls propagate as usual.
- `defaultFaultState(podName, namespace)` — pure builder that returns the K8s API payload `{apiVersion: "v1", kind: "ConfigMap", metadata: {name, labels: {role, pod}, namespace}, data: {mode: "none", slowDelayMs: "60000", updatedAt: "", updatedBy: "control-plane-bootstrap"}}`. Centralised so reconcile, the future apply path, and any reset-to-defaults code all stamp out identical ConfigMaps.

The Pod-app selector (`app=load-balancer-test`) is a private constant inside `configmaps.js` — YAGNI says it stays local until a second caller appears.

## TDD Evidence

### RED (commit `44b7e96`)

`tests/unit/reconcile.test.js` written with two tests. First run:
```
FAIL tests/unit/reconcile.test.js
  reconcileOnStartup()
    ✕ creates a fault-state ConfigMap for every Pod that lacks one
    ✕ is idempotent: zero creates when every Pod already has a ConfigMap
  TypeError: reconcileOnStartup is not a function
```
Failure mode confirms the test exercises the right boundary (missing export, not a logic error in the test).

### GREEN (commit `cb392e0`)

Implementation in `configmaps.js`. After one fix to the test fixture to include `apiVersion` / `kind` in the expected body (matching the brief spec, which lists them as part of `defaultFaultState`'s return shape):
```
PASS tests/unit/reconcile.test.js
  reconcileOnStartup()
    ✓ creates a fault-state ConfigMap for every Pod that lacks one (5 ms)
    ✓ is idempotent: zero creates when every Pod already has a ConfigMap (1 ms)
Tests: 2 passed, 2 total
```
Full suite: 5 suites / 13 tests, all green.

### REFACTOR (commit `58caad7`)

The GREEN `defaultFaultState` left `namespace: ''` as a placeholder and `reconcileOnStartup` mutated `body.metadata.namespace` after the call. REFACTOR moved namespace into the builder's signature: `defaultFaultState(podName, namespace)`, making the helper pure and removing the mutation. Behaviour unchanged; full suite 13/13 still green.

## Files changed

| Path | Change |
|------|--------|
| `control-plane/src/k8s/configmaps.js` | +`reconcileOnStartup`, +`defaultFaultState(podName, namespace)`, +require `./pods` |
| `control-plane/tests/unit/reconcile.test.js` | new — 2 unit tests |

## Self-review

- **TDD cadence preserved:** 3 commits in strict RED → GREEN → REFACTOR order, no out-of-order code. No prior subagent intervention needed.
- **Test isolation:** mocks at the three relevant API boundaries (`pods.listNamespacedPod`, `configMaps.listNamespacedConfigMap`, `configMaps.createNamespacedConfigMap`) only; real reconciliation logic and the real `defaultFaultState` run against a realistic fixture.
- **API contract asserted:** the test pins the exact `labelSelector` (`app=load-balancer-test` and `role=fault-state`) and the exact `createNamespacedConfigMap` payload shape (name, labels, data fields) — a future regression that drops `updatedBy` or renames the prefix will be caught.
- **Idempotency verified:** second test asserts `not.toHaveBeenCalled()` on `createNamespacedConfigMap` when all Pods already have a ConfigMap — matches the brief's "zero API calls" criterion.
- **YAGNI respected:** no orphan-ConfigMap deletion (explicitly excluded by brief), no retry on 409 (Phase 2's job), no parallelisation (3-replica deployment is small enough to not need it yet), no logging inside the function (caller decides how to log the summary it returns).
- **Error handling:** `create` errors are caught per-Pod so a single 409 from one Pod does not abort reconciliation of the rest. The summary surfaces them via `errors[]`. Listing errors propagate to the caller.
- **Pure helper:** `defaultFaultState` is now a pure function (deterministic output for given inputs, no mutation) — testable in isolation if needed later.

## Concerns / Minor findings (record for final review)

- The Pod-app selector `app=load-balancer-test` is hard-coded in `configmaps.js`. The brief's `labels.js` already exports fault-state labels; when a second caller for the app selector appears, move it there. Noted but not worth a dedicated refactor.
- `reconcileOnStartup` does not check `existingByPod` against a stale list — if a new Pod is created between `listPods` and the per-Pod create, the helper will not see it. Acceptable for a one-shot startup hook; a future polling loop would re-list.
- `defaultFaultState` includes `apiVersion: "v1"` and `kind: "ConfigMap"`. The `@kubernetes/client-node` library is tolerant of missing fields (it fills them in), so this is technically redundant — but it makes the payload self-describing and matches the brief verbatim, so left in.
- ESLint config still missing (pre-existing issue from Task 1.1, not introduced here).
- The test fixture for the create call originally omitted `apiVersion`/`kind` — the test was updated to match the brief's spec. Worth noting because the diff is mixed in the GREEN commit, not a separate "test fix" commit. The TDD intent (RED asserts the contract → GREEN satisfies it) is still preserved at the commit level.
