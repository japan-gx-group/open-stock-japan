'use client';

// 資金調達ラウンドの一覧。ラウンドごとに条件・払込みの実績・登記の状況・割当て（株式の異動）を出す。

import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { EmptyState } from '@/components/resource/parts';
import { formatDateJa, formatNumber, formatRatio, formatYen, formatYenJa, todayInTokyo } from '@/lib/equity/format';
import { optionLabel, ROUND_STATUSES, ROUND_TYPES, SHARE_TRANSACTION_TYPES, type EquitySnapshot } from '@/lib/equity/types';
import { LEGAL } from '@/lib/legal/rules';
import { deleteItem } from '@/lib/resources/client';
import type { ResourceRow } from '@/lib/resources/fields';
import { summarizeRounds, type RoundAllotment, type RoundRegistration, type RoundSummary } from '../services/roundSummary';

const Fact = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
  <div>
    <dt className="text-[12px] text-text-muted">{label}</dt>
    <dd className="m-0 mt-0.5 text-[14px] font-medium text-text-heading tabular-nums">{value}</dd>
    {sub && <dd className="m-0 text-[12px] text-text-muted tabular-nums">{sub}</dd>}
  </div>
);

const RegistrationStatus = ({ registration }: { registration: RoundRegistration }) => {
  const deadlineText = registration.deadline ? `期限 ${formatDateJa(registration.deadline)}` : null;
  switch (registration.state) {
    case 'registered':
      return (
        <>
          <span className="gt-pill gt-pill-sm gt-pill-good">登記済み</span>
          <span className="text-[12px] text-text-muted ml-2">
            {formatDateJa(registration.registeredOn)}
            {registration.registeredLate && deadlineText && `（${deadlineText} を過ぎての登記）`}
          </span>
        </>
      );
    case 'overdue':
      return (
        <>
          <span className="gt-pill gt-pill-sm gt-pill-bad">登記の期限超過</span>
          <span className="text-[12px] text-danger ml-2">
            {deadlineText}（{Math.abs(registration.daysLeft ?? 0)} 日超過）
          </span>
        </>
      );
    case 'pending':
      return (
        <>
          <span className="gt-pill gt-pill-sm gt-pill-warn">登記が未了</span>
          <span className="text-[12px] text-text-muted ml-2">
            {deadlineText}（{registration.daysLeft === 0 ? '今日まで' : `あと ${registration.daysLeft} 日`}）
          </span>
        </>
      );
    default:
      return (
        <>
          <span className="gt-pill gt-pill-sm gt-pill-neutral">登記の対象外（払込み前）</span>
          {deadlineText && <span className="text-[12px] text-text-muted ml-2">払込期日どおりなら{deadlineText}</span>}
        </>
      );
  }
};

