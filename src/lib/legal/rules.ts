// 会社法などの期限・要件を計算に落としたもの。サーバ依存なし。
//
// ここにある数値の根拠と確認状況は docs/legal/rules.md にまとめてある。法改正で数値が変わったら、
// docs/legal/rules.md とこのファイルの定数を同時に直すこと。
// この計算は実務の目安であり、個別の判断（定款の定め・株主間契約・税務）は専門家に確認する前提。

import { addDays, addMonths, addYears, endOfMonth } from '@/lib/equity/format';

/** 機関設計と定款の定め（organizations の列） */
export interface Governance {
  isPublicCompany: boolean;
  hasBoardOfDirectors: boolean;
  hasAuditor: boolean;
  /** 監査役の監査の範囲を会計に限定しているか（会社法389条）。限定している会社は「監査役設置会社」に当たらない */
  auditorLimitedToAccounting: boolean;
  /** 定款で定めた株主総会の招集通知の期間（日）。null は法定どおり */
  shareholderMeetingNoticeDays: number | null;
  /** 定款で定めた取締役会の招集通知の期間（日）。null は法定どおり */
  boardMeetingNoticeDays: number | null;
  /** 定款で定めた取締役・監査役の任期（年）。null は法定どおり */
  directorTermYears: number | null;
  auditorTermYears: number | null;
  /** 取締役会の書面決議（会社法370条）を定款で認めているか */
  allowsBoardWrittenResolution: boolean;
}

export const DEFAULT_GOVERNANCE: Governance = {
  isPublicCompany: false,
  hasBoardOfDirectors: true,
  hasAuditor: true,
  auditorLimitedToAccounting: false,
  shareholderMeetingNoticeDays: null,
  boardMeetingNoticeDays: null,
  directorTermYears: null,
  auditorTermYears: null,
  allowsBoardWrittenResolution: false,
};

export const LEGAL = {
  /** 株主総会の招集通知: 公開会社、または書面・電磁的方法による議決権行使を定めた場合（会社法299条1項） */
  shareholderMeetingNoticeDaysPublic: 14,
  /** 株主総会の招集通知: 非公開会社（会社法299条1項かっこ書） */
  shareholderMeetingNoticeDaysPrivate: 7,
  /** 取締役会の招集通知（会社法368条1項。定款で短縮できる） */
  boardMeetingNoticeDays: 7,
  /** 基準日から権利行使までの上限（会社法124条2項） */
  recordDateMaxMonths: 3,
  /** 基準日の公告: 基準日の何日前までか（会社法124条3項。定款に定めがあれば不要） */
  recordDatePublicNoticeDays: 14,
  /** 変更の登記の期限（会社法915条1項） */
  registrationDeadlineDays: 14,
  /** 取締役会設置会社の取締役の最低員数（会社法331条5項） */
  boardMinDirectors: 3,
  /** 取締役の職務執行状況の報告の間隔（会社法363条2項） */
  boardReportIntervalMonths: 3,
  /** 取締役・監査役の法定任期（会社法332条1項・336条1項）と、非公開会社が定款で伸長できる上限（332条2項・336条2項） */
  directorTermYears: 2,
  auditorTermYears: 4,
  maxTermYearsPrivate: 10,
  /** 株主総会議事録・取締役会議事録の本店での備置き（会社法318条2項・371条1項） */
  minutesRetentionYears: 10,
  /** 計算書類等の本店での備置き（会社法442条1項1号） */
  financialStatementsRetentionYears: 5,
  /** 計算書類等の備置きの開始: 定時株主総会の何日前からか（会社法442条1項1号。取締役会設置会社は 2 週間前） */
  financialStatementsDisplayDaysBoard: 14,
  financialStatementsDisplayDaysNoBoard: 7,
  /** 法人税の確定申告の期限: 事業年度終了の日の翌日から（法人税法74条1項） */
  corporateTaxReturnMonths: 2,
  /** 登録免許税: 増資は増加する資本金の額の 1000 分の 7、最低 3 万円（登録免許税法 別表第一 24(一)ニ） */
  capitalIncreaseRegistrationTaxRate: 0.007,
  capitalIncreaseRegistrationTaxMinimum: 30_000,
} as const;

