-- OpenStock Japan v0.1 初期スキーマ (1/3): テーブル・索引・トリガー
-- §1 組織・認証  §2 会社情報（事業年度・役員）  §3 株主・株式  §4 転換型証券（J-KISS 等）
-- §5 新株予約権（ストックオプション）  §6 株主総会・取締役会  §7 決算情報  §8 文書ライブラリ・共有
-- §9 株主向けお知らせ  §10 AI  §11 監査ログ  §12 トリガー
-- 規約: マイグレーションは追記のみ・DDL 専用（データは supabase/seeds/ に置く）。
-- 列名は camelCase（二重引用符つき）。金額は円（numeric）、株式数・個数は bigint。

create extension if not exists "pgcrypto";

-- §1 組織・認証 ------------------------------------------------------------

-- 1 デプロイ = 1 社を想定するが、スキーマは組織で分離する。
-- 機関設計・定款の定めは、招集通知の期限や決議要件の計算（src/lib/legal）に使う。
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null,
  "nameKana" varchar(200),
  "nameEn" varchar(200),
  "corporateNumber" varchar(13),
  "postalCode" varchar(8),
  address varchar(255),
  phone varchar(20),
  website varchar(255),
  "representativeName" varchar(100),
  "representativeTitle" varchar(100),
  "establishedOn" date,
  "businessDescription" text,
  "fiscalYearStartMonth" smallint,
  -- 資本
  "capitalAmount" numeric(18, 0),
  "capitalReserveAmount" numeric(18, 0),
  "authorizedShares" bigint,
  -- 機関設計
  "isPublicCompany" boolean not null default false,
  "hasBoardOfDirectors" boolean not null default true,
  "hasAuditor" boolean not null default true,
  -- 監査役の監査の範囲を会計に限定する定款の定め（会社法389条）。限定している会社は「監査役設置会社」（2条9号）に当たらない。
  "auditorLimitedToAccounting" boolean not null default false,
  "hasTransferRestriction" boolean not null default true,
  "issuesShareCertificates" boolean not null default false,
  "publicNoticeMethod" varchar(20),
  -- 定款の定め（null は法定どおり）
  "shareholderMeetingNoticeDays" smallint,
  "boardMeetingNoticeDays" smallint,
  "directorTermYears" smallint,
  "auditorTermYears" smallint,
  "allowsBoardWrittenResolution" boolean not null default false,
  "recordDateRule" varchar(200),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint organizations_fiscal_start_month_check
    check ("fiscalYearStartMonth" is null or ("fiscalYearStartMonth" between 1 and 12)),
  constraint organizations_public_notice_check
    check ("publicNoticeMethod" is null or "publicNoticeMethod" in ('official_gazette', 'newspaper', 'electronic')),
  constraint organizations_amounts_check
    check (
      ("capitalAmount" is null or "capitalAmount" >= 0)
      and ("capitalReserveAmount" is null or "capitalReserveAmount" >= 0)
      and ("authorizedShares" is null or "authorizedShares" > 0)
    ),
  constraint organizations_notice_days_check
    check (
      ("shareholderMeetingNoticeDays" is null or "shareholderMeetingNoticeDays" between 0 and 60)
      and ("boardMeetingNoticeDays" is null or "boardMeetingNoticeDays" between 0 and 60)
      and ("directorTermYears" is null or "directorTermYears" between 1 and 10)
      and ("auditorTermYears" is null or "auditorTermYears" between 1 and 10)
    )
);

-- ロール: admin（管理者）/ logger（社内メンバー・編集可）/ viewer（社内・閲覧のみ）/ shareholder（株主。株主ポータルのみ）
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  "organizationId" uuid not null references organizations(id) on delete cascade,
  email varchar(255) not null,
  "fullName" varchar(100),
  role varchar(50) not null default 'logger',
  phone varchar(20),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint profiles_role_check check (role in ('admin', 'logger', 'viewer', 'shareholder'))
);

