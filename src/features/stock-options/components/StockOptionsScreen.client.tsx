'use client';

// ストックオプション（新株予約権）の画面。回次と割当・税制適格チェック・新株予約権原簿の 3 つのタブを持つ。
// 台帳は useEquitySnapshot でまとめて読み、登録・編集は共通の ResourceFormDialog、削除は ConfirmDialog を使う。
// 追加・編集・削除の操作は canEdit(role) のときだけ出す（権限の正しさはサーバが確かめる）。

import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { EmptyState, ErrorBlock, LoadingBlock, StatGrid, StatTile } from '@/components/resource/parts';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { Button } from '@/components/ui/button';
import { useCompany } from '@/hooks/useCompany';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEquitySnapshot } from '@/hooks/useEquitySnapshot';
import { buildCapTable } from '@/lib/equity/capTable';
import { formatDateJa, formatRatio, formatShares, formatUnits, todayInTokyo } from '@/lib/equity/format';
import type { OptionEventType } from '@/lib/equity/types';
import { optionExerciseRegistrationDeadline } from '@/lib/legal/rules';
import { deleteItem } from '@/lib/resources/client';
import type { ResourceName } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';
import { canEdit } from '@/types/role';
import {
  buildPlanViews,
  exerciseTransactionDefaults,
  summarizePlans,
  type GrantView,
  type PlanView,
} from '../services/optionSummary';
import { PlanCard } from './PlanCard.client';
import { TaxQualifiedPanel } from './TaxQualifiedPanel.client';
import { WarrantRegister } from './WarrantRegister.client';

type TabKey = 'plans' | 'tax' | 'register';

type DialogState =
  | { kind: 'plan'; initial: ResourceRow | null }
  | { kind: 'grant'; planId: string; initial: ResourceRow | null }
  | { kind: 'event'; grant: GrantView; eventType: OptionEventType }
  | { kind: 'transaction'; defaults: Record<string, string> }
  | { kind: 'delete'; resource: ResourceName; id: string; title: string; message: string };

/** 行使を記録したあとに出す、株式の異動と登記の案内 */
interface ExerciseReminder {
  holderName: string;
  planName: string;
  eventDate: string;
  units: number;
  shares: number;
  defaults: Record<string, string>;
}

/** 台帳の行（型つき）を、フォームへ渡す行の形にする */
const asRow = (row: object): ResourceRow => row as ResourceRow;

export interface PlanActions {
  editPlan: (view: PlanView) => void;
  deletePlan: (view: PlanView) => void;
  addGrant: (view: PlanView) => void;
  editGrant: (grant: GrantView) => void;
  deleteGrant: (grant: GrantView) => void;
  recordEvent: (grant: GrantView, eventType: OptionEventType) => void;
  deleteEvent: (grant: GrantView, eventId: string, label: string) => void;
  recordExerciseTransaction: (grant: GrantView, eventDate: string, units: number) => void;
}

