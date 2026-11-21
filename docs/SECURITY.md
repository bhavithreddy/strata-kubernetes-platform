# Security

## Layers implemented

  -----------------------------------------------------------------------
  Layer                   Tool / control          Recorded use
  ----------------------- ----------------------- -----------------------
  Secret scanning         Gitleaks                CI job

  Python code analysis    Bandit                  Backend checks

  Python dependency audit pip-audit               Backend checks

  JS dependency audit     npm audit               Frontend checks; some
                                                  findings tolerated

  Filesystem / IaC /      Trivy                   CI checks
  image scan                                      

  SBOM                    CycloneDX               Generated in pipeline

  Image signing           Cosign keyless          GitHub OIDC identity

  Runtime access          Kubernetes RBAC         ServiceAccounts, Roles,
                                                  RoleBindings

  Network segmentation    NetworkPolicies         Default deny plus allow
                                                  rules

  Ingress encryption      TLS Secret              Traefik Ingress
                                                  references
                                                  `platform-demo-tls`
  -----------------------------------------------------------------------

## Cosign

Cosign v2.5.3 was used. Signatures for all three published images were
verified against the GitHub Actions identity and OIDC issuer
`https://token.actions.githubusercontent.com`.

This verifies CI signing provenance. It does not mean Kubernetes rejects
unsigned images. **Deploy-time signature verification/admission
enforcement is not implemented** in the recorded project.

Next step: deploy an admission policy that verifies approved registry,
issuer, and workflow identity; test valid signed and unsigned images;
fail closed.

## RBAC

The developer identity is intended to be read-only. The API controller
identity has a separate Role. Validate actual verbs/resources from
manifests and test both allowed and denied requests with
`kubectl auth can-i`. Avoid cluster-admin grants for application
identities.

## NetworkPolicy

Default-deny ingress plus explicit allow policies are present. Verify
the CNI enforces NetworkPolicy and run connectivity tests for allowed
and blocked flows. YAML presence alone is not proof of enforcement.

## Secrets and TLS

`platform-demo-tls` is a TLS Secret kept outside root GitOps manifests.
Never commit its private key. The recorded `curl -k` test skipped
certificate validation; production clients should validate a trusted
certificate chain. SMTP credentials should be stored in a
Secret/external secret manager and rotated.

## Remaining security gaps

-   Deploy-time Cosign enforcement.
-   Secret manager integration not evidenced in the recorded state.
-   Pod Security Admission policy not evidenced.
-   Runtime threat detection and centralized audit retention not
    evidenced.
-   Some npm audit issues were tolerated and need review.
