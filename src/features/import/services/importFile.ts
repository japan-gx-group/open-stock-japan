// 読み取るファイルの、送る前の確認（純関数）。形式の最終的な判定はサーバが中身で行う。

export const IMPORT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt';
export const MAX_AI_BYTES = 4 * 1024 * 1024;
export const MAX_STORE_BYTES = 20 * 1024 * 1024;

const EXTENSION = /\.(pdf|png|jpe?g|webp|txt)$/i;

/** 問題があれば利用者向けの文を返す。無ければ null */
export const checkImportFile = (file: { name: string; size: number }): string | null => {
  if (!EXTENSION.test(file.name)) return 'AI で読み取れるのは PDF、画像（PNG・JPEG・WebP）、テキストのファイルです';
  if (file.size === 0) return 'ファイルが空です';
  if (file.size > MAX_STORE_BYTES) return 'ファイルは 20MB までです';
  return null;
};

export const formatFileSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('ja-JP')} KB`;
