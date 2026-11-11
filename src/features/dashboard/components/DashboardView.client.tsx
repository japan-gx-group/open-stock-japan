'use client';

// ダッシュボード: 株式の全体像・持株比率・近い期限の手続き・台帳の注意・主な操作への入口。

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarCheck, FileSignature, Landmark, PieChart, Sparkles, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ErrorBlock, LoadingBlock, NoticeList, StatGrid, StatTile } from '@/components/resource/parts';
import { useCompany } from '@/hooks/useCompany';
import { useComplianceTasks } from '@/hooks/useComplianceTasks';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEquitySnapshot } from '@/hooks/useEquitySnapshot';
import { buildCapTable } from '@/lib/equity/capTable';
import { formatDateJa, formatNumber, formatRatio, formatYenJa } from '@/lib/equity/format';
import { checkLedger } from '@/lib/equity/ledger';
import type { ComplianceTask, TaskStatus } from '@/lib/legal/calendar';
import { canEdit, isAdmin } from '@/types/role';
import { countByStatus, ownershipSlices, upcomingTasks } from '../services/overview';
import { OwnershipChart } from './OwnershipChart.client';
import { ShareClassBar } from './ShareClassBar';

const TASK_LIMIT = 6;
const TOP_HOLDERS = 8;

const TASK_STATUS: Record<TaskStatus, { label: string; className: string }> = {
  overdue: { label: '期限超過', className: 'gt-pill gt-pill-sm gt-pill-bad' },
  soon: { label: '期限間近', className: 'gt-pill gt-pill-sm gt-pill-warn' },
  upcoming: { label: '予定', className: 'gt-pill gt-pill-sm gt-pill-neutral' },
  done: { label: '完了', className: 'gt-pill gt-pill-sm gt-pill-good' },
};

const daysText = (task: ComplianceTask): string =>
  task.daysLeft < 0 ? `${Math.abs(task.daysLeft)} 日超過` : task.daysLeft === 0 ? '今日が期限' : `あと ${task.daysLeft} 日`;

const QUICK_LINKS: { href: string; label: string; description: string; icon: LucideIcon }[] = [
  { href: '/shareholders?tab=stakeholders', label: '株主・権利者を登録', description: '株主名簿の記載事項を入力', icon: Users },
  { href: '/shareholders?tab=transactions', label: '株式の異動を登録', description: '発行・譲渡・分割を記録', icon: TrendingUp },
  { href: '/cap-table', label: '資本政策表を見る', description: '次回ラウンドの試算と Excel 出力', icon: PieChart },
  { href: '/rounds', label: '資金調達を管理', description: 'ラウンド・種類株式・登記の期限', icon: FileSignature },
  { href: '/stock-options', label: 'ストックオプション', description: '回次・割当て・ベスティング', icon: Sparkles },
  { href: '/shareholder-meetings', label: '株主総会を準備', description: '招集通知・議案・議事録', icon: Landmark },
];

