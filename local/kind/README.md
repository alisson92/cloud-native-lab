# Local Kind cluster

Zero-cost Kubernetes target for Phases 2-6, per
`docs/adr/004-local-first-validation-with-kind.md`. Not Terraform-managed:
there is no official HashiCorp/Kind Terraform provider, so cluster lifecycle
here is a plain `kind` CLI command, run once by hand.

## One-time setup

```sh
kind create cluster --config local/kind/kind-config.yaml
```

This creates a single control-plane cluster named `cloud-native-lab` and
merges a kubeconfig context named `kind-cloud-native-lab` into
`~/.kube/config` (Kind's default context naming: `kind-<cluster-name>`).

Verify:

```sh
kubectl config get-contexts kind-cloud-native-lab
kubectl cluster-info --context kind-cloud-native-lab
```

## Next step

Bootstrap Argo CD and the app-of-apps root onto this cluster with
`terraform/delivery/` — see `terraform/delivery/README.md`.

## Teardown

```sh
kind delete cluster --name cloud-native-lab
```
