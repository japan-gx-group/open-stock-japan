import { describe, expect, it } from 'vitest';
import { GROUP_SPECS } from '../groups';
import { buildReviewState, buildRowBody, checkReview, firstReviewError, heldShares, mergeCompanyValues, parseRef, refExisting, refNew } from '../review';
import type { ImportExtraction, ReviewRow, ReviewState } from '../types';
import { context, ID, investmentExtraction } from './fixture';

const rowOf = (state: ReviewState, key: string): ReviewRow => {
  const row = Object.values(state).flat().find((item) => item?.key === key);
  if (!row) throw new Error(`${key} がありません`);
  return row;
};

const extraction = (kind: ImportExtraction['documentKind'], groups: ImportExtraction['groups']): ImportExtraction => ({
  documentKind: kind,
  summary: '',
  documentDate: null,
  warnings: [],
  groups,
});

describe('parseRef', () => {
  it('登録済みの行・新しく作る行・未選択を見分ける', () => {
    expect(parseRef(refExisting(ID.fund))).toEqual({ mode: 'existing', id: ID.fund });
    expect(parseRef(refNew('stakeholders-2'))).toEqual({ mode: 'new', key: 'stakeholders-2' });
    expect(parseRef('')).toBeNull();
    expect(parseRef('existing:not-a-uuid')).toBeNull();
    expect(parseRef('new:../../x')).toBeNull();
    expect(parseRef(ID.fund)).toBeNull();
  });
});

describe('buildReviewState（総数引受契約）', () => {
  const state = buildReviewState(investmentExtraction(), context());

  it('登録済みの株主は新しく作らず、表記のゆれた法人は候補つきの新規、名前だけ出てきた引受人は行を足す', () => {
    const [fund, corp, added] = state.stakeholders ?? [];
    expect(fund).toMatchObject({ include: false, existing: { id: ID.fund } });
    expect(corp.include).toBe(true);
    expect(corp.existing).toBeNull();
    expect(corp.similar.map((row) => row.id)).toEqual([ID.corp]);
    expect(added).toMatchObject({ include: true, values: { name: '架空みらい2号投資事業有限責任組合', kind: 'individual' } });
    expect(state.stakeholders).toHaveLength(3);
  });

  it('異動の参照は、登録済みの行か、この取り込みで作る行を既定にする', () => {
    const [first, second, third] = state.shareTransactions ?? [];
    expect(first.refs).toEqual({ stakeholderId: refExisting(ID.fund), shareClassId: refNew('shareClasses-0'), roundId: refNew('fundingRound-0') });
    expect(second.refs.stakeholderId).toBe(refNew('stakeholders-1'));
    expect(third.refs.stakeholderId).toBe(refNew('stakeholders-2'));
    expect(first.names).toEqual({ stakeholderId: '架空1号投資事業有限責任組合', shareClassId: 'B種優先株式' });
    expect(first.matches.stakeholderId.status).toBe('exact');
  });

  it('値はフォームの表示値になり、AI が読まない項目は初期値で埋まる', () => {
    const transaction = state.shareTransactions?.[0];
    expect(transaction?.values).toMatchObject({ shares: '1,500', amount: '60,000,000', pricePerShare: '40000', transactionType: 'new_issue', capitalAmount: '' });
    expect(state.fundingRound?.[0].values).toMatchObject({ status: 'closed', roundType: 'series_b', targetAmount: '100,000,000' });
    expect(state.shareClasses?.[0].values).toMatchObject({ seniority: '0', conversionRatio: '1', antiDilution: 'none', hasVotingRights: true });
  });

  it('そのまま反映できる（問題なし）。似た名前の株主には注意が付く', () => {
    const check = checkReview('investment_agreement', state, context());
    expect(check.errorCount).toBe(0);
    expect(check.includedCount).toBe(7);
    expect(check.rows['stakeholders-1'].warnings.join()).toContain('架空事業会社株式会社');
  });

  it('登録済みの種類の株式なら、種類の提案を足さずに登録済みを選ぶ', () => {
    const source = investmentExtraction();
    source.groups.shareClasses = [];
    for (const item of [...(source.groups.shareTransactions ?? []), ...(source.groups.fundingRound ?? [])]) item.shareClassName = 'Ａ種優先株';
    const built = buildReviewState(source, context());
    expect(built.shareClasses).toEqual([]);
    expect(built.shareTransactions?.[0].refs.shareClassId).toBe(refExisting(ID.classA));
  });

  it('同じ名前のラウンドが登録済みなら、新しく作らず登録済みを参照する', () => {
    const source = investmentExtraction();
    (source.groups.fundingRound ?? [])[0].name = 'シリーズ A';
    const built = buildReviewState(source, context());
    expect(built.fundingRound?.[0]).toMatchObject({ include: false, existing: { id: ID.round } });
    expect(built.shareTransactions?.[0].refs.roundId).toBe(refExisting(ID.round));
  });
});

