---
title: "The First Apply Is Local (and That's Fine)"
meta_title: ""
description: "Who applies the pipeline that applies? IaC bootstrapping has a chicken-and-egg problem everyone solves in secret and nobody writes down. Our answer, as an ADR: apply the foundation locally onto the pipeline's future state path, wire the pipeline afterwards, and measure success as a first plan that says No changes."
date: 2026-08-14T00:00:00Z
image: "/images/blog/first-apply-is-local.png"
categories: ["Landing Zone"]
author: "Jonathan Aerts"
tags:
  [
    "terraform",
    "terragrunt",
    "bootstrap",
    "azure-devops",
    "iac",
    "landing-zone",
    "adr",
  ]
draft: false
---

> **TL;DR.** The deployment chain that applies your IaC is itself infrastructure — and something has to create it first. Instead of hand-building the pipeline chain before the code could run, we applied the foundation **locally**, with a human identity, **onto the exact remote state path the pipeline would later use** — then wired the pipeline and let it adopt the state. Success had a measurable definition: the pipeline's first plan returns **`No changes` on every unit**. It did. And the decision is an ADR, because the least-written-down phase of every platform is the one that created it.

Every IaC platform has a creation myth nobody documents. The pipeline applies the code — but the pipeline's identity, its service connection, its approval gates are also infrastructure, and _something_ applied the first version of _them_. Usually a laptop. Usually in a hurry. Usually never spoken of again.

We hit the moment explicitly on a recent landing zone: foundation code written and validated, and **no deployment chain at all** — no service connection, no pipeline identity, no gated environment in the project. Two ways forward.

## The two orders

**Chain first.** Stand up the service connection, bootstrap the pipeline identity, grant its roles, create the environment and its checks — then let the pipeline do the first apply. Purist, and slow in the worst way: it front-loads several days of manual, cross-portal round-trips during which the finished code sits unverified. You're doing ClickOps to avoid ClickOps.

**Code first, locally.** Apply the foundation with a human identity that already holds every required permission, then build the chain and hand over. The objection writes itself: "you applied production from a laptop." The answer is in the constraints.

## What made local-first safe here

This isn't a universal license; it rested on three specific conditions, and the ADR lists them:

1. **The human identity already had everything.** Full rights on the target subscription, on the peered hub side, and data-plane access to the state storage. No permission was invented for the occasion.
2. **Nothing in the foundation required a pipeline-only context.** No resource whose data plane is reachable only from a private network the pipeline runs in. (A private Key Vault whose content must be written from inside the network would have flipped the decision.)
3. **The state went to its final home immediately.** The local applies wrote to the exact remote state path the pipeline would later use — same storage, same key convention. No local state, no migration later, no second source of truth. This is the condition that makes the whole move reversible-free.

## The measurable handover

The wager of local-first is that the pipeline can pick up the work **without recreating anything**. That gives the handover a pass/fail definition most bootstraps never get:

> Wire the chain, run the pipeline's first plan under its own identity, and require **`No changes` across every unit**.

Anything else — a tag diff, a case-sensitive name, a default the human's provider filled differently — is a bootstrap bug, caught before the pipeline's first apply rather than during it. Ours came back clean, which retroactively made the laptop applies what they were always meant to be: a temporary identity swap, not a parallel process.

The epilogue matters as much as the sequence: the ADR was updated with a **settled** note the day the chain went live, and local applies were re-scoped to **bootstrap and documented break-glass only**. The laptop path still exists — pretending otherwise is how it gets used in secret — but now it's written down, bounded, and exceptional.

## The shape of it

Bootstrapping order is a real architecture decision — it deserves an ADR, conditions, and a success test, like anything else that touches production. If you choose local-first: same state path as the future pipeline, an identity that already has the rights, and a handover defined as `No changes`. If you can't meet those three, you've also learned something — your foundation has a hidden dependency on the chain, and it's better to meet it on paper than at apply time.

This was one decision among the many that stamping a second landing zone forced into writing — [that bigger story is here](/blog/second-landing-zone-real-test).

## References

- [Terragrunt — state backend](https://terragrunt.gruntwork.io/docs/features/state-backend/)
- [Azure DevOps — service connections](https://learn.microsoft.com/azure/devops/pipelines/library/service-endpoints)
- [ADR — architecture decision records](https://adr.github.io/)
