import { MeetingList } from '@/features/meetings/components/MeetingList.client';

// 取締役会の一覧。中身は株主総会と共通の実装（src/features/meetings）。
export default function BoardMeetingsPage() {
  return <MeetingList kind="board" />;
}
