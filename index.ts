import { WebClient } from '@slack/web-api';
import fs from 'fs/promises';
import path from 'path';
import { program } from 'commander';
import * as dotenv from 'dotenv';

dotenv.config();

interface Message {
  type: string;
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  attachments?: any[];
  files?: any[];
  thread_ts?: string;
  reply_count?: number;
  parent_user_id?: string;
}

interface Conversation {
  id: string;
  is_im: boolean;
  user?: string;
  name?: string;
}

async function sanitizeFilename(name: string): Promise<string> {
  return name
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')
    .trim()
    .slice(0, 100);
}

function dateToUnix(dateStr: string): number {
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  return dt.setUTCHours(0, 0, 0, 0) / 1000;
}

async function getUserName(client: WebClient, userId: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(userId)) return cache.get(userId)!;

  try {
    const { user } = await client.users.info({ user: userId });
    const profile = user?.profile;
    const name =
      profile?.display_name ||
      user?.real_name ||
      user?.name ||
      userId;
    cache.set(userId, name);
    return name;
  } catch {
    cache.set(userId, userId);
    return userId;
  }
}

async function downloadFile(url: string, token: string, outputDir: string, filename: string): Promise<string | null> {
  try {
    const filesDir = path.join(outputDir, 'files');
    await fs.mkdir(filesDir, { recursive: true });
    const filePath = path.join(filesDir, filename);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filePath, buffer);
    return path.relative(outputDir, filePath);
  } catch (err: any) {
    console.warn(`   Failed to download ${url}: ${err.message}`);
    return null;
  }
}

async function fetchThreadReplies(
  client: WebClient,
  channelId: string,
  threadTs: string,
  startTs: number,
  endTs: number
): Promise<Message[]> {
  let replies: Message[] = [];
  let cursor: string | undefined;

  do {
    try {
      const resp = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        oldest: startTs.toString(),
        latest: endTs.toString(),
        limit: 200,
        cursor,
        inclusive: true,
      });

      const batch = (resp.messages || []) as Message[];
      // Skip the parent message (first one usually has thread_ts === ts)
      const filtered = batch.filter(m => m.ts !== threadTs);
      replies = replies.concat(filtered);

      cursor = resp.response_metadata?.next_cursor;
      await new Promise(r => setTimeout(r, 200));
    } catch (err: any) {
      console.warn(`   Thread fetch error for ts ${threadTs}: ${err.message}`);
      break;
    }
  } while (cursor);

  return replies;
}

