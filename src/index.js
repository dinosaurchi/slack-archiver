import { WebClient } from '@slack/web-api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RATE_LIMIT_DELAY = 1500;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'slack_webapi_platform_error' && err.data?.retry_after) {
        console.log(`  Rate limited, waiting ${err.data.retry_after}s...`);
        await sleep(err.data.retry_after * 1000 + 500);
      } else if (i === retries - 1) {
        throw err;
      } else {
        await sleep(RATE_LIMIT_DELAY * (i + 1));
      }
    }
  }
}

async function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getConversationType(channel) {
  if (channel.is_im) return 'dm';
  if (channel.is_mpim) return 'mpim';
  if (channel.is_private) return 'private_channel';
  return 'public_channel';
}

async function downloadUserData(token, userProvidedName) {
  const client = new WebClient(token);

  console.log('Starting Slack data download...\n');

  const authInfo = await withRetry(() => client.auth.test());
  const workspaceId = authInfo.team_id;
  const workspaceName = normalizeName(authInfo.team);
  const userId = authInfo.user_id;

  console.log(`Workspace: ${authInfo.team}`);
  console.log(`User: ${authInfo.user}\n`);

  const userName = userProvidedName || authInfo.user;
  const safeUserName = `${normalizeName(userName)}-${userId}`;

  const projectRoot = path.join(__dirname, '..');
  const outputDir = path.join(projectRoot, 'data', `${workspaceName}-${workspaceId}`, safeUserName);
  await ensureDir(outputDir);

  console.log(`Output directory: ${outputDir}\n`);

  const conversations = await getUserConversations(client, userId);
  console.log(`Found ${conversations.length} conversations\n`);

  for (const conv of conversations) {
    const convType = getConversationType(conv);
    const convName = conv.name ? `${normalizeName(conv.name)}-${conv.id}` : conv.id;
    console.log(`Processing ${convType}: ${conv.name || conv.id}...`);

    try {
      const messages = await getConversationHistory(client, conv.id, convType);

      const convData = {
        id: conv.id,
        name: conv.name,
        type: convType,
        created: conv.created,
        topic: conv.topic?.value,
        message_count: messages.length,
        messages
      };

      const fileName = `${convName}.json`;
      const filePath = path.join(outputDir, fileName);
      fs.writeFileSync(filePath, JSON.stringify(convData, null, 2));

      console.log(`  Saved ${messages.length} messages to ${fileName}`);
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  const summary = {
    workspace_id: workspaceId,
    workspace_name: authInfo.team,
    user_id: userId,
    user_name: userName,
    download_date: new Date().toISOString(),
    total_conversations: conversations.length
  };

  fs.writeFileSync(
    path.join(outputDir, '_summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(`\nDownload complete! Data saved to ${outputDir}`);
}

async function getUserConversations(client, userId) {
  const conversations = [];
  let cursor;

  do {
    const result = await withRetry(() =>
      client.conversations.list({
        types: 'public_channel,private_channel,im,mpim',
        limit: 200,
        cursor
      })
    );

    for (const channel of result.channels) {
      const isMember = await isUserInChannel(client, channel.id, userId);
      if (isMember) {
        conversations.push(channel);
      }
    }

    cursor = result.response_metadata?.next_cursor;
    await sleep(RATE_LIMIT_DELAY);
  } while (cursor);

  return conversations;
}

async function isUserInChannel(client, channelId, userId) {
  try {
    const result = await withRetry(() =>
      client.conversations.members({
        channel: channelId,
        limit: 1000
      })
    );
    return result.members?.includes(userId) || false;
  } catch {
    return false;
  }
}

async function getConversationHistory(client, channelId, channelType) {
  const messages = [];
  let cursor;

  do {
    const result = await withRetry(() =>
      client.conversations.history({
        channel: channelId,
        limit: 200,
        cursor
      })
    );

    for (const msg of result.messages) {
      const enriched = await enrichMessage(client, msg, channelId, channelType);
      messages.push(enriched);
    }

    cursor = result.response_metadata?.next_cursor;
    await sleep(RATE_LIMIT_DELAY);
  } while (cursor);

  return messages;
}

async function enrichMessage(client, msg, channelId, channelType) {
  const enriched = { ...msg };

  if (msg.files && msg.files.length > 0) {
    enriched.attachments = msg.files.map(file => ({
      id: file.id,
      name: file.name,
      mime_type: file.mimetype,
      url_private: file.url_private,
      size: file.size
    }));
  }

  if (msg.reply_count && msg.reply_count > 0) {
    try {
      const replies = await getThreadReplies(client, channelId, msg.ts);
      enriched.thread_replies = replies;
    } catch (err) {
      console.log(`  Warning: Could not fetch thread replies: ${err.message}`);
    }
  }

  return enriched;
}

async function getThreadReplies(client, channelId, threadTs) {
  const replies = [];
  let cursor;

  do {
    const result = await withRetry(() =>
      client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 200,
        cursor
      })
    );

    for (const msg of result.messages) {
      if (msg.ts !== threadTs) {
        const enriched = { ...msg };
        if (msg.files && msg.files.length > 0) {
          enriched.attachments = msg.files.map(file => ({
            id: file.id,
            name: file.name,
            mime_type: file.mimetype,
            url_private: file.url_private,
            size: file.size
          }));
        }
        replies.push(enriched);
      }
    }

    cursor = result.response_metadata?.next_cursor;
    await sleep(RATE_LIMIT_DELAY);
  } while (cursor);

  return replies;
}

async function main() {
  const secretsPath = path.join(__dirname, '..', '.secrets', 'user-tokens.json');

  if (!fs.existsSync(secretsPath)) {
    console.error('Missing .secrets/user-tokens.json');
    process.exit(1);
  }

  const tokens = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));

  if (!Array.isArray(tokens) || tokens.length === 0) {
    console.error('.secrets/user-tokens.json must be a non-empty array');
    process.exit(1);
  }

  for (const entry of tokens) {
    if (!entry.token) {
      console.error('Each entry must have a token');
      continue;
    }

    console.log('\n' + '='.repeat(50) + '\n');

    try {
      await downloadUserData(entry.token, entry.name);
    } catch (err) {
      console.error(`Failed to download data for ${entry.name || entry.token}: ${err.message}`);
    }

    await sleep(RATE_LIMIT_DELAY * 2);
  }

  console.log('\nAll users processed.');
}

main().catch(console.error);