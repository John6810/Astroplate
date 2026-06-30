---
title: "Azure Landing Zone with Palo Alto NVA: Lessons Learned"
meta_title: ""
description: "Hard-won lessons from deploying Palo Alto VM-Series as NVA in an Azure Landing Zone: accelerated networking, ILB HA ports, bootstrap pitfalls, security hardening, and monitoring."
date: 2026-04-12T00:00:00Z
image: "/images/blog/palo-alto-nva-lessons.png"
categories: ["Networking"]
author: "Jonathan Aerts"
tags: ["palo-alto", "azure", "nva", "ilb", "terraform", "landing-zone"]
draft: false
---

Deploying Palo Alto VM-Series as a Network Virtual Appliance in an Azure Landing Zone sounds straightforward — until you actually do it. This article covers the hard-won lessons from building the firewall layer of a production landing zone: the NIC configuration that unlocks 50% more throughput, the ILB setup that prevents routing loops, the bootstrap format that silently fails if you get it wrong, and the security hardening that goes beyond the defaults.

## The Transit VNet Architecture

The firewall layer follows a **hub-and-spoke transit VNet** model with Palo Alto VM-Series as the NVA. The design is based on the official [vmseries_transit_vnet_dedicated_vwan](https://github.com/PaloAltoNetworks/terraform-azurerm-swfw-modules/tree/main/examples/vmseries_transit_vnet_dedicated_vwan) reference architecture from Palo Alto Networks.

Key design decisions:

- **Fixed instances, no VMSS** — Two VM-Series firewalls behind an Internal Load Balancer. We use BYOL (Bring Your Own License) licensing, which doesn't support VMSS autoscale. Two instances give us active/active HA without the complexity of VMSS lifecycle management.
- **3 NICs per firewall** — Management (for PAN-OS admin access), untrust (internet-facing, behind NAT Gateway for outbound), and trust (internal, receives all spoke traffic via the ILB).
- **ILB with HA ports on trust subnet** — Every spoke's UDR sends `0.0.0.0/0` to the ILB frontend IP. The ILB distributes across both firewall trust interfaces.

> **Traffic Flow**
>
> Spoke VM → UDR (0.0.0.0/0 → ILB frontend) → ILB HA ports → FW trust NIC → PAN-OS policy decision → FW untrust NIC → NAT Gateway (internet) or trust NIC (east-west to another spoke)

## Getting Accelerated Networking Right

After the initial deployment, throughput tests were disappointing. The fix was a single boolean — but _which_ NIC gets it matters enormously.

- **Management NIC:** `accelerated_networking_enabled = false`, `ip_forwarding_enabled = false`. This must be explicit — don't rely on defaults. The management interface handles PAN-OS admin traffic only and must not use DPDK mode.
- **Dataplane NICs (trust + untrust):** `accelerated_networking_enabled = true`, `ip_forwarding_enabled = true`. This enables DPDK mode in PAN-OS, which bypasses the Azure virtual switch and gives the firewall direct access to the physical NIC's SR-IOV virtual function.

The result: **~50% throughput improvement** on a single boolean change. The official Palo Alto Terraform module does this correctly by default. If you build your own module (as I did for Terragrunt compatibility), don't forget.

```hcl
resource "azurerm_network_interface" "management" {
  name                           = "nic-${var.name}-mgmt"
  location                       = var.location
  resource_group_name            = var.resource_group_name
  accelerated_networking_enabled = false
  ip_forwarding_enabled          = false

  ip_configuration {
    name                          = "internal"
    subnet_id                     = var.management_subnet_id
    private_ip_address_allocation = "Static"
    private_ip_address            = var.management_private_ip
  }
}

resource "azurerm_network_interface" "dataplane" {
  for_each                       = var.dataplane_nics
  name                           = "nic-${var.name}-${each.key}"
  location                       = var.location
  resource_group_name            = var.resource_group_name
  accelerated_networking_enabled = true
  ip_forwarding_enabled          = true

  ip_configuration {
    name                          = "internal"
    subnet_id                     = each.value.subnet_id
    private_ip_address_allocation = "Static"
    private_ip_address            = each.value.private_ip
  }
}
```

Notice the explicit split: management gets `false/false`, dataplane gets `true/true`. No ambiguity, no defaults to guess about.

## The ILB HA Ports Configuration

The Internal Load Balancer on the trust subnet is the linchpin of the architecture. Every spoke's traffic flows through it. Getting the configuration wrong means either dropped packets or routing loops.

### The LB Rule

HA ports means `protocol = "All"` with `frontend_port = 0` and `backend_port = 0`. This forwards all protocols and all ports to the backend pool — exactly what you need for an NVA that inspects everything.

```hcl
resource "azurerm_lb_rule" "ha_ports" {
  name                           = "rule-ha-ports"
  loadbalancer_id                = azurerm_lb.trust.id
  protocol                       = "All"
  frontend_port                  = 0
  backend_port                   = 0
  frontend_ip_configuration_name = "trust-frontend"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.trust.id]
  probe_id                       = azurerm_lb_probe.trust.id
  floating_ip_enabled            = false
  enable_tcp_reset               = true
}

resource "azurerm_lb_probe" "trust" {
  name                = "probe-tcp-443"
  loadbalancer_id     = azurerm_lb.trust.id
  protocol            = "Tcp"
  port                = 443
  interval_in_seconds = 5
  probe_threshold     = 2
}
```

Two details that are easy to get wrong:

- **`floating_ip_enabled = false`** — For the outbound/east-west (OBEW) load balancer pair, floating IP must be disabled. With floating IP enabled, the firewall would see the ILB frontend IP as the destination instead of the real destination, breaking its routing decisions.
- **Health probe: TCP/443 with `probe_threshold = 2`** — PAN-OS exposes its management interface on 443. Two consecutive failures (at 5-second intervals) before marking a backend unhealthy gives PAN-OS enough time to handle brief control plane hiccups without triggering a failover.

### The Blackhole Routes

This is where most transit VNet deployments go wrong. Without blackhole routes, you get routing loops:

```hcl
resource "azurerm_route" "trust_blackhole" {
  name                = "blackhole-default"
  resource_group_name = var.resource_group_name
  route_table_name    = azurerm_route_table.trust.name
  address_prefix      = "0.0.0.0/0"
  next_hop_type       = "None"
}

resource "azurerm_route" "untrust_blackhole_rfc1918_10" {
  name                = "blackhole-10"
  resource_group_name = var.resource_group_name
  route_table_name    = azurerm_route_table.untrust.name
  address_prefix      = "10.0.0.0/8"
  next_hop_type       = "None"
}
```

- **Trust subnet:** needs a `0.0.0.0/0 → None` blackhole. Without it, traffic from the firewall's trust NIC that doesn't match a more specific route would hit the default system route and go back to the ILB — creating an infinite loop.
- **Untrust subnet:** needs blackhole routes for RFC 1918 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). Without these, return traffic for private IPs would leak to the internet path instead of going back through the firewall.

