/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { FeishuClientManager } from '../transport/feishu-client-manager';
import { FeishuApiError } from '../transport/types';

export interface ValidateOptions {
  managerFactory?: () => FeishuClientManager;
}

/**
 * Service for handling Feishu app secrets — masking for display and validating
 * that a credential pair can mint an access token without leaking values.
 */
export class SecretService {
  constructor(private readonly clientManager: FeishuClientManager) {}

  /** Mask a secret for display: keep first 3 and last 4 chars; otherwise return `***`. */
  static mask(value: string | null | undefined): string {
    if (!value) return '';
    if (value.length <= 8) return '***';
    return `${value.slice(0, 3)}***${value.slice(-4)}`;
  }

  /**
   * Validate credentials by minting an access token through a temporary client.
   * The temp manager is keyed by a synthetic id derived from `appId` (never the
   * secret) so nothing from validation leaks into the long-lived manager.
   *
   * Returns `{ requestId? }` on success or rethrows a sanitized
   * {@link FeishuApiError} that does not include credential material.
   */
  async validate(
    config: { appId: string; appSecret: string },
    options: ValidateOptions = {},
  ): Promise<{ requestId?: string }> {
    const tempKey = `__validate__${config.appId}__${Date.now()}`;
    const tempManager = options.managerFactory ? options.managerFactory() : new FeishuClientManager();
    tempManager.addApp({ appId: tempKey, appSecret: config.appSecret });
    try {
      // Use the lightweight `validateCredentials` (= app_access_token mint)
      // instead of `getBotInfo` so failures of bot/v3/info don't shadow
      // credential validity (e.g. the app has not been published yet, or a
      // local HTTP proxy returns 400 for that specific endpoint).
      return await tempManager.validateCredentials(tempKey);
    } catch (err) {
      if (err instanceof FeishuApiError) {
        // re-throw a sanitized error to avoid leaking credential material in upstream logs
        throw new FeishuApiError(`feishu credential validation failed (code=${err.code})`, err.code, err.requestId);
      }
      throw err;
    } finally {
      tempManager.removeApp(tempKey);
    }
  }
}
