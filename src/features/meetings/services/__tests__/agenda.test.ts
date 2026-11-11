import { describe, expect, it } from 'vitest';
import { agendaVerdict, moveAgendaItem, nextSortOrder, sortAgenda } from '../agenda';

describe('並び順', () => {
  const items = [
    { id: 'a', sortOrder: 1 },
    { id: 'b', sortOrder: 2 },
    { id: 'c', sortOrder: 3 },
  ];

  it('次の順番は最大 + 1', () => {
    expect(nextSortOrder(items)).toBe(4);
    expect(nextSortOrder([])).toBe(1);
  });

  it('順番、同じなら作成順に並べる', () => {
    const sorted = sortAgenda([
      { sortOrder: 2, createdAt: '2026-01-02' },
      { sortOrder: 1, createdAt: '2026-01-03' },
      { sortOrder: 2, createdAt: '2026-01-01' },
    ]);
    expect(sorted.map((item) => item.createdAt)).toEqual(['2026-01-03', '2026-01-01', '2026-01-02']);
  });

  it('1 つ動かすと、入れ替わった 2 行だけを保存し直す', () => {
    expect(moveAgendaItem(items, 'b', 'up')).toEqual([
      { id: 'b', sortOrder: 1 },
      { id: 'a', sortOrder: 2 },
    ]);
    expect(moveAgendaItem(items, 'b', 'down')).toEqual([
      { id: 'c', sortOrder: 2 },
      { id: 'b', sortOrder: 3 },
    ]);
  });

  it('端では動かさない', () => {
    expect(moveAgendaItem(items, 'a', 'up')).toEqual([]);
    expect(moveAgendaItem(items, 'c', 'down')).toEqual([]);
    expect(moveAgendaItem(items, 'x', 'up')).toEqual([]);
  });

  it('同じ順番が混じっていても 1 から振り直す', () => {
    const duplicated = [
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 1 },
      { id: 'c', sortOrder: 5 },
    ];
    expect(moveAgendaItem(duplicated, 'c', 'up')).toEqual([
      { id: 'c', sortOrder: 2 },
      { id: 'b', sortOrder: 3 },
    ]);
  });
});

describe('agendaVerdict', () => {
  const meeting = { format: 'in_person' as const, totalVotingRights: 1000, presentVotingRights: 900 };

  it('普通決議・特別決議を会議の議決権数から判定する', () => {
    expect(agendaVerdict(meeting, { resolutionType: 'ordinary', votesFor: 451 }).state).toBe('approved');
    expect(agendaVerdict(meeting, { resolutionType: 'ordinary', votesFor: 450 }).state).toBe('rejected');
    expect(agendaVerdict(meeting, { resolutionType: 'special', votesFor: 600 }).state).toBe('approved');
    expect(agendaVerdict(meeting, { resolutionType: 'special', votesFor: 599 }).state).toBe('rejected');
  });

  it('数字が足りなければ判定できません', () => {
    expect(agendaVerdict({ ...meeting, presentVotingRights: null }, { resolutionType: 'ordinary', votesFor: 500 }).label).toBe('判定できません');
    expect(agendaVerdict(meeting, { resolutionType: 'ordinary', votesFor: null }).state).toBe('unknown');
  });

  it('309条3項・4項は頭数が無いと判定できない', () => {
    const item = { resolutionType: 'extraordinary_309_4' as const, votesFor: 800 };
    expect(agendaVerdict(meeting, item).state).toBe('unknown');
    expect(agendaVerdict(meeting, item, { totalHolders: 5, holdersFor: 3 }).state).toBe('approved');
    expect(agendaVerdict(meeting, item, { totalHolders: 5, holdersFor: 2 }).state).toBe('rejected');
  });

  it('書面決議は決議の種類にかかわらず全員の同意で判定する', () => {
    const written = { format: 'written_resolution' as const, totalVotingRights: 1000, presentVotingRights: null };
    expect(agendaVerdict(written, { resolutionType: 'ordinary', votesFor: 1000 })).toMatchObject({ evaluatedAs: 'unanimous', state: 'approved' });
    expect(agendaVerdict(written, { resolutionType: 'ordinary', votesFor: 999 }).state).toBe('rejected');
  });

  it('取締役会は出席取締役の過半数', () => {
    const board = { format: 'in_person' as const, totalVotingRights: 3, presentVotingRights: 2 };
    expect(agendaVerdict(board, { resolutionType: 'board', votesFor: 2 }).state).toBe('approved');
    expect(agendaVerdict(board, { resolutionType: 'board', votesFor: 1 }).state).toBe('rejected');
    expect(agendaVerdict({ ...board, presentVotingRights: 1 }, { resolutionType: 'board', votesFor: 1 }).evaluation.quorumMet).toBe(false);
  });
});
