# Orixa Discord NFT verification bot

The bot verifies an OpenSea profile challenge, reads Orixa ERC-721 ownership directly from Arc Testnet, and grants configured Discord role tiers.

## Setup

1. Create a Discord bot and invite it with bot and applications.commands scopes.
2. Give it View Channels, Send Messages, Embed Links, and Manage Roles.
3. Place its bot role above every holder role.
4. Copy the variables from .env.example into .env and fill them in.
5. Obtain an OpenSea API key.
6. Install and run:

    npm install
    npm run deploy:commands
    npm start

Run /setup-verification and provide the target channel, and up to five role/count tiers. Qualifying tiers are cumulative.

Holder roles are resynced automatically every `HOLDER_ROLE_SYNC_INTERVAL_MINUTES` minutes. Set it to `0` to disable the automatic loop.

Admins can also run `/resync-holder-roles` to manually recheck all verified wallets. If a verified wallet no longer holds enough Orixa NFTs, the bot removes the configured holder tier roles from that Discord member. If the wallet still qualifies, the bot adds/updates the correct tier roles.

## Wallet submissions

Admins can run `/setup-wallet-submission` multiple times to create multiple independent wallet submission categories.

Required options:

- `name`: category name, for example `og`, `wl`, `collab-a`, or `raffle-1`.
- `channel`: where the embed and submit button are posted.

Optional options:

- `duration-minutes`: optional. If omitted, submissions stay open with no time limit.
- `allow-roles`: optional role mentions or role IDs separated by spaces or commas. If set, only members with at least one of those roles can submit. If empty, everyone can submit.

For `allow-roles`, paste roles into the input like `@Holder @OG @Whitelist` or paste role IDs like `123456789012345678, 234567890123456789`.

Each posted panel is tied to its own `name`, channel, role limits, close time, and entries. Users click **Submit wallet**, enter an EVM wallet address, and receive an ephemeral confirmation. Each Discord account has one entry per category; submitting again updates that user’s wallet for that category.

Users can run `/my-wallet-submissions` to check their own submitted wallets across all wallet-submission categories.

Running `/setup-wallet-submission` again with the same `name` resets that category and clears that category’s previous entries. Other categories are not affected.

Admins can run `/close-wallet-submission name:<category>` to close one submission category immediately without deleting existing entries.

Admins can run `/export-wallet-submissions name:<category>` to receive that category’s CSV as an ephemeral attachment.

## Raffles

Admins can configure default raffle channels:

    /configure-raffle announce-channel:#raffles winner-channel:#winners

Users must set a raffle wallet before entering:

    /set-raffle-wallet wallet-address:0x...

Admins create raffles with:

    /setup-raffle name:og winners:5 duration:1d allow-roles:@OG x-link:https://x.com/orixa tweet-link:https://x.com/orixa/status/...

Options:

- `name`: required raffle name.
- `winners`: required number of winners.
- `duration`: optional. Supports `1d`, `1hr`, `10min`, `10sec`, and combined values like `1d 2hr`.
- `announce-channel`: optional if configured with `/configure-raffle`.
- `winner-channel`: optional if configured with `/configure-raffle`.
- `allow-roles`: optional role mentions or role IDs. If empty, everyone can enter.
- `x-link`: optional X profile URL used by the **Follow on X** button.
- `tweet-link`: optional tweet URL used by the **View Tweet** button.

The bot posts an **Enter raffle** button in the announce channel. Users can enter once per raffle; clicking again updates their entry with their current saved raffle wallet.

Admins can draw manually:

    /draw-raffle

The command shows a dropdown of active raffles. Drawing saves winners permanently and posts them to the raffle winner channel. If a raffle has a duration and is already manually drawn, the automatic end-time draw will not draw winners again.

Automatic drawing runs for raffles with a duration when their end time is reached.

Admins can export ended or drawn raffle data:

    /export-entries
    /export-winners

Both commands show a dropdown of ended or drawn raffles and export CSV files with:

    discord_user_id,discord_username,wallet_address

Admins can delete active raffles:

    /delete-raffle

The command shows a dropdown of active raffles and deletes the selected raffle, including its entries and winners.

