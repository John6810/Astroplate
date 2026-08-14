---
title: "GitOps Multi-Tenancy: the OPS/DEV Repo Split"
meta_title: ""
description: "One cluster, many application teams, and a clean answer to who owns what: the platform owns the AppProject, namespace and quotas in an OPS repo; developers own their manifests in a DEV repo; and the AppProject makes the boundary mechanical instead of political."
date: 2026-08-14T00:00:00Z
image: "/images/blog/gitops-multi-tenancy-ops-dev-split.png"
categories: ["GitOps"]
author: "Jonathan Aerts"
tags:
  [
    "argocd",
    "gitops",
    "kubernetes",
    "multi-tenancy",
    "appproject",
    "rbac",
    "platform-engineering",
    "aks",
  ]
draft: false
---

> **TL;DR.** Every application on our shared AKS cluster gets **two repos**: an **OPS repo** owned by the platform team (AppProject, namespace, ResourceQuota, LimitRange, the Application pointing at the app's manifests) and a **DEV repo** owned by the developers (their manifests, nothing else). The AppProject turns the boundary into machinery: two allowed source repos, one allowed destination namespace, `Namespace` as the only cluster-scoped kind, and project-scoped RBAC bound to a directory group. Onboarding a new team is a script, two Entra gestures, and zero `kubectl`.

Multi-tenancy on a shared cluster always fails at the same spot: the boundary between "what the platform guarantees" and "what the app team controls" exists only in a wiki page. Then someone's Helm chart creates a ClusterRole, someone's namespace has no quota, and the wiki page turns out to compile to nothing.

GitOps gives you a way to make that boundary **mechanical**. Ours is a repo split.

## Two repos per application

**The OPS repo** — owned by the platform team — carries everything the platform has an opinion about:

- the **AppProject** (the guardrail — more below)
- the **namespace**, with its labels
- the **ResourceQuota** — mandatory on this cluster, enforced by policy, so a tenant without one can't exist
- the **LimitRange** — the quota's forgotten companion: a quota that enforces `requests.cpu` **rejects every pod that doesn't set requests**. Default requests/limits per container make the quota livable instead of hostile
- the **Application** that points Argo CD at the DEV repo

**The DEV repo** — owned by the developers — carries their manifests. That's it. They ship by committing; they never touch the namespace definition, the quota that constrains them, or the project that fences them.

Ownership maps to repo permissions, which map to review policies. A developer PR **cannot** widen a quota, because the quota lives in a repo they don't write to. The org chart is enforced by git, not by hoping.

## The AppProject is the actual fence

Argo CD's AppProject is where the split stops being convention and becomes physics:

```yaml
spec:
  # Only these two repos can be sources for this project's Applications
  sourceRepos:
    - "https://dev.azure.com/contoso/Platform/_git/app-one-ops"
    - "https://dev.azure.com/contoso/Apps/_git/app-one-dev"
  # Deployment allowed into exactly one namespace of this cluster
  destinations:
    - server: https://kubernetes.default.svc
      namespace: app-one
  # The namespace itself is the ONLY cluster-scoped resource allowed
  # (created by the platform's root app — never by the app's manifests)
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
  # Inside the namespace: any standard application resource
  namespaceResourceWhitelist:
    - group: "*"
      kind: "*"
```

Read it as a threat model. A compromised or careless DEV repo can, at worst, damage **its own namespace**. It cannot deploy from an unexpected repo, cannot target another team's namespace, cannot create a ClusterRole, a CRD or a webhook. The blast radius of a tenant is the tenant.

RBAC follows the same scoping: each project defines an `ops` role whose policies only reach `app-one/*` applications, bound to a directory group. Platform operators for one application administer **that project** — nobody accumulates org-admin because it was easier that day.

## Onboarding as a pointer file

The part that made this scale: the platform repo doesn't _contain_ the tenants, it holds a **directory** of them — one pointer file per application, referencing the app's OPS repo. The root app-of-apps watches the directory; each pointer becomes the app's own app-of-apps; that creates the AppProject, namespace, quota, and the Application that syncs the DEV repo.

So onboarding a new team is:

1. a script that creates both repos, scaffolds the OPS repo from the template, sets the repo permissions, and drops the pointer file
2. two manual gestures that automation rightly doesn't have the privileges for: creating the team's directory groups, and letting the OPS group into the SSO application

No `kubectl`. No per-app secret either — repo credentials are per-project workload identity, so a new tenant inherits authentication instead of minting it ([that story is here](/blog/argocd-azure-devops-no-pat)).

## The shape of it

If your multi-tenancy boundary lives in documentation, it doesn't exist. Move it into things that reject: an AppProject per tenant, quotas the tenant can't edit because they physically live in someone else's repo, and RBAC scoped to the project. Then make onboarding boring — a scaffold and a pointer — because the security model you actually get is the one that's easy to apply to tenant number seven.

## References

- [Argo CD — projects](https://argo-cd.readthedocs.io/en/stable/user-guide/projects/)
- [Argo CD — app of apps pattern](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/)
- [Kubernetes — Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/)
- [Kubernetes — Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/)