describe('checkReview（参照）', () => {
  it('必須の参照が未選択なら反映できない', () => {
    const state = buildReviewState(investmentExtraction(), context());
    rowOf(state, 'shareTransactions-0').refs.stakeholderId = '';
    const check = checkReview('investment_agreement', state, context());
    expect(check.rows['shareTransactions-0'].fieldErrors.stakeholderId).toContain('株主を選んでください');
    expect(firstReviewError('investment_agreement', check)).toContain('株式の異動');
  });

  it('新しく作る行を対象から外したまま参照していると反映できない', () => {
    const state = buildReviewState(investmentExtraction(), context());
    rowOf(state, 'stakeholders-2').include = false;
    const check = checkReview('investment_agreement', state, context());
    expect(check.rows['shareTransactions-2'].fieldErrors.stakeholderId).toContain('対象から外れています');
    expect(check.rows['shareTransactions-1'].fieldErrors.stakeholderId).toBeUndefined();
  });

  it('台帳に無い id・別のまとまりの行・形の違う指定は反映できない', () => {
    const state = buildReviewState(investmentExtraction(), context());
    rowOf(state, 'shareTransactions-0').refs.stakeholderId = refExisting('99999999-0000-4000-8000-000000000000');
    rowOf(state, 'shareTransactions-1').refs.stakeholderId = refNew('shareClasses-0');
    rowOf(state, 'shareTransactions-2').refs.shareClassId = 'invalid';
    const check = checkReview('investment_agreement', state, context());
    expect(check.rows['shareTransactions-0'].fieldErrors.stakeholderId).toContain('見つかりません');
    expect(check.rows['shareTransactions-1'].fieldErrors.stakeholderId).toContain('選び直してください');
    expect(check.rows['shareTransactions-2'].fieldErrors.shareClassId).toContain('選び直してください');
  });

  it('対象から外した行は調べない', () => {
    const state = buildReviewState(investmentExtraction(), context());
    const row = rowOf(state, 'shareTransactions-0');
    row.values.shares = 'abc';
    row.include = false;
    const check = checkReview('investment_agreement', state, context());
    expect(check.rows['shareTransactions-0']).toBeUndefined();
    expect(check.errorCount).toBe(0);
  });
});

