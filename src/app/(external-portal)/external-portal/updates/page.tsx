import { redirect } from 'next/navigation';
import { Empty, PortalTitle, UpdateList } from '@/features/portal/components/parts';
import { getPortalUpdates } from '@/features/portal/services/portal.server';
import { getCurrentProfile } from '@/lib/currentProfile';

// 株主ポータル: 公開中のお知らせの一覧。
export default async function PortalUpdatesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const updates = await getPortalUpdates(profile);
  return (
    <>
      <PortalTitle title="お知らせ" description="会社から株主のみなさまへのお知らせ・レポートです。" />
      <div className="gt-card">
        {updates.length === 0 ? <Empty>公開されているお知らせはまだありません。</Empty> : <UpdateList updates={updates} />}
      </div>
    </>
  );
}
