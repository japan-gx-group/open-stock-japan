// 差し込み項目の値を、台帳の行（会社情報・会議・議案・出欠・転換型証券の回次・投資）から組み立てる。サーバ依存なし。
//
// 値はすべて文字。台帳に無い値は null にして、文書の中で「【要確認: 項目名】」として残す（fill.ts）。
// 金額と数は、数字だけにする（単位は文面に書く）。日付は、和暦と「（西暦）」の 2 つの名前に入れる。

import { formatDateJa, formatDateWareki, isValidDateText } from '@/lib/equity/format';
import { CAP_BASES, CONVERTIBLE_INSTRUMENT_TYPES } from '@/lib/equity/types';
import { registrationDeadline, RESOLUTION_REQUIREMENTS, type ResolutionType } from '@/lib/legal/rules';
import { AGENDA_RESULTS, MEETING_FORMATS, MEETING_TYPES } from '@/lib/resources/definitions';
import type { ResourceValues } from '@/lib/resources/fields';
import type { TemplateValues } from './fill';
import { needsReviewMark, placeholdersFor, WESTERN_SUFFIX, type PlaceholderScope } from './placeholders';

/** 全角の空白（字下げと、議案の番号と名称のあいだに使う） */
const WIDE_SPACE = '\u3000';

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const numberText = (value: unknown): string | null => {
  const parsed = number(value);
  return parsed == null ? null : parsed.toLocaleString('ja-JP');
};

const dateText = (value: unknown): string | null => {
  const raw = text(value)?.slice(0, 10) ?? null;
  return raw && isValidDateText(raw) ? raw : null;
};

const labelOf = (options: readonly { value: string; label: string }[], value: unknown): string | null =>
  options.find((option) => option.value === value)?.label ?? null;

/** 日付の項目を、和暦の名前と「（西暦）」の名前の両方に入れる */
const setDate = (values: TemplateValues, name: string, value: unknown): void => {
  const date = dateText(value);
  values[name] = date ? formatDateWareki(date) : null;
  values[`${name}${WESTERN_SUFFIX}`] = date ? formatDateJa(date) : null;
};

/** 10:00（または 10:00:00）→ 午前10時00分。正午からの 1 時間は「午後0時」と書く（12:30 → 午後0時30分） */
export const formatTimeJa = (value: unknown): string | null => {
  const match = text(value)?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  if (hour > 23) return null;
  return `${hour < 12 ? '午前' : '午後'}${hour % 12}時${match[2]}分`;
};

