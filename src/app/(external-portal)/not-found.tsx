import Link from 'next/link';

// 株主ポータルの中で、見つからない・公開されていないページを開いたときの表示。
export default function PortalNotFound() {
  return (
    <div className="gt-card text-center" style={{ padding: '40px 24px' }}>
      <h1 className="text-[16px] font-semibold text-text-heading m-0">ページが見つかりません</h1>
      <p className="text-[13px] text-text-muted mt-2 mb-4">公開が終了したか、URL が正しくない可能性があります。</p>
      <Link href="/external-portal" className="gt-btn no-underline">
        ホームに戻る
      </Link>
    </div>
  );
}
