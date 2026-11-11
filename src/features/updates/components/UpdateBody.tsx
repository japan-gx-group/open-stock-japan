// お知らせの本文の表示（社内のプレビューと株主ポータルで共通）。
// parseUpdateBody が分けたブロックを React の要素にするだけで、HTML を差し込まない（dangerouslySetInnerHTML を使わない）。
import { Fragment } from 'react';
import { parseUpdateBody } from '../services/updateBody';

export const UpdateBody = ({ body }: { body: string }) => {
  const blocks = parseUpdateBody(body);
  if (blocks.length === 0) return <p className="text-[13px] text-text-muted m-0">（本文はまだありません）</p>;
  return (
    <div className="text-[14px] leading-[1.85] text-text-body break-words">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const className =
            block.level === 1
              ? 'text-[18px] font-semibold text-text-heading mt-6 mb-3 first:mt-0'
              : block.level === 2
                ? 'text-[16px] font-semibold text-text-heading mt-5 mb-2 first:mt-0'
                : 'text-[14px] font-semibold text-text-heading mt-4 mb-2 first:mt-0';
          const Tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4';
          return (
            <Tag key={index} className={className}>
              {block.text}
            </Tag>
          );
        }
        if (block.type === 'list') {
          return (
            <ul key={index} className="list-disc pl-6 my-3">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="my-1">
                  {item}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="my-3">
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};
