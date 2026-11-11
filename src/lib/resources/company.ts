// 会社情報（organizations）の項目定義。サーバ依存なし。1 組織 1 行で、変更は管理者だけ（/api/company）。
// 機関設計と定款の定めは、招集通知の期限・役員の任期・書面決議の可否の計算（src/lib/legal/rules.ts）に使う。

import type { Governance } from '@/lib/legal/rules';
import type { ResourceDef, ResourceValues } from './fields';

export const PUBLIC_NOTICE_METHODS = [
  { value: 'official_gazette', label: '官報' },
  { value: 'newspaper', label: '日刊新聞紙' },
  { value: 'electronic', label: '電子公告' },
] as const;

const MONTHS = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}月` }));

export const COMPANY_DEF: ResourceDef = {
  name: 'company',
  table: 'organizations',
  label: '会社情報',
  formNote: '登記事項証明書（履歴事項全部証明書）と定款のとおりに入力してください。機関設計と定款の定めは、招集通知の期限や役員の任期の計算に使います。',
  fields: [
    { key: 'name', label: '商号', type: 'text', required: true, maxLength: 200 },
    { key: 'nameKana', label: '商号（フリガナ）', type: 'text', maxLength: 200, nullable: true },
    { key: 'nameEn', label: '英文商号', type: 'text', maxLength: 200, nullable: true },
    { key: 'corporateNumber', label: '法人番号（13 桁）', type: 'text', maxLength: 13, nullable: true },
    { key: 'postalCode', label: '郵便番号', type: 'text', maxLength: 8, nullable: true },
    { key: 'address', label: '本店所在地', type: 'text', maxLength: 255, nullable: true, width: 'full' },
    { key: 'phone', label: '電話番号', type: 'text', maxLength: 20, nullable: true },
    { key: 'website', label: 'ウェブサイト', type: 'text', maxLength: 255, nullable: true },
    { key: 'representativeName', label: '代表者の氏名', type: 'text', maxLength: 100, nullable: true },
    { key: 'representativeTitle', label: '代表者の役職', type: 'text', maxLength: 100, nullable: true, placeholder: '代表取締役' },
    { key: 'establishedOn', label: '会社成立の年月日（設立日）', type: 'date', help: '税制適格ストックオプションの年間上限・行使期間の判定に使います' },
    { key: 'fiscalYearStartMonth', label: '事業年度の開始月', type: 'select', options: MONTHS, help: '3 月決算なら 4 月' },
    { key: 'capitalAmount', label: '資本金の額', type: 'yen', min: 0 },
    { key: 'capitalReserveAmount', label: '資本準備金の額', type: 'yen', min: 0 },
    { key: 'authorizedShares', label: '発行可能株式総数', type: 'integer', min: 1 },
    { key: 'publicNoticeMethod', label: '公告方法', type: 'select', options: PUBLIC_NOTICE_METHODS, help: '定款に定めが無ければ官報です（会社法939条4項）' },
    { key: 'isPublicCompany', label: '公開会社（譲渡制限の無い株式を発行できる）', type: 'boolean' },
    { key: 'hasTransferRestriction', label: '株式の譲渡制限に関する規定がある', type: 'boolean', defaultValue: true },
    { key: 'hasBoardOfDirectors', label: '取締役会設置会社', type: 'boolean', defaultValue: true },
    { key: 'hasAuditor', label: '監査役設置会社（登記上）', type: 'boolean', defaultValue: true },
    { key: 'auditorLimitedToAccounting', label: '監査役の監査の範囲を会計に限定している', type: 'boolean', help: '限定している場合、取締役会の招集通知の宛先や書面決議の要件が変わります（会社法389条・2条9号）' },
    { key: 'issuesShareCertificates', label: '株券発行会社', type: 'boolean' },
    { key: 'allowsBoardWrittenResolution', label: '定款に取締役会の書面決議（370条）の定めがある', type: 'boolean' },
    { key: 'shareholderMeetingNoticeDays', label: '株主総会の招集通知の期間（日）', type: 'integer', min: 0, max: 60, help: '定款で法定と違う期間を定めている場合だけ入力します（空欄は法定どおり）' },
    { key: 'boardMeetingNoticeDays', label: '取締役会の招集通知の期間（日）', type: 'integer', min: 0, max: 60, help: '定款で短縮している場合だけ入力します（法定は 1 週間）' },
    { key: 'directorTermYears', label: '取締役の任期（年）', type: 'integer', min: 1, max: 10, help: '空欄は法定の 2 年。非公開会社は定款で 10 年まで伸長できます' },
    { key: 'auditorTermYears', label: '監査役の任期（年）', type: 'integer', min: 1, max: 10, help: '空欄は法定の 4 年。非公開会社は定款で 10 年まで伸長できます' },
    { key: 'recordDateRule', label: '定款の基準日の定め', type: 'text', maxLength: 200, nullable: true, width: 'full', placeholder: '毎事業年度末日の最終の株主名簿に記載された株主' },
    { key: 'businessDescription', label: '事業の内容', type: 'textarea', maxLength: 4000, nullable: true, width: 'full' },
  ],
  orderBy: [],
  labelOf: (row) => (typeof row.name === 'string' ? row.name : ''),
  validate: (values): Record<string, string> | null => {
    const number = values.corporateNumber;
    if (typeof number === 'string' && number !== '' && !/^\d{13}$/.test(number)) {
      return { corporateNumber: '法人番号は 13 桁の数字で入力してください' };
    }
    if (values.auditorLimitedToAccounting === true && values.hasAuditor !== true) {
      return { auditorLimitedToAccounting: '監査役を置いていない会社では選べません' };
    }
    return null;
  },
};

export const COMPANY_COLUMNS = ['id', ...COMPANY_DEF.fields.map((field) => field.key), 'updatedAt'].join(', ');

export type CompanyRow = ResourceValues & { id: string };

/** 会社情報の行から、法令の計算に使う機関設計を取り出す */
export const governanceOf = (company: ResourceValues | null | undefined): Governance => ({
  isPublicCompany: company?.isPublicCompany === true,
  hasBoardOfDirectors: company?.hasBoardOfDirectors !== false,
  hasAuditor: company?.hasAuditor !== false,
  auditorLimitedToAccounting: company?.auditorLimitedToAccounting === true,
  shareholderMeetingNoticeDays: typeof company?.shareholderMeetingNoticeDays === 'number' ? company.shareholderMeetingNoticeDays : null,
  boardMeetingNoticeDays: typeof company?.boardMeetingNoticeDays === 'number' ? company.boardMeetingNoticeDays : null,
  directorTermYears: typeof company?.directorTermYears === 'number' ? company.directorTermYears : null,
  auditorTermYears: typeof company?.auditorTermYears === 'number' ? company.auditorTermYears : null,
  allowsBoardWrittenResolution: company?.allowsBoardWrittenResolution === true,
});
