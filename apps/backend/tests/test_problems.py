from kubedeck_backend.api.problems import build_problem_rows, classify_problem, summarize_problems


def test_classify_problem_common_kubernetes_failure_modes():
    assert classify_problem("Pod", "Container problem", "app: CrashLoopBackOff back-off restarting failed container") == "crashLoop"
    assert classify_problem("Event", "FailedScheduling", "0/3 nodes are available: insufficient cpu") == "scheduling"
    assert classify_problem("Event", "FailedMount", "MountVolume.SetUp failed for volume config") == "storage"
    assert classify_problem("Pod", "Container problem", "nginx: ErrImagePull pull access denied") == "imagePull"


def test_build_problem_rows_adds_category_and_event_target_locator():
    rows = build_problem_rows(
        pods=[],
        deployments=[],
        events=[{
            "uid": "event-1",
            "namespace": "default",
            "name": "nginx.123",
            "type": "Warning",
            "reason": "FailedScheduling",
            "message": "0/2 nodes are available: 2 Insufficient cpu.",
            "createdAt": "2026-06-02T10:00:00Z",
            "lastTimestamp": "2026-06-02T10:01:00Z",
            "involvedKind": "Pod",
            "involvedName": "nginx",
            "involvedNamespace": "default",
        }],
        nodes=[],
        pvcs=[],
        restart_threshold=3,
    )

    assert len(rows) == 1
    assert rows[0]["category"] == "scheduling"
    assert rows[0]["targetResource"] == "pods"
    assert rows[0]["targetNamespace"] == "default"
    assert rows[0]["targetName"] == "nginx"


def test_summarize_problems_counts_categories_and_kinds():
    items = [
        {"severity": "Critical", "kind": "Pod", "category": "crashLoop"},
        {"severity": "Warning", "kind": "Event", "category": "scheduling"},
    ]

    summary = summarize_problems(items, {"pods": [], "events": []}, [])

    assert summary["critical"] == 1
    assert summary["warning"] == 1
    assert summary["categories"] == {"crashLoop": 1, "scheduling": 1}
    assert summary["kinds"] == {"Event": 1, "Pod": 1}
