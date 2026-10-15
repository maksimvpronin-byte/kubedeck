#!/bin/bash
# Emulated second node under memory pressure, for one screenshot. A taint keeps
# every pod (DaemonSets included) off it; a loop keeps its status and lease fresh.
k="k3s kubectl"
name=k3s-worker-2
cat <<EOF | $k apply -f -
apiVersion: v1
kind: Node
metadata:
  name: $name
  labels:
    kubernetes.io/hostname: $name
    kubernetes.io/os: linux
    kubernetes.io/arch: amd64
    node.kubernetes.io/instance-type: emulated
spec:
  taints:
    - key: kubedeck.dev/emulated
      value: "true"
      effect: NoSchedule
EOF
cat <<EOF | $k apply -f -
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: $name
  namespace: kube-node-lease
spec:
  holderIdentity: $name
  leaseDurationSeconds: 40
EOF
while true; do
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  micro=$(date -u +%Y-%m-%dT%H:%M:%S.000000Z)
  $k patch lease $name -n kube-node-lease --type=merge -p "{\"spec\":{\"renewTime\":\"$micro\"}}" >/dev/null
  $k patch node $name --subresource=status --type=merge -p "{\"status\":{
    \"capacity\":{\"cpu\":\"8\",\"memory\":\"16303348Ki\",\"pods\":\"110\",\"ephemeral-storage\":\"102687672Ki\"},
    \"allocatable\":{\"cpu\":\"8\",\"memory\":\"16303348Ki\",\"pods\":\"110\",\"ephemeral-storage\":\"99893909394\"},
    \"addresses\":[{\"type\":\"InternalIP\",\"address\":\"172.22.183.200\"},{\"type\":\"Hostname\",\"address\":\"$name\"}],
    \"nodeInfo\":{\"kubeletVersion\":\"v1.37.1+k3s1\",\"containerRuntimeVersion\":\"containerd://2.3.4-k3s1\",\"osImage\":\"Ubuntu 22.04.5 LTS\",\"operatingSystem\":\"linux\",\"architecture\":\"amd64\",\"kernelVersion\":\"6.6.87.2-microsoft-standard-WSL2\",\"machineID\":\"\",\"systemUUID\":\"\",\"bootID\":\"\",\"kubeProxyVersion\":\"\"},
    \"conditions\":[
      {\"type\":\"MemoryPressure\",\"status\":\"True\",\"reason\":\"KubeletHasInsufficientMemory\",\"message\":\"kubelet has insufficient memory available\",\"lastHeartbeatTime\":\"$now\",\"lastTransitionTime\":\"2026-10-15T13:00:00Z\"},
      {\"type\":\"DiskPressure\",\"status\":\"False\",\"reason\":\"KubeletHasNoDiskPressure\",\"message\":\"kubelet has no disk pressure\",\"lastHeartbeatTime\":\"$now\",\"lastTransitionTime\":\"2026-10-15T13:00:00Z\"},
      {\"type\":\"PIDPressure\",\"status\":\"False\",\"reason\":\"KubeletHasSufficientPID\",\"message\":\"kubelet has sufficient PID available\",\"lastHeartbeatTime\":\"$now\",\"lastTransitionTime\":\"2026-10-15T13:00:00Z\"},
      {\"type\":\"Ready\",\"status\":\"True\",\"reason\":\"KubeletReady\",\"message\":\"kubelet is posting ready status\",\"lastHeartbeatTime\":\"$now\",\"lastTransitionTime\":\"2026-10-15T13:00:00Z\"}
    ]}}" >/dev/null
  sleep 10
done
