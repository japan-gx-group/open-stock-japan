import { describe, expect, it } from 'vitest';
import type { EquitySnapshot } from '@/lib/equity/types';
import { DEFAULT_GOVERNANCE } from '@/lib/legal/rules';
import type { OfficerRow } from '../../types';
import {
  attendanceTotals,
  boardMembers,
  boardWrittenStatus,
  registryVoters,
  shareholderWrittenStatus,
  splitBoardResponses,
} from '../attendance';

const snapshot = {
  stakeholders: [
    { id: 's1', name: '創業 太郎' },
    { id: 's2', name: 'VC ファンド' },
    { id: 's3', name: '無議決権 花子' },
  ],
  shareClasses: [
    { id: 'c1', name: '普通株式', hasVotingRights: true },
    { id: 'c2', name: 'A種優先株式', hasVotingRights: true },
    { id: 'c3', name: '無議決権株式', hasVotingRights: false },
  ],
  shareTransactions: [
    { id: 't1', stakeholderId: 's1', shareClassId: 'c1', shares: 800, transactionDate: '2023-04-01' },
    { id: 't2', stakeholderId: 's2', shareClassId: 'c2', shares: 200, transactionDate: '2026-10-20' },
    { id: 't3', stakeholderId: 's2', shareClassId: 'c1', shares: 50, transactionDate: '2024-01-10' },
    { id: 't4', stakeholderId: 's3', shareClassId: 'c3', shares: 100, transactionDate: '2024-01-10' },
    { id: 't5', stakeholderId: 's1', shareClassId: 'c1', shares: -100, transactionDate: '2026-11-01' },
  ],
} as unknown as EquitySnapshot;

describe('registryVoters', () => {
  it('基準日時点の、議決権のある種類の株式だけを株主ごとに合計する', () => {
    expect(registryVoters(snapshot, '2026-03-31')).toEqual([
      { stakeholderId: 's1', name: '創業 太郎', votingRights: 800 },
      { stakeholderId: 's2', name: 'VC ファンド', votingRights: 50 },
    ]);
  });

  it('基準日のあとの異動を反映すると数が変わる', () => {
    expect(registryVoters(snapshot, null)).toEqual([
      { stakeholderId: 's1', name: '創業 太郎', votingRights: 700 },
      { stakeholderId: 's2', name: 'VC ファンド', votingRights: 250 },
    ]);
  });
});

const officer = (id: string, position: string, overrides: Partial<OfficerRow> = {}): OfficerRow => ({
  id,
  name: id,
  position,
  isOutside: false,
  stakeholderId: null,
  appointedOn: '2025-06-27',
  termExpiresOn: null,
  retiredOn: null,
  registeredOn: null,
  notes: '',
  ...overrides,
});

describe('boardMembers', () => {
  const officers = [
    officer('監査', 'auditor'),
    officer('取締役B', 'director'),
    officer('代表', 'representative_director'),
    officer('退任', 'director', { retiredOn: '2026-06-26' }),
    officer('就任前', 'director', { appointedOn: '2027-01-01' }),
    officer('執行役員', 'executive_officer'),
  ];

  it('在任中の取締役と監査役を、代表取締役・取締役・監査役の順に並べる', () => {
    expect(boardMembers(officers, DEFAULT_GOVERNANCE, '2026-12-18').map((member) => [member.name, member.role])).toEqual([
      ['代表', 'director'],
      ['取締役B', 'director'],
      ['監査', 'auditor'],
    ]);
  });

  it('退任日より前の会議には退任した取締役も含める', () => {
    expect(boardMembers(officers, DEFAULT_GOVERNANCE, '2026-06-01').map((member) => member.name)).toContain('退任');
  });

  it('監査役を置かない会社では監査役を並べない', () => {
    const members = boardMembers(officers, { ...DEFAULT_GOVERNANCE, hasAuditor: false }, '2026-12-18');
    expect(members.some((member) => member.role === 'auditor')).toBe(false);
  });
});

