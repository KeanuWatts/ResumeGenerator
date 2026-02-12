# Kubernetes deployment

The cluster is expected to **already run Reactive Resume**. Point the API at your existing RR instance via `RXRESUME_BASE_URL` in the ConfigMap.

## Steps

1. Create namespace and config: `kubectl apply -f namespace.yaml -f configmap.yaml`
2. Copy `secret.yaml.example` to `secret.yaml`, fill in values, then `kubectl apply -f secret.yaml`
3. Set `RXRESUME_BASE_URL` in configmap.yaml to your RR service URL
4. Build and push images for api and web, then `kubectl apply -f api-deployment.yaml -f web-deployment.yaml` (and optionally worker-deployment.yaml)
5. Expose via Ingress or LoadBalancer as needed
