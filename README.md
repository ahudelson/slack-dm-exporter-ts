# Slack DM Exporter – Complete Step-by-Step Guide

**Purpose:** Export your own personal Slack direct messages (1:1 DMs and group DMs) with threads and optional file downloads, filtered by date range — everything runs 100% locally on your Mac or PC.

**Last updated:** March 2026

## 1. Prerequisites
- Node.js 18+ (recommended: 20 LTS or 22)
- A Slack workspace where you are a regular member (no admin rights needed)

## 2. Get the Project
1. Clone or download the project folder

   git clone https://github.com/yourusername/slack-dm-exporter-ts.git
   cd slack-dm-exporter-ts

   (or unzip the shared folder you received)

2. Install dependencies

   npm install

## 3. Create Slack App & Get Your User Token
1. Go to: https://api.slack.com/apps
2. Click Create New App → From scratch
3. Name it (e.g. “Personal DM Exporter”) and select your workspace
4. Click Create App
5. Left sidebar → OAuth & Permissions
6. Scroll to Scopes → User Token Scopes
7. Add/check exactly these scopes:

   - im:read
   - users:read
   - files:read
   - mpim:read
   - mpim:history
   - channels:read
   - channels:history

8. Scroll back to the top of the OAuth & Permissions page
9. Click Install to Workspace (or Reinstall to Workspace if already installed)
10. Review → click Allow
11. Copy the User OAuth Token that appears at the top (starts with xoxp-...)

This is a user token (xoxp-...), not a bot token. Keep it private.

## 4. Configure the Tool (.env file)
1. Copy the example file:

   cp .env.example .env

   (Windows: copy .env.example and rename it to .env)

2. Open .env in a text editor and fill in your values:

   ### Your Slack user token (xoxp-...)
   SLACK_TOKEN=xoxp-123456789012-123456789012-...

   ### Date range (YYYY-MM-DD format, inclusive)
   START_DATE=2025-01-01
   END_DATE=2026-03-10

   ### Output folder name (relative to project root or absolute path)
   OUTPUT_DIR=messageExport

   #### true = download files to OUTPUT_DIR/files/
   #### false = only include file URLs in the text files
   DOWNLOAD_FILES=true

3. Save the file

.env is already ignored by .gitignore — never commit or share it.

## 5. Run the Exporter
Easiest way (uses your .env settings)

   npm run start

With custom settings (overrides .env)

   npm run start -- --start 2024-01-01 --end 2024-12-31 --download-files false

   npm run start -- --token xoxp-your-token-here --start 2025-06-01 --end 2025-12-31

## 6. What You Get
- Folder created: messageExport/ (or whatever you named OUTPUT_DIR)
- One .txt file per DM that had messages in your date range
  - Example: DM_with_Bob.txt
  - Example: GroupDM_team-chat_DEF67890.txt
- Thread replies indented under parent messages
- Attached files:
  - URLs shown in the text file
  - Actual files downloaded to messageExport/files/ (if DOWNLOAD_FILES=true)
- _SUMMARY.txt file listing all exported conversations

## 7. Troubleshooting Quick Reference
- missing_scope error → Add missing scope + Reinstall to Workspace to refresh token
- No DMs exported → Widen date range or check you’re in those DMs
- File downloads fail → Confirm files:read scope is included
- Module / ts-node errors → Try npx tsx index.ts ... instead
- punycode deprecation warning → Harmless; prefix with NODE_NO_WARNINGS=DEP0040 npm run export

## 8. Security & Revoking Access
- This tool never sends your data anywhere — all processing is local
- Never share your .env file or token
- Revoke token anytime:
  1. Go to https://api.slack.com/apps
  2. Select your app
  3. OAuth & Permissions → Revoke Tokens

Happy archiving!
