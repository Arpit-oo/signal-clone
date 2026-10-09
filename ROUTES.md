# Product routes

Default local ports are **3000** for the frontend and **8000** for the backend. `scripts/start.ps1 -FrontendPort 3010` changes the frontend port; Docker ports are configurable in `.env`. Paths below are independent of those port choices.

| Route | Screen and behavior |
| --- | --- |
| `/` | Signal homepage, with direct links to the messenger, sign-in, and signup. |
| `/download` | Web messenger entry and official Signal app download links. |
| `/signup` | Create an account with your own phone number, simulated verification, name, optional username, and profile photo. Signed-in users can choose another number. |
| `/login` | Sign in with your number or select Alex, Priya, or Marcus from the seeded accounts. |
| `/chats` | Your conversation list and messenger. Anonymous users go to sign-in. |
| `/chats?filter=archive` | Open your archived conversations, including from the Stories navigation. Refresh and sign-in preserve this destination. |
| `/chats/{conversationId}` | Open a specific conversation. Refresh and browser Back/Forward retain the selected chat. Only authorized members can open it. |
| `/chats/{conversationId}?details=1` | Open a conversation with its details panel. |
| `/stories` | Authenticated story feed, creation, and viewer. Share text/photo/video with selected people; posts expire after 24 hours. |

Sign-in and signup accept an optional `next` parameter restricted to the chat routes above and `/stories`. For example, `/login?next=%2Fchats%2F12` returns to conversation 12 after sign-in and profile setup; `/login?next=%2Fstories` returns to Stories. Invalid page URLs show a page-not-found screen with links back to the product; inaccessible conversations show a recoverable error.

Profile/settings, new conversations, groups, contact controls, message actions, story creation/viewing, chat backgrounds and calls are dialogs or panels within the messenger. Settings occupies the full viewport. One-to-one voice/video calls are functional; group calling and linked devices remain placeholders. Bundled demo portraits are public images at `/api/demo-avatars/{name}-v1.jpg` for the nine named demo accounts.

Phone verification remains mocked: **123456**, with no SMS sent. This applies to both seeded and newly registered numbers. New users get their own empty account with Note to Self; existing sample conversations belong to the seeded users.

# Backend routes

The frontend proxies `/api/*` to the backend. Interactive endpoint documentation: **http://127.0.0.1:8000/docs**. Alternative reference: `/redoc`; machine-readable schema: `/openapi.json`.

WebSocket: `ws://127.0.0.1:8000/ws?token={sessionToken}`. The client manages authentication, reconnection, presence, typing, messages, receipts, and updates through this connection.

