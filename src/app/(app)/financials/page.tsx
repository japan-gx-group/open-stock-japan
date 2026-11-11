import { Financials } from '@/features/financials/components/Financials.client';

// 決算情報。出し分け（登録・編集・公開は管理者とメンバー）は画面の中で行い、権限の正しさは API が確かめる。
export default function FinancialsPage() {
  return <Financials />;
}
