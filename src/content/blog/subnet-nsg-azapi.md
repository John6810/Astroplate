---
title: "SubnetWithNsg: How Azure Policy Deny Forced Me to Use azapi"
meta_title: ""
description: "How Azure Landing Zone Deny policies block standard Terraform subnet creation, and why azapi_resource is the only reliable fix for atomic subnet + NSG deployment."
date: 2026-04-05T00:00:00Z
image: "/images/blog/subnet-nsg-azapi.png"
categories: ["Networking"]
author: "Jonathan Aerts"
tags: ["azure-policy", "azapi", "terraform", "subnet", "nsg", "landing-zone"]
draft: false
---

## The Problem

Every production Azure Landing Zone deploys a Deny policy: **"Subnets must have a Network Security Group."** It is a security best practice — no subnet should exist without an NSG controlling its traffic. Microsoft recommends Deny (not Audit) for production landing zones, and for good reason.

But this policy creates a real problem for Terraform. The standard `azurerm` approach creates the subnet _first_, then associates the NSG in a separate step:

```hcl
resource "azurerm_subnet" "this" {
  name                 = "snet-api-prod-gwc-nodes"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = ["10.238.1.0/24"]
}

resource "azurerm_subnet_network_security_group_association" "this" {
  subnet_id                 = azurerm_subnet.this.id
  network_security_group_id = azurerm_network_security_group.this.id
}
```

This looks correct. It _is_ correct, logically. But Azure Policy does not evaluate the final desired state — it evaluates each ARM API call individually. Here is what actually happens at the API level:

```hcl
# Step 1: PUT Microsoft.Network/virtualNetworks/subnets
# -> Subnet created WITHOUT NSG
# -> Azure Policy evaluates: "Does this subnet have an NSG?" -> NO
# -> DENIED

# Step 2: Never reached
# PUT subnet/networkSecurityGroupAssociation
# -> Would have attached the NSG, but step 1 already failed
```

The subnet is created without an NSG. The policy evaluates. The policy denies. Terraform fails with a clear error message: `RequestDisallowedByPolicy`. The fix, however, is not obvious.

> **The Error You'll See**
>
> `Error: creating Subnet: performing CreateOrUpdate: unexpected status 403 with error: RequestDisallowedByPolicy: Resource was disallowed by policy. Policy: "Subnets should have a Network Security Group"`

## Why azurerm Can't Fix This

Your first instinct might be to look for an `nsg_id` argument on `azurerm_subnet`. It does not exist. It was [removed in azurerm v3](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/3.0-upgrade-guide) and never came back.

This is not an oversight. The `azurerm` provider separates the NSG association into its own resource (`azurerm_subnet_network_security_group_association`) by design. The provider makes two separate PUT calls to the ARM API — one for the subnet, one for the association. There is no way to make it send a single atomic request.

- **No inline NSG support** — `azurerm_subnet` has no `network_security_group_id` argument
- **Separate resource by design** — the association is a distinct lifecycle object in azurerm
- **Two API calls, always** — the provider cannot combine them into one PUT
- **No plan to change this** — the HashiCorp team has confirmed this is intentional architecture

If your landing zone uses Audit instead of Deny, you will never hit this problem. The subnet gets created, the policy logs a warning, the NSG gets associated, and the warning clears. But Audit is not enough for production — it only reports non-compliance, it does not prevent it.

## The azapi Solution

The `azapi` provider lets you send raw ARM API calls directly. Instead of two resources, you send a **single PUT** to `Microsoft.Network/virtualNetworks/subnets` with the NSG, route table, delegations, and all properties included in one request body.

The policy evaluates _after_ the full resource is created — and it sees a subnet with an NSG attached. No denial.

```hcl
resource "azapi_resource" "subnet" {
  for_each = { for s in var.subnets : s.name => s }

  type      = "Microsoft.Network/virtualNetworks/subnets@2025-03-01"
  name      = each.value.name
  parent_id = var.virtual_network_id

  body = {
    properties = {
      addressPrefixes = each.value.address_prefixes
      networkSecurityGroup = each.value.nsg_id != null ? {
        id = each.value.nsg_id
      } : null
      routeTable = each.value.route_table_id != null ? {
        id = each.value.route_table_id
      } : null
      defaultOutboundAccess = each.value.default_outbound_access_enabled
      delegations = each.value.delegation != null ? [
        {
          name = each.value.delegation.name
          properties = {
            serviceName = each.value.delegation.service_name
          }
        }
      ] : []
    }
  }
}
```

One resource. One API call. NSG, route table, default outbound access, and delegations — all set atomically. The policy never sees a bare subnet.

> **Why This Works**
>
> ARM evaluates policy on the **final state** of the PUT request, not on intermediate steps. When the entire subnet definition — including `networkSecurityGroup.id` — is in the request body, the policy sees a compliant resource and allows it through.

## The Module

The `SubnetWithNsg` module wraps this pattern for easy consumption across the entire landing zone. Every subnet — in every spoke, in every environment — goes through this module.

The interface is a simple list of subnet objects:

```hcl
variable "subnets" {
  type = list(object({
    name                            = string
    address_prefixes                = list(string)
    nsg_id                          = optional(string)
    route_table_id                  = optional(string)
    default_outbound_access_enabled = optional(bool, false)
    delegation = optional(object({
      name         = string
      service_name = string
    }))
  }))
  nullable = false

  validation {
    condition = alltrue([
      for s in var.subnets : length(s.address_prefixes) >= 1
    ])
    error_message = "Each subnet must have at least one address prefix (a CIDR block, e.g. 10.0.1.0/24)."
  }

  validation {
    condition     = length(var.subnets) == length(distinct([for s in var.subnets : s.name]))
    error_message = "Each subnet name must be unique."
  }
}

variable "virtual_network_id" {
  type     = string
  nullable = false

  validation {
    condition = can(regex(
      "^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft\.Network/virtualNetworks/[^/]+$",
      var.virtual_network_id
    ))
    error_message = "virtual_network_id must be a valid Azure Virtual Network resource ID."
  }
}
```