create unique index profiles_organization_email_idx on profiles ("organizationId", email);

create table invites (
  token uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  email varchar(255) not null,
  role varchar(50) not null default 'logger',
  "invitedByUserId" uuid references auth.users(id) on delete set null,
  "expiresAt" timestamptz not null default (now() + interval '7 days'),
  "acceptedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  constraint invites_role_check check (role in ('admin', 'logger', 'viewer', 'shareholder'))
);

create unique index invites_org_email_pending_idx on invites ("organizationId", email) where "acceptedAt" is null;
create index "invites_organizationId_idx" on invites ("organizationId");

-- §2 会社情報 --------------------------------------------------------------

create table fiscal_years (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid references organizations(id) on delete cascade,
  label varchar(50) not null,
  "startDate" date not null,
  "endDate" date not null,
  "createdAt" timestamptz not null default now()
);

create index fiscal_years_organization_id_idx on fiscal_years ("organizationId");
create index fiscal_years_organization_period_idx on fiscal_years ("organizationId", "startDate", "endDate");

-- §3 株主・株式 ------------------------------------------------------------

-- 株主・新株予約権者・J-KISS 投資家などの「権利者」。株主名簿の記載事項（会社法121条）のうち
-- 氏名又は名称・住所をここに、株式数・取得日は share_transactions から導出する。
create table stakeholders (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  name varchar(200) not null,
  "nameKana" varchar(200),
  kind varchar(20) not null default 'individual',
  relationship varchar(20) not null default 'investor',
  "postalCode" varchar(8),
  address varchar(500) not null default '',
  email varchar(255),
  phone varchar(20),
  "contactPerson" varchar(100),
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint stakeholders_kind_check check (kind in ('individual', 'corporation', 'fund', 'other')),
  constraint stakeholders_relationship_check
    check (relationship in ('founder', 'officer', 'employee', 'investor', 'advisor', 'other'))
);

create index "stakeholders_organizationId_idx" on stakeholders ("organizationId");

-- 株主ポータルのアカウント（role = shareholder）と権利者の紐づけ。
alter table profiles add column "stakeholderId" uuid references stakeholders(id) on delete set null;
alter table invites add column "stakeholderId" uuid references stakeholders(id) on delete cascade;
create unique index profiles_stakeholder_idx on profiles ("stakeholderId") where "stakeholderId" is not null;

create table officers (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "stakeholderId" uuid references stakeholders(id) on delete set null,
  name varchar(100) not null,
  "nameKana" varchar(100),
  position varchar(30) not null default 'director',
  "isOutside" boolean not null default false,
  "appointedOn" date,
  "termExpiresOn" date,
  "retiredOn" date,
  "registeredOn" date,
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint officers_position_check
    check (position in ('representative_director', 'director', 'auditor', 'accounting_advisor', 'executive_officer', 'other'))
);

create index "officers_organizationId_idx" on officers ("organizationId");

-- 株式の種類（会社法108条）。優先分配の計算（src/lib/equity/waterfall.ts）に使う条件を持つ。
create table share_classes (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  name varchar(100) not null,
  kind varchar(20) not null default 'common',
  seniority smallint not null default 0,
  "originalIssuePrice" numeric(18, 4),
  "liquidationMultiple" numeric(6, 2) not null default 1,
  participation varchar(30) not null default 'non_participating',
  "participationCapMultiple" numeric(6, 2),
  "conversionRatio" numeric(18, 8) not null default 1,
  "hasVotingRights" boolean not null default true,
  "antiDilution" varchar(30) not null default 'none',
  "dividendPreference" varchar(500) not null default '',
  "authorizedShares" bigint,
  terms text not null default '',
  "sortOrder" integer not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint share_classes_kind_check check (kind in ('common', 'preferred', 'other')),
  constraint share_classes_participation_check
    check (participation in ('non_participating', 'participating', 'capped_participating')),
  constraint share_classes_anti_dilution_check
    check ("antiDilution" in ('none', 'broad_weighted_average', 'narrow_weighted_average', 'full_ratchet')),
  constraint share_classes_values_check
    check (
      "liquidationMultiple" >= 0
      and "conversionRatio" > 0
      and ("originalIssuePrice" is null or "originalIssuePrice" >= 0)
      and ("participationCapMultiple" is null or "participationCapMultiple" >= 0)
      and ("authorizedShares" is null or "authorizedShares" > 0)
    ),
  constraint share_classes_name_unique unique ("organizationId", name)
);

