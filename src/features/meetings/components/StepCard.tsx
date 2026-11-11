// 会議の詳細画面の 1 手順分のカード（番号・見出し・状態・操作）。
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

export type StepTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface StepStatus {
  label: string;
  tone: StepTone;
}

export const StepCard = ({
  id,
  number,
  title,
  description,
  status,
  actions,
  children,
}: {
  id: string;
  number: number;
  title: string;
  description?: ReactNode;
  status: StepStatus;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <section id={id} className="gt-card scroll-mt-4" aria-labelledby={`${id}-title`}>
    <div className="gt-card-head flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        <span
          aria-hidden="true"
          className="mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-[13px] font-bold text-primary-dark"
        >
          {number}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 id={`${id}-title`} className="gt-card-title m-0">
              {title}
            </h2>
            <Badge variant={status.tone}>{status.label}</Badge>
          </div>
          {description && <div className="gt-card-sub leading-relaxed">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);
