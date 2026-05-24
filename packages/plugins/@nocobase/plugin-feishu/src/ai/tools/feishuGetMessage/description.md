# feishuGetMessage

Fetch the content of a Feishu (Lark) message by its message ID using the current Feishu app context.

## When to use

- The user references a previous Feishu message by ID (e.g. `om_xxx`) and you need its content.
- You need to inspect a message that was sent in another chat reachable by the bound Feishu app.

## Inputs

- `messageId`: the Feishu message ID (typically starts with `om_`).

## Behavior

- Uses the Feishu app bound to this conversation.
- Returns `{ status: 'success', content: '<message text or serialized payload>' }` on success.
- Returns `{ status: 'failure', content: '<reason>' }` on failure (e.g. missing context, missing app, message not found, permission denied).
