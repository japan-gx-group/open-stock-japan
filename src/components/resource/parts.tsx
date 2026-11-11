// 画面の共通の小さな部品（数字のタイル・状態の表示・注意の一覧）。サーバ・クライアントのどちらからでも使える。
import type { ReactNode } from 'react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';

export const StatTile = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
  <div className="gt-card" style={{ padding: '18px 20px' }}>
    <div className="text-[12.5px] font-medium text-text-muted">{label}</div>
    <div className="text-[24px] font-bold text-text-heading mt-1.5 tabular-nums leading-tight tracking-[-0.01em]">{value}</div>
    {sub && <div className="text-[12px] leading-relaxed text-text-muted mt-1.5">{sub}</div>}
  </div>
);

export const StatGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{children}</div>
);

export const LoadingBlock = ({ label = '読み込んでいます…' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-text-muted" role="status">
    <Loader2 size={16} className="animate-spin" />
    {label}
  </div>
);

export const ErrorBlock = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="gt-card text-[13px] text-danger" style={{ padding: '16px 18px' }}>
    {message}
    {onRetry && (
      <button type="button" className="gt-btn ml-3" onClick={onRetry}>
        再読み込み
      </button>
    )}
  </div>
);

export const EmptyState = ({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) => (
  <div className="gt-card text-center" style={{ padding: '40px 24px' }}>
    <div className="text-[15px] font-semibold text-text-heading">{title}</div>
    {description && <p className="text-[13px] leading-relaxed text-text-muted mt-2 mb-0 max-w-[520px] mx-auto">{description}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

export type NoticeLevel = 'error' | 'warning' | 'info';

/** 法令上の注意・台帳の不整合などを並べる */
export const NoticeList = ({ items }: { items: { level: NoticeLevel; message: ReactNode; key?: string }[] }) => {
  if (items.length === 0) return null;
  return (
    <ul className="list-none p-0 m-0 flex flex-col gap-2">
      {items.map((item, index) => {
        const tone =
          item.level === 'error'
            ? 'border-danger/30 bg-danger/5 text-danger'
            : item.level === 'warning'
              ? 'border-warning/40 bg-warning/10 text-text-main'
              : 'border-border bg-primary-bg/40 text-text-main';
        const Icon = item.level === 'info' ? Info : AlertTriangle;
        return (
          <li key={item.key ?? index} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] leading-relaxed ${tone}`}>
            <Icon size={15} className="mt-[3px] shrink-0" />
            <span>{item.message}</span>
          </li>
        );
      })}
    </ul>
  );
};

/** 法令の根拠を小さく添える */
export const LegalBasis = ({ children }: { children: ReactNode }) => (
  <span className="text-[12px] text-text-muted">（{children}）</span>
);
