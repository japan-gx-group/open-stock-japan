import { Templates } from '@/features/templates/components/Templates.client';

// 文書テンプレート。出し分け（作成・編集・削除は管理者とメンバー）は画面の中で行い、権限の正しさは API が確かめる。
export default function TemplatesPage() {
  return <Templates />;
}