describe('checkReview（株式の異動）', () => {
  const build = () => buildReviewState(investmentExtraction(), context());

  it('項目の検証はリソース定義のとおり（株式数が数値でない・0・日付なし）', () => {
    const state = build();
    rowOf(state, 'shareTransactions-0').values.shares = 'たくさん';
    rowOf(state, 'shareTransactions-1').values.shares = '0';
    rowOf(state, 'shareTransactions-2').values.transactionDate = '';
    const check = checkReview('investment_agreement', state, context());
    expect(check.rows['shareTransactions-0'].fieldErrors.shares).toContain('数値');
    expect(check.rows['shareTransactions-1'].fieldErrors.shares).toContain('0 は指定できません');
    expect(check.rows['shareTransactions-2'].fieldErrors.transactionDate).toBeTruthy();
    expect(check.errorCount).toBe(3);
  });

  it('資本金に組み入れた額が払込金額の 2 分の 1 を下回ると注意、払込金額を超えると反映できない', () => {
    const state = build();
    rowOf(state, 'shareTransactions-0').values.capitalAmount = '20,000,000';
    rowOf(state, 'shareTransactions-1').values.capitalAmount = '10,000,000';
    rowOf(state, 'shareTransactions-2').values.capitalAmount = '30,000,000';
    const check = checkReview('investment_agreement', state, context());
    expect(check.rows['shareTransactions-0'].warnings.join()).toContain('2 分の 1');
    expect(check.rows['shareTransactions-1'].warnings).toEqual([]);
    expect(check.rows['shareTransactions-2'].fieldErrors.capitalAmount).toContain('金額（合計）以下');
  });

  it('金額が無いときは 1 株あたりの金額 × 株式数で 2 分の 1 を確かめる', () => {
    const state = build();
    const row = rowOf(state, 'shareTransactions-0');
    row.values.amount = '';
    row.values.capitalAmount = '1,000';
    expect(checkReview('investment_agreement', state, context()).rows['shareTransactions-0'].warnings.join()).toContain('2 分の 1');
  });

  it('同じ株主・種類・異動日・株式数の異動が登録済みなら注意', () => {
    const state = build();
    const row = rowOf(state, 'shareTransactions-0');
    row.refs.shareClassId = refExisting(ID.classA);
    row.values.transactionDate = '2025-06-30';
    row.values.shares = '2,000';
    expect(checkReview('investment_agreement', state, context()).rows['shareTransactions-0'].warnings.join()).toContain('すでに登録されています');
  });

  it('持株がマイナスになる減少は注意', () => {
    const state = build();
    const row = rowOf(state, 'shareTransactions-0');
    row.refs.shareClassId = refExisting(ID.classA);
    row.values.shares = '-2,001';
    row.values.amount = '';
    row.values.pricePerShare = '';
    expect(checkReview('investment_agreement', state, context()).rows['shareTransactions-0'].warnings.join()).toContain('マイナス');
    row.values.shares = '-2,000';
    expect(checkReview('investment_agreement', state, context()).rows['shareTransactions-0'].warnings.join()).not.toContain('マイナス');
  });

  it('調達額と引受けの合計が合わなければラウンドに注意。資本金の組入れが半分未満のラウンドは反映できない', () => {
    const state = build();
    rowOf(state, 'shareTransactions-2').values.amount = '10,000,000';
    rowOf(state, 'shareTransactions-2').values.pricePerShare = '';
    let check = checkReview('investment_agreement', state, context());
    expect(check.rows['fundingRound-0'].warnings.join()).toContain('合いません');
    rowOf(state, 'fundingRound-0').values.capitalIncreaseAmount = '40,000,000';
    check = checkReview('investment_agreement', state, context());
    expect(check.rows['fundingRound-0'].fieldErrors.capitalIncreaseAmount).toContain('2 分の 1');
  });
});

describe('checkReview（株式譲渡）', () => {
  const transfer = (overrides: Record<string, unknown> = {}) =>
    extraction('share_transfer', {
      stakeholders: [{ name: '創業 太郎' }, { name: '架空 譲受' }],
      transfers: [{ fromName: '創業 太郎', toName: '架空 譲受', shareClassName: '普通株式', transactionDate: '2026-11-01', shares: 1000, pricePerShare: 500, ...overrides }],
    });

  it('譲渡人は登録済み、譲受人はこの取り込みで作る行が既定になる', () => {
    const state = buildReviewState(transfer(), context());
    expect(state.transfers?.[0].refs).toEqual({ fromStakeholderId: refExisting(ID.founder), toStakeholderId: refNew('stakeholders-1'), shareClassId: refExisting(ID.common) });
    expect(checkReview('share_transfer', state, context()).errorCount).toBe(0);
  });

  it('譲渡日時点の持株を超える譲渡は反映できない（/api/equity/transfer と同じ）', () => {
    const state = buildReviewState(transfer({ shares: 800_001 }), context());
    expect(checkReview('share_transfer', state, context()).rows['transfers-0'].fieldErrors.shares).toContain('800,000株までです');
    // 取得より前の日付では持株が無い
    const early = buildReviewState(transfer({ transactionDate: '2023-04-02' }), context());
    expect(checkReview('share_transfer', early, context()).rows['transfers-0'].fieldErrors.shares).toContain('0株までです');
  });

  it('同じ取り込みの中の譲渡は合算して確かめる', () => {
    const source = transfer({ shares: 500_000 });
    source.groups.transfers?.push({ fromName: '創業 太郎', toName: '架空 譲受', shareClassName: '普通株式', transactionDate: '2026-11-01', shares: 300_001, pricePerShare: 500 });
    const check = checkReview('share_transfer', buildReviewState(source, context()), context());
    expect(check.rows['transfers-0'].fieldErrors.shares).toBeUndefined();
    expect(check.rows['transfers-1'].fieldErrors.shares).toContain('300,000株までです');
  });

  it('譲渡人と譲受人が同じ・譲渡人が新しく作る株主なら反映できない', () => {
    const same = buildReviewState(transfer(), context());
    rowOf(same, 'transfers-0').refs.toStakeholderId = refExisting(ID.founder);
    expect(checkReview('share_transfer', same, context()).rows['transfers-0'].fieldErrors.toStakeholderId).toContain('別の人');

    const fresh = buildReviewState(transfer({ fromName: '架空 新規' }), context());
    expect(rowOf(fresh, 'transfers-0').refs.fromStakeholderId).toBe(refNew('stakeholders-2'));
    expect(checkReview('share_transfer', fresh, context()).rows['transfers-0'].fieldErrors.fromStakeholderId).toContain('登録済みの株主');
  });

  it('株式数は 1 以上の整数、譲渡日は必須', () => {
    const state = buildReviewState(transfer({ shares: null, transactionDate: null }), context());
    const issues = checkReview('share_transfer', state, context()).rows['transfers-0'];
    expect(issues.fieldErrors.shares).toBeTruthy();
    expect(issues.fieldErrors.transactionDate).toBeTruthy();
  });
});

