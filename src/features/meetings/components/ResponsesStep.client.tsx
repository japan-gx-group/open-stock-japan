'use client';

// 手順 3: 招集・出欠（書面決議では同意）。株主総会は基準日の株主、取締役会は在任中の役員から表を作る。

import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { LegalBasis, NoticeList } from '@/components/resource/parts';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { formatDateJa, formatNumber, todayInTokyo } from '@/lib/equity/format';
import { boardProcedureNotes, isAuditorCompany, type Governance } from '@/lib/legal/rules';
import { deleteItem, errorMessage, fetchSnapshot, saveItem } from '@/lib/resources/client';
import { MEETING_RESPONSES, OFFICER_POSITIONS } from '@/lib/resources/definitions';
import {
  attendanceTotals,
  boardMembers,
  boardWrittenStatus,
  registryVoters,
  shareholderWrittenStatus,
  splitBoardResponses,
} from '../services/attendance';
import { fullPayload, isWrittenResolution, optionLabel } from '../services/meetingRules';
import type { MeetingKind, MeetingRow, OfficerRow, ResponseRow, ResponseValue } from '../types';

type RowRole = 'shareholder' | 'director' | 'auditor' | 'other';

const responseOptions = (role: RowRole, written: boolean, current: ResponseValue): { value: ResponseValue; label: string }[] => {
  const label = (value: ResponseValue): string => {
    if (role === 'auditor' && written) {
      if (value === 'consent') return '異議なし';
      if (value === 'dissent') return '異議あり';
    }
    return optionLabel(MEETING_RESPONSES, value);
  };
  const values: ResponseValue[] = written
    ? ['no_response', 'consent', 'dissent']
    : role === 'shareholder'
      ? ['no_response', 'attending', 'proxy', 'written_vote', 'absent']
      : ['no_response', 'attending', 'absent'];
  if (!values.includes(current)) values.push(current);
  return values.map((value) => ({ value, label: label(value) }));
};

