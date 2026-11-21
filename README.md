# Strata --- Self-Service Kubernetes Platform

A production-oriented Kubernetes platform lab demonstrating Kubernetes
workloads, GitOps delivery, DevSecOps automation, network controls,
ingress/TLS, autoscaling, and observability.

> **Accuracy note:** This is a portfolio/lab implementation, not a
> production-ready HA platform. The recorded Kind topology has one
> control plane and two workers. Argo CD Self-Heal is configured but its
> drift test was not proven; deploy-time Cosign enforcement is not
> implemented.

## Architecture

``` mermaid
flowchart TB
  Dev[Developer] --> GH[GitHub repository]
  GH --> CI[GitHub Actions]
  CI --> Tests[Tests and security scans]
  Tests --> Build[Build images]
  Build --> DH[Docker Hub]
  Build --> Sign[Cosign keyless signing]
  CI -->|Commit SHA image tags| GH
  GH --> Argo[Argo CD]
  Argo --> K8s[Kind Kubernetes cluster]
  User[Browser] --> Traefik[Traefik Ingress]
  Traefik --> FE[Frontend Service]
  Traefik --> API[Backend API Service]
  K8s --> HPA[HPA: demo 2–6 replicas]
  K8s --> Prom[Prometheus]
  Prom --> Graf[Grafana / Alerts]
```

## Key capabilities

-   Kind cluster `production-platform`, Kubernetes v1.37.0, three nodes.
-   Three workloads: `platform-frontend`, `platform-demo`,
    `platform-api`.
-   Argo CD v3.6.1, Kustomize root path, GitOps image tag updates.
-   GitHub Actions: Gitleaks, pytest, Bandit, pip-audit, npm audit,
    Trivy, CycloneDX SBOM, Cosign signing, Docker Hub publishing.
-   RBAC, default-deny and allowlist NetworkPolicies.
-   Traefik Ingress for `platform.local`, TLS Secret
    `platform-demo-tls`.
-   HPA for `platform-demo`: CPU target 50%, min 2, max 6.
-   Prometheus, Grafana, kube-state-metrics, Node Exporter, Metrics
    Server.
-   Grafana SMTP test email successfully sent in the recorded work.

## Repository documentation

-   [Architecture](docs/ARCHITECTURE.md)
-   [Kubernetes implementation](docs/KUBERNETES-IMPLEMENTATION.md)
-   [GitOps and CI/CD](docs/GITOPS-AND-CICD.md)
-   [Security](docs/SECURITY.md)
-   [Observability](docs/OBSERVABILITY.md)
-   [Operations runbook](docs/OPERATIONS-RUNBOOK.md)
-   [Validation record](docs/VALIDATION-AND-TESTING.md)
-   [Troubleshooting](docs/TROUBLESHOOTING.md)
-   [Status and roadmap](docs/PROJECT-STATUS.md)

## Quick commands

``` bash
kubectl get nodes -o wide
kubectl get deployments,pods,services -n platform-demo
kubectl get hpa -n platform-demo
kubectl get application strata-platform -n argocd
argocd app get strata-platform
kubectl kustomize .
kubectl apply --dry-run=server -k .
```

## Recorded image tag

`1370f052bfd936fafe3822d55148fc89bcf94ba7`

Images: - `docker.io/ybhavithr/strata-backend` -
`docker.io/ybhavithr/strata-demo` -
`docker.io/ybhavithr/strata-frontend`

## Important limitations

-   One Kind control plane means no control-plane HA or redundant API
    endpoint.
-   Self-Heal is enabled in the Application, but a manually added
    NetworkPolicy annotation remained while Argo CD reported Synced.
    Cause unresolved.
-   Auto-Prune intentionally disabled.
-   CI keyless image signing and signature verification were performed;
    cluster-side deploy-time signature enforcement was not.
-   Argo CD logs showed stale `metrics.k8s.io/v1beta1` discovery after
    cluster recovery.
-   Traefik LoadBalancer IP was `<pending>` in Kind; direct worker
    Docker-network NodePort access was tested instead.

Project state in these documents is historical, based on work recorded
through 11 November 2026. Recheck live resources before describing the
current runtime state.
