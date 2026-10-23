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

## Windows (PowerShell, no `make`)

`make` and `openssl` are not on Windows by default. These are the commands that were run on
Windows with Docker Desktop, kind v0.33.0 and kubectl v1.36.1, from the repository root:

```powershell
kind create cluster --config k8s/kind-config.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml
'[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' | Set-Content -Encoding ascii metrics-patch.json
kubectl -n kube-system patch deployment metrics-server --type=json --patch-file metrics-patch.json; Remove-Item metrics-patch.json

docker build -t datacollab-api:local backend
docker build --build-arg VITE_API_URL= --build-arg VITE_SOCKET_URL= -t datacollab-web:local frontend
kind load docker-image --name datacollab datacollab-api:local datacollab-web:local

# Secrets: random passwords, and the Gemini key read without echoing it.
function New-Hex($n) { $b = New-Object byte[] $n; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | % { $_.ToString('x2') }) -join '' }
$PG = New-Hex 16; $RD = New-Hex 16; $JWT = New-Hex 32
$GEMINI = [System.Net.NetworkCredential]::new('', (Read-Host "Gemini key" -AsSecureString)).Password
kubectl apply -f k8s/namespace.yaml
kubectl -n datacollab create secret generic datacollab-secrets `
  --from-literal=POSTGRES_PASSWORD=$PG `
  --from-literal=DATABASE_URL="postgresql://datacollab:$PG@postgres:5432/datacollab" `
  --from-literal=DATABASE_READER_URL="postgresql://datacollab_reader:$RD@postgres:5432/datacollab" `
  --from-literal=JWT_SECRET=$JWT --from-literal=GEMINI_API_KEY=$GEMINI
Remove-Variable GEMINI

kubectl -n ingress-nginx wait --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=180s
kubectl apply -k k8s
kubectl -n datacollab rollout status deployment/api --timeout=240s
kubectl -n datacollab exec deploy/api -- node dist/scripts/seed_demo.js
```

Chrome and Edge resolve `datacollab.localhost` by themselves; Node.js (the load script) needs a
hosts entry, added once from an administrator PowerShell:
`Add-Content "$env:windir\System32\drivers\etc\hosts" "`r`n127.0.0.1 datacollab.localhost"`.
Then run the load and the watcher in two windows:
`node scripts/k8s_load.js http://datacollab.localhost:8080 180` and
`kubectl -n datacollab get hpa api -w`.

## Status

**Run end to end on 2026-10-23** on a Windows laptop: Docker Desktop, kind v0.33.0 (node image
Kubernetes v1.37.0), ingress-nginx controller-v1.12.1, metrics-server v0.7.2. All pods (2 API,
worker, frontend, PostgreSQL, Redis) became ready, the app worked at
`http://datacollab.localhost:8080`, and the demo seed loaded 6,397 + 10,868 + 51 rows.

Autoscaler, measured with `scripts/k8s_load.js` (40 concurrent workers, 180 s):

| Time after start | HPA `TARGETS` (average CPU vs. request) | Replicas |
|---|---|---|
| before load | 1% / 60% | 2 |
| first reading | 218% / 60% | 2 |
| next reading (same minute) | 230% / 60% | **6** (the maximum) |
| rest of the run | 111–181% / 60% | 6 |

The load script finished 76,006 requests (about 420/s) with 24 failures (0.03%). The scale-down
after the load was not recorded in this run.

Two fixes came out of the first real run:
- ingress-nginx 1.12 rejects `Prefix` paths that contain a dot, so `/socket.io` is now
  `ImplementationSpecific` (`kubectl apply` failed on the Ingress before that).
- `FRONTEND_URL` lists both `http://datacollab.localhost` and `http://datacollab.localhost:8080`.

Creating a kind cluster does not work in the cloud development container used to build the
project (nested containers are not supported there), so this was run on the laptop.
