# feishuSendMessage

Send a Feishu (Lark) message from the current Feishu app context.

## When to use

- The user is chatting through a Feishu bot in this NocoBase conversation.
- You need to send a message to a different Feishu user or chat than the one this conversation came from.

## Inputs

- `receiveIdType`: one of `open_id`, `user_id`, `union_id`, `chat_id`. Choose the type that matches `receiveId`. Never guess from the prefix.
- `receiveId`: the destination ID.
- `content`: plain text content.

## Behavior

- Uses the Feishu app bound to this conversation.
- Returns `{ status: 'success', content: '<message_id>' }` on success.
- Returns `{ status: 'failure', content: '<reason>' }` on failure (e.g. missing context, missing app, Feishu API error).
