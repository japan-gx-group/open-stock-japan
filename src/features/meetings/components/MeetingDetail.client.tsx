'use client';

// 会議の詳細（株主総会 / 取締役会で共通）。基本情報 → 議案 → 出欠・同意 → 招集通知 → 議事録 → 関連文書の順に進める。

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { EmptyState, ErrorBlock, LoadingBlock, NoticeList } from '@/components/resource/parts';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { Badge } from '@/components/ui/badge';
import { useCompany } from '@/hooks/useCompany';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useResourceList } from '@/hooks/useResourceList';
import { formatDateJa, formatNumber, todayInTokyo } from '@/lib/equity/format';
import { deleteItem, saveItem } from '@/lib/resources/client';
import { MEETING_FORMATS, MEETING_STATUSES, MEETING_TYPES } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';
import { canEdit } from '@/types/role';
import { sortAgenda } from '../services/agenda';
import { attendanceTotals, boardWrittenStatus, shareholderWrittenStatus, splitBoardResponses } from '../services/attendance';
import { buildDraftContext, type ContextAttendee } from '../services/draftContext';
import {
  fullPayload,
  isWrittenResolution,
  kindOfMeeting,
  MEETING_KINDS,
  meetingWarnings,
  noticeInfo,
  optionLabel,
  type DraftPurpose,
} from '../services/meetingRules';
import type { AgendaItemRow, FiscalYearRow, MeetingKind, MeetingRow, OfficerRow, ResponseRow } from '../types';
import { AgendaStep } from './AgendaStep.client';
import { DocumentsStep, useMeetingDocuments } from './DocumentsStep.client';
import { hiddenMeetingKeys } from './MeetingList.client';
import { MinutesStep } from './MinutesStep.client';
import { NoticeStep } from './NoticeStep.client';
import { ResponsesStep } from './ResponsesStep.client';
import { StepCard, type StepStatus } from './StepCard';

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-[12px] text-text-muted">{label}</dt>
    <dd className="m-0 text-[13.5px] text-text-heading break-words">{children}</dd>
  </div>
);

/**
 * 「、」で区切って並べた自由記入（出席した役員など）。区切りごとにひとかたまりにして、氏名の途中（姓と名の間の空白）で行が切れないようにする。
 * 1 つのかたまりが行より長いときは、その中で折り返す。改行はそのまま残す。
 */
const SeparatedText = ({ text }: { text: string }) => (
  <>
    {text.split('\n').map((line, lineIndex) => {
      const parts = line.split('、');
      return (
        <span key={lineIndex} className="block min-h-[1lh]">
          {parts.map((part, index) => (
            <span key={index} className="inline-block max-w-full align-top">
              {part}
              {index < parts.length - 1 && '、'}
            </span>
          ))}
        </span>
      );
    })}
  </>
);

const STEP_LINKS = [
  ['step-basic', '基本情報'],
  ['step-agenda', '議案'],
  ['step-responses', '出欠・同意'],
  ['step-notice', '招集通知'],
  ['step-minutes', '議事録'],
  ['step-documents', '関連文書'],
] as const;