describe('checkReview（会社情報・登記簿）', () => {
  const registry = () =>
    extraction('registry', {
      company: [{ name: '架空テック株式会社', address: '東京都港区架空九丁目9番9号', capitalAmount: 126_000_000, hasAuditor: false, auditorLimitedToAccounting: null }],
      officers: [
        { name: '創業　太郎', position: 'representative_director', appointedOn: '2025-06-27' },
        { name: '架空 新任', position: 'director', appointedOn: '2026-06-26' },
      ],
      issuedShares: [
        { shareClassName: '普通株式', shares: 800_000 },
        { shareClassName: 'A種優先株式', shares: 2_500 },
      ],
    });

  it('読み取れて今の値と違う項目だけを既定で選ぶ', () => {
    const state = buildReviewState(registry(), context());
    expect(state.company?.[0].ticked).toEqual(['address', 'capitalAmount', 'hasAuditor']);
    expect(state.company?.[0].include).toBe(true);
    expect(state.company?.[0].values.capitalAmount).toBe('126,000,000');
  });

  it('選んだ項目だけを今の値に重ねる', () => {
    const state = buildReviewState(registry(), context());
    const row = rowOf(state, 'company-0');
    row.ticked = ['capitalAmount'];
    const merged = mergeCompanyValues('registry', row, context());
    expect(merged.capitalAmount).toBe('126,000,000');
    expect(merged.address).toBe('東京都港区架空一丁目2番3号');
    expect(merged.hasAuditor).toBe(true);
    // 取り込みの対象でない項目は、選ばれていても今の値のまま
    row.ticked = ['capitalAmount', 'fiscalYearStartMonth'];
    row.values.fiscalYearStartMonth = '1';
    expect(mergeCompanyValues('registry', row, context()).fiscalYearStartMonth).toBe('4');
  });

  it('管理者でなければ会社情報は既定で対象外。対象にすると反映できない', () => {
    const viewer = context({ canEditCompany: false });
    const state = buildReviewState(registry(), viewer);
    expect(state.company?.[0]).toMatchObject({ include: false, ticked: [] });
    expect(checkReview('registry', state, viewer).errorCount).toBe(0);
    rowOf(state, 'company-0').include = true;
    expect(checkReview('registry', state, viewer).rows['company-0'].errors.join()).toContain('管理者だけ');
  });

  it('今の値との組み合わせで定義の決まりに反すると反映できない（監査役なしで会計限定）', () => {
    const base = context();
    const limited = context({ company: { ...base.company, auditorLimitedToAccounting: true } });
    const state = buildReviewState(registry(), limited);
    const issues = checkReview('registry', state, limited).rows['company-0'];
    expect([...issues.errors, ...Object.values(issues.fieldErrors)].join()).toContain('監査役を置いていない会社では選べません');
  });

  it('項目を 1 つも選ばずに対象にすると反映できない。値の形も確かめる', () => {
    const state = buildReviewState(registry(), context());
    const row = rowOf(state, 'company-0');
    row.ticked = [];
    expect(checkReview('registry', state, context()).rows['company-0'].errors.join()).toContain('1 つ以上');
    row.ticked = ['capitalAmount'];
    row.values.capitalAmount = '-1';
    expect(checkReview('registry', state, context()).rows['company-0'].fieldErrors.capitalAmount).toBeTruthy();
  });

  it('在任中の同じ役員は既定で対象外、新しい役員は対象', () => {
    const state = buildReviewState(registry(), context());
    expect(state.officers?.[0]).toMatchObject({ include: false, existing: { id: 'o1' } });
    expect(state.officers?.[1].include).toBe(true);
  });

  it('登記簿の発行済株式数を台帳と照合する（台帳には書かない）', () => {
    const state = buildReviewState(registry(), context());
    expect(state.issuedShares?.every((row) => !row.include)).toBe(true);
    const check = checkReview('registry', state, context());
    const messages = check.notices.map((notice) => `${notice.level}:${notice.message}`);
    expect(messages.find((message) => message.includes('普通株式'))).toMatch(/^info:.*一致/);
    expect(messages.find((message) => message.includes('A種優先株式'))).toMatch(/^warning:.*2,500株.*2,000株/);
    expect(messages.join()).toContain('発行済株式の総数');
  });
});

