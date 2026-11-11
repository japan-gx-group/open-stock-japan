import { redirect } from 'next/navigation';
import { DocumentList, Empty, PortalTitle } from '@/features/portal/components/parts';
import { getPortalDocuments } from '@/features/portal/services/portal.server';
import { getCurrentProfile } from '@/lib/currentProfile';

// 株主ポータル: 自分が読める文書（全株主あて・自分あてに公開されたもの）。
export default async function PortalDocumentsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const documents = await getPortalDocuments(profile);
  return (
    <>
      <PortalTitle title="文書" description="会社が株主のみなさま、またはあなたあてに公開した文書です。" />
      <div className="gt-card">
        {documents.length === 0 ? <Empty>公開されている文書はまだありません。</Empty> : <DocumentList documents={documents} />}
      </div>
    </>
  );
}
