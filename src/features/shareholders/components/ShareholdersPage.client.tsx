'use client';

// 株主名簿の画面に、株主ポータルへの招待（features/portal-access）を組み込む。
// ShareholdersView 自体は招待の仕組みを知らず、権利者の一覧の「ポータル」列に出す中身を受け取るだけにしてある。

import React from 'react';
import { PortalAccessControl } from '@/features/portal-access/components/PortalAccessControl.client';
import type { ShareholdersTab } from '../types';
import { ShareholdersView } from './ShareholdersView.client';

export const ShareholdersPage = ({ initialTab }: { initialTab?: ShareholdersTab }) => (
  <ShareholdersView
    initialTab={initialTab}
    renderStakeholderActions={(stakeholder) => (
      <PortalAccessControl stakeholderId={stakeholder.id} stakeholderName={stakeholder.name} email={stakeholder.email} />
    )}
  />
);
