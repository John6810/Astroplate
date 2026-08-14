import type { Dict } from "./en";

const dict: Dict = {
  meta_title:
    "ジョナサン・アールツ（Jonathan Aerts）— シニアクラウドプラットフォームアーキテクト | Azure・Terraform | ベルギー／ルクセンブルク",
  meta_description:
    "ジョナサン・アールツ（Jonathan Aerts）— {it_years}年以上のIT経験を持つシニアクラウドプラットフォームアーキテクト。Azure Landing Zoneのゼロからの構築、Terraform／Terragrunt・GitOpsによる自動化、エンタープライズガバナンス。ベルギー・ルクセンブルク拠点。日本語学習中（JLPT N5取得、N2準備中）。",

  hero_role:
    "シニアクラウドプラットフォームアーキテクト · Azure Landing Zone · Terraform/GitOps",
  hero_desc:
    "<strong>{it_years}年以上のIT経験</strong>と5年以上のAzureエンタープライズ環境を専門とするシニアクラウドプラットフォームアーキテクト。<strong>Azure Landing Zone</strong>のゼロからの設計・展開、ガバナンス、マルチリージョンネットワーキング、Terraform/Terragruntによる完全自動化を専門としています。",
  hero_label_email: "Email：",
  hero_label_from: "居住地：",
  hero_label_currently: "現職：",
  hero_label_languages: "言語：",
  hero_value_from: "ベルギー・ルクセンブルク",
  hero_value_currently: "POST Luxembourg",
  hero_download_pdf: "履歴書をダウンロード（PDF）",

  stat_years_label: "年のIT経験",
  stat_budget_label: "運用クラウド予算",
  stat_alz_label: "Landing Zones（ゼロから構築）",
  stat_subscriptions_label: "管理対象 Azure サブスクリプション",
  stat_modules_label: "プロダクションレディTerraformモジュール",
  stat_trained_label: "名のエンジニア育成",

  section_experience: "職務経歴",
  section_skills: "スキル",
  section_projects: "主要プロジェクト",
  section_education: "学歴・資格・言語",
  section_contact: "連絡先",

  job1_title: "Senior Cloud Platform Architect",
  job1_meta: "ルクセンブルク",
  job1_date: "2024年8月 — 現在",
  job1_context:
    "POST Luxembourg（ルクセンブルクの通信事業者および郵便銀行、CSSF監督下）のクラウド基盤をゼロから構築するために採用。ミッション：銀行業務の重要ワークロードを、コンプライアンス準拠のCloud Outsourcingの枠組みでAzureに収容する。前任なし。{post_duration}の継続的デリバリー。約200万ユーロのクラウド予算を運用。",
  job1_b1:
    "<strong>Enterprise-Scale Azure Landing Zoneを設計・展開</strong> — <strong>26サブスクリプション</strong>、マルチリージョン、Microsoft CAFおよびAzure Verified Modules準拠、銀行規制下のワークロードを収容可能な基盤。",
  job1_b2:
    "<strong>規制要件にプラットフォームを整合</strong>：<strong>CSSF Circular 22/806</strong>（Cloud Outsourcing）、<strong>DORA</strong>、<strong>NIS2</strong>、<strong>ISO 27001</strong>由来の統制、<strong>CIS Microsoft Azure</strong>ベースライン、<strong>永続的シークレットゼロ</strong>(OIDC / Workload Identity エンドツーエンド)、全PaaSへのPrivate Endpoints、顧客管理鍵暗号化を全面採用。",
  job1_b3:
    "<strong>IaCを工業化</strong>：<strong>75以上のプロダクションレディTerraformモジュール</strong>、全領域共通のTerragruntパイプライン、自動ドリフト検出 — イミュータビリティと監査対応のトレーサビリティを確保。",
  job1_b4:
    "<strong>アプリケーション基盤を構築</strong>：GitOps（Argo CD）によるプライベートAKSクラスター、<strong>Azure Virtual Desktop</strong>（Host Pools、FSLogix ZRS、Private Endpoints）による準拠仮想デスクトップ、エンタープライズ級の可観測性（マネージドPrometheus + Grafana、20以上のダッシュボード）、Microsoftプロダクション推奨に準拠したAMBAアラート。",
  job1_b5:
    "<strong>内部ガバナンスを文書化</strong>：<strong>20件のADR</strong>、6件のSREランブック、1万行のエンタープライズWiki、命名 / タギング / RBAC の厳格な規約 — 監査と将来のチーム受入れのための基盤。",
  job1_b6:
    "<strong>マルチクラウド戦略を設計中</strong>：<strong>DORA</strong>が要求するレジリエンスとサプライヤー多様化に対応するため、AWS マルチアカウント Landing Zone（Control Tower、SCPs、IaC）を設計中。",
  job1_b7:
    "<strong>プロジェクトに専門化AIエージェント群を導入</strong> — 規約とハマりどころのコード化、モジュール生成支援、アーキテクチャレビューの加速化。",
  job1_link_github:
    "📦 terraform-azurerm-modules — 自作モジュール（オープンソース） →",

  job2_title: "Cloud Architect — M365 & Azureマイグレーション",
  job2_meta: "ミッション：ルクセンブルク空港",
  job2_date: "2023年8月 — 2024年7月",
  job2_context:
    "ルクセンブルク空港のIT近代化のため、Alten経由でコンサルティングミッション — ルクセンブルク航空輸送の24時間365日稼働の重要インフラ。二重の目標：メールをMicrosoft 365に移行し、空港初のクラウド基盤を整備すること。",
  job2_b1:
    "<strong>オンプレミスExchangeのメールボックス500超をMicrosoft 365へ移行</strong> — ハイブリッド共存、段階的切替、オンプレミス撤去、サービス無停止。",
  job2_b2:
    "<strong>空港初のAzure Landing Zoneを設計・展開</strong> — Microsoft CAFに準拠したモジュラー基盤、情報システム部門の将来のワークロードを収容可能。",
  job2_b3:
    "<strong>再利用可能なTerraformモジュールの初期ライブラリを整備</strong> — グループのクラウド展開戦略を方向づけたIaCベースライン。",
  job2_b4:
    "<strong>M365のセキュリティ態勢を強化</strong>：Conditional Access、MFA全面適用、<strong>CIS Microsoft 365 ベースライン</strong>、機密ラベル、保持ポリシー、Compliance Center。",
  job2_b5:
    "<strong>IDサービスをEntra IDに移行</strong> — RBAC規約、空港業務アプリケーションのSSO。",

  job3_title: "Cloud & インフラアーキテクト",
  job3_meta: "Private Equity",
  job3_date: "2021年9月 — 2023年7月",
  job3_context:
    "Astorg（欧州プライベートエクイティファンド、250ユーザー、国際6拠点：LU、FR、UK、DE、IT、US、CSSFのAIFMD監督下）のITインフラのグローバル近代化。レガシー環境から、コンプライアンス準拠のAzure / Entra IDハイブリッドアーキテクチャへの転換。",
  job3_b1:
    "<strong>グローバルIT変革を主導</strong> — 6つの国際拠点でのオンサイト展開（サーバー、ストレージ、ネットワーク、エンドポイント）、<strong>Cisco Meraki SD-WAN</strong>による拠点間ネットワーク統合、標準の統一。",
  job3_b2:
    "<strong>Azureハイブリッドアーキテクチャを設計</strong>：VNETs、Private Endpoints、Key Vault、Entra ID — ゼロからのTerraform基盤構築。",
  job3_b3:
    "<strong>統合エンドポイント管理を展開</strong>：Microsoft Intune経由で<strong>250台</strong>のPCと100台超のモバイルデバイス、CIS準拠のコンプライアンスおよび構成ポリシー。",
  job3_b4:
    "<strong>PE規制要件にプラットフォームを整合</strong>：<strong>CSSF AIFMD</strong>、<strong>ISO 27001</strong>、<strong>CIS Microsoft</strong>ベースライン、RBAC + PIMガバナンス、システム全体のAzure Policy。",
  job3_b5:
    "<strong>インフラ刷新予算を運用</strong>（約<strong>€500K</strong>）：ベンダー選定、交渉、多国間調達。",

  job4_title: "IT-OTシステム管理者",
  job4_meta: "ルクセンブルク",
  job4_date: "2019年7月 — 2021年8月",
  job4_context:
    "Guardian Industriesの産業サイトの唯一のIT/OT管理者 — 24時間連続稼働のガラス製造、約100ユーザー。ミッション：生産制約下でITの継続性を保証し、ダウンタイム許容ゼロ。",
  job4_b1:
    "<strong>プロダクションVMware環境を単独で運用</strong>：ESXiホスト10台超、運用向けRDS/VDIインフラ、バックアップと復旧計画。",
  job4_b2:
    "<strong>Ciscoネットワークインフラを管理</strong>：LAN/WAN、<strong>IT / OT</strong>セグメンテーション、産業サイトの境界セキュリティ。",
  job4_b3:
    "<strong>ライン端のシンクライアントを展開</strong>：産業環境向けの堅牢化ソリューション、生産業務アプリケーションとの統合。",
  job4_b4:
    "<strong>24/7運用継続性を保証</strong>：<strong>2年間ITに起因するダウンタイムゼロ</strong>、連続稼働制約下での常時オンコール対応。",

  job5_title: "システムエンジニア — Microsoft 365 & インフラ",
  job5_meta: "ルクセンブルク",
  job5_date: "2016年10月 — 2019年8月",
  job5_context:
    "GMS-it（<strong>ルクセンブルクのMSP</strong>）のシステムエンジニア — <strong>ルクセンブルクの中小企業および信託会社7社</strong>に対し、Microsoft 365およびインフラプロジェクトをエンドツーエンドで提供。完全なオーナーシップ：技術設計、展開、サポート。",
  job5_b1:
    "<strong>オンプレミスExchangeからMicrosoft 365への移行を主導</strong>：共存分析、テナント構築、メールボックス切替、レガシーオンプレミスの撤去。",
  job5_b2:
    "<strong>顧客インフラプロジェクトを設計・展開</strong>：ネットワーク近代化、仮想化、境界セキュリティ、バックアップ。",
  job5_b3:
    "<strong>M365展開標準を工業化</strong>：Conditional Access、MFA、RBAC、強化ベースライン — 顧客7環境に展開。",
  job5_b4:
    "<strong>運用と継続的進化を担保</strong>：N3サポート、重大インシデント管理、インフラ進化計画。",

  job6_title: "VMwareコンサルタント — グローバル仮想化プロジェクト",
  job6_meta: "ミッション：TI Automotive · ベルギー",
  job6_date: "2014年1月 — 2016年9月",
  job6_context:
    "Computacenter経由のコンサルティングミッション — <strong>TI Automotive</strong>のグローバル仮想化プロジェクト、複数の国際工場を持つ大手自動車部品サプライヤー。多文化・分散環境、多国間出張。",
  job6_b1:
    "<strong>グローバルVMware仮想化プロジェクトを主導</strong>：全国際生産拠点で<strong>200台超のESXiホスト</strong>。",
  job6_b2:
    "<strong>P2V移行を実施</strong>：レガシー物理サーバーをvSphereに切替、複数国でのオンサイト展開。",
  job6_b3:
    "<strong>大規模vSphereインフラを管理</strong>：プロビジョニング、パフォーマンストラブルシューティング、グローバル領域のリソース最適化。",

  job7_title: "システム & ネットワーク管理者",
  job7_meta: "ブリュッセル",
  job7_date: "2007年9月 — 2013年12月",
  job7_context:
    "<strong>ETNIC</strong>のシステム・ネットワーク管理者 — <strong>ワロニー＝ブリュッセル連合</strong>の公共IT事業者、ベルギーのフランス語圏教育システム（学校・機関）を支援。広範なインフラ領域：Ciscoネットワーク、VMware仮想化、Windowsサーバー100台超。",
  job7_b1:
    "<strong>Ciscoネットワークを管理</strong>：スイッチング、ルーティング、組織規模のVLANセグメンテーション。",
  job7_b2:
    "<strong>VMwareインフラを運用</strong>：ESXiホスト管理、VMのプロビジョニングと保守。",
  job7_b3:
    "<strong>Windowsサーバー100台超を維持管理</strong>：システム管理、ベルギーフランス語圏共同体の学校・機関のサポート。",

  skills_mastering: "習得済み",
  skills_learning: "学習中",
  skills_speak: "話す言語",
  cat_cloud: "クラウド & アーキテクチャ",
  cat_iac: "IaC & GitOps",
  cat_network: "ネットワーク & セキュリティ",
  cat_identity: "ID & ガバナンス",
  cat_observ: "可観測性 & 周辺",
  level_expert: "エキスパート",
  level_avance: "上級",
  lang_fr: "フランス語 — 母国語",
  lang_en: "英語 — C1 流暢",
  lang_jp: "日本語 — JLPT N2準備中 · N5取得",
  learning_aws: "AWS Landing Zone · Control Tower · SCPs",

  proj1_title: "Terraform Azure モジュールライブラリ",
  proj1_tagline: "オープンソースライブラリ · AVM / CAF 準拠",
  proj1_desc:
    "私がメンテナンスしているAzure Terraformモジュールのオープンソースライブラリ — ネットワーキング、AKS、Key Vault、RBAC、Private Endpoints、FinOps Hub、Palo Alto HA など。AVMパターン（バリデーション、lookup、ロック）、テレメトリ、診断設定、命名規約をデフォルトで実装。",
  proj1_link: "📦 github.com/John6810/terraform-azurerm-modules →",
  proj2_title: "分散スコアリングプラットフォーム",
  proj2_tagline: "イベント駆動 · K8s / ArgoCD · 359 テスト",
  proj2_desc:
    "個人のKubernetesクラスター上にGitOpsでデプロイされた、分散型の多基準スコアリングプラットフォーム。多層アーキテクチャ：CLI（19コマンド）、FastAPI REST API（19エンドポイント）、自動スキャンパイプライン用のKubernetes CronJob、通知用のDiscordコンパニオンボット。モジュール化されたビジネスロジック、359個のpytestテストによる検証、Argo CDによるGitOpsデプロイ。",
  proj3_title: "ホームラボ Kubernetes",
  proj3_tagline: "ベアメタルクラスター · GitOps エンドツーエンド",
  proj3_desc:
    "2ノードのベアメタルKubernetesクラスター、ArgoCD ApplicationSetによるGitOps、Prometheus/Grafanaによる可観測性、Traefikイングレス、L2ロードバランシング用のMetalLB、SMB/RawFile CSIによるハイブリッドストレージ。GitOps管理のシークレットのためのSealed Secrets。本番投入前のパターン検証用サンドボックス。",

  edu_eb_diplome: "学位",
  edu_eb_langs: "言語",
  edu_eb_certs_done: "取得済み資格",
  edu_eb_certs_wip: "取得中",
  edu_degree_title: "学士 — コンピュータサイエンス & システム",
  edu_degree_school:
    "Haute École de la Province de Liège、ベルギー · 2003 – 2007",

  contact_desc:
    "希望職種：Senior / Principal Cloud Architect、Cloud Solution Architect、または Customer Success Engineer — ハイパースケーラー、テックスケールアップ、または規制下のエンタープライズ環境にて。",
  contact_cta_blog: "📝 ブログを読む",
};

export default dict;
