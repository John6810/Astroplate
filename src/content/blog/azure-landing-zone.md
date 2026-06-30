---
title: "Building 35 Terraform Modules for an Azure Landing Zone"
meta_title: ""
description: "How I built an enterprise Azure Landing Zone from scratch with 35 custom Terraform modules aligned with Azure Verified Modules patterns, Palo Alto NVA, and Terragrunt."
date: 2026-04-15T00:00:00Z
image: "/images/blog/azure-landing-zone.png"
categories: ["Landing Zone"]
author: "Jonathan Aerts"
tags: ["terraform", "azure", "landing-zone", "terragrunt", "palo-alto", "avm"]
draft: false
---

## Why Build From Scratch?

When I started building our Azure Landing Zone at POST Luxembourg, the obvious question was: _why not just use the Azure Verified Modules (AVM) directly?_

Three reasons forced my hand:

- **Terragrunt cache limitation** — Terragrunt copies only the module folder into its cache. Child module calls (`module "kv" { source = "../KeyVault" }`) break because siblings aren't accessible. Stack modules like `KeyVaultStack` had to use resource blocks directly, duplicating patterns instead of composing modules.
- **Azure Policy Deny on subnets without NSG** — The standard `azurerm_subnet` + `azurerm_subnet_network_security_group_association` two-step approach is blocked by policy. I had to use `azapi_resource` to create subnet + NSG atomically in a single ARM API call.
- **AVM modules are massive** — The AVM AKS module alone has hundreds of variables. For a Landing Zone where you control the entire stack, custom modules with opinionated defaults (private by default, RBAC by default, purge protection by default) are faster to deploy and easier to maintain.

So I took the **patterns** from AVM — not the modules themselves — and built 35 focused modules tailored to our architecture.

## The Architecture

Hub-and-spoke with Palo Alto VM-Series as the Network Virtual Appliance (NVA). Two environments (prod/nprd) sharing the same subscriptions with IP isolation:

- **Prod:** `10.238.0.0/16` — workloads in the first 200 /24 blocks, platform in 200-255
- **Nprd:** `10.239.0.0/16` — same layout, different supernet
- **5 subscriptions:** Management, Connectivity, Identity, Security, ApiManager (first corporate workload)

Every spoke routes `0.0.0.0/0` through the Palo Alto ILB frontend IP via User Defined Routes. No resource has a public endpoint — Private Endpoints everywhere, Private DNS Zones managed by ALZ DINE policies.

> **Architecture Pattern**
>
> Spoke VNet → UDR (0.0.0.0/0) → Palo Alto ILB (HA ports) → VM-Series firewall → NAT Gateway (outbound) or trust interface (east-west)

## War Stories

### 1. Azure Policy Forced Me to Use azapi

Our ALZ deploys a Deny policy: "Subnets must have a Network Security Group". Sounds reasonable. But `azurerm_subnet` creates the subnet first, _then_ `azurerm_subnet_network_security_group_association` attaches the NSG. Between those two API calls, the policy fires and blocks the creation.

The fix: use `azapi_resource` to create the subnet with the NSG attached in a **single ARM PUT**:

```hcl
resource "azapi_resource" "subnet" {
  type      = "Microsoft.Network/virtualNetworks/subnets@2025-03-01"
  name      = each.value.name
  parent_id = var.virtual_network_id

  body = {
    properties = {
      addressPrefix = each.value.address_prefix
      networkSecurityGroup = {
        id = each.value.nsg_id
      }
      routeTable = {
        id = each.value.route_table_id
      }
    }
  }
}
```

The `SubnetWithNsg` module wraps this pattern. Every subnet in the landing zone goes through it.

### 2. KMS v2 Doesn't Work in azurerm v4

