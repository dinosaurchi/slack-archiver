import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.SLACK_USER_TOKEN;
if (!token) {
  console.error('SLACK_USER_TOKEN is required in .env');
  process.exit(1);
}

const client = new WebClient(token);

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

async function getUserInfo() {
  return await withRetry(() => client.auth.test());
}

async function getUserConversations(userId) {
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
      const isMember = await isUserInChannel(channel.id, userId);
      if (isMember) {
        conversations.push(channel);
      }
    }

    cursor = result.response_metadata?.next_cursor;
    await sleep(RATE_LIMIT_DELAY);
  } while (cursor);

  return conversations;
}

async function isUserInChannel(channelId, userId) {
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

async function getConversationHistory(channelId, channelType) {
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
      const enriched = await enrichMessage(msg, channelId, channelType);
      messages.push(enriched);
    }

    cursor = result.response_metadata?.next_cursor;
    await sleep(RATE_LIMIT_DELAY);
  } while (cursor);

  return messages;
}

async function enrichMessage(msg, channelId, channelType) {
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
      const replies = await getThreadReplies(channelId, msg.ts);
      enriched.thread_replies = replies;
    } catch (err) {
      console.log(`  Warning: Could not fetch thread replies: ${err.message}`);
    }
  }

  return enriched;
}

async function getThreadReplies(channelId, threadTs) {
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

function normalizeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function downloadUserData() {
  console.log('Starting Slack data download...\n');

  const authInfo = await getUserInfo();
  const workspaceId = authInfo.team_id;
  const workspaceName = normalizeName(authInfo.team);
  const userId = authInfo.user_id;

  console.log(`Workspace: ${authInfo.team}`);
  console.log(`User: ${authInfo.user}\n`);

  const userName = authInfo.user;
  const safeUserName = `${normalizeName(userName)}-${userId}`;

  const projectRoot = path.join(__dirname, '..');
  const outputDir = path.join(projectRoot, 'data', `${workspaceName}-${workspaceId}`, safeUserName);
  await ensureDir(outputDir);

  console.log(`Output directory: ${outputDir}\n`);

  const conversations = await getUserConversations(userId);
  console.log(`Found ${conversations.length} conversations\n`);

  for (const conv of conversations) {
    const convType = getConversationType(conv);
    const convName = conv.name ? `${normalizeName(conv.name)}-${conv.id}` : conv.id;
    console.log(`Processing ${convType}: ${conv.name || conv.id}...`);

    try {
      const messages = await getConversationHistory(conv.id, convType);

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

function getConversationType(channel) {
  if (channel.is_im) return 'dm';
  if (channel.is_mpim) return 'mpim';
  if (channel.is_private) return 'private_channel';
  return 'public_channel';
}

downloadUserData().catch(console.error);