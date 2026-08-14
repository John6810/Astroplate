---
title: "Running a 79-Module Terraform Library Like a Product"
meta_title: ""
description: "Four landing zones consume our module library live from main, unpinned. That only works because the library runs like a product: per-module CI, a drift linter for accepted duplication, Renovate as a signal, and a watcher for the one thing nobody monitors — Azure retiring things under your feet."
date: 2026-08-14T00:00:00Z
image: "/images/blog/terraform-module-library-as-a-product.png"
categories: ["Landing Zone"]
author: "Jonathan Aerts"
tags:
  [
    "terraform",
    "modules",
    "ci-cd",
    "azure-devops",
    "renovate",
    "platform-engineering",
    "iac",
    "testing",
  ]
draft: false
---

> **TL;DR.** A shared Terraform module library has two possible futures: product or landfill. Ours holds 79 modules consumed **live from `main`** by four landing zones — no pinning. The only reason that isn't reckless is the factory around it: changed-module CI with native `.tftest.hcl` tests, a weekly full re-validation against fresh provider releases, a drift linter that patrols deliberately duplicated code, Renovate configured as a **signal, not an order**, security scans, a public mirror — and a weekly watcher for the failure mode nobody monitors: **Azure retiring an API version your live resources depend on.**

Every consumer of our module library resolves it the same way: `git::` source, `main` branch, no `?ref=`. A fix lands once and reaches every landing zone on its next plan. Which also means: **a broken `main` reaches every landing zone on its next plan.**

That trade wasn't an accident — pinning across four consumers means version drift, backport requests and "which zone is on which release" spreadsheets. We chose live consumption and accepted its consequence: the library's CI isn't hygiene, it's the **contract** that makes unpinned consumption survivable.

## The factory

Seven pipelines, each guarding a different way a module library rots.

**1. Changed-module CI, plus a weekly full sweep.** A PR triggers a dynamic matrix over the modules it actually touched — format, init, validate, and the module's native Terraform tests (`.tftest.hcl`), in parallel. The part that catches what PRs can't: a **weekly re-validation of every module in the library**, because modules rot without anyone touching them — a new provider release changes a default, deprecates an argument, tightens a validation. The weekly sweep converts "silent rot discovered during someone's incident" into "Monday morning warning."

**2. A drift linter for duplication we chose on purpose.** Our orchestrator modules (the `*Stack` ones) deliberately **inline copies** of blocks from canonical modules instead of nesting module calls — flatter graphs, clearer plans. Copies drift; that's their nature. Rather than pretending they won't, a linter compares each inline copy against its canonical source and warns on divergence. Advisory during reconciliation, then strict. Accepted duplication **plus a linter** beats both hidden duplication and deep module nesting.

**3. Releases with docs, even where the platform has no release object.** A SemVer tag builds terraform-docs for every module and generates release notes from the git log. Azure DevOps has no GitHub-style Releases page — the artifacts attach to the run summary instead. The point isn't ceremony: a consumer deciding whether to pin `?ref=v0.x` needs to read what changed without diffing HCL.

**4. Renovate, configured as a signal.** Weekly, PR-only, **never auto-merge**. Provider floors stay permissive (`~>`), so a Renovate PR doesn't mean "merge me" — it means "a newer provider exists; merge when a module actually needs it." A companion freshness job warns about in-range releases Renovate can't PR (modules don't commit lock files — consumers do). Dependency automation that files tickets instead of taking decisions is the right amount of automation for a library other people build on.

**5. Security scanning that doesn't cry wolf.** Checkov, Trivy and TFLint on PRs and weekly — **soft-fail**. On a module library, blocking on scanner findings mostly teaches people to stop reading scanner findings; the weekly report goes to someone whose job is to triage it.

**6. A public mirror.** Every push to `main` and every tag mirrors to a public repository. Partly open-source posture, mostly a forcing function: code written knowing it will be public is written cleaner.

**7. The retirement watcher — the one nobody has.** Renovate watches **versions**. Nothing in a normal setup watches **Azure itself retiring things** — an API version being disabled, a SKU going away — underneath resources that are already deployed. Azure Advisor publishes exactly this signal ("Service Upgrade and Retirement" recommendations, evaluated against your live resources). A weekly pipeline queries it across the landing zone subscriptions and surfaces every hit as a warning. Your provider can be fully up to date while the API version it deployed two years ago has a shutdown date — this is the only alarm that rings for that.

## The migration tax, briefly

The factory started life as GitHub Actions and moved to Azure DevOps with the code. One portability lesson worth the paragraph: **Azure Repos ignores the YAML `pr:` trigger entirely.** PR validation only runs if a Build Validation **branch policy** points at the pipeline — with path filters doing the job of `on: pull_request: paths:`. It's documented, it's by design, and it will still cost you an afternoon the first time a pipeline silently doesn't run.

The schedules are staggered on purpose — security scan, then Renovate, then the retirement watch, Monday morning in sequence. One coffee, one health report for the whole library.

## The shape of it

If your module library has no CI, you still have CI — it's called your consumers, and they didn't volunteer. Every landing zone plan is implicitly integration-testing your `main`, in production, with an audience.

Start with the cheapest piece: the weekly full validate of every module against current providers. One scheduled pipeline, no refactoring, and it converts the scariest property of a shared library — silent rot — into a Monday morning list. The rest of the factory can grow from there, one failure mode at a time.

## References

- [Terraform — module testing (`.tftest.hcl`)](https://developer.hashicorp.com/terraform/language/tests)
- [Azure Advisor — service upgrade and retirement recommendations](https://learn.microsoft.com/azure/advisor/advisor-how-to-use-service-upgrade-retirement-recommendations)
- [Azure DevOps — build validation branch policies](https://learn.microsoft.com/azure/devops/repos/git/branch-policies)
- [Renovate](https://docs.renovatebot.com/)
