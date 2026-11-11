'use client';

// 手順 2: 議案。並び順の変更、決議要件の表示、賛否の数からの判定、結果の記録。

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { LegalBasis } from '@/components/resource/parts';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/Modal.client';
import { formatNumber, parseNumberText } from '@/lib/equity/format';
import { RESOLUTION_REQUIREMENTS } from '@/lib/legal/rules';
import { deleteItem, errorMessage, saveItem } from '@/lib/resources/client';
import { AGENDA_ITEM_TYPES, AGENDA_RESULTS } from '@/lib/resources/definitions';
import { agendaVerdict, moveAgendaItem, needsHeadCount, nextSortOrder, type AgendaVerdict, type HeadCounts } from '../services/agenda';
import { fullPayload, isWrittenResolution, optionLabel } from '../services/meetingRules';
import type { AgendaItemRow, MeetingKind, MeetingRow } from '../types';

const RESULT_VARIANT: Record<AgendaItemRow['result'], 'neutral' | 'success' | 'danger' | 'warning' | 'info'> = {
  pending: 'neutral',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'warning',
  reported: 'info',
};

const VerdictBadge = ({ verdict }: { verdict: AgendaVerdict }) => (
  <Badge variant={verdict.state === 'approved' ? 'success' : verdict.state === 'rejected' ? 'danger' : 'neutral'}>{verdict.label}</Badge>
);

const toInt = (text: string): number | null => {
  if (text.trim() === '') return null;
  const parsed = parseNumberText(text);
  return parsed != null && Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
};

