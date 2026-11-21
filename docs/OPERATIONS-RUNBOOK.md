# Operations Runbook

## Safety rules

-   Do not delete/recreate Kind as the first recovery action.
-   Do not delete Prometheus or Grafana PVCs.
-   Do not remove `platform-demo-tls`.
-   Keep Argo CD Auto-Prune disabled unless reviewed deliberately.
-   Do not use broad cleanup commands such as `kubectl delete all`.
-   Inspect events/logs before restarting Deployments.
-   Run port-forward commands in a dedicated terminal and keep it open.

## Cluster inspection and recovery

``` bash
docker ps -a --filter "name=production-platform" \
  --format "table {{.Names}}\t{{.Status}}"
kubectl get nodes -o wide
kubectl get pods -A
```

Recorded incident: all three Kind containers exited with code 255 and
the API at `127.0.0.1:43369` refused connections. The cluster was
recovered by starting the existing containers, not recreating it:

``` bash
docker start production-platform-control-plane \
  production-platform-worker \
  production-platform-worker2
kubectl get nodes -o wide
```

Proceed only when expected nodes are Ready. If not, inspect Docker logs,
Docker Desktop and WSL resource state.

## Application checks

``` bash
kubectl get deployments,pods,services -n platform-demo
kubectl get ingress,networkpolicies,hpa -n platform-demo
kubectl rollout status deployment/platform-api -n platform-demo
kubectl rollout status deployment/platform-demo -n platform-demo
kubectl rollout status deployment/platform-frontend -n platform-demo
```

For a failing Pod:

``` bash
kubectl describe pod <pod-name> -n platform-demo
kubectl logs <pod-name> -n platform-demo --all-containers
kubectl logs <pod-name> -n platform-demo --all-containers --previous
kubectl get events -n platform-demo --sort-by=.lastTimestamp
```

## Argo CD UI and CLI

Start port-forward in a separate terminal:

``` bash
kubectl port-forward -n argocd svc/argocd-server 8080:443
```

Keep it running. Open `https://localhost:8080`; username `admin`.

If the initial admin Secret still exists:

``` bash
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d
echo
```

The Secret may be removed after password rotation.

CLI:

``` bash
ARGOCD_PASSWORD="$(kubectl get secret argocd-initial-admin-secret \
  -n argocd -o jsonpath='{.data.password}' | base64 -d)"
argocd login localhost:8080 --username admin \
  --password "$ARGOCD_PASSWORD" --insecure
unset ARGOCD_PASSWORD
```

If CLI reports connection refused to `localhost:8080`, the port-forward
has stopped or is absent.

## Argo CD application diagnostics

``` bash
kubectl get application strata-platform -n argocd
argocd app get strata-platform
argocd app diff strata-platform
argocd app resources strata-platform
argocd app get strata-platform --hard-refresh
```

Controller logs:

``` bash
kubectl logs -n argocd statefulset/argocd-application-controller \
  --since=15m | grep -Ei 'strata-platform|self.?heal|refresh|drift|error' | tail -60
```

## Self-Heal drift test

The previous test added:

``` bash
kubectl annotate networkpolicy platform-demo-default-deny-ingress \
  -n platform-demo self-heal-test=manual-drift
```

Last recorded inspection showed the annotation still present, even
though Argo CD reported Synced. The cause was unresolved. Collect
`argocd app diff`, hard-refresh status, live and rendered desired YAML,
`argocd-cm` customization/tracking configuration, and controller logs
before changing settings.

After investigation, if annotation remains, remove it:

``` bash
kubectl annotate networkpolicy platform-demo-default-deny-ingress \
  -n platform-demo self-heal-test-
```

Do not claim Self-Heal passed until a controlled test proves it.

## Ingress check

Kind LoadBalancer IP showed `<pending>`. Recorded direct worker test:

``` bash
curl -k -I --resolve platform.local:31443:172.18.0.3 \
  https://platform.local:31443/
curl -k -sS --resolve platform.local:31443:172.18.0.3 \
  https://platform.local:31443/api/health
```

Worker IP and NodePort may differ on another setup. `-k` skips
certificate validation and is not a production client configuration.

## Monitoring checks

``` bash
kubectl get pods -n monitoring
kubectl get pvc -n monitoring
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl top nodes
kubectl top pods -A
```

## Git sync safety

``` bash
git status
git fetch origin
git log --oneline --decorate -8
git pull --rebase origin master
git push origin master
```

A GitOps bot commit once advanced `master` during local work.
Fetch/rebase rather than force-pushing.

## Resource pressure

Earlier WSL configuration allocated about 6 GiB RAM, 4 processors, and 2
GiB swap on a host with about 8 GiB RAM. Avoid simultaneous heavy image
builds, scans, and load tests when resources are constrained.
