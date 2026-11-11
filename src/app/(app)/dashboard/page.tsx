import { DashboardView } from '@/features/dashboard/components/DashboardView.client';

// ダッシュボード（社内メンバー向けの概要）。データの取得はクライアントコンポーネントが API 経由で行う。
export default function DashboardPage() {
  return <DashboardView />;
}
