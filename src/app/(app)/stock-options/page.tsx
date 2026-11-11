import { StockOptionsScreen } from '@/features/stock-options/components/StockOptionsScreen.client';

// ストックオプション（新株予約権）。台帳の読み込みと権限による出し分けはクライアントコンポーネントが行い、
// 権限の正しさは API（src/lib/authz.ts）が確かめるため、ページは描画するだけにする。
export default function StockOptionsPage() {
  return <StockOptionsScreen />;
}
