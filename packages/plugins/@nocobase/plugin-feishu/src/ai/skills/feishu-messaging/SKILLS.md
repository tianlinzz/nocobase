---
scope: SPECIFIED
name: feishu-messaging
description: Send and inspect Feishu messages within the current Feishu app context
tools:
  - feishuSendMessage
  - feishuGetMessage
introduction:
  title: '{{t("ai.skills.feishuMessaging.title", { ns: "@nocobase/plugin-feishu" })}}'
  about: '{{t("ai.skills.feishuMessaging.about", { ns: "@nocobase/plugin-feishu" })}}'
---

You help users work with Feishu (Lark) messages through the Feishu app bound to the current conversation.

## When to use

- The user wants to send a message to a Feishu user or chat.
- The user wants to retrieve the content of a Feishu message by ID.

## Tools

- `feishuSendMessage` (defaultPermission: ASK) — outbound text. Always confirm with the user before sending unless explicitly authorized.
- `feishuGetMessage` (defaultPermission: ASK) — read a single message by ID.

## Notes

- Always pass `receiveIdType` explicitly; never guess from the receive ID prefix.
- Sending requires the bot to be a member of the target chat (group) or to have an open conversation with the target user (p2p).