AKS supports KMS v2 for etcd encryption with a Key Vault key. But when combined with API Server VNet Integration, `azurerm` v4 [doesn't support the full configuration](https://github.com/hashicorp/terraform-provider-azurerm/issues/27640).

The solution: create the AKS cluster via Terraform, then enable KMS + VNet Integration via `az aks update` post-creation. The lifecycle block protects the settings from drift:

```hcl
lifecycle {
  ignore_changes = [
    api_server_access_profile,
    key_management_service,
  ]
}
```

Not elegant, but it works. And it's documented directly in the module comments so the next person understands _why_.

### 3. The Bootstrap That Silently Failed

Palo Alto VM-Series firewalls bootstrap their configuration from an Azure Storage File Share. The `custom_data` passes the storage account reference:

```hcl
storage-account=mystorageacct;access-key=xxx;file-share=bootstrap
```

My initial implementation passed the **ARM resource ID** (`/subscriptions/.../storageAccounts/mystorageacct`) instead of the **account name**. PAN-OS doesn't validate the format — it just silently fails to connect and boots without configuration. The firewall comes up, looks healthy, but has no policies.

Caught it during testing. Fixed the variable from `bootstrap_storage_account_id` to `bootstrap_storage_account_name`. Also switched the separator from `\n` to `;` to match the official Palo Alto reference architecture.

### 4. 50% Throughput Boost: One Boolean

After deploying the Palo Alto cluster, throughput tests were disappointing. The fix: **one line of code**.

```hcl
accelerated_networking_enabled = true  # on untrust + trust NICs
```

The official Palo Alto module enables accelerated networking on all dataplane interfaces by default. It enables DPDK mode in PAN-OS, which bypasses the Azure virtual switch and gives the firewall direct access to the physical NIC. The management NIC must _not_ have it — explicitly set to `false`.

## AVM Patterns That Actually Matter

After aligning all 35 modules with Azure Verified Modules patterns, here are the ones that made a real difference:

### map(object) instead of list(object)

This is the single most impactful pattern change. With `list(object)`, Terraform builds `for_each` keys from values — which can be unknown at plan time. With `map(object)` and arbitrary string keys, the keys are always known:

```hcl
# Before (breaks if scope is unknown at plan)
role_assignments = [
  { scope = dependency.rg.outputs.id, role_definition_name = "Reader" }
]

# After (key "rg_reader" is always known)
role_assignments = {
  rg_reader = {
    role_definition_id_or_name = "Reader"
    scope                      = dependency.rg.outputs.id
  }
}
```

### role_definition_id_or_name + strcontains()

AVM unifies `role_definition_id` and `role_definition_name` into a single field. The module auto-detects which one you passed:

```hcl
role_definition_id   = strcontains(lower(each.value.role_definition_id_or_name),
  lower("/providers/Microsoft.Authorization/roleDefinitions"))
  ? each.value.role_definition_id_or_name : null

role_definition_name = strcontains(...)
  ? null : each.value.role_definition_id_or_name
```

One field instead of two mutually exclusive ones. Simpler interface, fewer validation errors.

### prevent_destroy on everything that matters

Every resource that would cause significant damage if accidentally destroyed gets `lifecycle { prevent_destroy = true }`:

- Key Vaults (secrets, CMK keys)
- AKS clusters (workloads, persistent volumes — hours to recreate)
- Container Registry (all container images)
- DDoS Protection Plan (~€2,944/month)
- Storage Accounts (state files, backups, FinOps data)
- Palo Alto VMs + their KV + encryption keys

### Private Endpoint lifecycle ignore

Every module with a Private Endpoint has this:

```hcl
lifecycle {
  ignore_changes = [private_dns_zone_group]
}
```

ALZ deploys a DINE policy that automatically creates a DNS zone group on every Private Endpoint. If Terraform manages it too, they fight. The `ignore_changes` lets both coexist.

## The Result

35 modules. Zero public endpoints. Dual environment. Every module validated with regex on naming vars, `nullable = false` on required inputs, `output "resource"` for the complete object. Reviewed by two independent experts (Azure Architect + Palo Alto Security Architect) — all critical and high findings resolved.

The full module library is open source:

[View on GitHub →](https://github.com/John6810/terraform-azurerm-modules)

> This isn't a PoC or a lab project. It's a production landing zone for a national telecom operator, built to run real workloads behind real firewalls with real compliance requirements.