-- 資金調達ラウンド（株価つき）。実際の株式の動きは share_transactions（roundId で紐づけ）。
create table funding_rounds (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  name varchar(100) not null,
  "roundType" varchar(20) not null default 'seed',
  status varchar(20) not null default 'planned',
  "shareClassId" uuid references share_classes(id) on delete restrict,
  "closingDate" date,
  "pricePerShare" numeric(18, 4),
  "preMoneyValuation" numeric(18, 0),
  "targetAmount" numeric(18, 0),
  "resolutionDate" date,
  "registrationDate" date,
  "capitalIncreaseAmount" numeric(18, 0),
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint funding_rounds_type_check
    check ("roundType" in ('founding', 'angel', 'seed', 'pre_series_a', 'series_a', 'series_b', 'series_c', 'later', 'bridge', 'other')),
  constraint funding_rounds_status_check check (status in ('planned', 'closed')),
  constraint funding_rounds_values_check
    check (
      ("pricePerShare" is null or "pricePerShare" >= 0)
      and ("preMoneyValuation" is null or "preMoneyValuation" >= 0)
      and ("targetAmount" is null or "targetAmount" >= 0)
      and ("capitalIncreaseAmount" is null or "capitalIncreaseAmount" >= 0)
    )
);

create index "funding_rounds_organizationId_idx" on funding_rounds ("organizationId");

-- 株式の異動台帳。持株数は名義人 × 種類ごとの shares の合計（取得は正、譲渡・消却は負）。
-- 譲渡は譲渡人（負）と譲受人（正）の 2 行を同じ groupId で記録する（アプリが 1 操作で作る）。
create table share_transactions (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "stakeholderId" uuid not null references stakeholders(id) on delete restrict,
  "shareClassId" uuid not null references share_classes(id) on delete restrict,
  "roundId" uuid references funding_rounds(id) on delete set null,
  "groupId" uuid,
  "transactionDate" date not null,
  "transactionType" varchar(20) not null,
  shares bigint not null,
  "pricePerShare" numeric(18, 4),
  amount numeric(18, 0),
  "capitalAmount" numeric(18, 0),
  counterparty varchar(200) not null default '',
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint share_transactions_type_check
    check ("transactionType" in ('founding', 'new_issue', 'transfer', 'split', 'exercise', 'conversion', 'acquisition', 'cancellation', 'other')),
  constraint share_transactions_shares_check check (shares <> 0),
  constraint share_transactions_values_check
    check (
      ("pricePerShare" is null or "pricePerShare" >= 0)
      and (amount is null or amount >= 0)
      and ("capitalAmount" is null or "capitalAmount" >= 0)
    )
);

create index "share_transactions_organizationId_idx" on share_transactions ("organizationId", "transactionDate");
create index "share_transactions_stakeholderId_idx" on share_transactions ("stakeholderId");
create index "share_transactions_groupId_idx" on share_transactions ("groupId") where "groupId" is not null;

-- §4 転換型証券（J-KISS 型新株予約権など） ----------------------------------

