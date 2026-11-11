import { MeetingList } from '@/features/meetings/components/MeetingList.client';

// 株主総会（定時・臨時・種類）の一覧。中身は取締役会と共通の実装（src/features/meetings）。
export default function ShareholderMeetingsPage() {
  return <MeetingList kind="shareholder" />;
}
