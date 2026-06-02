# kubectl Commands

Foundation build commands:

```powershell
kubectl version --client -o json
kubectl --kubeconfig <file> cluster-info
kubectl --kubeconfig <file> get namespaces -o json
kubectl --kubeconfig <file> get pods -A -o json
kubectl --kubeconfig <file> get deployments -A -o json
kubectl --kubeconfig <file> get services -A -o json
kubectl --kubeconfig <file> get events -A -o json
kubectl --kubeconfig <file> get pod <name> -n <namespace> -o yaml
kubectl --kubeconfig <file> describe pod <name> -n <namespace>
kubectl --kubeconfig <file> logs <pod> -n <namespace> --tail=500
kubectl --kubeconfig <file> logs <pod> -n <namespace> -f --tail=500
```
