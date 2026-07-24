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

Production follow-up work should periodically recheck holders and remove roles after transfers.

## Wallet submissions

Admins can run `/setup-wallet-submission` to post a wallet submission panel.

Required options:

- `channel`: where the embed and submit button are posted.
- `duration-minutes`: optional. If omitted, submissions stay open with no time limit.

Optional options:

- `allow-roles`: optional role mentions or role IDs separated by spaces or commas. If set, only members with at least one of those roles can submit. If empty, everyone can submit.

For `allow-roles`, paste roles into the input like `@Holder @OG @Whitelist` or paste role IDs like `123456789012345678, 234567890123456789`. Users click **Submit wallet**, enter an EVM wallet address, and receive an ephemeral confirmation. Each Discord account has one entry; submitting again updates that user’s wallet. Running `/setup-wallet-submission` again starts a new submission window and clears the previous wallet submission entries. If `duration-minutes` is omitted, the submission window has no automatic close time.

Admins can run `/close-wallet-submission` to close the current submission window immediately without deleting existing entries.

Admins can run `/export-wallet-submissions` to receive `wallet-submissions.csv` as an ephemeral attachment.

