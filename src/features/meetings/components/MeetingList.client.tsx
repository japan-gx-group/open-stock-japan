'use client';

// 会議の一覧（株主総会 / 取締役会で共通。kind で出し分ける）。
// 招集通知の発送期限は src/lib/legal/rules.ts の規則と会社情報の機関設計から計算する。

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { EmptyState, ErrorBlock, LegalBasis, LoadingBlock } from '@/components/resource/parts';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { Badge } from '@/components/ui/badge';
import { useCompany } from '@/hooks/useCompany';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useResourceList } from '@/hooks/useResourceList';
import { formatDateJa, todayInTokyo } from '@/lib/equity/format';
import { annualMeetingDeadline, boardProcedureNotes, LEGAL, type Governance } from '@/lib/legal/rules';
import { MEETING_FORMATS, MEETING_STATUSES, MEETING_TYPES } from '@/lib/resources/definitions';
import { canEdit } from '@/types/role';
import { MEETING_KINDS, noticeInfo, noticeRuleFor, optionLabel, type NoticeInfo } from '../services/meetingRules';
import type { AgendaItemRow, FiscalYearRow, MeetingKind, MeetingRow } from '../types';

const STATUS_VARIANT: Record<MeetingRow['status'], 'neutral' | 'info' | 'accent' | 'success'> = {
  planning: 'neutral',
  noticed: 'info',
  held: 'accent',
  closed: 'success',
};

export const NoticeBadge = ({ info }: { info: NoticeInfo }) => {
  const variant =
    info.state === 'overdue' || info.state === 'sent_late'
      ? 'danger'
      : info.state === 'soon'
        ? 'warning'
        : info.state === 'sent'
          ? 'success'
          : 'neutral';
  return <Badge variant={variant}>{info.label}</Badge>;
};

/** 「14 日前まで」「3 か月以内」のような数と単位のひとかたまり。空白の位置で行が切れて数だけが前の行に残らないようにする */
const Keep = ({ children }: { children: React.ReactNode }) => <span className="whitespace-nowrap">{children}</span>;

const minutesLabel = (meeting: MeetingRow): { label: string; variant: 'neutral' | 'warning' | 'success' } => {
  if (meeting.minutesFinalizedOn) return { label: '確定済み', variant: 'success' };
  if (meeting.minutesBody.trim()) return { label: '下書きあり', variant: 'warning' };
  return { label: '未作成', variant: 'neutral' };
};

