/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export interface SSEFrame {
  type: string;
  body?: unknown;
}

/**
 * Stateless SSE-frame parser tailored to plugin-ai's `ChatStreamProtocol`,
 * which always emits frames in the shape:
 *
 *     data: {"type":"<event>","body":<json>}\n\n
 *
 * Returns the frames found in `chunk`. Unrecognised lines, incomplete
 * trailing frames (no terminating `\n\n`), non-JSON payloads, and payloads
 * without a string `type` field are silently dropped — the caller would
 * otherwise have to repeat the same defensive filtering everywhere.
 *
 * Stateless on purpose: each `ctx.res.write` from AIEmployee already
 * delivers complete `data: ...\n\n` blocks; we don't need a buffer-across-
 * chunks parser.
 */
export function parseSSEFrames(chunk: string): SSEFrame[] {
  if (!chunk) return [];
  const frames: SSEFrame[] = [];
  // SSE frames are separated by a blank line (\n\n). Anything after the last
  // \n\n is a partial frame we discard for now.
  for (const block of chunk.split('\n\n')) {
    if (!block.trim()) continue;
    const dataLine = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const rawPayload = dataLine.slice('data:'.length).trim();
    if (!rawPayload) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.type !== 'string') continue;
    frames.push({ type: obj.type, body: obj.body });
  }
  return frames;
}
