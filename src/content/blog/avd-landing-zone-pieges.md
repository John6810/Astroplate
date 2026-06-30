---
title: "Azure Virtual Desktop in a regulated Landing Zone: the traps no doc tells you about"
meta_title: ""
description: "A field report on a private AVD deployment in an Azure Landing Zone: control-plane region split, the global PE for rdweb, Entra Kerberos, Entra-joined RDP auth, scaling plan RBAC and FSLogix cost. The non-obvious learnings, not the RTFM."
date: 2026-06-20T00:00:00Z
image: "/images/blog/avd-landing-zone-pieges.png"
categories: ["Azure Virtual Desktop"]
author: "Jonathan Aerts"
tags:
  [
    "azure",
    "avd",
    "azure-virtual-desktop",
    "terraform",
    "terragrunt",
    "fslogix",
    "entra-id",
    "private-endpoint",
    "landing-zone",
  ]
draft: false
---

> **TL;DR.** Deploying Azure Virtual Desktop **fully private** in a Landing Zone (Private Endpoints everywhere, Palo Alto NVA for egress, centralised DNS) works very well — once you know about a dozen traps that are written nowhere clearly. The control plane necessarily lives in a different region from the session hosts. `rdweb.wvd.microsoft.com` doesn't resolve without a dedicated `global` Private Endpoint. Entra Kerberos has a race condition on the first apply. Entra-joined session hosts silently refuse legacy RDP auth. And 70% of the cost of a POC is FSLogix Premium storage, not compute.

_Published 20 June 2026._
_Stack: Terraform · Terragrunt · azurerm `~> 4.0` · azapi · Windows 11 25H2 multi-session (M365 Apps) · FSLogix + Azure Files Premium ZRS (Entra Kerberos) · regions `germanywestcentral` (data plane) + `westeurope` (control plane)._

---

## The context

AVD deployed in a spoke of an Azure Landing Zone, for compliant virtual desktops:

- **Control plane** (host pool, workspaces, application group, scaling plan) in `westeurope`.
- **Data plane** (Win11 multi-session session hosts, FSLogix, Key Vault) in `germanywestcentral`.
- **Zero public endpoint**: Private Endpoints on the workspace (feed + global), the host pool (connection), Azure Files (FSLogix) and the Key Vault.
- Session host Internet egress via UDR `0.0.0.0/0` → Palo Alto NVA. Private DNS zones centralised in the hub, wired by the ALZ DINE policies.
- User profiles on **FSLogix** (VHDX containers) with **Entra Kerberos** authentication on Azure Files Premium ZRS.

What follows isn't a tutorial. These are the non-obvious learnings — the ones that cost you hours and that you won't find by searching the error in a search engine.

---

## Network & control plane

### The control plane necessarily lives in a different region from the session hosts

For a deployment in `germanywestcentral`, the AVD control plane (host pool, workspace, app group, scaling plan) **must** live in `westeurope` — the nearest supported region. The session hosts, FSLogix and the PEs stay in GWC.

This isn't a performance compromise: the control plane is only metadata. The data plane (RDP sessions, profiles) never crosses the regional boundary. But it forces you to:

- Split the naming (`-gwc-` vs `-weu-`) by component.
- Override `location` + `region_code` in the Terragrunt units of the control-plane components.
- Accept that one resource group hosts WEU resources in a subscription declared "primary" in GWC.

Takeaway: **a subscription has no primary region** — each resource group has its own. Counter-intuitive, but perfectly valid on the Azure side.

### `rdweb.wvd.microsoft.com` doesn't resolve without the `global` PE

This is trap #1 that breaks the final UX. Everything else is OK (workspace, host pool, user RBAC), but the Windows App client shows **"No devices or apps found"** because the _initial feed discovery_ fails.

The hub's Private DNS Resolver resolves the `privatelink.*` zones and forwards the rest. But with a VPN NRPT that catch-alls `.` to the Palo's DNS proxy, `rdweb.wvd.microsoft.com` requests (a **public** Microsoft record) can be blocked or not forwarded depending on the firewall config.

The solution is architectural: deploy a **Private Endpoint for the `global` subresource** on a **dedicated workspace** (you must not attach application groups to it, or you break the whole tenant). Microsoft then CNAMEs `rdweb.wvd.microsoft.com` → a private record in `privatelink-global.wvd.microsoft.com`. Everything stays private.

