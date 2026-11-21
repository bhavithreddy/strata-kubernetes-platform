# Observability

## Components recorded in `monitoring`

  Component            Recorded state   Purpose
  -------------------- ---------------- ---------------------------
  Prometheus           2/2 Pods         Metrics collection/query
  Grafana              1/1 Pod          Dashboards and alerting
  kube-state-metrics   1/1 Pod          Kubernetes object metrics
  Node Exporter        DaemonSet 3/3    Node metrics
  Metrics Server       Running          Resource metrics for HPA

Prometheus and Grafana each had a 2 GiB Bound PVC. Preserve these
volumes during troubleshooting.

## Metrics flow

``` mermaid
flowchart LR
 Nodes[Kind nodes] --> NE[Node Exporter]
 API[Kubernetes API] --> KSM[kube-state-metrics]
 App[Application Pods] --> Prom[Prometheus]
 NE --> Prom
 KSM --> Prom
 Prom --> Graf[Grafana]
 Prom --> Rules[Alert rules]
 Rules --> Email[SMTP contact point]
```

## Recorded alerts and notification

Alert rules included: - Node NotReady - Deployment Availability Low -
Pod Repeated Restarts

Grafana Gmail SMTP contact point was configured and a test email was
reported successful. For production, use managed SMTP credentials or an
external secret manager; do not commit credentials.

## HPA metrics

The demo HPA target was 50% CPU, min 2, max 6. A recorded sample showed
2% / 50%, replicas 2.

``` bash
kubectl get hpa -n platform-demo
kubectl describe hpa platform-demo -n platform-demo
kubectl top nodes
kubectl top pods -n platform-demo
kubectl get apiservice v1beta1.metrics.k8s.io
```

Argo CD logs after cluster recovery included
`metrics.k8s.io/v1beta1: stale GroupVersion discovery`. The cause was
not established. Check Metrics Server and APIService health if
`kubectl top` or HPA metrics fail.

## Dashboard recommendations

Include node CPU/memory/filesystem, Pod CPU/memory, Deployment
desired/available replicas, restart rate, HPA current/desired replicas,
pending/failed Pods, request rate/latency/error rate (if app metrics
exist), and Prometheus target health.

## Preserve data

Before maintenance, inspect PVC/PV state and back up Prometheus/Grafana
configuration and data. Never delete monitoring PVCs as a
troubleshooting shortcut.
