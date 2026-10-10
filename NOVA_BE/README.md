# Ало (Alo) — Backend

Spring Boot backend for **Ало**, a voice assistant web app. It owns users,
sessions, and the Google OAuth connections (Calendar, Gmail, Contacts) that the
voice tools will use.

- Java 21, Spring Boot 3, Maven
- Spring Web + Spring Data JPA + H2 (file mode, `./data/alo`)
- No Spring Security. Sessions are the standard `HttpSession` (`JSESSIONID`
  cookie). There is **no real authentication** — the phone number is the user ID.
- Google access via the official Google API Java client libraries with a manual
  OAuth 2.0 web flow.

The frontend is a separate Next.js app that proxies `/api/*` to this server, so
the browser sees a single origin — **no CORS configuration is needed**.

---

## 1. Google Cloud Console setup

1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **Enable the APIs** — APIs & Services → Library, enable all three:
   - Google Calendar API
   - Gmail API
   - People API
3. **OAuth consent screen** — APIs & Services → OAuth consent screen:
   - User type: **External**
   - Publishing status: leave in **Testing** mode
   - Under **Test users**, add every Google account you'll demo with
     (only test users can log in while the app is in Testing).
4. **Create credentials** — APIs & Services → Credentials → Create credentials →
   **OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URIs** — add the callback URL for every origin the
     browser uses. The path is always `/api/google/callback`:
     - `http://localhost:3000/api/google/callback` (local dev)
     - `https://<your-subdomain>.ngrok-free.app/api/google/callback` (ngrok)
   - Copy the **Client ID** and **Client secret**.

> The redirect URI points at the **frontend** origin (port 3000 / ngrok), not at
> this server directly. Next.js proxies `/api/*` to `:8080`, so Google redirects
> the browser to the frontend and the request is forwarded here.

---

## 2. Environment variables

Configured in `application.properties` and read from the environment:

| Variable               | Description                                               | Example                                |
| ---------------------- | --------------------------------------------------------- | -------------------------------------- |
| `GOOGLE_CLIENT_ID`     | OAuth 2.0 Web client ID                                   | `123-abc.apps.googleusercontent.com`   |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Web client secret                               | `GOCSPX-...`                           |
| `PUBLIC_URL`           | URL the browser uses to reach the frontend                | `http://localhost:3000`                |
| `OPENAI_API_KEY`       | OpenAI API key (powers the agent)                         | `sk-...`                               |
| `OPENAI_MODEL`         | Model for the agent (optional)                            | `gpt-4o` (default)                     |
| `APP_TIMEZONE`         | Timezone for calendar events (optional)                   | `Europe/Sofia` (default)               |

Copy the example file and fill it in:

```bash
cp .env.example .env
# edit .env
```

---

## 3. Run

```bash
# load env vars, then start on port 8080
set -a && source .env && set +a
./mvnw spring-boot:run
```

Or run the packaged jar:

```bash
./mvnw package -DskipTests
set -a && source .env && set +a
java -jar target/alo-backend-0.0.1.jar
```

The server listens on **http://localhost:8080**. Start the Next.js frontend
separately on port 3000 (or expose it via ngrok and set `PUBLIC_URL` to the
ngrok URL).

- H2 console (handy during the demo): <http://localhost:8080/h2-console>
  (JDBC URL `jdbc:h2:file:./data/alo`, user `sa`, empty password).
- Every request and each OAuth step is logged to the console.

---

## 4. API

Everything except `register`/`login` requires a logged-in session (else `401`).

