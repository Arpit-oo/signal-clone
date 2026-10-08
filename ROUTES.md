# Product routes

The local frontend runs at **http://127.0.0.1:3010**. The backend runs at **http://127.0.0.1:8000**.

| Route | Screen and behavior |
| --- | --- |
| `/` | Signal homepage, with direct links to the messenger, sign-in, and signup. |
| `/download` | Web messenger entry and official Signal app download links. |
| `/signup` | Create an account with your own phone number, simulated verification, name, optional username, and profile photo. Signed-in users can choose another number. |
| `/login` | Sign in with your number or select Alex, Priya, or Marcus from the seeded accounts. |
| `/chats` | Your conversation list and messenger. Anonymous users go to sign-in. |
| `/chats/{conversationId}` | Open a specific conversation. Refresh and browser Back/Forward retain the selected chat. Only authorized members can open it. |
| `/chats/{conversationId}?details=1` | Open a conversation with its details panel. |
| `/stories` | Authenticated story feed, creation, and viewer. Share text/photo/video with selected people; posts expire after 24 hours. |

Sign-in and signup accept an optional `next` parameter restricted to the chat routes above and `/stories`. For example, `/login?next=%2Fchats%2F12` returns to conversation 12 after sign-in and profile setup; `/login?next=%2Fstories` returns to Stories. Invalid page URLs show a page-not-found screen with links back to the product; inaccessible conversations show a recoverable error.

Profile/settings, new conversations, groups, contact controls, message actions, and story creation/viewing are dialogs or panels within the messenger. They do not require separate page URLs. Voice/video calls and linked devices remain permitted placeholders under the project brief.

Phone verification remains mocked: **123456**, with no SMS sent. This applies to both seeded and newly registered numbers. New users get their own empty account with Note to Self; existing sample conversations belong to the seeded users.

# Backend routes

The frontend proxies `/api/*` to the backend. Interactive endpoint documentation: **http://127.0.0.1:8000/docs**. Alternative reference: `/redoc`; machine-readable schema: `/openapi.json`.

WebSocket: `ws://127.0.0.1:8000/ws?token={sessionToken}`. The client manages authentication, reconnection, presence, typing, messages, receipts, and updates through this connection.

The endpoint inventory below is generated from the backend's OpenAPI schema. Authentication requirements and request/response bodies are available in the interactive docs.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/attachments` | Upload Attachment |
| `GET` | `/api/attachments/{attachment_id}/file` | Download Attachment |
| `POST` | `/api/auth/request-otp` | Request Otp |
| `POST` | `/api/auth/verify` | Verify |
| `GET` | `/api/blocks` | List Blocked |
| `PUT` | `/api/blocks/{user_id}` | Block User |
| `DELETE` | `/api/blocks/{user_id}` | Unblock User |
| `GET` | `/api/contacts` | List Contacts |
| `POST` | `/api/contacts` | Add Contact |
| `PATCH` | `/api/contacts/{user_id}` | Update Contact |
| `DELETE` | `/api/contacts/{user_id}` | Remove Contact |
| `GET` | `/api/conversations` | List Conversations |
| `POST` | `/api/conversations` | Create Conversation |
| `GET` | `/api/conversations/{conversation_id}` | Get Conversation |
| `PATCH` | `/api/conversations/{conversation_id}` | Update Conversation |
| `DELETE` | `/api/conversations/{conversation_id}` | Delete Conversation |
| `POST` | `/api/conversations/{conversation_id}/avatar` | Upload Group Avatar |
| `DELETE` | `/api/conversations/{conversation_id}/avatar` | Delete Group Avatar |
| `POST` | `/api/conversations/{conversation_id}/leave` | Leave |
| `POST` | `/api/conversations/{conversation_id}/members` | Add Members |
| `DELETE` | `/api/conversations/{conversation_id}/members/{user_id}` | Remove Member |
| `PATCH` | `/api/conversations/{conversation_id}/members/{user_id}` | Set Member Role |
| `GET` | `/api/conversations/{conversation_id}/messages` | List Messages |
| `POST` | `/api/conversations/{conversation_id}/messages` | Send Message |
| `GET` | `/api/conversations/{conversation_id}/messages/search` | Search In Conversation |
| `POST` | `/api/conversations/{conversation_id}/read` | Mark Read |
| `PATCH` | `/api/conversations/{conversation_id}/settings` | Update Settings |
| `GET` | `/api/me` | Get Me |
| `PATCH` | `/api/me` | Update Me |
| `POST` | `/api/me/avatar` | Upload Avatar |
| `DELETE` | `/api/me/avatar` | Delete Avatar |
| `GET` | `/api/media/{key}` | Media |
| `POST` | `/api/messages/delivered` | Mark Delivered |
| `PATCH` | `/api/messages/{message_id}` | Edit Message |
| `DELETE` | `/api/messages/{message_id}` | Delete Message |
| `POST` | `/api/messages/{message_id}/forward` | Forward |
| `GET` | `/api/messages/{message_id}/info` | Message Info |
| `PUT` | `/api/messages/{message_id}/reaction` | React |
| `DELETE` | `/api/messages/{message_id}/reaction` | Unreact |
| `GET` | `/api/search` | Search |
| `GET` | `/api/stories` | Feed |
| `POST` | `/api/stories` | Create |
| `DELETE` | `/api/stories/{story_id}` | Remove |
| `GET` | `/api/stories/{story_id}/media` | Media |
| `POST` | `/api/stories/{story_id}/views` | Mark Viewed |
| `GET` | `/api/stories/{story_id}/views` | Viewers |
| `GET` | `/api/users/lookup` | Lookup User |
| `GET` | `/api/users/search` | Search Users |
| `GET` | `/api/users/{user_id}` | Get User |
| `GET` | `/api/users/{user_id}/groups-in-common` | Groups In Common |
| `GET` | `/health` | Health |
