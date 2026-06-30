---
title: "When terraform plan says 'no changes' and the feature is broken anyway"
meta_title: ""
description: "Two well-meaning Azure automations — policy-driven DNS wiring and drift suppression via ignore_changes — combine into a silent outage that no plan ever sees. An AVD private endpoint war story, and the general lesson."
date: 2026-06-25T00:00:00Z
image: "/images/blog/terraform-plan-no-changes.png"
categories: ["Landing Zone"]
author: "Jonathan Aerts"
tags: ["terraform", "azure", "landing-zone", "avd", "private-endpoint", "iac"]
draft: false
---

Everything was green. Workspace deployed, host pool up, users assigned, RBAC clean. Then a user opens Windows App and hits: **"No devices or apps found."** The feed never loads.

Nothing in the Azure portal looks wrong. And `terraform plan` reports, with total confidence, **no changes**. That last part is the dangerous one — because the feature _is_ broken, and the plan is telling you it isn't.

This is the story of two safety mechanisms, each correct in isolation, that combine into an outage no plan would ever surface. If you run Azure Virtual Desktop behind private endpoints in a landing zone, you'll meet it. The lesson, though, reaches far beyond AVD.

## The symptom: a feed that refuses to discover

AVD's initial feed discovery resolves `rdweb.wvd.microsoft.com`. In a full-private setup — DNS forced through the hub resolver, a catch-all rule sending everything else to a firewall DNS proxy — that public Microsoft record can fail to resolve or get blocked outbound. The client has no feed, so it shows nothing. The error blames the user's apps; the cause is name resolution.

The supported fix is architectural: deploy a private endpoint for the AVD `global` subresource on a dedicated workspace. Microsoft then CNAMEs `rdweb.wvd.microsoft.com` to a private record in `privatelink-global.wvd.microsoft.com`, and discovery stays inside the network. Clean. So you add the private endpoint and expect green.

It is not green. And this is where the two automations start working against you.

## Automation #1: the policy that wires DNS — except this one

Enterprise landing zones rely on DeployIfNotExists policies to auto-wire private DNS. You drop a private endpoint, and the `Deploy-Private-DNS-*` assignments create the zone group for you — records appear on their own, no Terraform. For standard subresources (the `feed` and `connection` endpoints) it works perfectly. You stop thinking about it. That's the whole point of the policy.

But the `global` subresource lives in a newer zone, `privatelink-global.wvd.microsoft.com`, and the policy set assigned in the environment **has no equivalent assignment for it.** So the private endpoint is created, and then... nothing. No zone group. No records. The thing you deployed precisely to fix DNS resolution has no DNS.

The trap isn't that the policy is missing. The trap is that every _other_ private endpoint trained you to assume the platform handles it. The gap is invisible exactly because the automation around it is reliable.

> Every time you introduce a new _type_ of private endpoint, verify the DINE policy actually covers it. Run `az network private-endpoint dns-zone-group list` on the new endpoint. If it's empty after a few minutes, the platform won't wire it — you will.

## Automation #2: the ignore_changes that hides your fix

Fine — the policy doesn't wire it, so you wire it in code. You add the `private_dns_zone_group` block to the endpoint's Terragrunt config, run a plan, and brace for the diff.

**No changes.**

The private endpoint module ignores changes on `private_dns_zone_group`. The intent behind it is good — it lets the platform policy own the zone group without Terraform fighting it on every apply by reverting platform-managed records. In the common case where the policy _does_ wire the DNS, `ignore_changes` is exactly the right call: it stops IaC and policy from shooting at each other.

But `ignore_changes` is unconditional. It can't tell "the platform owns this, don't touch it" apart from "the platform left a gap and I'm trying to fill it." So when you add the block by hand, Terraform is blind to it. The plan is honest about its own model of the world — except we told that model to look away from the one field that matters.

Two automations, both defensible. The policy's job: wire DNS so you don't have to. The module's job: don't fight the policy. On the one subresource the policy doesn't cover, those two jobs leave a gap _and_ mute any signal that the gap exists.

## Why this class of bug is worse than a crash

A failed apply is a good day: loud, a stack trace, the pipeline stops. You fix it and move on.

This is the opposite. The apply succeeds, the plan is clean, the portal is green. Every dashboard you trust agrees the system is healthy — and the feature is dead. The only thing that knows the truth is a user clicking Connect.

The real lesson has nothing to do with AVD: **the most expensive outages are the ones your tooling reports as a success.** `ignore_changes`, DeployIfNotExists, any abstraction that mutes the noise of the common path buys that silence by spending your ability to see the uncommon path. A great trade most of the time. The day it isn't, you debug blind — you and your tools trained to ignore exactly where the problem lives.

## Getting out of it

Since `ignore_changes` blinds the normal apply, you force the change out of band:

```bash
terragrunt apply -replace='module.pe.azurerm_private_endpoint.this["this"]'
```

The `-replace` destroys and recreates the endpoint with the zone group in place from birth, so `ignore_changes` never gets a chance to hide it. You lose the endpoint's IP in the swap — acceptable here, but worth knowing before running it on something with a pinned IP. The one-shot alternative: create the zone group directly via `az` and let `ignore_changes` keep its hands off it afterwards.

A better-designed module would make `ignore_changes` conditional — manage the zone group when the block is present in config, ignore it when absent. Terraform doesn't support dynamic `ignore_changes`, so you can't express it natively. Which is the honest end of the story: this isn't a bug you patch once. It's a sharp edge in how policy-driven platforms and drift-suppressing modules compose, and it'll come back the next time a cloud provider ships a subresource before the policy meant to cover it.

## What to actually do differently

When a private-endpoint-heavy feature works in the portal but fails for users, drop the `plan` and drop the green: go check the data path by hand — does the zone group exist, do the records resolve, does the client get an answer. And whenever you set an `ignore_changes` or a DeployIfNotExists, write down somewhere — where a future you will look — _what that mechanism chose not to tell you._ That's the difference between a five-minute fix and two hours of blind debugging.