const weekdayOf = (date: string): string =>
  new Intl.DateTimeFormat('ja-JP', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** 複数行の文章を、行ごとに全角空白 1 つぶん下げる */
const indent = (value: string): string =>
  value
    .split(/\r?\n/)
    .map((line) => (line.trim() === '' ? '' : `${WIDE_SPACE}${line.trim()}`))
    .join('\n');

// ---- 会社 ----

export const companyValues = (company: ResourceValues | null, today: string): TemplateValues => {
  const values: TemplateValues = {};
  const title = text(company?.representativeTitle);
  const name = text(company?.representativeName);
  values['会社名'] = text(company?.name);
  values['本店所在地'] = text(company?.address);
  values['代表者'] = name ? [title, name].filter(Boolean).join(WIDE_SPACE) : null;
  values['代表者の役職'] = title;
  values['代表者の氏名'] = name;
  setDate(values, '作成日', today);
  return values;
};

// ---- 会議 ----

export interface MeetingValuesInput {
  meeting: ResourceValues;
  agendaItems: readonly ResourceValues[];
  /** 出欠の表の行（株主総会は株主、取締役会は役員） */
  responses: readonly ResourceValues[];
  /** 対象の事業年度の名称（定時株主総会） */
  fiscalYearLabel: string | null;
}

const sortedAgenda = (items: readonly ResourceValues[]): ResourceValues[] =>
  [...items].sort(
    (a, b) =>
      (number(a.sortOrder) ?? 0) - (number(b.sortOrder) ?? 0) ||
      String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')),
  );

const isResolution = (item: ResourceValues): boolean => item.itemType === 'resolution';

/** 議案の名称の先頭に書かれた「第1号議案」（番号を名称に含めて登録している場合）を除く。番号は並び順から振り直す */
const withoutAgendaNumber = (title: string): string =>
  title.replace(/^第[\s\u3000]*[0-9０-９一二三四五六七八九十]+[\s\u3000]*号議案[\s\u3000:：]*/, '').trim();

/** 決議事項に「第1号議案」の番号を振る（報告事項は数えない） */
const numberedResolutions = (items: readonly ResourceValues[]): { item: ResourceValues; heading: string }[] =>
  sortedAgenda(items)
    .filter(isResolution)
    .map((item, index) => {
      const title = text(item.title);
      const name = (title && withoutAgendaNumber(title)) || needsReviewMark('議案の名称');
      return { item, heading: `第${index + 1}号議案${WIDE_SPACE}${name}` };
    });

const resultLine = (item: ResourceValues, board: boolean): string => {
  if (item.result === 'pending' || item.result == null) return `結果: ${needsReviewMark('採決の結果')}`;
  const result = labelOf(AGENDA_RESULTS, item.result) ?? String(item.result);
  const type = typeof item.resolutionType === 'string' ? (item.resolutionType as ResolutionType) : null;
  const requirement = type && Object.hasOwn(RESOLUTION_REQUIREMENTS, type) ? RESOLUTION_REQUIREMENTS[type].label : null;
  const unit = board ? '名' : '個';
  const votes = [
    ['賛成', number(item.votesFor)],
    ['反対', number(item.votesAgainst)],
    ['棄権', number(item.votesAbstain)],
  ]
    .filter((entry): entry is [string, number] => entry[1] != null)
    .map(([label, count]) => `${label} ${count.toLocaleString('ja-JP')} ${unit}`);
  const detail = [requirement, votes.join('、')].filter(Boolean).join('。');
  return `結果: ${result}${detail ? `（${detail}）` : ''}`;
};

export const meetingValues = (input: MeetingValuesInput): TemplateValues => {
  const { meeting, agendaItems, responses } = input;
  const board = meeting.meetingType === 'board';
  const values: TemplateValues = {};

  const heldOn = dateText(meeting.heldOn);
  const startTime = formatTimeJa(meeting.startTime);
  values['会議の名称'] = text(meeting.title);
  values['会議の種類'] = labelOf(MEETING_TYPES, meeting.meetingType);
  setDate(values, '開催日', heldOn);
  values['開催日時'] = heldOn ? `${formatDateWareki(heldOn)}（${weekdayOf(heldOn)}）${startTime ?? ''}` : null;
  values['開始時刻'] = startTime;
  values['開催場所'] = text(meeting.place);
  values['開催方法'] = labelOf(MEETING_FORMATS, meeting.format);
  setDate(values, '招集通知の発送日', meeting.noticeSentOn);
  values['議長'] = text(meeting.chairperson);
  values['議事録の作成者'] = text(meeting.minutesPreparer);
  values['出席した役員'] = text(meeting.attendingOfficers)?.replace(/\s*\n\s*/g, '、') ?? null;

  const ordered = sortedAgenda(agendaItems);
  const reports = ordered.filter((item) => !isResolution(item));
  const resolutions = numberedResolutions(agendaItems);
  // 議案が 1 件も登録されていないうちは、「なし」と書かずに埋めてもらう
  const hasAgenda = ordered.length > 0;
  values['報告事項'] = !hasAgenda
    ? null
    : reports.length === 0
      ? 'なし'
      : reports.map((item, index) => `${index + 1}. ${text(item.title) ?? needsReviewMark('報告事項の名称')}`).join('\n');
  values['決議事項'] = !hasAgenda ? null : resolutions.length === 0 ? 'なし' : resolutions.map(({ heading }) => heading).join('\n');
  values['議案の内容'] =
    resolutions.length === 0
      ? null
      : resolutions
          .map(({ item, heading }) => `${heading}\n${indent(text(item.description) ?? needsReviewMark('議案の内容'))}`)
          .join('\n\n');

  let resolutionIndex = 0;
  values['議案と結果'] = !hasAgenda
    ? null
    : ordered
        .map((item) => {
          const description = text(item.description);
          if (!isResolution(item)) {
            const lines = [`報告事項${WIDE_SPACE}${text(item.title) ?? needsReviewMark('報告事項の名称')}`];
            if (description) lines.push(indent(description));
            lines.push(indent(item.result === 'reported' ? '上記について、報告があった。' : `結果: ${needsReviewMark('報告の結果')}`));
            return lines.join('\n');
          }
          const heading = resolutions[resolutionIndex]?.heading ?? '';
          resolutionIndex += 1;
          const lines = [heading];
          if (description) lines.push(indent(description));
          lines.push(indent(resultLine(item, board)));
          return lines.join('\n');
        })
        .join('\n\n');

  if (board) {
    values['取締役の総数'] = numberText(meeting.totalVotingRights);
    values['出席取締役数'] = numberText(meeting.presentVotingRights);
  } else {
    values['事業年度'] = text(input.fiscalYearLabel);
    setDate(values, '基準日', meeting.recordDate);
    values['株主の総数'] = responses.length > 0 ? responses.length.toLocaleString('ja-JP') : null;
    values['議決権の総数'] = numberText(meeting.totalVotingRights);
    values['出席株主数'] = numberText(meeting.presentShareholders);
    values['出席議決権数'] = numberText(meeting.presentVotingRights);
  }
  return values;
};

// ---- 転換型証券 ----

export interface RoundInvestment {
  investment: ResourceValues;
  /** 投資家（株主・権利者）の行。見つからなければ null */
  stakeholder: ResourceValues | null;
}

/** 0.2 → 「20」、0.125 → 「12.5」（浮動小数の誤差を丸める） */
const trimDecimal = (value: number, digits: number): string => String(Number(value.toFixed(digits)));

export const roundValues = (round: ResourceValues, investments: readonly RoundInvestment[]): TemplateValues => {
  const values: TemplateValues = {};
  const discount = number(round.discountRate);
  const issueDate = dateText(round.issueDate);
  const amounts = investments.map(({ investment }) => number(investment.amount) ?? 0);

  values['回次の名称'] = text(round.name);
  values['証券の種類'] = labelOf(CONVERTIBLE_INSTRUMENT_TYPES, round.instrumentType);
  values['評価上限額'] = numberText(round.valuationCap);
  // 「ポストマネー（J-KISS 2.0）」のかっこ書きは、文書には出さない
  values['評価上限額の基準'] = labelOf(CAP_BASES, round.capBasis)?.replace(/（.*）$/, '') ?? null;
  values['ディスカウント率'] = discount == null ? null : trimDecimal(discount * 100, 4);
  values['転換価額の乗率'] = discount == null ? null : trimDecimal(1 - discount, 6);
  values['適格資金調達の金額'] = numberText(round.qualifiedFinancingAmount);
  setDate(values, '発行日', issueDate);
  setDate(values, '転換期限', round.conversionDeadline);
  setDate(values, '登記の期限', issueDate ? registrationDeadline(issueDate) : null);
  values['投資家の数'] = investments.length > 0 ? investments.length.toLocaleString('ja-JP') : null;
  values['投資額の合計'] = investments.length > 0 ? amounts.reduce((total, amount) => total + amount, 0).toLocaleString('ja-JP') : null;
  values['投資家の一覧'] =
    investments.length === 0
      ? null
      : investments
          .map(({ investment, stakeholder }) => {
            const name = text(stakeholder?.name) ?? needsReviewMark('投資家名');
            const amount = numberText(investment.amount) ?? needsReviewMark('投資額');
            const paidOn = dateText(investment.investmentDate);
            return `${name}${WIDE_SPACE}金${amount}円${paidOn ? `（払込日: ${formatDateWareki(paidOn)}）` : ''}`;
          })
          .join('\n');
  return values;
};

/** 投資家 1 名ぶんの値 */
export const investmentValues = (entry: RoundInvestment): TemplateValues => {
  const values: TemplateValues = {};
  values['投資家名'] = text(entry.stakeholder?.name);
  values['投資家の住所'] = text(entry.stakeholder?.address);
  values['投資額'] = numberText(entry.investment.amount);
  setDate(values, '払込日', entry.investment.investmentDate);
  return values;
};

// ---- 見本・不足の補い ----

/** 一覧の例を値にしたもの（編集の画面で、置き換えたあとの見本を見せる） */
export const sampleValues = (scopes: readonly PlaceholderScope[]): TemplateValues =>
  Object.fromEntries(placeholdersFor(scopes).map((def) => [def.name, def.example]));

/**
 * その種類で使える差し込み項目のうち、値を入れていない名前を null で補う。
 * こうしておくと、「台帳に値が無い」（missing）と「この種類では使えない名前」（unknown）を fillTemplate が区別できる。
 */
export const withAllNames = (values: TemplateValues, scopes: readonly PlaceholderScope[]): TemplateValues => {
  const complete: TemplateValues = { ...values };
  for (const def of placeholdersFor(scopes)) {
    if (!Object.hasOwn(complete, def.name)) complete[def.name] = null;
  }
  return complete;
};
