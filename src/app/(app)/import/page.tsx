import { ImportPage } from '@/features/import/components/ImportPage.client';

// AI 取り込み（文書の読取りと履歴）。ロールによる出し分けはクライアントコンポーネントが行い、
// 権限の正しさは API（/api/import/**）が確かめる。
export default function ImportRoutePage() {
  return <ImportPage />;
}