export const ResponsesStep = ({
  meeting,
  kind,
  governance,
  responses,
  officers,
  stakeholderNames,
  editable,
  onResponsesChanged,
  onUpdateMeeting,
}: {
  meeting: MeetingRow;
  kind: MeetingKind;
  governance: Governance;
  responses: ResponseRow[];
  officers: OfficerRow[];
  stakeholderNames: Map<string, string>;
  editable: boolean;
  onResponsesChanged: () => Promise<void>;
  onUpdateMeeting: (overrides: Record<string, unknown>) => Promise<void>;
}) => {
  const written = isWrittenResolution(meeting);
  const board = kind === 'board';
  const today = todayInTokyo();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<{ row: ResponseRow | null } | null>(null);
  const [deleting, setDeleting] = useState<ResponseRow | null>(null);

  const officerById = useMemo(() => new Map(officers.map((officer) => [officer.id, officer])), [officers]);
  const split = useMemo(() => splitBoardResponses(responses, officers), [responses, officers]);
  const votingRows = board ? split.directors : responses;
  const totals = useMemo(() => attendanceTotals(votingRows), [votingRows]);
  const auditorCompany = isAuditorCompany(governance);

  const roleOf = (row: ResponseRow): RowRole => {
    if (!board) return 'shareholder';
    if (split.directors.includes(row)) return 'director';
    if (split.auditors.includes(row)) return 'auditor';
    return 'other';
  };
  const nameOf = (row: ResponseRow): string =>
    row.officerId
      ? (officerById.get(row.officerId)?.name ?? '（不明な役員）')
      : row.stakeholderId
        ? (stakeholderNames.get(row.stakeholderId) ?? '（不明な株主）')
        : '—';

  const orderedRows = board ? [...split.directors, ...split.auditors, ...split.others] : responses;
  const writtenStatus = !written
    ? null
    : board
      ? boardWrittenStatus(totals, split.auditors, governance)
      : shareholderWrittenStatus(totals);

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    run('generate', async () => {
      let created = 0;
      try {
        if (board) {
          const existing = new Set(responses.map((row) => row.officerId));
          for (const member of boardMembers(officers, governance, meeting.heldOn ?? today)) {
            if (existing.has(member.officerId)) continue;
            await saveItem('meeting-responses', {
              meetingId: meeting.id,
              officerId: member.officerId,
              response: 'no_response',
              votingRights: member.role === 'director' ? 1 : null,
            });
            created += 1;
          }
        } else {
          const snapshot = await fetchSnapshot();
          const existing = new Set(responses.map((row) => row.stakeholderId));
          for (const voter of registryVoters(snapshot, meeting.recordDate ?? meeting.heldOn ?? null)) {
            if (existing.has(voter.stakeholderId)) continue;
            await saveItem('meeting-responses', {
              meetingId: meeting.id,
              stakeholderId: voter.stakeholderId,
              response: 'no_response',
              votingRights: voter.votingRights,
            });
            created += 1;
          }
        }
      } finally {
        await onResponsesChanged();
      }
      setMessage(created > 0 ? `${created} 名を追加しました。` : '追加する人はいませんでした（全員が登録済みです）。');
    });

  const updateRow = (row: ResponseRow, overrides: Record<string, unknown>) =>
    run(row.id, async () => {
      try {
        await saveItem('meeting-responses', fullPayload('meeting-responses', row, overrides), row.id);
      } finally {
        await onResponsesChanged();
      }
    });

  const copyTotals = () =>
    run('copy', async () => {
      const overrides: Record<string, unknown> = board
        ? { totalVotingRights: totals.memberCount, presentVotingRights: written ? totals.consentCount : totals.presentCount }
        : {
            totalVotingRights: totals.totalVotingRights,
            presentVotingRights: written ? totals.consentVotingRights : totals.presentVotingRights,
            presentShareholders: written ? totals.consentCount : totals.presentCount,
          };
      if (board && !written && !meeting.attendingOfficers.trim()) {
        const attending = [...split.directors, ...split.auditors]
          .filter((row) => row.response === 'attending')
          .map((row) => {
            const officer = row.officerId ? officerById.get(row.officerId) : undefined;
            return officer ? `${optionLabel(OFFICER_POSITIONS, officer.position)} ${officer.name}` : null;
          })
          .filter(Boolean);
        if (attending.length > 0) overrides.attendingOfficers = attending.join('、');
      }
      await onUpdateMeeting(overrides);
      setMessage('集計を会議の基本情報に反映しました。');
    });

  const sourceDate = meeting.recordDate ?? meeting.heldOn;
  const unit = board ? '名' : '個';

  const totalsLine = board
    ? written
      ? `取締役 ${totals.memberCount} 名のうち同意 ${totals.consentCount} 名`
      : `取締役 ${totals.memberCount} 名のうち出席 ${totals.presentCount} 名（未回答 ${totals.noResponseCount} 名）`
    : written
      ? `株主 ${totals.memberCount} 名（議決権 ${formatNumber(totals.totalVotingRights)} 個）のうち同意 ${totals.consentCount} 名（${formatNumber(totals.consentVotingRights)} 個）`
      : `株主 ${totals.memberCount} 名（議決権 ${formatNumber(totals.totalVotingRights)} 個）のうち、出席・委任状・書面による議決権行使 ${totals.presentCount} 名（${formatNumber(totals.presentVotingRights)} 個）、未回答 ${totals.noResponseCount} 名`;

  const copied = board
    ? meeting.totalVotingRights === totals.memberCount &&
      meeting.presentVotingRights === (written ? totals.consentCount : totals.presentCount)
    : meeting.totalVotingRights === totals.totalVotingRights &&
      meeting.presentVotingRights === (written ? totals.consentVotingRights : totals.presentVotingRights) &&
      meeting.presentShareholders === (written ? totals.consentCount : totals.presentCount);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-text-muted m-0">
        {board ? (
          <>
            {written
              ? boardProcedureNotes(governance).writtenResolution
              : `招集通知の宛先は${boardProcedureNotes(governance).noticeTo}です。取締役会では、代理人による出席や書面による議決権行使は認められないと解されています。`}
            {governance.hasAuditor &&
              (auditorCompany
                ? ' 監査役は取締役会に出席し、必要があれば意見を述べる義務があります（会社法383条1項）。議決には加わりません。'
                : ' 監査の範囲を会計に限定している監査役は、会社法2条9号の監査役設置会社の監査役に当たらないため、招集通知の宛先・書面決議の異議の対象ではありません（記録用に並べています）。')}
          </>
        ) : written ? (
          <>
            議決権を行使できる株主の全員が、書面または電磁的記録で同意すると、決議があったものとみなされます。定款の定めは不要です
            <LegalBasis>会社法319条1項</LegalBasis>。同意書は、決議があったとみなされた日から本店に備え置きます<LegalBasis>会社法319条2項</LegalBasis>。
          </>
        ) : (
          <>
            {meeting.recordDate
              ? `基準日（${formatDateJa(meeting.recordDate)}）`
              : meeting.heldOn
                ? `基準日が未入力のため、開催日（${formatDateJa(meeting.heldOn)}）`
                : '基準日・開催日が未入力のため、現在'}
            の株主名簿から、議決権のある株式を持つ株主を並べます。議決権は 1 株 1 個で数えています（単元株・自己株式・相互保有株式は考慮していません）。
          </>
        )}
      </p>

      {writtenStatus && (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-[13px] leading-relaxed font-semibold ${
            writtenStatus.established ? 'border-success/30 bg-success-soft text-success' : 'border-warning/40 bg-warning-soft text-warning'
          }`}
        >
          {writtenStatus.message}
        </div>
      )}

      {orderedRows.length === 0 ? (
        <p className="text-[13px] text-text-muted m-0">
          {board ? '出欠表はまだありません。在任中の取締役・監査役から作成できます。' : '出欠表はまだありません。基準日の株主から作成できます。'}
        </p>
      ) : (
        <div className="gt-table-scroll">
          <table className="gt-table">
            <thead>
              <tr>
                <th>{board ? '役員' : '株主'}</th>
                {!board && <th className="gt-num">議決権の数</th>}
                <th>{written ? '同意' : '出欠'}</th>
                <th>回答日</th>
                {editable && <th aria-label="操作" />}
              </tr>
            </thead>
            <tbody>
              {orderedRows.map((row) => {
                const role = roleOf(row);
                const officer = row.officerId ? officerById.get(row.officerId) : undefined;
                const name = nameOf(row);
                return (
                  <tr key={row.id}>
                    <td>
                      {name}
                      {officer && <span className="text-[12px] text-text-muted ml-2">{optionLabel(OFFICER_POSITIONS, officer.position)}</span>}
                      {role === 'auditor' && <span className="text-[12px] text-text-muted ml-1">（議決権なし）</span>}
                      {row.notes && <div className="gt-wrap text-[12px] text-text-muted">{row.notes}</div>}
                    </td>
                    {!board && <td className="gt-num">{formatNumber(row.votingRights)}</td>}
                    <td>
                      {editable ? (
                        <select
                          className="gt-field gt-field-select h-9 min-w-[150px]"
                          aria-label={`${name} の${written ? '同意' : '出欠'}`}
                          value={row.response}
                          disabled={busy != null}
                          onChange={(event) => {
                            const response = event.target.value;
                            void updateRow(row, {
                              response,
                              respondedOn: response === 'no_response' ? null : (row.respondedOn ?? today),
                            });
                          }}
                        >
                          {responseOptions(role, written, row.response).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        responseOptions(role, written, row.response).find((option) => option.value === row.response)?.label
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <input
                          type="date"
                          className="gt-field h-9 w-[160px]"
                          aria-label={`${name} の回答日`}
                          value={row.respondedOn ?? ''}
                          disabled={busy != null}
                          onChange={(event) => void updateRow(row, { respondedOn: event.target.value || null })}
                        />
                      ) : (
                        formatDateJa(row.respondedOn)
                      )}
                    </td>
                    {editable && (
                      <td className="text-right">
                        <button type="button" className="gt-iconbtn" aria-label={`${name} の行を編集`} onClick={() => setForm({ row })}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="gt-iconbtn" aria-label={`${name} の行を削除`} onClick={() => setDeleting(row)}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {orderedRows.length > 0 && (
        <div className="rounded-md bg-bg-subtle px-3 py-2 text-[13px] leading-relaxed text-text-body">
          <span className="font-semibold text-text-heading">集計: </span>
          {totalsLine}
          <div className="text-[12px] text-text-muted mt-1">
            会議の基本情報: {board ? '取締役の総数' : '議決権の総数'} {formatNumber(meeting.totalVotingRights)} {unit}、{written ? '同意' : '出席'} {formatNumber(meeting.presentVotingRights)} {unit}
            {!board && `、${written ? '同意した' : '出席'}株主数 ${formatNumber(meeting.presentShareholders)} 名`}
            {copied ? '（集計と一致しています）' : '（集計と違います。議案の判定は基本情報の値で行います）'}
          </div>
        </div>
      )}

      {board && split.others.length > 0 && (
        <NoticeList items={[{ level: 'warning', message: '取締役・監査役として登録されていない人の行があります（退任・役職の変更など）。集計には含めていません。' }]} />
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger m-0">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-[13px] text-success m-0">
          {message}
        </p>
      )}

      {editable && (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="gt-btn" onClick={() => void generate()} disabled={busy != null}>
            <Users size={15} />
            {busy === 'generate'
              ? '作成中…'
              : board
                ? '在任中の役員から出欠表を作成'
                : '基準日の株主から出欠表を作成'}
          </button>
          <button type="button" className="gt-btn" onClick={() => setForm({ row: null })} disabled={busy != null}>
            <Plus size={15} />
            行を追加
          </button>
          {orderedRows.length > 0 && (
            <button type="button" className="gt-btn" onClick={() => void copyTotals()} disabled={busy != null || copied}>
              {busy === 'copy' ? '反映中…' : '集計を基本情報に反映'}
            </button>
          )}
          {!board && sourceDate && <span className="text-[12px] text-text-muted">{formatDateJa(sourceDate)} 時点の株主名簿を使います</span>}
        </div>
      )}

      <ResourceFormDialog
        resource="meeting-responses"
        isOpen={form != null}
        onClose={() => setForm(null)}
        initial={form?.row ?? null}
        title={form?.row ? `${nameOf(form.row)} の回答を編集` : '行を追加'}
        defaults={{ meetingId: meeting.id, ...(board ? { votingRights: '1' } : {}) }}
        hiddenKeys={form?.row ? ['meetingId', 'stakeholderId', 'officerId'] : board ? ['meetingId', 'stakeholderId'] : ['meetingId', 'officerId']}
        enableAi={false}
        onSaved={() => void onResponsesChanged()}
      />

      <ConfirmDialog
        isOpen={deleting != null}
        title="行を削除"
        message={<>{deleting ? nameOf(deleting) : ''} の行を出欠表から削除します。</>}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteItem('meeting-responses', deleting.id);
          setDeleting(null);
          await onResponsesChanged();
        }}
      />
    </div>
  );
};