describe('attendanceTotals', () => {
  it('出席・委任状・書面による議決権行使を出席として数える', () => {
    const totals = attendanceTotals([
      { response: 'attending', votingRights: 800 },
      { response: 'proxy', votingRights: 100 },
      { response: 'written_vote', votingRights: 50 },
      { response: 'absent', votingRights: 30 },
      { response: 'no_response', votingRights: 20 },
    ]);
    expect(totals).toMatchObject({
      memberCount: 5,
      totalVotingRights: 1000,
      presentCount: 3,
      presentVotingRights: 950,
      noResponseCount: 1,
      allConsented: false,
    });
  });

  it('全員が同意したときだけ allConsented になる', () => {
    expect(attendanceTotals([]).allConsented).toBe(false);
    const partial = attendanceTotals([
      { response: 'consent', votingRights: 800 },
      { response: 'no_response', votingRights: 200 },
    ]);
    expect(partial).toMatchObject({ consentCount: 1, consentMissing: 1, allConsented: false, consentVotingRights: 800 });
    const all = attendanceTotals([
      { response: 'consent', votingRights: 800 },
      { response: 'consent', votingRights: 200 },
    ]);
    expect(all).toMatchObject({ consentMissing: 0, allConsented: true });
  });
});

describe('書面決議の成立', () => {
  it('株主総会: 全員の同意が揃うまでは残りの人数を示す（会社法319条1項）', () => {
    const missing = shareholderWrittenStatus(attendanceTotals([{ response: 'consent', votingRights: 1 }, { response: 'dissent', votingRights: 1 }, { response: 'no_response', votingRights: 1 }]));
    expect(missing.established).toBe(false);
    expect(missing.message).toContain('あと 2 名');
    const done = shareholderWrittenStatus(attendanceTotals([{ response: 'consent', votingRights: 1 }]));
    expect(done.established).toBe(true);
    expect(done.message).toContain('全員の同意が揃いました');
    expect(shareholderWrittenStatus(attendanceTotals([])).established).toBe(false);
  });

  it('取締役会: 定款の定めが無ければ成立しない（会社法370条）', () => {
    const totals = attendanceTotals([{ response: 'consent', votingRights: 1 }]);
    expect(boardWrittenStatus(totals, [], DEFAULT_GOVERNANCE).established).toBe(false);
  });

  it('取締役会: 監査役設置会社では監査役の異議があると成立しない', () => {
    const governance = { ...DEFAULT_GOVERNANCE, allowsBoardWrittenResolution: true };
    const totals = attendanceTotals([{ response: 'consent', votingRights: 1 }, { response: 'consent', votingRights: 1 }]);
    expect(boardWrittenStatus(totals, [{ response: 'no_response' }], governance).established).toBe(true);
    expect(boardWrittenStatus(totals, [{ response: 'dissent' }], governance).established).toBe(false);
    // 会計限定の監査役は 370 条の「監査役」に当たらない
    expect(boardWrittenStatus(totals, [{ response: 'dissent' }], { ...governance, auditorLimitedToAccounting: true }).established).toBe(true);
  });

  it('取締役会: 取締役の同意が欠けていれば残りの人数を示す', () => {
    const governance = { ...DEFAULT_GOVERNANCE, allowsBoardWrittenResolution: true };
    const status = boardWrittenStatus(attendanceTotals([{ response: 'consent', votingRights: 1 }, { response: 'no_response', votingRights: 1 }]), [], governance);
    expect(status.established).toBe(false);
    expect(status.message).toContain('あと 1 名');
  });
});

describe('splitBoardResponses', () => {
  it('取締役・監査役・その他に分ける', () => {
    const officers = [officer('d1', 'director'), officer('r1', 'representative_director'), officer('a1', 'auditor')];
    const split = splitBoardResponses([{ officerId: 'd1' }, { officerId: 'a1' }, { officerId: 'r1' }, { officerId: 'gone' }, { officerId: null }], officers);
    expect(split.directors.map((row) => row.officerId)).toEqual(['d1', 'r1']);
    expect(split.auditors.map((row) => row.officerId)).toEqual(['a1']);
    expect(split.others).toHaveLength(2);
  });
});
