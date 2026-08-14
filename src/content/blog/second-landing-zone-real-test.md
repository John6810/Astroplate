---
title: "The Second Landing Zone Is the Real Test of the First"
meta_title: ""
description: "You don't know whether your Azure Landing Zone is industrialized or artisanal until you deploy a second one. What survived the copy, what the copy could never give us, and why we refused to factor out the duplication — for now."
date: 2026-08-14T00:00:00Z
image: "/images/blog/second-landing-zone-real-test.png"
categories: ["Landing Zone"]
author: "Jonathan Aerts"
tags:
  [
    "azure",
    "landing-zone",
    "terragrunt",
    "terraform",
    "platform-engineering",
    "iac",
    "governance",
    "state-management",
  ]
draft: false
---

> **TL;DR.** We stamped out a second application landing zone from the first one. The diff between the two repos is **six values**: subscription, name acronym, address space, project, service connection, approval gate. Everything else — structure, pipeline, state convention, auth chain — copied verbatim, along with every fix we had already paid for in debugging. What the copy _couldn't_ give us is the interesting part: addressing, overlay CIDRs, and the bootstrap chicken-and-egg. And no, we didn't factor out the duplication — the rule of three exists for a reason.

Everyone's first landing zone works. Months of debugging make sure of it. The question that actually measures the work is different: **when the second subscription shows up, what happens?**

If the answer involves re-discovering pipeline auth, re-inventing state keys and re-debugging the same provider races, your first landing zone wasn't a platform — it was a very expensive one-off. Ours got its answer recently: a second, prod-only, shared application landing zone under the same hub. Same region, same class of object. The perfect audit of the first one.

## The six-value diff

The decision was deliberate and documented as an ADR: take the first repo **verbatim** as the template — root config, global conventions, foundation layer, pipeline definitions, bootstrap identity — and change only what is genuinely different:

1. the subscription
2. the naming acronym
3. the address space
4. the project hosting the repo
5. the service connection
6. the approval gate on the environment

That's the whole diff. My working definition since: **a landing zone is industrialized when the second one is a six-value diff.** Every value beyond that in your would-be diff is industrialization debt with an address.

## What made the copy possible

Three structural decisions from the first landing zone turned out to be the load-bearing ones.

**Modules live in their own repo, consumed as `git::` source at runtime.** No vendoring, no submodules. Both landing zones resolve the same module library from `main`; a module fix lands once and benefits every consumer on their next plan. The trade-off is real — no pinning by default means a breaking change in the library can break a plan in a repo nobody touched — and it's mitigated deliberately: committed provider lock files, plan-before-apply everywhere, and a per-unit `?ref=` escape hatch we have yet to need.

**State is centralized in the management subscription, keyed by project.** Putting each landing zone's state inside the subscription it deploys creates a circular dependency at bootstrap — you need the subscription to create the storage that describes the subscription. Centralizing it also concentrates the thing you must never lose. Two details paid for themselves:

- **Entra data-plane auth on the state storage** (`use_azuread_auth = true`) — a role assignment instead of an account key. The deployment identity has zero control-plane rights on the management subscription; revocation is removing one role.
- **Path normalization in the state key.** On Windows, `path_relative_to_include()` returns backslashes; in the pipeline it returns slashes. Same unit, two different state keys, and Terraform happily creates a ghost state for one of them. One `replace(..., "\\", "/")` in the root config, discovered the hard way, copied for free.

**The debugging travels with the template.** The first landing zone's painful lessons are written down next to the code they fixed, and the copy carries both. The three that would have cost the second team (well — the second _repo_; same team) a week:

- **Cross-project module clones reject the pipeline's own token.** With "Protect access to repositories in YAML pipelines" enabled — the default — `System.AccessToken` is scoped to repos declared in a `checkout` step. Terragrunt clones module sources at runtime; they're never declared; the token is refused even when the account has read rights. The fix is an Entra access token for the deployment identity, exported once and wired as a git extraheader. Bonus diagnostic that saved hours: **a 401 means the org doesn't know the identity; a `TF401019` means it knows it and denies it.** Those are different problems with different fixes.
- **Task-context isolation eats your git config.** Setting the extraheader inside an Azure CLI task looked successful and did nothing — the task runs with its own HOME, and the following bash steps never see the config. Token in the task, `git config` in a bash step.
- **The provider plugin cache is not concurrency-safe.** Parallel `init` across units against a shared plugin cache fails on a _different unit every run_ — the classic signature of a race. Serializing init (`--parallelism 1`) while keeping plan parallel made it deterministic. The tempting env-var workaround (`TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE`) moved the failure somewhere worse; it's documented as a do-not-repeat.

## What the copy could never give us

This is the part I'd underline for anyone about to stamp their second zone: the copy answers the _how_, but a landing zone still has decisions that are **inherently per-instance**.

**Addressing.** The new zone needed its own block from the corporate supernet — sized for years of accumulation, because a shared application zone collects services with different owners and re-addressing later means an outage. We took the first free `/21`, split only what's needed now (nodes, private endpoints, a delegated block), and **reserved the rest on paper instead of slicing it**. The blocking prerequisite lives _outside_ the new repo: the block must be reserved in the first landing zone's IPAM inventory, or a future workload gets allocated the same range. Your zones are separate repos; your address space is one shared truth.

**Overlay CIDRs.** With CNI overlay, pod and service ranges live outside the VNet — two clusters _can_ reuse the same ranges without immediate conflict, and it's tempting to copy those too. We assigned distinct ranges per subscription anyway, from the CGNAT space. Two reasons: if clusters from different zones ever need to talk through the hub, nobody re-addresses anything; and an IP in a log tells you which subscription it came from. Cheap now, impossible later.

**The bootstrap chicken-and-egg.** The foundation code was ready before the deployment chain existed — no service connection, no pipeline identity, no gated environment. Standing up that chain first means days of manual round-trips while the code sits unverified. We applied the foundation **locally, with a human identity, onto the exact state path the pipeline would later use** — then wired the pipeline and let it adopt the state. The wager: adoption with zero recreations. It settled: the pipeline's first plan came back `No changes` on every unit. Local apply is now bootstrap-and-break-glass only, and that's written down too.

## The duplication we kept

Two repos now carry two copies of the pipeline and the conventions, and the ADR says so out loud: this is **duplication debt, accepted**. The alternatives were all worse at this count — a fresh scaffold re-pays the debugging for nothing; a monorepo erases exactly the state, RBAC and responsibility boundaries that justify separate zones; and factoring shared pipeline templates _now_, at two occurrences, is premature abstraction with a maintenance bill.

The rule is written into the decision: **copy at two, factor at three.** When a third landing zone shows up, the duplication becomes a pattern and earns a template repo. Until then, two readable copies beat one clever abstraction.

## The shape of it

Deploy your second landing zone before you need it, even as an exercise. Diff what you'd actually have to change. Six values means your first one was a platform. Sixty means you now have the most honest industrialization backlog you'll ever get — written by your own repo, in order of pain.

## References

- [Azure Landing Zones — Cloud Adoption Framework](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/)
- [Terragrunt — keep your remote state configuration DRY](https://terragrunt.gruntwork.io/docs/features/state-backend/)
- [Azure DevOps — protect access to repositories in YAML pipelines](https://learn.microsoft.com/azure/devops/pipelines/process/access-tokens)