const ResultDialogBody = ({
  meeting,
  kind,
  item,
  headCounts,
  onHeadCounts,
  onClose,
  onSaved,
}: {
  meeting: MeetingRow;
  kind: MeetingKind;
  item: AgendaItemRow;
  headCounts: HeadCounts;
  onHeadCounts: (value: HeadCounts) => void;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const isResolution = item.itemType === 'resolution';
  const text = (value: number | null) => (value == null ? '' : String(value));
  const [votesFor, setVotesFor] = useState(text(item.votesFor));
  const [votesAgainst, setVotesAgainst] = useState(text(item.votesAgainst));
  const [votesAbstain, setVotesAbstain] = useState(text(item.votesAbstain));
  const [totalHolders, setTotalHolders] = useState(text(headCounts.totalHolders));
  const [holdersFor, setHoldersFor] = useState(text(headCounts.holdersFor));
  const [result, setResult] = useState<string>(item.result);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const parsedFor = toInt(votesFor);
  const currentHeads: HeadCounts = {
    totalHolders: Number.isNaN(toInt(totalHolders)) ? null : toInt(totalHolders),
    holdersFor: Number.isNaN(toInt(holdersFor)) ? null : toInt(holdersFor),
  };
  const verdict = agendaVerdict(meeting, { resolutionType: item.resolutionType, votesFor: Number.isNaN(parsedFor) ? null : parsedFor }, currentHeads);
  const unit = kind === 'board' ? '名' : '個';
  const results = AGENDA_RESULTS.filter((option) =>
    isResolution ? option.value !== 'reported' : option.value === 'pending' || option.value === 'reported' || option.value === 'withdrawn',
  );

  const save = async () => {
    if (isSaving) return;
    const values = { votesFor: toInt(votesFor), votesAgainst: toInt(votesAgainst), votesAbstain: toInt(votesAbstain) };
    if (Object.values(values).some((value) => Number.isNaN(value))) {
      setError('賛成・反対・棄権は 0 以上の整数で入力してください');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await saveItem('meeting-agenda-items', fullPayload('meeting-agenda-items', item, isResolution ? { ...values, result } : { result }), item.id);
      onHeadCounts(currentHeads);
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, '保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  const numberField = (id: string, label: string, value: string, onChange: (value: string) => void) => (
    <div>
      <label htmlFor={id} className="gt-field-label">
        {label}
      </label>
      <input id={id} className="gt-field" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );

  return (
    <>
      <p className="text-[14px] font-semibold text-text-heading mt-0 mb-3">{item.title}</p>
      {isResolution && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {numberField('result-for', `賛成（${unit}）`, votesFor, setVotesFor)}
            {numberField('result-against', `反対（${unit}）`, votesAgainst, setVotesAgainst)}
            {numberField('result-abstain', `棄権（${unit}）`, votesAbstain, setVotesAbstain)}
          </div>
          {needsHeadCount(item.resolutionType) && !isWrittenResolution(meeting) && (
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-3">
                {numberField('result-holders', '株主の総数（名）', totalHolders, setTotalHolders)}
                {numberField('result-holders-for', '賛成した株主の数（名）', holdersFor, setHoldersFor)}
              </div>
              <p className="text-[12px] text-text-muted mt-2 mb-0">
                この決議は議決権の数に加えて株主の人数（頭数）でも判定します。人数は判定のためだけに使い、台帳には保存しません（議事録には別途記載してください）。
              </p>
            </div>
          )}
          <div className="rounded-md border border-border bg-primary-bg/40 px-3 py-2 mt-4 text-[13px] leading-relaxed">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">判定:</span>
              <VerdictBadge verdict={verdict} />
              {verdict.state !== 'unknown' && result !== (verdict.state === 'approved' ? 'approved' : 'rejected') && (
                <button type="button" className="gt-btn h-7 px-2 text-[12px]" onClick={() => setResult(verdict.state === 'approved' ? 'approved' : 'rejected')}>
                  判定を結果に反映
                </button>
              )}
            </div>
            <div className="text-text-muted mt-1">
              {verdict.message}（{kind === 'board' ? '取締役の総数' : '議決権の総数'} {formatNumber(meeting.totalVotingRights)}、出席 {formatNumber(meeting.presentVotingRights)}。会議の基本情報の値を使います）
            </div>
          </div>
        </>
      )}
      <div className="mt-4">
        <label htmlFor="result-select" className="gt-field-label">
          結果
        </label>
        <select id="result-select" className="gt-field gt-field-select" value={result} onChange={(event) => setResult(event.target.value)}>
          {results.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-[12px] text-text-muted mt-2 mb-0">判定は入力した数字からの目安です。結果は実際の採決に合わせて自分で選んでください。</p>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger mt-3 mb-0">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-6">
        <button type="button" className="gt-btn" onClick={onClose} disabled={isSaving}>
          キャンセル
        </button>
        <button type="button" className="gt-btn-primary" onClick={save} disabled={isSaving}>
          {isSaving ? '保存中…' : '結果を保存'}
        </button>
      </div>
    </>
  );
};

export const AgendaStep = ({
  meeting,
  kind,
  items,
  editable,
  holderCount,
  onChanged,
}: {
  meeting: MeetingRow;
  kind: MeetingKind;
  /** 並び順どおり */
  items: AgendaItemRow[];
  editable: boolean;
  /** 出欠表の株主の人数（309条3項・4項の頭数の初期値に使う）。無ければ null */
  holderCount: number | null;
  onChanged: () => Promise<void>;
}) => {
  const [form, setForm] = useState<{ item: AgendaItemRow | null } | null>(null);
  const [resultItem, setResultItem] = useState<AgendaItemRow | null>(null);
  const [deleting, setDeleting] = useState<AgendaItemRow | null>(null);
  const [headCounts, setHeadCounts] = useState<Record<string, HeadCounts>>({});
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const written = isWrittenResolution(meeting);

  const headsOf = (item: AgendaItemRow): HeadCounts => headCounts[item.id] ?? { totalHolders: holderCount, holdersFor: null };

  const move = async (item: AgendaItemRow, direction: 'up' | 'down') => {
    if (isMoving) return;
    const changes = moveAgendaItem(items, item.id, direction);
    if (changes.length === 0) return;
    setIsMoving(true);
    setError(null);
    try {
      for (const change of changes) {
        const row = items.find((candidate) => candidate.id === change.id);
        if (row) await saveItem('meeting-agenda-items', fullPayload('meeting-agenda-items', row, { sortOrder: change.sortOrder }), row.id);
      }
    } catch (caught) {
      setError(errorMessage(caught, '並び順の変更に失敗しました'));
    } finally {
      await onChanged();
      setIsMoving(false);
    }
  };

  return (
    <div>
      {written && (
        <p className="text-[13px] leading-relaxed text-text-muted mt-0 mb-3">
          書面決議は、決議の種類にかかわらず全員の同意で成立します
          <LegalBasis>{kind === 'board' ? '会社法370条' : '会社法319条1項'}</LegalBasis>。判定は「賛成 = {kind === 'board' ? '取締役の総数' : '議決権の総数'}」かどうかで行います。同意の集まり具合は次の手順で確認できます。
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger mt-0 mb-3">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-[13px] text-text-muted m-0">議案はまだ登録されていません。報告事項と決議事項を、招集通知に書く順番で登録してください。</p>
      ) : (
        <ol className="list-none p-0 m-0 flex flex-col gap-3">
          {items.map((item, index) => {
            const isResolution = item.itemType === 'resolution';
            const requirement = isResolution ? RESOLUTION_REQUIREMENTS[item.resolutionType] : null;
            const verdict = isResolution ? agendaVerdict(meeting, item, headsOf(item)) : null;
            const mismatch = isResolution && (kind === 'board') !== (item.resolutionType === 'board');
            return (
              <li key={item.id} className="rounded-md border border-border px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] text-text-muted tabular-nums">{index + 1}.</span>
                      <Badge variant={isResolution ? 'accent' : 'neutral'}>{optionLabel(AGENDA_ITEM_TYPES, item.itemType)}</Badge>
                      <span className="text-[14px] font-semibold text-text-heading">{item.title}</span>
                      <Badge variant={RESULT_VARIANT[item.result] ?? 'neutral'}>{optionLabel(AGENDA_RESULTS, item.result)}</Badge>
                    </div>
                    {item.description && (
                      <p className="text-[13px] leading-relaxed text-text-body whitespace-pre-wrap mt-2 mb-0">{item.description}</p>
                    )}
                  </div>
                  {editable && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" className="gt-iconbtn" aria-label={`${item.title} を上へ`} disabled={index === 0 || isMoving} onClick={() => void move(item, 'up')}>
                        <ArrowUp size={15} />
                      </button>
                      <button type="button" className="gt-iconbtn" aria-label={`${item.title} を下へ`} disabled={index === items.length - 1 || isMoving} onClick={() => void move(item, 'down')}>
                        <ArrowDown size={15} />
                      </button>
                      <button type="button" className="gt-btn h-8 px-2 text-[12px]" onClick={() => setResultItem(item)}>
                        結果を記録
                      </button>
                      <button type="button" className="gt-iconbtn" aria-label={`${item.title} を編集`} onClick={() => setForm({ item })}>
                        <Pencil size={15} />
                      </button>
                      <button type="button" className="gt-iconbtn" aria-label={`${item.title} を削除`} onClick={() => setDeleting(item)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>

                {requirement && verdict && (
                  <div className="mt-3 rounded-md bg-bg-subtle px-3 py-2 text-[12.5px] leading-relaxed text-text-body">
                    <div>
                      <span className="font-semibold text-text-heading">{requirement.label}</span>
                      <LegalBasis>{requirement.basis}</LegalBasis>
                    </div>
                    <div>定足数: {requirement.quorum}</div>
                    <div>可決の要件: {requirement.threshold}</div>
                    {mismatch && (
                      <div className="text-warning mt-1">
                        {kind === 'board'
                          ? '取締役会の議案ですが、決議の種類が株主総会のものになっています。編集して「取締役会決議」を選んでください。'
                          : '株主総会の議案ですが、決議の種類が「取締役会決議」になっています。編集して選び直してください。'}
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap mt-2 pt-2 border-t border-border">
                      <span className="tabular-nums">
                        賛成 {formatNumber(item.votesFor)} / 反対 {formatNumber(item.votesAgainst)} / 棄権 {formatNumber(item.votesAbstain)}
                      </span>
                      <VerdictBadge verdict={verdict} />
                      <span className="text-text-muted">{verdict.message}</span>
                    </div>
                    {needsHeadCount(item.resolutionType) && !written && verdict.state === 'unknown' && (
                      <div className="text-text-muted mt-1">
                        この決議は株主の人数（頭数）の要件があります。「結果を記録」で株主の総数と賛成した株主の数を入れると判定します（人数は保存されません）。
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {editable && (
        <button type="button" className="gt-btn mt-3" onClick={() => setForm({ item: null })}>
          <Plus size={15} />
          議案を追加
        </button>
      )}

      <ResourceFormDialog
        resource="meeting-agenda-items"
        isOpen={form != null}
        onClose={() => setForm(null)}
        initial={form?.item ?? null}
        title={form?.item ? '議案を編集' : '議案を追加'}
        defaults={{
          meetingId: meeting.id,
          sortOrder: String(nextSortOrder(items)),
          resolutionType: kind === 'board' ? 'board' : 'ordinary',
        }}
        hiddenKeys={kind === 'board' ? ['meetingId', 'resolutionType'] : ['meetingId']}
        onSaved={() => void onChanged()}
      />

      <Modal isOpen={resultItem != null} onClose={() => setResultItem(null)} title="結果を記録" size="lg">
        {resultItem && (
          <ResultDialogBody
            key={resultItem.id}
            meeting={meeting}
            kind={kind}
            item={resultItem}
            headCounts={headsOf(resultItem)}
            onHeadCounts={(value) => setHeadCounts((previous) => ({ ...previous, [resultItem.id]: value }))}
            onClose={() => setResultItem(null)}
            onSaved={() => void onChanged()}
          />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={deleting != null}
        title="議案を削除"
        message={<>「{deleting?.title}」を削除します。この操作は取り消せません。</>}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteItem('meeting-agenda-items', deleting.id);
          setDeleting(null);
          await onChanged();
        }}
      />
    </div>
  );
};
