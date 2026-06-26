# Control Plane E2E Verification

**Date**: 2026-06-26
**Branch**: `feature/control-plane`
**Cluster**: K8s (LB_Test_WebSite)

## Prerequisites

- `docker` CLI with access to `172.20.20.250/webapps/` registry
- `kubectl` configured for the target cluster
- F5 BIG-IP with HTTP monitor configured for the LB pool

## Verification Steps

### 1. Build and Push Images

```bash
# Control plane image
cd control-plane
docker build -t 172.20.20.250/webapps/control-plane:v0.1 .
docker push 172.20.20.250/webapps/control-plane:v0.1

# App image (with k8s integration)
cd ..
docker build -t 172.20.20.250/webapps/load-balancer-test:v1.9 .
docker push 172.20.20.250/webapps/load-balancer-test:v1.9
```

### 2. Deploy Control Plane

```bash
kubectl apply -f control-plane/k8s/serviceaccount.yaml
kubectl apply -f control-plane/k8s/role.yaml
kubectl apply -f control-plane/k8s/rolebinding.yaml
kubectl apply -f control-plane/k8s/deployment.yaml
kubectl apply -f control-plane/k8s/service.yaml
kubectl apply -f control-plane/k8s/ingress.yaml  # requires Ingress controller

# Create Basic Auth secret
htpasswd -nbB admin <password> | kubectl create secret generic lb-control-plane-auth \
  --from-file=auth=/dev/stdin -n default
```

### 3. Deploy Updated App

```bash
kubectl apply -f k8s/app-serviceaccount.yaml
kubectl apply -f k8s/app-role.yaml
kubectl apply -f k8s/app-rolebinding.yaml
kubectl apply -f k8s/deployment.yaml
```

### 4. Verify Control Plane Dashboard

```bash
# Open Ingress URL, log in with Basic Auth
open https://fault-control.lb-test.local/

# Verify:
# - All Pods show as `none` initially (mode column)
# - Pod table shows correct Pod name, IP, status
# - Label selector filter is prefilled with `app=load-balancer-test`
```

### 5. Inject Fault on Single Pod

1. On dashboard, select **Single Pod** target
2. Choose a Pod from the dropdown
3. Select mode: `reset` (most reliable)
4. Click **Apply**
5. Wait 5 seconds
6. Verify:
   - Pod row shows `reset` in mode column
   - Pod's `/api/fault` returns `{"mode":"reset","slowDelayMs":0,"updatedBy":"control-plane"}`
   - F5 monitor shows member as DOWN (Connection refused — TCP RST)

### 6. Reset All Pods

1. Select **All Pods** target
2. Select mode: `none`
3. Click **Apply**
4. Wait 5 seconds
5. Verify:
   - All Pod rows return to `none`
   - All Pods' `/api/fault` return `mode: "none"`
   - F5 monitor shows all members UP

### 7. External Injection via NodePort → Drift Detection

```bash
# Inject fault directly via a Pod's NodePort (bypassing control plane)
curl -X POST http://<node-ip>:30080/api/fault \
  -H 'Content-Type: application/json' \
  -d '{"mode":"http_500"}'
```

Wait 5 seconds. Verify:
- Control plane dashboard shows the Pod as **drift** (highlighted row)
- Within the next polling cycle (~3s), the Pod returns to its ConfigMap state
- The reconciliation is recorded in audit log

### 8. Verify ConfigMap is Source of Truth

```bash
# Delete a control-plane Pod
kubectl delete pod -l app=control-plane

# Verify injected faults remain applied
# - Fault modes on app Pods are unchanged
# - When control plane restarts, it reconciles from ConfigMaps
# - Dashboard shows current state correctly
```

### 9. Verify App-side Informer

```bash
# Patch a Pod's ConfigMap directly
kubectl patch configmap fault-state-<pod-name> -p '{"data":{"mode":"http_503"}}'

# Wait 2 seconds
# Verify:
# - Pod's /api/fault returns mode: "http_503"
# - Pod's updatedBy is "control-plane" (set by informer)
# - Control plane dashboard shows the updated mode
```

### 10. Audit Log Verification

```bash
# Via dashboard or API:
curl -u admin:<password> https://fault-control.lb-test.local/api/audit?limit=10

# Verify:
# - Each apply action is recorded with timestamp, actor, target, mode, result
# - Entries are in reverse chronological order (newest first)
# - Ring buffer caps at 200 entries (AUDIT_BUFFER_SIZE)
```

## Expected Results

| Step | Expected | Actual |
|------|----------|--------|
| 1 | Images built and pushed | |
| 2 | Control plane pod Running (1/1) | |
| 3 | App pods Running (2/2) with new SA | |
| 4 | Dashboard accessible, pods shown as `none` | |
| 5 | Targeted Pod shows `reset`, F5 marks DOWN | |
| 6 | All Pods return to `none`, F5 marks UP | |
| 7 | Drift detected and reconciled within 5s | |
| 8 | ConfigMap survives Pod restart | |
| 9 | Informer updates Pod within 2s | |
| 10 | Audit log shows all operations | |

## Notes

- The 3s polling window for drift detection is intentional — external injections via NodePort are detected and reconciled automatically.
- The `reconciled:` prefix on `updatedBy` suppresses oscillation in drift detection.
- Basic Auth credentials are in the `lb-control-plane-auth` Secret (htpasswd format).
