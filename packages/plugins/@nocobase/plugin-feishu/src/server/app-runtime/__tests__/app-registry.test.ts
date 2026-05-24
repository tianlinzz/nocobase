/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { AppRegistry } from '../app-registry';

describe('AppRegistry', () => {
  it('set / get / list / delete round-trip', () => {
    const registry = new AppRegistry();
    expect(registry.list()).toEqual([]);
    registry.set({ appId: 'a', state: 'running', reconnectCount: 0 });
    registry.set({ appId: 'b', state: 'starting', reconnectCount: 1 });
    expect(registry.get('a')?.state).toBe('running');
    expect(registry.list()).toHaveLength(2);
    registry.set({ appId: 'a', state: 'stopped', reconnectCount: 0 });
    expect(registry.get('a')?.state).toBe('stopped');
    registry.delete('b');
    expect(registry.get('b')).toBeUndefined();
    expect(registry.list()).toHaveLength(1);
  });
});
