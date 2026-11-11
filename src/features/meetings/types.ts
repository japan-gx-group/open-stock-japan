// 会議（株主総会・取締役会）の画面で使う行の型。列はリソース定義（src/lib/resources/definitions.ts）のとおり。

import type { MeetingType } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';
import type { ResolutionType } from '@/lib/legal/rules';

/** 画面の種類。株主総会（定時・臨時・種類）と取締役会で同じ実装を使い分ける */
export type MeetingKind = 'shareholder' | 'board';

export type MeetingRow = ResourceRow & {
  meetingType: MeetingType;
  title: string;
  format: 'in_person' | 'online' | 'hybrid' | 'written_resolution';
  status: 'planning' | 'noticed' | 'held' | 'closed';
  heldOn: string | null;
  startTime: string | null;
  place: string;
  fiscalYearId: string | null;
  recordDate: string | null;
  noticeSentOn: string | null;
  chairperson: string;
  minutesPreparer: string;
  attendingOfficers: string;
  totalVotingRights: number | null;
  presentVotingRights: number | null;
  presentShareholders: number | null;
  minutesFinalizedOn: string | null;
  minutesBody: string;
  notes: string;
};

export type AgendaItemRow = ResourceRow & {
  meetingId: string;
  sortOrder: number;
  itemType: 'resolution' | 'report';
  title: string;
  resolutionType: ResolutionType;
  result: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'reported';
  votesFor: number | null;
  votesAgainst: number | null;
  votesAbstain: number | null;
  description: string;
};

export type ResponseValue = 'no_response' | 'attending' | 'proxy' | 'written_vote' | 'consent' | 'dissent' | 'absent';

export type ResponseRow = ResourceRow & {
  meetingId: string;
  stakeholderId: string | null;
  officerId: string | null;
  response: ResponseValue;
  votingRights: number | null;
  respondedOn: string | null;
  notes: string;
};

export type OfficerRow = ResourceRow & {
  name: string;
  position: string;
  isOutside: boolean;
  stakeholderId: string | null;
  appointedOn: string | null;
  termExpiresOn: string | null;
  retiredOn: string | null;
  registeredOn: string | null;
  notes: string;
};

export type FiscalYearRow = ResourceRow & { label: string; startDate: string; endDate: string };

export interface MeetingDocument {
  id: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  documentDate: string | null;
  createdAt: string;
}
