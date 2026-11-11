# ロゴと配色

## ロゴの意味

<img src="../public/logo.svg" alt="OpenStock Japan" width="300">

- **リング** — 持株比率（資本政策表）を表す 3 つの弧です。大きい順に、創業者・投資家・ストックオプションのイメージで、このツールの中心にある「誰が、どれだけ持っているか」を示します。リングは「Open」の O でもあります。
- **中心の円** — 日の丸（Japan）であり、株主に囲まれた会社そのものでもあります。
- **ワードマーク** — 画面と同じ書体 Instrument Sans をアウトライン化したものです（OpenStock はウェイト 650、Japan は 440）。

## ファイル

| ファイル | 用途 |
|---|---|
| [public/logo.svg](../public/logo.svg) | 横組みのロゴ。明るい背景用 |
| [public/logo-dark.svg](../public/logo-dark.svg) | 横組みのロゴ。濃い背景用（背景は透明） |
| [public/logo-mark.svg](../public/logo-mark.svg) | マークだけ。正方形の枠や小さい表示用 |
| [src/app/icon.svg](../src/app/icon.svg) | ブラウザのタブ用（ブランド色のタイルに白のマーク） |
| [src/app/favicon.ico](../src/app/favicon.ico) | SVG のアイコンを読まないブラウザ用（16・32・48px。icon.svg から書き出したもの） |
| [src/app/apple-icon.png](../src/app/apple-icon.png) | ホーム画面用（180px。icon.svg から書き出したもの） |

タブ用のアイコンは `src/app/` に置きます（Next.js のファイル規約）。URL に内容のハッシュが付くので、差し替えたときにブラウザの古いアイコンが残りません。
`icon.svg` を変えたら `node scripts/brand/build-favicon.mjs` で `favicon.ico` と `apple-icon.png` を書き出し直します。

アプリの中では、SVG ファイルを読み込まずに次のコンポーネントを使います。

```tsx
import { OpenStockLogo } from '@/components/ui/OpenStockLogo';   // 横組み。variant: 'color' | 'inverse'
import { OpenStockMark } from '@/components/ui/OpenStockMark';   // マークだけ。variant: 'color' | 'inverse' | 'mono'

<OpenStockLogo height={28} />
<OpenStockLogo height={36} variant="inverse" />   {/* 濃い背景の上 */}
<OpenStockMark size={24} />
```

形（パス）は [src/components/ui/logoPaths.ts](../src/components/ui/logoPaths.ts) にまとめてあり、public の SVG と同じ形です。形を変えるときは両方を直してください。

## 色

| 用途 | 明るい背景 | 濃い背景 |
|---|---|---|
| リング（大） | `#2d4b8e` | `#ffffff` |
| リング（中） | `#6b8fd9` | `#c7d5f5` |
| リング（小） | `#b7c9f0` | `#8fa9e6` |
| 中心の円 | `#e2533f` | `#ff7a66` |
| OpenStock | `#16233f` | `#ffffff` |
| Japan | `#2d4b8e` | `#c7d5f5` |

`#2d4b8e` は画面のブランド色（`--color-primary`）と同じです。朱（`#e2533f` = `--color-brand-accent`）はロゴ以外では、注目させたい 1 点にだけ使います。

## 使い方の目安

- まわりに、マークの中心の円の直径ぶん以上の余白を取ります。
- 横組みは高さ 20px 以上、マークだけなら 16px 以上で使います。
- 縦横比を変えたり、色を上の表以外に変えたり、影や枠を足したりしないでください。写真や柄の上には置かず、単色の背景に置きます。

## 寸法（作り直すとき）

- マークは 48 × 48 の枠。リングは外径 19・内径 11、弧と弧のすき間は平行で幅 2.6、角は半径 0.6 で丸めています。弧の割合は 54.5% / 22.5% / 12.5%、開始角は 3 時の方向から時計回りに −40°。中心の円は半径 4.5。
- 横組みは高さ 48 に対して幅 306.5。ワードマークはフォントサイズ 30（キャップハイト 21.6）で、マークと上下中央をそろえ、マークとの間隔は 12.5。「OpenStock」と「Japan」の間は 7.5。
- 文字のアウトラインは `scripts/brand/outline-text.swift`（macOS）で取り出せます。
