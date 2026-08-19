import "dotenv/config";
import { ChannelType, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from "discord.js";

const req = (n: string) => {
  const v = process.env[n]?.trim();
  if (!v) throw Error("Missing " + n);
  return v;
};

const verification = new SlashCommandBuilder()
  .setName("setup-verification")
  .setDescription("Configure NFT verification")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o.setName("channel").setDescription("Verification channel").addChannelTypes(ChannelType.GuildText).setRequired(true),
  )
  .addRoleOption((o) => o.setName("role-1").setDescription("First role").setRequired(true))
  .addIntegerOption((o) => o.setName("nft-count-1").setDescription("NFTs for first role").setMinValue(1).setRequired(true));

for (let i = 2; i <= 5; i++) {
  verification
    .addRoleOption((o) => o.setName("role-" + i).setDescription("Role tier " + i))
    .addIntegerOption((o) => o.setName("nft-count-" + i).setDescription("NFTs for tier " + i).setMinValue(1));
}

const walletSubmission = new SlashCommandBuilder()
  .setName("setup-wallet-submission")
  .setDescription("Post a wallet submission panel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addStringOption((o) =>
    o.setName("name").setDescription("Submission category name, like og, whitelist, collab-a").setMaxLength(32).setRequired(true),
  )
  .addChannelOption((o) =>
    o.setName("channel").setDescription("Submission channel").addChannelTypes(ChannelType.GuildText).setRequired(true),
  )
  .addIntegerOption((o) =>
    o.setName("duration-minutes").setDescription("Optional: how long submissions stay open").setMinValue(1).setRequired(false),
  )
  .addStringOption((o) =>
    o
      .setName("allow-roles")
      .setDescription("Optional role mentions or IDs allowed to submit, separated by spaces or commas")
      .setRequired(false),
  );

const exportWalletSubmissions = new SlashCommandBuilder()
  .setName("export-wallet-submissions")
  .setDescription("Export wallet submissions as a CSV file")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addStringOption((o) =>
    o.setName("name").setDescription("Submission category name to export").setMaxLength(32).setRequired(true),
  );

const closeWalletSubmission = new SlashCommandBuilder()
  .setName("close-wallet-submission")
  .setDescription("Close a wallet submission window")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addStringOption((o) =>
    o.setName("name").setDescription("Submission category name to close").setMaxLength(32).setRequired(true),
  );

const myWalletSubmissions = new SlashCommandBuilder()
  .setName("my-wallet-submissions")
  .setDescription("Check your submitted wallet entries")
  .setDMPermission(false);

const resyncHolderRoles = new SlashCommandBuilder()
  .setName("resync-holder-roles")
  .setDescription("Recheck verified wallets and sync holder roles")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

const configureRaffle = new SlashCommandBuilder()
  .setName("configure-raffle")
  .setDescription("Configure default raffle channels")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o.setName("announce-channel").setDescription("Default raffle announce channel").addChannelTypes(ChannelType.GuildText).setRequired(false),
  )
  .addChannelOption((o) =>
    o.setName("winner-channel").setDescription("Default raffle winner channel").addChannelTypes(ChannelType.GuildText).setRequired(false),
  );

const setupRaffle = new SlashCommandBuilder()
  .setName("setup-raffle")
  .setDescription("Create a raffle")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addStringOption((o) => o.setName("name").setDescription("Raffle name").setMaxLength(32).setRequired(true))
  .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners").setMinValue(1).setMaxValue(100).setRequired(true))
  .addStringOption((o) => o.setName("duration").setDescription("Optional duration like 1d, 1hr, 10min, 10sec").setRequired(false))
  .addChannelOption((o) =>
    o.setName("announce-channel").setDescription("Override raffle announce channel").addChannelTypes(ChannelType.GuildText).setRequired(false),
  )
  .addChannelOption((o) =>
    o.setName("winner-channel").setDescription("Override raffle winner channel").addChannelTypes(ChannelType.GuildText).setRequired(false),
  )
  .addStringOption((o) =>
    o.setName("allow-roles").setDescription("Optional role mentions or IDs allowed to enter").setRequired(false),
  )
  .addStringOption((o) =>
    o.setName("x-link").setDescription("Optional X profile URL for the Follow button").setRequired(false),
  )
  .addStringOption((o) =>
    o.setName("tweet-link").setDescription("Optional tweet URL for the Tweet button").setRequired(false),
  );

const setRaffleWallet = new SlashCommandBuilder()
  .setName("set-raffle-wallet")
  .setDescription("Set your wallet address for raffle entries")
  .setDMPermission(false)
  .addStringOption((o) => o.setName("wallet-address").setDescription("Your EVM wallet address").setMinLength(42).setMaxLength(42).setRequired(true));

const drawRaffle = new SlashCommandBuilder()
  .setName("draw-raffle")
  .setDescription("Draw winners from an active raffle")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

const exportEntries = new SlashCommandBuilder()
  .setName("export-entries")
  .setDescription("Export ended or drawn raffle entries")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

const exportWinners = new SlashCommandBuilder()
  .setName("export-winners")
  .setDescription("Export ended or drawn raffle winners")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

const deleteRaffle = new SlashCommandBuilder()
  .setName("delete-raffle")
  .setDescription("Delete an active raffle")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

const announceWinners = new SlashCommandBuilder()
  .setName("announce-winners")
  .setDescription("Re-post the winners of an already drawn raffle")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o
      .setName("winner-channel")
      .setDescription("Optional: post to this channel instead, and save it as the raffle winner channel")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false),
  );

// DISCORD_GUILD_IDS takes a comma/space separated list so commands land in every server
// the bot serves. DISCORD_GUILD_ID stays supported as the single-guild fallback.
const guildIds = [
  ...new Set(
    (process.env.DISCORD_GUILD_IDS?.trim() || req("DISCORD_GUILD_ID"))
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean),
  ),
];

const body = [
  verification.toJSON(),
  walletSubmission.toJSON(),
  exportWalletSubmissions.toJSON(),
  closeWalletSubmission.toJSON(),
  myWalletSubmissions.toJSON(),
  resyncHolderRoles.toJSON(),
  configureRaffle.toJSON(),
  setupRaffle.toJSON(),
  setRaffleWallet.toJSON(),
  drawRaffle.toJSON(),
  exportEntries.toJSON(),
  exportWinners.toJSON(),
  deleteRaffle.toJSON(),
  announceWinners.toJSON(),
];

const rest = new REST({ version: "10" }).setToken(req("DISCORD_TOKEN"));
const clientId = req("DISCORD_CLIENT_ID");

for (const guildId of guildIds) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  console.log("Commands deployed to guild " + guildId);
}
