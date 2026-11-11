import { notFound, redirect } from 'next/navigation';
import { DocumentList, PortalTitle, publishedDate } from '@/features/portal/components/parts';
import { getPortalUpdate } from '@/features/portal/services/portal.server';
import { UpdateBody } from '@/features/updates/components/UpdateBody';
import { getCurrentProfile } from '@/lib/currentProfile';
import { optionLabel } from '@/lib/equity/types';
import { UPDATE_CATEGORIES } from '@/lib/resources/definitions';

// 株主ポータル: お知らせ 1 件。下書き・他社のもの・存在しないものは同じ 404 にする。
export default async function PortalUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const result = await getPortalUpdate(profile, (await params).id);
  if (!result) notFound();
  const { update, attachments } = result;
  return (
    <>
      <PortalTitle
        title={update.title}
        description={`${publishedDate(update.publishedAt)}・${optionLabel(UPDATE_CATEGORIES, update.category)}`}
        back={{ href: '/external-portal/updates', label: 'お知らせの一覧' }}
      />
      <article className="gt-card" style={{ padding: '24px' }}>
        <UpdateBody body={update.body} />
      </article>
      {attachments.length > 0 && (
        <section className="gt-card mt-4">
          <h2 className="gt-card-title m-0 mb-1">添付の文書</h2>
          <DocumentList documents={attachments} showCategory={false} />
        </section>
      )}
    </>
  );
}