The endpoint inventory below is generated from the current backend OpenAPI schema. Protected endpoints require a bearer token; marked media routes also accept `?token={token}`. `/docs`, `/redoc`, and `/openapi.json` are public documentation routes.

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| `POST` | `/api/attachments` | Upload Attachment | Bearer |
| `GET` | `/api/attachments/{attachment_id}/file` | Download Attachment | Bearer or media token |
| `POST` | `/api/auth/request-otp` | Request Otp | Public |
| `POST` | `/api/auth/verify` | Verify | Public |
| `GET` | `/api/blocks` | List Blocked | Bearer |
| `DELETE` | `/api/blocks/{user_id}` | Unblock User | Bearer |
| `PUT` | `/api/blocks/{user_id}` | Block User | Bearer |
| `GET` | `/api/contacts` | List Contacts | Bearer |
| `POST` | `/api/contacts` | Add Contact | Bearer |
| `DELETE` | `/api/contacts/{user_id}` | Remove Contact | Bearer |
| `PATCH` | `/api/contacts/{user_id}` | Update Contact | Bearer |
| `GET` | `/api/conversations` | List Conversations | Bearer |
| `POST` | `/api/conversations` | Create Conversation | Bearer |
| `DELETE` | `/api/conversations/{conversation_id}` | Delete Conversation | Bearer |
| `GET` | `/api/conversations/{conversation_id}` | Get Conversation | Bearer |
| `PATCH` | `/api/conversations/{conversation_id}` | Update Conversation | Bearer |
| `DELETE` | `/api/conversations/{conversation_id}/avatar` | Delete Group Avatar | Bearer |
| `POST` | `/api/conversations/{conversation_id}/avatar` | Upload Group Avatar | Bearer |
| `POST` | `/api/conversations/{conversation_id}/leave` | Leave | Bearer |
| `POST` | `/api/conversations/{conversation_id}/members` | Add Members | Bearer |
| `DELETE` | `/api/conversations/{conversation_id}/members/{user_id}` | Remove Member | Bearer |
| `PATCH` | `/api/conversations/{conversation_id}/members/{user_id}` | Set Member Role | Bearer |
| `GET` | `/api/conversations/{conversation_id}/messages` | List Messages | Bearer |
| `POST` | `/api/conversations/{conversation_id}/messages` | Send Message | Bearer |
| `GET` | `/api/conversations/{conversation_id}/messages/search` | Search In Conversation | Bearer |
| `POST` | `/api/conversations/{conversation_id}/read` | Mark Read | Bearer |
| `PATCH` | `/api/conversations/{conversation_id}/settings` | Update Settings | Bearer |
| `GET` | `/api/conversations/{conversation_id}/wallpaper` | Get Wallpaper | Bearer or media token |
| `POST` | `/api/conversations/{conversation_id}/wallpaper` | Upload Wallpaper | Bearer |
| `GET` | `/api/demo-avatars/{name}.jpg` | Demo Avatar | Public |
| `GET` | `/api/me` | Get Me | Bearer |
| `PATCH` | `/api/me` | Update Me | Bearer |
| `DELETE` | `/api/me/avatar` | Delete Avatar | Bearer |
| `POST` | `/api/me/avatar` | Upload Avatar | Bearer |
| `GET` | `/api/media/{key}` | Media | Public |
| `POST` | `/api/messages/delivered` | Mark Delivered | Bearer |
| `DELETE` | `/api/messages/{message_id}` | Delete Message | Bearer |
| `PATCH` | `/api/messages/{message_id}` | Edit Message | Bearer |
| `POST` | `/api/messages/{message_id}/forward` | Forward | Bearer |
| `GET` | `/api/messages/{message_id}/info` | Message Info | Bearer |
| `DELETE` | `/api/messages/{message_id}/reaction` | Unreact | Bearer |
| `PUT` | `/api/messages/{message_id}/reaction` | React | Bearer |
| `GET` | `/api/search` | Search | Bearer |
| `GET` | `/api/stories` | Feed | Bearer |
| `POST` | `/api/stories` | Create | Bearer |
| `DELETE` | `/api/stories/{story_id}` | Remove | Bearer |
| `GET` | `/api/stories/{story_id}/media` | Media | Bearer or media token |
| `GET` | `/api/stories/{story_id}/views` | Viewers | Bearer |
| `POST` | `/api/stories/{story_id}/views` | Mark Viewed | Bearer |
| `GET` | `/api/users/lookup` | Lookup User | Bearer |
| `GET` | `/api/users/search` | Search Users | Bearer |
| `GET` | `/api/users/{user_id}` | Get User | Bearer |
| `GET` | `/api/users/{user_id}/groups-in-common` | Groups In Common | Bearer |
| `GET` | `/health` | Health | Public |

## WebSocket events

All frames have `{"type":"event.name","data":{...}}`. The socket authenticates once at `/ws?token={token}`; each event still checks its conversation/user permissions. Call IDs are client-generated UUIDs; conversation and message IDs are server-issued positive integers.

| Client to server | Important data / purpose |
| --- | --- |
| `message.send` | `conversation_id`, `client_id`, `body`; optional `reply_to_id`, `attachment_ids` |
| `typing.start`, `typing.stop` | `conversation_id`; privacy-aware typing state |
| `receipt.delivered` | `message_ids` (at most 500); acknowledge received messages |
| `receipt.read` | `conversation_id`, `up_to_id`; acknowledge visible history |
| `ping` | Heartbeat; `data` may be null |
| `call.invite` | `call_id`, `conversation_id`, voice/video `kind`, SDP `offer` |
| `call.accept` | `call_id`; claim the incoming call for this browser socket |
| `call.signal` | `call_id` and SDP `description` or ICE `candidate` |
| `call.connected` | `call_id`; confirm connection |
| `call.end` | `call_id`, optional `reason`: hangup/declined/media_error/connection_failed |

| Server to client | Purpose |
| --- | --- |
| `message.new` | Persisted message; send acknowledgment and recipient notification |
| `message.updated`, `message.hidden`, `message.expired` | Shared edit/delete changes, member-local hiding, or expiry |
| `message.timer_started` | Disappearing-message expiry begins |
| `reaction.updated`, `receipt.updated` | Reaction or delivery/read changes |
| `typing`, `presence` | Peer typing/online/last-seen state |
| `user.updated`, `me.updated` | Peer or current profile changes |
| `conversation.updated`, `conversation.read`, `conversation.removed` | Conversation metadata/membership/settings/read changes |
| `story.changed` | Eligible clients refresh the feed |
| `call.incoming`, `call.ringing` | Incoming offer and caller ringing state |
| `call.accepted`, `call.dismissed` | Owning tabs accept; sibling recipient tabs dismiss |
| `call.signal`, `call.ended` | Peer SDP/ICE or call termination reason |
| `error`, `pong` | Rejected event (`detail`, `event`, `ref`) or heartbeat reply |

Message retries use the same `client_id` and reconcile with `message.new`. Socket reconnection reloads authorized state; it does not replay all historical events. Calls bind signaling to the two owning sockets and are ephemeral. REST and media permissions, group history boundaries, and persistence choices are explained in [ARCHITECTURE.md](ARCHITECTURE.md).