export const StockOptionsScreen = () => {
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  const { data: snapshot, error, isLoading, reload } = useEquitySnapshot();
  const { data: company } = useCompany();
  const [tab, setTab] = useState<TabKey>('plans');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [reminder, setReminder] = useState<ExerciseReminder | null>(null);
  const today = todayInTokyo();

  const planViews = useMemo(() => (snapshot ? buildPlanViews(snapshot, today) : []), [snapshot, today]);
  const totals = useMemo(() => summarizePlans(planViews), [planViews]);
  const capTable = useMemo(() => (snapshot ? buildCapTable(snapshot) : null), [snapshot]);

  const establishedOn = typeof company?.establishedOn === 'string' ? company.establishedOn : null;
  const companyName = typeof company?.name === 'string' ? company.name : '';
  const taxQualifiedCount = planViews.filter((view) => view.plan.planType === 'tax_qualified').length;

  const close = () => setDialog(null);
  const saved = () => void reload();

  const actions: PlanActions = {
    editPlan: (view) => setDialog({ kind: 'plan', initial: asRow(view.plan) }),
    deletePlan: (view) =>
      setDialog({
        kind: 'delete',
        resource: 'option-plans',
        id: view.plan.id,
        title: '回次を削除',
        message:
          view.grants.length > 0
            ? `「${view.plan.name}」を削除します。この回次の割当 ${view.grants.length} 件と、その行使・失効の記録もすべて削除されます。取り消せません。`
            : `「${view.plan.name}」を削除します。取り消せません。`,
      }),
    addGrant: (view) => setDialog({ kind: 'grant', planId: view.plan.id, initial: null }),
    editGrant: (grant) => setDialog({ kind: 'grant', planId: grant.plan.id, initial: asRow(grant.grant) }),
    deleteGrant: (grant) =>
      setDialog({
        kind: 'delete',
        resource: 'option-grants',
        id: grant.grant.id,
        title: '割当を削除',
        message: `${grant.holderName} への割当（${formatUnits(grant.grant.units)}）を削除します。${
          grant.events.length > 0 ? `行使・失効の記録 ${grant.events.length} 件も削除されます。` : ''
        }取り消せません。退職などで権利が消滅した場合は、削除ではなく「失効を記録」を使ってください。`,
      }),
    recordEvent: (grant, eventType) => setDialog({ kind: 'event', grant, eventType }),
    deleteEvent: (grant, eventId, label) =>
      setDialog({
        kind: 'delete',
        resource: 'option-events',
        id: eventId,
        title: '記録を削除',
        message: `${grant.holderName} の「${label}」の記録を削除します。取り消せません。株式の異動に記録済みの場合は、そちらも見直してください。`,
      }),
    recordExerciseTransaction: (grant, eventDate, units) =>
      setDialog({
        kind: 'transaction',
        defaults: exerciseTransactionDefaults(grant.plan, grant.grant.stakeholderId, eventDate, units),
      }),
  };

  const eventSaved = (grant: GrantView, row: ResourceRow) => {
    saved();
    if (row.eventType !== 'exercise') return;
    const units = Number(row.units);
    const eventDate = String(row.eventDate);
    setReminder({
      holderName: grant.holderName,
      planName: grant.plan.name,
      eventDate,
      units,
      shares: units * grant.plan.sharesPerUnit,
      defaults: exerciseTransactionDefaults(grant.plan, grant.grant.stakeholderId, eventDate, units),
    });
  };

  const potentialShares = capTable ? capTable.totals.optionShares + capTable.totals.unallocatedPoolShares : 0;
  const potentialRatio =
    capTable && capTable.totals.fullyDilutedShares > 0 ? potentialShares / capTable.totals.fullyDilutedShares : null;

  return (
    <>
      <PageHeading
        title="ストックオプション"
        description="新株予約権の回次・割当・行使と失効を管理し、税制適格の要件と新株予約権原簿を確認します。"
        primaryAction={
          editable ? (
            <Button type="button" onClick={() => setDialog({ kind: 'plan', initial: null })}>
              <Plus />
              回次を追加
            </Button>
          ) : null
        }
      />

      {isLoading && !snapshot ? (
        <LoadingBlock />
      ) : error && !snapshot ? (
        <ErrorBlock message={error} onRetry={() => void reload()} />
      ) : snapshot ? (
        <div className="flex flex-col gap-4">
          {error && <ErrorBlock message={error} onRetry={() => void reload()} />}

          <StatGrid>
            <StatTile label="発行総数" value={formatUnits(totals.totalUnits)} sub={`株換算 ${formatShares(totals.totalShares)}`} />
            <StatTile
              label="割当済み"
              value={formatUnits(totals.grantedUnits)}
              sub={`未割当 ${formatUnits(totals.unallocatedUnits)}（${formatShares(totals.unallocatedShares)}）`}
            />
            <StatTile label="未行使（残数）" value={formatUnits(totals.remainingUnits)} sub={`株換算 ${formatShares(totals.remainingShares)}`} />
            <StatTile label="行使済み" value={formatUnits(totals.exercisedUnits)} sub={`株換算 ${formatShares(totals.exercisedShares)}`} />
            <StatTile label="失効" value={formatUnits(totals.forfeitedUnits)} sub={`株換算 ${formatShares(totals.forfeitedShares)}`} />
            <StatTile
              label="完全希釈化後に占める割合"
              value={formatRatio(potentialRatio)}
              sub="未行使と未割当枠の合計。資本政策表と同じ計算"
            />
          </StatGrid>

          {reminder && (
            <div className="gt-card border-warning/40" role="status" style={{ padding: '14px 18px' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-[13px] leading-relaxed text-text-main">
                  <div className="text-[14px] font-semibold text-text-heading">行使を記録しました。株式の異動と登記を忘れずに</div>
                  <p className="m-0 mt-1">
                    {reminder.holderName} が {reminder.planName} を {formatUnits(reminder.units)} 行使（{formatDateJa(reminder.eventDate)}）。
                    交付する株式は {formatShares(reminder.shares)} です。行使した日に株主になるため、株主名簿に反映するには株式の異動（新株予約権の行使）も記録してください。
                  </p>
                  <p className="m-0 mt-1">
                    変更の登記の期限: <strong>{formatDateJa(optionExerciseRegistrationDeadline(reminder.eventDate))}</strong>
                    <span className="text-text-muted">（行使があった月の末日から 2 週間以内。会社法915条3項1号）</span>
                  </p>
                  {editable && (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3"
                      onClick={() => setDialog({ kind: 'transaction', defaults: reminder.defaults })}
                    >
                      株式の異動を記録
                    </Button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="案内を閉じる"
                  className="bg-transparent border-none cursor-pointer p-1 text-text-muted"
                  onClick={() => setReminder(null)}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}

          <div className="gt-tabs" role="tablist" style={{ marginTop: 0 }}>
            {(
              [
                { key: 'plans', label: '回次と割当', count: planViews.length },
                { key: 'tax', label: '税制適格チェック', count: taxQualifiedCount },
                { key: 'register', label: '新株予約権原簿', count: null },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={`gt-tab cursor-pointer ${tab === item.key ? 'gt-tab-active' : ''}`}
                onClick={() => setTab(item.key)}
              >
                {item.label}
                {item.count != null && <span className="gt-tab-count">{item.count}</span>}
              </button>
            ))}
          </div>

          {tab === 'plans' &&
            (planViews.length === 0 ? (
              <EmptyState
                title="新株予約権の回次がまだありません"
                description="株主総会で発行を決議した新株予約権（ストックオプション）を回次ごとに登録すると、割当・ベスティング・行使と失効を管理できます。"
                action={
                  editable ? (
                    <Button type="button" onClick={() => setDialog({ kind: 'plan', initial: null })}>
                      <Plus />
                      回次を追加
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                {planViews.map((view) => (
                  <PlanCard
                    key={view.plan.id}
                    view={view}
                    snapshot={snapshot}
                    today={today}
                    editable={editable}
                    actions={actions}
                  />
                ))}
                <p className="text-[12px] leading-relaxed text-text-muted m-0">
                  確定済み・未確定は、回次のベスティング条件（期間・クリフ・間隔）から今日（{formatDateJa(today)}）時点で計算しています。
                  行使可能数は「確定済み − 行使済み」で、上場などの行使条件は反映していません。実際に行使できるかは発行要項と割当契約で確認してください。
                </p>
              </>
            ))}

          {tab === 'tax' && <TaxQualifiedPanel snapshot={snapshot} planViews={planViews} establishedOn={establishedOn} />}

          {tab === 'register' && <WarrantRegister snapshot={snapshot} today={today} companyName={companyName} />}
        </div>
      ) : null}

      <ResourceFormDialog
        resource="option-plans"
        isOpen={dialog?.kind === 'plan'}
        onClose={close}
        initial={dialog?.kind === 'plan' ? dialog.initial : null}
        onSaved={saved}
      />
      <ResourceFormDialog
        resource="option-grants"
        isOpen={dialog?.kind === 'grant'}
        onClose={close}
        initial={dialog?.kind === 'grant' ? dialog.initial : null}
        defaults={dialog?.kind === 'grant' ? { planId: dialog.planId } : undefined}
        hiddenKeys={['planId']}
        onSaved={saved}
      />
      <ResourceFormDialog
        resource="option-events"
        isOpen={dialog?.kind === 'event'}
        onClose={close}
        title={
          dialog?.kind === 'event'
            ? `${dialog.grant.holderName}（${dialog.grant.plan.name}）の${dialog.eventType === 'exercise' ? '行使' : '失効'}を記録`
            : undefined
        }
        defaults={
          dialog?.kind === 'event'
            ? {
                grantId: dialog.grant.grant.id,
                eventType: dialog.eventType,
                eventDate: today,
                units:
                  dialog.eventType === 'exercise' && dialog.grant.exercisableUnits > 0
                    ? dialog.grant.exercisableUnits.toLocaleString('ja-JP')
                    : '',
              }
            : undefined
        }
        hiddenKeys={['grantId', 'eventType']}
        enableAi={false}
        onSaved={(row) => {
          if (dialog?.kind === 'event') eventSaved(dialog.grant, row);
        }}
      />
      <ResourceFormDialog
        resource="share-transactions"
        isOpen={dialog?.kind === 'transaction'}
        onClose={close}
        title="行使による株式の異動を記録"
        defaults={dialog?.kind === 'transaction' ? dialog.defaults : undefined}
        enableAi={false}
        onSaved={() => {
          saved();
          setReminder(null);
        }}
      />
      <ConfirmDialog
        isOpen={dialog?.kind === 'delete'}
        title={dialog?.kind === 'delete' ? dialog.title : ''}
        message={dialog?.kind === 'delete' ? dialog.message : ''}
        onCancel={close}
        onConfirm={async () => {
          if (dialog?.kind !== 'delete') return;
          await deleteItem(dialog.resource, dialog.id);
          close();
          await reload();
        }}
      />
    </>
  );
};
