'use client';

// J-KISS・転換型の画面。回次ごとの条件と投資家、転換の概算（キャップ・ディスカウント）、次回調達の単価での試算、
// 転換の記録（投資の更新 → 株式の異動）を扱う。
// 転換価額・転換株式数は buildCapTable の conversions をそのまま使う（資本政策表と同じ計算）。

import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { EmptyState, ErrorBlock, LoadingBlock, NoticeList, StatGrid, StatTile } from '@/components/resource/parts';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { Button } from '@/components/ui/button';
import { ComposeDialog } from '@/features/templates/components/ComposeDialog.client';
import { kindsOfCategory } from '@/features/templates/services/kinds';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEquitySnapshot } from '@/hooks/useEquitySnapshot';
import { buildCapTable, type RoundScenario } from '@/lib/equity/capTable';
import { formatDateJa, formatShares, formatYen, formatYenJa, parseNumberText, todayInTokyo } from '@/lib/equity/format';
import { deleteItem } from '@/lib/resources/client';
import type { ResourceName } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';
import { canEdit } from '@/types/role';
import {
  buildRoundViews,
  conversionTransactionDefaults,
  summarizeRounds,
  type InvestmentView,
  type RoundView,
} from '../services/convertibleSummary';
import { RoundCard, deadlineLabel, type RoundActions } from './RoundCard.client';

type DialogState =
  | { kind: 'round'; initial: ResourceRow | null }
  | { kind: 'investment'; roundId: string; initial: ResourceRow | null }
  | { kind: 'convert'; view: RoundView; initial: ResourceRow }
  | { kind: 'transaction'; defaults: Record<string, string> }
  | { kind: 'delete'; resource: ResourceName; id: string; title: string; message: string };

/** 転換を記録したあとに出す、株式の異動と登記の案内 */
interface ConversionReminder {
  holderName: string;
  roundName: string;
  shares: number;
  convertedOn: string | null;
  defaults: Record<string, string>;
}

const asRow = (row: object): ResourceRow => row as ResourceRow;

// 回次から作れる文書のテンプレートの種類（条件のまとめ・発行の議案・払込みの案内・契約書）
const CONVERTIBLE_TEMPLATE_KINDS = kindsOfCategory('convertible').map((kind) => kind.id);