// ---- 期限の計算 ----

/**
 * 「会日の n 日前までに通知を発する」の最終発送日。
 * 発送日の翌日から会日の前日までに丸 n 日が必要（初日不算入・民法140条）。会日 6/27・2 週間前 → 6/12。
 */
export const noticeDeadline = (heldOn: string, days: number): string => addDays(heldOn, -(days + 1));

export interface NoticeRule {
  days: number;
  basis: string;
  /** 定款の定めを使った場合など、利用者に伝える補足 */
  note: string | null;
}

/** 株主総会の招集通知を発する期限の日数（会社法299条1項） */
export const shareholderMeetingNoticeRule = (
  governance: Governance,
  options: { writtenOrElectronicVoting?: boolean } = {},
): NoticeRule => {
  if (governance.isPublicCompany) {
    return { days: LEGAL.shareholderMeetingNoticeDaysPublic, basis: '会社法299条1項', note: '公開会社は 2 週間前まで' };
  }
  if (options.writtenOrElectronicVoting) {
    return {
      days: LEGAL.shareholderMeetingNoticeDaysPublic,
      basis: '会社法299条1項',
      note: '書面または電磁的方法による議決権行使を定めたときは 2 週間前まで',
    };
  }
  const statutory = LEGAL.shareholderMeetingNoticeDaysPrivate;
  const custom = governance.shareholderMeetingNoticeDays;
  // 1 週間を下回る期間を定款で定められるのは取締役会を置かない会社だけ
  if (custom != null && custom < statutory) {
    if (!governance.hasBoardOfDirectors) {
      return { days: custom, basis: '会社法299条1項かっこ書', note: `定款の定めにより ${custom} 日前まで（取締役会を置かない会社）` };
    }
    return {
      days: statutory,
      basis: '会社法299条1項',
      note: '取締役会設置会社は定款でも 1 週間より短くできないため、法定の 1 週間で計算しています',
    };
  }
  if (custom != null && custom > statutory) {
    return { days: custom, basis: '定款', note: `定款の定めにより ${custom} 日前まで` };
  }
  return { days: statutory, basis: '会社法299条1項', note: '非公開会社は 1 週間前まで' };
};

/** 取締役会の招集通知を発する期限の日数（会社法368条1項） */
export const boardMeetingNoticeRule = (governance: Governance): NoticeRule => {
  const custom = governance.boardMeetingNoticeDays;
  if (custom != null && custom !== LEGAL.boardMeetingNoticeDays) {
    return { days: custom, basis: '会社法368条1項かっこ書', note: `定款の定めにより ${custom} 日前まで` };
  }
  return { days: LEGAL.boardMeetingNoticeDays, basis: '会社法368条1項', note: null };
};

/** 基準日が有効か（権利行使日が基準日から 3 か月以内。会社法124条2項） */
export const isRecordDateValid = (recordDate: string, exerciseDate: string): boolean =>
  recordDate <= exerciseDate && exerciseDate <= addMonths(recordDate, LEGAL.recordDateMaxMonths);

/** 変更の登記の期限（変更が生じた日から 2 週間以内。初日不算入） */
export const registrationDeadline = (changedOn: string): string => addDays(changedOn, LEGAL.registrationDeadlineDays);

/** 新株予約権の行使による変更の登記の期限（行使があった月の末日から 2 週間以内。会社法915条3項1号） */
export const optionExerciseRegistrationDeadline = (exercisedOn: string): string =>
  addDays(endOfMonth(exercisedOn), LEGAL.registrationDeadlineDays);

