import { Updates } from '@/features/updates/components/Updates.client';

// 株主へのお知らせ。出し分け（作成・編集・公開は管理者とメンバー）は画面の中で行い、権限の正しさは API が確かめる。
export default function UpdatesPage() {
  return <Updates />;
}
