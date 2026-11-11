// 会社情報・役員の画面で使う表示用の計算。サーバ依存なし。法令の数値は src/lib/legal/rules.ts から取る。

import { formatDateJa, formatNumber, formatYenJa } from '@/lib/equity/format';
import {
  boardMeetingNoticeRule,
  boardProcedureNotes,
  isAuditorCompany,
  LEGAL,
  officerTermEnd,
  officerTermYears,
  registrationDeadline,
  shareholderMeetingNoticeRule,
  type Governance,
} from '@/lib/legal/rules';
import { COMPANY_DEF } from '@/lib/resources/company';
import type { FieldDef, FieldValue, ResourceValues } from '@/lib/resources/fields';

// ---- 会社情報の表示 ----

export interface CompanyFieldGroup {
  title: string;
  description?: string;
  keys: readonly string[];
}

/** 会社情報の読み取り表示のまとまり。COMPANY_DEF の全項目をどれかに入れる（テストで確認） */
export const COMPANY_FIELD_GROUPS: readonly CompanyFieldGroup[] = [
  {
    title: '基本情報',
    keys: [
      'name',
      'nameKana',
      'nameEn',
      'corporateNumber',
      'postalCode',
      'address',
      'phone',
      'website',
      'representativeTitle',
      'representativeName',
      'establishedOn',
      'fiscalYearStartMonth',
      'businessDescription',
    ],
  },
  { title: '資本', keys: ['capitalAmount', 'capitalReserveAmount', 'authorizedShares', 'issuesShareCertificates'] },
  {
    title: '機関設計',
    description: '招集通知の期限・宛先、役員の任期、書面決議の可否の計算に使います。',
    keys: ['isPublicCompany', 'hasTransferRestriction', 'hasBoardOfDirectors', 'hasAuditor', 'auditorLimitedToAccounting'],
  },
  {
    title: '定款の定め',
    description: '空欄の期間・任期は、法定どおりとして計算します。',
    keys: [
      'publicNoticeMethod',
      'recordDateRule',
      'shareholderMeetingNoticeDays',
      'boardMeetingNoticeDays',
      'directorTermYears',
      'auditorTermYears',
      'allowsBoardWrittenResolution',
    ],
  },
];

const STATUTORY_WHEN_EMPTY = ['shareholderMeetingNoticeDays', 'boardMeetingNoticeDays', 'directorTermYears', 'auditorTermYears'];
const UNITS: Record<string, string> = {
  shareholderMeetingNoticeDays: ' 日前まで',
  boardMeetingNoticeDays: ' 日前まで',
  directorTermYears: ' 年',
  auditorTermYears: ' 年',
  authorizedShares: ' 株',
};

/** 会社情報の 1 項目を表示用の文字にする */
export const formatCompanyValue = (field: FieldDef, value: FieldValue | undefined): string => {
  if (field.type === 'boolean') return value === true ? 'はい' : 'いいえ';
  if (value == null || value === '') return STATUTORY_WHEN_EMPTY.includes(field.key) ? '定めなし（法定どおり）' : '—';
  switch (field.type) {
    case 'yen':
      return formatYenJa(Number(value));
    case 'integer':
    case 'decimal':
      return `${formatNumber(Number(value))}${UNITS[field.key] ?? ''}`;
    case 'date':
      return formatDateJa(String(value));
    case 'select':
      return field.options?.find((option) => option.value === String(value))?.label ?? String(value);
    default:
      return String(value);
  }
};

export const companyFieldByKey = (key: string): FieldDef | undefined => COMPANY_DEF.fields.find((field) => field.key === key);

export interface GovernanceFact {
  label: string;
  value: string;
  basis: string | null;
  note: string | null;
}