create table convertible_rounds (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "roundNo" integer not null,
  name varchar(100) not null,
  "instrumentType" varchar(20) not null default 'jkiss',
  "issueDate" date,
  "valuationCap" numeric(18, 0),
  -- 評価上限額の基準。post_money = 転換型の転換後を含む株式数で割る（J-KISS 2.0）/ pre_money = 含めない（J-KISS 1.x）
  "capBasis" varchar(20) not null default 'post_money',
  "discountRate" numeric(5, 4) not null default 0.2,
  "qualifiedFinancingAmount" numeric(18, 0),
  "conversionDeadline" date,
  status varchar(20) not null default 'outstanding',
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint convertible_rounds_instrument_check check ("instrumentType" in ('jkiss', 'convertible_bond', 'other')),
  constraint convertible_rounds_status_check check (status in ('outstanding', 'converted', 'redeemed')),
  constraint convertible_rounds_cap_basis_check check ("capBasis" in ('pre_money', 'post_money')),
  constraint convertible_rounds_values_check
    check (
      "roundNo" between 1 and 1000
      and ("valuationCap" is null or "valuationCap" > 0)
      and "discountRate" >= 0 and "discountRate" < 1
      and ("qualifiedFinancingAmount" is null or "qualifiedFinancingAmount" > 0)
    ),
  constraint convertible_rounds_no_unique unique ("organizationId", "roundNo")
);

create table convertible_investments (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "roundId" uuid not null references convertible_rounds(id) on delete cascade,
  "stakeholderId" uuid not null references stakeholders(id) on delete restrict,
  amount numeric(18, 0) not null,
  "investmentDate" date,
  "convertedShares" bigint,
  "convertedOn" date,
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint convertible_investments_values_check
    check (amount > 0 and ("convertedShares" is null or "convertedShares" >= 0))
);

create index "convertible_investments_roundId_idx" on convertible_investments ("roundId");
create index "convertible_investments_stakeholderId_idx" on convertible_investments ("stakeholderId");

-- §5 新株予約権（ストックオプション） ---------------------------------------

-- 回次ごとの発行要項。新株予約権原簿（会社法249条）の「内容及び数」に当たる。
-- fairValuePerShare は付与契約時の 1 株あたり時価（税制適格の「行使価額 ≧ 時価」判定に使う）。
create table option_plans (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  name varchar(100) not null,
  "planType" varchar(20) not null default 'tax_qualified',
  "shareClassId" uuid references share_classes(id) on delete restrict,
  "resolutionDate" date,
  "allotmentDate" date,
  "totalUnits" bigint not null,
  "sharesPerUnit" bigint not null default 1,
  "exercisePrice" numeric(18, 4) not null,
  "issuePrice" numeric(18, 4) not null default 0,
  "fairValuePerShare" numeric(18, 4),
  "exercisePeriodStart" date,
  "exercisePeriodEnd" date,
  "vestingMonths" integer,
  "cliffMonths" integer,
  "vestingInterval" varchar(20) not null default 'monthly',
  "exerciseConditions" text not null default '',
  "registeredOn" date,
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint option_plans_type_check check ("planType" in ('tax_qualified', 'non_qualified', 'paid', 'trust', 'other')),
  constraint option_plans_interval_check check ("vestingInterval" in ('monthly', 'quarterly', 'yearly')),
  constraint option_plans_values_check
    check (
      "totalUnits" > 0 and "sharesPerUnit" > 0 and "exercisePrice" >= 0 and "issuePrice" >= 0
      and ("fairValuePerShare" is null or "fairValuePerShare" >= 0)
      and ("vestingMonths" is null or "vestingMonths" between 0 and 600)
      and ("cliffMonths" is null or "cliffMonths" between 0 and 600)
      and ("exercisePeriodStart" is null or "exercisePeriodEnd" is null or "exercisePeriodEnd" >= "exercisePeriodStart")
    )
);

create index "option_plans_organizationId_idx" on option_plans ("organizationId");

