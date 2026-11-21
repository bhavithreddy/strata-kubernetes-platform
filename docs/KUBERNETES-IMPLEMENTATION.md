# Kubernetes Implementation

## Kustomize root

The recorded root `kustomization.yaml` referenced:

``` yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - kubernetes/backend-deployment.yaml
  - kubernetes/deployment.yaml
  - kubernetes/frontend-deployment.yaml
  - kubernetes/service.yaml
  - kubernetes/ingress.yaml
  - kubernetes/hpa.yaml
  - kubernetes/network-policies.yaml
  - kubernetes/backend-network-policy.yaml
  - kubernetes/backend-rbac.yaml
  - kubernetes/rbac.yaml
images:
  - name: platform-api
    newName: docker.io/ybhavithr/strata-backend
    newTag: 1370f052bfd936fafe3822d55148fc89bcf94ba7
  - name: platform-demo
    newName: docker.io/ybhavithr/strata-demo
    newTag: 1370f052bfd936fafe3822d55148fc89bcf94ba7
  - name: platform-frontend
    newName: docker.io/ybhavithr/strata-frontend
    newTag: 1370f052bfd936fafe3822d55148fc89bcf94ba7
patches:
  - path: gitops/patches/remove-hpa-managed-replicas.yaml
    target:
      group: apps
      version: v1
      kind: Deployment
      name: platform-demo
```

The patch `gitops/patches/remove-hpa-managed-replicas.yaml` removes
`/spec/replicas` from the demo Deployment. HPA owns this value, so
GitOps should not continuously force a fixed replica count.

The Application also ignores `/spec/replicas` for Deployment
`platform-demo` and uses `RespectIgnoreDifferences=true`.

Recorded validations:

``` bash
kubectl kustomize .
kubectl apply --dry-run=server -k .
kubectl diff -k .
```

Kustomize output omitted demo `spec.replicas`; server-side dry-run
succeeded.

## Workloads and images

  Deployment          Image repository              Recorded replicas
  ------------------- ----------------------------- -------------------
  platform-api        `ybhavithr/strata-backend`    1
  platform-demo       `ybhavithr/strata-demo`       2
  platform-frontend   `ybhavithr/strata-frontend`   2

Recorded SHA tag: `1370f052bfd936fafe3822d55148fc89bcf94ba7`. These
counts describe a prior healthy observation, not current state.

The backend API was recorded as validating image names, rejecting
`latest`, restricting changes to `platform-demo`, and detecting rollout
status/failure. The backend test suite had 12 passing tests.

## Services, Ingress, TLS

Three Services provide stable in-cluster endpoints. Inspect current
`kubernetes/service.yaml` for exact selectors and ports.

Ingress `platform-demo` uses Traefik and host `platform.local`, routing
`/`, `/api`, `/openapi.json`, `/docs`, and `/redoc`. It references
Secret `platform-demo-tls` (type `kubernetes.io/tls`, two data entries).
Keep private key material out of Git. The Secret was outside the root
GitOps manifest set.

Traefik LoadBalancer external IP remained `<pending>` in Kind. Direct
test through worker IP `172.18.0.3`, NodePort `31443`, succeeded:

``` bash
curl -k -I --resolve platform.local:31443:172.18.0.3 https://platform.local:31443/
curl -k -sS --resolve platform.local:31443:172.18.0.3 https://platform.local:31443/api/health
```

`-k` skips certificate validation and was only a lab test shortcut.

## NetworkPolicies

Recorded policies: - `platform-demo-default-deny-ingress` -
`allow-frontend-to-platform-demo` - `allow-traefik-to-platform-demo` -
`allow-traefik-to-platform-api` - backend policy in
`kubernetes/backend-network-policy.yaml`

The default-deny policy selects `app: platform-demo` and has
`policyTypes: [Ingress]`. Separate policies allow required traffic.
Actual enforcement depends on the CNI; test both allowed and denied
connections rather than relying on manifest presence.

## RBAC

Recorded identities: - ServiceAccount `platform-developer` - Role
`platform-developer-viewer` and binding - ServiceAccount
`platform-api` - Role `platform-api-controller` and binding

The developer role was intended to be read-only. Confirm exact
permissions in live manifests and test:

``` bash
kubectl auth can-i get pods --as=system:serviceaccount:platform-demo:platform-developer -n platform-demo
kubectl auth can-i create deployments --as=system:serviceaccount:platform-demo:platform-developer -n platform-demo
```

## HPA

`platform-demo` HPA: CPU target 50%, min 2, max 6. Recorded current CPU
was 2% / 50%, replicas 2.

``` bash
kubectl get hpa -n platform-demo
kubectl describe hpa platform-demo -n platform-demo
kubectl top pods -n platform-demo
kubectl get apiservice v1beta1.metrics.k8s.io
```

Argo CD later logged stale discovery for `metrics.k8s.io/v1beta1`;
investigate if resource metrics or HPA become unreliable.
