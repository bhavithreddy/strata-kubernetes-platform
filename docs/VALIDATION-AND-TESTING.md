# Validation and Testing Record

Historical record based on work captured through 11 November 2026.
Re-run checks before asserting current state.

## Recorded successful checks

  -----------------------------------------------------------------------------------------------------------------------
  Area                    Test                                    Recorded outcome
  ----------------------- --------------------------------------- -------------------------------------------------------
  Kind                    `kubectl get nodes -o wide`             Three nodes Ready after recovery

  Kustomize               `kubectl kustomize .`                   Rendered; demo Deployment had no `spec.replicas`

  API validation          `kubectl apply --dry-run=server -k .`   Succeeded

  Backend                 pytest                                  12 tests reported passing

  GitHub Actions          Run #11                                 All visible jobs succeeded

  Registry                `docker manifest inspect`               All three images available

  Cosign                  Verify signatures                       Three images verified against GitHub Actions identity

  Argo CD                 First manual sync                       Completed in about 18 seconds

  Argo CD status          `argocd app get`                        Synced / Healthy at recorded check

  HPA                     `kubectl get hpa`                       2% / 50%, min 2, max 6, replicas 2

  Ingress                 curl via worker Docker IP / NodePort    HTTP/2 200

  Backend health          `/api/health`                           `{"status":"ok","service":"kubernetes-platform-api"}`

  Grafana SMTP            Test email                              Successful
  -----------------------------------------------------------------------------------------------------------------------

## CI run

Run #11 completed in approximately 2m19s. Jobs shown: - Secret
Scanning - Backend Security & Tests - Frontend Security & Build -
Container Build, Scan & Publish (3 images) - Update GitOps Image Tags

Source commit `1370f05...`; GitOps bot commit `da4ae69...`; image tag
`1370f052bfd936fafe3822d55148fc89bcf94ba7`.

## Self-Heal: not verified

Live Application YAML had `automated.selfHeal: true`. A manual
annotation was added to `platform-demo-default-deny-ingress`, but
remained after refresh. Argo CD still reported Synced and logs showed
`Skipping auto-sync: application status is Synced`.

The live object had the expected tracking ID. The Application ignore
rule only covered `/spec/replicas` on Deployment `platform-demo`; it did
not ignore NetworkPolicy annotations. Root cause was not determined.
Therefore Self-Heal is configured but not proven operational.

## Other unresolved issue

Controller logs reported stale `metrics.k8s.io/v1beta1` discovery after
cluster recovery. The app controller continued reconciling, but Metrics
Server/APIService health should be checked.

## Remaining validation checklist

-   [ ] Prove Argo CD Self-Heal with a controlled drift test.
-   [ ] Investigate stale Metrics API discovery.
-   [ ] Test RBAC allowed and denied actions with `kubectl auth can-i`.
-   [ ] Test NetworkPolicy permitted and blocked traffic.
-   [ ] Load-test HPA scale-up from 2 and scale-down after load.
-   [ ] Verify Prometheus targets, Grafana dashboards and alert
    delivery.
-   [ ] Test application rollback.
-   [ ] Test worker interruption and workload rescheduling.
-   [ ] Implement and test deploy-time Cosign verification.
-   [ ] Test backup and restore of persistent monitoring data.
-   [ ] Add post-deployment smoke tests.