export const ConvertiblesScreen = () => {
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  const { data: snapshot, error, isLoading, reload } = useEquitySnapshot();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [reminder, setReminder] = useState<ConversionReminder | null>(null);
  const [composeRound, setComposeRound] = useState<{ id: string; label: string } | null>(null);
  const [priceText, setPriceText] = useState('');
  const [amountText, setAmountText] = useState('');
  const today = todayInTokyo();

  const parsedPrice = parseNumberText(priceText);
  const parsedAmount = parseNumberText(amountText);
  const price = parsedPrice != null && parsedPrice > 0 ? parsedPrice : null;
  const newMoney = parsedAmount != null && parsedAmount > 0 ? parsedAmount : null;
  const priceInvalid = priceText.trim() !== '' && price == null;
  const amountInvalid = amountText.trim() !== '' && newMoney == null;

  const table = useMemo(() => {
    if (!snapshot) return null;
    const scenario: RoundScenario | null =
      price != null ? { pricePerShare: price, newMoney: newMoney ?? 0, newInvestorName: '', additionalPoolShares: 0 } : null;
    return buildCapTable(snapshot, { scenario });
  }, [snapshot, price, newMoney]);
  const views = useMemo(
    () => (snapshot && table ? buildRoundViews(snapshot, table, today, newMoney) : []),
    [snapshot, table, today, newMoney],
  );
  const totals = useMemo(() => summarizeRounds(views), [views]);
  const nextDeadline = totals.nextDeadline ? deadlineLabel(totals.nextDeadline.status) : null;

  const close = () => setDialog(null);
  const saved = () => void reload();
  const nextRoundNo = (snapshot?.convertibleRounds.reduce((max, round) => Math.max(max, round.roundNo), 0) ?? 0) + 1;

  const actions: RoundActions = {
    editRound: (view) => setDialog({ kind: 'round', initial: asRow(view.round) }),
    deleteRound: (view) =>
      setDialog({
        kind: 'delete',
        resource: 'convertible-rounds',
        id: view.round.id,
        title: '回次を削除',
        message:
          view.investments.length > 0
            ? `「${view.round.name}」を削除します。この回次の投資の記録 ${view.investments.length} 件も削除されます。取り消せません。`
            : `「${view.round.name}」を削除します。取り消せません。`,
      }),
    addInvestment: (view) => setDialog({ kind: 'investment', roundId: view.round.id, initial: null }),
    editInvestment: (view, item) => setDialog({ kind: 'investment', roundId: view.round.id, initial: asRow(item.investment) }),
    deleteInvestment: (view, item) =>
      setDialog({
        kind: 'delete',
        resource: 'convertible-investments',
        id: item.investment.id,
        title: '投資の記録を削除',
        message: `${item.holderName} の投資（${formatYenJa(item.investment.amount)}・${view.round.name}）を削除します。取り消せません。`,
      }),
    recordConversion: (view, item) =>
      setDialog({
        kind: 'convert',
        view,
        // 概算の株式数と今日の日付を入れておく。実際に交付した株式数に直してから保存する
        initial: asRow({ ...item.investment, convertedShares: item.estimatedShares, convertedOn: today }),
      }),
    recordTransaction: (view, item) =>
      setDialog({ kind: 'transaction', defaults: conversionTransactionDefaults(view.round, item.investment) }),
    composeDocument: (view) => setComposeRound({ id: view.round.id, label: view.round.name }),
  };

  const conversionSaved = (view: RoundView, row: ResourceRow) => {
    saved();
    if (row.convertedShares == null) return;
    const investment: InvestmentView['investment'] = {
      ...(row as unknown as InvestmentView['investment']),
      convertedShares: Number(row.convertedShares),
      amount: Number(row.amount),
    };
    setReminder({
      holderName: view.investments.find((item) => item.investment.id === row.id)?.holderName ?? '',
      roundName: view.round.name,
      shares: investment.convertedShares ?? 0,
      convertedOn: investment.convertedOn,
      defaults: conversionTransactionDefaults(view.round, investment),
    });
  };

  return (
    <>
      <PageHeading
        title="J-KISS・転換型"
        description="J-KISS 型新株予約権などの転換型証券の条件と投資家を管理し、転換後の株式数を試算します。"
        primaryAction={
          editable ? (
            <Button type="button" onClick={() => setDialog({ kind: 'round', initial: null })}>
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
      ) : snapshot && table ? (
        <div className="flex flex-col gap-4">
          {error && <ErrorBlock message={error} onRetry={() => void reload()} />}

          <StatGrid>
            <StatTile label="調達総額" value={formatYenJa(totals.totalAmount)} sub={`${views.length} 回次の投資額の合計`} />
            <StatTile label="未転換残高" value={formatYenJa(totals.outstandingAmount)} sub="状態が「未転換」の回次の、転換前の投資額" />
            <StatTile
              label="転換株式数（概算）"
              value={totals.outstandingAmount > 0 ? formatShares(totals.estimatedShares) : '—'}
              sub={
                totals.hasUndetermined
                  ? '転換価額を決められない回次を除く'
                  : price != null
                    ? `次回調達の単価 ${formatYen(price)} で試算`
                    : 'キャップ基準（次回調達の単価は未入力）'
              }
            />
            <StatTile
              label="次の転換期限"
              value={totals.nextDeadline ? formatDateJa(totals.nextDeadline.date) : '—'}
              sub={
                totals.nextDeadline ? (
                  <>
                    {totals.nextDeadline.roundName}
                    {nextDeadline && <span className={`gt-pill gt-pill-sm ml-1.5 ${nextDeadline.className}`}>{nextDeadline.text}</span>}
                  </>
                ) : (
                  '未転換の回次に転換期限はありません'
                )
              }
            />
          </StatGrid>

          <NoticeList
            items={[
              {
                level: 'info',
                message:
                  'ここに出る転換価額と転換株式数は、台帳の数字から計算した概算です。「完全希釈化後株式数」の定義や端数の扱いは契約ごとに違うため、実際の転換は契約書・発行要項に従ってください。J-KISS 型新株予約権も新株予約権の一種で、発行には株主総会の特別決議と、割当日から 2 週間以内の登記が必要です。',
              },
            ]}
          />

          {reminder && (
            <div className="gt-card border-warning/40" role="status" style={{ padding: '14px 18px' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-[13px] leading-relaxed text-text-main">
                  <div className="text-[14px] font-semibold text-text-heading">転換を記録しました。株式の異動と登記を忘れずに</div>
                  <p className="m-0 mt-1">
                    {reminder.holderName} の {reminder.roundName} が {formatShares(reminder.shares)} に転換（{formatDateJa(reminder.convertedOn)}）。
                    株主名簿に反映するには、株式の異動（転換）も記録してください。交付する株式の種類は契約書で確認して選びます。
                  </p>
                  <p className="m-0 mt-1 text-text-muted">
                    新株予約権の行使による変更の登記は、行使があった月の末日から 2 週間以内です（会社法915条3項1号）。
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

          {views.length > 0 && (
            <section className="gt-card" aria-label="次回調達の単価で試算">
              <h2 className="gt-card-title m-0">次回調達の単価で試算</h2>
              <div className="gt-card-sub">
                次回の株式での資金調達の 1 株あたり払込金額を入れると、ディスカウント価格とキャップ価格の低い方で転換株式数を計算し直します。保存はされません。
              </div>
              <div className="flex flex-wrap items-start gap-4 mt-3">
                <div style={{ width: 220 }}>
                  <label htmlFor="scenario-price" className="gt-field-label">
                    次回調達の 1 株あたり払込金額
                  </label>
                  <input
                    id="scenario-price"
                    className="gt-field w-full"
                    inputMode="decimal"
                    style={{ textAlign: 'right' }}
                    placeholder="例: 1,500"
                    value={priceText}
                    aria-invalid={priceInvalid || undefined}
                    onChange={(event) => setPriceText(event.target.value)}
                  />
                  {priceInvalid && <p className="text-[12px] text-danger mt-1 mb-0">0 より大きい数値で入力してください</p>}
                </div>
                <div style={{ width: 220 }}>
                  <label htmlFor="scenario-amount" className="gt-field-label">
                    次回調達の調達額（任意）
                  </label>
                  <input
                    id="scenario-amount"
                    className="gt-field w-full"
                    inputMode="decimal"
                    style={{ textAlign: 'right' }}
                    placeholder="例: 3億"
                    value={amountText}
                    aria-invalid={amountInvalid || undefined}
                    onChange={(event) => setAmountText(event.target.value)}
                  />
                  {amountInvalid ? (
                    <p className="text-[12px] text-danger mt-1 mb-0">0 より大きい数値で入力してください</p>
                  ) : (
                    <p className="text-[12px] text-text-muted mt-1 mb-0">各回次の「適格資金調達の金額」に届くかを確かめます</p>
                  )}
                </div>
                {(priceText || amountText) && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-[26px]"
                    onClick={() => {
                      setPriceText('');
                      setAmountText('');
                    }}
                  >
                    クリア
                  </Button>
                )}
              </div>
              <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-0">
                キャップ価格の計算に使う株式数（発行済株式の普通株換算 ＋ 未行使の新株予約権）は {formatShares(table.totals.conversionBaseShares)}{' '}
                です。ポストマネーの回次は、これに転換型の転換後の株式を加えた数で評価上限額を割ります。未転換の回次がすべて同時に転換する前提で計算しています。
                適格資金調達の金額は、転換で発行される株式の分を除いた調達額で判定するのが J-KISS のひな形の定めです。
              </p>
            </section>
          )}

          {views.length === 0 ? (
            <EmptyState
              title="転換型証券の回次がまだありません"
              description="J-KISS 型新株予約権などを発行したら、回次（評価上限額・ディスカウント・適格資金調達の金額・転換期限）と投資家ごとの投資額を登録します。"
              action={
                editable ? (
                  <Button type="button" onClick={() => setDialog({ kind: 'round', initial: null })}>
                    <Plus />
                    回次を追加
                  </Button>
                ) : undefined
              }
            />
          ) : (
            views.map((view) => (
              <RoundCard key={view.round.id} view={view} hasScenarioPrice={price != null} editable={editable} actions={actions} />
            ))
          )}
        </div>
      ) : null}

      <ResourceFormDialog
        resource="convertible-rounds"
        isOpen={dialog?.kind === 'round'}
        onClose={close}
        initial={dialog?.kind === 'round' ? dialog.initial : null}
        defaults={{ roundNo: String(nextRoundNo) }}
        onSaved={saved}
      />
      <ResourceFormDialog
        resource="convertible-investments"
        isOpen={dialog?.kind === 'investment'}
        onClose={close}
        initial={dialog?.kind === 'investment' ? dialog.initial : null}
        defaults={dialog?.kind === 'investment' ? { roundId: dialog.roundId } : undefined}
        hiddenKeys={['roundId']}
        onSaved={saved}
      />
      <ResourceFormDialog
        resource="convertible-investments"
        isOpen={dialog?.kind === 'convert'}
        onClose={close}
        title="転換を記録（株式数は概算。契約書に従って直してください）"
        initial={dialog?.kind === 'convert' ? dialog.initial : null}
        hiddenKeys={['roundId', 'stakeholderId', 'amount', 'investmentDate']}
        enableAi={false}
        onSaved={(row) => {
          if (dialog?.kind === 'convert') conversionSaved(dialog.view, row);
        }}
      />
      <ResourceFormDialog
        resource="share-transactions"
        isOpen={dialog?.kind === 'transaction'}
        onClose={close}
        title="転換による株式の異動を記録"
        defaults={dialog?.kind === 'transaction' ? dialog.defaults : undefined}
        enableAi={false}
        onSaved={() => {
          saved();
          setReminder(null);
        }}
      />
      {/* 文書テンプレート（差し込み項目を、この回次の条件と投資家に置き換える。AI は使わない） */}
      <ComposeDialog
        key={composeRound?.id ?? 'none'}
        isOpen={composeRound != null}
        subject={composeRound}
        kinds={CONVERTIBLE_TEMPLATE_KINDS}
        onClose={() => setComposeRound(null)}
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
