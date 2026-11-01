import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "KUBERNETES_CONFIGURED", True)
    return TestClient(main.app)


@pytest.fixture
def deployment():
    return SimpleNamespace(
        metadata=SimpleNamespace(name="platform-demo"),
        spec=SimpleNamespace(
            selector=SimpleNamespace(
    match_labels={"app": "platform-demo"}
),
            replicas=2,
            template=SimpleNamespace(
                spec=SimpleNamespace(
                    containers=[
                        SimpleNamespace(
                            name="platform-demo",
                            image="platform-demo:1.0.1",
                        )
                    ]
                )
            ),
        ),
        status=SimpleNamespace(
            updated_replicas=2,
            ready_replicas=2,
            available_replicas=2,
            conditions=[
                SimpleNamespace(
                    type="Available",
                    status="True",
                    reason="MinimumReplicasAvailable",
                    message="Deployment has minimum availability.",
                ),
                SimpleNamespace(
                    type="Progressing",
                    status="True",
                    reason="NewReplicaSetAvailable",
                    message="Deployment successfully progressed.",
                ),
            ],
        ),
    )


@pytest.mark.parametrize(
    "image",
    [
        "platform-demo:latest",
        "nginx:latest",
        "invalid-image",
        "platform-demo:",
        "platform-demo: bad",
    ],
)
def test_rejects_invalid_images(client, image):
    response = client.post("/api/deploy", json={"image": image})
    assert response.status_code == 422


def test_accepts_valid_versioned_image(client, deployment, monkeypatch):
    monkeypatch.setattr(
        main.apps_api,
        "read_namespaced_deployment",
        MagicMock(return_value=deployment),
    )
    patch = MagicMock()
    monkeypatch.setattr(main.apps_api, "patch_namespaced_deployment", patch)

    response = client.post(
        "/api/deploy",
        json={"image": "platform-demo:1.0.2"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "accepted"
    assert response.json()["image"] == "platform-demo:1.0.2"
    patch.assert_called_once()


def test_rollout_reports_healthy(client, deployment, monkeypatch):
    monkeypatch.setattr(
        main.apps_api,
        "read_namespaced_deployment",
        MagicMock(return_value=deployment),
    )

    response = client.get("/api/deployments/platform-demo/rollout")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Healthy"
    assert body["image"] == ["platform-demo:1.0.1"]
    assert body["ready_replicas"] == 2
    assert body["available_replicas"] == 2


def test_rollout_reports_failed_after_progress_deadline(
    client, deployment, monkeypatch
):
    deployment.status.conditions[1].reason = "ProgressDeadlineExceeded"
    deployment.status.conditions[1].message = "Deployment exceeded progress deadline."

    monkeypatch.setattr(
        main.apps_api,
        "read_namespaced_deployment",
        MagicMock(return_value=deployment),
    )

    response = client.get("/api/deployments/platform-demo/rollout")

    assert response.status_code == 200
    assert response.json()["status"] == "Failed"


def test_rollout_reports_deploying_when_replicas_not_ready(
    client, deployment, monkeypatch
):
    deployment.status.ready_replicas = 1
    deployment.status.available_replicas = 1

    monkeypatch.setattr(
        main.apps_api,
        "read_namespaced_deployment",
        MagicMock(return_value=deployment),
    )

    response = client.get("/api/deployments/platform-demo/rollout")

    assert response.status_code == 200
    assert response.json()["status"] == "Deploying"



@pytest.mark.parametrize("reason", ["ImagePullBackOff", "ErrImagePull"])
def test_detects_image_pull_failures(monkeypatch, reason):
    waiting = SimpleNamespace(
        reason=reason,
        message="Test image is unavailable",
    )
    pod = SimpleNamespace(
        metadata=SimpleNamespace(
            name="platform-demo-test",
            labels={"app": "platform-demo"},
        ),
        status=SimpleNamespace(
            container_statuses=[
                SimpleNamespace(
                    name="platform-demo",
                    state=SimpleNamespace(waiting=waiting),
                )
            ]
        ),
    )
    monkeypatch.setattr(
        main.core_api,
        "list_namespaced_pod",
        MagicMock(return_value=SimpleNamespace(items=[pod])),
    )

    failures = main.get_image_pull_failures(
    SimpleNamespace(
        spec=SimpleNamespace(
            selector=SimpleNamespace(
                match_labels={"app": "platform-demo"}
            )
        )
    )
)

    assert len(failures) == 1
    assert failures[0]["reason"] == reason
    assert failures[0]["pod"] == "platform-demo-test"


def test_rollout_endpoint_reports_image_pull_failure(
    client, deployment, monkeypatch
):
    monkeypatch.setattr(
        main.apps_api,
        "read_namespaced_deployment",
        MagicMock(return_value=deployment),
    )
    monkeypatch.setattr(
        main,
        "get_image_pull_failures",
        MagicMock(return_value=[
            {
                "pod": "platform-demo-test",
                "container": "platform-demo",
                "reason": "ImagePullBackOff",
                "message": "Test image is unavailable",
            }
        ]),
    )

    response = client.get("/api/deployments/platform-demo/rollout")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Failed"
    assert body["image_pull_failures"][0]["reason"] == "ImagePullBackOff"
    assert body["image_pull_failures"][0]["pod"] == "platform-demo-test"
