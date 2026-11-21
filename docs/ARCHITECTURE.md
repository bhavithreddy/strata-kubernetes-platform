# Architecture

## Overview

Strata separates source validation and image production (CI) from
cluster deployment (GitOps). GitHub Actions builds and signs images,
updates Kustomize image tags in Git, and Argo CD reconciles the
repository's desired state into the `platform-demo` namespace.

``` mermaid
flowchart TB
 subgraph Delivery["Source and CI"]
  Dev[Developer] --> Git[GitHub]
  Git --> Actions[GitHub Actions]
  Actions --> Scan[Tests / security scans]
  Scan --> Images[Build and publish]
  Images --> Registry[Docker Hub]
  Images --> Cosign[Cosign signing]
  Actions --> Commit[Commit updated Kustomize tags]
  Commit --> Git
 end
 subgraph Cluster["Kind: production-platform"]
  CP[Control plane]
  W1[Worker]
  W2[Worker 2]
  Argo[Argo CD]
  T[Traefik]
  subgraph App["platform-demo namespace"]
   FE[platform-frontend]
   Demo[platform-demo]
   API[platform-api]
   SVC[Services]
   HPA[HPA]
   NP[NetworkPolicies]
   RBAC[ServiceAccounts / Roles]
   Ing[Ingress]
  end
  subgraph Monitoring["monitoring namespace"]
   Prom[Prometheus]
   Graf[Grafana]
   KSM[kube-state-metrics]
   NE[Node Exporter]
   MS[Metrics Server]
  end
  CP --- W1
  CP --- W2
  Argo --> App
  T --> Ing
  Ing --> SVC
  HPA --> Demo
  Prom --> KSM
  Prom --> NE
  Graf --> Prom
  MS --> HPA
 end
 Registry --> Cluster
 Git --> Argo
 Client[Client] --> T
```

## Cluster topology

Recorded cluster: `production-platform`, Kubernetes `v1.37.0`.

  Node                                Role            Recorded IP
  ----------------------------------- --------------- -------------
  production-platform-control-plane   control-plane   172.18.0.2
  production-platform-worker          worker          172.18.0.3
  production-platform-worker2         worker          172.18.0.4

This is one control plane plus two workers. It is a multi-node local
lab, not HA. The Kubernetes API was exposed to the WSL host on loopback
port `43369` in the recorded environment; do not assume that port on
another machine.

## Application and traffic

The `platform-demo` namespace contains: - `platform-frontend` Deployment
/ Service - `platform-demo` Deployment / Service - `platform-api`
Deployment / Service

Ingress host: `platform.local`; class: `traefik`; TLS Secret:
`platform-demo-tls`.

Recorded paths: \| Path \| Destination \| \|---\|---\| \| `/` \|
Frontend \| \| `/api` \| Backend API \| \| `/openapi.json` \| Backend
API \| \| `/docs` \| Backend API docs \| \| `/redoc` \| Backend API docs
\|

A backend health check returned
`{"status":"ok","service":"kubernetes-platform-api"}`.

## GitOps

Argo CD Application `strata-platform`: - Repo:
`https://github.com/bhavithreddy/strata-kubernetes-platform.git` -
Revision: `master` - Path: `.` - Destination namespace:
`platform-demo` - Destination API: `https://kubernetes.default.svc`

Root Kustomize references application Deployments, Services, Ingress,
HPA, NetworkPolicies, and RBAC. Traefik and monitoring are outside this
Application's managed path.

## Observability

Recorded monitoring components: - Prometheus (2/2) - Grafana (1/1) -
kube-state-metrics (1/1) - Node Exporter DaemonSet (3/3) - Metrics
Server

Prometheus and Grafana each had a 2 GiB Bound PVC. Preserve these
volumes. Alert rules included Node NotReady, Deployment Availability
Low, and Pod Repeated Restarts. Grafana Gmail SMTP test email succeeded.

## Availability boundaries

The lab demonstrates workload replicas, worker scheduling, autoscaling,
and monitoring. It does not demonstrate redundant control planes, API
load balancing, etcd quorum/backup, multi-zone failure isolation,
production storage resilience, or tested HA recovery objectives.