/** 機関設計と定款の定めから決まること（招集通知の期間・任期・書面決議など） */
export const governanceFacts = (governance: Governance): GovernanceFact[] => {
  const shareholderRule = shareholderMeetingNoticeRule(governance);
  const boardRule = boardMeetingNoticeRule(governance);
  const procedure = boardProcedureNotes(governance);
  const auditorCompany = isAuditorCompany(governance);
  const directorYears = officerTermYears('director', governance);
  const auditorYears = officerTermYears('auditor', governance);
  const termNote = (custom: number | null, effective: number | null, statutory: number): string | null => {
    if (custom == null) return '定款に定めが無いため、法定の任期で計算しています';
    if (effective != null && custom !== effective) {
      return `定款の定め（${custom} 年）は法令の範囲を外れるため、${effective} 年で計算しています（法定 ${statutory} 年。伸長は非公開会社に限り ${LEGAL.maxTermYearsPrivate} 年まで）`;
    }
    return '定款の定めによります';
  };

  const facts: GovernanceFact[] = [
    {
      label: '公開会社か',
      value: governance.isPublicCompany ? '公開会社' : '非公開会社（全部の株式に譲渡制限がある会社）',
      basis: '会社法2条5号',
      note: null,
    },
    {
      label: '監査役設置会社（会社法2条9号）か',
      value: auditorCompany ? '当たります' : '当たりません',
      basis: '会社法2条9号・389条',
      note: !governance.hasAuditor
        ? '監査役を置いていません。'
        : auditorCompany
          ? '監査役が業務監査の権限を持つため、取締役会の招集通知の宛先・書面決議の異議・議事録の閲覧などで監査役設置会社向けの規定が適用されます。'
          : '監査役の監査の範囲を会計に限定しているため、登記上は監査役設置会社でも、会社法2条9号の「監査役設置会社」には含まれません。取締役会の招集通知の宛先や書面決議の要件に監査役は入りません。',
    },
    {
      label: '株主総会の招集通知',
      value: `会日の ${shareholderRule.days} 日前までに発送`,
      basis: shareholderRule.basis,
      note: [
        shareholderRule.note,
        governance.isPublicCompany ? null : `書面または電磁的方法による議決権行使を定めたときは ${LEGAL.shareholderMeetingNoticeDaysPublic} 日前まで`,
      ]
        .filter(Boolean)
        .join('。') || null,
    },
  ];
  if (governance.hasBoardOfDirectors) {
    facts.push(
      {
        label: '取締役会の招集通知',
        value: `会日の ${boardRule.days} 日前までに、${procedure.noticeTo}へ`,
        basis: boardRule.basis,
        note: boardRule.note,
      },
      { label: '取締役会の書面決議', value: governance.allowsBoardWrittenResolution ? '使えます' : '使えません', basis: '会社法370条', note: procedure.writtenResolution },
      {
        label: '取締役会への職務執行状況の報告',
        value: `${LEGAL.boardReportIntervalMonths} か月に 1 回以上`,
        basis: '会社法363条2項',
        note: '書面決議・報告の省略ではできないため、実際に開催する必要があります（会社法372条2項）。',
      },
    );
  }
  if (directorYears != null) {
    facts.push({
      label: '取締役の任期',
      value: `選任後 ${directorYears} 年以内に終了する最終の事業年度に関する定時株主総会の終結の時まで`,
      basis: '会社法332条',
      note: termNote(governance.directorTermYears, directorYears, LEGAL.directorTermYears),
    });
  }
  if (governance.hasAuditor && auditorYears != null) {
    facts.push({
      label: '監査役の任期',
      value: `選任後 ${auditorYears} 年以内に終了する最終の事業年度に関する定時株主総会の終結の時まで`,
      basis: '会社法336条',
      note: termNote(governance.auditorTermYears, auditorYears, LEGAL.auditorTermYears),
    });
  }
  facts.push({
    label: '役員の変更の登記',
    value: `変更が生じた日から ${LEGAL.registrationDeadlineDays} 日以内`,
    basis: '会社法915条1項',
    note: '同じ人が続ける場合（重任）も登記が必要です。',
  });
  return facts;
};

// ---- 役員 ----

export interface OfficerLike {
  id: string;
  name: string;
  position: string;
  appointedOn: string | null;
  termExpiresOn: string | null;
  retiredOn: string | null;
  registeredOn: string | null;
}

export const isActive = (officer: Pick<OfficerLike, 'retiredOn'>, today: string): boolean =>
  officer.retiredOn == null || officer.retiredOn > today;

export interface OfficerTerm {
  /** 任期満了の目安（入力された予定日、または計算した定時株主総会の期限） */
  expiresOn: string | null;
  source: 'manual' | 'computed' | 'none';
  termYears: number | null;
  /** 計算したときの、任期中に終了する最後の事業年度の末日 */
  lastFiscalYearEnd: string | null;
}