-- 割当て（新株予約権者ごと）。行使・失効は option_events に日付つきで記録し、残数は導出する。
create table option_grants (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "planId" uuid not null references option_plans(id) on delete cascade,
  "stakeholderId" uuid not null references stakeholders(id) on delete restrict,
  "holderRole" varchar(30) not null default 'employee',
  units bigint not null,
  "grantedOn" date,
  "vestingStartOn" date,
  "contractSignedOn" date,
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint option_grants_role_check
    check ("holderRole" in ('director', 'employee', 'subsidiary_director', 'subsidiary_employee', 'advisor', 'other')),
  constraint option_grants_units_check check (units > 0)
);

create index "option_grants_planId_idx" on option_grants ("planId");
create index "option_grants_stakeholderId_idx" on option_grants ("stakeholderId");

create table option_events (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "grantId" uuid not null references option_grants(id) on delete cascade,
  "eventType" varchar(20) not null,
  "eventDate" date not null,
  units bigint not null,
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint option_events_type_check check ("eventType" in ('exercise', 'forfeit')),
  constraint option_events_units_check check (units > 0)
);

create index "option_events_grantId_idx" on option_events ("grantId");

-- §6 株主総会・取締役会 ------------------------------------------------------

create table meetings (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "meetingType" varchar(20) not null,
  title varchar(200) not null,
  format varchar(20) not null default 'in_person',
  status varchar(20) not null default 'planning',
  "fiscalYearId" uuid references fiscal_years(id) on delete set null,
  "heldOn" date,
  "startTime" varchar(5),
  place varchar(300) not null default '',
  "recordDate" date,
  "noticeSentOn" date,
  chairperson varchar(100) not null default '',
  "minutesPreparer" varchar(100) not null default '',
  "attendingOfficers" text not null default '',
  "totalVotingRights" bigint,
  "presentVotingRights" bigint,
  "presentShareholders" integer,
  "minutesBody" text not null default '',
  "minutesFinalizedOn" date,
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint meetings_type_check check ("meetingType" in ('agm', 'egm', 'class_meeting', 'board')),
  constraint meetings_format_check check (format in ('in_person', 'online', 'hybrid', 'written_resolution')),
  constraint meetings_status_check check (status in ('planning', 'noticed', 'held', 'closed')),
  constraint meetings_start_time_check check ("startTime" is null or "startTime" ~ '^[0-2][0-9]:[0-5][0-9]$'),
  constraint meetings_counts_check
    check (
      ("totalVotingRights" is null or "totalVotingRights" >= 0)
      and ("presentVotingRights" is null or "presentVotingRights" >= 0)
      and ("presentShareholders" is null or "presentShareholders" >= 0)
    )
);

create index "meetings_organizationId_idx" on meetings ("organizationId", "heldOn");

create table meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "meetingId" uuid not null references meetings(id) on delete cascade,
  "sortOrder" integer not null default 0,
  title varchar(300) not null,
  "itemType" varchar(20) not null default 'resolution',
  "resolutionType" varchar(20) not null default 'ordinary',
  description text not null default '',
  result varchar(20) not null default 'pending',
  "votesFor" bigint,
  "votesAgainst" bigint,
  "votesAbstain" bigint,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint meeting_agenda_items_type_check check ("itemType" in ('resolution', 'report')),
  constraint meeting_agenda_items_resolution_check
    check ("resolutionType" in ('ordinary', 'special', 'extraordinary_309_3', 'extraordinary_309_4', 'unanimous', 'board')),
  constraint meeting_agenda_items_result_check check (result in ('pending', 'approved', 'rejected', 'withdrawn', 'reported')),
  constraint meeting_agenda_items_votes_check
    check (
      ("votesFor" is null or "votesFor" >= 0)
      and ("votesAgainst" is null or "votesAgainst" >= 0)
      and ("votesAbstain" is null or "votesAbstain" >= 0)
    )
);

create index "meeting_agenda_items_meetingId_idx" on meeting_agenda_items ("meetingId", "sortOrder");

