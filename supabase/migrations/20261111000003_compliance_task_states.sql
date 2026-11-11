-- 手続きカレンダーの「完了」の記録。
-- 招集通知の発送日・議事録の確定日・登記日のように台帳に日付を持つ手続きは、その日付から完了を判定する。
-- 法人税の申告・決算公告・調書の提出・行使による変更の登記など、台帳に対応する日付の項目が無い手続きは、
-- ここに「いつ完了したか」を人が記録する。taskKey は src/lib/legal/calendar.ts が作るキー（例: tax:<事業年度の id>）。
-- 業務テーブルと同じく authenticated には何も付与しない（読み書きはサーバ経由）。

create table compliance_task_states (
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "taskKey" varchar(200) not null,
  "completedOn" date not null,
  note varchar(500) not null default '',
  "updatedByUserId" uuid references auth.users(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key ("organizationId", "taskKey")
);

alter table compliance_task_states enable row level security;
revoke all on compliance_task_states from anon, authenticated;
grant select, insert, update, delete on compliance_task_states to service_role;

create trigger set_compliance_task_states_updated_at before update on compliance_task_states
for each row execute function set_updated_at();