## Bootstrap: The Silent Failure

Palo Alto VM-Series firewalls bootstrap their configuration from an Azure Storage File Share. The `custom_data` field passes the storage account reference. Get the format wrong and PAN-OS boots without configuration — no error, no log, just a firewall with no policies.

```hcl
storage-account=mystorageacct;access-key=xxx;file-share=bootstrap;share-directory=config
```

Four things I learned the hard way:

- **Storage account NAME, not ARM resource ID** — PAN-OS expects `mystorageacct`, not `/subscriptions/.../storageAccounts/mystorageacct`. It doesn't validate the format. If you pass the wrong thing, it silently fails to connect and boots with factory defaults.
- **Semicolon separator, not newline** — The key-value pairs are separated by `;`. Using `\n` or any other delimiter causes a silent parse failure.
- **Access key in custom_data** — This follows the same pattern as the official Palo Alto reference architecture. The access key is passed directly in the VM's `custom_data` field, base64-encoded by Azure.
- **`share-directory` for multi-config bootstraps** — If you store multiple firewall configurations in the same file share (one directory per instance), use the `share-directory` parameter to point each VM to its own config directory.

> **Debugging Tip**
>
> If the firewall boots but has no policies, check bootstrap first. Connect to the management interface and run `show system bootstrap status` in the PAN-OS CLI. If it says "Bootstrap not attempted", the custom_data format is wrong.

## Security Hardening

Firewalls are the most critical resources in the landing zone. If they're compromised, everything behind them is exposed. The hardening goes well beyond the Azure defaults.

```hcl
resource "azurerm_linux_virtual_machine" "fw" {
  # ...
  allow_extension_operations         = false
  disable_password_authentication    = var.admin_ssh_public_key != null ? true : false
  encryption_at_host_enabled         = true
  vtpm_enabled                       = true
  secure_boot_enabled                = true

  os_disk {
    disk_encryption_set_id = azurerm_disk_encryption_set.fw.id
    # ...
  }

  lifecycle {
    prevent_destroy = true
  }
}
```

### VM-Level Hardening

