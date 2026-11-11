// テンプレートの文面を、差し込み項目と「【要確認】」に色を付けて見せる（読むだけ）。

import type { PlaceholderScope } from '../services/placeholders';
import { segmentBody } from '../services/fill';

export const TemplateBody = ({ body, scopes }: { body: string; scopes: readonly PlaceholderScope[] }) => (
  <div className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.9] text-text-main">
    {segmentBody(body, scopes).map((segment, index) => {
      if (segment.type === 'text') return <span key={index}>{segment.text}</span>;
      if (segment.type === 'review') {
        return (
          <mark key={index} className="rounded-[4px] bg-warning-soft px-0.5 text-warning">
            {segment.text}
          </mark>
        );
      }
      return (
        <span
          key={index}
          className={`rounded-[4px] px-1 py-px font-medium ${segment.known ? 'bg-primary-bg text-primary' : 'bg-danger-light text-danger'}`}
          title={segment.known ? undefined : 'この種類のテンプレートでは使えない名前です'}
        >
          {`{{${segment.name}}}`}
        </span>
      );
    })}
  </div>
);
