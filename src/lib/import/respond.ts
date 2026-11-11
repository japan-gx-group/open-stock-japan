// AI 取り込みの Route Handler の返し方（サーバ専用）。
import 'server-only';
import { NextResponse } from 'next/server';
import type { ImportResult } from './server';

export const fromImportResult = <T extends object>(result: ImportResult<T>, successStatus = 200): NextResponse =>
  result.ok
    ? NextResponse.json(result.data, { status: successStatus })
    : NextResponse.json(
        {
          error: result.error,
          code: result.code ?? null,
          // 読取りだけが失敗したとき: 文書は保存済みなので、id を返してもう一度読み取れるようにする
          ...(result.document ? { document: { id: result.document.id, title: result.document.title, fileName: result.document.fileName } } : {}),
          ...(result.rowIssues ? { rowIssues: result.rowIssues } : {}),
        },
        { status: result.status },
      );
