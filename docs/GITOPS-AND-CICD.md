# GitOps and CI/CD

## Pipeline flow

1.  Developer pushes or opens a pull request targeting `master` /
    `Testing`.
2.  GitHub Actions runs secret scanning, backend checks, frontend
    checks, and container security jobs.
3.  Container images are built and scanned.
4.  CycloneDX SBOM is generated.
5.  Cosign keyless signing is performed using GitHub OIDC.
6.  On a successful push to `master`, `update-gitops` changes image tags
    in `kustomization.yaml` to `GITHUB_SHA`, commits, and pushes.
7.  Argo CD observes Git and reconciles the `platform-demo` namespace.

``` mermaid
sequenceDiagram
 participant Dev as Developer
 participant GH as GitHub
 participant CI as GitHub Actions
 participant DH as Docker Hub
 participant Argo as Argo CD
 participant K as Kubernetes
 Dev->>GH: Push code
 GH->>CI: Start workflow
 CI->>CI: Test / scan
 CI->>DH: Publish SHA-tagged images
 CI->>CI: SBOM and Cosign signing
 CI->>GH: Commit Kustomize image tags
 Argo->>GH: Read desired state
 Argo->>K: Reconcile resources
```

## Recorded workflow jobs

Workflow: `.github/workflows/ci.yaml`. - `secret-scan` --- Gitleaks. -
`backend-checks` --- pytest, Bandit, pip-audit. - `frontend-checks` ---
npm audit and frontend build/checks. - `container-security` --- matrix
for backend, frontend, demo; Trivy scanning and publishing. -
`update-gitops` --- only on push to `master`, depends on container
security, grants `contents: write`.

Some npm audit findings were allowed to continue after review; do not
call the audit zero-vulnerability.

## Image update

Recorded update command:

``` bash
kustomize edit set image \
  platform-api=docker.io/${DOCKERHUB_USERNAME}/strata-backend:${GITHUB_SHA} \
  platform-demo=docker.io/${DOCKERHUB_USERNAME}/strata-demo:${GITHUB_SHA} \
  platform-frontend=docker.io/${DOCKERHUB_USERNAME}/strata-frontend:${GITHUB_SHA}
```

The bot used:

``` text
github-actions[bot]
41898282+github-actions[bot]@users.noreply.github.com
```

It staged `kustomization.yaml`, skipped if there was no staged diff,
then pushed `HEAD:master`.

## Recorded successful run

Run #11 succeeded in approximately 2m19s. Visible jobs: Secret Scanning;
Backend Security & Tests; Frontend Security & Build; Container Build,
Scan & Publish; Update GitOps Image Tags. The source commit was
`1370f05...`; GitOps commit `da4ae69...`; tag
`1370f052bfd936fafe3822d55148fc89bcf94ba7`. All three Docker Hub
manifests were checked and available.

## Argo CD Application

`strata-platform`: - namespace `argocd` - repository
`https://github.com/bhavithreddy/strata-kubernetes-platform.git` -
branch `master`, path `.` - destination namespace `platform-demo` -
destination `https://kubernetes.default.svc`

Recorded live spec:

``` yaml
ignoreDifferences:
  - group: apps
    kind: Deployment
    name: platform-demo
    jsonPointers:
      - /spec/replicas
syncPolicy:
  automated:
    selfHeal: true
  syncOptions:
    - RespectIgnoreDifferences=true
```

`prune` was absent, so Auto-Prune remained disabled. Auto-Sync and
`selfHeal: true` were configured.

## Auto-Sync, Self-Heal, Auto-Prune

-   Auto-Sync applies Git changes when the app is OutOfSync.
-   Self-Heal should revert manual changes to managed live resources.
-   Auto-Prune deletes resources removed from Git; intentionally
    disabled.

### Self-Heal remains unverified

A manual annotation was added:

``` bash
kubectl annotate networkpolicy platform-demo-default-deny-ingress \
  -n platform-demo self-heal-test=manual-drift
```

The annotation remained after refresh. The Application still reported
Synced and controller logs said
`Skipping auto-sync: application status is Synced`. The live
NetworkPolicy had the expected Argo CD tracking ID. The Application
ignore rule applied only to demo Deployment replicas, not NetworkPolicy
annotations. Root cause was not established.

Do not claim Self-Heal passed. Resume investigation with
`argocd app diff`, hard refresh, live/desired manifests, `argocd-cm`
resource customizations and controller logs. Remove the test annotation
only after evidence is collected:

``` bash
kubectl annotate networkpolicy platform-demo-default-deny-ingress -n platform-demo self-heal-test-
```

## CLI connection

Argo CD CLI used localhost:8080. Port-forward:

``` bash
kubectl port-forward -n argocd svc/argocd-server 8080:443
```

Keep it running in a separate terminal. If `argocd app diff` says
connection refused, the forward is not active.

## Git race condition

A bot commit once advanced remote `master`, causing a developer push
rejection. The developer fetched and rebased, then pushed normally.
Avoid force-push:

``` bash
git fetch origin
git pull --rebase origin master
git push origin master
```

## Recommended hardening

Pin Actions to full commit SHAs; review concurrency cancellation;
protect `master`; consider PR-based GitOps promotion; prevent CI loops;
deploy by digest; implement admission-time Cosign verification.