async function main() {
program
  .name('slack-dm-exporter')
  .description('Export Slack DMs (with threads & files) by date range to text files')
  .option('--token <token>', 'Slack user token (xoxp-...) – can also be set in .env as SLACK_TOKEN')
  .option('--start <date>', 'Start date YYYY-MM-DD – can also be set in .env as START_DATE', process.env.START_DATE)
  .option('--end <date>', 'End date YYYY-MM-DD – can also be set in .env as END_DATE', process.env.END_DATE)
  .option('--output-dir <dir>', 'Output directory – can also be set in .env as OUTPUT_DIR', process.env.OUTPUT_DIR)
  .option('--download-files', 'Download attached files to ./files subfolder – can also be set in .env as DOWNLOAD_FILES', 
    (val) => val === 'true' || val === '1',   // commander parses flags as boolean
    process.env.DOWNLOAD_FILES?.toLowerCase() === 'true' || process.env.DOWNLOAD_FILES === '1'
  );

program.parse();

  const opts = program.opts();

  // Get values with .env fallback (and required checks)
  const token: string = opts.token || process.env.SLACK_TOKEN;
  const startDate: string = opts.start || process.env.START_DATE || '';
  const endDate: string = opts.end || process.env.END_DATE || '';
  const outputDir: string = opts.outputDir || process.env.OUTPUT_DIR || `slack_dm_export_${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
  const downloadFiles: boolean = opts.downloadFiles;

    // Validation – fail early if critical things are missing
    if (!token) {
    console.error('❌ No Slack token provided. Set SLACK_TOKEN in .env or pass --token');
    process.exit(1);
    }
    if (!startDate || !endDate) {
    console.error('❌ Missing date range. Set START_DATE and END_DATE in .env or pass --start / --end');
    process.exit(1);
    }

    console.log(`Using config:
    • Token: ${token.slice(0,10)}... (hidden)
    • Start: ${startDate}
    • End:   ${endDate}
    • Output: ${outputDir}
    • Download files: ${downloadFiles ? 'YES' : 'no'}
    `);

  await fs.mkdir(outputDir, { recursive: true });

  const client = new WebClient(token);
  const userCache = new Map<string, string>();

  console.log('🔍 Listing DM conversations...');

  let dmChannels: Conversation[] = [];
  let cursor: string | undefined;

  do {
    const resp = await client.users.conversations({
      types: 'im,mpim',
      limit: 200,
      cursor,
    });
    dmChannels = dmChannels.concat((resp.channels || []) as Conversation[]);
    cursor = resp.response_metadata?.next_cursor;
    await new Promise(r => setTimeout(r, 200));
  } while (cursor);

  console.log(`✅ Found ${dmChannels.length} DMs.`);

  let startTs: number, endTs: number;
  try {
    startTs = dateToUnix(startDate) - 1;
    endTs = dateToUnix(endDate) + 86400;
  } catch {
    console.error('Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  let exportedCount = 0;
  const summary: string[] = [
    'Slack DM Export Summary (with threads & files)',
    '='.repeat(60),
    `Date range: ${startDate} to ${endDate}`,
    `Files download: ${downloadFiles ? 'ENABLED' : 'disabled'}`,
    '',
  ];

  for (let i = 0; i < dmChannels.length; i++) {
    const conv = dmChannels[i];
    const channelId = conv.id;
    const isIm = conv.is_im;

    let friendlyName: string;
    if (isIm && conv.user) {
      const displayName = await getUserName(client, conv.user, userCache);
      friendlyName = `DM_with_${await sanitizeFilename(displayName)}`;
    } else {
      friendlyName = `GroupDM_${await sanitizeFilename(conv.name || channelId)}`;
    }

    const fileName = `${friendlyName}_${channelId.slice(0, 8)}.txt`;
    const filePath = path.join(outputDir, fileName);

    console.log(`[${i + 1}/${dmChannels.length}] Processing ${friendlyName} (${channelId})...`);

    let messages: Message[] = [];
    let hasMessages = false;
    let historyCursor: string | undefined;

    do {
      const resp = await client.conversations.history({
        channel: channelId,
        oldest: startTs.toString(),
        latest: endTs.toString(),
        limit: 200,
        cursor: historyCursor,
        inclusive: true,
      });

      const batch = (resp.messages || []) as Message[];
      messages = messages.concat(batch);
      if (batch.length > 0) hasMessages = true;

      historyCursor = resp.response_metadata?.next_cursor;
      await new Promise(r => setTimeout(r, 200));
    } while (historyCursor);

    if (!hasMessages) continue;

    messages.sort((a, b) => Number(a.ts) - Number(b.ts));

    const content: string[] = [
      `Slack DM Export: ${friendlyName}`,
      `Channel ID: ${channelId}`,
      `Date range: ${startDate} to ${endDate}`,
      '',
    ];

    for (const msg of messages) {
      if (msg.type !== 'message') continue;

      const tsNum = Number(msg.ts);
      const dt = new Date(tsNum * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const userId = msg.user || msg.bot_id || 'system';
      const username = await getUserName(client, userId, userCache);
      let line = `${dt} | ${username}:`;

      let text = (msg.text || '').replace(/\n/g, '  ');
      line += ` ${text}`;

      // Attachments / Files
      if (msg.files?.length) {
        for (const file of msg.files) {
          const fname = file.name || 'unnamed_file';
          const url = file.url_private_download || file.url_private;
          if (url) {
            line += ` [File: ${fname} - ${url}]`;
            if (downloadFiles) {
              const downloaded = await downloadFile(url, token, outputDir, `${tsNum.toFixed(6)}_${fname}`);
              if (downloaded) line += ` → downloaded to ${downloaded}`;
            }
          } else {
            line += ` [File: ${fname} - no download URL]`;
          }
        }
      }
      if (msg.attachments?.length) {
        line += ` [${msg.attachments.length} attachment(s)/link(s)]`;
      }

      content.push(line);

      // Thread replies
      if (msg.thread_ts && msg.reply_count && msg.reply_count > 0 && msg.ts === msg.thread_ts) {
        content.push(`  ┌── Thread replies ──`);
        const replies = await fetchThreadReplies(client, channelId, msg.thread_ts, startTs, endTs);
        for (const reply of replies) {
          const rTs = Number(reply.ts);
          const rDt = new Date(rTs * 1000).toISOString().replace('T', ' ').slice(0, 19);
          const rUser = await getUserName(client, reply.user || reply.bot_id || 'system', userCache);
          let rLine = `  │ ${rDt} | ${rUser}: ${(reply.text || '').replace(/\n/g, '  ')}`;

          if (reply.files?.length || reply.attachments?.length) {
            rLine += ' [📎 attachment/file]';
          }

          content.push(rLine);
        }
        content.push(`  └── End of thread ──`);
      }
    }

    await fs.writeFile(filePath, content.join('\n'), 'utf-8');

    exportedCount++;
    summary.push(`✓ ${friendlyName} (${channelId}) — ${messages.length} messages (threads included) → ${fileName}`);
  }

  const summaryPath = path.join(outputDir, '_SUMMARY.txt');
  await fs.writeFile(summaryPath, summary.join('\n'), 'utf-8');

  console.log('\n🎉 DONE!');
  console.log(`Exported ${exportedCount} DMs with thread support.`);
  console.log(`Files saved to: ${path.resolve(outputDir)}`);
  if (downloadFiles) console.log(`Downloaded files → ${path.resolve(outputDir)}/files/`);
  console.log(`See ${summaryPath} for list.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});