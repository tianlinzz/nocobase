/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ai loader inputs', () => {
  it('feishuSendMessage tool has accompanying description.md', async () => {
    const md = await fs.readFile(path.resolve(__dirname, '../../ai/tools/feishuSendMessage/description.md'), 'utf-8');
    expect(md.length).toBeGreaterThan(0);
  });

  it('feishuGetMessage tool has accompanying description.md', async () => {
    const md = await fs.readFile(path.resolve(__dirname, '../../ai/tools/feishuGetMessage/description.md'), 'utf-8');
    expect(md.length).toBeGreaterThan(0);
  });

  it('feishu-messaging SKILLS.md is well-formed YAML frontmatter', async () => {
    const md = await fs.readFile(path.resolve(__dirname, '../../ai/skills/feishu-messaging/SKILLS.md'), 'utf-8');
    expect(md.startsWith('---\n') || md.startsWith('---\r\n')).toBe(true);
    expect(md).toMatch(/^name: feishu-messaging$/m);
    expect(md).toMatch(/^scope: SPECIFIED$/m);
  });
});