describe('checkReview（新株予約権・転換型・決算・株主名簿）', () => {
  it('割当の合計が総数を超えると注意。回次は新しく作る行が既定', () => {
    const source = extraction('stock_option', {
      stakeholders: [{ name: '架空 七海' }],
      optionPlan: [{ name: '第3回新株予約権', planType: 'tax_qualified', totalUnits: 1000, sharesPerUnit: 1, exercisePrice: 4000, issuePrice: 0 }],
      optionGrants: [
        { holderName: '架空 七海', holderRole: 'employee', units: 800 },
        { holderName: '創業 太郎', holderRole: 'director', units: 300 },
      ],
    });
    const state = buildReviewState(source, context());
    expect(state.optionGrants?.[0].refs).toEqual({ planId: refNew('optionPlan-0'), stakeholderId: refNew('stakeholders-0') });
    expect(state.optionGrants?.[1].refs.stakeholderId).toBe(refExisting(ID.founder));
    const check = checkReview('stock_option', state, context());
    expect(check.errorCount).toBe(0);
    expect(check.rows['optionPlan-0'].warnings.join()).toContain('超えています');
  });

  it('登録済みの回次と同じ名前なら、回次は作らず、割当は登録済みの回次に足す（重複は注意）', () => {
    const source = extraction('stock_option', {
      stakeholders: [],
      optionPlan: [{ name: '第１回 新株予約権', totalUnits: 1000, sharesPerUnit: 1, exercisePrice: 100, issuePrice: 0 }],
      optionGrants: [{ holderName: '創業 太郎', holderRole: 'director', units: 100 }],
    });
    const state = buildReviewState(source, context());
    expect(state.optionPlan?.[0].include).toBe(false);
    expect(state.optionGrants?.[0].refs.planId).toBe(refExisting(ID.plan));
    expect(checkReview('stock_option', state, context()).rows['optionGrants-0'].warnings.join()).toContain('すでに登録されています');
  });

  it('転換型: 回次の数字が読めなければ次の番号。登録済みの番号は反映できない', () => {
    const source = extraction('convertible', {
      stakeholders: [],
      convertibleRound: [{ roundNo: null, name: '第2回 J-KISS 型新株予約権', instrumentType: 'jkiss', valuationCap: 300_000_000, capBasis: null, discountRate: 20 }],
      convertibleInvestments: [{ investorName: '架空1号投資事業有限責任組合', amount: 10_000_000, investmentDate: '2026-10-01' }],
    });
    const state = buildReviewState(source, context());
    expect(state.convertibleRound?.[0].values).toMatchObject({ roundNo: '2', capBasis: 'post_money', discountRate: '20', status: 'outstanding' });
    expect(checkReview('convertible', state, context()).errorCount).toBe(0);
    rowOf(state, 'convertibleRound-0').values.roundNo = '1';
    expect(checkReview('convertible', state, context()).rows['convertibleRound-0'].fieldErrors.roundNo).toContain('すでに登録されています');
  });

  it('決算: 期間から事業年度を選ぶ。同じ期間の決算が登録済みなら既定で対象外', () => {
    const report = (periodStart: string, periodEnd: string) =>
      extraction('financial_statements', { financialReport: [{ title: '決算', periodType: 'annual', periodStart, periodEnd, revenue: 1000, netIncome: -500 }] });
    const same = buildReviewState(report('2025-04-01', '2026-03-31'), context());
    expect(same.financialReport?.[0]).toMatchObject({ include: false, refs: { fiscalYearId: refExisting(ID.fy3) } });
    const half = buildReviewState(report('2026-04-01', '2026-09-30'), context());
    expect(half.financialReport?.[0]).toMatchObject({ include: true, refs: { fiscalYearId: refExisting(ID.fy4) }, values: { netIncome: '-500', status: 'draft' } });
    expect(checkReview('financial_statements', half, context()).errorCount).toBe(0);
    rowOf(half, 'financialReport-0').values.periodEnd = '2026-03-31';
    expect(checkReview('financial_statements', half, context()).rows['financialReport-0'].fieldErrors.periodEnd).toContain('開始日以降');
  });

  it('株主名簿: 異動の種類は「その他」、異動日が無ければ反映できない。履歴は復元しない旨を出す', () => {
    const source = extraction('shareholder_list', {
      stakeholders: [{ name: '架空 花子', address: '東京都' }],
      shareClasses: [],
      shareTransactions: [
        { holderName: '架空 花子', shareClassName: '普通株式', transactionDate: null, shares: 100 },
        { holderName: '創業 太郎', shareClassName: '普通株式', transactionDate: '2026-09-30', shares: 800_000 },
      ],
    });
    const state = buildReviewState(source, context());
    expect(state.shareTransactions?.[0].values.transactionType).toBe('other');
    expect(state.shareTransactions?.[0].refs).toMatchObject({ shareClassId: refExisting(ID.common), roundId: '' });
    const check = checkReview('shareholder_list', state, context());
    expect(check.rows['shareTransactions-0'].fieldErrors.transactionDate).toBeTruthy();
    expect(check.notices.map((notice) => notice.message).join()).toContain('履歴や取得日は復元されません');
    expect(check.notices.some((notice) => notice.level === 'warning' && notice.message.includes('上乗せ'))).toBe(true);
    // 株主名簿では、増資などの種類は選べない（送られても通さない）
    rowOf(state, 'shareTransactions-0').values.transactionType = 'new_issue';
    expect(checkReview('shareholder_list', state, context()).rows['shareTransactions-0'].fieldErrors.transactionType).toBeTruthy();
  });

  it('議事録: 議案は、この取り込みで作る会議を参照する', () => {
    const source = extraction('meeting_minutes', {
      meeting: [{ meetingType: 'board', title: '第20回 取締役会', format: 'in_person', heldOn: '2026-11-05', totalVotingRights: 3, presentVotingRights: 3 }],
      agendaItems: [{ sortOrder: 1, itemType: 'resolution', title: '第1号議案', resolutionType: 'board', result: 'approved' }],
    });
    const state = buildReviewState(source, context());
    expect(state.meeting?.[0].values.status).toBe('held');
    expect(state.agendaItems?.[0].refs.meetingId).toBe(refNew('meeting-0'));
    expect(checkReview('meeting_minutes', state, context()).errorCount).toBe(0);
    rowOf(state, 'meeting-0').values.presentVotingRights = '4';
    expect(checkReview('meeting_minutes', state, context()).rows['meeting-0'].fieldErrors.presentVotingRights).toBeTruthy();
  });
});

