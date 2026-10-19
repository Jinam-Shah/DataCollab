# Local Kubernetes on kind. Needs docker, kind and kubectl on PATH.
#   make k8s-up       create the cluster, build and load images, deploy everything
#   make k8s-load     load-test the API to watch the HorizontalPodAutoscaler react
#   make k8s-down     delete the cluster
#   make k8s-validate render the manifests and check them with kubeconform

CLUSTER ?= datacollab
NAMESPACE ?= datacollab
INGRESS_NGINX_VERSION ?= controller-v1.12.1
METRICS_SERVER_VERSION ?= v0.7.2
# Optional: CA bundle for building behind a TLS-intercepting proxy (see the Dockerfiles).
NPM_CA ?=
BUILD_SECRET = $(if $(NPM_CA),--secret id=npm_ca,src=$(NPM_CA),)

.PHONY: k8s-up k8s-down k8s-images k8s-secrets k8s-deploy k8s-load k8s-validate k8s-status

k8s-up:
	kind get clusters | grep -qx $(CLUSTER) || kind create cluster --config k8s/kind-config.yaml
	kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/$(INGRESS_NGINX_VERSION)/deploy/static/provider/kind/deploy.yaml
	kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/$(METRICS_SERVER_VERSION)/components.yaml
	# kind's kubelets use self-signed certificates.
	kubectl -n kube-system patch deployment metrics-server --type=json \
	  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
	$(MAKE) k8s-images k8s-secrets k8s-deploy

k8s-images:
	docker build $(BUILD_SECRET) -t datacollab-api:local backend
	docker build $(BUILD_SECRET) --build-arg VITE_API_URL= --build-arg VITE_SOCKET_URL= -t datacollab-web:local frontend
	kind load docker-image --name $(CLUSTER) datacollab-api:local datacollab-web:local

k8s-secrets:
	kubectl apply -f k8s/namespace.yaml
	@kubectl -n $(NAMESPACE) get secret datacollab-secrets >/dev/null 2>&1 || { \
	  PG=$$(openssl rand -hex 16); RD=$$(openssl rand -hex 16); \
	  kubectl -n $(NAMESPACE) create secret generic datacollab-secrets \
	    --from-literal=POSTGRES_PASSWORD=$$PG \
	    --from-literal=DATABASE_URL=postgresql://datacollab:$$PG@postgres:5432/datacollab \
	    --from-literal=DATABASE_READER_URL=postgresql://datacollab_reader:$$RD@postgres:5432/datacollab \
	    --from-literal=JWT_SECRET=$$(openssl rand -hex 32) \
	    --from-literal=GEMINI_API_KEY=$${GEMINI_API_KEY:-}; }

k8s-deploy:
	kubectl -n ingress-nginx wait --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=180s
	kubectl apply -k k8s
	kubectl -n $(NAMESPACE) rollout status statefulset/postgres --timeout=180s
	kubectl -n $(NAMESPACE) rollout status deployment/api --timeout=240s
	kubectl -n $(NAMESPACE) rollout status deployment/worker --timeout=120s
	kubectl -n $(NAMESPACE) rollout status deployment/frontend --timeout=120s
	@echo "Open http://datacollab.localhost:8080"

k8s-status:
	kubectl -n $(NAMESPACE) get pods,svc,ingress,hpa

# Sends CPU-heavy queries for LOAD_SECONDS while printing the HPA every 15 s.
LOAD_SECONDS ?= 180
k8s-load:
	node scripts/k8s_load.js http://datacollab.localhost:8080 $(LOAD_SECONDS) & \
	for i in $$(seq 1 $$(( $(LOAD_SECONDS) / 15 + 8 ))); do kubectl -n $(NAMESPACE) get hpa api --no-headers; sleep 15; done; wait

k8s-validate:
	kubectl kustomize k8s | kubeconform -strict -summary -kubernetes-version 1.32.0 -

k8s-down:
	kind delete cluster --name $(CLUSTER)
