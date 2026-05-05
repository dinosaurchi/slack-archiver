<div align="center">

# Slack Archiver

Export and archive your Slack workspace conversation history as structured JSON.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

</div>

---

Slack Archiver is a lightweight command-line tool that downloads the full conversation history for one or more workspace users. It handles public channels, private channels, direct messages, and group DMs — including thread replies and file attachments — and saves everything as organized JSON files you can search, back up, or process offline.

## Why Slack Archiver?

- **Complete archives** — messages, threads, and file attachments — not just channel lists
- **Multi-user support** — archive data for multiple users in a single run
- **Rate-limit aware** — built-in delays and automatic retries keep things smooth
- **Zero config UI** — just provide tokens and run
- **Structured JSON output** — easy to query, index, or feed into other tools

## Prerequisites

- **Node.js** v18 or later
- A Slack User OAuth Token with the required scopes (see [Setup](#setup))

## Setup

### 1. Install

```bash
git clone https://github.com/dinosaurchi/slack-archiver.git
cd slack-archiver
npm install
```

### 2. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app.
2. Navigate to **OAuth & Permissions** and add the following **User Token Scopes**:

   | Scope | Purpose |
   |---|---|
   | `conversations:read` | List channels and read message history |
   | `conversations.members` | Check channel membership |
   | `files:read` | Read and download file attachments |

3. Install the app in your workspace and copy the **User OAuth Token** (starts with `xoxp-`).

### 3. Configure tokens

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

- `token` — **required**. A Slack User OAuth Token.
- `name` — optional. Used for display and output directory naming.

> **Note:** `.secrets/` is already included in `.gitignore` so tokens are never committed.

## Usage

```bash
npm start
```

Or with Make:

```bash
make archive-history
```

The tool authenticates with each token, discovers all conversations the user belongs to, and downloads the full message history for each one.

## Output

Archived data is written to `data/`, organized by workspace and user:

```
data/
└── acme_corp-T12345678/
    └── jane_doe-U87654321/
        ├── _summary.json
        ├── general-C10000001.json
        ├── engineering-private-C10000002.json
        ├── dm-D10000003.json
        └── group-mpim-C10000004.json
```

### Attachments

File attachments are downloaded and stored alongside the conversation JSON:

```
data/
└── acme_corp-T12345678/
    └── jane_doe-U87654321/
        ├── attachments/
        │   ├── general-C10000001/
        │   │   ├── F12345_screenshot.png
        │   │   └── F12346_report.pdf
        │   └── engineering-private-C10000002/
        │       └── F12347_architecture.svg
        ├── _summary.json
        └── general-C10000001.json
```

Each file is named `<file_id>_<sanitized_filename>` and stored in a folder per conversation. Downloaded attachment paths are recorded in the `local_path` field of each message's attachment metadata.

### Summary file

Each user directory contains a `_summary.json`:

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

### Conversation files

Each conversation is saved as a separate JSON file with the following structure:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Channel or conversation ID |
| `name` | `string \| null` | Channel name (empty for DMs) |
| `type` | `string` | `public_channel`, `private_channel`, `dm`, or `mpim` |
| `created` | `number` | Unix timestamp of channel creation |
| `topic` | `string \| null` | Channel topic |
| `message_count` | `number` | Total number of messages downloaded |
| `messages` | `array` | Full message history with enriched threads, file metadata, and downloaded attachments |

## Rate Limiting

Slack Archiver respects Slack's API rate limits:

- **1.5-second delay** between consecutive API calls
- **Automatic retry** (up to 3 attempts) with exponential backoff on failure
- **`retry_after` compliance** — pauses when Slack signals a rate limit
- **0.5-second delay** between consecutive file downloads

## Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin my-feature`
5. Open a Pull Request

Please make sure your changes are consistent with the existing code style.

## License

This project is licensed under the [MIT License](LICENSE).