export const MeetingDetail = ({ kind, id }: { kind: MeetingKind; id: string }) => {
  const config = MEETING_KINDS[kind];
  const router = useRouter();
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  const today = todayInTokyo();

  const meetings = useResourceList<MeetingRow>('meetings');
  const agenda = useResourceList<AgendaItemRow>('meeting-agenda-items', 'meetingId', id);
  const responses = useResourceList<ResponseRow>('meeting-responses', 'meetingId', id);
  const officers = useResourceList<OfficerRow>('officers');
  const stakeholders = useResourceList<ResourceRow>('stakeholders');
  const fiscalYears = useResourceList<FiscalYearRow>('fiscal-years');
  const documents = useMeetingDocuments(id);
  const company = useCompany();
  const { governance } = company;

  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const meeting = useMemo(() => (meetings.data ?? []).find((row) => row.id === id) ?? null, [meetings.data, id]);
  const agendaItems = useMemo(() => sortAgenda((agenda.data ?? []).filter((item) => item.meetingId === id)), [agenda.data, id]);
  const responseRows = useMemo(() => (responses.data ?? []).filter((row) => row.meetingId === id), [responses.data, id]);
  const officerRows = useMemo(() => officers.data ?? [], [officers.data]);
  const stakeholderNames = useMemo(
    () => new Map((stakeholders.data ?? []).map((row) => [row.id, typeof row.name === 'string' ? row.name : ''])),
    [stakeholders.data],
  );

  const reloadMeetings = meetings.reload;
  const updateMeeting = useCallback(
    async (overrides: Record<string, unknown>) => {
      if (!meeting) return;
      await saveItem('meetings', fullPayload('meetings', meeting, overrides), meeting.id);
      await reloadMeetings();
    },
    [meeting, reloadMeetings],
  );

  if (meetings.isLoading && !meetings.data) {
    return (
      <div className="page-body">
        <LoadingBlock />
      </div>
    );
  }
  if (meetings.error && !meetings.data) {
    return (
      <div className="page-body">
        <ErrorBlock message={meetings.error} onRetry={() => void meetings.reload()} />
      </div>
    );
  }
  if (!meeting || kindOfMeeting(meeting.meetingType) !== kind) {
    return (
      <div className="page-body">
        <EmptyState
          title="会議が見つかりません"
          description="削除されたか、URL が正しくない可能性があります。"
          action={
            <Link href={config.basePath} className="gt-btn">
              {config.label}の一覧へ
            </Link>
          }
        />
      </div>
    );
  }

  const written = isWrittenResolution(meeting);
  const board = kind === 'board';
  const notice = noticeInfo(meeting, governance, today);
  const warnings = meetingWarnings(meeting, governance, today);
  const fiscalYearLabel = (fiscalYears.data ?? []).find((fiscalYear) => fiscalYear.id === meeting.fiscalYearId)?.label ?? null;

  const split = splitBoardResponses(responseRows, officerRows);
  const votingRows = board ? split.directors : responseRows;
  const totals = attendanceTotals(votingRows);
  const writtenStatus = !written ? null : board ? boardWrittenStatus(totals, split.auditors, governance) : shareholderWrittenStatus(totals);

  const officerById = new Map(officerRows.map((officer) => [officer.id, officer]));
  const attendees: ContextAttendee[] = (board ? [...split.directors, ...split.auditors] : responseRows).map((row) => {
    const officer = row.officerId ? officerById.get(row.officerId) : undefined;
    return {
      name: officer?.name ?? (row.stakeholderId ? (stakeholderNames.get(row.stakeholderId) ?? '（不明な株主）') : '（不明）'),
      position: officer?.position ?? null,
      response: row.response,
      votingRights: row.votingRights,
      respondedOn: row.respondedOn,
    };
  });
  const contextFor = (purpose: DraftPurpose) => (): string =>
    buildDraftContext({ purpose, company: company.data, governance, meeting, fiscalYearLabel, agendaItems, attendees });

  // ---- 手順ごとの状態 ----
  const basicStatus: StepStatus = warnings.some((warning) => warning.level === 'warning')
    ? { label: '要確認', tone: 'warning' }
    : meeting.heldOn
      ? { label: '入力済み', tone: 'success' }
      : { label: '開催日が未定', tone: 'neutral' };

  const resolutions = agendaItems.filter((item) => item.itemType === 'resolution');
  const pendingCount = agendaItems.filter((item) => item.result === 'pending').length;
  const agendaStatus: StepStatus =
    agendaItems.length === 0
      ? { label: '未登録', tone: 'neutral' }
      : pendingCount === 0
        ? { label: `${agendaItems.length} 件・結果を記録済み`, tone: 'success' }
        : meeting.status === 'held' || meeting.status === 'closed'
          ? { label: `${agendaItems.length} 件・未決 ${pendingCount} 件`, tone: 'warning' }
          : { label: `${agendaItems.length} 件（決議事項 ${resolutions.length} 件）`, tone: 'info' };

  const responsesStatus: StepStatus =
    votingRows.length === 0 && responseRows.length === 0
      ? { label: '未作成', tone: 'neutral' }
      : writtenStatus
        ? writtenStatus.established
          ? { label: '全員の同意あり', tone: 'success' }
          : { label: `同意 ${totals.consentCount} / ${totals.memberCount} 名`, tone: 'warning' }
        : totals.noResponseCount > 0
          ? { label: `未回答 ${totals.noResponseCount} 名`, tone: 'info' }
          : { label: `出席 ${totals.presentCount} / ${totals.memberCount} 名`, tone: 'success' };

  const noticeStatus: StepStatus = {
    label: notice.label,
    tone:
      notice.state === 'overdue' || notice.state === 'sent_late'
        ? 'danger'
        : notice.state === 'soon'
          ? 'warning'
          : notice.state === 'sent'
            ? 'success'
            : 'neutral',
  };

  const minutesStatus: StepStatus = meeting.minutesFinalizedOn
    ? { label: '確定済み', tone: 'success' }
    : meeting.minutesBody.trim()
      ? { label: '下書きあり', tone: 'warning' }
      : meeting.heldOn && meeting.heldOn <= today
        ? { label: '未作成', tone: 'warning' }
        : { label: '未作成', tone: 'neutral' };

  const documentRows = documents.data ?? [];
  const documentsStatus: StepStatus =
    documentRows.length > 0 ? { label: `${documentRows.length} 件`, tone: 'info' } : { label: 'なし', tone: 'neutral' };

  const loadErrors = [agenda.error, responses.error, officers.error, stakeholders.error, company.error].filter(Boolean);

  return (
    <div className="page-body">
      <Link href={config.basePath} className="inline-flex items-center gap-1 text-[13px] text-text-muted mb-2">
        <ChevronLeft size={15} />
        {config.label}の一覧
      </Link>
      <PageHeading
        title={meeting.title}
        description={`${optionLabel(MEETING_TYPES, meeting.meetingType)}・${optionLabel(MEETING_FORMATS, meeting.format)}・${
          meeting.heldOn ? formatDateJa(meeting.heldOn) : '開催日未定'
        }`}
        actions={<Badge size="default">{optionLabel(MEETING_STATUSES, meeting.status)}</Badge>}
        primaryAction={
          editable ? (
            <button type="button" className="gt-btn" onClick={() => setIsDeleting(true)}>
              <Trash2 size={15} />
              会議を削除
            </button>
          ) : null
        }
      />

      <nav aria-label="手順" className="flex flex-wrap gap-2 mb-4">
        {STEP_LINKS.map(([anchor, label], index) => (
          <a key={anchor} href={`#${anchor}`} className="gt-pill gt-pill-neutral no-underline">
            {index + 1}. {anchor === 'step-notice' && written ? '提案書・同意書' : label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-4 max-w-[1040px]">
        {loadErrors.length > 0 && <ErrorBlock message={`一部のデータを読めませんでした: ${loadErrors.join(' / ')}`} />}

        <StepCard
          id="step-basic"
          number={1}
          title="基本情報"
          description="日時・場所・開催方法と、議決権の数。議案の判定と文面の下書きに使います。"
          status={basicStatus}
          actions={
            editable ? (
              <button type="button" className="gt-btn" onClick={() => setIsEditing(true)}>
                <Pencil size={15} />
                編集
              </button>
            ) : null
          }
        >
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 m-0">
            <Fact label={written ? '決議があったとみなされる日' : '開催日'}>
              <span className="whitespace-nowrap">
                {formatDateJa(meeting.heldOn)}
                {!written && meeting.startTime ? ` ${meeting.startTime.slice(0, 5)}` : ''}
              </span>
            </Fact>
            {!written && <Fact label="場所">{meeting.place || '—'}</Fact>}
            <Fact label="開催方法">{optionLabel(MEETING_FORMATS, meeting.format)}</Fact>
            <Fact label="進行状況">{optionLabel(MEETING_STATUSES, meeting.status)}</Fact>
            {!board && <Fact label="対象の事業年度">{fiscalYearLabel ?? '—'}</Fact>}
            {!board && <Fact label="基準日">{formatDateJa(meeting.recordDate)}</Fact>}
            {!written && <Fact label="議長">{meeting.chairperson || '—'}</Fact>}
            <Fact label="議事録の作成者">{meeting.minutesPreparer || '—'}</Fact>
            <Fact label={board ? '取締役の総数' : '議決権の総数'}>
              {formatNumber(meeting.totalVotingRights)}
              {meeting.totalVotingRights != null ? (board ? ' 名' : ' 個') : ''}
            </Fact>
            <Fact label={board ? (written ? '同意した取締役の数' : '出席した取締役の数') : written ? '同意した議決権の数' : '出席した議決権の数'}>
              {formatNumber(meeting.presentVotingRights)}
              {meeting.presentVotingRights != null ? (board ? ' 名' : ' 個') : ''}
            </Fact>
            {!board && (
              <Fact label={written ? '同意した株主数' : '出席株主数'}>
                {formatNumber(meeting.presentShareholders)}
                {meeting.presentShareholders != null ? ' 名' : ''}
              </Fact>
            )}
            <Fact label="出席した役員">{meeting.attendingOfficers ? <SeparatedText text={meeting.attendingOfficers} /> : '—'}</Fact>
          </dl>
          {meeting.notes && <p className="text-[13px] leading-relaxed text-text-body whitespace-pre-wrap mt-3 mb-0">メモ: {meeting.notes}</p>}
          {warnings.length > 0 && (
            <div className="mt-4">
              <NoticeList items={warnings.map((warning) => ({ key: warning.key, level: warning.level, message: warning.message }))} />
            </div>
          )}
        </StepCard>

        <StepCard
          id="step-agenda"
          number={2}
          title="議案"
          description="報告事項と決議事項を順番に登録し、採決の結果を記録します。"
          status={agendaStatus}
        >
          <AgendaStep
            meeting={meeting}
            kind={kind}
            items={agendaItems}
            editable={editable}
            holderCount={!board && responseRows.length > 0 ? responseRows.length : null}
            onChanged={agenda.reload}
          />
        </StepCard>

        <StepCard
          id="step-responses"
          number={3}
          title={written ? '同意の取得' : '招集・出欠'}
          description={written ? '全員の同意が揃ったかを確認します。' : '出欠の回答を記録し、出席した議決権の数を集計します。'}
          status={responsesStatus}
        >
          <ResponsesStep
            meeting={meeting}
            kind={kind}
            governance={governance}
            responses={responseRows}
            officers={officerRows}
            stakeholderNames={stakeholderNames}
            editable={editable}
            onResponsesChanged={responses.reload}
            onUpdateMeeting={updateMeeting}
          />
        </StepCard>

        <StepCard
          id="step-notice"
          number={4}
          title={written ? '提案書・同意書' : '招集通知'}
          description={written ? '提案書と同意書の文面を作ります。' : '文面を作り、発送した日を記録します。'}
          status={noticeStatus}
        >
          <NoticeStep
            meeting={meeting}
            kind={kind}
            notice={notice}
            context={contextFor('notice')}
            editable={editable}
            onUpdateMeeting={updateMeeting}
          />
        </StepCard>

        <StepCard id="step-minutes" number={5} title="議事録" description="議事録を作成し、確定します。" status={minutesStatus}>
          <MinutesStep
            meeting={meeting}
            kind={kind}
            companyName={typeof company.data?.name === 'string' ? company.data.name : ''}
            context={contextFor('minutes')}
            editable={editable}
            onUpdateMeeting={updateMeeting}
          />
        </StepCard>

        <StepCard
          id="step-documents"
          number={6}
          title="関連文書"
          description="この会議に関連づけた文書。文書ライブラリにも表示されます。"
          status={documentsStatus}
        >
          <DocumentsStep meeting={meeting} documents={documentRows} error={documents.error} editable={editable} onChanged={documents.reload} />
        </StepCard>
      </div>

      <ResourceFormDialog
        resource="meetings"
        isOpen={isEditing}
        onClose={() => setIsEditing(false)}
        initial={meeting}
        title={`${config.label}を編集`}
        hiddenKeys={hiddenMeetingKeys(kind)}
        allowedOptions={{ meetingType: MEETING_KINDS[kind].meetingTypes }}
        onSaved={() => void meetings.reload()}
      />

      <ConfirmDialog
        isOpen={isDeleting}
        title="会議を削除"
        message={
          <>
            「{meeting.title}」を削除します。議案・出欠の記録・議事録も一緒に削除され、元に戻せません。
            {documentRows.length > 0 && ' 関連づけた文書は文書ライブラリに残ります。'}
            {meeting.minutesFinalizedOn && ' 確定済みの議事録は本店での備置きの対象です。削除の前に、原本を保管していることを確かめてください。'}
          </>
        }
        onCancel={() => setIsDeleting(false)}
        onConfirm={async () => {
          await deleteItem('meetings', meeting.id);
          router.push(config.basePath);
        }}
      />
    </div>
  );
};
