'use client';

// 転換型証券の回次 1 つ分のカード。条件・転換の概算・投資家の一覧を出す。
import React from 'react';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { NoticeList, type NoticeLevel } from '@/components/resource/parts';
import { Button } from '@/components/ui/button';
import { formatDateJa, formatNumber, formatShares, formatYen, formatYenJa } from '@/lib/equity/format';
import { CAP_BASES, CONVERTIBLE_INSTRUMENT_TYPES, CONVERTIBLE_STATUSES, optionLabel, type ConvertibleStatus } from '@/lib/equity/types';
import type { DeadlineStatus, InvestmentView, RoundView } from '../services/convertibleSummary';

export interface RoundActions {
  editRound: (view: RoundView) => void;
  deleteRound: (view: RoundView) => void;
  addInvestment: (view: RoundView) => void;
  editInvestment: (view: RoundView, investment: InvestmentView) => void;
  deleteInvestment: (view: RoundView, investment: InvestmentView) => void;
  recordConversion: (view: RoundView, investment: InvestmentView) => void;
  recordTransaction: (view: RoundView, investment: InvestmentView) => void;
  /** 文書テンプレートから、この回次の文書（条件のまとめ・発行の議案・払込みの案内など）を作る */
  composeDocument: (view: RoundView) => void;
}

const STATUS_PILLS: Record<ConvertibleStatus, string> = {
  outstanding: 'gt-pill-warn',
  converted: 'gt-pill-good',
  redeemed: 'gt-pill-neutral',
};

export const CAP_BASIS_NOTES = {
  post_money: 'ポストマネー: 評価上限額を、転換型の転換後の株式も含めた完全希釈化後株式数で割ります（転換後の持分が読みやすい）。',
  pre_money: 'プレマネー: 評価上限額を、転換型の転換後の株式を含めない完全希釈化後株式数で割ります（転換型が増えるほど既存株主が希薄化する）。',
} as const;

export const deadlineLabel = (deadline: DeadlineStatus): { text: string; className: string } | null => {
  if (deadline.daysLeft == null) return null;
  if (deadline.state === 'overdue') return { text: `期限を ${Math.abs(deadline.daysLeft)} 日超過`, className: 'gt-pill-bad' };
  if (deadline.daysLeft === 0) return { text: '今日が期限', className: 'gt-pill-warn' };
  return { text: `あと ${deadline.daysLeft} 日`, className: deadline.state === 'soon' ? 'gt-pill-warn' : 'gt-pill-neutral' };
};

const Term = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt className="text-[12px] text-text-muted">{label}</dt>
    <dd className="m-0 mt-0.5 text-[13.5px] text-text-heading tabular-nums">{children}</dd>
  </div>
);