/** 事業年度末日から見た定時株主総会の期限の目安（基準日を事業年度末日とする定款の定めが一般的。124条2項の 3 か月） */
export const annualMeetingDeadline = (fiscalYearEnd: string): string => addMonths(fiscalYearEnd, LEGAL.recordDateMaxMonths);

/** 法人税の確定申告・納付の期限（事業年度終了の日の翌日から 2 か月以内。申告期限の延長の特例は見ない） */
export const corporateTaxReturnDeadline = (fiscalYearEnd: string): string =>
  addMonths(fiscalYearEnd, LEGAL.corporateTaxReturnMonths);

/** 計算書類等の備置きを始める日（定時株主総会の日の 2 週間前。取締役会を置かない会社は 1 週間前） */
export const financialStatementsDisplayStart = (meetingOn: string, governance: Governance): string =>
  addDays(
    meetingOn,
    -(governance.hasBoardOfDirectors
      ? LEGAL.financialStatementsDisplayDaysBoard
      : LEGAL.financialStatementsDisplayDaysNoBoard),
  );

/**
 * 役員の任期が満了する定時株主総会の期限の目安。
 * 任期は「選任後 n 年以内に終了する事業年度のうち最終のものに関する定時株主総会の終結の時まで」（会社法332条・336条）。
 * 選任日から n 年以内に終了する最後の事業年度末日を求め、その 3 か月後を総会の期限として返す。
 */
export const officerTermEnd = (
  appointedOn: string,
  termYears: number,
  fiscalYearStartMonth: number,
): { lastFiscalYearEnd: string; meetingDeadline: string } => {
  const limit = addYears(appointedOn, termYears);
  // 事業年度末日 = 期首月の前月の末日
  const endMonth = fiscalYearStartMonth === 1 ? 12 : fiscalYearStartMonth - 1;
  const limitYear = Number(limit.slice(0, 4));
  let candidate = endOfMonth(`${limitYear}-${String(endMonth).padStart(2, '0')}-01`);
  if (candidate > limit) candidate = endOfMonth(`${limitYear - 1}-${String(endMonth).padStart(2, '0')}-01`);
  return { lastFiscalYearEnd: candidate, meetingDeadline: annualMeetingDeadline(candidate) };
};

export const officerTermYears = (position: string, governance: Governance): number | null => {
  const clamp = (custom: number | null, statutory: number): number => {
    if (custom == null) return statutory;
    // 伸長（最長 10 年）は非公開会社だけ。取締役の短縮は公開・非公開とも可、監査役の短縮は不可。
    const max = governance.isPublicCompany ? statutory : LEGAL.maxTermYearsPrivate;
    return Math.min(custom, max);
  };
  if (position === 'director' || position === 'representative_director') {
    return clamp(governance.directorTermYears, LEGAL.directorTermYears);
  }
  if (position === 'auditor') {
    return Math.max(LEGAL.auditorTermYears, clamp(governance.auditorTermYears, LEGAL.auditorTermYears));
  }
  return null;
};

// ---- 資本金 ----

/** 払込金額のうち資本金に計上する最低額（2 分の 1 以上。残りは資本準備金。会社法445条1項〜3項） */
export const minimumCapitalIncrease = (paidInAmount: number): number => Math.ceil(paidInAmount / 2);

/** 増資の登記の登録免許税（増加する資本金の額 × 0.7%、最低 3 万円。100 円未満切り捨て） */
export const capitalIncreaseRegistrationTax = (capitalIncrease: number): number =>
  Math.max(
    LEGAL.capitalIncreaseRegistrationTaxMinimum,
    Math.floor((capitalIncrease * LEGAL.capitalIncreaseRegistrationTaxRate) / 100) * 100,
  );

// ---- 決議要件 ----

export type ResolutionType =
  | 'ordinary'
  | 'special'
  | 'extraordinary_309_3'
  | 'extraordinary_309_4'
  | 'unanimous'
  | 'board';

export interface ResolutionRequirement {
  label: string;
  basis: string;
  quorum: string;
  threshold: string;
  examples: string;
}

