---
title: "Azure Virtual Desktop: from POC to prod, the hardening checklist"
meta_title: ""
description: "A private AVD POC works — but it's missing security, observability, scalability and DR before prod. The ROI-prioritised roadmap (P1→P5) plus the technical debt to clear: FSLogix NTFS ACLs, secret rotation, AVD Insights, custom image, Conditional Access, FSLogix backup."
date: 2026-06-22T00:00:00Z
image: "/images/blog/avd-du-poc-a-la-prod.png"
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
    "observability",
    "finops",
    "conditional-access",
  ]
draft: false
---

> **TL;DR.** A fully private AVD POC that works is not a prod. Between the two: harden the FSLogix storage (NTFS ACLs, backup), automate secret rotation, wire up observability (AVD Insights + dedicated LAW), scale the session hosts (custom image, `sessionHostConfiguration`), plan for DR (FSLogix GZRS / Cloud Cache) and enable the enterprise features (Conditional Access/MFA, Intune, App Attach). Here's the ROI-prioritised roadmap, plus the POC's technical debt to clear.

_Published 22 June 2026._
_Follow-up to the article [AVD in a Landing Zone retrospective](/blog/avd-landing-zone-pieges). Stack: Terraform · Terragrunt · azurerm `~> 4.0` · FSLogix / Azure Files Premium · Windows 11 multi-session._

---

The POC is validated: AVD deployed in a spoke of a Landing Zone, zero public endpoint, FSLogix profiles on Entra Kerberos, Autoscale in place. But a POC optimises for "it works", not for "it holds in prod". Here's what we add on top, in order of priority / ROI.

---

## P1 — Hygiene & minimal security

### NTFS ACLs on the FSLogix share

The `profiles` share is accessible over SMB via Entra Kerberos + the `Storage File Data SMB Share Contributor` RBAC. But at the **NTFS** level, everyone sees everyone else's folders. You have to apply Microsoft's recommended ACLs (from a session logged onto a session host):

```powershell
icacls \\<storage>.file.core.windows.net\profiles `
  /inheritance:r `
  /grant "<domain>\<grp_avd_users>:(M)" `
  /grant "CREATOR OWNER:(OI)(CI)(IO)(M)" `
  /grant "BUILTIN\Administrators:(F)"
```

Automate it via a Custom Script Extension the first time, or a scheduled Azure Run Command.

### Automatic Key Vault secret rotation

The session hosts' local admin password and the FSLogix storage account key expire at 90 days. Today rotation is manual. To automate:

- **Logic App** triggered by Event Grid (event `SecretNearExpiry`), or
- **Azure Function** on a timer trigger,
- Action: `az storage account keys renew` + `az keyvault secret set`.

The module that manages the secrets has `ignore_changes = [value]` → out-of-band rotation doesn't create Terraform drift.

### Policy exemption for manual KV operations

`Deny-PublicPaaS` + a Key Vault with `public_network_access_enabled = false` means you have to be on the corp VPN to read/write a secret via the portal. Two options: a targeted **policy exemption** on the KV's RG (with justification + expiry date), or maintaining public access restricted by firewall ACLs (IP allowlist) — at the risk the policy refuses it.

### Activity log + diagnostic settings

No route to Log Analytics today. For each critical resource (host pool, workspace, session host), enable the **diagnostic settings** → LAW.

---

## P2 — Observability

### AVD Insights (dedicated LAW)

Microsoft recommends a dedicated AVD Log Analytics Workspace. To create:

- `law-avd` (30-day retention in POC, 90-day in prod),
- a **DCR** (Data Collection Rule) with the perf counters + event logs Insights requires,
- the DCR ↔ session hosts association,
- the host pool / workspace / app group diagnostic settings → LAW,
- the AVD Insights workbook.

On the IaC side, this translates into new Terragrunt deployments: `law-avd/`, `dcr-avd/`, the `dcra-avd/` association, and the `diag-*-avd/`. Indicative cost: LAW ingestion ~€2–3/GB; for a low-usage session host, budget ~€10/month.

### Action groups + AMBA alerts

The scaling plan events, session host agent failures and storage quota thresholds can be surfaced via Azure Monitor Baseline Alerts. The Landing Zone already provides a base — it remains to add the AVD-specific alerts.

---

## P3 — Scalability

### Multiple session hosts

