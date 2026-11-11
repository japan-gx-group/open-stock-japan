import { describe, expect, it } from 'vitest';
import { DEFAULT_GOVERNANCE, type Governance } from '@/lib/legal/rules';
import { COMPANY_DEF } from '@/lib/resources/company';
import {
  COMPANY_FIELD_GROUPS,
  companyFieldByKey,
  formatCompanyValue,
  governanceFacts,
  officerRegistration,
  officerTerm,
  officerWarnings,
  parseStartMonth,
  type OfficerLike,
} from '../companyFacts';

const governance: Governance = { ...DEFAULT_GOVERNANCE };

describe('COMPANY_FIELD_GROUPS', () => {
  it('会社情報の全項目を、重複なくどれかのまとまりに入れている', () => {
    const keys = COMPANY_FIELD_GROUPS.flatMap((group) => group.keys);
    expect([...keys].sort()).toEqual(COMPANY_DEF.fields.map((field) => field.key).sort());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('formatCompanyValue', () => {
  const format = (key: string, value: string | number | boolean | null) => formatCompanyValue(companyFieldByKey(key)!, value);

  it('種類ごとに表示用の文字にする', () => {
    expect(format('capitalAmount', 50_000_000)).toBe('5,000万円');
    expect(format('authorizedShares', 10_000_000)).toBe('10,000,000 株');
    expect(format('isPublicCompany', false)).toBe('いいえ');
    expect(format('hasBoardOfDirectors', true)).toBe('はい');
    expect(format('establishedOn', '2023-04-03')).toBe('2023年4月3日');
    expect(format('fiscalYearStartMonth', 4)).toBe('4月');
    expect(format('publicNoticeMethod', 'electronic')).toBe('電子公告');
    expect(format('nameEn', null)).toBe('—');
  });

  it('定款の期間・任期が空なら法定どおりと書く', () => {
    expect(format('boardMeetingNoticeDays', null)).toBe('定めなし（法定どおり）');
    expect(format('boardMeetingNoticeDays', 3)).toBe('3 日前まで');
    expect(format('directorTermYears', 10)).toBe('10 年');
  });
});

describe('governanceFacts', () => {
  const byLabel = (gov: Governance) => new Map(governanceFacts(gov).map((fact) => [fact.label, fact]));

  it('非公開・取締役会設置・監査役設置（法定どおり）', () => {
    const facts = byLabel(governance);
    expect(facts.get('株主総会の招集通知')?.value).toBe('会日の 7 日前までに発送');
    expect(facts.get('取締役会の招集通知')?.value).toBe('会日の 7 日前までに、各取締役および各監査役へ');
    expect(facts.get('取締役会の書面決議')?.value).toBe('使えません');
    expect(facts.get('監査役設置会社（会社法2条9号）か')?.value).toBe('当たります');
    expect(facts.get('取締役の任期')?.value).toContain('選任後 2 年以内');
    expect(facts.get('監査役の任期')?.value).toContain('選任後 4 年以内');
    expect(facts.get('役員の変更の登記')?.value).toBe('変更が生じた日から 14 日以内');
  });

  it('会計限定の監査役は 2条9号の監査役設置会社に当たらず、通知の宛先は取締役だけ', () => {
    const facts = byLabel({ ...governance, auditorLimitedToAccounting: true, boardMeetingNoticeDays: 3, allowsBoardWrittenResolution: true });
    expect(facts.get('監査役設置会社（会社法2条9号）か')?.value).toBe('当たりません');
    expect(facts.get('取締役会の招集通知')?.value).toBe('会日の 3 日前までに、各取締役へ');
    expect(facts.get('取締役会の書面決議')?.value).toBe('使えます');
  });

  it('取締役会を置かない会社には取締役会の項目を出さない', () => {
    const facts = byLabel({ ...governance, hasBoardOfDirectors: false, hasAuditor: false });
    expect(facts.has('取締役会の招集通知')).toBe(false);
    expect(facts.has('監査役の任期')).toBe(false);
  });

  it('定款の任期が法令の範囲を外れるときは、計算に使う年数を示す', () => {
    const facts = byLabel({ ...governance, isPublicCompany: true, directorTermYears: 10 });
    expect(facts.get('取締役の任期')?.value).toContain('選任後 2 年以内');
    expect(facts.get('取締役の任期')?.note).toContain('2 年で計算しています');
    expect(facts.get('株主総会の招集通知')?.value).toBe('会日の 14 日前までに発送');
  });
});

describe('officerTerm', () => {
  it('入力された予定日を優先する', () => {
    expect(officerTerm({ position: 'director', appointedOn: '2025-06-27', termExpiresOn: '2027-06-30' }, governance, 4)).toMatchObject({
      expiresOn: '2027-06-30',
      source: 'manual',
    });
  });

  it('就任日・任期・事業年度から計算する（3 月決算、2025-06-27 就任の取締役 → 2027-03-31 の期の総会）', () => {
    expect(officerTerm({ position: 'director', appointedOn: '2025-06-27', termExpiresOn: null }, governance, 4)).toEqual({
      expiresOn: '2027-06-30',
      source: 'computed',
      termYears: 2,
      lastFiscalYearEnd: '2027-03-31',
    });
    expect(officerTerm({ position: 'auditor', appointedOn: '2023-04-03', termExpiresOn: null }, governance, 4).lastFiscalYearEnd).toBe('2027-03-31');
  });

  it('事業年度の開始月・就任日が無い、任期の無い役職は計算しない', () => {
    expect(officerTerm({ position: 'director', appointedOn: '2025-06-27', termExpiresOn: null }, governance, null).source).toBe('none');
    expect(officerTerm({ position: 'director', appointedOn: null, termExpiresOn: null }, governance, 4).source).toBe('none');
    expect(officerTerm({ position: 'executive_officer', appointedOn: '2025-06-27', termExpiresOn: null }, governance, 4)).toMatchObject({ source: 'none', termYears: null });
  });
});

describe('officerRegistration', () => {
  it('就任日から 2 週間の期限と比べる', () => {
    expect(officerRegistration({ appointedOn: '2025-06-27', registeredOn: '2025-07-04' }, '2026-01-01')).toMatchObject({ state: 'registered', deadline: '2025-07-11' });
    expect(officerRegistration({ appointedOn: '2025-06-27', registeredOn: '2025-07-12' }, '2026-01-01').state).toBe('registered_late');
    expect(officerRegistration({ appointedOn: '2025-06-27', registeredOn: null }, '2025-07-11').state).toBe('pending');
    expect(officerRegistration({ appointedOn: '2025-06-27', registeredOn: null }, '2025-07-12').state).toBe('overdue');
    expect(officerRegistration({ appointedOn: null, registeredOn: null }, '2025-07-12').state).toBe('unknown');
  });
});

describe('parseStartMonth', () => {
  it('1〜12 だけを受け付ける', () => {
    expect(parseStartMonth({ fiscalYearStartMonth: 4 })).toBe(4);
    expect(parseStartMonth({ fiscalYearStartMonth: '10' })).toBe(10);
    expect(parseStartMonth({ fiscalYearStartMonth: null })).toBeNull();
    expect(parseStartMonth({ fiscalYearStartMonth: 13 })).toBeNull();
    expect(parseStartMonth(null)).toBeNull();
  });
});

describe('officerWarnings', () => {
  const officer = (id: string, position: string, retiredOn: string | null = null): OfficerLike => ({
    id,
    name: id,
    position,
    appointedOn: '2025-06-27',
    termExpiresOn: null,
    retiredOn,
    registeredOn: null,
  });
  const keys = (officers: OfficerLike[], gov: Governance = governance) => officerWarnings(officers, gov, '2026-11-11').map((warning) => warning.key);
  const full = [officer('r', 'representative_director'), officer('d1', 'director'), officer('d2', 'director'), officer('a', 'auditor')];

  it('構成が合っていれば注意は無い', () => {
    expect(keys(full)).toEqual([]);
  });

  it('取締役会設置会社で取締役が 3 人未満・代表取締役なしを注意する（退任者は数えない）', () => {
    expect(keys([officer('r', 'representative_director'), officer('d1', 'director'), officer('d2', 'director', '2026-06-26'), officer('a', 'auditor')])).toEqual(['directors']);
    expect(keys([officer('d0', 'director'), officer('d1', 'director'), officer('d2', 'director'), officer('a', 'auditor')])).toEqual(['representative']);
  });

  it('取締役会設置会社で監査役がいない: 非公開会社は会計参与がいれば注意しない', () => {
    const withoutAuditor = full.filter((row) => row.position !== 'auditor');
    const noAuditorGov = { ...governance, hasAuditor: false };
    expect(keys(withoutAuditor, noAuditorGov)).toEqual(['auditor']);
    expect(keys([...withoutAuditor, officer('c', 'accounting_advisor')], noAuditorGov)).toEqual([]);
    expect(keys([...withoutAuditor, officer('c', 'accounting_advisor')], { ...noAuditorGov, isPublicCompany: true })).toEqual(['auditor']);
  });

  it('取締役会を置かない会社には人数の注意を出さない', () => {
    const gov = { ...governance, hasBoardOfDirectors: false, hasAuditor: false };
    expect(keys([officer('d', 'director')], gov)).toEqual([]);
    expect(keys([], gov)).toEqual(['no-director']);
  });

  it('会社情報と役員の登録の食い違いを知らせる', () => {
    const gov = { ...governance, hasBoardOfDirectors: false };
    expect(keys([officer('d', 'director')], gov)).toEqual(['auditor-mismatch']);
    expect(keys([officer('d', 'director'), officer('a', 'auditor')], { ...gov, hasAuditor: false })).toEqual(['auditor-unexpected']);
  });
});