/** 任期満了の予定日。入力が無ければ、就任日・任期・事業年度の開始月から計算する */
export const officerTerm = (
  officer: Pick<OfficerLike, 'position' | 'appointedOn' | 'termExpiresOn'>,
  governance: Governance,
  fiscalYearStartMonth: number | null,
): OfficerTerm => {
  const termYears = officerTermYears(officer.position, governance);
  if (officer.termExpiresOn) return { expiresOn: officer.termExpiresOn, source: 'manual', termYears, lastFiscalYearEnd: null };
  if (termYears == null || !officer.appointedOn || fiscalYearStartMonth == null) {
    return { expiresOn: null, source: 'none', termYears, lastFiscalYearEnd: null };
  }
  const end = officerTermEnd(officer.appointedOn, termYears, fiscalYearStartMonth);
  return { expiresOn: end.meetingDeadline, source: 'computed', termYears, lastFiscalYearEnd: end.lastFiscalYearEnd };
};

export type RegistrationState = 'registered' | 'registered_late' | 'overdue' | 'pending' | 'unknown';

export interface OfficerRegistration {
  state: RegistrationState;
  /** 就任の登記の期限。就任日が無ければ null */
  deadline: string | null;
  label: string;
}

/** 就任（重任）の登記の状態。期限は就任日から 2 週間（registrationDeadline） */
export const officerRegistration = (
  officer: Pick<OfficerLike, 'appointedOn' | 'registeredOn'>,
  today: string,
): OfficerRegistration => {
  const deadline = officer.appointedOn ? registrationDeadline(officer.appointedOn) : null;
  if (officer.registeredOn) {
    const late = deadline != null && officer.registeredOn > deadline;
    return { state: late ? 'registered_late' : 'registered', deadline, label: late ? '期限後に登記' : '登記済み' };
  }
  if (deadline == null) return { state: 'unknown', deadline, label: '未登記' };
  if (today > deadline) return { state: 'overdue', deadline, label: '登記の期限超過' };
  return { state: 'pending', deadline, label: '未登記' };
};

export const parseStartMonth = (company: ResourceValues | null | undefined): number | null => {
  const month = Number(company?.fiscalYearStartMonth);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
};

export interface OfficerWarning {
  key: string;
  level: 'warning' | 'info';
  message: string;
}

/** 在任中の役員の構成が、機関設計に合っているか */
export const officerWarnings = (officers: OfficerLike[], governance: Governance, today: string): OfficerWarning[] => {
  const active = officers.filter((officer) => isActive(officer, today));
  const count = (...positions: string[]): number => active.filter((officer) => positions.includes(officer.position)).length;
  const directors = count('director', 'representative_director');
  const representatives = count('representative_director');
  const auditors = count('auditor');
  const accountingAdvisors = count('accounting_advisor');
  const warnings: OfficerWarning[] = [];

  if (governance.hasBoardOfDirectors) {
    if (directors < 3) {
      warnings.push({
        key: 'directors',
        level: 'warning',
        message: `取締役会設置会社の取締役は 3 人以上が必要ですが、在任中の取締役は ${directors} 人です（会社法331条5項）。登録漏れが無いか確かめてください。`,
      });
    }
    if (representatives === 0) {
      warnings.push({
        key: 'representative',
        level: 'warning',
        message: '在任中の代表取締役が登録されていません。取締役会設置会社では、取締役会が取締役の中から代表取締役を選定します（会社法362条2項3号）。',
      });
    }
    if (auditors === 0 && (governance.isPublicCompany || accountingAdvisors === 0)) {
      warnings.push({
        key: 'auditor',
        level: 'warning',
        message: governance.isPublicCompany
          ? '在任中の監査役が登録されていません。取締役会設置会社は、原則として監査役を置く必要があります（会社法327条2項）。'
          : '在任中の監査役も会計参与も登録されていません。取締役会設置会社は原則として監査役を置く必要があり、非公開会社は会計参与を置けば監査役を置かないことができます（会社法327条2項）。',
      });
    }
  } else if (directors === 0) {
    warnings.push({ key: 'no-director', level: 'warning', message: '在任中の取締役が登録されていません。' });
  }
  if (governance.hasAuditor && auditors === 0 && !warnings.some((warning) => warning.key === 'auditor')) {
    warnings.push({
      key: 'auditor-mismatch',
      level: 'info',
      message: '会社情報では監査役設置会社（登記上）ですが、在任中の監査役が登録されていません。',
    });
  }
  if (!governance.hasAuditor && auditors > 0) {
    warnings.push({
      key: 'auditor-unexpected',
      level: 'info',
      message: '在任中の監査役が登録されていますが、会社情報では監査役を置かない会社になっています。会社情報を確かめてください。',
    });
  }
  return warnings;
};
