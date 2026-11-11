import { ConvertiblesScreen } from '@/features/convertibles/components/ConvertiblesScreen.client';

// J-KISS・転換型。台帳の読み込みと権限による出し分けはクライアントコンポーネントが行い、
// 権限の正しさは API（src/lib/authz.ts）が確かめるため、ページは描画するだけにする。
export default function ConvertiblesPage() {
  return <ConvertiblesScreen />;
}
