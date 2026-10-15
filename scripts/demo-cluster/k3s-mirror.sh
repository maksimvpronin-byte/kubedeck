#!/bin/bash
set -euo pipefail
mkdir -p /etc/rancher/k3s
cat > /etc/rancher/k3s/registries.yaml <<'EOF'
mirrors:
  docker.io:
    endpoint:
      - "https://mirror.gcr.io"
EOF
systemctl stop kd-k3s || true
sleep 2
systemd-run --unit=kd-k3s --collect /usr/local/bin/k3s server --write-kubeconfig-mode 644 --node-name k3s-demo --data-dir /root/kd-k3s/data
sleep 45
k3s kubectl get pods -A
