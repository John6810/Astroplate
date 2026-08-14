---
title: "GitOps Without PATs: Argo CD to Azure DevOps via Workload Identity"
meta_title: ""
description: "The Git credential in your Argo CD cluster is probably the last PAT in your platform. How to replace it with Entra Workload Identity end-to-end: UAMI, federated credential on the repo-server service account, and a repository secret with no password field at all."
date: 2026-08-14T00:00:00Z
image: "/images/blog/argocd-azure-devops-no-pat.png"
categories: ["GitOps"]
author: "Jonathan Aerts"
tags:
  [
    "argocd",
    "gitops",
    "azure-devops",
    "workload-identity",
    "aks",
    "entra-id",
    "oidc",
    "kubernetes",
    "security",
  ]
draft: false
---

> **TL;DR.** Argo CD can authenticate to Azure DevOps repos with **Entra Workload Identity** instead of a PAT: a user-assigned managed identity, a federated credential bound to the `argocd-repo-server` service account, the identity added as a **Project Reader** in Azure DevOps, and a repository secret that carries `useAzureWorkloadIdentity: "true"` — and **no password field at all**. Five objects, one afternoon, zero credentials to rotate ever again.

We built an Azure platform on a strict rule: **no persistent secrets**. Every pipeline authenticates with OIDC, every workload uses managed identities, nothing carries a client secret. Then we deployed Argo CD, and the very first thing it asked for was a PAT.

That PAT would have been the last static credential in the platform — sitting in the cluster as a Kubernetes Secret, base64-encoded, cloning every repo we ship from. The credential with the widest blast radius, protected the least.

## Why the Git credential is the worst one you own

A GitOps controller's repo credential has a specific, unpleasant profile:

- **It's a PAT, so it's a person.** Azure DevOps PATs belong to a user account. The engineer who created it leaves, their account gets disabled, and your deployment engine silently loses read access to everything. You find out from `ComparisonError` on thirty Applications at once.
- **It expires by design.** ADO caps PAT lifetime. Whatever the cap, the renewal lands on a calendar, the calendar belongs to a human, and the human is on holiday when it matters.
- **It lives in the cluster.** `kubectl get secret -n argocd -o yaml` and it's yours. Anyone with read access to the namespace holds a valid Git credential that works from _anywhere_ — a laptop, another cluster, an exfiltration script. Nothing binds it to the workload it was minted for.
- **It's invisible to your identity plane.** A PAT doesn't show up in Entra sign-in logs, doesn't pass through Conditional Access, and can't be revoked from the place your security team actually looks.

We had eliminated exactly this class of problem everywhere else. Keeping one PAT "just for Argo CD" would have meant maintaining rotation tooling, break-glass documentation and an audit exception for a single credential.

## The mechanism

Argo CD supports Azure Workload Identity for Azure DevOps repositories natively since the 3.x line (see the [private repositories docs](https://argo-cd.readthedocs.io/en/stable/user-guide/private-repositories/); Microsoft's AKS extension docs pin it at ≥ 3.0.0-rc2). Five pieces, in dependency order.

**1. A user-assigned managed identity.** One UAMI, dedicated to Argo CD. It will be the identity that Azure DevOps sees.

**2. A federated identity credential** binding the AKS cluster's OIDC issuer to the repo-server's Kubernetes service account:

```hcl
federated_identity_credentials = {
  repo_server = {
    name    = "fic-argocd-repo-server"
    issuer  = module.aks.oidc_issuer_url
    subject = "system:serviceaccount:argocd:argocd-repo-server"
  }
  # Only needed if you use ApplicationSet generators that read repos:
  appset_controller = {
    name    = "fic-argocd-applicationset-controller"
    issuer  = module.aks.oidc_issuer_url
    subject = "system:serviceaccount:argocd:argocd-applicationset-controller"
  }
}
```

This is the line that changes the security model. The federation says: _a token is only issued to this exact service account, in this exact namespace, from this exact cluster's issuer_. There is nothing to steal — the "credential" is a trust relationship, not a string.

**3. The pod/service-account wiring.** The repo-server pods need the `azure.workload.identity/use: "true"` label and the service account needs the `azure.workload.identity/client-id` annotation pointing at the UAMI. If you deploy Argo CD through the AKS extension (still in preview, but it handles exactly this wiring), it does this for you — with one gotcha that cost us a debugging session: setting the client ID alone does nothing. You must explicitly enable the workload-identity flag, otherwise the extension **doesn't inject the annotations at all**:

```yaml
# AKS Argo CD extension configuration — both lines, not just the second one
azure.workloadIdentity.enabled: "true"
azure.workloadIdentity.clientId: "<uami-client-id>"
```

**4. Authorization in Azure DevOps.** The UAMI's service principal joins the **Project Readers** group of the ADO project(s) hosting your manifests. That's the whole permission: read code. The PAT equivalent was `Code (Read)` — except this one is a group membership you can see, audit and revoke in one place.

**5. The repository secret.** This is the part that still makes me smile:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: repo-platform
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: git
  url: "https://contoso@dev.azure.com/contoso/Platform/_git/platform-manifests"
  useAzureWorkloadIdentity: "true"
```

A Kubernetes Secret with **no secret in it**. The `url` and a flag. If someone dumps the namespace, they learn your repo path — which was never the thing worth protecting.

## What actually changes

The operational profile flips completely:

|                  | PAT                               | Workload Identity                             |
| ---------------- | --------------------------------- | --------------------------------------------- |
| Expires          | yes, on a calendar                | never — tokens are minted per-request         |
| Bound to         | a human account                   | the cluster + namespace + service account     |
| Stolen secret is | a working Git credential anywhere | a repo URL                                    |
| Revocation       | find and delete the PAT           | remove one group membership                   |
| Audit            | nowhere useful                    | Entra sign-in logs, like every other identity |

The bootstrap sequence keeps its GitOps purity, too. The repo secret above is one of exactly two `kubectl apply` commands ever run against the cluster — the secret and the root app-of-apps Application. After that, the repo secrets themselves are managed _by_ Argo CD from Git, including the ones for the app teams' repos. Two imperative commands, then the cluster manages its own access.

## The shape of it

Every platform has one credential that outlived the zero-secrets policy because it felt too structural to touch. In a GitOps setup, it's the Git credential — the one secret that can rewrite everything else. It's also, it turns out, one of the easiest to eliminate: the entire mechanism is five objects and an ADO group membership.

Run `kubectl get secret -n argocd -l argocd.argoproj.io/secret-type=repository -o yaml` on your cluster. If you see a `password` field, that's the last PAT standing — and now you know how to kill it.

## References

- [Argo CD — private repositories (Azure Workload Identity)](https://argo-cd.readthedocs.io/en/stable/user-guide/private-repositories/)
- [Azure Workload Identity — federated credentials](https://learn.microsoft.com/azure/aks/workload-identity-overview)
- [GitOps with Argo CD on AKS/Arc (extension)](https://learn.microsoft.com/azure/azure-arc/kubernetes/tutorial-use-gitops-argocd)
