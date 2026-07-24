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

const resyncHolderRoles = new SlashCommandBuilder()
  .setName("resync-holder-roles")
  .setDescription("Recheck verified wallets and sync holder roles")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

await new REST({ version: "10" })
  .setToken(req("DISCORD_TOKEN"))
  .put(Routes.applicationGuildCommands(req("DISCORD_CLIENT_ID"), req("DISCORD_GUILD_ID")), {
    body: [
      verification.toJSON(),
      walletSubmission.toJSON(),
      exportWalletSubmissions.toJSON(),
      closeWalletSubmission.toJSON(),
      resyncHolderRoles.toJSON(),
    ],
  });

console.log("Commands deployed");
