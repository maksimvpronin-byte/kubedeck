from kubedeck_backend.resources.normalizers import pod_summary


def test_pod_summary_marks_deleting_pod_as_terminating():
    row = pod_summary({
        "metadata": {
            "uid": "pod-1",
            "name": "nginx-123",
            "namespace": "default",
            "creationTimestamp": "2026-06-02T10:00:00Z",
            "deletionTimestamp": "2026-06-02T10:01:00Z",
        },
        "spec": {
            "containers": [{"name": "nginx"}],
            "nodeName": "node-a",
        },
        "status": {
            "phase": "Running",
            "containerStatuses": [{"name": "nginx", "ready": True, "restartCount": 0}],
        },
    })

    assert row["phase"] == "Terminating"
    assert row["status"] == "Terminating"
    assert row["deletionTimestamp"] == "2026-06-02T10:01:00Z"