export const RESOLUTION_REQUIREMENTS: Record<ResolutionType, ResolutionRequirement> = {
  ordinary: {
    label: '普通決議',
    basis: '会社法309条1項',
    quorum: '議決権を行使できる株主の議決権の過半数を有する株主の出席（定款で排除できる。役員の選任・解任は 3 分の 1 未満にできない: 341条）',
    threshold: '出席株主の議決権の過半数',
    examples: '計算書類の承認、役員の選任、役員報酬、剰余金の配当',
  },
  special: {
    label: '特別決議',
    basis: '会社法309条2項',
    quorum: '議決権を行使できる株主の議決権の過半数を有する株主の出席（定款で 3 分の 1 まで引き下げできる）',
    threshold: '出席株主の議決権の 3 分の 2 以上（定款で引き上げできる）',
    examples: '定款変更、募集株式・新株予約権の発行（非公開会社）、合併・会社分割、解散、監査役の解任、特定の株主からの自己株式取得',
  },
  extraordinary_309_3: {
    label: '特殊決議（309条3項）',
    basis: '会社法309条3項',
    quorum: '定足数の定めなし',
    threshold: '議決権を行使できる株主の半数以上（頭数）、かつ、その議決権の 3 分の 2 以上',
    examples: '全部の株式に譲渡制限を付ける定款変更',
  },
  extraordinary_309_4: {
    label: '特殊決議（309条4項）',
    basis: '会社法309条4項',
    quorum: '定足数の定めなし',
    threshold: '総株主の半数以上（頭数）、かつ、総株主の議決権の 4 分の 3 以上',
    examples: '非公開会社で、剰余金の配当・残余財産の分配・議決権について株主ごとに異なる取扱いをする定款変更',
  },
  unanimous: {
    label: '総株主の同意',
    basis: '会社法319条1項ほか',
    quorum: '—',
    threshold: '議決権を行使できる株主の全員の同意',
    examples: '書面決議（319条）、招集手続の省略（300条）、取得条項の追加（110条）',
  },
  board: {
    label: '取締役会決議',
    basis: '会社法369条1項',
    quorum: '議決に加わることができる取締役の過半数の出席（定款で引き上げできる）',
    threshold: '出席取締役の過半数（特別の利害関係を有する取締役は議決に加われない: 369条2項）',
    examples: '重要な財産の処分、多額の借財、株主総会の招集、譲渡制限株式の譲渡承認、代表取締役の選定',
  },
};

export interface ResolutionInput {
  /** 議決権を行使できる株主の議決権の総数（取締役会では議決に加わることができる取締役の数） */
  totalVotes: number | null;
  /** 出席（委任状・書面投票を含む）した議決権の数（取締役会では出席取締役の数） */
  presentVotes: number | null;
  votesFor: number | null;
  /** 頭数（309条3項・4項だけで使う） */
  totalHolders?: number | null;
  holdersFor?: number | null;
  /** 定款で定足数を変えている場合の割合（0〜1）。null は法定 */
  quorumRatio?: number | null;
}

export interface ResolutionEvaluation {
  /** null は「数字が足りず判定できない」 */
  quorumMet: boolean | null;
  approved: boolean | null;
  /** 可決に必要な賛成の数（判定できないときは null） */
  requiredFor: number | null;
  message: string;
}

const strictlyMoreThanHalf = (total: number): number => Math.floor(total / 2) + 1;
const atLeastFraction = (total: number, numerator: number, denominator: number): number =>
  Math.ceil((total * numerator) / denominator - 1e-9);

