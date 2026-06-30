---
title: "The AVM ALZ accelerator is solid. Here's what we add on top (and what we'd do differently)"
meta_title: ""
description: "A production retrospective on the Azure AVM ALZ accelerator: three adjustments we had to make (library pinning, retries, VMSS exclusions) and three things we'd do differently (state splitting, tests, centralised inventory)."
date: 2026-05-15T00:00:00Z
image: "/images/blog/avm-alz-accelerator-retex.png"
categories: ["Landing Zone"]
author: "Jonathan Aerts"
tags:
  [
    "azure",
    "terraform",
    "terragrunt",
    "alz",
    "avm",
    "infrastructure-as-code",
    "cloud-architecture",
  ]
draft: false
---

> **TL;DR.** The official `Azure/avm-ptn-alz/azurerm` module covers the essentials of an Azure Landing Zone correctly. Three things aren't in the box and cost us time: explicit pinning of the `alz`/`amba` libraries, retries on Azure eventual consistency, and excluding AKS node resource groups from the scope of VMSS policies. Three things in our current wrapper need to be redone: the Terraform state is monolithic, there are no automated tests, and the AKS inventory is hardcoded in the `terragrunt.hcl`.

_Published 15 May 2026._
_Stack used: Terraform `>= 1.5` · azurerm `~> 4.0` · azapi `~> 2.4` · alz `~> 0.19` · avm-ptn-alz/azurerm `0.13.0` · platform/alz `2025.02.0` · platform/amba `2025.05.0`._

---

## The friction

