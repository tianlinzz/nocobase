/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { parseSSEFrames } from '../sse-frame-parser';

describe('parseSSEFrames', () => {
  it('parses a single content frame', () => {
    const chunk = 'data: {"type":"content","body":"hello"}\n\n';
    expect(parseSSEFrames(chunk)).toEqual([{ type: 'content', body: 'hello' }]);
  });

  it('parses multiple frames packed in one chunk', () => {
    const chunk =
      'data: {"type":"content","body":"hi "}\n\n' +
      'data: {"type":"content","body":"there"}\n\n' +
      'data: {"type":"stream_end"}\n\n';
    expect(parseSSEFrames(chunk)).toEqual([
      { type: 'content', body: 'hi ' },
      { type: 'content', body: 'there' },
      { type: 'stream_end', body: undefined },
    ]);
  });

  it('ignores incomplete trailing frame (no double newline)', () => {
    const chunk = 'data: {"type":"content","body":"complete"}\n\ndata: {"type":"content","body":"partial"';
    expect(parseSSEFrames(chunk)).toEqual([{ type: 'content', body: 'complete' }]);
  });

  it('skips frames that fail JSON parse', () => {
    const chunk =
      'data: {"type":"content","body":"good"}\n\n' +
      'data: not-json\n\n' +
      'data: {"type":"content","body":"good2"}\n\n';
    expect(parseSSEFrames(chunk)).toEqual([
      { type: 'content', body: 'good' },
      { type: 'content', body: 'good2' },
    ]);
  });

  it('skips frames whose payload is not an object with a string `type`', () => {
    const chunk =
      'data: {"type":"content","body":"good"}\n\n' +
      'data: 123\n\n' +
      'data: null\n\n' +
      'data: {"body":"no type field"}\n\n';
    expect(parseSSEFrames(chunk)).toEqual([{ type: 'content', body: 'good' }]);
  });

  it('returns empty array on empty / whitespace-only input', () => {
    expect(parseSSEFrames('')).toEqual([]);
    expect(parseSSEFrames('\n\n\n')).toEqual([]);
  });
});
