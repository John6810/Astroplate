// English dictionary — source of truth for the key shape.
// fr.ts and ja.ts must declare the same keys (enforced via the Dict type).
// Values may contain inline HTML (e.g. <strong>) rendered with set:html.

const dict = {
  meta_title:
    "Jonathan Aerts — Senior Cloud Platform Architect | Azure Landing Zone | Belgium · Luxembourg",
  meta_description:
    "Senior Cloud Platform Architect, {it_years}+ years IT. Azure Landing Zones from scratch, Terraform/GitOps, enterprise governance. Belgium · Luxembourg.",

  hero_role:
    "Senior Cloud Platform Architect · Azure Landing Zone · Terraform/GitOps",
  hero_desc:
    "Senior Cloud Platform Architect with <strong>{it_years}+ years of IT experience</strong> and 5+ years focused on enterprise Azure environments. Specialised in designing and deploying <strong>Azure Landing Zones</strong> end-to-end — governance, multi-region networking, and full automation via Terraform/Terragrunt.",
  hero_label_email: "Email:",
  hero_label_from: "From:",
  hero_label_currently: "Currently:",
  hero_label_languages: "Languages:",
  hero_value_from: "Belgium · Luxembourg",
  hero_value_currently: "POST Luxembourg",

  stat_years_label: "years in IT",
  stat_azure_label: "years on Azure",
  stat_alz_label: "Landing Zones from scratch",
  stat_subscriptions_label: "Azure subscriptions governed",
  stat_modules_label: "production-ready Terraform modules",
  stat_trained_label: "engineers trained",

  section_experience: "Professional experience",
  section_skills: "Skills",
  section_projects: "Selected projects",
  section_education: "Education, certifications & languages",
  section_contact: "Contact",

  job1_title: "Senior Cloud Platform Architect",
  job1_meta: "Luxembourg",
  job1_date: "Aug 2024 — Present",
  job1_context:
    "Hired to build POST Luxembourg's cloud foundation — Grand Duchy telecom operator and postal bank, supervised by the CSSF. Mission: host the critical banking workloads on Azure under a compliant Cloud Outsourcing framework. No prior cloud footprint. {post_duration} of continuous delivery.",
  job1_b1:
    "<strong>Designed and delivered an Enterprise-Scale Azure Landing Zone</strong> across <strong>26 subscriptions</strong>, multi-region, aligned with Microsoft CAF and Azure Verified Modules — foundation eligible to host workloads under banking regulation.",
  job1_b2:
    "<strong>Aligned the platform with regulatory requirements</strong>: controls derived from <strong>CSSF Circular 22/806</strong> (Cloud Outsourcing), <strong>DORA</strong>, <strong>NIS2</strong> and <strong>ISO 27001</strong>, <strong>CIS Microsoft Azure</strong> baselines, <strong>zero persistent secrets</strong> (OIDC / Workload Identity end-to-end), Private Endpoints across all PaaS, customer-managed encryption everywhere.",
  job1_b3:
    "<strong>Industrialised Infrastructure as Code</strong>: <strong>75+ production-ready Terraform modules</strong>, single Terragrunt pipeline across the whole perimeter, automated drift detection — immutability and full audit-ready traceability.",
  job1_b4:
    "<strong>Built the application platform</strong>: private AKS clusters in GitOps (Argo CD), <strong>Azure Virtual Desktop</strong> (Host Pools, FSLogix ZRS, Private Endpoints), enterprise-grade observability (managed Prometheus + Grafana, 20+ dashboards), AMBA alerts aligned with Microsoft production guidance.",
  job1_b5:
    "<strong>Formalised internal governance</strong>: <strong>20 ADRs</strong>, 6 SRE runbooks, 10K-line enterprise wiki, strict naming / tagging / RBAC conventions — audit and onboarding foundation for future teams.",
  job1_b6:
    "<strong>Designing the multi-cloud strategy</strong>: multi-account AWS Landing Zone in design (Control Tower, SCPs, IaC) to address resilience and supplier diversification requirements imposed by <strong>DORA</strong>.",
  job1_b7:
    "<strong>Tooled the project with a suite of specialised AI agents</strong> — codified conventions and gotchas, assisted module generation and accelerated architecture reviews.",
  job1_link_github:
    "📦 terraform-azurerm-modules — my custom modules (open source) →",

  job2_title: "Cloud Architect — M365 & Azure Migration",
  job2_meta: "Mission: Luxembourg Airport",
  job2_date: "Aug 2023 — Jul 2024",
  job2_context:
    "Consulting mission via Alten for the IT modernisation of Luxembourg Airport — 24/7 critical infrastructure of Luxembourg air transport. Twofold goal: migrate mail to Microsoft 365 and lay the airport's first cloud foundations.",
  job2_b1:
    "<strong>Migrated 500+ on-premises Exchange mailboxes to Microsoft 365</strong> — hybrid coexistence, progressive cutover, on-prem decommissioning, zero service loss.",
  job2_b2:
    "<strong>Designed and deployed the airport’s first Azure Landing Zone</strong> — modular foundation aligned with Microsoft CAF, ready to host the IT department’s future workloads.",
  job2_b3:
    "<strong>Industrialised an initial library of reusable Terraform modules</strong> — IaC baseline that shaped the group’s cloud deployment strategy.",
  job2_b4:
    "<strong>Hardened the M365 security posture</strong>: Conditional Access, MFA across the board, <strong>CIS Microsoft 365 baselines</strong>, sensitivity labels, retention policies and Compliance Center.",
  job2_b5:
    "<strong>Migrated identity services to Entra ID</strong> — RBAC convention, SSO for the airport’s business applications.",

  job3_title: "Cloud & Infrastructure Architect",
  job3_meta: "Private Equity",
  job3_date: "Sep 2021 — Jul 2023",
  job3_context:
    "Global IT infrastructure modernisation at Astorg — European Private Equity fund, 250 users, 6 international offices (LU, FR, UK, DE, IT, US), supervised by the CSSF under AIFMD. Transformation from a legacy environment to a compliant hybrid Azure / Entra ID architecture.",
  job3_b1:
    "<strong>Led the global IT transformation</strong> across 6 international offices — on-site deployments (servers, storage, network, endpoints), inter-site network unification via <strong>Cisco Meraki SD-WAN</strong>, standards harmonisation.",
  job3_b2:
    "<strong>Designed the hybrid Azure architecture</strong>: VNETs, Private Endpoints, Key Vault, Entra ID — Terraform foundations developed from scratch.",
  job3_b3:
    "<strong>Deployed unified endpoint management</strong>: <strong>250 endpoints</strong> and 100+ mobile devices via Microsoft Intune, compliance and configuration policies aligned with CIS.",
  job3_b4:
    "<strong>Aligned the platform with PE regulatory requirements</strong>: <strong>CSSF AIFMD</strong>, <strong>ISO 27001</strong>, <strong>CIS Microsoft</strong> baselines, RBAC + PIM governance, systemic Azure Policy.",
  job3_b5:
    "<strong>Managed the infrastructure renewal budget</strong> (~<strong>€500K</strong>): vendor selection, negotiation, multi-country procurement.",

  job4_title: "IT-OT System Administrator",
  job4_meta: "Luxembourg",
  job4_date: "Jul 2019 — Aug 2021",
  job4_context:
    "Sole IT/OT administrator for a Guardian Industries industrial site — 24/7 continuous-production glass manufacturing, ~100 users. Mission: guarantee IT continuity under production constraints, with zero tolerance for outage.",
  job4_b1:
    "<strong>Single-handedly operated the production VMware environment</strong>: 10+ ESXi hosts, RDS/VDI infrastructure for operations, backups and recovery plan.",
  job4_b2:
    "<strong>Ran the Cisco network infrastructure</strong>: LAN/WAN, <strong>IT / OT</strong> segmentation, perimeter security for the industrial site.",
  job4_b3:
    "<strong>Deployed line-edge thin clients</strong>: hardened solutions for the industrial environment, integration with production business applications.",
  job4_b4:
    "<strong>Guaranteed 24/7 operational continuity</strong>: <strong>zero IT-attributable outage over 2 years</strong>, permanent on-call support under continuous production constraints.",

  job5_title: "System Engineer — Microsoft 365 & Infrastructure",
  job5_meta: "Luxembourg",
  job5_date: "Oct 2016 — Aug 2019",
  job5_context:
    "Systems engineer at GMS-it (<strong>Luxembourg MSP</strong>) — delivered end-to-end Microsoft 365 and infrastructure projects for <strong>7 Luxembourg SMB and trust company clients</strong>. Full ownership: technical design, deployment, support.",
  job5_b1:
    "<strong>Led Exchange on-prem to Microsoft 365 migrations</strong>: coexistence analysis, tenant setup, mailbox cutover, legacy on-prem decommissioning.",
  job5_b2:
    "<strong>Designed and delivered client infrastructure projects</strong>: network modernisation, virtualisation, perimeter security, backups.",
  job5_b3:
    "<strong>Industrialised M365 deployment standards</strong>: Conditional Access, MFA, RBAC, hardening baselines — rolled out across the 7 client environments.",
  job5_b4:
    "<strong>Ensured run & continuous evolution</strong>: L3 support, critical incident management, infrastructure roadmap planning.",

  job6_title: "VMware Consultant — Global Virtualization Project",
  job6_meta: "Mission: TI Automotive · Belgium",
  job6_date: "Jan 2014 — Sep 2016",
  job6_context:
    "Consulting mission via Computacenter for <strong>TI Automotive</strong>’s global virtualisation project — tier-1 automotive supplier with multiple international plants. Multicultural and distributed environment, multi-country travel.",
  job6_b1:
    "<strong>Led the global VMware virtualisation project</strong>: <strong>200+ ESXi hosts</strong> across all international production sites.",
  job6_b2:
    "<strong>Performed P2V migrations</strong>: legacy physical server cutover to vSphere, on-site deployments in multiple countries.",
  job6_b3:
    "<strong>Administered large-scale vSphere infrastructure</strong>: provisioning, performance troubleshooting, resource optimisation across the global perimeter.",

  job7_title: "System & Network Administrator",
  job7_meta: "Brussels",
  job7_date: "Sep 2007 — Dec 2013",
  job7_context:
    "System and network administrator at <strong>ETNIC</strong> — public IT operator of the <strong>Wallonia-Brussels Federation</strong>, supporting the Belgian French-speaking education system (schools and institutions). Broad infrastructure scope: Cisco network, VMware virtualisation, 100+ Windows servers.",
  job7_b1:
    "<strong>Administered the Cisco network</strong>: switching, routing, VLAN segmentation at organisation scale.",
  job7_b2:
    "<strong>Managed the VMware infrastructure</strong>: ESXi host management, VM provisioning and maintenance.",
  job7_b3:
    "<strong>Maintained a fleet of 100+ Windows servers</strong>: system administration, support for schools and institutions of the French-speaking Community of Belgium.",

  skills_mastering: "I know",
  skills_learning: "Learning",
  skills_speak: "I speak",
  cat_cloud: "Cloud & Architecture",
  cat_iac: "IaC & GitOps",
  cat_network: "Networking & Security",
  cat_identity: "Identity & Governance",
  cat_observ: "Observability & Adjacent",
  level_expert: "EXPERT",
  level_avance: "ADVANCED",
  lang_fr: "French — Native",
  lang_en: "English — C1 fluent",
  lang_jp: "日本語 — JLPT N2 in preparation · N5 certified",
  learning_aws: "AWS Landing Zone · Control Tower · SCPs",

  proj1_title: "Terraform Azure Module Library",
  proj1_tagline: "Open source library · AVM / CAF-aligned",
  proj1_desc:
    "Open source library of Azure Terraform modules I maintain — networking, AKS, Key Vault, RBAC, Private Endpoints, FinOps Hub, Palo Alto HA, and more. AVM patterns (validation, lookup, locks), telemetry, diagnostic settings and naming conventions by default.",
  proj1_link: "📦 github.com/John6810/terraform-azurerm-modules →",
  proj2_title: "Distributed Scoring Platform",
  proj2_tagline: "Event-driven · K8s / ArgoCD · 359 tests",
  proj2_desc:
    "Distributed multi-criteria scoring platform deployed in GitOps on a personal Kubernetes cluster. Multi-layer architecture: CLI (19 commands), FastAPI REST API (19 endpoints), Kubernetes CronJobs for automated scan pipelines, Discord companion bot. Modular business logic, validated by 359 pytest tests, GitOps deployment via Argo CD.",
  proj3_title: "Homelab Kubernetes",
  proj3_tagline: "Bare-metal cluster · GitOps end-to-end",
  proj3_desc:
    "Bare-metal 2-node Kubernetes cluster, GitOps via ArgoCD ApplicationSet, Prometheus/Grafana observability, Traefik ingress, MetalLB for L2 load balancing, hybrid SMB/RawFile CSI storage. Sealed Secrets for GitOps-managed secrets. Sandbox for validating patterns before production.",

  edu_eb_diplome: "Degree",
  edu_eb_langs: "Languages",
  edu_eb_certs_done: "Certifications obtained",
  edu_eb_certs_wip: "In progress",
  edu_degree_title: "Bachelor — Computer Science & Systems",
  edu_degree_school:
    "Haute École de la Province de Liège, Belgium · 2003 – 2007",

  contact_desc:
    "Target roles: Senior / Principal Cloud Architect, Cloud Solution Architect, or Customer Success Engineer — at a hyperscaler (Microsoft, AWS, HashiCorp), a tech scale-up or a regulated enterprise environment.",
  contact_cta_blog: "📝 Read the blog",
};

export type Dict = Record<keyof typeof dict, string>;
export default dict;