Careful: this `global` workspace is a **tenant-wide singleton** — a single global PE for the whole AVD fleet. If there are other AVD deployments elsewhere in the tenant, you have to coordinate.

### DINE policies only cover the standard subresources

The ALZ `Deploy-Private-DNS-*` policies auto-wire the `feed` and `connection` subresources into the `privatelink.wvd.microsoft.com` zone (a `deployedByPolicy` group appears on its own on the PE).

But the `global` subresource (zone `privatelink-global.wvd.microsoft.com`, newer on the Microsoft side) **has no** equivalent policy assigned. The PE is created fine, but no zone group → records absent → resolution impossible.

For every new type of PE introduced, **verify** the DINE exists:

```bash
az network private-endpoint dns-zone-group list \
  --resource-group <rg> --endpoint-name <pe> -o table
```

If the list is empty after a few minutes, wire the zone group manually.

### The scaling plan needs the subscription scope

"Unable to access host pool" error when creating the scaling plan, even though the `Desktop Virtualization Power On Off Contributor` role was assigned on the VMs' resource group. The naive logic — "the role is on the VMs, that's enough for start/stop" — is wrong.

The AVD service principal must **read** the host pool (in WEU, in another RG) to orchestrate the start/stop of the VMs (in GWC). Since the two are in different resource groups, the minimum viable scope is **the subscription**.

Takeaway for Autoscale: subscription scope, not resource group. It's in the Microsoft docs, but easy to miss when you optimise for least-privilege.

---

## Identity & authentication

### Entra Kerberos: a race condition on the first apply

Symptom: `NotFound: The resource '.../applications/<guid>' does not exist` when creating a storage account with `directory_type = "AADKERB"`.

No corresponding Entra object exists (verified via `az ad app/sp list`). It's the **Azure backend** that keeps a reference to a Graph application supposedly created by a previous failed apply — a phantom reference, in neither Entra nor any visible resource. No cleanup possible on the user side.

Workaround: create the storage account **without** `AADKERB` (commenting out the block), then a 2nd apply that adds the block → Azure cleanly reinitialises and creates a fresh service principal.

Takeaway: for services that auto-create Entra objects (Storage AADKERB, Managed HSM…), a first apply that fails midway can leave phantom references. The **2-phase pattern** is the generic solution.

### The DSC token goes through `PrivateSettingsRef`, not in cleartext

Naively, you put the `registrationInfoToken` in `protected_settings.properties`. Error: "duplicate arguments". If you remove it from the public block, another error.

The truth: Microsoft's DSC script expects a **`pscredential`**, not a string. You need this pattern:

```hcl
settings.properties.registrationInfoTokenCredential = {
  UserName = "PLACEHOLDER_DO_NOT_USE"
  Password = "PrivateSettingsRef:RegistrationInfoToken"
}
protected_settings.Items.RegistrationInfoToken = <token>
```

Microsoft's ARM examples use it everywhere, but no Terraform doc shows this pattern clearly. The `PrivateSettingsRef:KEY` reference on the public side + `Items.KEY` on the protected side is a DSC convention inherited from WMF — really not intuitive.

### Entra-joined session hosts silently refuse legacy RDP auth

The trap that costs you two hours **after** everything else works. RBAC OK, feed visible, click "Connect" → "Your credentials did not work" loop even with the right password.

The Windows App client sends a legacy NTLM auth by default. The Entra-joined session host refuses it — and the error message is misleading (it suggests a wrong password, not an authentication mismatch).

Fix: **custom RDP properties** on the host pool:

```text
targetisaadjoined:i:1;enablerdsaadauth:i:1
```

`targetisaadjoined` forces the client into the WAM flow (Web Account Manager, the modern Microsoft popup). `enablerdsaadauth` enables Entra SSO if the client device is also Entra-joined. No warning, no obvious doc.

---

## Terraform & operations

### The PE module's `ignore_changes` hides the manual wire

The `PrivateEndpoint` module ignores changes on `private_dns_zone_group` — laudable intent: let ALZ DINE manage it without Terraform reverting.

But when the DINE does **not** wire it (the `global` subresource case) and you add the block in Terragrunt config, **Terraform detects no diff** (`ignore_changes` blinds it). The plan says "no changes" even though something is clearly missing.

