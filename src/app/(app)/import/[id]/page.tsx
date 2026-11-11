import { ImportReview } from '@/features/import/components/ImportReview.client';

// 読取りの結果の確認（反映の前）と、反映済み・破棄済みの結果の表示。
export default async function ImportReviewRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImportReview id={id} />;
}