-- 出欠・委任状・書面による議決権行使・書面決議への同意（会社法319条・370条）の記録。
create table meeting_responses (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "meetingId" uuid not null references meetings(id) on delete cascade,
  "stakeholderId" uuid references stakeholders(id) on delete cascade,
  "officerId" uuid references officers(id) on delete cascade,
  response varchar(20) not null default 'no_response',
  "votingRights" bigint,
  "respondedOn" date,
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint meeting_responses_response_check
    check (response in ('no_response', 'attending', 'proxy', 'written_vote', 'consent', 'dissent', 'absent')),
  constraint meeting_responses_party_check check (("stakeholderId" is null) <> ("officerId" is null)),
  constraint meeting_responses_voting_rights_check check ("votingRights" is null or "votingRights" >= 0)
);

create index "meeting_responses_meetingId_idx" on meeting_responses ("meetingId");
create unique index meeting_responses_stakeholder_unique on meeting_responses ("meetingId", "stakeholderId") where "stakeholderId" is not null;
create unique index meeting_responses_officer_unique on meeting_responses ("meetingId", "officerId") where "officerId" is not null;

-- §7 決算情報 ----------------------------------------------------------------

create table financial_reports (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "fiscalYearId" uuid references fiscal_years(id) on delete set null,
  title varchar(200) not null,
  "periodType" varchar(20) not null default 'annual',
  "periodStart" date not null,
  "periodEnd" date not null,
  revenue numeric(18, 0),
  "grossProfit" numeric(18, 0),
  "operatingIncome" numeric(18, 0),
  "ordinaryIncome" numeric(18, 0),
  "netIncome" numeric(18, 0),
  "totalAssets" numeric(18, 0),
  "netAssets" numeric(18, 0),
  "cashAndDeposits" numeric(18, 0),
  "interestBearingDebt" numeric(18, 0),
  employees integer,
  highlights text not null default '',
  status varchar(20) not null default 'draft',
  "approvedMeetingId" uuid references meetings(id) on delete set null,
  "isPublishedToShareholders" boolean not null default false,
  "publishedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint financial_reports_period_type_check check ("periodType" in ('annual', 'half', 'quarterly', 'monthly')),
  constraint financial_reports_status_check check (status in ('draft', 'approved')),
  constraint financial_reports_period_check check ("periodEnd" >= "periodStart"),
  constraint financial_reports_employees_check check (employees is null or employees >= 0)
);

create index "financial_reports_organizationId_idx" on financial_reports ("organizationId", "periodEnd");

-- §8 文書ライブラリ・共有 ------------------------------------------------------