The AVM ALZ accelerator ([`Azure/terraform-azurerm-avm-ptn-alz`](https://github.com/Azure/terraform-azurerm-avm-ptn-alz)) saves weeks: management group hierarchy, subscription placement, ALZ DINE policySets, AMBA integration, Defender for Cloud integration, DDoS, Backup. It's solid, it's tested, it's maintained by Microsoft.

And yet, out of the box, it isn't enough. Three things break or drift in production:

- The first `apply` on a new hierarchy fails 1 time in 3 on `PolicyDefinitionNotFound` errors that are actually Azure eventual consistency.
- The `platform/alz` and `platform/amba` libraries resolve to the latest available version if you pin nothing, and a silent bump can add or remove policySet parameters between two pipeline runs.
- The Landing Zone archetype's VMSS policies (`ChangeTracking`, `Monitoring Agent`) also apply to AKS-managed VMSS in the node resource groups, where either the policy stays `NonCompliant` forever or the extension disrupts node bootstrap.

This post isn't a tutorial for wrapping. It's a retrospective on three adjustments we had to make on top of the module and three things we did less well.

---

## What the wrapper adds

### 1. Explicit pinning of the `alz` and `amba` libraries

**The problem.** Two months into operation, a policy assignment started drifting between `nprd` and `prod` without us touching the code. No commit, no PR, just drift detection lighting up on `Deploy-MDFC-Config-H224` (the Defender for Cloud initiative, updated half-yearly by Microsoft). Root cause: the `platform/amba` library had bumped at Microsoft between the two runs, and the `alz` provider consumed the latest available version by default. The parameter mapping had changed between the two versions.

**The fix.** Pin everything, everywhere:

```hcl
provider "alz" {
  library_overwrite_enabled = false
  library_references = [
    { path = "platform/alz",  ref = "2025.02.0" },
    { path = "platform/amba", ref = "2025.05.0" },
    { custom_url = "${path.root}/lib" },
  ]
}
```

`library_overwrite_enabled = false` keeps it deterministic — one library reference can't silently overwrite files from another (a conflict errors out instead of letting the last one win); the local `lib/` is still merged in additively. The `custom_url` points to a versioned `lib/` folder in the repo where we store our archetype overrides (`connectivity.alz_archetype_override.yaml`, `landing_zones.alz_archetype_override.yaml`, `platform.alz_archetype_override.yaml`) and the per-environment architecture definitions.

**The transferable lesson.** Pinning isn't a Terraform question, it's an audit question. As long as a dependency isn't fixed to a precise ref, you can't reproduce a past deployment. For a governance stack — where posture evolves through human decisions, not automatic bumps — it's non-negotiable.

### 2. Retries on Azure eventual consistency

**The problem.** First deployment on a fresh tenant. `terragrunt apply`, 6 minutes later:

```text
Error: PolicyDefinitionNotFound — The policy definition 'Deploy-MDFC-Config-H224' could not be found
Error: AuthorizationFailed — The client does not have authorization to perform action
'Microsoft.Authorization/policyAssignments/write' over scope '/providers/.../mg-lzr-prod'
```

The policy exists. The client has the rights. But Azure hasn't finished propagating the creation of the management groups and definitions by the time the provider tries to create the assignments. Re-running `terragrunt apply` manually 30 seconds later works. Doing that in a pipeline in the middle of an audit, much less so.

**The fix.** The `alz` provider exposes a `retries` block that automatically retries operations matching a regex. We wire it broadly:

```hcl
inputs = {
  retries = {
    policy_definitions = {
      error_message_regex = ["AuthorizationFailed", "PolicyDefinitionNotFound"]
    }
    policy_set_definitions = {
      error_message_regex = ["AuthorizationFailed", "PolicyDefinitionNotFound"]
    }
    policy_assignments = {
      error_message_regex = [
        "AuthorizationFailed",
        "PolicyAssignmentNotFound",
        "PolicyDefinitionNotFound"
      ]
    }
    policy_role_assignments = {
      error_message_regex = ["AuthorizationFailed", "RoleAssignmentNotFound"]
    }
  }
}
```

Since we added it, zero failures on fresh deployment. The wrapper becomes idempotent even on the first `apply`.

**The transferable lesson.** Eventual consistency is a platform trait, not a bug. Every time you deploy a governance resource that depends on another governance resource through the Azure control plane (policy on MG, RBAC on subscription, role assignment on managed identity), plan for explicit retries. If the provider exposes it, use it. Otherwise, retry at the pipeline level or via `local-exec`.

### 3. Excluding AKS node resource groups from the scope of VMSS policies

**The problem.** A new AKS cluster is deployed in a spoke. A few hours later, the nodes start showing `Extension installation failed` warnings, and the `Deploy-VMSS-MonitoringAgent` policy is marked `NonCompliant` on the node resource group (`MC_*` or equivalent). The cluster works but Defender and Container Insights no longer see anything correctly, because the VM agent tries to install on AKS-managed VMSS, which rejects it.

**The fix.** Pass a `not_scopes` list to the VMSS policies, targeting the AKS node RGs:

```hcl
inputs = {
  vmss_policy_not_scopes = [
    "/subscriptions/${include.root.locals.corp_subs.platform_api.id}/resourceGroups/rg-platform-api-${include.root.inputs.environment}-westeurope-aks-nodes",
  ]
}
```

On the wrapper side, those `not_scopes` are injected into `policy_assignments_to_modify` for the relevant assignments (`Deploy-VMSS-ChangeTracking`, `Deploy-VMSS-MonitoringAgent`).

**The transferable lesson.** Platform policies are designed for "classic" VMSS. Anything managed by an Azure service (AKS, AVS, Databricks…) has its own extension lifecycle and doesn't like having extensions pushed in from outside. Before enabling a `Deploy-VMSS-*` policy on a hierarchy that contains managed services, map the affected RGs and take them out of scope.

---

## What we'd do differently

I brainstormed seven candidates. Three are minor (hardcoded email, `try()` fallback, an unresolved TODO), two don't honestly apply to this module (sensitive variables, OIDC federation — already in place on the pipelines), one is too nuanced for this post (partial drift detection). The three below remain, sharing the same property: they'd have cost nothing to do right on day 1, and now cost a rework.

### 1. Monolithic Terraform state across the whole hierarchy

The current `AlzArchitecture` module produces, for one environment, **a single state** that contains:

- the full management group hierarchy,
- the subscription placements,
- all the policy definitions, policySets and ALZ DINE assignments,
- the AMBA assignments (baseline Prometheus alerts),
- the Defender for Cloud configuration (12 plans),
- the Backup and DDoS assignments.

Direct consequence: a `terragrunt plan` on this folder takes between 4 and 8 minutes. The state lock blocks any other operation on this perimeter during that time. And above all, any change — even a contact email change — goes through an `apply` that potentially touches all 200+ resources in the state.

The blast radius is enormous relative to the real lifecycle: management groups move once a year, ALZ policySets once a quarter when we bump the library, AMBA assignments every week because that's where we tune thresholds.

**The rework.** Split into at least three states:

- `alz-hierarchy`: MGs + subscription placement only. Near-immutable.
- `alz-policies`: ALZ DINE policySets + Defender + DDoS + Backup. Quarterly bumps.
- `alz-amba`: AMBA assignments and alert tuning. Frequent changes.

The downstream states consume `alz-hierarchy`'s outputs (MG IDs, assignment identities) via Terragrunt `dependency` blocks, not via direct `terraform_remote_state` — to keep coupling to a single mechanism and avoid a downstream reading a state it isn't allowed to read if we move the storage backend.

**The transferable lesson.** State splitting isn't a technical detail, it's an architecture decision. The rule we now try to apply: _one state per lifecycle × criticality_. Putting a resource that changes 50 times a year and one that changes once a year in the same state is condemning yourself to long `plan`s and reviews that mix the operational with the structural.

### 2. No automated tests on the wrapper

The wrapper has `terraform validate` in CI, and that's it. No `terraform test`, no conftest, no terratest, not even an output-presence test.

Consequence: when the upstream AVM module bumped from `0.12.x` to `0.13.0`, the signature of some outputs changed slightly (a key was renamed in `policy_assignment_identity_ids`). Our `terraform validate` passed. The `terragrunt plan` on the nprd environment passed too because the mocks didn't reflect the new structure. It was only when a downstream module tried to consume the output that the breakage appeared, mid-`apply`.

**The rework.** At minimum a `tests/wrapper.tftest.hcl` file that:

- checks the presence and type of each output (`output "management_group_ids" { value = ... }` must remain a non-empty `map(string)`),
- checks that `policy_assignments_to_modify` actually receives the expected parameters for each targeted MG,
- validates a few `defender_plans` scenarios (all enabled / all disabled / mix).

These tests run as `terraform test -plan-only`, deploy nothing, take 30 seconds, and would have caught the upstream output rename before we hit it in prod.

**What these tests don't cover.** They validate the _shape_ of the wrapper, not the _substance_ of policy behaviour. A `DeployIfNotExists` policy that passes the signature test may well stop deploying what it's supposed to after a library bump — typically because a parameter was renamed or a condition changed in the upstream policySet. Validating that requires an integration test on a dedicated sandbox subscription, which creates a target resource and verifies remediation runs. That's another brick, out of scope for the wrapper, and a debt we're carrying for now.

**The transferable lesson.** `terraform validate` doesn't validate much. It's an augmented HCL parser. A wrapper that doesn't have at least a signature test is a blind proxy: every time the dependency it wraps bumps, you discover the behavioural changes downstream, not in CI.

### 3. The AKS inventory hardcoded for VMSS exclusions

The `vmss_policy_not_scopes` from the previous point is, today, frozen on **a single AKS cluster**:

```hcl
vmss_policy_not_scopes = [
  "/subscriptions/${include.root.locals.corp_subs.platform_api.id}/resourceGroups/rg-platform-api-${include.root.inputs.environment}-westeurope-aks-nodes",
]
```

The comment above it says, word for word: _"To add a new AKS, add an entry to the list"_. It's honest. It's also a foot-gun. The day a spoke team deploys an AKS without touching `alz-architecture`, the VMSS policy applies to the new cluster's nodes, and we're back to the bug from the previous section. The pipeline doesn't shout, the new AKS's `terragrunt plan` mentions nothing — you have to go read the Azure compliance report to understand.

**The rework.** Centralise the AKS inventory in a `_global/aks_inventory.hcl` file consumed by all modules that need it:

- `alz-architecture` for the VMSS policy `not_scopes`,
- `container-insights` for the list of clusters to monitor,
- `prometheus-collector` for the target DCRs,
- the alerts for the ARM scopes.

A single source of truth, a single thing to update, and each module derives what it needs.

**The transferable lesson.** If a piece of structural data lives in two places, it will never be in sync. The rule: _any list of resources that several modules consume must live in `_global/`_, and each module derives it. True for AKS, true for VNets, true for subscriptions, true for on-call contacts. The cost of centralising is low. The cost of desync is paid in incidents.

---

## Would I do the same again today?

**The wrapping: yes, without hesitation.** The wrapper was the right vehicle to materialise platform choices (Defender posture, tag conventions, scope exclusions) that have no place in a generic module. The pinning, the retries and the `not_scopes` are non-negotiable and wouldn't have fit anywhere else.

**The monolithic state and the absence of tests: no, not like that.** If I had to rebuild the chain tomorrow, I'd split the state in three from day 1 and write a minimal `wrapper.tftest.hcl` before the first PR. Those two decisions would have been near-free at the start and now cost a deliberate rework.

The AVM ALZ accelerator will keep evolving. So will our wrapper. The difference between a wrapper that ages well and a wrapper that becomes debt is the rigour of pinning, the presence of tests, and the splitting of blast radius. These three fixes aren't ALZ-specific — they apply to any Terraform wrapper at scale. What's ALZ-specific is the cost of ignoring them: a governance hierarchy that drifts silently is an audit problem, not an infra problem.

---

## Going further

- AVM ALZ accelerator module: <https://github.com/Azure/terraform-azurerm-avm-ptn-alz>
- `alz` provider: <https://registry.terraform.io/providers/Azure/alz>
- Azure Monitor Baseline Alerts (AMBA): <https://github.com/Azure/azure-monitor-baseline-alerts>
- Official ALZ Terraform docs: <https://azure.github.io/Azure-Landing-Zones/>
