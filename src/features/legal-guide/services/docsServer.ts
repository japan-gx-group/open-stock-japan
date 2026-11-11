import 'server-only';

// docs/legal/ の文書を読む（サーバ専用）。読むのは docs.ts の一覧にあるファイル名だけで、
// 利用者の入力（URL の slug）は一覧との照合にしか使わない（パスの組み立てには使わない）。

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findLegalDoc, type LegalDoc } from './docs';

const LEGAL_DIR = path.join(process.cwd(), 'docs', 'legal');

export const readLegalDoc = async (slug: string): Promise<{ doc: LegalDoc; source: string } | null> => {
  const doc = findLegalDoc(slug);
  if (!doc) return null;
  try {
    return { doc, source: await readFile(path.join(LEGAL_DIR, doc.fileName), 'utf8') };
  } catch {
    return null;
  }
};
