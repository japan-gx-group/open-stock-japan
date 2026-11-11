import { MeetingDetail } from '@/features/meetings/components/MeetingDetail.client';

// 取締役会の詳細（基本情報・議案・出欠・招集通知・議事録・関連文書）。
export default async function BoardMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingDetail kind="board" id={id} />;
}