-- ファイル本体は Storage の documents バケット（{organizationId}/{id}.{ext}）。
-- visibility: internal = 社内のみ / shareholders = 全株主（ポータル）/ restricted = document_shares の相手だけ。
-- entityType / entityId は関連するレコード（会議・決算・お知らせ・SO 回次など）へのゆるい参照。
create table documents (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  title varchar(200) not null,
  category varchar(30) not null default 'other',
  description text not null default '',
  "documentDate" date,
  "storagePath" varchar(500) not null,
  "fileName" varchar(255) not null,
  "mimeType" varchar(100) not null,
  "sizeBytes" bigint not null,
  sha256 varchar(64) not null,
  visibility varchar(20) not null default 'internal',
  "entityType" varchar(40),
  "entityId" uuid,
  "uploadedByUserId" uuid references auth.users(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint documents_category_check
    check (category in (
      'articles', 'registry', 'shareholder_agreement', 'investment_agreement', 'share_transfer',
      'stock_option', 'convertible', 'meeting', 'financial', 'tax', 'report', 'other'
    )),
  constraint documents_visibility_check check (visibility in ('internal', 'shareholders', 'restricted')),
  constraint documents_size_check check ("sizeBytes" >= 0),
  constraint documents_storage_path_unique unique ("storagePath")
);

create index "documents_organizationId_idx" on documents ("organizationId", category);
create index documents_entity_idx on documents ("entityType", "entityId") where "entityId" is not null;

create table document_shares (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "documentId" uuid not null references documents(id) on delete cascade,
  "stakeholderId" uuid not null references stakeholders(id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  constraint document_shares_unique unique ("documentId", "stakeholderId")
);

create index "document_shares_stakeholderId_idx" on document_shares ("stakeholderId");

-- ログイン不要の期限つき共有リンク（投資検討先への開示など）。トークンはハッシュだけを保存する。
create table share_links (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "documentId" uuid not null references documents(id) on delete cascade,
  label varchar(200) not null default '',
  "tokenHash" varchar(64) not null unique,
  "expiresAt" timestamptz not null,
  "revokedAt" timestamptz,
  "accessCount" integer not null default 0,
  "lastAccessedAt" timestamptz,
  "createdByUserId" uuid references auth.users(id) on delete set null,
  "createdAt" timestamptz not null default now()
);

create index "share_links_documentId_idx" on share_links ("documentId");

-- §9 株主向けお知らせ ---------------------------------------------------------

create table shareholder_updates (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  category varchar(20) not null default 'news',
  title varchar(200) not null,
  body text not null default '',
  status varchar(20) not null default 'draft',
  "publishedAt" timestamptz,
  "meetingId" uuid references meetings(id) on delete set null,
  "createdByUserId" uuid references auth.users(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint shareholder_updates_category_check
    check (category in ('news', 'monthly_report', 'financial', 'meeting_notice', 'other')),
  constraint shareholder_updates_status_check check (status in ('draft', 'published'))
);

create index "shareholder_updates_organizationId_idx" on shareholder_updates ("organizationId", "publishedAt");

-- §10 AI ----------------------------------------------------------------------

create table ai_settings (
  "organizationId" uuid primary key references organizations(id) on delete cascade,
  provider varchar(20) not null,
  "modelId" varchar(200) not null,
  "updatedBy" uuid,
  "updatedAt" timestamptz not null default now(),
  constraint ai_settings_provider_check check (provider in ('anthropic', 'google', 'openai'))
);

-- 画面から登録した API キー（AES-256-GCM の暗号文だけ）。service_role 限定。
create table ai_credentials (
  "organizationId" uuid primary key references organizations(id) on delete cascade,
  provider varchar(20) not null,
  ciphertext text not null,
  iv text not null,
  "authTag" text not null,
  "keyId" varchar(16) not null,
  "keyLast4" varchar(4) not null,
  "updatedBy" uuid,
  "updatedAt" timestamptz not null default now(),
  constraint ai_credentials_provider_check check (provider in ('anthropic', 'google', 'openai'))
);

-- 契約書などを AI で読み取った結果と、台帳へ反映した記録。
-- AI の出力はここに「提案」として残るだけで、台帳へ書くのは人が確認して反映したときだけ。
create table document_extractions (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "documentId" uuid not null references documents(id) on delete cascade,
  "documentKind" varchar(40) not null,
  status varchar(20) not null default 'extracted',
  provider varchar(20) not null,
  "modelId" varchar(200) not null,
  result jsonb not null,
  "appliedSummary" jsonb,
  "createdByUserId" uuid references auth.users(id) on delete set null,
  "appliedByUserId" uuid references auth.users(id) on delete set null,
  "appliedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  constraint document_extractions_status_check check (status in ('extracted', 'applied', 'discarded'))
);

create index "document_extractions_documentId_idx" on document_extractions ("documentId");

-- §11 監査ログ -----------------------------------------------------------------

-- 追記専用。監査ログを持つ組織は削除できない（restrict は意図的）。
create table system_audit_logs (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete restrict,
  "userId" uuid not null,
  action varchar(100) not null,
  "entityName" varchar(100) not null,
  "entityId" uuid,
  detail text,
  "ipAddress" varchar(45),
  "createdAt" timestamptz not null default now()
);

create index "system_audit_logs_organizationId_idx" on system_audit_logs ("organizationId", "createdAt");

-- §12 トリガー -----------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

-- 操作者列は RLS だけではクライアントが任意値を書けるため auth.uid() で上書きする（service_role は与えた値を尊重）。
create or replace function set_audit_user_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new."userId" := coalesce(auth.uid(), new."userId");
  return new;
end;
$$;

create or replace function set_invite_inviter()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new."invitedByUserId" := coalesce(auth.uid(), new."invitedByUserId");
  return new;
end;
$$;

create trigger set_system_audit_logs_user_id before insert on system_audit_logs
for each row execute function set_audit_user_id();

create trigger set_invites_inviter before insert on invites
for each row execute function set_invite_inviter();

create trigger set_organizations_updated_at before update on organizations for each row execute function set_updated_at();
create trigger set_profiles_updated_at before update on profiles for each row execute function set_updated_at();
create trigger set_stakeholders_updated_at before update on stakeholders for each row execute function set_updated_at();
create trigger set_officers_updated_at before update on officers for each row execute function set_updated_at();
create trigger set_share_classes_updated_at before update on share_classes for each row execute function set_updated_at();
create trigger set_funding_rounds_updated_at before update on funding_rounds for each row execute function set_updated_at();
create trigger set_share_transactions_updated_at before update on share_transactions for each row execute function set_updated_at();
create trigger set_convertible_rounds_updated_at before update on convertible_rounds for each row execute function set_updated_at();
create trigger set_convertible_investments_updated_at before update on convertible_investments for each row execute function set_updated_at();
create trigger set_option_plans_updated_at before update on option_plans for each row execute function set_updated_at();
create trigger set_option_grants_updated_at before update on option_grants for each row execute function set_updated_at();
create trigger set_option_events_updated_at before update on option_events for each row execute function set_updated_at();
create trigger set_meetings_updated_at before update on meetings for each row execute function set_updated_at();
create trigger set_meeting_agenda_items_updated_at before update on meeting_agenda_items for each row execute function set_updated_at();
create trigger set_meeting_responses_updated_at before update on meeting_responses for each row execute function set_updated_at();
create trigger set_financial_reports_updated_at before update on financial_reports for each row execute function set_updated_at();
create trigger set_documents_updated_at before update on documents for each row execute function set_updated_at();
create trigger set_shareholder_updates_updated_at before update on shareholder_updates for each row execute function set_updated_at();

-- 行使・失効の合計が割当個数を超えないことを DB でも保証する（アプリ側の検証の後段の保険）。
create function check_option_event_units()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_units bigint;
  v_used bigint;
begin
  select g.units into v_units from option_grants g where g.id = new."grantId" for update;
  select coalesce(sum(e.units), 0) into v_used
  from option_events e
  where e."grantId" = new."grantId" and e.id <> new.id;
  if v_used + new.units > v_units then
    raise exception '行使済みと失効の合計が割当個数を超えます' using errcode = 'P3001';
  end if;
  return new;
end;
$$;

create trigger check_option_event_units before insert or update on option_events
for each row execute function check_option_event_units();

-- 組織の管理者が 0 人になる更新・削除を拒否する（組織ごとの削除は止めない）。
create function ensure_organization_keeps_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checks_admins boolean;
begin
  v_checks_admins := old.role = 'admin'
    and (tg_op = 'DELETE' or new.role <> 'admin' or new."organizationId" <> old."organizationId");
  if v_checks_admins then
    perform pg_advisory_xact_lock(hashtext('organization_admins:' || old."organizationId"::text));
    if exists (
      select 1 from public.organizations o where o.id = old."organizationId"
    ) and not exists (
      select 1 from public.profiles p
      where p."organizationId" = old."organizationId" and p.role = 'admin' and p.id <> old.id
    ) then
      raise exception '組織の管理者が 1 人もいなくなるため変更できません' using errcode = 'P2081';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger ensure_organization_keeps_admin
before update of role, "organizationId" or delete on profiles
for each row execute function ensure_organization_keeps_admin();