Workarounds:

- `terragrunt apply -replace='module.pe.azurerm_private_endpoint.this["xxx"]'` → destroy/recreate with the new block (but the PE loses its IP in the process).
- `az network private-endpoint dns-zone-group create` fallback (one-shot; `ignore_changes` won't touch anything after).

A better-designed module would have a conditional `ignore_changes`: ignore if the block is absent in config, manage if present. But Terraform doesn't support dynamic `ignore_changes` — impossible natively.

### A Key Vault's data-plane rights don't follow the control-plane

You can be `Owner` on the subscription (so full control-plane RBAC on the Key Vaults) and still hit `Forbidden: getSecret/setSecret` on data-plane operations. The first apply that tries to write a secret fails.

`Owner` on the sub gives administrative rights on the KVs (delete, lock, modify policies) but **not** read/write of the encrypted content. That's Key Vault's Zero Trust design, but it surprises. The `KeyVaultStack` module exposes an `assign_rbac_to_current_user` toggle that assigns `Key Vault Administrator` (data plane) to the deployer — enable it for bootstrap.

### Key Vault recovered from soft-delete: never delete a PE connection by hand

A KV with `purge_protection_enabled = true` is never recreated from scratch: the azurerm provider **recovers** it from soft-delete. The recovered KV brings back its **old Private Endpoint connection records** — hence multiple entries (`psc-…-001`, `…-001.2`, `…-001.3`) in Rejected/Approved for a single deployed PE.

The trap: **you can't identify the live connection by its name or suffix.** All entries point to the **same** `privateEndpoint.id` (the PE was recreated with the same name). Assuming "the most recent = the live one" is wrong. If you delete the wrong one, the PE goes **`Disconnected`**, loses its IP, and Azure does **not** know how to reconnect a disconnected PE.

Reliable cleanup = **recreate the PE**, not sort the connections:

```bash
terragrunt apply -replace='module.pe.azurerm_private_endpoint.this["this"]' --working-dir kv-avd
```

The `-replace` destroys the PE and its dead connection, recreates a fresh auto-approved one; the remaining orphans become harmless. Takeaway: on a soft-delete-recovered KV, orphaned PE connections are **cosmetic** — leave them, or recreate the PE. **Never a targeted manual delete.**

> **Windows note.** `terragrunt apply -replace='res.this["key"]'` gets its quotes stripped by PowerShell 5.1 → "Invalid force-replace address". Use the stop-parsing sigil `--%` (`terragrunt --% apply -replace='…'`) or pass the address via a variable. Otherwise, run from bash.

---

## Cost

### 70% of the cost of an AVD POC is FSLogix Premium storage

Order of magnitude for 1 `D4s_v5` session host with weekday Autoscale:

| Item                                | Monthly cost |
| ----------------------------------- | ------------ |
| Compute (session host)              | ~€50         |
| OS disk                             | ~€17         |
| **Azure Files Premium ZRS 500 GiB** | **~€104**    |
| Private Endpoints                   | ~€32         |

Azure Files Premium is **provisioned** — you pay for the quota, not the usage. Provisioning 500 GiB for zero active users is €104 thrown away. The rule for a POC: start at the Premium minimum (100 GiB) and scale up later.

Takeaway: the cost of an AVD POC is driven first by the FSLogix quota, not by the VMs.

---

## Meta-learning: deploy in onion order

The order of the phases isn't arbitrary — each layer functionally depends on the previous one:

1. **Network + storage identity** — without this, nothing runs.
2. **Data storage with auth** — FSLogix ready to receive connections.
3. **AVD control plane** — the Azure-managed services.
4. **Private Endpoints** — the real private connectivity.
5. **Compute + RBAC + scaling** — the session hosts, which consume all the previous layers.

Skipping a step gives you a session host that boots but refuses to register to the host pool (missing PE), or that registers but can't mount FSLogix (missing storage permission). Debugging becomes painful because the errors are at several levels at once.

Takeaway: deploy in onion order, verify each layer before moving to the next.

---

None of these points is a secret — they're all somewhere in the Microsoft docs, scattered. But gathering them costs a whole POC. If you're deploying AVD in a private Landing Zone, you just saved yourself a few days.