The output is a map of subnet IDs keyed by name, making it easy for downstream modules to reference specific subnets:

```hcl
output "subnet_ids" {
  description = "Map of subnet name => subnet ID"
  value       = { for k, s in azapi_resource.subnet : k => s.id }
}
```

### Terragrunt Caller

In the landing zone, each spoke has a `subnet-{workload}` directory that calls the module. Here is a real example from the ApiManager workload:

```hcl
# Terragrunt caller example (subnet-api/terragrunt.hcl)
terraform {
  source = "${get_repo_root()}/modules/SubnetWithNsg"

  extra_arguments "sequential_subnets" {
    commands  = ["apply", "plan", "destroy"]
    arguments = ["-parallelism=1"]
  }
}

dependency "network_api" {
  config_path = "../network-api"
  mock_outputs = {
    id = "/subscriptions/00000000/resourceGroups/mock/providers/Microsoft.Network/virtualNetworks/mock-vnet"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan", "init"]
}

dependency "nsg_api" {
  config_path = "../nsg-api"
  mock_outputs = {
    ids = {
      "nodes"     = "/subscriptions/.../networkSecurityGroups/mock-nsg-nodes"
      "pods"      = "/subscriptions/.../networkSecurityGroups/mock-nsg-pods"
      "apiserver" = "/subscriptions/.../networkSecurityGroups/mock-nsg-apiserver"
    }
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan", "init"]
}

inputs = {
  virtual_network_id = dependency.network_api.outputs.id

  subnets = [
    {
      name           = "snet-api-prod-gwc-nodes"
      address_prefixes = ["10.238.1.0/24"]
      nsg_id         = dependency.nsg_api.outputs.ids["nodes"]
      route_table_id = dependency.rt_api.outputs.id
    },
    {
      name           = "snet-api-prod-gwc-pods"
      address_prefixes = ["10.238.2.0/22"]
      nsg_id         = dependency.nsg_api.outputs.ids["pods"]
      route_table_id = dependency.rt_api.outputs.id
    },
    {
      name           = "snet-api-prod-gwc-apiserver"
      address_prefixes = ["10.238.6.0/28"]
      nsg_id         = dependency.nsg_api.outputs.ids["apiserver"]
      route_table_id = dependency.rt_api.outputs.id
      delegation = {
        name         = "aks-apiserver"
        service_name = "Microsoft.ContainerService/managedClusters"
      }
    },
  ]
}
```

Note the `-parallelism=1` flag. Azure does not allow parallel subnet operations on the same VNet — the ARM API returns a conflict error if two subnet PUTs overlap. Terragrunt's `extra_arguments` block forces sequential execution.

## Validations

The module includes three validation rules that catch common mistakes before Terraform even reaches the plan stage:

- **Address prefix presence** — Every subnet must declare at least one `address_prefixes` entry (a CIDR block). In the full module this is an OR with an IPAM pool allocation. Catches subnets defined with no address range at all.
- **Unique subnet names** — The `for_each` key is the subnet name. Duplicate names would silently drop subnets. The validation compares `length(var.subnets)` against `length(distinct(names))` to catch duplicates early.
- **VNet resource ID format** — The `virtual_network_id` is validated against the full ARM resource ID pattern. Prevents accidentally passing a VNet name or a subnet ID instead of the parent VNet ID.

These validations run during `terraform validate` and `terragrunt validate`, which means CI/CD pipelines catch errors before any API call is made.

## Trade-offs

Using `azapi_resource` instead of `azurerm_subnet` comes with trade-offs. They are worth it, but you should know what you are signing up for:

- **State representation** — Terraform state shows `azapi_resource.subnet` instead of `azurerm_subnet.this`. Other modules referencing the subnet ID are unaffected (it is the same ARM resource ID), but state inspection is less intuitive.
- **No automatic drift detection on sub-properties** — `azapi` tracks the full body, but if someone manually changes only the NSG association outside of Terraform, drift detection depends on how `azapi` handles partial responses.
- **Import syntax** — If you need to import existing subnets, you use `azapi` import syntax (`terraform import azapi_resource.subnet[\"subnet-name\"] /subscriptions/.../subnets/subnet-name`) instead of the `azurerm` equivalent.
- **Provider dependency** — You need the `Azure/azapi` provider in addition to `hashicorp/azurerm`. One more provider to version-pin and update.

But the fundamental trade-off is simple: **it works with Azure Policy Deny**. The standard approach does not. Everything else is manageable.

## When You Need This

You need this module — or something like it — in exactly one scenario:

- **Your landing zone enforces "Subnets must have NSG" with Deny effect.** This is the Microsoft-recommended configuration for production landing zones. If your ALZ uses Deny, standard `azurerm_subnet` will fail on every subnet creation.

You do _not_ need this if:

- Your policy uses **Audit** instead of Deny — the standard two-step approach works fine, and you get a non-compliance warning that clears once the NSG is attached.
- You create subnets outside of Terraform (ClickOps, ARM templates, Bicep) — ARM templates and Bicep already send a single PUT with all properties.
- You create subnets before the policy is assigned — possible during initial bootstrapping, but not sustainable.

> If you are building an Azure Landing Zone with Terraform and your security team insists on Deny policies (they should), you will hit this problem. The azapi provider is the clean solution.

[View SubnetWithNsg on GitHub →](https://github.com/John6810/terraform-azurerm-modules/tree/main/SubnetWithNsg)
