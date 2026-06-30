---
title: "Why I Don't Use AVM Modules As-Is (And What I Do Instead)"
meta_title: ""
description: "How I adapted Azure Verified Modules patterns into 35 custom Terraform modules for an enterprise landing zone — and why using AVM directly wasn't an option with Terragrunt."
date: 2026-04-08T00:00:00Z
image: "/images/blog/why-not-avm-as-is.png"
categories: ["Landing Zone"]
author: "Jonathan Aerts"
tags: ["avm", "terraform", "azure", "terragrunt", "modules", "patterns"]
draft: false
---

## AVM Is Great — But Not For Everything

[Azure Verified Modules](https://azure.github.io/Azure-Verified-Modules/) are the gold standard for Terraform on Azure. Microsoft maintains them, they follow strict interface specs, and they cover an impressive range of resources. If you're starting a greenfield project with standard Terraform, AVM is where you should begin.

But AVM modules are designed for **broad reuse**. They need to support every possible configuration, every edge case, every optional feature. The AKS AVM module alone has hundreds of variables. When you control the entire stack — when you know your region, your naming convention, your security posture — that flexibility becomes overhead.

The real value of AVM isn't the modules themselves. It's the **patterns**: how they structure variables, handle role assignments, manage locks, expose outputs. Those patterns are battle-tested and transferable. You can take them and build focused, opinionated modules that fit your architecture exactly.

That's what I did. 35 custom modules, all aligned with AVM conventions, tailored to a production Azure Landing Zone at POST Luxembourg.

## The Terragrunt Problem

The decision to build custom modules wasn't purely philosophical — it was forced by a hard technical constraint.

Terragrunt copies only the referenced module folder into its `.terragrunt-cache` directory. If your module calls a child module with a relative path (`module "kv" { source = "../KeyVault" }`), that sibling folder doesn't exist in the cache. The plan fails with a "module not found" error.

This means **you can't compose modules** in the traditional Terraform way. A "stack" module that wraps a Resource Group + Key Vault + Private Endpoint can't call three child modules. It has to use resource blocks directly, duplicating the patterns from each individual module.

```hcl
# KeyVaultStack/main.tf — resources directly, no child modules
# Note: KeyVault/PrivateEndpoint/ResourceGroup modules cannot be
#       called as child modules because Terragrunt only copies
#       the module folder into its cache.

resource "azurerm_resource_group" "this" {
  name     = local.rg_name
  location = var.location
  tags     = local.common_tags
}

resource "azurerm_key_vault" "this" {
  name                = local.kv_name
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tenant_id           = coalesce(var.tenant_id, data.azurerm_client_config.current.tenant_id)
  sku_name            = var.sku_name

  purge_protection_enabled      = true
  public_network_access_enabled = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_private_endpoint" "this" {
  name                = local.pe_name
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  subnet_id           = var.subnet_id

  private_service_connection {
    name                           = "psc-${local.pe_name}"
    private_connection_resource_id = azurerm_key_vault.this.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  lifecycle {
    ignore_changes = [private_dns_zone_group]
  }
}
```

> **Why not use a monorepo module?**
>
> You could put everything in a single module folder and reference it, but that defeats the purpose of modular design. The Terragrunt approach means each deployment (`terragrunt.hcl`) points to exactly one module, and that module contains everything it needs. The trade-off is duplication in stack modules — but the patterns stay consistent.

## The 6 Patterns I Took From AVM

### 1. map(object) Instead of list(object)

This is the single most impactful pattern I adopted from AVM. With `list(object)`, Terraform creates `for_each` keys from index positions or values. If a value comes from another module's output (like a resource group ID), it's unknown at plan time. Terraform can't build the resource graph and the plan fails.

With `map(object)`, the keys are arbitrary strings that you control. They're always known at plan time, regardless of what the values resolve to.

**Before:**

```hcl
# Before: list(object) — breaks when values are unknown at plan time
variable "role_assignments" {
  type = list(object({
    scope                = string
    role_definition_name = string
    principal_id         = string
  }))
}

# Usage with list — index keys depend on values
role_assignments = [
  { scope = dependency.rg.outputs.id, role_definition_name = "Reader", principal_id = "..." }
]
```

**After:**

```hcl
# After: map(object) — keys are always known at plan time
variable "role_assignments" {
  type = map(object({
    role_definition_id_or_name = string
    principal_id               = string
    principal_type             = optional(string)
    condition                  = optional(string)
    condition_version          = optional(string)
    description                = optional(string)
  }))
  default  = {}
  nullable = false
}

# Usage with map — key "rg_reader" is always known
role_assignments = {
  rg_reader = {
    role_definition_id_or_name = "Reader"
    principal_id               = dependency.identity.outputs.principal_id
  }
}
```

12 modules were migrated from `list(object)` to `map(object)`. It was the biggest breaking change in the library, but every module that accepts collections now uses maps. Role assignments, routes, subnets, peerings — all maps with arbitrary string keys.

### 2. role_definition_id_or_name + strcontains()

AVM modules use a single `role_definition_id_or_name` field instead of two mutually exclusive fields (`role_definition_id` and `role_definition_name`). The module auto-detects which one you passed by checking if the value contains the Azure role definition resource path:

```hcl
locals {
  role_definition_resource_substring = "/providers/Microsoft.Authorization/roleDefinitions"
}

resource "azurerm_role_assignment" "this" {
  for_each = var.role_assignments

  scope        = each.value.scope
  principal_id = each.value.principal_id

  # Auto-detect: is it a role ID or a role name?
  role_definition_id = strcontains(
    lower(each.value.role_definition_id_or_name),
    lower(local.role_definition_resource_substring)
  ) ? each.value.role_definition_id_or_name : null

  role_definition_name = strcontains(
    lower(each.value.role_definition_id_or_name),
    lower(local.role_definition_resource_substring)
  ) ? null : each.value.role_definition_id_or_name
}
```

One field. No "you set both" or "you set neither" errors. The consumer passes `"Reader"` or a full role definition ID — the module figures it out. 7 modules use this pattern: `KeyVault`, `KeyVaultStack`, `ResourceGroup`, `RbacAssignments`, `Aks`, `ContainerRegistry`, and `StorageAccount`.

### 3. lock Variable

Every module that creates a lockable resource exposes the same `lock` variable — a standard object with `kind` (required) and `name` (optional):

```hcl
variable "lock" {
  type = object({
    kind = string
    name = optional(string)
  })
  default     = null
  description = "Management lock. kind = CanNotDelete or ReadOnly."

  validation {
    condition     = var.lock != null ? contains(["CanNotDelete", "ReadOnly"], var.lock.kind) : true
    error_message = "Lock kind must be CanNotDelete or ReadOnly."
  }
}

resource "azurerm_management_lock" "this" {
  count = var.lock != null ? 1 : 0

  lock_level = var.lock.kind
  name       = coalesce(var.lock.name, "lock-${var.lock.kind}")
  scope      = azurerm_resource_group.this.id
}
```

Two options: `CanNotDelete` (prevent accidental deletion) or `ReadOnly` (prevent any modification). The name auto-generates if you don't provide one. 8 modules gained lock support: `ResourceGroup`, `KeyVault`, `KeyVaultStack`, `Aks`, `ContainerRegistry`, `StorageAccount`, `Vnet`, and `RouteTable`.

### 4. nullable = false on Required Vars

In Terraform, a variable with no `default` is required — but the caller can still pass `null`. Without `nullable = false`, that `null` propagates silently through your module until it hits a resource argument that can't handle it, producing a cryptic error far from the source.

```hcl
variable "location" {
  type        = string
  description = "Azure region"
  nullable    = false     # <-- Catches null at plan time
}

variable "subscription_acronym" {
  type = string
  validation {
    condition     = can(regex("^[a-z]{2,5}$", var.subscription_acronym))
    error_message = "Must be 2-5 lowercase letters."
  }
}

variable "environment" {
  type = string
  validation {
    condition     = can(regex("^[a-z]{2,4}$", var.environment))
    error_message = "Must be 2-4 lowercase letters."
  }
}
```

With `nullable = false`, Terraform catches the `null` at plan time with a clear message: "The value of variable X cannot be null." Applied to all 35 modules on every variable that must have a value.

### 5. Validation Blocks Everywhere

Every module validates its inputs aggressively. Three categories:

- **Regex on naming vars** — `subscription_acronym` must be 2-5 lowercase letters, `environment` must be 2-4 lowercase letters, `region_code` must be 2-5 lowercase letters. Catches typos before they become misnamed resources.
- **Contains for enums** — SKU values, protocol types, access levels, lock kinds. No freeform strings where a finite set of values exists.
- **Cross-field validation** — The most powerful pattern. Example from `RouteTable`: if `next_hop_type` is `VirtualAppliance`, then `next_hop_in_ip_address` is required. And the reverse: if it's _not_ `VirtualAppliance`, the IP must be null.

```hcl
variable "routes" {
  type = map(object({
    name                   = string
    address_prefix         = string
    next_hop_type          = string
    next_hop_in_ip_address = optional(string)
  }))
  default  = {}
  nullable = false

  # Enum validation
  validation {
    condition = alltrue([
      for r in var.routes : contains(
        ["VirtualNetworkGateway", "VnetLocal", "Internet", "VirtualAppliance", "None"],
        r.next_hop_type
      )
    ])
    error_message = "next_hop_type must be one of the allowed values."
  }

  # Cross-field validation
  validation {
    condition = alltrue([
      for r in var.routes :
      r.next_hop_type != "VirtualAppliance" || r.next_hop_in_ip_address != null
    ])
    error_message = "next_hop_in_ip_address is required when next_hop_type is VirtualAppliance."
  }
}
```

The goal: every invalid configuration should fail at `terraform plan`, not at `terraform apply`. No waiting 10 minutes for an ARM deployment to tell you your SKU is wrong.

### 6. output "resource" (Complete Object)

Every module exposes the full primary resource as `output "resource"`. Instead of guessing which attributes consumers might need and creating individual outputs for each one, the complete object is available:

```hcl
output "resource" {
  description = "The complete Key Vault resource object"
  value       = azurerm_key_vault.this
}

# Consumer can access ANY attribute without module changes:
# module.keyvault.resource.vault_uri
# module.keyvault.resource.tenant_id
# module.keyvault.resource.id
```

This eliminates "add output X" pull requests. If a consumer needs `vault_uri`, it's already there. If they need `tenant_id` tomorrow, it's already there. The individual convenience outputs (`id`, `name`) still exist for readability, but `resource` is the escape hatch that prevents module churn.

## What I Didn't Take From AVM

AVM defines several interface specifications that I deliberately chose not to implement:

- **Telemetry (`enable_telemetry`)** — AVM modules send anonymous usage data to Microsoft. These are internal modules for a single organization. No tracking needed.
- **Diagnostic settings interface** — AVM embeds diagnostic settings inside each module. I built a separate `DiagnosticSettings` module. Decoupled, reusable, independently deployable.
- **Private endpoints interface** — Same approach. A standalone `PrivateEndpoint` module rather than embedding PE configuration in every resource module. Exception: stack modules like `KeyVaultStack` include PEs directly because they can't call child modules.
- **Managed identities interface** — Separate `ManagedIdentity` module. Identity creation and role assignment are distinct lifecycle concerns from the resource itself.
- **Customer managed key interface** — Inlined where needed (`KeyVaultStack`, `PaloCluster`) rather than standardized across all modules. Only two modules need CMK, so the abstraction doesn't pay for itself.

The principle: if AVM embeds a cross-cutting concern into every module, I extract it into a dedicated module instead. Less duplication, clearer ownership, independent deployment.

## The Security Defaults I Added

Every module ships with opinionated security defaults that go beyond what AVM provides. These aren't optional — they're the baseline:

| Default                                     | Modules                               | Why                                                                   |
| ------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `prevent_destroy = true`                    | KV, AKS, ACR, DDoS, Storage, Palo VMs | Accidental `terraform destroy` on these costs hours or money          |
| `ignore_changes = [private_dns_zone_group]` | All Private Endpoints                 | ALZ DINE policy manages DNS zone groups — Terraform must not fight it |
| `public_network_access_enabled = false`     | KV, ACR, Storage, AKS                 | Zero public endpoints by default                                      |
| `purge_protection_enabled = true`           | All Key Vaults                        | Irreversible once enabled, but required for CMK scenarios             |
| `rbac_authorization_enabled = true`         | All Key Vaults                        | RBAC over access policies — consistent with landing zone IAM model    |
| `soft_delete_retention_days = 90`           | All Key Vaults                        | Maximum retention for compliance                                      |

The pattern: **secure by default, override explicitly**. If you want public access, you set `public_network_access_enabled = true` and everyone in the code review knows exactly what's happening.

## Was It Worth It?

35 modules. All consistent. Every module follows the same structure: `version.tf`, `variables.tf`, `main.tf`, `output.tf`. Every module uses the same naming convention, the same validation patterns, the same output structure.

- **New module time:** 30 minutes following the pattern. Copy the skeleton, adapt the resource, add validations. The conventions are so established that the structure writes itself.
- **Breaking changes:** Controlled. The `list` → `map` migration was the biggest one, affecting 12 modules. It required updating every `terragrunt.hcl` that consumed those modules. But it was a one-time cost that eliminated an entire category of plan-time errors.
- **Review confidence:** The full library was reviewed by an Azure Architect and a Palo Alto Security Architect. No structural issues found. The consistency made review efficient — once you understand one module, you understand all 35.

> **The lesson**
>
> AVM is a reference architecture, not a dependency. Take the patterns that make your modules better — `map(object)`, `strcontains()`, `lock`, `nullable = false`, validation blocks, `output "resource"` — and leave the rest. Your modules should serve your landing zone, not the other way around.

The full module library is open source:

[View on GitHub →](https://github.com/John6810/terraform-azurerm-modules)