describe('buildRowBody / heldShares', () => {
  it('画面に出していない項目は定義の初期値で埋め、画面に無いキーは無視する', () => {
    const state = buildReviewState(investmentExtraction(), context());
    const row = rowOf(state, 'stakeholders-1');
    (row.values as Record<string, unknown>).organizationId = 'other-org';
    (row.values as Record<string, unknown>).email = 'x@example.com';
    const body = buildRowBody(GROUP_SPECS.stakeholders, 'investment_agreement', row, () => null);
    expect(body).toMatchObject({ name: '（株）架空事業会社', kind: 'corporation', relationship: 'investor', email: '', notes: '' });
    expect('organizationId' in body).toBe(false);
  });

  it('参照は渡した関数で id にする', () => {
    const state = buildReviewState(investmentExtraction(), context());
    const body = buildRowBody(GROUP_SPECS.shareTransactions, 'investment_agreement', rowOf(state, 'shareTransactions-1'), (value) => `id-of-${value}`);
    expect(body).toMatchObject({ stakeholderId: 'id-of-new:stakeholders-1', shareClassId: 'id-of-new:shareClasses-0', roundId: 'id-of-new:fundingRound-0', shares: '500' });
  });

  it('その日までの異動を合計する', () => {
    expect(heldShares(context(), ID.founder, ID.common, '2023-04-02')).toBe(0);
    expect(heldShares(context(), ID.founder, ID.common, '2023-04-03')).toBe(800_000);
    expect(heldShares(context(), ID.founder, ID.classA, null)).toBe(0);
  });
});
