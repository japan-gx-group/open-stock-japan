import type { CSSProperties } from 'react';
import { WORDMARK } from './logoPaths';
import { LOGO_PALETTES, MarkShapes } from './OpenStockMark';

type OpenStockLogoProps = {
  /** ロゴの高さ（px）。幅は比率から決まる */
  height?: number;
  /** color = 明るい背景用 / inverse = 濃い背景用 */
  variant?: 'color' | 'inverse';
  className?: string;
  style?: CSSProperties;
};

// OpenStock Japan のロゴ（マーク + ワードマークの横組み）。
// ワードマークはアウトライン化したパスなので、フォントの読み込みに左右されず同じ形で出る。
// 文字として読み上げられるよう、svg に role="img" と aria-label を付けている。
export const OpenStockLogo = ({ height = 28, variant = 'color', className, style }: OpenStockLogoProps) => {
  const palette = LOGO_PALETTES[variant];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${WORDMARK.width} 48`}
      width={(height * WORDMARK.width) / 48}
      height={height}
      role="img"
      aria-label="OpenStock Japan"
      focusable="false"
      className={className}
      style={style}
    >
      <MarkShapes variant={variant} />
      <path
        transform={`translate(${WORDMARK.openStock.x} ${WORDMARK.baseline}) scale(${WORDMARK.scale})`}
        fill={palette.ink}
        d={WORDMARK.openStock.d}
      />
      <path
        transform={`translate(${WORDMARK.japan.x} ${WORDMARK.baseline}) scale(${WORDMARK.scale})`}
        fill={palette.sub}
        d={WORDMARK.japan.d}
      />
    </svg>
  );
};