const SetupGuide = ({ companyReady, hasStakeholders, isAdminUser }: { companyReady: boolean; hasStakeholders: boolean; isAdminUser: boolean }) => {
  const steps = [
    {
      title: '会社情報を登録する',
      description: `商号・発行可能株式総数・機関設計（取締役会の有無など）を入力します。期限の計算や台帳のチェックに使います。${isAdminUser ? '' : '（変更は管理者が行います）'}`,
      href: '/company',
      linkLabel: '会社情報・役員を開く',
      done: companyReady,
    },
    {
      title: '株主を登録する',
      description: '株主の氏名（名称）と住所を登録します。株主名簿の記載事項です（会社法121条）。',
      href: '/shareholders?tab=stakeholders',
      linkLabel: '権利者の一覧を開く',
      done: hasStakeholders,
    },
    {
      title: '株式の異動を登録する',
      description: '設立時の発行から順に、増資・譲渡などを登録します。登録すると、株主名簿と資本政策表が自動で作られます。',
      href: '/shareholders?tab=transactions',
      linkLabel: '株式の異動を開く',
      done: false,
    },
  ];
  return (
    <section className="gt-card">
      <h2 className="gt-card-title m-0">はじめに登録すること</h2>
      <p className="gt-card-sub mb-0">株式の記録がまだありません。次の順に登録すると、株主名簿と資本政策表が表示されます。</p>
      <ol className="list-none p-0 m-0 mt-4 flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3 rounded-lg border border-border p-4">
            <span
              className={`flex size-7 flex-none items-center justify-center rounded-full text-[13px] font-semibold ${
                step.done ? 'bg-success-soft text-success' : 'bg-primary-light text-primary-dark'
              }`}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-text-heading">
                {step.title}
                {step.done && <span className="gt-pill gt-pill-sm gt-pill-good">登録済み</span>}
              </div>
              <p className="text-[13px] leading-relaxed text-text-muted mt-1 mb-0">{step.description}</p>
            </div>
            <Link href={step.href} className="gt-btn flex-none">
              {step.linkLabel}
              <ArrowRight size={14} />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
};

export const DashboardView = () => {
  const { role, profile } = useCurrentUser();
  const snapshotState = useEquitySnapshot();
  const company = useCompany();
  const compliance = useComplianceTasks();

  const snapshot = snapshotState.data;
  const table = useMemo(() => (snapshot ? buildCapTable(snapshot) : null), [snapshot]);
  const authorizedShares = typeof company.data?.authorizedShares === 'number' ? company.data.authorizedShares : null;
  const issues = useMemo(() => (snapshot ? checkLedger(snapshot, { authorizedShares }) : []), [snapshot, authorizedShares]);
  const slices = useMemo(() => (table ? ownershipSlices(table, TOP_HOLDERS) : []), [table]);
  const tasks = useMemo(() => upcomingTasks(compliance.tasks, TASK_LIMIT), [compliance.tasks]);
  const taskCounts = useMemo(() => countByStatus(compliance.tasks), [compliance.tasks]);

  const companyName = typeof company.data?.name === 'string' ? company.data.name : (profile?.organizationName ?? '');
  const heading = <PageHeading title="ダッシュボード" description={companyName ? `${companyName} の株式・手続きの概要` : '株式・手続きの概要'} />;

  if (snapshotState.isLoading && !snapshot) {
    return (
      <>
        {heading}
        <LoadingBlock />
      </>
    );
  }
  if (!snapshot || !table) {
    return (
      <>
        {heading}
        <ErrorBlock message={snapshotState.error ?? 'データの取得に失敗しました'} onRetry={() => void snapshotState.reload()} />
      </>
    );
  }

  const { totals } = table;
  const isLedgerEmpty = snapshot.shareTransactions.length === 0;
  const quickLinks = canEdit(role) ? QUICK_LINKS : QUICK_LINKS.filter((link) => link.href === '/cap-table' || link.href === '/rounds');

  return (
    <>
      {heading}
      <div className="flex flex-col gap-4">
        {snapshotState.error && <ErrorBlock message={snapshotState.error} onRetry={() => void snapshotState.reload()} />}

        {isLedgerEmpty && (
          <SetupGuide
            companyReady={authorizedShares != null}
            hasStakeholders={snapshot.stakeholders.length > 0}
            isAdminUser={isAdmin(role)}
          />
        )}

        <NoticeList items={issues.map((issue, index) => ({ level: issue.level, message: issue.message, key: `${issue.code}-${index}` }))} />

        {!isLedgerEmpty && (
          <>
            <StatGrid>
              <StatTile
                label="発行済株式総数"
                value={`${formatNumber(totals.issuedShares)}株`}
                sub={
                  authorizedShares != null
                    ? `発行可能株式総数 ${formatNumber(authorizedShares)}株（${formatRatio(totals.issuedShares / authorizedShares, 1)} を発行済み）`
                    : '発行可能株式総数は未登録'
                }
              />
              <StatTile label="株主数" value={`${formatNumber(totals.shareholderCount)}名`} sub={`株式の種類 ${table.classes.filter((item) => item.issuedShares > 0).length} 種類`} />
              <StatTile
                label="完全希釈化後株式数"
                value={`${formatNumber(totals.fullyDilutedShares)}株`}
                sub="新株予約権・転換型（概算）・未割当の SO 枠を含む"
              />
              <StatTile label="払込総額" value={formatYenJa(totals.paidIn)} sub="設立・増資・行使・転換で会社に払い込まれた額" />
              <StatTile
                label="未転換の転換型証券"
                value={formatYenJa(totals.convertibleAmount)}
                sub={totals.convertibleAmount > 0 ? `転換すると約 ${formatNumber(totals.convertibleShares)}株（概算）` : 'なし'}
              />
              <StatTile
                label="未行使のストックオプション"
                value={`${formatNumber(totals.optionShares)}株`}
                sub={`残り ${formatNumber(totals.optionUnitsRemaining)}個（割当て ${formatNumber(totals.optionUnitsGranted)}個）`}
              />
              <StatTile
                label="未割当の SO 枠"
                value={`${formatNumber(totals.unallocatedPoolShares)}株`}
                sub={totals.fullyDilutedShares > 0 ? `完全希釈化後の ${formatRatio(totals.unallocatedPoolShares / totals.fullyDilutedShares, 1)}` : undefined}
              />
              <StatTile
                label="期限の近い手続き"
                value={compliance.isLoading ? '—' : `${taskCounts.overdue + taskCounts.soon}件`}
                sub={compliance.isLoading ? '読み込んでいます…' : `期限超過 ${taskCounts.overdue}件 ／ 期限間近 ${taskCounts.soon}件`}
              />
            </StatGrid>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              <section className="gt-card xl:col-span-3">
                <div className="gt-card-head">
                  <div>
                    <h2 className="gt-card-title m-0">持株比率（完全希釈化後）</h2>
                    <p className="gt-card-sub mb-0">上位 {TOP_HOLDERS} 名とその他。新株予約権と転換型証券（概算）を株式に換算して含みます</p>
                  </div>
                  <Link href="/cap-table" className="gt-btn flex-none">
                    資本政策表
                    <ArrowRight size={14} />
                  </Link>
                </div>
                <div className="mt-3">
                  {slices.length > 0 ? <OwnershipChart slices={slices} /> : <p className="gt-table-empty m-0">表示できる株主がいません。</p>}
                </div>
              </section>
              <section className="gt-card gt-card-table xl:col-span-2">
                <h2 className="gt-card-title m-0">株式の種類ごとの内訳</h2>
                <p className="gt-card-sub mb-0">発行済株式 {formatNumber(totals.issuedShares)}株の内訳</p>
                <div className="mt-4">
                  <ShareClassBar classes={table.classes} totalShares={totals.issuedShares} />
                </div>
              </section>
            </div>
          </>
        )}

        <section className="gt-card gt-card-table">
          <div className="gt-card-head">
            <div>
              <h2 className="gt-card-title m-0 flex items-center gap-2">
                <CalendarCheck size={17} className="text-primary" />
                期限の近い手続き
              </h2>
              <p className="gt-card-sub mb-0">招集通知・登記・申告など、期限の近い順に {TASK_LIMIT} 件まで</p>
            </div>
            <Link href="/compliance" className="gt-btn flex-none">
              すべて見る
              <ArrowRight size={14} />
            </Link>
          </div>
          {compliance.isLoading ? (
            <LoadingBlock />
          ) : compliance.error ? (
            <div className="mt-3 mb-3">
              <ErrorBlock message={compliance.error} onRetry={() => void compliance.reload()} />
            </div>
          ) : tasks.length === 0 ? (
            <p className="gt-table-empty m-0">期限の近い手続きはありません。</p>
          ) : (
            <div className="gt-table-scroll mt-2">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th scope="col">状態</th>
                    <th scope="col">期限</th>
                    <th scope="col">手続き</th>
                    <th scope="col">根拠</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const status = TASK_STATUS[task.status];
                    return (
                      <tr key={task.key}>
                        <td>
                          <span className={status.className}>{status.label}</span>
                        </td>
                        <td className="tabular-nums">
                          {formatDateJa(task.dueOn)}
                          <div className={`text-[11.5px] ${task.status === 'overdue' ? 'text-danger' : 'text-text-muted'}`}>{daysText(task)}</div>
                        </td>
                        {/* 手続きの名前と説明は文章なので折り返す（セルの文字は説明の大きさ・色にし、名前だけ本文の大きさに戻す）。
                            根拠（条文）は短いので、狭いときだけ折り返す */}
                        <td className="gt-wrap-lg text-[12px] leading-relaxed text-text-muted">
                          <Link href={task.href ?? '/compliance'} className="text-[13.5px] font-medium text-primary hover:underline">
                            {task.title}
                          </Link>
                          {task.description && <br />}
                          {task.description}
                        </td>
                        <td className="gt-wrap-sm text-[12px] text-text-muted">{task.basis}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="gt-card">
          <h2 className="gt-card-title m-0">主な操作</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-bg-subtle"
              >
                <span className="flex size-9 flex-none items-center justify-center rounded-md bg-primary-light text-primary-dark">
                  <link.icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-text-heading">{link.label}</span>
                  <span className="block text-[12px] text-text-muted">{link.description}</span>
                </span>
                <ArrowRight size={15} className="ml-auto flex-none text-text-subtle" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
};
