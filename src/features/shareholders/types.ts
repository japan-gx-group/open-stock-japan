// 株主名簿の画面のタブ。URL の ?tab= と対応する。
export const SHAREHOLDERS_TABS = [
  { value: 'registry', label: '株主名簿' },
  { value: 'stakeholders', label: '権利者（株主・新株予約権者・投資家）' },
  { value: 'transactions', label: '株式の異動' },
] as const;

export type ShareholdersTab = (typeof SHAREHOLDERS_TABS)[number]['value'];

export const isShareholdersTab = (value: unknown): value is ShareholdersTab =>
  typeof value === 'string' && SHAREHOLDERS_TABS.some((tab) => tab.value === value);
