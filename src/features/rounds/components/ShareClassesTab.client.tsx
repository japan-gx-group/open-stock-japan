'use client';

// 株式の種類（普通株式・優先株式など）の一覧と登録・編集・削除。

import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { formatNumber, formatRatio, formatYen } from '@/lib/equity/format';
import { ANTI_DILUTION_TYPES, optionLabel, PARTICIPATION_TYPES, SHARE_CLASS_KINDS, type EquitySnapshot } from '@/lib/equity/types';
import { deleteItem } from '@/lib/resources/client';
import type { ResourceRow } from '@/lib/resources/fields';
import { summarizeShareClasses, type ShareClassSummary } from '../services/roundSummary';

/**
 * 「1 倍・参加型（上限なし）」のように括弧書きの付くラベル。
 * 幅が足りないときは括弧の前でだけ折り返し、語の途中では折り返さない（折り返してよいセルの中で使う）。
 */
const ParenBreak = ({ text }: { text: string }) => {
  const index = text.indexOf('（');
  if (index <= 0) return <span className="whitespace-nowrap">{text}</span>;
  return (
    <>
      <span className="inline-block whitespace-nowrap">{text.slice(0, index)}</span>
      <span className="inline-block whitespace-nowrap">{text.slice(index)}</span>
    </>
  );
};

