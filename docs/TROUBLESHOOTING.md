# Troubleshooting

## Kubernetes API refuses connection

Error: `dial tcp 127.0.0.1:43369: connect: connection refused`.

Inspect existing Kind containers:

``` bash
docker ps -a --filter "name=production-platform" \
  --format "table {{.Names}}\t{{.Status}}"
```

If stopped, start the existing containers and verify nodes:

``` bash
docker start production-platform-control-plane production-platform-worker production-platform-worker2
kubectl get nodes -o wide
```

Do not delete/recreate cluster as first response.

## Argo CD CLI localhost:8080 refused

The port-forward process is absent/stopped:

``` bash
kubectl port-forward -n argocd svc/argocd-server 8080:443
```

Keep it running in a separate terminal.

## Argo CD Synced while manual annotation remains

Known recorded symptom: `self-heal-test=manual-drift` remained on a
tracked NetworkPolicy while Application said Synced. Logs said
`Skipping auto-sync: application status is Synced`.

Investigate `argocd app diff`, hard refresh, live/desired YAML,
Application ignore rules, `argocd-cm` customizations/tracking
configuration, and controller logs. The recorded Application only
ignored demo Deployment `/spec/replicas`; it did not ignore
NetworkPolicy annotations. Root cause unresolved.

## Stale metrics API discovery

Log: `metrics.k8s.io/v1beta1: stale GroupVersion discovery`

Inspect:

``` bash
kubectl get pods -A | grep -i metrics
kubectl get apiservice v1beta1.metrics.k8s.io -o yaml
kubectl describe apiservice v1beta1.metrics.k8s.io
kubectl top nodes
kubectl top pods -A
```

Inspect Metrics Server logs/events before restarting it.

## HPA / Degraded health

Inspect:

``` bash
kubectl describe hpa platform-demo -n platform-demo
kubectl get hpa platform-demo -n platform-demo -o yaml
kubectl top pods -n platform-demo
```

A recorded HPA-related Degraded transition returned to Healthy shortly
after. Do not disable HPA before understanding metrics and conditions.

## Traefik LoadBalancer pending

A `<pending>` external IP is expected in a local Kind cluster without a
cloud load-balancer implementation. Inspect Traefik Pods/Service and
Ingress. Direct worker NodePort testing worked in the recorded setup.

## Rollout / readiness failure

Inspect Pod events, current and previous logs, exit codes, probes,
resource limits, node conditions, and namespace events before
restarting:

``` bash
kubectl describe pod <pod> -n platform-demo
kubectl logs <pod> -n platform-demo --all-containers
kubectl logs <pod> -n platform-demo --all-containers --previous
kubectl get events -n platform-demo --sort-by=.lastTimestamp
```

## WSL / Docker resource pressure

Earlier WSL settings were approximately 6 GiB RAM, 4 CPUs, 2 GiB swap,
on an 8 GiB host. Kind nodes previously exited with code 255. Check
Docker Desktop and WSL resource pressure; avoid concurrent heavy
builds/scans/load tests.
