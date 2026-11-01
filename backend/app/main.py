import os
import re

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from kubernetes import client, config
from kubernetes.client.exceptions import ApiException
from kubernetes.config.config_exception import ConfigException

NAMESPACE = os.getenv("KUBERNETES_NAMESPACE", "platform-demo")

app = FastAPI(
    title="Kubernetes Platform API",
    description="Read-only API for Kubernetes platform visibility",
    version="0.1.0",
)

# Prefer the ServiceAccount when running inside Kubernetes.
# Fall back to the current kubeconfig for local development.
KUBERNETES_CONFIGURED = False
CONFIG_MODE = "unavailable"

try:
    config.load_incluster_config()
    KUBERNETES_CONFIGURED = True
    CONFIG_MODE = "in-cluster"
except ConfigException:
    try:
        config.load_kube_config()
        KUBERNETES_CONFIGURED = True
        CONFIG_MODE = "kubeconfig"
    except Exception:
        pass

core_api = client.CoreV1Api()
apps_api = client.AppsV1Api()
autoscaling_api = client.AutoscalingV2Api()
custom_api = client.CustomObjectsApi()



class DeployRequest(BaseModel):
    image: str = Field(min_length=1, max_length=128)


def ensure_kubernetes_configured():
    if not KUBERNETES_CONFIGURED:
        raise HTTPException(
            status_code=503,
            detail="Kubernetes configuration is unavailable",
        )


def handle_api_error(exc: ApiException):
    raise HTTPException(
        status_code=503,
        detail=f"Kubernetes API request failed: {exc.reason}",
    ) from exc


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "kubernetes-platform-api",
    }


@app.get("/api/cluster")
def cluster_status():
    ensure_kubernetes_configured()

    try:
        core_api.list_namespaced_pod(
            namespace=NAMESPACE,
            limit=1,
        )
        return {
            "connected": True,
            "namespace": NAMESPACE,
            "config_mode": CONFIG_MODE,
        }
    except ApiException as exc:
        handle_api_error(exc)


@app.get("/api/deployments")
def list_deployments():
    ensure_kubernetes_configured()

    try:
        result = apps_api.list_namespaced_deployment(
            namespace=NAMESPACE,
        )

        return {
            "namespace": NAMESPACE,
            "items": [
                {
                    "name": item.metadata.name,
                    "desired_replicas": item.spec.replicas or 0,
                    "ready_replicas": item.status.ready_replicas or 0,
                    "available_replicas": item.status.available_replicas or 0,
                    "images": [
                        container.image
                        for container in item.spec.template.spec.containers
                    ],
                }
                for item in result.items
            ],
        }
    except ApiException as exc:
        handle_api_error(exc)


@app.get("/api/pods")
def list_pods():
    ensure_kubernetes_configured()

    try:
        result = core_api.list_namespaced_pod(namespace=NAMESPACE)

        return {
            "namespace": NAMESPACE,
            "items": [
                {
                    "name": pod.metadata.name,
                    "phase": pod.status.phase,
                    "node": pod.spec.node_name,
                    "pod_ip": pod.status.pod_ip,
                    "ready": any(
                        status.ready
                        for status in (pod.status.container_statuses or [])
                    ),
                    "restarts": sum(
                        status.restart_count
                        for status in (pod.status.container_statuses or [])
                    ),
                    "labels": pod.metadata.labels or {},
                }
                for pod in result.items
            ],
        }
    except ApiException as exc:
        handle_api_error(exc)


@app.get("/api/metrics")
def pod_metrics():
    ensure_kubernetes_configured()

    try:
        result = custom_api.list_namespaced_custom_object(
            group="metrics.k8s.io",
            version="v1beta1",
            namespace=NAMESPACE,
            plural="pods",
        )

        return {
            "namespace": NAMESPACE,
            "items": [
                {
                    "name": item["metadata"]["name"],
                    "containers": [
                        {
                            "name": container["name"],
                            "cpu": container["usage"].get("cpu"),
                            "memory": container["usage"].get("memory"),
                        }
                        for container in item.get("containers", [])
                    ],
                }
                for item in result.get("items", [])
            ],
        }
    except ApiException as exc:
        handle_api_error(exc)


@app.get("/api/hpa")
def list_hpas():
    ensure_kubernetes_configured()

    try:
        result = autoscaling_api.list_namespaced_horizontal_pod_autoscaler(
            namespace=NAMESPACE,
        )

        return {
            "namespace": NAMESPACE,
            "items": [
                {
                    "name": item.metadata.name,
                    "deployment": item.spec.scale_target_ref.name,
                    "min_replicas": item.spec.min_replicas,
                    "max_replicas": item.spec.max_replicas,
                    "current_replicas": item.status.current_replicas or 0,
                    "desired_replicas": item.status.desired_replicas or 0,
                    "current_metrics": [
                        metric.to_dict()
                        for metric in (item.status.current_metrics or [])
                    ],
                }
                for item in result.items
            ],
        }
    except ApiException as exc:
        handle_api_error(exc)


