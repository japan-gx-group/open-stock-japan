-- 文書テンプレート（招集通知・議事録・J-KISS の発行に使う書類などの、ひな形）。
--
-- 文面（body）には、差し込み項目を {{会社名}} のように書く。文書を作るときに、台帳の値（会社情報・会議・
-- 転換型証券の回次）で置き換える。差し込み項目の一覧と置き換えは src/features/templates/services/ が持つ。
-- status は、人が文面を確かめたかどうか（draft = 確認中 / reviewed = 確認済み）。AI が書いた文面も、
-- 手元のひな形から取り込んだ文面も、人が確かめるまでは「確認中」のままにする。
-- 業務テーブルと同じく authenticated には何も付与しない（読み書きはサーバ経由）。

create table document_templates (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  kind varchar(40) not null,
  title varchar(200) not null,
  status varchar(20) not null default 'draft',
  body text not null default '',
  notes text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint document_templates_kind_check
    check (kind in (
      'shareholder_notice',
      'shareholder_minutes',
      'shareholder_written_proposal',
      'shareholder_written_minutes',
      'shareholder_proxy',
      'shareholder_waiver',
      'board_notice',
      'board_minutes',
      'board_written_proposal',
      'board_written_minutes',
      'convertible_terms',
      'convertible_proposal',
      'convertible_payment_notice',
      'convertible_contract',
      'other'
    )),
  constraint document_templates_status_check check (status in ('draft', 'reviewed')),
  constraint document_templates_body_length_check check (char_length(body) <= 100000)
);

create index "document_templates_organizationId_idx" on document_templates ("organizationId", kind);

alter table document_templates enable row level security;
revoke all on document_templates from anon, authenticated;
grant select, insert, update, delete on document_templates to service_role;

create trigger set_document_templates_updated_at before update on document_templates
for each row execute function set_updated_at();

-- 行の変更の記録（だれが・いつ・どの項目を変えたか）。長い文面は、文字数とハッシュだけが残る（audit_mask_row）。
create trigger audit_document_templates after insert or update or delete on document_templates for each row execute function audit_row_change();
