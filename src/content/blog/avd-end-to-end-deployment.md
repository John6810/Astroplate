---
title: "Deploying Azure Virtual Desktop End-to-End in a Landing Zone"
meta_title: ""
description: "The full A-to-Z of a private, Entra-only AVD deployment: target architecture, network plan, a custom golden image built with Azure Image Builder, the consolidated Terraform/Terragrunt build, FSLogix on Entra Kerberos, full Private Link, the RBAC model, and Autoscale — grounded in a real POST Luxembourg deployment."
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

> **TL;DR.** This is the deployment walkthrough for a **fully private, Entra-only Azure Virtual Desktop** environment inside a regulated Azure Landing Zone. Pooled Windows 11 multi-session on a **custom golden image** (Azure Image Builder → private Compute Gallery), FSLogix profiles on Azure Files with **Entra Kerberos**, **zero public endpoints** (five Private Endpoints), the AVD control plane pinned to a supported region while the session hosts live next to the users, all deployed with Terraform + Terragrunt in a strict **onion order**. One step stays manual by design. Companion reads: the [traps no doc tells you about](/blog/avd-landing-zone-pieges) and the [POC-to-prod hardening checklist](/blog/avd-du-poc-a-la-prod).

_The what-goes-wrong is covered in the [pitfalls article](/blog/avd-landing-zone-pieges). This one is the **how** — the architecture, the build order, and the one manual step you can't automate away._

---

## The target

The goal was a compliant virtual desktop that a user reaches over the corporate VPN with **no public exposure of anything**:

- **Pooled Windows 11 25H2 multi-session** on a **custom gold image** — the marketplace _AVD M365_ base (FSLogix, OneDrive and Teams already baked in) plus the tooling the users need, versioned in a private Compute Gallery.
- **Pure Entra ID** identity — Entra-joined session hosts, no domain controllers, no hybrid.
- **FSLogix profiles on Azure Files Premium (ZRS)** authenticated with **Entra Kerberos** (`AADKERB`).
- **Full Private Link** — the workspace (feed + global), the host pool (connection), Azure Files and the Key Vault all sit behind Private Endpoints. Session host egress goes through the hub Palo Alto NVA.
- **Autoscale** to shut the compute down outside working hours.

One architectural fact drives the whole layout: **the AVD control plane isn't available in every region**. The session hosts run in `germanywestcentral` (close to the users), but the host pool / workspace / app groups / scaling plan metadata **must** live in a supported region — here `westeurope`. That split is metadata-only; no user data crosses the boundary and there's no latency impact.

```
sub avd (Germany West Central data plane · West Europe control plane)

  RG network (GWC)        vnet spoke 10.239.5.0/24
                          ├─ snet-hosts        (session hosts)
                          ├─ snet-pe-avd       (3 AVD PEs)
                          ├─ snet-pe-storage   (FSLogix PE)
                          └─ snet-pe-kv        (Key Vault PE)
                          NSG per subnet + UDR 0.0.0.0/0 → Palo ILB

  RG image (GWC)          Compute Gallery — win11-avd-m365 gold image (built by AIB)
  RG fslogix (GWC)        Premium FileStorage ZRS, share 'profiles' + AADKERB
  RG kv (GWC)             Key Vault (Premium, RBAC, purge protection)
  RG sh (GWC)             session host VM(s), Entra-joined, Trusted Launch

  RG avd (WEU)            host pool · workspace · global workspace ·
                          desktop + RemoteApp groups · scaling plan   (metadata)
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

Terragrunt resolves the dependency graph, so `terragrunt run-all apply` from the `avd/` folder does the whole thing in the right order. But it's worth understanding the **onion** — each layer functionally depends on the one below it, and one step in the middle is deliberately manual. After a refactor, the network and the resource groups are each **one consolidated unit**, and the data-plane Private Endpoints (Key Vault, Azure Files) and the user role grants are created **inline** with the resource they belong to.

### Phase 1 — Foundations

```bash
export TG_ENV="nprd"
cd landing-zone/corporate/avd