- **`allow_extension_operations = false`** — Disables the Azure VM agent's ability to install extensions. This is official Palo Alto best practice: no extensions should run on a security appliance.
- **Dynamic password authentication** — If an SSH public key is provided, password authentication is disabled automatically. If not, a random password is generated and stored in Key Vault.
- **CMK double encryption** — OS disk is encrypted with both platform-managed keys and a customer-managed key via a Disk Encryption Set. The CMK lives in a dedicated Key Vault with RBAC authorization and purge protection.
- **`prevent_destroy` on VMs** — A `terragrunt destroy` or accidental resource removal in code won't delete the firewalls. You'd have to explicitly remove the lifecycle block first — a deliberate, reviewable change.

### Key Vault Hardening

The firewall Key Vault stores the admin password, the CMK encryption key, and the bootstrap access key. It gets the full treatment:

```hcl
resource "azurerm_key_vault" "fw" {
  name                       = "kv-${var.subscription_acronym}-${var.environment}-${var.region_code}-fw"
  location                   = var.location
  resource_group_name        = var.resource_group_name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "premium"
  enable_rbac_authorization  = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 90

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }

  lifecycle {
    prevent_destroy = true
  }
}
```

- **Premium SKU** — Required for HSM-backed keys (used by the Disk Encryption Set).
- **RBAC authorization** — No access policies. All access is through Entra ID role assignments, auditable and revocable.
- **90-day soft delete + purge protection** — Even if someone deletes a key, it's recoverable for 90 days and can't be purged.
- **Network ACLs: Deny + AzureServices bypass** — Only Azure-internal services (like the Disk Encryption Set) can reach the vault. No public access.
- **`prevent_destroy`** — Same protection as the VMs. Losing the Key Vault means losing the CMK, which means losing access to the encrypted disks.

## Monitoring with Application Insights

Each firewall instance gets its own Application Insights resource. PAN-OS can push metrics (session counts, throughput, threat logs) to APPI via a Service Principal.

```hcl
resource "azurerm_application_insights" "fw" {
  for_each            = var.firewall_instances
  name                = "appi-${var.subscription_acronym}-${var.environment}-${var.region_code}-${each.key}"
  location            = var.location
  resource_group_name = var.resource_group_name
  application_type    = "other"
  workspace_id        = var.log_analytics_workspace_id
}
```

The SPN that PAN-OS uses to push metrics gets a **custom least-privilege role** instead of a built-in role. Built-in roles like "Monitoring Metrics Publisher" include permissions the firewall doesn't need. The custom role is scoped to the subscription:

```hcl
resource "azurerm_role_definition" "panos_metrics" {
  name  = "${local.prefix}-${var.workload}-panos-metrics"
  scope = data.azurerm_subscription.current.id

  permissions {
    actions = [
      "Microsoft.Insights/Metrics/Read",
      "Microsoft.Insights/MetricDefinitions/Read",
    ]
  }

  assignable_scopes = [data.azurerm_subscription.current.id]
}
```

Notice the role name includes `${local.prefix}-${var.workload}`. This prevents naming collisions between prod and nprd, which share the same subscription. Without the environment-specific prefix, Terraform would try to create two custom roles with the same name and fail.

## What I'd Do Differently

After deploying this architecture across two environments, here are the things I'd change if I started over:

- **Pin the PAN-OS image version from day 1** — We initially used `latest` for the marketplace image, which meant the image could change between plan and apply, or between the two firewall instances. For firewalls, deterministic deployments are non-negotiable. Pin the exact version (e.g., `10.2.9`) and upgrade deliberately.
- **Enable boot diagnostics immediately** — Boot diagnostics capture the serial console output, which is invaluable when PAN-OS fails to bootstrap. We added it after the first bootstrap debugging session. It should have been there from the start.
- **Create trust/untrust route tables before the VNet, not after** — The route tables with their blackhole routes need to exist before any subnet is created. In our deployment order, we created the VNet first and the route tables second, which meant there was a brief window where the subnets had no blackhole routes. Not a security issue in practice (no traffic was flowing yet), but it's cleaner to have the route tables at Tier 1 alongside NSGs.
- **Automate the PAN-OS initial commit** — After bootstrap, PAN-OS loads the configuration but doesn't commit it. The first commit has to be done manually through the web UI or API. A post-deployment script that hits the PAN-OS XML API to trigger a commit would save 10 minutes per firewall per deployment.

> The firewall is the last line of defense. Every shortcut you take in its deployment is a shortcut an attacker might exploit. Build it right the first time — there's no "we'll harden it later" for the component that protects everything else.

## The Full Module

The Palo Alto VM-Series module is part of the open-source `terraform-azurerm-modules` library that powers this landing zone. It includes the NIC configuration, ILB setup, bootstrap, Key Vault integration, Application Insights, and all the hardening described in this article.

[View on GitHub →](https://github.com/John6810/terraform-azurerm-modules)
