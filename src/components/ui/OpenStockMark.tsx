import type { CSSProperties } from 'react';
import { MARK_DOT_RADIUS, MARK_EDGE, MARK_SECTORS } from './logoPaths';

export type LogoVariant = 'color' | 'inverse' | 'mono';

type OpenStockMarkProps = {
  size?: number;
  /**
   * color   … 明るい背景用（ブランドのネイビー 3 階調 + 朱の円）
   * inverse … 濃い背景用（白系 3 階調 + 明るい朱の円）
   * mono    … 1 色（currentColor）。色を使えない場所用
   */
  variant?: LogoVariant;
  className?: string;
  style?: CSSProperties;
};

// 色は public/logo.svg・logo-dark.svg と同じ値（ロゴ専用。画面の配色トークンとは別に固定している）。
export const LOGO_PALETTES: Record<Exclude<LogoVariant, 'mono'>, { arcs: readonly string[]; dot: string; ink: string; sub: string }> = {
  color: { arcs: ['#2d4b8e', '#6b8fd9', '#b7c9f0'], dot: '#e2533f', ink: '#16233f', sub: '#2d4b8e' },
  inverse: { arcs: ['#ffffff', '#c7d5f5', '#8fa9e6'], dot: '#ff7a66', ink: '#ffffff', sub: '#c7d5f5' },
};

const MONO_OPACITY = [1, 0.66, 0.4];

/** マークの中身（svg の中に置く）。ロックアップ（OpenStockLogo）と共用する */
export const MarkShapes = ({ variant }: { variant: LogoVariant }) => (
  <>
    {MARK_SECTORS.map((d, index) => {
      const color = variant === 'mono' ? 'currentColor' : LOGO_PALETTES[variant].arcs[index];
      return (
        <path
          key={d}
          d={d}
          fill={color}
          stroke={color}
          strokeWidth={MARK_EDGE}
          strokeLinejoin="round"
          opacity={variant === 'mono' ? MONO_OPACITY[index] : undefined}
        />
      );
    })}
    <circle cx="24" cy="24" r={MARK_DOT_RADIUS} fill={variant === 'mono' ? 'currentColor' : LOGO_PALETTES[variant].dot} />
  </>
);

// OpenStock Japan のロゴマーク。
// 持株比率のリング（資本政策表）を 3 つの弧で表し、中心に円（日の丸・会社）を置いている。
// リングは「Open」の O でもある。形は src/components/ui/logoPaths.ts、使い方は docs/brand.md。
export const OpenStockMark = ({ size = 24, variant = 'color', className, style }: OpenStockMarkProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 48 48"
    width={size}
    height={size}
    aria-hidden
    focusable="false"
    className={className}
    style={style}
  >
    <MarkShapes variant={variant} />
  </svg>
);
