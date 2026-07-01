---
title: "Deploying Azure Virtual Desktop End-to-End in a Landing Zone"
meta_title: ""
description: "The full A-to-Z of a private, Entra-only AVD deployment: target architecture, network plan, the onion-order Terraform/Terragrunt build, FSLogix on Entra Kerberos, full Private Link, the RBAC model, and Autoscale — grounded in a real POST Luxembourg deployment."
date: 2026-07-01T00:00:00Z
image: "/images/blog/avd-end-to-end-deployment.png"
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
    "autoscale",
  ]
draft: false
---

> **TL;DR.** This is the deployment walkthrough for a **fully private, Entra-only Azure Virtual Desktop** environment inside a regulated Azure Landing Zone. Pooled Windows 11 multi-session, FSLogix profiles on Azure Files with **Entra Kerberos**, **zero public endpoints** (five Private Endpoints), the AVD control plane pinned to a supported region while the session hosts live next to the users, all deployed with Terraform + Terragrunt in a strict **onion order**. Two steps stay manual by design. Companion reads: the [traps no doc tells you about](/blog/avd-landing-zone-pieges) and the [POC-to-prod hardening checklist](/blog/avd-du-poc-a-la-prod).

_The what-goes-wrong is covered in the [pitfalls article](/blog/avd-landing-zone-pieges). This one is the **how** — the architecture, the build order, and the two manual steps you can't automate away._

---

## The target

The goal was a compliant virtual desktop that a user reaches over the corporate VPN with **no public exposure of anything**:

- **Pooled Windows 11 24H2 multi-session**, FSLogix pre-installed on the image.
- **Pure Entra ID** identity — Entra-joined session hosts, no domain controllers, no hybrid.
- **FSLogix profiles on Azure Files Premium (ZRS)** authenticated with **Entra Kerberos** (`AADKERB`).
- **Full Private Link** — the workspace (feed + global), the host pool (connection), Azure Files and the Key Vault all sit behind Private Endpoints. Session host egress goes through the hub Palo Alto NVA.
- **Autoscale** to shut the compute down outside working hours.

One architectural fact drives the whole layout: **the AVD control plane isn't available in every region**. The session hosts run in `germanywestcentral` (close to the users), but the host pool / workspace / app group / scaling plan metadata **must** live in a supported region — here `westeurope`. That split is metadata-only; no user data crosses the boundary and there's no latency impact.

```
sub avd (Germany West Central data plane · West Europe control plane)

  RG network (GWC)        vnet spoke 10.239.5.0/24
                          ├─ snet-hosts        (session hosts)
                          ├─ snet-pe-avd       (3 AVD PEs)
                          ├─ snet-pe-storage   (FSLogix PE)
                          └─ snet-pe-kv        (Key Vault PE)
                          NSG per subnet + UDR 0.0.0.0/0 → Palo ILB

  RG fslogix (GWC)        Premium FileStorage ZRS, share 'profiles' + AADKERB
  RG kv (GWC)             Key Vault (Premium, RBAC, purge protection)
  RG sh (GWC)             session host VM(s), Entra-joined, Trusted Launch

  RG avd (WEU)            host pool · workspace · global workspace ·
                          application group · scaling plan   (metadata)
```

DNS resolution stays private end-to-end: the spoke's custom DNS points at the Palo Alto ILB, which forwards to the Azure DNS Private Resolver, which answers from the private zones (`privatelink.wvd.microsoft.com`, `privatelink-global.wvd.microsoft.com`, `privatelink.file.core.windows.net`, `privatelink.vaultcore.azure.net`).

---

## The network plan

One `/24` spoke, four subnets — session hosts plus one subnet per Private Endpoint family:

```
vnet-avd-nprd-gwc-spoke          10.239.5.0/24
  snet-…-hosts                   10.239.5.0/26     session hosts
  snet-…-pe-avd                  10.239.5.64/28    3 AVD PEs (feed, global, connection)
  snet-…-pe-storage              10.239.5.80/28    FSLogix PE (file)
  snet-…-pe-kv                   10.239.5.96/28    Key Vault PE (vault)
  (reserve)                      10.239.5.112-255
```

