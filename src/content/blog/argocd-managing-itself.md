---
title: "Argo CD, Managed by Argo CD"
meta_title: ""
description: "The last thing in the cluster that wasn't in Git was the GitOps engine itself. Making Argo CD manage its own configuration — and adopt the resources that already existed, without recreating anything — takes one AppProject, one Application, and manifests that match reality byte for byte."
date: 2026-08-14T00:00:00Z
image: "/images/blog/argocd-managing-itself.png"
categories: ["GitOps"]
author: "Jonathan Aerts"
tags: ["argocd", "gitops", "kubernetes", "bootstrap", "self-management", "aks"]
draft: false
---

> **TL;DR.** Argo CD deploys everything from Git — except, too often, its own configuration, which someone once `kubectl apply`'d and everyone now fears touching. We closed the loop: a `platform` AppProject fenced to one repo and the `argocd` namespace, an `argocd-self` Application syncing Argo CD's own resources, and **adoption instead of recreation** — write the manifest to match the live object exactly, and the sync arrives green with zero downtime. Total imperative surface of the cluster: **two `kubectl apply`, ever.**

There's a special irony in every GitOps setup I've reviewed: the engine that enforces "everything comes from Git" is itself configured by hand. Its Ingress, its config, its RBAC — applied once during setup, drifting quietly, backed up nowhere. The deployment system is the only thing without a deployment system.

The fix is structurally simple and psychologically terrifying: point Argo CD at itself.

## The fence first

Self-management multiplies the blast radius of a bad commit, so the guardrail comes before the loop. A dedicated AppProject, locked down to the minimum:

```yaml
spec:
  # Only the platform repo can be a source
  sourceRepos:
    - "https://dev.azure.com/contoso/Platform/_git/platform"
  # Only the argocd namespace can be a destination
  destinations:
    - server: https://kubernetes.default.svc
      namespace: argocd
  # Namespaced resources only — no cluster-scoped surprises
  namespaceResourceWhitelist:
    - group: "*"
      kind: "*"
```

Whatever lands in that repo, the worst it can touch is Argo CD's own namespace. The whitelist widens the day a cluster-scoped addon genuinely needs it — not before.

## Adoption, not recreation

The interesting problem: the resources Argo CD should now manage **already exist**. The server's Ingress was applied by hand at install time and is serving live traffic. Naïvely importing it means delete-and-recreate — an outage on the front door of your deployment system, self-inflicted.

The trick is that Argo CD doesn't care _who created_ a resource. It compares desired state to live state. So: export the live object, strip the runtime noise, commit a manifest that is **byte-for-byte identical in spec** — then let the Application sync. Argo CD finds nothing to change, marks the resource green, and from that moment owns it. The Ingress never flickered; it just acquired a manager.

```yaml
# argocd-self — Argo CD manages its own infra folder
spec:
  project: platform
  source:
    path: argocd # the folder holding Argo CD's own resources
  destination:
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

`selfHeal` is the payoff: hand-edits to Argo CD's own config now get reverted like any other drift. The "someone tweaked the Ingress in a hurry" class of incident is gone — the hurry now goes through a PR like everything else.

## Two commands, then Git

The bootstrap ceremony, in full:

```bash
kubectl apply -f bootstrap/repo-secret.yaml   # how Argo CD reads the repo
kubectl apply -f bootstrap/platform-root.yaml # the root app-of-apps
```

The root app syncs the platform folder, which creates the AppProject and `argocd-self`; `argocd-self` adopts the existing resources; and from then on **every** change to the cluster — including to Argo CD itself — is a commit. Those two files stay in the repo not because anyone will run them again, but as the honest, versioned record of the only imperative acts in the cluster's history.

## The shape of it

List what exists in your cluster but not in Git. If the answer includes your GitOps engine's own configuration, that's the gap — and adoption means closing it costs no downtime: fence it with a project, mirror the live spec exactly, sync, and watch it come up green. The scariest change is the one that changes nothing.

## References

- [Argo CD — cluster bootstrapping (app of apps)](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/)
- [Argo CD — automated sync, pruning and self-heal](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)
