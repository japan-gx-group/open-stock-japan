import { RoundsView } from '@/features/rounds/components/RoundsView.client';

// 資金調達ラウンドと株式の種類。データの取得と権限による出し分けはクライアントコンポーネントが行い、権限の正しさは API が確かめる。
export default function RoundsPage() {
  return <RoundsView />;
}
