import type { ComponentType } from 'react';

/** Optional bar rendered under the workspace (animation timeline, audio recorder…). Features register by id. */
const bars = new Map<string, ComponentType>();

export function registerBottomBar(id: string, c: ComponentType): void { bars.set(id, c); }
export function getBottomBar(id: string): ComponentType | undefined { return bars.get(id); }