export const RoundCard = ({
  view,
  hasScenarioPrice,
  editable,
  actions,
}: {
  view: RoundView;
  /** 次回調達の単価が入力されているか */
  hasScenarioPrice: boolean;
  editable: boolean;
  actions: RoundActions;
}) => {
  const { round, conversion } = view;
  const deadline = deadlineLabel(view.deadline);
  const unconverted = view.investments.filter((investment) => !investment.converted).length;
  const allConverted = view.investments.length > 0 && unconverted === 0;

  const notices: { level: NoticeLevel; message: string; key: string }[] = [];
  if (view.deadline.state === 'overdue') {
    notices.push({
      key: 'deadline',
      level: 'warning',
      message: `転換期限（${formatDateJa(round.conversionDeadline)}）を過ぎています。期限までに適格資金調達が無かった場合の扱い（J-KISS のひな形では、所定の承認を経て評価上限額による転換価額で行使できる定め）は、契約書・発行要項で確認してください。`,
    });
  }
  if (round.status === 'outstanding' && allConverted) {
    notices.push({
      key: 'status',
      level: 'info',
      message: 'すべての投資が転換済みです。回次の状態を「転換済み」に変更してください。',
    });
  }
  if (view.investments.some((investment) => investment.converted && !investment.hasTransaction)) {
    notices.push({
      key: 'transaction',
      level: 'warning',
      message: '転換済みの投資のうち、株式の異動（転換）が記録されていないものがあります。株主名簿に反映するには株式の異動も記録してください。',
    });
  }

  return (
    <section className="gt-card gt-card-table" aria-label={round.name}>
      {/* 狭い画面では、名称の下にボタンを折り返す */}
      <div className="gt-card-head flex-wrap">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="gt-card-title m-0">{round.name}</h2>
            <span className={`gt-pill gt-pill-sm ${STATUS_PILLS[round.status]}`}>{optionLabel(CONVERTIBLE_STATUSES, round.status)}</span>
            <span className="gt-pill gt-pill-sm gt-pill-accent">{optionLabel(CONVERTIBLE_INSTRUMENT_TYPES, round.instrumentType)}</span>
          </div>
          <div className="gt-card-sub">
            調達額 {formatYenJa(view.totalAmount)}（{view.investments.length} 件）・未転換 {formatYenJa(view.outstandingAmount)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-none">
          <Button type="button" variant="outline" size="sm" onClick={() => actions.composeDocument(view)}>
            <FileText />
            文書を作る
          </Button>
          {editable && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => actions.editRound(view)}>
                <Pencil />
                編集
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`${round.name}を削除`} onClick={() => actions.deleteRound(view)}>
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-5 gap-y-3 mt-4 mb-0">
        <Term label="評価上限額（キャップ）">
          {round.valuationCap == null ? (
            'なし'
          ) : (
            <>
              {formatYenJa(round.valuationCap)}
              <span className="block text-text-muted text-[12px]">{optionLabel(CAP_BASES, round.capBasis)}</span>
            </>
          )}
        </Term>
        <Term label="ディスカウント">{Math.round(round.discountRate * 10_000) / 100}%</Term>
        <Term label="適格資金調達の金額">
          {round.qualifiedFinancingAmount == null ? <span className="text-text-muted">未入力</span> : `${formatYenJa(round.qualifiedFinancingAmount)}以上`}
        </Term>
        <Term label="発行日（割当日）">{formatDateJa(round.issueDate)}</Term>
        <Term label="転換期限">
          {formatDateJa(round.conversionDeadline)}
          {deadline && <span className={`gt-pill gt-pill-sm ml-1.5 ${deadline.className}`}>{deadline.text}</span>}
        </Term>
      </dl>
      {round.valuationCap != null && (
        <p className="text-[12px] leading-relaxed text-text-muted mt-2 mb-0">{CAP_BASIS_NOTES[round.capBasis]}</p>
      )}

      {conversion && (
        <div className="mt-4 rounded-md border border-border bg-bg-subtle px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-text-heading">転換の概算</span>
            {conversion.basis === 'cap' && <span className="gt-pill gt-pill-sm gt-pill-accent">キャップ基準で転換</span>}
            {conversion.basis === 'discount' && <span className="gt-pill gt-pill-sm gt-pill-accent">ディスカウント基準で転換</span>}
            {conversion.basis === 'undetermined' && <span className="gt-pill gt-pill-sm gt-pill-neutral">転換価額を決められません</span>}
            {view.qualified === 'reached' && <span className="gt-pill gt-pill-sm gt-pill-good">入力した調達額は適格資金調達の金額以上</span>}
            {view.qualified === 'not_reached' && <span className="gt-pill gt-pill-sm gt-pill-warn">入力した調達額は適格資金調達の金額に届かない</span>}
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-2 mt-2 mb-0">
            <Term label="キャップ価格（1 株）">{conversion.capPrice == null ? '—' : formatYen(conversion.capPrice)}</Term>
            <Term label="ディスカウント価格（1 株）">
              {conversion.discountPrice == null ? (
                <span className="text-text-muted text-[12.5px]">{hasScenarioPrice ? '—' : '次回調達の単価を入力'}</span>
              ) : (
                formatYen(conversion.discountPrice)
              )}
            </Term>
            <Term label="転換価額（低い方）">
              {conversion.conversionPrice > 0 ? <strong>{formatYen(conversion.conversionPrice)}</strong> : '—'}
            </Term>
            <Term label="転換株式数（概算）">
              {conversion.conversionPrice > 0 ? <strong>{formatShares(conversion.totalShares)}</strong> : '—'}
            </Term>
          </dl>
          {conversion.basis === 'undetermined' && (
            <p className="text-[12px] text-text-muted mt-2 mb-0">
              評価上限額が無い回次は、次回調達の単価を入力するとディスカウント基準で試算できます。
            </p>
          )}
          {view.qualified === 'not_reached' && (
            <p className="text-[12px] text-text-muted mt-2 mb-0">
              適格資金調達に当たらない調達では、この回次が転換するかどうかは契約書の定めによります。下の株式数は転換した場合の試算です。
            </p>
          )}
        </div>
      )}

      {notices.length > 0 && (
        <div className="mt-4">
          <NoticeList items={notices} />
        </div>
      )}
      {round.notes && <p className="text-[12.5px] leading-relaxed text-text-muted mt-3 mb-0 whitespace-pre-wrap">備考: {round.notes}</p>}

      <div className="flex items-center justify-between gap-3 mt-5">
        <h3 className="text-[14px] font-semibold text-text-heading m-0">投資家</h3>
        {editable && (
          <Button type="button" variant="outline" size="sm" onClick={() => actions.addInvestment(view)}>
            <Plus />
            投資を追加
          </Button>
        )}
      </div>
      {view.investments.length === 0 ? (
        <p className="text-[13px] text-text-muted mt-2 mb-3">まだ投資の記録がありません。</p>
      ) : (
        <div className="gt-table-scroll mt-1">
          <table className="gt-table">
            <thead>
              <tr>
                <th>投資家</th>
                <th className="gt-num">投資額</th>
                <th>払込日</th>
                <th className="gt-num">転換株式数</th>
                <th>転換の状況</th>
                {editable && <th aria-label="操作" />}
              </tr>
            </thead>
            <tbody>
              {view.investments.map((item) => {
                const { investment } = item;
                return (
                  <tr key={investment.id}>
                    {/* 氏名は 14 文字ほどまで 1 行に収め、それより長い名称だけ折り返す。
                        その下のメモは文章なので折り返す（セルの文字はメモの大きさ・色にし、氏名だけ本文の大きさに戻す） */}
                    <td className="gt-wrap text-[12px] text-text-muted">
                      <span className="block w-max max-w-[14.5em] text-[13.5px] font-medium text-text-heading">{item.holderName}</span>
                      {investment.notes}
                    </td>
                    <td className="gt-num">{formatYenJa(investment.amount)}</td>
                    <td>{formatDateJa(investment.investmentDate)}</td>
                    <td className="gt-num">
                      {item.converted ? (
                        formatNumber(investment.convertedShares)
                      ) : item.estimatedShares != null ? (
                        <>
                          {formatNumber(item.estimatedShares)}
                          <span className="text-[11.5px] text-text-muted ml-1">概算</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {item.converted ? (
                        <>
                          <span className="gt-pill gt-pill-sm gt-pill-good">転換済み</span>
                          <span className="text-[12px] text-text-muted ml-1.5">{formatDateJa(investment.convertedOn)}</span>
                          {!item.hasTransaction && (
                            <span className="block text-[12px] mt-0.5">
                              <span className="text-warning font-medium">株式の異動が未記録</span>
                              {editable && (
                                <button
                                  type="button"
                                  className="bg-transparent border-none p-0 ml-1 cursor-pointer text-primary underline"
                                  onClick={() => actions.recordTransaction(view, item)}
                                >
                                  記録する
                                </button>
                              )}
                            </span>
                          )}
                        </>
                      ) : round.status === 'outstanding' ? (
                        <span className="gt-pill gt-pill-sm gt-pill-warn">未転換</span>
                      ) : (
                        <span className="gt-pill gt-pill-sm gt-pill-neutral">{optionLabel(CONVERTIBLE_STATUSES, round.status)}</span>
                      )}
                    </td>
                    {editable && (
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          {!item.converted && round.status === 'outstanding' && (
                            <Button type="button" variant="outline" size="xs" onClick={() => actions.recordConversion(view, item)}>
                              転換を記録
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`${item.holderName} の投資を編集`}
                            onClick={() => actions.editInvestment(view, item)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`${item.holderName} の投資を削除`}
                            onClick={() => actions.deleteInvestment(view, item)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