@app.post("/api/deploy")
def deploy_application(request: DeployRequest):
    """Update the image of the approved demo Deployment."""
    ensure_kubernetes_configured()

    if not re.fullmatch(
        r"platform-demo:[A-Za-z0-9][A-Za-z0-9._-]{0,63}",
        request.image,
    ) or request.image.endswith(":latest"):
        raise HTTPException(
            status_code=422,
            detail="Use a versioned image tag, for example platform-demo:1.0.2",
        )

    try:
        deployment = apps_api.read_namespaced_deployment(
            name="platform-demo",
            namespace=NAMESPACE,
        )

        container_names = [
            container.name
            for container in deployment.spec.template.spec.containers
        ]
        if "platform-demo" not in container_names:
            raise HTTPException(
                status_code=409,
                detail="Expected application container was not found",
            )

        apps_api.patch_namespaced_deployment(
            name="platform-demo",
            namespace=NAMESPACE,
            body={
                "spec": {
                    "template": {
                        "spec": {
                            "containers": [
                                {
                                    "name": "platform-demo",
                                    "image": request.image,
                                }
                            ]
                        }
                    }
                }
            },
        )

        return {
            "status": "accepted",
            "deployment": "platform-demo",
            "image": request.image,
            "message": "Image update submitted; verify rollout status.",
        }
    except ApiException as exc:
        if exc.status == 404:
            raise HTTPException(
                status_code=404,
                detail="The approved Deployment was not found",
            ) from exc
        if exc.status == 403:
            raise HTTPException(
                status_code=403,
                detail="The platform API is not authorized to update this Deployment",
            ) from exc
        handle_api_error(exc)


def get_image_pull_failures(deployment):
    """Find image-pull failures in pods selected by the approved Deployment."""
    selector = deployment.spec.selector.match_labels or {}
    if not selector:
        return []

    label_selector = ",".join(
        f"{key}={value}" for key, value in selector.items()
    )
    result = core_api.list_namespaced_pod(
        namespace=NAMESPACE,
        label_selector=label_selector,
    )
    failures = []

    for pod in result.items:
        for container_status in (pod.status.container_statuses or []):
            waiting = getattr(container_status.state, "waiting", None)
            reason = getattr(waiting, "reason", None) if waiting else None

            if reason in {"ImagePullBackOff", "ErrImagePull"}:
                failures.append({
                    "pod": pod.metadata.name,
                    "container": container_status.name,
                    "reason": reason,
                    "message": getattr(waiting, "message", None),
                })

    return failures


@app.get("/api/deployments/platform-demo/rollout")
def deployment_rollout_status():
    """Return rollout progress for the approved demo Deployment."""
    ensure_kubernetes_configured()

    try:
        deployment = apps_api.read_namespaced_deployment(
            name="platform-demo",
            namespace=NAMESPACE,
        )

        spec = deployment.spec
        status = deployment.status
        desired = spec.replicas if spec.replicas is not None else 1
        updated = status.updated_replicas or 0
        ready = status.ready_replicas or 0
        available = status.available_replicas or 0

        conditions = [
            {
                "type": condition.type,
                "status": condition.status,
                "reason": condition.reason,
                "message": condition.message,
            }
            for condition in (status.conditions or [])
        ]

        progressing = next(
            (condition for condition in conditions
             if condition["type"] == "Progressing"),
            None,
        )
        available_condition = next(
            (condition for condition in conditions
             if condition["type"] == "Available"),
            None,
        )

        image_pull_failures = get_image_pull_failures(deployment)

        if (
            progressing
            and progressing["reason"] == "ProgressDeadlineExceeded"
        ) or image_pull_failures:
            rollout_status = "Failed"
        elif (
            updated == desired
            and ready == desired
            and available == desired
            and available_condition
            and available_condition["status"] == "True"
        ):
            rollout_status = "Healthy"
        else:
            rollout_status = "Deploying"

        return {
            "namespace": NAMESPACE,
            "deployment": deployment.metadata.name,
            "status": rollout_status,
            "image_pull_failures": image_pull_failures,
            "image": [
                container.image
                for container in spec.template.spec.containers
                if container.name == "platform-demo"
            ],
            "desired_replicas": desired,
            "updated_replicas": updated,
            "ready_replicas": ready,
            "available_replicas": available,
            "conditions": conditions,
        }
    except ApiException as exc:
        if exc.status == 404:
            raise HTTPException(
                status_code=404,
                detail="The approved Deployment was not found",
            ) from exc
        handle_api_error(exc)