Every subnet gets its own NSG, and a route table sends `0.0.0.0/0` to the Palo Alto ILB frontend. The spoke is peered bidirectionally with the connectivity hub. (Subnets are created with the [`azapi` atomic pattern](/blog/subnet-nsg-azapi) so the "subnet must have an NSG" Deny policy doesn't block them.)

---

## The build, phase by phase

Terragrunt resolves the dependency graph, so `terragrunt run-all apply` from the `avd/` folder does the whole thing in the right order. But it's worth understanding the **onion** — each layer functionally depends on the one below it, and two steps in the middle are deliberately manual.

### Phase 1 — Network base

```bash
export TG_ENV="nprd"
cd landing-zone/corporate/avd

terragrunt apply --working-dir network-watcher   # RG + Network Watcher
terragrunt apply --working-dir network-avd        # VNet + DDoS
terragrunt apply --working-dir nsg-avd            # 4 NSGs
terragrunt apply --working-dir rt-avd             # UDR default → Palo ILB
terragrunt apply --working-dir subnet-avd         # 4 subnets (azapi + NSG + RT)
terragrunt apply --working-dir vnet-peerings      # spoke ↔ hub NVA
terragrunt apply --working-dir kv-avd             # Key Vault + its PE
terragrunt apply --working-dir locks-avd          # CanNotDelete on network + KV RGs
```

Nothing runs without the network and the Key Vault. The Key Vault is Premium (HSM-backed keys later), RBAC-authorized, purge-protected, public access disabled.

### Phase 2 — FSLogix storage

```bash
terragrunt apply --working-dir rg-fslogix
terragrunt apply --working-dir st-avd-fslogix     # Premium FileStorage + share 'profiles' + AADKERB
terragrunt apply --working-dir pe-avd-fslogix      # PE subresource 'file'
```

> **Manual step #1 — Entra admin consent.** Enabling `AADKERB` on the storage account creates an Entra **Enterprise Application** (`[Storage Account] <name>`). An admin has to grant tenant admin consent on it once, in the portal. Terraform can create the storage account, but it can't click "Grant admin consent" for you — and until someone does, Kerberos auth to the share won't work.

Then the secrets, which need both the Key Vault and the storage account to exist first:

```bash
terragrunt apply --working-dir secrets-avd        # local-admin password + FSLogix key, 90-day expiry
```

### Phase 3 — AVD control plane (West Europe)

```bash
terragrunt apply --working-dir rg-avd
terragrunt apply --working-dir hp-avd             # host pool (+ 48h registration token)
terragrunt apply --working-dir ws-avd             # main workspace
terragrunt apply --working-dir ws-avd-global      # dedicated placeholder workspace for global discovery
terragrunt apply --working-dir dag-avd            # Desktop application group + workspace association
```

Two workspaces on purpose: the **main** workspace carries the application groups, and a **dedicated placeholder** workspace exists only to terminate the global (initial feed discovery) Private Endpoint. That global workspace is a **tenant-wide singleton** — deleting it breaks feed discovery for the whole AVD estate.

### Phase 4 — Private Endpoints + session hosts

```bash
terragrunt apply --working-dir pe-avd-hp          # PE subresource 'connection'
terragrunt apply --working-dir pe-avd-ws          # PE subresource 'feed'
terragrunt apply --working-dir pe-avd-global      # PE subresource 'global'
```

> **Manual step #2 — wire the global PE's DNS.** The ALZ DINE policies auto-wire the `feed` and `connection` subresources into `privatelink.wvd.microsoft.com`, but there's **no equivalent policy for the `global` zone** (`privatelink-global.wvd.microsoft.com`). So the global PE is created with **no DNS records**, and `rdweb.wvd.microsoft.com` never resolves — the client shows "No devices or apps found". You wire that zone group by hand (and the PE module's `ignore_changes` makes this its own little trap — [full story here](/blog/terraform-plan-no-changes)).

Then the session hosts, which consume every layer below — network, Key Vault, host pool, FSLogix, secrets:

```bash
terragrunt apply --working-dir rg-sh
terragrunt apply --working-dir sh-avd             # NIC + Win11 VM + 3 chained extensions
terragrunt apply --working-dir rbac-avd           # user + service principal role assignments
terragrunt apply --working-dir sp-avd             # scaling plan + host pool association
```

The session host VM is Entra-joined with a system-assigned managed identity, Trusted Launch, and **three chained extensions**: `AADLoginForWindows` (Entra join), the AVD agent DSC (registers to the host pool using the token), and the FSLogix custom script. The order matters — each extension depends on the previous one completing.

---

## The RBAC model

A user needs **three separate group memberships** to use AVD end-to-end. The permissions are orthogonal — one for feed discovery, one for OS login, one for the FSLogix profile — and missing any one produces a different, confusing failure:

| Azure role                                          | Scope                           | What it unlocks                          |
| --------------------------------------------------- | ------------------------------- | ---------------------------------------- |
| **Desktop Virtualization User**                     | the Desktop application group   | See the desktop in the client feed       |
| **Virtual Machine User Login**                      | the session-host resource group | Entra sign-in on the VM                  |
| **Storage File Data SMB Share Contributor**         | the FSLogix resource group      | Read/write the FSLogix profile           |
| **Desktop Virtualization Power On Off Contributor** | the **subscription**            | Autoscale start/stop (service principal) |

That last one is the AVD service principal, and it **has to be at subscription scope** — assign it any lower (RG, host pool, VM) and Autoscale silently stops working.

---

## Autoscale

A weekday-only scaling plan (`W. Europe Standard Time`), `BreadthFirst` while ramping up and `DepthFirst` to consolidate on the way down:

| Phase     | Start | Behaviour                                                      |
| --------- | ----- | -------------------------------------------------------------- |
| Ramp-up   | 07:00 | Min 20% hosts on; add hosts when existing ones exceed 60% load |
| Peak      | 09:00 | Full capacity, BreadthFirst spread                             |
| Ramp-down | 17:00 | DepthFirst, 30-min user notification, no forced logoff         |
| Off-peak  | 19:00 | DepthFirst, hosts off once `ZeroActiveSessions`                |

No weekend schedule → hosts stay off from Friday 19:00 to Monday 07:00. A `excludeFromScaling` tag pulls a VM out of Autoscale for maintenance.

---

## Cost

For a single `D4s_v5` session host, Autoscale weekdays 07:00–19:00 brings it from ~€300/month (always-on) to **~€200/month**:

| Component                                                             | €/month  |
| --------------------------------------------------------------------- | -------- |
| VM D4s_v5 (Autoscale, 12h × 5 days)                                   | ~50      |
| OS disk Premium P10 (128 GiB)                                         | ~17      |
| **Azure Files Premium ZRS (500 GiB provisioned)**                     | **~104** |
| Private Endpoints (5)                                                 | ~32      |
| Key Vault Premium                                                     | ~0       |
| AVD control plane (host pool / workspaces / app group / scaling plan) | 0        |

The single biggest lever isn't compute — it's the **provisioned FSLogix quota**. Azure Files Premium bills on the quota you reserve, not what you use; dropping 500 GiB → 100 GiB saves ~€83/month. Size it to real usage.

---

## What I had to build

The AVD-specific modules didn't exist in the shared library, so this deployment contributed seven of them (and extended two more), all following the [same AVM-aligned conventions](/blog/why-not-avm-as-is) as the rest of the landing zone:

- `AvdHostPool` — host pool + registration token
- `AvdWorkspace` — workspace (used twice: main + global placeholder)
- `AvdApplicationGroup` — app group + workspace association
- `AvdSessionHost` — NIC + Windows VM + the three chained extensions
- `AvdScalingPlan` — Autoscale schedules + host pool associations
- `KeyVault-Secrets` — random-generated secrets with a `time_offset`-driven expiry
- `StorageAccount` (extended) — `file_shares`, `azure_files_authentication` (AADKERB), `network_rules`

---

## The shape of it

Strip away the specifics and the pattern is simple: **deploy in the order things depend on each other, and be explicit about the two things you can't automate.** Network and identity first, then storage, then the control plane, then the private wiring, then the compute that consumes all of it. The Entra admin consent and the global DNS zone group are the only two manual touches — everything else is one `terragrunt run-all apply`.

If you're standing up AVD in a private Landing Zone, this is the skeleton. For the sharp edges you'll hit along the way, read the [pitfalls](/blog/avd-landing-zone-pieges); for what to add before calling it production, the [hardening checklist](/blog/avd-du-poc-a-la-prod).

## References

- [AVD Landing Zone (CAF)](https://learn.microsoft.com/azure/cloud-adoption-framework/scenarios/azure-virtual-desktop/)
- [AVD Private Link](https://learn.microsoft.com/azure/virtual-desktop/private-link-overview)
- [FSLogix with Entra Kerberos](https://learn.microsoft.com/fslogix/how-to-configure-profile-container-entra-id-hybrid)
- [AVD Autoscale scaling plans](https://learn.microsoft.com/azure/virtual-desktop/autoscale-scaling-plan)
- [Entra-joined session hosts](https://learn.microsoft.com/azure/virtual-desktop/azure-ad-joined-session-hosts)
