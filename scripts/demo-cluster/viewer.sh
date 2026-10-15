#!/bin/bash
set -euo pipefail
k="k3s kubectl"
cat <<YAML | $k apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: oncall-viewer
  namespace: kubedeck-demo
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pods-read-only
  namespace: kubedeck-demo
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: oncall-viewer-pods
  namespace: kubedeck-demo
subjects:
  - kind: ServiceAccount
    name: oncall-viewer
    namespace: kubedeck-demo
roleRef:
  kind: Role
  name: pods-read-only
  apiGroup: rbac.authorization.k8s.io
YAML
token=$($k -n kubedeck-demo create token oncall-viewer --duration=24h)
ca=$(grep certificate-authority-data /etc/rancher/k3s/k3s.yaml | awk '{print $2}')
ip=$(hostname -I | awk '{print $1}')
cat > "$1" <<KC
apiVersion: v1
kind: Config
clusters:
- name: k3s-oncall
  cluster:
    server: https://$ip:6443
    certificate-authority-data: $ca
contexts:
- name: oncall-viewer@k3s-oncall
  context:
    cluster: k3s-oncall
    user: oncall-viewer
    namespace: kubedeck-demo
current-context: oncall-viewer@k3s-oncall
users:
- name: oncall-viewer
  user:
    token: $token
KC
echo written