Go from 1 to 3+ session hosts to test a `BreadthFirst` load balancing + a realistic Autoscale ramp-up. Points of attention:

- **Availability zones**: the module spreads automatically across zones `1/2/3`.
- **NSG**: verify the inbound/outbound rules scale.
- **FSLogix**: 1 container per user; a share supports ~3000 concurrent users before you need to consider multi-share sharding.

### The new `sessionHostConfiguration` pattern

Today we manage the session hosts via a VM counter + extensions. Microsoft recently GA'd the `sessionHostConfiguration` pattern (a host pool subresource) that automates create/update/scale of the VMs: no more individual extension management, automatic image update, integration with dynamic Autoscale. To check: the azurerm version that supports it.

### Custom image (Shared Image Gallery)

Today we start from the Marketplace image `win11-24h2-avd`. To standardise with the business apps pre-installed:

1. Create a template VM, install the apps + the config.
2. Sysprep + generalize.
3. Capture the image in a **Shared Image Gallery**.
4. **Azure Image Builder** to automate the build + monthly patching.
5. Point the session host module at the custom image.

---

## P4 — Prod deployment

### Prod subscription

The subscription ID placeholder for the prod AVD must be replaced by the real ID once the subscription is provisioned, then:

```bash
export TG_ENV="prod"
cd landing-zone/corporate/avd
terragrunt run-all apply
```

Variables to double-check between prod and nprd:

- **FSLogix quota**: size by the number of users (~30 GiB/user typical).
- **number of session hosts**: baseline + provision for the peak.
- **VM size**: `D4ds_v5` or more for heavy users (Office, Teams, IDE).
- `ramp_down_force_logoff_users`: switch to `true` to actually shut the VMs down at end of day (in POC it's `false` for testing).
- **locks** on **all** the RGs (not just network + KV).

### DR / secondary region

The AVD control plane is automatically redundant on the Microsoft side (multi-region metadata). On the user data side (FSLogix):

- **GZRS** on Azure Files (cross-region replication), or
- **FSLogix Cloud Cache** (replication between two storage accounts in two regions).

The session hosts don't need DR: they are **stateless** (all user state lives in FSLogix).

---

## P5 — Enterprise features

### MFA / Conditional Access

Enforce MFA on the AVD connection via an Entra ID Conditional Access policy targeting the **Azure Virtual Desktop** application (Microsoft public appId `9cdead84-a844-4324-93f2-b2e6bb768d07`). The AzureAD provider handles this with `azuread_conditional_access_policy`.

### Automatic Intune enrollment

Entra-joined session hosts can auto-enroll into Intune (policies, software deployment, compliance) — via the `mdmId` support on the `AADLoginForWindows` extension.

### RDP Shortpath, session recording, App Attach

- **RDP Shortpath** (UDP, lower latency): requires exposing UDP 3390 or going through public STUN/TURN — not very compatible with a simple full-private design. Reconsider against a real perf need.
- **Session recording** (audit/compliance): Microsoft Purview (in preview) or third-party solutions. Not a POC priority.
- **App Attach / MSIX**: package the business apps as MSIX and attach them dynamically to the session host rather than freezing them in the image → lighter image + app versioning.

---

## The POC's technical debt to clear

- **`shared_access_key_enabled = true`** on the FSLogix storage — enabled so Terraform can manage the share via the data plane. To harden in prod: disable the shared key, give the Terragrunt SP the right role to manage the shares via the control plane, and switch the provider to `storage_use_azuread = true`.
- **No FSLogix backup** — no backup of the VHDX containers. ZRS protects against a zone failure, not against human error or deletion. Plan for Azure Backup for Azure Files (or scheduled snapshots).
- **No FSLogix horizontal scaling** — a single storage account for all profiles. Beyond ~3000 concurrent users, plan for multi-account sharding (FSLogix `CCDLocations` / split by AD group).
- **Non-IaC DNS resolution** — the client-side NRPT and the `privatelink-global.wvd.microsoft.com` zone wire are manual. To industrialise: a custom ALZ `Deploy-Private-DNS-AVD-Global` policy that auto-wires the zone group when a `global` PE is detected, or a conditional `ignore_changes` on the PE module.

---

None of these evolutions is blocking to demonstrate AVD's value. But between a POC that runs and a regulated prod that holds, it's precisely this list that makes the difference — and sorting it by ROI avoids trying to do everything at once.