export const ShareClassesTab = ({
  snapshot,
  canEdit,
  onChanged,
}: {
  snapshot: EquitySnapshot;
  canEdit: boolean;
  onChanged: () => void;
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShareClassSummary | null>(null);
  const [deleting, setDeleting] = useState<ShareClassSummary | null>(null);
  const summaries = useMemo(() => summarizeShareClasses(snapshot), [snapshot]);
  const columnCount = canEdit ? 8 : 7;

  return (
    <section className="gt-card gt-card-table">
      <div className="gt-card-head">
        <div>
          <h2 className="gt-card-title m-0">株式の種類</h2>
          <p className="gt-card-sub mb-0">
            種類株式の内容は定款に定め、登記します（会社法108条・911条3項7号）。ここには資本政策表と優先分配の試算に使う主な条件を登録します。
          </p>
        </div>
        {canEdit && (
          <Button
            type="button"
            className="flex-none"
            onClick={() => {
              setEditing(null);
              setIsFormOpen(true);
            }}
          >
            <Plus />
            株式の種類を登録
          </Button>
        )}
      </div>

      {/* 列の幅を数字と短いラベルに使えるよう、文章（優先配当・その他の内容）は種類ごとの 2 行目に表の幅いっぱいで出す。
          relative: 見出しの sr-only（絶対配置）を、横スクロールする枠の中に収めるため */}
      <div className="gt-table-scroll relative mt-3">
        <table className="gt-table">
          <thead>
            <tr>
              <th scope="col">種類の名称</th>
              <th scope="col">区分</th>
              <th scope="col" className="gt-num">当初の払込金額</th>
              <th scope="col">残余財産の優先分配</th>
              <th scope="col">転換比率・希薄化防止</th>
              <th scope="col">議決権</th>
              <th scope="col" className="gt-num">発行済 ／ 発行可能</th>
              {canEdit && (
                <th scope="col">
                  <span className="sr-only">操作</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {summaries.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="gt-table-empty whitespace-normal">
                  株式の種類がまだ登録されていません。まず「普通株式」を登録してください。
                </td>
              </tr>
            )}
            {summaries.map((summary) => {
              const { shareClass } = summary;
              const hasPreference = shareClass.kind !== 'common' && (shareClass.originalIssuePrice ?? 0) > 0 && shareClass.liquidationMultiple > 0;
              const hasDetail = Boolean(shareClass.dividendPreference || shareClass.terms);
              return (
                <React.Fragment key={shareClass.id}>
                  {/* 2 行目（文章）が続く種類は、1 行目の下の罫線を引かず、ひとまとまりに見せる */}
                  <tr className={hasDetail ? '[&>td]:border-b-0 [&>td]:pb-1.5' : undefined}>
                    <td className="font-medium">{shareClass.name}</td>
                    <td>{optionLabel(SHARE_CLASS_KINDS, shareClass.kind)}</td>
                    <td className="gt-num">{shareClass.originalIssuePrice != null ? formatYen(shareClass.originalIssuePrice, 2) : '—'}</td>
                    <td className="whitespace-normal">
                      {hasPreference ? (
                        <ParenBreak text={`${shareClass.liquidationMultiple} 倍・${optionLabel(PARTICIPATION_TYPES, shareClass.participation)}`} />
                      ) : (
                        <span className="text-text-subtle">なし</span>
                      )}
                      <div className="whitespace-nowrap text-[11.5px] text-text-muted">
                        優先順位 {shareClass.seniority}
                        {hasPreference &&
                          shareClass.participation === 'capped_participating' &&
                          shareClass.participationCapMultiple != null &&
                          `・上限 ${shareClass.participationCapMultiple} 倍`}
                      </div>
                    </td>
                    <td>
                      <span className="tabular-nums">1 : {shareClass.conversionRatio}</span>
                      <div className="text-[11.5px] text-text-muted">{optionLabel(ANTI_DILUTION_TYPES, shareClass.antiDilution)}</div>
                    </td>
                    <td>{shareClass.hasVotingRights ? 'あり' : <span className="gt-pill gt-pill-sm gt-pill-neutral">なし</span>}</td>
                    <td className="gt-num">
                      {formatNumber(summary.issuedShares)} ／ {shareClass.authorizedShares != null ? formatNumber(shareClass.authorizedShares) : '未設定'}
                      <div className="text-[11.5px] text-text-muted">
                        株主 {formatNumber(summary.holderCount)}名{summary.authorizedUsage != null && `・${formatRatio(summary.authorizedUsage, 1)} を発行済み`}
                      </div>
                      {summary.exceedsAuthorized && <span className="gt-pill gt-pill-sm gt-pill-bad mt-1">発行可能種類株式総数を超過</span>}
                    </td>
                    {/* アイコンのボタンは自身に余白を持つので、セルの左右の余白は付けない */}
                    {canEdit && (
                      <td className="px-0 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${shareClass.name} を編集`}
                          title="編集"
                          onClick={() => {
                            setEditing(summary);
                            setIsFormOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-danger"
                          aria-label={`${shareClass.name} を削除`}
                          title="削除"
                          onClick={() => setDeleting(summary)}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    )}
                  </tr>
                  {hasDetail && (
                    <tr>
                      <td colSpan={columnCount} className="gt-wrap pt-0 text-[12px] leading-relaxed text-text-muted">
                        {shareClass.dividendPreference && <div>優先配当: {shareClass.dividendPreference}</div>}
                        {shareClass.terms && (
                          <div className="line-clamp-2" title={shareClass.terms}>
                            {shareClass.terms}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-3">
        優先順位は数字が大きいほど先に分配を受けます。転換比率は 1 株あたり普通株式何株に転換するかです。発行済みの株式がある種類や、ラウンド・新株予約権から参照されている種類は削除できません。
      </p>

      <ResourceFormDialog
        resource="share-classes"
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        initial={editing ? (editing.shareClass as unknown as ResourceRow) : null}
        onSaved={onChanged}
      />
      <ConfirmDialog
        isOpen={deleting !== null}
        title="株式の種類の削除"
        message={
          deleting && (
            <>
              「<strong>{deleting.shareClass.name}</strong>」を削除します。
              {deleting.issuedShares !== 0 && ` この種類には発行済みの株式（${formatNumber(deleting.issuedShares)}株）があるため、株式の異動を先に削除しないと削除できません。`}
            </>
          )
        }
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteItem('share-classes', deleting.shareClass.id);
          setDeleting(null);
          onChanged();
        }}
      />
    </section>
  );
};