export const FundingRoundsTab = ({
  snapshot,
  canEdit,
  onChanged,
}: {
  snapshot: EquitySnapshot;
  canEdit: boolean;
  onChanged: () => void;
}) => {
  const [isRoundFormOpen, setIsRoundFormOpen] = useState(false);
  const [editingRound, setEditingRound] = useState<RoundSummary | null>(null);
  const [deletingRound, setDeletingRound] = useState<RoundSummary | null>(null);
  const [allotmentRound, setAllotmentRound] = useState<RoundSummary | null>(null);
  const [editingAllotment, setEditingAllotment] = useState<RoundAllotment | null>(null);
  const [isAllotmentFormOpen, setIsAllotmentFormOpen] = useState(false);
  const [deletingAllotment, setDeletingAllotment] = useState<RoundAllotment | null>(null);

  const summaries = useMemo(() => summarizeRounds(snapshot, todayInTokyo()), [snapshot]);

  const allotmentDefaults = useMemo(() => {
    if (!allotmentRound) return undefined;
    const { round } = allotmentRound;
    const defaults: Record<string, string | boolean> = {
      roundId: round.id,
      transactionType: round.roundType === 'founding' ? 'founding' : 'new_issue',
    };
    if (round.shareClassId) defaults.shareClassId = round.shareClassId;
    if (round.pricePerShare != null) defaults.pricePerShare = String(round.pricePerShare);
    if (round.closingDate) defaults.transactionDate = round.closingDate;
    return defaults;
  }, [allotmentRound]);

  const openRoundForm = (summary: RoundSummary | null) => {
    setEditingRound(summary);
    setIsRoundFormOpen(true);
  };
  const openAllotmentForm = (summary: RoundSummary, allotment: RoundAllotment | null) => {
    setAllotmentRound(summary);
    setEditingAllotment(allotment);
    setIsAllotmentFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="text-[12.5px] leading-relaxed text-text-muted m-0" style={{ flex: '1 1 420px' }}>
          募集株式の発行による変更の登記は、払込期日から {LEGAL.registrationDeadlineDays} 日以内に申請します（会社法915条1項）。払込額のうち資本金に計上しない額は、払込額の 2
          分の 1 を超えない範囲で資本準備金にできます（会社法445条）。登録免許税の目安は、増加する資本金の額の 1000 分の{' '}
          {LEGAL.capitalIncreaseRegistrationTaxRate * 1000}（最低 {formatYenJa(LEGAL.capitalIncreaseRegistrationTaxMinimum)}）で計算しています。
        </p>
        {canEdit && (
          <Button type="button" className="ml-auto" onClick={() => openRoundForm(null)}>
            <Plus />
            ラウンドを登録
          </Button>
        )}
      </div>

      {summaries.length === 0 && (
        <EmptyState
          title="資金調達ラウンドがまだ登録されていません"
          description="設立・シード・シリーズA などのラウンドを登録すると、ラウンドごとの払込額や登記の期限を確認できます。資本政策表のシミュレーションから登録することもできます。"
        />
      )}

      {summaries.map((summary) => {
        const { round, registration } = summary;
        return (
          <section key={round.id} className="gt-card gt-card-table">
            <div className="gt-card-head">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="gt-card-title m-0">{round.name}</h2>
                  <span className="gt-pill gt-pill-sm gt-pill-accent">{optionLabel(ROUND_TYPES, round.roundType)}</span>
                  <span className={`gt-pill gt-pill-sm ${round.status === 'closed' ? 'gt-pill-good' : 'gt-pill-info'}`}>
                    {optionLabel(ROUND_STATUSES, round.status)}
                  </span>
                </div>
                <p className="gt-card-sub mb-0">
                  払込期日 {formatDateJa(round.closingDate)}
                  {round.resolutionDate && ` ／ 株主総会の決議日 ${formatDateJa(round.resolutionDate)}`}
                </p>
              </div>
              {canEdit && (
                <div className="flex gap-1 flex-none">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`${round.name} を編集`} title="編集" onClick={() => openRoundForm(summary)}>
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-danger"
                    aria-label={`${round.name} を削除`}
                    title="削除"
                    onClick={() => setDeletingRound(summary)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </div>

            <dl className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-4 gap-y-4 mt-4 mb-0">
              <Fact label="発行する株式の種類" value={summary.shareClassName || '—'} />
              <Fact label="1 株あたりの払込金額" value={round.pricePerShare != null ? formatYen(round.pricePerShare, 2) : '—'} />
              <Fact label="プレマネー評価額" value={formatYenJa(round.preMoneyValuation)} />
              <Fact
                label="払込額（実績）"
                value={formatYenJa(summary.amountRaised)}
                sub={
                  round.targetAmount != null ? (
                    // 幅が足りないときは「予定 ○円」と「（○%）」の間でだけ折り返す
                    <>
                      <span className="whitespace-nowrap">予定 {formatYenJa(round.targetAmount)}</span>
                      {summary.progress != null && <span className="whitespace-nowrap">（{formatRatio(summary.progress, 0)}）</span>}
                    </>
                  ) : (
                    '予定額は未入力'
                  )
                }
              />
              <Fact
                label="ポストマネー評価額"
                value={formatYenJa(summary.postMoney)}
                sub={summary.postMoney != null ? (summary.postMoneyIsPlanned ? 'プレマネー ＋ 予定額' : 'プレマネー ＋ 払込額') : undefined}
              />
              <Fact label="発行した株式数" value={summary.sharesIssued > 0 ? `${formatNumber(summary.sharesIssued)}株` : '—'} />
            </dl>

            <div className="mt-4 flex flex-col gap-2 rounded-md border border-border bg-bg-subtle px-3 py-3">
              <div className="flex flex-wrap items-center">
                <span className="text-[12px] text-text-muted mr-3">変更の登記</span>
                <RegistrationStatus registration={registration} />
              </div>
              {summary.capitalBasis != null && summary.minimumCapital != null && (
                <div className="text-[12.5px] leading-relaxed text-text-body">
                  資本金に計上する額: {round.capitalIncreaseAmount != null ? <strong className="tabular-nums">{formatYenJa(round.capitalIncreaseAmount)}</strong> : '未入力'}
                  （{summary.amountRaised > 0 ? '払込額' : '予定額'} {formatYenJa(summary.capitalBasis)} の場合、最低{' '}
                  <span className="tabular-nums">{formatYenJa(summary.minimumCapital)}</span>）
                  {round.capitalIncreaseAmount != null && round.capitalIncreaseAmount < summary.minimumCapital && (
                    <span className="gt-pill gt-pill-sm gt-pill-bad ml-2">最低額を下回っています</span>
                  )}
                  {summary.registrationTax != null && summary.capitalIncrease != null && (
                    <>
                      <br />
                      登録免許税の目安: <strong className="tabular-nums">{formatYen(summary.registrationTax)}</strong>
                      （増加する資本金 {formatYenJa(summary.capitalIncrease)}
                      {round.capitalIncreaseAmount == null && '＝最低額で計算'}。種類株式の内容の変更など、ほかの登記事項の分は含みません）
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 mt-5">
              <h3 className="text-[13.5px] font-semibold text-text-heading m-0">割当て（このラウンドの株式の異動）</h3>
              {canEdit && (
                <Button type="button" variant="outline" size="sm" onClick={() => openAllotmentForm(summary, null)}>
                  <Plus />
                  割当てを追加
                </Button>
              )}
            </div>
            {/* relative: 見出しの sr-only（絶対配置）を、横スクロールする枠の中に収めるため */}
            <div className="gt-table-scroll relative mt-1">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th scope="col">株主</th>
                    <th scope="col">異動日</th>
                    <th scope="col">異動の種類</th>
                    <th scope="col">株式の種類</th>
                    <th scope="col" className="gt-num">株式数</th>
                    <th scope="col" className="gt-num">払込額・1 株あたり</th>
                    {canEdit && (
                      <th scope="col">
                        <span className="sr-only">操作</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {summary.allotments.length === 0 && (
                    <tr>
                      <td colSpan={canEdit ? 7 : 6} className="gt-table-empty whitespace-normal">
                        割当てがまだ登録されていません。
                      </td>
                    </tr>
                  )}
                  {summary.allotments.map((allotment) => (
                    <tr key={allotment.transaction.id}>
                      {/* 氏名は 14 文字ほどまで 1 行に収め、それより長い名称だけ折り返す */}
                      <td className="font-medium">
                        <span className="block w-max max-w-[14.5em] whitespace-normal">{allotment.stakeholderName}</span>
                      </td>
                      <td className="tabular-nums">{formatDateJa(allotment.transaction.transactionDate)}</td>
                      <td>{optionLabel(SHARE_TRANSACTION_TYPES, allotment.transaction.transactionType)}</td>
                      <td>{allotment.shareClassName}</td>
                      <td className={`gt-num ${allotment.transaction.shares < 0 ? 'text-danger' : ''}`}>{formatNumber(allotment.transaction.shares)}</td>
                      {/* 単価は払込額の下に添える（「株式の異動」の表と同じ書き方） */}
                      <td className="gt-num">
                        {formatYen(allotment.amount)}
                        {allotment.transaction.pricePerShare != null && (
                          <div className="text-[11.5px] text-text-muted">1 株 {formatYen(allotment.transaction.pricePerShare, 2)}</div>
                        )}
                      </td>
                      {/* アイコンのボタンは自身に余白を持つので、セルの左右の余白は付けない */}
                      {canEdit && (
                        <td className="px-0 text-right">
                          {allotment.transaction.groupId == null && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${allotment.stakeholderName} の割当てを編集`}
                              title="編集"
                              onClick={() => openAllotmentForm(summary, allotment)}
                            >
                              <Pencil />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-danger"
                            aria-label={`${allotment.stakeholderName} の割当てを削除`}
                            title="削除"
                            onClick={() => setDeletingAllotment(allotment)}
                          >
                            <Trash2 />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {summary.allotments.length > 1 && (
                  <tfoot>
                    <tr className="font-semibold">
                      <td colSpan={4}>合計</td>
                      <td className="gt-num">{formatNumber(summary.sharesIssued)}</td>
                      <td className="gt-num">{formatYen(summary.amountRaised)}</td>
                      {canEdit && <td />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {round.notes && <p className="text-[12.5px] text-text-muted whitespace-pre-wrap mt-3 mb-3">メモ: {round.notes}</p>}
          </section>
        );
      })}

      <ResourceFormDialog
        resource="funding-rounds"
        isOpen={isRoundFormOpen}
        onClose={() => setIsRoundFormOpen(false)}
        initial={editingRound ? (editingRound.round as unknown as ResourceRow) : null}
        onSaved={onChanged}
      />
      <ResourceFormDialog
        resource="share-transactions"
        isOpen={isAllotmentFormOpen}
        onClose={() => setIsAllotmentFormOpen(false)}
        initial={editingAllotment ? (editingAllotment.transaction as unknown as ResourceRow) : null}
        defaults={allotmentDefaults}
        hiddenKeys={editingAllotment ? undefined : ['roundId']}
        title={allotmentRound ? `${allotmentRound.round.name} の割当てを${editingAllotment ? '編集' : '追加'}` : undefined}
        onSaved={onChanged}
      />
      <ConfirmDialog
        isOpen={deletingRound !== null}
        title="資金調達ラウンドの削除"
        message={
          deletingRound && (
            <>
              「<strong>{deletingRound.round.name}</strong>」を削除します。
              {deletingRound.allotments.length > 0 &&
                ` このラウンドに紐づく ${deletingRound.allotments.length} 件の割当て（株式の異動）は削除されず、ラウンドとの紐づけだけが外れます。株主名簿の株式数は変わりません。`}
            </>
          )
        }
        onCancel={() => setDeletingRound(null)}
        onConfirm={async () => {
          if (!deletingRound) return;
          await deleteItem('funding-rounds', deletingRound.round.id);
          setDeletingRound(null);
          onChanged();
        }}
      />
      <ConfirmDialog
        isOpen={deletingAllotment !== null}
        title="割当ての削除"
        message={
          deletingAllotment && (
            <>
              「<strong>{deletingAllotment.stakeholderName}</strong>」の {formatNumber(deletingAllotment.transaction.shares)}株（
              {formatDateJa(deletingAllotment.transaction.transactionDate)}）の異動を削除します。株主名簿と資本政策表の株式数が変わります。
              {deletingAllotment.transaction.groupId != null && ' まとめて記録された行のため、同じ記録の行がすべて削除されます。'}
            </>
          )
        }
        onCancel={() => setDeletingAllotment(null)}
        onConfirm={async () => {
          if (!deletingAllotment) return;
          await deleteItem('share-transactions', deletingAllotment.transaction.id);
          setDeletingAllotment(null);
          onChanged();
        }}
      />
    </div>
  );
};