| Method & path                                   | Description                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `POST /api/auth/register` `{phone, name}`       | `201` + user JSON · `409` if phone exists · `400` on invalid phone/name     |
| `POST /api/auth/login` `{phone}`                | `200` + user JSON · `404` if no such user                                   |
| `POST /api/auth/logout`                         | `204`, invalidates the session                                              |
| `GET /api/me`                                   | `200` `{phone, name, about, services:{calendar,contacts,gmail}}`            |
| `PUT /api/me` `{name, about}`                   | `200`, same shape as `GET /api/me`                                          |
| `GET /api/google/connect?service=…`             | `302` to the Google consent screen                                          |
| `GET /api/google/callback`                      | handles the code, then `302` to `{PUBLIC_URL}/home?connected=…` (or `?error=…`) |
| `DELETE /api/google/{service}`                  | `204`, turns that service off                                               |
| `POST /api/agent/chat` `{message}`              | `200` `{reply, pending}` — talk to the assistant                            |
| `POST /api/agent/confirm` `{approved}`          | `200` `{reply, pending}` — approve/reject a drafted email or event          |
| `POST /api/agent/reset`                         | `204`, clears the conversation                                              |

`service` is one of `calendar`, `contacts`, `gmail`.

### Google OAuth details

- Scopes per service (calendar/gmail are read **and** write so the agent can
  create events and send mail):
  - calendar → `https://www.googleapis.com/auth/calendar`
  - contacts → `https://www.googleapis.com/auth/contacts.readonly`
  - gmail → `https://www.googleapis.com/auth/gmail.modify`
- **Incremental authorization**: each connect requests only the clicked
  service's scope, with `access_type=offline`, `include_granted_scopes=true`,
  `prompt=consent`.
- A random `state` is stored in the session (with the requested service) and
  verified in the callback.
- In the callback the code is exchanged, tokens + granted scopes are stored, and
  the service's flag is set to `true`.
- A service counts as **connected** only if its flag is `true` **and** its scope
  is in the stored granted scopes.
- `GoogleOAuth.getValidAccessToken(userId)` returns a valid access token,
  refreshing it automatically when expired — the agent tools use it.

> **Changed the scopes?** Calendar and Gmail moved from read-only to read+write.
> Anyone who connected before this change must **reconnect** those services
> (the old grant lacks the new scope, so they'll show as disconnected until
> they re-consent). In the Google Cloud consent screen (Testing mode), make sure
> `.../auth/calendar` and `.../auth/gmail.modify` are allowed under Data Access.

### The agent

`POST /api/agent/chat` runs a tool-calling loop against OpenAI. The conversation
is kept in the `HttpSession`, so the frontend only sends plain text.

- **Read tools** run immediately: `list_recent_emails` (last 24h by default),
  `search_emails`, `get_email`, `list_calendar_events`, `search_contacts`.
- **Write tools** — `send_email`, `create_calendar_event` — are **never executed
  inside `/chat`**. When the model calls one, the server stores it as *pending*
  and returns `{reply: <draft summary>, pending: {type, summary}}`. The client
  shows it and calls `POST /api/agent/confirm {approved: true|false}` to actually
  send/create (or cancel). This is the "confirm first" safety gate.
- Only tools for **connected** services are offered to the model.
- Config: `OPENAI_API_KEY` (required), `OPENAI_MODEL` (default `gpt-4o`),
  `APP_TIMEZONE` (default `Europe/Sofia`, used for event times).

Example:

```bash
curl -s -c j -b j -X POST localhost:8080/api/agent/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Summarize my emails from the last 24 hours"}'

curl -s -c j -b j -X POST localhost:8080/api/agent/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Email anna@example.com that I will be 10 min late"}'
# -> returns pending: {type:"send_email", summary:"Send email to anna@example.com ..."}

curl -s -c j -b j -X POST localhost:8080/api/agent/confirm \
  -H 'Content-Type: application/json' -d '{"approved":true}'
```

---

## Project layout

```
src/main/java/com/alo
├── AloApplication.java
├── model/        User, GoogleConnection (JPA entities)
├── repo/         Spring Data repositories
├── dto/          Dtos.java — request/response records
├── google/       GoogleOAuth (OAuth + tokens), GoogleClients (API clients)
├── agent/        OpenAiClient, AgentTools, AgentService — the assistant
└── web/          controllers, exception handler, auth interceptor, request log
```