const GuidanceCard = ({
  kind,
  governance,
  fiscalYears,
  meetings,
  today,
}: {
  kind: MeetingKind;
  governance: Governance;
  fiscalYears: FiscalYearRow[];
  meetings: MeetingRow[];
  today: string;
}) => {
  const rule = noticeRuleFor(kind, governance);
  const items: React.ReactNode[] = [];

  if (kind === 'shareholder') {
    items.push(
      <>
        招集通知は会日の <strong className="whitespace-nowrap">{rule.days} 日前まで</strong>に発送します{rule.note ? `（${rule.note}）` : ''}。
        <LegalBasis>{rule.basis}</LegalBasis>
        {!governance.isPublicCompany && (
          <>
            {' '}
            書面または電磁的方法による議決権行使を定めたときは <Keep>{LEGAL.shareholderMeetingNoticeDaysPublic} 日前まで</Keep>です。
          </>
        )}
        {' '}株主全員の同意があれば招集手続を省略できます。<LegalBasis>会社法300条</LegalBasis>
      </>,
    );
    // 直近に終了した事業年度に、定時株主総会がまだ登録されていなければ知らせる
    const latestEnded = [...fiscalYears]
      .filter((fiscalYear) => fiscalYear.endDate <= today)
      .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
    const pending =
      latestEnded && !meetings.some((meeting) => meeting.meetingType === 'agm' && meeting.fiscalYearId === latestEnded.id)
        ? latestEnded
        : null;
    items.push(
      <>
        定時株主総会は、毎事業年度の終了後一定の時期に招集します。基準日を事業年度末日とする場合、基準日から <Keep>{LEGAL.recordDateMaxMonths} か月以内</Keep>に開催する必要があります。
        <LegalBasis>会社法296条1項・124条2項</LegalBasis>
        {pending && (
          <>
            {' '}
            <strong>
              {pending.label}（<Keep>{formatDateJa(pending.endDate)} 終了</Keep>）の定時株主総会が未登録です。開催の目安は <Keep>{formatDateJa(annualMeetingDeadline(pending.endDate))} まで</Keep>です。
            </strong>
          </>
        )}
      </>,
    );
    items.push(
      <>
        書面決議（みなし決議）は、議決権を行使できる株主の全員が書面または電磁的記録で同意したときに成立します。定款の定めは不要です。
        <LegalBasis>会社法319条1項</LegalBasis>
      </>,
    );
    items.push(
      <>
        議事録は株主総会の日から <Keep>{LEGAL.minutesRetentionYears} 年間</Keep>、本店に備え置きます。<LegalBasis>会社法318条2項</LegalBasis>
      </>,
    );
  } else {
    const notes = boardProcedureNotes(governance);
    if (!governance.hasBoardOfDirectors) {
      items.push(<>会社情報では取締役会設置会社になっていません。取締役会を置かない会社では、業務は取締役の過半数で決定します。<LegalBasis>会社法348条</LegalBasis></>);
    }
    items.push(
      <>
        招集通知は会日の <strong className="whitespace-nowrap">{rule.days} 日前まで</strong>に、<strong>{notes.noticeTo}</strong>へ発します{rule.note ? `（${rule.note}）` : ''}。
        <LegalBasis>{rule.basis}</LegalBasis> 通知の方法に制限はありません（口頭・メールも可）。{notes.noticeTo}の全員の同意があれば招集手続を省略できます。
        <LegalBasis>会社法368条2項</LegalBasis>
      </>,
    );
    items.push(<>書面決議: {notes.writtenResolution}</>);
    items.push(
      <>
        代表取締役・業務執行取締役は <Keep>{LEGAL.boardReportIntervalMonths} か月に 1 回以上</Keep>、職務の執行の状況を取締役会に報告します。この報告は書面決議・報告の省略ができないため、実際に開催する必要があります。
        <LegalBasis>会社法363条2項・372条2項</LegalBasis>
      </>,
    );
    items.push(
      <>
        議事録には出席した取締役および監査役が署名または記名押印し、取締役会の日から <Keep>{LEGAL.minutesRetentionYears} 年間</Keep>、本店に備え置きます。
        <LegalBasis>会社法369条3項・371条1項</LegalBasis>
      </>,
    );
  }

  return (
    <section className="gt-card" aria-label="この会社の手続きの目安">
      <div className="gt-card-title">この会社の手続きの目安</div>
      <div className="gt-card-sub">
        会社情報（{governance.isPublicCompany ? '公開会社' : '非公開会社'}・{governance.hasBoardOfDirectors ? '取締役会設置会社' : '取締役会なし'}）と定款の定めから計算しています。
        <Link href="/company" className="text-primary ml-1">会社情報を確認</Link>
      </div>
      <ul className="m-0 mt-3 pl-5 list-disc text-[13px] leading-relaxed text-text-body flex flex-col gap-1.5">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
};

export const MeetingList = ({ kind }: { kind: MeetingKind }) => {
  const config = MEETING_KINDS[kind];
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  const meetings = useResourceList<MeetingRow>('meetings');
  const agenda = useResourceList<AgendaItemRow>('meeting-agenda-items');
  const fiscalYears = useResourceList<FiscalYearRow>('fiscal-years');
  const { governance, error: companyError } = useCompany();
  const [isCreating, setIsCreating] = useState(false);
  const today = todayInTokyo();

  const rows = useMemo(
    () => (meetings.data ?? []).filter((meeting) => config.meetingTypes.includes(meeting.meetingType)),
    [meetings.data, config],
  );
  const agendaCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of agenda.data ?? []) counts.set(item.meetingId, (counts.get(item.meetingId) ?? 0) + 1);
    return counts;
  }, [agenda.data]);
  const fiscalYearLabel = useMemo(
    () => new Map((fiscalYears.data ?? []).map((fiscalYear) => [fiscalYear.id, fiscalYear.label])),
    [fiscalYears.data],
  );

  const createButton = editable ? (
    <button type="button" className="gt-btn-primary" onClick={() => setIsCreating(true)}>
      <Plus size={16} />
      {config.label}を登録
    </button>
  ) : null;

  return (
    <div className="page-body">
      <PageHeading
        title={config.label}
        description={
          kind === 'shareholder'
            ? '定時・臨時・種類株主総会の招集から議事録までを、手順に沿って進めます'
            : '取締役会の招集から議事録までを、手順に沿って進めます'
        }
        primaryAction={createButton}
      />

      <div className="flex flex-col gap-4">
        {companyError && <ErrorBlock message={`会社情報を読めなかったため、法定どおりの期間で計算しています（${companyError}）`} />}
        <GuidanceCard kind={kind} governance={governance} fiscalYears={fiscalYears.data ?? []} meetings={rows} today={today} />

        {meetings.isLoading && !meetings.data ? (
          <LoadingBlock />
        ) : meetings.error && !meetings.data ? (
          <ErrorBlock message={meetings.error} onRetry={() => void meetings.reload()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={`${config.label}はまだ登録されていません`}
            description="会議を登録すると、議案・出欠・招集通知・議事録を 1 つの画面で進められます。"
            action={createButton}
          />
        ) : (
          <section className="gt-card gt-card-table">
            <div className="gt-table-scroll">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    {kind === 'shareholder' ? <th title="上段: 種類 ／ 下段: 開催方法">種類・開催方法</th> : <th>開催方法</th>}
                    <th>開催日</th>
                    <th>進行状況</th>
                    <th className="gt-num">議案</th>
                    <th>招集通知の発送期限</th>
                    <th>議事録</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((meeting) => {
                    const info = noticeInfo(meeting, governance, today);
                    const minutes = minutesLabel(meeting);
                    return (
                      <tr key={meeting.id}>
                        <td className="gt-wrap-sm">
                          <Link href={`${config.basePath}/${meeting.id}`} className="font-semibold text-primary">
                            {meeting.title}
                          </Link>
                          {meeting.fiscalYearId && fiscalYearLabel.get(meeting.fiscalYearId) && (
                            <div className="text-[12px] text-text-muted">{fiscalYearLabel.get(meeting.fiscalYearId)}</div>
                          )}
                        </td>
                        {kind === 'shareholder' ? (
                          <td>
                            {optionLabel(MEETING_TYPES, meeting.meetingType)}
                            <div className="text-[12px] text-text-muted">{optionLabel(MEETING_FORMATS, meeting.format)}</div>
                          </td>
                        ) : (
                          <td>{optionLabel(MEETING_FORMATS, meeting.format)}</td>
                        )}
                        <td>
                          {formatDateJa(meeting.heldOn)}
                          {meeting.startTime && <span className="text-text-muted ml-1">{meeting.startTime.slice(0, 5)}</span>}
                        </td>
                        <td>
                          <Badge variant={STATUS_VARIANT[meeting.status] ?? 'neutral'}>{optionLabel(MEETING_STATUSES, meeting.status)}</Badge>
                        </td>
                        <td className="gt-num">{agendaCount.get(meeting.id) ?? 0}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            {info.deadline && <span>{formatDateJa(info.deadline)}</span>}
                            <NoticeBadge info={info} />
                          </div>
                        </td>
                        <td>
                          <Badge variant={minutes.variant}>{minutes.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <ResourceFormDialog
        resource="meetings"
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
        title={`${config.label}を登録`}
        defaults={{ meetingType: config.defaultMeetingType }}
        hiddenKeys={hiddenMeetingKeys(kind)}
        allowedOptions={{ meetingType: MEETING_KINDS[kind].meetingTypes }}
        onSaved={() => {
          setIsCreating(false);
          void meetings.reload();
        }}
      />
    </div>
  );
};

/** 会議のフォームで隠す項目。取締役会は種類が 1 つで、株主に関する項目が無い */
export const hiddenMeetingKeys = (kind: MeetingKind): readonly string[] =>
  kind === 'board' ? ['meetingType', 'fiscalYearId', 'recordDate', 'presentShareholders'] : [];
