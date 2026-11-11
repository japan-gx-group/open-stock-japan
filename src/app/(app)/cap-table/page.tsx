import { CapTableView } from '@/features/cap-table/components/CapTableView.client';

// 資本政策表。データの取得と権限による出し分けはクライアントコンポーネントが行い、権限の正しさは API が確かめる。
export default function CapTablePage() {
  return <CapTableView />;
}
