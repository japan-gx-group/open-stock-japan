// 決算情報の画面に出す、法令上の手続きの覚え書き。サーバ依存なし。
// 期限・日数は src/lib/legal/rules.ts の関数・定数から作る（数値をここに直接書かない）。
// 根拠の整理は docs/legal/06-financial-disclosure.md。

import { addYears, formatDateJa } from '@/lib/equity/format';
import {
  annualMeetingDeadline,
  corporateTaxReturnDeadline,
  financialStatementsDisplayStart,
  LEGAL,
  type Governance,
} from '@/lib/legal/rules';

export interface LegalNote {
  key: string;
  title: string;
  body: string;
  basis: string;
  /** 計算できた日付（期限・開始日）。YYYY-MM-DD */
  date: string | null;
  dateLabel: string | null;
}

const weeksOrDays = (days: number): string => (days % 7 === 0 ? `${days / 7} 週間` : `${days} 日`);

/**
 * fiscalYearEnd: 通期の決算の期間の終了日（事業年度の末日）。分からなければ null（日付なしの説明だけを返す）。
 * meetingOn: 計算書類を承認した（する）定時株主総会の開催日。
 */
export const buildLegalNotes = (fiscalYearEnd: string | null, governance: Governance, meetingOn: string | null): LegalNote[] => {
  const displayDays = governance.hasBoardOfDirectors ? LEGAL.financialStatementsDisplayDaysBoard : LEGAL.financialStatementsDisplayDaysNoBoard;
  const displayStart = meetingOn ? financialStatementsDisplayStart(meetingOn, governance) : null;
  const displayEnd = displayStart ? addYears(displayStart, LEGAL.financialStatementsRetentionYears) : null;

  return [
    {
      key: 'approval',
      title: '計算書類の承認',
      body: `計算書類は定時株主総会の承認を受け、事業報告は内容を報告します${governance.hasBoardOfDirectors ? '（取締役会設置会社は、その前に取締役会の承認が必要です）' : ''}。定時株主総会は、基準日を事業年度の末日とする場合、末日から ${LEGAL.recordDateMaxMonths} か月以内に開きます。`,
      basis: '会社法438条・436条3項・124条2項',
      date: fiscalYearEnd ? annualMeetingDeadline(fiscalYearEnd) : null,
      dateLabel: '定時株主総会の期限の目安',
    },
    {
      key: 'display',
      title: '計算書類等の備置き',
      body: `計算書類・事業報告・附属明細書（監査報告を含む）を、定時株主総会の ${weeksOrDays(displayDays)}前の日から ${LEGAL.financialStatementsRetentionYears} 年間、本店に備え置きます。株主と債権者は、営業時間内はいつでも閲覧を請求できます。${
        displayStart && displayEnd ? `この決算では ${formatDateJa(displayEnd)} まで備え置きます。` : ''
      }`,
      basis: '会社法442条',
      date: displayStart,
      dateLabel: '備置きを始める日',
    },
    {
      key: 'public_notice',
      title: '決算公告',
      body: '定時株主総会の終結後、遅滞なく貸借対照表（大会社は貸借対照表と損益計算書）を公告します。公告の方法は定款の定め（官報・日刊新聞紙・電子公告）によります。',
      basis: '会社法440条1項',
      date: null,
      dateLabel: null,
    },
    {
      key: 'tax_return',
      title: '法人税の確定申告',
      body: `法人税の確定申告と納付の期限は、事業年度終了の日の翌日から ${LEGAL.corporateTaxReturnMonths} か月以内です（申告期限の延長の特例を受けている場合を除く）。期限が休日に当たる場合の扱いなどは税理士に確認してください。`,
      basis: '法人税法74条1項',
      date: fiscalYearEnd ? corporateTaxReturnDeadline(fiscalYearEnd) : null,
      dateLabel: '申告・納付の期限',
    },
  ];
};