/** 入力された議決権の数から、定足数と可決を判定する */
export const evaluateResolution = (type: ResolutionType, input: ResolutionInput): ResolutionEvaluation => {
  const { totalVotes, presentVotes, votesFor } = input;
  const unknown = (message: string): ResolutionEvaluation => ({ quorumMet: null, approved: null, requiredFor: null, message });

  if (type === 'unanimous') {
    if (totalVotes == null || votesFor == null) return unknown('議決権の総数と同意の数を入力すると判定します');
    const approved = totalVotes > 0 && votesFor >= totalVotes;
    return {
      quorumMet: true,
      approved,
      requiredFor: totalVotes,
      message: approved ? '全員の同意があります' : `全員の同意が必要です（あと ${(totalVotes - votesFor).toLocaleString('ja-JP')}）`,
    };
  }

  if (type === 'extraordinary_309_3' || type === 'extraordinary_309_4') {
    const { totalHolders, holdersFor } = input;
    if (totalVotes == null || votesFor == null || totalHolders == null || holdersFor == null) {
      return unknown('株主の人数（総数・賛成）と議決権の数（総数・賛成）を入力すると判定します');
    }
    const requiredHolders = Math.ceil(totalHolders / 2);
    const requiredFor =
      type === 'extraordinary_309_3' ? atLeastFraction(totalVotes, 2, 3) : atLeastFraction(totalVotes, 3, 4);
    const approved = holdersFor >= requiredHolders && votesFor >= requiredFor;
    return {
      quorumMet: true,
      approved,
      requiredFor,
      message: approved
        ? '要件を満たしています'
        : `株主 ${requiredHolders.toLocaleString('ja-JP')} 人以上、かつ議決権 ${requiredFor.toLocaleString('ja-JP')} 個以上の賛成が必要です`,
    };
  }

  if (totalVotes == null || presentVotes == null) {
    return unknown(type === 'board' ? '取締役の総数と出席した取締役の数を入力すると判定します' : '議決権の総数と出席の数を入力すると判定します');
  }
  const quorumRatio = input.quorumRatio ?? null;
  const requiredPresent =
    quorumRatio != null ? atLeastFraction(totalVotes, Math.round(quorumRatio * 1_000_000), 1_000_000) : strictlyMoreThanHalf(totalVotes);
  const quorumMet = presentVotes >= requiredPresent;
  const requiredFor = type === 'special' ? atLeastFraction(presentVotes, 2, 3) : strictlyMoreThanHalf(presentVotes);
  if (!quorumMet) {
    return {
      quorumMet,
      approved: false,
      requiredFor,
      message: `定足数を満たしていません（出席 ${requiredPresent.toLocaleString('ja-JP')} 以上が必要）`,
    };
  }
  if (votesFor == null) {
    return { quorumMet, approved: null, requiredFor, message: `可決には賛成 ${requiredFor.toLocaleString('ja-JP')} 以上が必要です` };
  }
  const approved = votesFor >= requiredFor;
  return {
    quorumMet,
    approved,
    requiredFor,
    message: approved ? '可決の要件を満たしています' : `可決には賛成 ${requiredFor.toLocaleString('ja-JP')} 以上が必要です`,
  };
};

/** 会社法2条9号の「監査役設置会社」か（業務監査の権限を持つ監査役がいるか） */
export const isAuditorCompany = (governance: Governance): boolean =>
  governance.hasAuditor && !governance.auditorLimitedToAccounting;

/** 取締役会の招集通知の宛先と、書面決議（370条）の要件を文章で返す */
export const boardProcedureNotes = (governance: Governance): { noticeTo: string; writtenResolution: string } => {
  const auditorCompany = isAuditorCompany(governance);
  return {
    noticeTo: auditorCompany ? '各取締役および各監査役' : '各取締役',
    writtenResolution: !governance.allowsBoardWrittenResolution
      ? '定款に書面決議を認める定めが無いため、取締役会の書面決議（会社法370条）は使えません。'
      : auditorCompany
        ? '議決に加わることができる取締役の全員が書面または電磁的記録で同意し、監査役が異議を述べなければ、決議があったものとみなされます（会社法370条）。'
        : '議決に加わることができる取締役の全員が書面または電磁的記録で同意すれば、決議があったものとみなされます（会社法370条）。',
  };
};
