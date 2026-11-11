import { Library } from '@/features/library/components/Library.client';

// 文書ライブラリ。出し分け（登録・編集・共有は管理者とメンバー）は画面の中で行い、権限の正しさは API が確かめる。
export default function LibraryPage() {
  return <Library />;
}