terragrunt apply --working-dir resource-group   # every RG (GWC + WEU) + CanNotDelete locks, one apply
terragrunt apply --working-dir network          # vnet + DDoS + Network Watcher + 4 NSGs + route table (→ Palo ILB) + spoke↔hub peering, one apply
```

Nothing runs without the network and the resource groups. All the RGs — network, image, fslogix, kv, sh in GWC plus the control-plane RG in WEU — are declared once in `resource-group`, with delete locks on the ones that must not be torn down.

### Phase 2 — Key Vault + FSLogix storage

```bash
terragrunt apply --working-dir kv-avd           # Key Vault Premium + PE 'vault' (inline)
terragrunt apply --working-dir st-avd-fslogix   # Premium FileStorage ZRS + share 'profiles' + AADKERB + PE 'file' (inline) + SMB grant (inline)
```

> **The one manual step — Entra admin consent.** Enabling `AADKERB` on the storage account creates an Entra **Enterprise Application** (`[Storage Account] <name>`). An admin has to grant tenant admin consent on it once, in the portal. Terraform can create the storage account, but it can't click "Grant admin consent" for you — and until someone does, Kerberos auth to the share won't work. This is the **only** touch you can't automate.

The Key Vault is Premium (HSM-backed keys later), RBAC-authorized, purge-protected, public access disabled. Then the secrets, which need both the Key Vault and the storage account to exist first:

```bash
terragrunt apply --working-dir secrets-avd      # local-admin password + FSLogix key, 90-day expiry
```

### Phase 3 — Golden image (Azure Image Builder → Compute Gallery)

The session hosts don't boot a marketplace SKU directly — they boot a **custom image** that we build, version and keep private:

```bash
terragrunt apply --working-dir id-image-builder # user-assigned identity AIB runs as
terragrunt apply --working-dir gallery-avd      # Compute Gallery + image definition 'win11-avd-m365-dev'
terragrunt apply --working-dir image-avd        # AIB template → build → distribute a version
```

The pieces:

- **`id-image-builder`** — a user-assigned managed identity that Azure Image Builder (AIB) impersonates, with Contributor on the `image` RG (to write gallery versions) and on a bring-your-own **staging** RG (where AIB spins up its ephemeral build VM). Hardening later: swap Contributor for a scoped custom Image Builder role.
- **`gallery-avd`** — an Azure Compute Gallery in the GWC `image` RG, co-located with the session hosts, holding one image **definition** (`win11-avd-m365-dev`, `TrustedLaunchSupported` to match the hosts). This is the stable versioning target.
- **`image-avd`** — the AIB template. It starts from the same **`win11-25h2-avd-m365`** marketplace base as before (so FSLogix / OneDrive / Teams stay baked in), then a PowerShell customizer layers the extra tooling (VS Code / Git / Azure Repos) on top. AIB builds in an **isolated staging RG with no public IP** — only the finished image version is distributed into the private gallery, replicated to `germanywestcentral`.

Builds are `auto_run_enabled = false` on purpose: this is a POC, so image builds are kicked off manually (or from a pipeline for the monthly rebuild), not on every apply.

### Phase 4 — AVD control plane (West Europe)

```bash
terragrunt apply --working-dir hp-avd           # host pool (+ 48h registration token)
terragrunt apply --working-dir ws-avd-global    # dedicated placeholder workspace for global discovery
terragrunt apply --working-dir dag-desktop      # Desktop application group (+ inline user grant)
terragrunt apply --working-dir dag-app          # RemoteApp application group: Edge/Excel/OneDrive/Outlook/Teams/Word
terragrunt apply --working-dir ws-avd           # main workspace — applied AFTER the app groups
```

Two things worth calling out. First, there are **two application groups**: a full **Desktop** and a **RemoteApp** group publishing individual apps (Edge, Excel, OneDrive, Outlook, Teams, Word). Second, the **main workspace is applied last** — it adopts both app groups through its `application_group_associations`, so they have to exist first.

The `ws-avd-global` workspace is a **dedicated placeholder** that exists only to terminate the global (initial feed discovery) Private Endpoint. That global workspace is a **tenant-wide singleton** — deleting it breaks feed discovery for the whole AVD estate.

### Phase 5 — Private Endpoints + session hosts

```bash
terragrunt apply --working-dir pe-avd-hp        # PE subresource 'connection'
terragrunt apply --working-dir pe-avd-ws        # PE subresource 'feed'
terragrunt apply --working-dir pe-avd-global    # PE subresource 'global' — DNS zone group wired by the unit itself
```

The `global` subresource used to be a manual chore: the ALZ DINE policies auto-wire the `feed` and `connection` subresources into `privatelink.wvd.microsoft.com`, but there's **no equivalent policy for the `global` zone** (`privatelink-global.wvd.microsoft.com`), so the global PE landed with no DNS records and `rdweb.wvd.microsoft.com` never resolved — the client showed "No devices or apps found". The `pe-avd-global` unit now **wires that zone group explicitly**, so it's declarative and no longer a manual step. (The PE module's `ignore_changes` on the DNS wiring is still a subtlety worth understanding — [full story here](/blog/terraform-plan-no-changes).)

Then the session hosts, which consume every layer below — network, Key Vault, host pool, FSLogix, secrets, and the gallery image:

```bash
terragrunt apply --working-dir sh-avd           # NIC + Win11 VM (custom image) + 6 chained extensions + inline VM-login grant
terragrunt apply --working-dir scaling-plan     # scaling plan + host pool association
terragrunt apply --working-dir rbac-avd-autoscale  # AVD service principal role assignment (sub scope)
```

The session host is a `D4as_v7`, Entra-joined with a system-assigned managed identity, **Trusted Launch + encryption at host**. It boots from the gallery image via `source_image_id = <definition>/versions/latest` — which takes precedence over any marketplace image reference. A consequence worth knowing: when you publish a **new image version and re-apply, the VM is rebuilt**. That's safe here because the hosts are stateless — profiles live in FSLogix — but users get logged off, so you roll image updates during the Autoscale off-peak window.

The host runs **six chained extensions**, and the order matters:

1. `AADLoginForWindows` — Entra join
2. `AVDDscExtension` — the AVD agent DSC, registers the host to the pool using the token
3. `FslogixConfig` — points FSLogix at the Azure Files share
4. `AzureMonitorWindowsAgent` — logs/metrics into the workspace
5. `AzurePolicyforWindows` — guest configuration / policy compliance
6. `MDE.Windows` — Defender for Endpoint onboarding

The first three are the boot-critical chain (join → register → profiles); the last three layer on monitoring, compliance and EDR.

### Phase 6 — Governance

Independent of the AVD data path, and applied any time after `network`:

```bash
terragrunt apply --working-dir policy-assignments        # DINE VNet flow logs → central storage
terragrunt apply --working-dir policy-exemptions         # waivers on the session-host RG (stateless hosts)
terragrunt apply --working-dir security-center-workspace # Defender for Cloud → central Log Analytics
```

The exemptions matter more than they look: pooled session hosts are **stateless and rebuilt on every image update**, so blanket VM policies (change tracking, guest monitoring agents, hybrid-VM rules) don't apply the way they would to a pet server — they're waived deliberately on the session-host RG rather than left to fail.

---

## The RBAC model

A user needs **three separate group memberships** to use AVD end-to-end. The permissions are orthogonal — one for feed discovery, one for OS login, one for the FSLogix profile — and missing any one produces a different, confusing failure:

| Azure role                                          | Scope                           | What it unlocks                          |
| --------------------------------------------------- | ------------------------------- | ---------------------------------------- |
| **Desktop Virtualization User**                     | the Desktop + RemoteApp groups  | See the desktop/apps in the client feed  |
| **Virtual Machine User Login**                      | the session-host resource group | Entra sign-in on the VM                  |
| **Storage File Data SMB Share Contributor**         | the FSLogix resource group      | Read/write the FSLogix profile           |
| **Desktop Virtualization Power On Off Contributor** | the **subscription**            | Autoscale start/stop (service principal) |

That last one is the AVD service principal, and it **has to be at subscription scope** — assign it any lower (RG, host pool, VM) and Autoscale silently stops working. It's the only grant that lives in its own unit (`rbac-avd-autoscale`); the three user grants are declared **inline** with the resource they protect — the app-group grants in `dag-desktop`/`dag-app`, the VM-login grant in `sh-avd`, the SMB grant in `st-avd-fslogix`.

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

For a single `D4as_v7` session host, Autoscale weekdays 07:00–19:00 brings it from ~€300/month (always-on) to **~€200/month**:

| Component                                                              | €/month  |
| ---------------------------------------------------------------------- | -------- |
| VM D4as_v7 (Autoscale, 12h × 5 days)                                   | ~50      |
| OS disk Premium P10 (128 GiB)                                          | ~17      |
| **Azure Files Premium ZRS (500 GiB provisioned)**                      | **~104** |
| Private Endpoints (5)                                                  | ~32      |
| Key Vault Premium                                                      | ~0       |
| AVD control plane (host pool / workspaces / app groups / scaling plan) | 0        |

The single biggest lever isn't compute — it's the **provisioned FSLogix quota**. Azure Files Premium bills on the quota you reserve, not what you use; dropping 500 GiB → 100 GiB saves ~€83/month. Size it to real usage. (The image gallery adds only the storage of the replicated image versions — a few euros — since AIB's build VM is ephemeral.)

---

## What I had to build

The AVD-specific modules didn't exist in the shared library, so this deployment contributed a family of them (and extended a few more), all following the [same AVM-aligned conventions](/blog/why-not-avm-as-is) as the rest of the landing zone:

- `AvdHostPool` — host pool + registration token
- `AvdWorkspace` — workspace (used twice: main + global placeholder)
- `AvdApplicationGroup` — app group + workspace association (used twice: Desktop + RemoteApp)
- `AvdSessionHost` — NIC + Windows VM + the six chained extensions
- `AvdScalingPlan` — Autoscale schedules + host pool associations
- `ComputeGallery` — Azure Compute Gallery + image definition
- `AvdImageTemplate` — the Azure Image Builder template + customizers + gallery distribution
- `ManagedIdentity` — the user-assigned identity AIB runs as
- `KeyVault-Secrets` — random-generated secrets with a `time_offset`-driven expiry
- `StorageAccount` (extended) — `file_shares`, `azure_files_authentication` (AADKERB), inline `file` PE
- `RbacAssignments` (extended) — `principal_type` so a single module handles Group / User / SP grants

---

## The shape of it

Strip away the specifics and the pattern is simple: **deploy in the order things depend on each other, and be explicit about the one thing you can't automate.** Foundations and identity first, then storage, then the golden image, then the control plane, then the private wiring, then the compute that consumes all of it — and governance alongside. The Entra admin consent on the FSLogix storage account is the only manual touch left; everything else, including the global DNS zone group that used to be hand-wired, is one `terragrunt run-all apply`.

If you're standing up AVD in a private Landing Zone, this is the skeleton. For the sharp edges you'll hit along the way, read the [pitfalls](/blog/avd-landing-zone-pieges); for what to add before calling it production, the [hardening checklist](/blog/avd-du-poc-a-la-prod).

## References

- [AVD Landing Zone (CAF)](https://learn.microsoft.com/azure/cloud-adoption-framework/scenarios/azure-virtual-desktop/)
- [AVD Private Link](https://learn.microsoft.com/azure/virtual-desktop/private-link-overview)
- [Azure VM Image Builder](https://learn.microsoft.com/azure/virtual-machines/image-builder-overview)
- [FSLogix with Entra Kerberos](https://learn.microsoft.com/fslogix/how-to-configure-profile-container-entra-id-hybrid)
- [AVD Autoscale scaling plans](https://learn.microsoft.com/azure/virtual-desktop/autoscale-scaling-plan)
- [Entra-joined session hosts](https://learn.microsoft.com/azure/virtual-desktop/azure-ad-joined-session-hosts)
