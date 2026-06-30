# Security Policy

This is the source for a personal CV & blog site (static Astro, deployed on
Cloudflare Workers). It handles no user data and has no backend.

## Reporting a vulnerability

If you find a security issue (exposed secret, dependency vulnerability,
misconfiguration, or anything that could compromise the site or its
deployment), please report it privately:

- Email: **hi@jonathan-aerts.dev**

Please do not open a public issue for security-sensitive reports.

## Automated controls in this repository

| Control | Tool | When |
|---|---|---|
| Build & type check | `astro check` + build | every push / PR |
| Secret scanning | gitleaks | every push / PR + weekly |
| Dependency vulnerabilities | `npm audit` (runtime, fail ≥ high) | every push / PR + weekly |
| Dependency updates | Dependabot (npm + actions) | weekly |
| Misconfiguration scan | Trivy (config) | every push / PR + weekly |
| Vulnerability alerts | Dependabot alerts + security updates | continuous |

Secrets are never committed. Deployment credentials (Cloudflare) live only in
GitHub Actions / Cloudflare project secrets, never in the repository.
