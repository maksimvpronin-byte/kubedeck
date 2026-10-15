#!/bin/bash
set -euo pipefail
dir=/root/kd-k3s
mkdir -p "$dir"
cd "$dir"
base="https://github.com/k3s-io/k3s/releases/download/v1.37.1%2Bk3s1"
curl -fsSL -o k3s "$base/k3s"
curl -fsSL -o sums.txt "$base/sha256sum-amd64.txt"
expected=$(awk '$2=="k3s"{print $1}' sums.txt)
actual=$(sha256sum k3s | awk '{print $1}')
echo "expected $expected"
echo "actual   $actual"
[ "$expected" = "$actual" ] || { echo "CHECKSUM MISMATCH"; rm -f k3s; exit 1; }
install -m 0755 k3s /usr/local/bin/k3s
/usr/local/bin/k3s --version
