'use client';

// 回次（発行要項）1 つ分のカード。主な条件・登記の状況・行使条件と、割当の一覧（ベスティング・行使・失効）を出す。
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { NoticeList } from '@/components/resource/parts';
import { Button } from '@/components/ui/button';
import { formatDateJa, formatNumber, formatShares, formatUnits, formatYen } from '@/lib/equity/format';
import {
  GRANT_ROLES,
  OPTION_EVENT_TYPES,
  OPTION_PLAN_TYPES,
  VESTING_INTERVALS,
  optionLabel,
  type EquitySnapshot,
} from '@/lib/equity/types';
import type { ExercisePeriodState } from '@/lib/equity/vesting';
import { optionExerciseRegistrationDeadline } from '@/lib/legal/rules';
import { findExerciseTransaction, type GrantView, type PlanView, type VestingMilestone } from '../services/optionSummary';
import type { PlanActions } from './StockOptionsScreen.client';
import { VestingChart } from './VestingChart.client';

const PERIOD_PILLS: Record<ExercisePeriodState, { label: string; className: string }> = {
  unset: { label: '行使期間 未設定', className: 'gt-pill-neutral' },
  before: { label: '行使期間前', className: 'gt-pill-info' },
  open: { label: '行使期間中', className: 'gt-pill-good' },
  closed: { label: '行使期間満了', className: 'gt-pill-bad' },
};

const milestoneText = (milestone: VestingMilestone): string => {
  switch (milestone.kind) {
    case 'cliff':
      return `クリフ明け ${formatDateJa(milestone.date)}`;
    case 'full':
      return `全量確定 ${formatDateJa(milestone.date)}`;
    case 'done':
      return '全量確定済み';
    default:
      return 'ベスティングなし';
  }
};

const Term = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
  <div className={`min-w-0${className ? ` ${className}` : ''}`}>
    <dt className="text-[12px] text-text-muted">{label}</dt>
    <dd className="m-0 mt-0.5 text-[13.5px] text-text-heading tabular-nums">{children}</dd>
  </div>
);

/** 値のひとかたまり（日付・金額・かっこ書き）。途中では折り返さず、入りきらないときはかたまりごと次の行へ送る */
const Chunk = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <span className={`inline-block whitespace-nowrap${className ? ` ${className}` : ''}`}>{children}</span>
);

