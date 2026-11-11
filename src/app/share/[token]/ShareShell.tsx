// 共有リンクの画面の外枠（ロゴと中央のカードだけ）。ログイン後の画面の部品・データは一切載せない。
import type { ReactNode } from 'react';
import { OpenStockLogo } from '@/components/ui/OpenStockLogo';

export const ShareShell = ({ children }: { children: ReactNode }) => (
  <main className="min-h-screen bg-bg-main flex flex-col items-center justify-center px-4 py-10">
    <div className="mb-7">
      <OpenStockLogo height={28} />
    </div>
    <div className="gt-card w-full max-w-[480px]" style={{ padding: '28px 28px 24px' }}>
      {children}
    </div>
  </main>
);

/** 無効・期限切れ・取り消し済み・存在しないリンクに共通の表示（理由は出し分けない） */
export const InvalidShare = () => (
  <ShareShell>
    <h1 className="text-[17px] font-semibold text-text-heading m-0">リンクが無効か、期限が切れています</h1>
    <p className="text-[13px] leading-relaxed text-text-muted mt-3 mb-0">
      この共有リンクは利用できません。リンクを受け取った相手に、新しいリンクの発行を依頼してください。
      短い時間に何度も開いた場合は、しばらく待ってからもう一度お試しください。
    </p>
  </ShareShell>
);
