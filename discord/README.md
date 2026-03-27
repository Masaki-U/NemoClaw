# Discord Setup

This directory keeps the Discord-side setup inputs next to the fork without
mixing secrets into tracked project files.

Files

- `env.example`: values you will gather from the Discord Developer Portal

Required for NemoClaw

- `DISCORD_BOT_TOKEN`

Useful for install / verification

- `DISCORD_APP_ID`
- `DISCORD_PUBLIC_KEY`
- `DISCORD_GUILD_ID`

Recommended flow

1. Create a Discord server for this assistant.
2. Create a Discord application and bot in the Discord Developer Portal.
3. On the app Installation page, enable at least:
   - `applications.commands`
   - `bot`
4. Give the bot at least these permissions:
   - View Channels
   - Send Messages
   - Read Message History
5. Install the bot into your new server.
6. Copy the values into a local `.env` file based on `env.example`.
7. Put `DISCORD_BOT_TOKEN` into the environment NemoClaw uses.
8. Start the NemoClaw services and verify the bot appears in the server member list.

Mobile note

Any normal Discord server is reachable from the Discord iOS/Android app once
your account is joined to the server. You do not need a separate mobile-only
server setup.

Official references

- Discord bot quick start:
  https://docs.discord.com/developers/quick-start/getting-started
- Discord getting started:
  https://support.discord.com/hc/en-us/articles/360033931551-Getting-Started
