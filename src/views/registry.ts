/**
 * Tab view registry: maps a TabKind to the component rendering it, and page modes to page bodies.
 * Feature modules register their views at import time (see src/features/index.ts).
 */
import type { ComponentType } from 'react';
import type { Tab, TabKind } from '@/store/tabs';
import type { PageMode, TreeNode } from '@/db/types';

export interface TabViewProps { tab: Tab; paneId: string; active: boolean }
export interface PageBodyProps { node: TreeNode; paneId: string; active: boolean }

const tabViews = new Map<TabKind, ComponentType<TabViewProps>>();
const pageBodies = new Map<PageMode, ComponentType<PageBodyProps>>();

export function registerTabView(kind: TabKind, c: ComponentType<TabViewProps>): void { tabViews.set(kind, c); }
export function getTabView(kind: TabKind): ComponentType<TabViewProps> | undefined { return tabViews.get(kind); }
export function registerPageBody(mode: PageMode, c: ComponentType<PageBodyProps>): void { pageBodies.set(mode, c); }
export function getPageBody(mode: PageMode): ComponentType<PageBodyProps> | undefined { return pageBodies.get(mode); }
