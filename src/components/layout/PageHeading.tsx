// 本文先頭の画面見出し（大見出し＋説明＋右肩の操作群）。
// 上部バー（AppTopBar）はパンくずとアイコン操作だけを持ち、
// 画面固有の見出し・主要導線はこちらに置く。

import type { ReactNode } from 'react';

type PageHeadingProps = {
  title: string;
  /** 見出し直下の1行説明 */
  description?: string;
  /** 右肩に置く画面固有の操作（絞り込み・補助ボタンなど） */
  actions?: ReactNode;
  /** 右端の主要ボタン。渡さなければ出さない */
  primaryAction?: ReactNode | null;
};

export const PageHeading = ({ title, description, actions, primaryAction }: PageHeadingProps) => (
  <div className="gt-page-heading">
    <div style={{ minWidth: 0 }}>
      <h1 className="gt-page-title">{title}</h1>
      {description && <p className="gt-page-sub">{description}</p>}
    </div>
    {(actions || primaryAction) && (
      <div className="gt-page-heading-actions">
        {actions}
        {primaryAction}
      </div>
    )}
  </div>
);
