# Slack Archieve

A command-line tool to archive Slack conversation history for one or more workspace users. Downloads all accessible conversations — including public channels, private channels, direct messages, and group DMs — and saves them as structured JSON files.

## Features

- Archives all conversation types (public channels, private channels, DMs, multi-party IMs)
- Captures full message history with thread replies and file metadata
- Supports multiple user tokens in a single run
- Handles Slack API rate limiting with automatic retries
- Organizes output by workspace and user

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later (ES modules required)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a secrets file

Create `.secrets/user-tokens.json` in the project root:

```json
[
  {
    "name": "Jane Doe",
    "token": "xoxp-..."
  },
  {
    "name": "John Smith",
    "token": "xoxp-..."
  }
]
```

Each entry requires a `token` field. The `name` field is optional and is used for display and output directory naming.

### 3. Get a Slack token

You need a Slack User OAuth Token (`xoxp-...`) with the following scopes:

| Scope | Purpose |
|---|---|
| `conversations:read` | List and read channel history |
| `conversations.members` | Check channel membership |
| `files:read` | Read file metadata |

Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps), assign the scopes above to its User Token Scopes, install it in your workspace, and copy the generated token.

## Usage

```bash
npm start
```

Or with Make:

```bash
make archive-history
```

The tool will iterate over each token, authenticate, and download all conversations the user belongs to.

## Output Structure

Archived data is written to the `data/` directory, organized by workspace and user:

```
data/
└── <workspace_name>-<workspace_id>/
    └── <user_name>-<user_id>/
        ├── _summary.json
        ├── general-<channel_id>.json
        ├── private-channel-<channel_id>.json
        ├── dm-<channel_id>.json
        └── ...
```

### Summary file (`_summary.json`)

```json
{
  "workspace_id": "T12345678",
  "workspace_name": "Acme Corp",
  "user_id": "U87654321",
  "user_name": "Jane Doe",
  "download_date": "2026-05-05T12:00:00.000Z",
  "total_conversations": 42
}
```

### Conversation file

Each conversation is saved as a separate JSON file containing:

| Field | Description |
|---|---|
| `id` | Channel/conversation ID |
| `name` | Channel name (may be empty for DMs) |
| `type` | `public_channel`, `private_channel`, `dm`, or `mpim` |
| `created` | Channel creation timestamp |
| `topic` | Channel topic (if set) |
| `message_count` | Total number of messages |
| `messages` | Full message array, including enriched thread replies and file metadata |

## Rate Limiting

The tool enforces a 1.5-second delay between API calls and respects Slack's `retry_after` headers when rate limited. Failed requests are retried up to 3 times with exponential backoff.

## License

Private — all rights reserved.