const GrantRows = ({
  grant,
  view,
  snapshot,
  today,
  editable,
  actions,
  columnCount,
}: {
  grant: GrantView;
  view: PlanView;
  snapshot: EquitySnapshot;
  today: string;
  editable: boolean;
  actions: PlanActions;
  columnCount: number;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { plan } = view;
  const vestedRatio = grant.grant.units > 0 ? grant.vesting.vestedUnits / grant.grant.units : 0;
  const periodBlocked = view.periodState === 'before' || view.periodState === 'closed';

  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer text-left"
            aria-expanded={isOpen}
            aria-label={`${grant.holderName} の履歴とベスティング予定を${isOpen ? '閉じる' : '開く'}`}
            onClick={() => setIsOpen((previous) => !previous)}
          >
            {isOpen ? (
              <ChevronDown size={14} className="shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-text-muted" />
            )}
            {/* 氏名と区分は 9 文字ぶんの幅を保ち、長い名称・区分だけがその中で折り返す */}
            <span className="gt-wrap-sm">
              <span className="block font-medium text-text-heading">{grant.holderName}</span>
              <span className="block text-[12px] text-text-muted">{optionLabel(GRANT_ROLES, grant.grant.holderRole)}</span>
            </span>
          </button>
        </td>
        <td className="gt-num">
          {formatNumber(grant.grant.units)}
          <span className="block text-[11.5px] text-text-muted">{formatDateJa(grant.acquiredOn)}</span>
        </td>
        <td>
          <div className="tabular-nums text-[13px]">
            {formatNumber(grant.vesting.vestedUnits)}
            <span className="text-text-muted"> ／ 未確定 {formatNumber(grant.vesting.unvestedUnits)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div
              className="h-1.5 flex-1 rounded-full bg-border overflow-hidden"
              role="progressbar"
              aria-label="確定済みの割合"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(vestedRatio * 100)}
            >
              <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, vestedRatio * 100)}%` }} />
            </div>
            <span className="w-[2.75em] flex-none text-right text-[11.5px] tabular-nums text-text-muted">{Math.round(vestedRatio * 100)}%</span>
          </div>
          <div className="mt-1 text-[12px] text-text-muted">{milestoneText(grant.milestone)}</div>
        </td>
        <td className="gt-num">{formatNumber(grant.exercisedUnits)}</td>
        <td className="gt-num">{formatNumber(grant.forfeitedUnits)}</td>
        <td className="gt-num">
          <span className="font-semibold">{formatNumber(grant.remainingUnits)}</span>
          <span className="block text-[11.5px] text-text-muted">{formatShares(grant.remainingShares)}</span>
        </td>
        <td className="gt-num">
          <span className={periodBlocked ? 'text-text-muted' : undefined}>{formatNumber(grant.exercisableUnits)}</span>
          {periodBlocked && grant.exercisableUnits > 0 && (
            <span className="block text-[11.5px] text-text-muted">{view.periodState === 'before' ? '行使期間前' : '期間満了'}</span>
          )}
        </td>
        {editable && (
          <td>
            {/* 表の幅が足りる画面では横 1 列、足りない画面では 2 段（記録の 2 つを縦に、その右に編集・削除）に並べる */}
            <div className="grid grid-flow-col grid-rows-2 items-center justify-end gap-1 @[1030px]:flex @[1030px]:gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={grant.remainingUnits === 0}
                onClick={() => actions.recordEvent(grant, 'exercise')}
              >
                行使を記録
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={grant.remainingUnits === 0}
                onClick={() => actions.recordEvent(grant, 'forfeit')}
              >
                失効を記録
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`${grant.holderName} の割当を編集`} onClick={() => actions.editGrant(grant)}>
                <Pencil />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`${grant.holderName} の割当を削除`} onClick={() => actions.deleteGrant(grant)}>
                <Trash2 />
              </Button>
            </div>
          </td>
        )}
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={columnCount} className="bg-bg-subtle whitespace-normal">
            {/* 中身の幅は、表ではなくカード（@container）の幅に合わせる（100cqw からセルの左右の余白 6px ずつを引く）。
                表が横にスクロールする幅の画面でも、履歴とグラフは見えている範囲に留まる（sticky）。
                履歴の表のほうを広く取り、カードが狭いときは縦に並べる */}
            <div className="sticky left-1.5 grid w-[calc(100cqw-12px)] grid-cols-1 gap-5 py-1 @[880px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-text-heading mb-1.5">行使・失効の履歴</div>
                {grant.events.length === 0 ? (
                  <p className="text-[12.5px] text-text-muted m-0">行使・失効の記録はありません。</p>
                ) : (
                  <div className="gt-table-scroll [--gt-table-bg:var(--color-bg-subtle)]">
                    <table className="gt-table">
                      <thead>
                        <tr>
                          <th>日付</th>
                          <th>種類</th>
                          <th className="gt-num">個数</th>
                          <th>備考・株式の異動</th>
                          {editable && <th aria-label="操作" />}
                        </tr>
                      </thead>
                      <tbody>
                        {grant.events.map((event) => {
                          const typeLabel = optionLabel(OPTION_EVENT_TYPES, event.eventType);
                          const shares = event.units * plan.sharesPerUnit;
                          const recorded =
                            event.eventType === 'exercise' &&
                            findExerciseTransaction(snapshot.shareTransactions, grant.grant.stakeholderId, event.eventDate, shares) != null;
                          return (
                            <tr key={event.id}>
                              <td>{formatDateJa(event.eventDate)}</td>
                              <td>
                                <span className={`gt-pill gt-pill-sm ${event.eventType === 'exercise' ? 'gt-pill-good' : 'gt-pill-neutral'}`}>
                                  {typeLabel}
                                </span>
                              </td>
                              <td className="gt-num">{formatNumber(event.units)}</td>
                              <td className="gt-wrap text-[12.5px]">
                                {event.notes && <div className="text-text-body">{event.notes}</div>}
                                {event.eventType === 'exercise' && (
                                  <div className="text-text-muted">
                                    {formatShares(shares)}を交付。
                                    {recorded ? (
                                      '株式の異動に記録済み。'
                                    ) : (
                                      <>
                                        <span className="text-warning font-medium">株式の異動が未記録です。</span>
                                        {editable && (
                                          <button
                                            type="button"
                                            className="bg-transparent border-none p-0 ml-1 cursor-pointer text-primary underline"
                                            onClick={() => actions.recordExerciseTransaction(grant, event.eventDate, event.units)}
                                          >
                                            記録する
                                          </button>
                                        )}
                                      </>
                                    )}
                                    <span className="block whitespace-nowrap">登記の期限 {formatDateJa(optionExerciseRegistrationDeadline(event.eventDate))}</span>
                                  </div>
                                )}
                              </td>
                              {editable && (
                                <td className="text-right">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`${formatDateJa(event.eventDate)} の${typeLabel}の記録を削除`}
                                    onClick={() =>
                                      actions.deleteEvent(grant, event.id, `${formatDateJa(event.eventDate)} ${typeLabel} ${formatUnits(event.units)}`)
                                    }
                                  >
                                    <Trash2 />
                                  </Button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {grant.grant.notes && <p className="text-[12.5px] text-text-muted mt-2 mb-0">割当の備考: {grant.grant.notes}</p>}
              </div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-text-heading mb-1.5">
                  ベスティング予定（確定済みの個数）
                  {grant.vesting.startOn && (
                    <>
                      {' '}
                      <span className="inline-block font-normal text-text-muted">起算日 {formatDateJa(grant.vesting.startOn)}</span>
                    </>
                  )}
                </div>
                <VestingChart grant={grant.grant} plan={plan} today={today} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export const PlanCard = ({
  view,
  snapshot,
  today,
  editable,
  actions,
}: {
  view: PlanView;
  snapshot: EquitySnapshot;
  today: string;
  editable: boolean;
  actions: PlanActions;
}) => {
  const { plan, registration } = view;
  const className = plan.shareClassId ? snapshot.shareClasses.find((shareClass) => shareClass.id === plan.shareClassId)?.name : null;
  const period = PERIOD_PILLS[view.periodState];
  const columnCount = editable ? 8 : 7;

  const notices: { level: 'error' | 'warning'; message: string; key: string }[] = [];
  if (registration.state === 'overdue') {
    notices.push({
      key: 'registration',
      level: 'warning',
      message: `新株予約権の発行の登記が未了で、期限（${formatDateJa(registration.deadline)}。割当日から 2 週間以内）を過ぎています。登記を済ませたら「登記した日」を入力してください（会社法911条3項12号・915条1項）。`,
    });
  }
  if (view.overAllocatedUnits > 0) {
    notices.push({
      key: 'over',
      level: 'error',
      message: `割当個数の合計が発行総数を ${formatUnits(view.overAllocatedUnits)} 超えています。回次の発行総数か割当個数を確認してください。`,
    });
  }

  return (
    <section className="gt-card gt-card-table" aria-label={plan.name}>
      <div className="gt-card-head">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="gt-card-title m-0">{plan.name}</h2>
            <span className="gt-pill gt-pill-sm gt-pill-accent">{optionLabel(OPTION_PLAN_TYPES, plan.planType)}</span>
            <span className={`gt-pill gt-pill-sm ${period.className}`}>{period.label}</span>
          </div>
          <div className="gt-card-sub">
            割当済み {formatUnits(view.grantedUnits)}（{view.grants.length} 名）・未割当 {formatUnits(view.unallocatedUnits)}・未行使 {formatUnits(view.remainingUnits)}
          </div>
        </div>
        {editable && (
          <div className="flex items-center gap-1.5 flex-none">
            <Button type="button" variant="outline" size="sm" onClick={() => actions.editPlan(view)}>
              <Pencil />
              編集
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`${plan.name}を削除`} onClick={() => actions.deletePlan(view)}>
              <Trash2 />
            </Button>
          </div>
        )}
      </div>

      {/* 列数はカードの幅に合わせて決まる（1 列は 215px 以上）。行使期間だけ 2 列ぶん使うので、
          その手前に空きができる列数のときは、後ろの項目を詰めて埋める（grid-flow-dense） */}
      <dl className="grid grid-flow-dense grid-cols-[repeat(auto-fill,minmax(min(215px,100%),1fr))] gap-x-5 gap-y-3 mt-4 mb-0">
        <Term label="発行総数">
          <Chunk>{formatUnits(plan.totalUnits)}</Chunk>
          <Chunk className="text-text-muted text-[12px]">（{formatShares(plan.totalUnits * plan.sharesPerUnit)}）</Chunk>
        </Term>
        <Term label="1 個あたりの株式数">
          <Chunk>{formatShares(plan.sharesPerUnit)}</Chunk>
          {className && <span className="text-text-muted text-[12px]">（{className}）</span>}
        </Term>
        <Term label="行使価額（1 株あたり）">{formatYen(plan.exercisePrice, 2)}</Term>
        <Term label="発行価額（1 個あたり）">{plan.issuePrice === 0 ? '無償' : formatYen(plan.issuePrice, 2)}</Term>
        <Term label="付与契約時の時価（1 株）">
          {plan.fairValuePerShare == null ? <span className="text-text-muted">未入力</span> : formatYen(plan.fairValuePerShare, 2)}
        </Term>
        <Term label="発行決議日">{formatDateJa(plan.resolutionDate)}</Term>
        <Term label="割当日">{formatDateJa(plan.allotmentDate)}</Term>
        {/* 2 つの日付を 1 行に収めるため 2 列ぶん使う（1 列しか無い幅の画面では 1 列のまま） */}
        <Term label="行使期間" className="sm:col-span-2">
          {plan.exercisePeriodStart || plan.exercisePeriodEnd ? (
            <>
              <Chunk>
                {formatDateJa(plan.exercisePeriodStart)}
                <span className="text-text-muted"> 〜</span>
              </Chunk>{' '}
              <Chunk>{formatDateJa(plan.exercisePeriodEnd)}</Chunk>
            </>
          ) : (
            <span className="text-text-muted">未設定</span>
          )}
        </Term>
        <Term label="ベスティング条件">
          {(plan.vestingMonths ?? 0) > 0 ? (
            <>
              <Chunk>{plan.vestingMonths} か月</Chunk>
              <Chunk className="text-text-muted text-[12px]">
                （{(plan.cliffMonths ?? 0) > 0 ? `クリフ ${plan.cliffMonths} か月・` : ''}
                {optionLabel(VESTING_INTERVALS, plan.vestingInterval)}）
              </Chunk>
            </>
          ) : (
            'なし'
          )}
        </Term>
        <Term label="登記の状況">
          {registration.state === 'registered' ? (
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="gt-pill gt-pill-sm gt-pill-good">登記済み</span>
              <Chunk className="text-text-muted text-[12px]">{formatDateJa(plan.registeredOn)}</Chunk>
            </span>
          ) : registration.state === 'overdue' ? (
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="gt-pill gt-pill-sm gt-pill-bad">期限超過</span>
              <Chunk className="text-text-muted text-[12px]">期限 {formatDateJa(registration.deadline)}</Chunk>
            </span>
          ) : registration.state === 'pending' ? (
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="gt-pill gt-pill-sm gt-pill-warn">未登記</span>
              <Chunk className="text-text-muted text-[12px]">期限 {formatDateJa(registration.deadline)}</Chunk>
            </span>
          ) : (
            <span className="text-text-muted text-[12.5px]">割当日を入力すると期限を表示します</span>
          )}
        </Term>
      </dl>

      {notices.length > 0 && (
        <div className="mt-4">
          <NoticeList items={notices} />
        </div>
      )}

      {(plan.exerciseConditions || plan.notes) && (
        <details className="mt-4 text-[13px]">
          <summary className="cursor-pointer text-text-main font-medium">行使条件・取得条項{plan.notes ? '・備考' : ''}</summary>
          {plan.exerciseConditions && (
            <p className="mt-2 mb-0 leading-relaxed text-text-body whitespace-pre-wrap">{plan.exerciseConditions}</p>
          )}
          {plan.notes && <p className="mt-2 mb-0 leading-relaxed text-text-muted whitespace-pre-wrap">備考: {plan.notes}</p>}
        </details>
      )}

      <div className="flex items-center justify-between gap-3 mt-5">
        <h3 className="text-[14px] font-semibold text-text-heading m-0">割当</h3>
        {editable && (
          <Button type="button" variant="outline" size="sm" onClick={() => actions.addGrant(view)}>
            <Plus />
            割当を追加
          </Button>
        )}
      </div>
      {view.grants.length === 0 ? (
        <p className="text-[13px] text-text-muted mt-2 mb-3">まだ割当がありません。</p>
      ) : (
        // @container: 操作の並べ方と、開いた行の 2 段組みを、画面ではなくこのカードの幅で切り替える
        <div className="@container mt-1">
          <div className="gt-table-scroll">
            <table className="gt-table">
              <thead>
                <tr>
                  <th>割当先</th>
                  <th className="gt-num" title="上段: 割当個数 ／ 下段: 割当日">
                    割当個数・割当日
                  </th>
                  <th>確定済み ／ 未確定</th>
                  <th className="gt-num">行使済み</th>
                  <th className="gt-num">失効</th>
                  <th className="gt-num" title="上段: 残数（個） ／ 下段: 残数を株式に換算した数">
                    残数（株換算）
                  </th>
                  <th className="gt-num">行使可能数</th>
                  {editable && <th aria-label="操作" />}
                </tr>
              </thead>
              <tbody>
                {view.grants.map((grant) => (
                  <GrantRows
                    key={grant.grant.id}
                    grant={grant}
                    view={view}
                    snapshot={snapshot}
                    today={today}
                    editable={editable}
                    actions={actions}
                    columnCount={columnCount}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
