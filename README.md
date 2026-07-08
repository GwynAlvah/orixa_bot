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
