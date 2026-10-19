# Kubernetes (local, kind)

Hosted Kubernetes costs money, so DataCollab's cluster setup targets
[kind](https://kind.sigs.k8s.io/) on a laptop. The manifests are plain YAML combined with
Kustomize (`kubectl apply -k k8s`).

| File | What it creates |
|---|---|
| `namespace.yaml` | `datacollab` namespace |
| `configmap.yaml` | Non-secret settings (Redis URL, timeouts, cache TTL) |
| `secret.example.yaml` | Shape of the secret; `make k8s-up` creates the real one with random passwords |
| `postgres.yaml` | PostgreSQL 16 + pgvector StatefulSet with a 2 Gi volume (local only; production uses Neon) |
| `redis.yaml` | Redis Deployment (local only; production uses Upstash) |
| `uploads-pvc.yaml` | Volume shared by the API and the worker for uploaded files |
| `api.yaml` | API Deployment (2 replicas), readiness and liveness probes on `/health`, CPU/memory requests and limits, non-root |
| `worker.yaml` | BullMQ ingestion worker Deployment (same image, `node dist/worker.js`) |
| `frontend.yaml` | nginx-unprivileged serving the SPA |
| `ingress.yaml` | ingress-nginx: `/api`, `/socket.io`, `/mcp`, `/health` to the API, everything else to the SPA |
| `hpa.yaml` | HorizontalPodAutoscaler for the API: 2–6 replicas at 60% average CPU |

Several API replicas can run at once because Socket.io events go through the Redis adapter, the
query cache and rate limits live in Redis, and MCP uses stateless HTTP.

## Run it

Requirements: Docker, [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation), kubectl, Node 22, openssl.

```bash
make k8s-up          # cluster + ingress-nginx + metrics-server + images + deploy
make k8s-status      # pods, services, ingress, HPA
open http://datacollab.localhost:8080
kubectl -n datacollab exec deploy/api -- node dist/scripts/seed_demo.js   # demo data
make k8s-down
```

## Watch the autoscaler

```bash
make k8s-load LOAD_SECONDS=180
```

This runs `scripts/k8s_load.js` (40 concurrent cache-busting aggregate queries) and prints the
HPA every 15 seconds. Expect `TARGETS` to climb above 60%, `REPLICAS` to grow from 2 towards 6
within a minute or two, and to shrink back after the load stops (the scale-down stabilization
window is 120 s). In another terminal, `kubectl -n datacollab get pods -w` shows new API pods
becoming ready.

## Validation

`make k8s-validate` renders the manifests with Kustomize and checks them against the Kubernetes
1.32 schemas with [kubeconform](https://github.com/yannh/kubeconform). CI runs the same check.

## Status

The manifests pass `kubeconform -strict` (14 resources, 0 invalid). Creating the kind cluster was
attempted in the cloud development container used to build this project, but nested containers
are not supported there (`runc create failed`), so `make k8s-up` and the autoscaling walkthrough
have not been run end to end yet. They should be run on a laptop before this is described as tested.
