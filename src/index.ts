import { randomBytes, randomInt } from "node:crypto";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Guild,
  GuildMember,
  Interaction,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextBasedChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { config } from "./config.js";
import { OpenSeaClient } from "./opensea.js";
import { ArcClient } from "./arc.js";
import { Raffle, RaffleEntry, VerificationStore } from "./store.js";

const VERIFY = "holder:verify";
const HOLDER_MODAL = "holder:wallet-modal";
const HOLDER_INPUT = "holder:wallet-address";
const CONFIRM = "holder:confirm";

const WALLET_SUBMIT = "wallet-submission:submit";
const WALLET_MODAL = "wallet-submission:modal";
const WALLET_INPUT = "wallet-submission:wallet-address";

const RAFFLE_ENTER = "raffle:enter";
const RAFFLE_DRAW_SELECT = "raffle:draw-select";
const RAFFLE_EXPORT_ENTRIES_SELECT = "raffle:export-entries-select";
const RAFFLE_EXPORT_WINNERS_SELECT = "raffle:export-winners-select";
const RAFFLE_DELETE_SELECT = "raffle:delete-select";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const store = new VerificationStore("data/verifications.json");
const openSea = new OpenSeaClient(config.openSeaApiKey, "", "");
const chain = new ArcClient(config.arcTestnetRpcUrl);

client.once(Events.ClientReady, (c) => {
  console.log("Logged in as " + c.user.tag);
  if (config.holderRoleSyncIntervalMs > 0) {
    setInterval(() => {
      syncHolderRoles("automatic").catch((e) => console.error("Holder role sync failed", e));
    }, config.holderRoleSyncIntervalMs);
  }
  setInterval(() => {
    drawEndedRaffles().catch((e) => console.error("Automatic raffle draw failed", e));
  }, 30_000);
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    await handle(i);
  } catch (e) {
    console.error(e);
    if (i.isRepliable()) {
      const x = { content: "Action failed. Try again later.", flags: MessageFlags.Ephemeral as const };
      i.replied || i.deferred ? await i.followUp(x) : await i.reply(x);
    }
  }
});

async function handle(i: Interaction) {
  if (i.isChatInputCommand() && i.commandName === "setup-verification") return handleSetupVerification(i);
  if (i.isChatInputCommand() && i.commandName === "setup-wallet-submission") return handleSetupWalletSubmission(i);
  if (i.isChatInputCommand() && i.commandName === "export-wallet-submissions") return handleExportWalletSubmissions(i);
  if (i.isChatInputCommand() && i.commandName === "close-wallet-submission") return handleCloseWalletSubmission(i);
  if (i.isChatInputCommand() && i.commandName === "resync-holder-roles") return handleResyncHolderRoles(i);
  if (i.isChatInputCommand() && i.commandName === "configure-raffle") return handleConfigureRaffle(i);
  if (i.isChatInputCommand() && i.commandName === "setup-raffle") return handleSetupRaffle(i);
  if (i.isChatInputCommand() && i.commandName === "set-raffle-wallet") return handleSetRaffleWallet(i);
  if (i.isChatInputCommand() && i.commandName === "draw-raffle") return handleDrawRaffleCommand(i);
  if (i.isChatInputCommand() && i.commandName === "export-entries") return handleExportEntriesCommand(i);
  if (i.isChatInputCommand() && i.commandName === "export-winners") return handleExportWinnersCommand(i);
  if (i.isChatInputCommand() && i.commandName === "delete-raffle") return handleDeleteRaffleCommand(i);

  if (i.isButton() && i.customId === VERIFY) return showHolderModal(i);
  if (i.isModalSubmit() && i.customId === HOLDER_MODAL) return handleHolderModal(i);
  if (i.isButton() && i.customId === CONFIRM) return handleHolderConfirm(i);

  if (i.isButton() && i.customId.startsWith(WALLET_SUBMIT + ":")) return handleWalletSubmitButton(i);
  if (i.isModalSubmit() && i.customId.startsWith(WALLET_MODAL + ":")) return handleWalletSubmitModal(i);

  if (i.isButton() && i.customId.startsWith(RAFFLE_ENTER + ":")) return handleRaffleEnter(i);
  if (i.isStringSelectMenu() && i.customId === RAFFLE_DRAW_SELECT) return handleDrawRaffleSelect(i);
  if (i.isStringSelectMenu() && i.customId === RAFFLE_EXPORT_ENTRIES_SELECT) return handleExportRaffleEntriesSelect(i);
  if (i.isStringSelectMenu() && i.customId === RAFFLE_EXPORT_WINNERS_SELECT) return handleExportRaffleWinnersSelect(i);
  if (i.isStringSelectMenu() && i.customId === RAFFLE_DELETE_SELECT) return handleDeleteRaffleSelect(i);
}

async function handleSetupVerification(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });

  const channel = i.options.getChannel("channel", true, [ChannelType.GuildText]);
  const contract = config.orixaContractAddress;
  const tiers: Array<{ roleId: string; nftCount: number }> = [];

  for (let n = 1; n <= 5; n++) {
    const role = i.options.getRole("role-" + n);
    const count = i.options.getInteger("nft-count-" + n);
    if ((role && count === null) || (!role && count !== null)) {
      await i.reply({ content: "Tier " + n + " needs both role and NFT count.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (role && count !== null) tiers.push({ roleId: role.id, nftCount: count });
  }

  if (new Set(tiers.map((t) => t.roleId)).size !== tiers.length || new Set(tiers.map((t) => t.nftCount)).size !== tiers.length) {
    await i.reply({ content: "Roles and thresholds must be unique.", flags: MessageFlags.Ephemeral });
    return;
  }

  tiers.sort((a, b) => a.nftCount - b.nftCount);
  const me = i.guild!.members.me;
  const bad = tiers.find((t) => {
    const r = i.guild!.roles.cache.get(t.roleId);
    return !r || r.managed || !me || r.position >= me.roles.highest.position;
  });

  if (bad) {
    await i.reply({ content: "Move my bot role above <@&" + bad.roleId + ">.", flags: MessageFlags.Ephemeral });
    return;
  }

  await store.setGuildSetup(i.guildId!, { channelId: channel.id, contractAddress: contract, tiers });

  const lines = tiers.map((t) => "- <@&" + t.roleId + ">: **" + t.nftCount + "+ NFTs**").join("\n");
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Verify Orixa holder status")
    .setDescription(
      [
        "Click **Verify holder** and submit your wallet address.",
        "Add the temporary code to your OpenSea profile bio, then confirm.",
        "",
        "**Contract**: " + contract,
        "**Arc Testnet**",
        "",
        "**Role tiers**",
        lines,
        "",
        "No transaction, approval, seed phrase, or private key is requested.",
      ].join("\n"),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(VERIFY).setLabel("Verify holder").setStyle(ButtonStyle.Success),
  );

  await channel.send({ embeds: [embed], components: [row] });
  await i.reply({ content: "Panel posted in <#" + channel.id + ">.", flags: MessageFlags.Ephemeral });
}

async function showHolderModal(i: Interaction) {
  if (!i.isButton()) return;
  const m = new ModalBuilder().setCustomId(HOLDER_MODAL).setTitle("NFT holder verification");
  const x = new TextInputBuilder()
    .setCustomId(HOLDER_INPUT)
    .setLabel("Your EVM wallet address")
    .setPlaceholder("0x...")
    .setStyle(TextInputStyle.Short)
    .setMinLength(42)
    .setMaxLength(42)
    .setRequired(true);
  m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(x));
  await i.showModal(m);
}

async function handleHolderModal(i: Interaction) {
  if (!i.isModalSubmit()) return;
  const wallet = i.fields.getTextInputValue(HOLDER_INPUT).trim().toLowerCase();
  if (!ADDRESS.test(wallet)) return i.reply({ content: "Invalid EVM wallet address.", flags: MessageFlags.Ephemeral });

  const owner = store.walletOwner(wallet);
  if (owner && owner !== i.user.id) return i.reply({ content: "Wallet already verified by another account.", flags: MessageFlags.Ephemeral });

  const code = "ORIXA-" + randomBytes(5).toString("hex").toUpperCase();
  await store.setPending({ discordUserId: i.user.id, walletAddress: wallet, code, expiresAt: Date.now() + config.verificationTtlMs });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CONFIRM).setLabel("Check OpenSea profile").setStyle(ButtonStyle.Primary),
  );
  await i.reply({
    content: "Add this code to the OpenSea bio for " + wallet + ":\n\n**" + code + "**\n\nSave it, then press below.",
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHolderConfirm(i: Interaction) {
  if (!i.isButton()) return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const p = store.getPending(i.user.id);
  if (!p) return i.editReply("No pending verification. Start again.");
  if (p.expiresAt < Date.now()) {
    await store.removePending(i.user.id);
    return i.editReply("Code expired. Start again.");
  }
  if (store.walletOwner(p.walletAddress) && store.walletOwner(p.walletAddress) !== i.user.id) return i.editReply("Wallet already claimed.");
  if (!(await openSea.profileContainsCode(p.walletAddress, p.code))) return i.editReply("Code is not visible in the OpenSea bio yet.");
  if (!i.inGuild() || i.guildId !== config.guildId) return i.editReply("Use the configured server.");

  const setup = store.getGuildSetup(i.guildId!);
  if (!setup) return i.editReply("Ask an admin to run /setup-verification.");

  const count = await chain.balance(setup.contractAddress, p.walletAddress);
  if (!setup.tiers.some((t) => count >= t.nftCount)) return i.editReply("Wallet holds " + count + " NFT(s), below the minimum.");

  const member = await i.guild!.members.fetch(i.user.id);
  const result = await syncMemberHolderRoles(member, setup, count);
  await store.markVerified(p);
  const granted = result.active.map((r) => "<@&" + r + ">").join(", ");
  await i.editReply("Verified with " + count + " NFT(s). Active holder roles: " + granted + ".");
}

async function handleSetupWalletSubmission(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });

  const rawName = i.options.getString("name", true);
  const submissionKey = normalizeKey(rawName);
  if (!submissionKey) return i.reply({ content: "Use a category name with letters, numbers, dashes, or underscores.", flags: MessageFlags.Ephemeral });

  const channel = i.options.getChannel("channel", true, [ChannelType.GuildText]);
  const durationMinutes = i.options.getInteger("duration-minutes");
  const allowedRoleIds = parseRoleIds(i.options.getString("allow-roles"));
  const missingRoleId = allowedRoleIds.find((roleId) => !i.guild!.roles.cache.has(roleId));
  if (missingRoleId) return i.reply({ content: "Role not found in this server: `" + missingRoleId + "`", flags: MessageFlags.Ephemeral });

  const missingPermissions = missingChannelPermissions(i.guild!, channel.id);
  if (missingPermissions.length) return i.reply({ content: missingChannelPermissionMessage(channel.id, missingPermissions), flags: MessageFlags.Ephemeral });

  const now = Date.now();
  const closesAt = durationMinutes ? now + durationMinutes * 60_000 : null;
  await store.setWalletSubmissionSetup(i.guildId!, submissionKey, { name: rawName, channelId: channel.id, allowedRoleIds, opensAt: now, closesAt });

  const roleLine = allowedRoleIds.length ? allowedRoleIds.map((r) => "<@&" + r + ">").join(", ") : "Everyone";
  const closeLine = closesAt ? "**Closes**: " + discordTime(closesAt) + " (" + discordRelative(closesAt) + ")" : "**Closes**: No time limit";
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Submit your wallet: " + rawName)
    .setDescription([
      "Click **Submit wallet** and enter your EVM wallet address.",
      "",
      "**Allowed entrants**: " + roleLine,
      closeLine,
      "",
      "**Category**: `" + submissionKey + "`",
      "One entry per Discord account per category. Submitting again updates your wallet for this category.",
    ].join("\n"));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(WALLET_SUBMIT + ":" + submissionKey).setLabel("Submit wallet").setStyle(ButtonStyle.Primary),
  );

  const message = await channel.send({ embeds: [embed], components: [row] });
  await store.updateWalletSubmissionMessage(i.guildId!, submissionKey, message.id);
  await i.reply({ content: "Wallet submission `" + submissionKey + "` posted in <#" + channel.id + ">.", flags: MessageFlags.Ephemeral });
}

async function handleCloseWalletSubmission(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  const submissionKey = normalizeKey(i.options.getString("name", true));
  const closed = await store.closeWalletSubmission(i.guildId!, submissionKey);
  if (!closed) return i.reply({ content: "Wallet submission `" + submissionKey + "` is not configured.", flags: MessageFlags.Ephemeral });
  await i.reply({ content: "Wallet submission `" + submissionKey + "` is now closed. Existing entries were kept and can still be exported.", flags: MessageFlags.Ephemeral });
}

async function handleExportWalletSubmissions(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  const submissionKey = normalizeKey(i.options.getString("name", true));
  const setup = store.getWalletSubmissionSetup(i.guildId!, submissionKey);
  if (!setup) return i.reply({ content: "Wallet submission `" + submissionKey + "` is not configured.", flags: MessageFlags.Ephemeral });
  const entries = store.getWalletSubmissions(i.guildId!, submissionKey);
  const rows = [
    ["discord_user_id", "discord_username", "wallet_address", "submitted_at_iso", "submitted_at_unix"],
    ...entries.sort((a, b) => a.submittedAt - b.submittedAt).map((e) => [e.discordUserId, e.discordUsername, e.walletAddress, new Date(e.submittedAt).toISOString(), String(e.submittedAt)]),
  ];
  await replyCsv(i, "Exported " + entries.length + " wallet submission(s) for `" + submissionKey + "`.", "wallet-submissions-" + submissionKey + ".csv", rows);
}

async function handleWalletSubmitButton(i: Interaction) {
  if (!i.isButton()) return;
  if (!i.inGuild()) return i.reply({ content: "Use this inside the server.", flags: MessageFlags.Ephemeral });
  const submissionKey = customIdSuffix(i.customId, WALLET_SUBMIT);
  const setup = store.getWalletSubmissionSetup(i.guildId!, submissionKey);
  if (!setup) return i.reply({ content: "Wallet submission `" + submissionKey + "` is not configured.", flags: MessageFlags.Ephemeral });
  if (setup.closesAt && Date.now() > setup.closesAt) return i.reply({ content: "Wallet submissions are closed.", flags: MessageFlags.Ephemeral });
  if (!memberHasAnyRole(i.member, setup.allowedRoleIds)) return i.reply({ content: "You do not have an allowed role for this submission.", flags: MessageFlags.Ephemeral });

  const m = new ModalBuilder().setCustomId(WALLET_MODAL + ":" + submissionKey).setTitle("Submit wallet address");
  const x = new TextInputBuilder().setCustomId(WALLET_INPUT).setLabel("Your EVM wallet address").setPlaceholder("0x...").setStyle(TextInputStyle.Short).setMinLength(42).setMaxLength(42).setRequired(true);
  m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(x));
  await i.showModal(m);
}

async function handleWalletSubmitModal(i: Interaction) {
  if (!i.isModalSubmit()) return;
  if (!i.inGuild()) return i.reply({ content: "Use this inside the server.", flags: MessageFlags.Ephemeral });
  const submissionKey = customIdSuffix(i.customId, WALLET_MODAL);
  const setup = store.getWalletSubmissionSetup(i.guildId!, submissionKey);
  if (!setup) return i.reply({ content: "Wallet submission `" + submissionKey + "` is not configured.", flags: MessageFlags.Ephemeral });
  if (setup.closesAt && Date.now() > setup.closesAt) return i.reply({ content: "Wallet submissions are closed.", flags: MessageFlags.Ephemeral });
  if (!memberHasAnyRole(i.member, setup.allowedRoleIds)) return i.reply({ content: "You do not have an allowed role for this submission.", flags: MessageFlags.Ephemeral });
  const wallet = i.fields.getTextInputValue(WALLET_INPUT).trim().toLowerCase();
  if (!ADDRESS.test(wallet)) return i.reply({ content: "Invalid EVM wallet address.", flags: MessageFlags.Ephemeral });
  await store.addWalletSubmission(i.guildId!, submissionKey, { discordUserId: i.user.id, discordUsername: i.user.tag, walletAddress: wallet, submittedAt: Date.now() });
  await i.reply({ content: "Wallet submitted for `" + submissionKey + "`: `" + wallet + "`", flags: MessageFlags.Ephemeral });
}

async function handleConfigureRaffle(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  const announce = i.options.getChannel("announce-channel", false, [ChannelType.GuildText]);
  const winner = i.options.getChannel("winner-channel", false, [ChannelType.GuildText]);
  if (!announce && !winner) return i.reply({ content: "Set at least one default channel.", flags: MessageFlags.Ephemeral });
  if (announce) {
    const missing = missingChannelPermissions(i.guild!, announce.id);
    if (missing.length) return i.reply({ content: missingChannelPermissionMessage(announce.id, missing), flags: MessageFlags.Ephemeral });
  }
  if (winner) {
    const missing = missingChannelPermissions(i.guild!, winner.id);
    if (missing.length) return i.reply({ content: missingChannelPermissionMessage(winner.id, missing), flags: MessageFlags.Ephemeral });
  }
  await store.setRaffleConfig(i.guildId!, { announceChannelId: announce?.id, winnerChannelId: winner?.id });
  const config = store.getRaffleConfig(i.guildId!);
  await i.reply({ content: "Raffle defaults updated. Announce: " + channelText(config.announceChannelId) + ". Winners: " + channelText(config.winnerChannelId) + ".", flags: MessageFlags.Ephemeral });
}

async function handleSetupRaffle(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  const rawName = i.options.getString("name", true);
  const raffleKey = normalizeKey(rawName);
  if (!raffleKey) return i.reply({ content: "Use a raffle name with letters, numbers, dashes, or underscores.", flags: MessageFlags.Ephemeral });
  const winnerCount = i.options.getInteger("winners", true);
  const defaults = store.getRaffleConfig(i.guildId!);
  const announceChannel = i.options.getChannel("announce-channel", false, [ChannelType.GuildText]);
  const winnerChannel = i.options.getChannel("winner-channel", false, [ChannelType.GuildText]);
  const announceChannelId = announceChannel?.id ?? defaults.announceChannelId;
  const winnerChannelId = winnerChannel?.id ?? defaults.winnerChannelId;
  if (!announceChannelId) return i.reply({ content: "Set `announce-channel` or configure a default with `/configure-raffle`.", flags: MessageFlags.Ephemeral });
  if (!winnerChannelId) return i.reply({ content: "Set `winner-channel` or configure a default with `/configure-raffle`.", flags: MessageFlags.Ephemeral });

  const durationInput = i.options.getString("duration");
  const durationMs = durationInput ? parseDurationMs(durationInput) : null;
  if (durationInput && !durationMs) return i.reply({ content: "Invalid duration. Use formats like `1d`, `1hr`, `10min`, `10sec`, or `1d 2hr`.", flags: MessageFlags.Ephemeral });
  const allowedRoleIds = parseRoleIds(i.options.getString("allow-roles"));
  const missingRoleId = allowedRoleIds.find((roleId) => !i.guild!.roles.cache.has(roleId));
  if (missingRoleId) return i.reply({ content: "Role not found in this server: `" + missingRoleId + "`", flags: MessageFlags.Ephemeral });

  for (const channelId of new Set([announceChannelId, winnerChannelId])) {
    const missing = missingChannelPermissions(i.guild!, channelId);
    if (missing.length) return i.reply({ content: missingChannelPermissionMessage(channelId, missing), flags: MessageFlags.Ephemeral });
  }

  const now = Date.now();
  const endsAt = durationMs ? now + durationMs : null;
  const raffle: Raffle = {
    key: raffleKey,
    name: rawName,
    announceChannelId,
    winnerChannelId,
    winnerCount,
    allowedRoleIds,
    startsAt: now,
    endsAt,
    drawnAt: null,
    entries: {},
    winners: [],
  };
  await store.setRaffle(i.guildId!, raffle);

  const announce = await client.channels.fetch(announceChannelId);
  if (!announce?.isTextBased() || !("send" in announce)) return i.reply({ content: "Announce channel is not available.", flags: MessageFlags.Ephemeral });
  const message = await announce.send({ embeds: [raffleEmbed(raffle)], components: [raffleEnterRow(raffleKey)] });
  await store.updateRaffleMessage(i.guildId!, raffleKey, message.id);
  await i.reply({ content: "Raffle `" + raffleKey + "` posted in <#" + announceChannelId + ">.", flags: MessageFlags.Ephemeral });
}

async function handleSetRaffleWallet(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!i.inGuild()) return i.reply({ content: "Use this inside the server.", flags: MessageFlags.Ephemeral });
  const wallet = i.options.getString("wallet-address", true).trim().toLowerCase();
  if (!ADDRESS.test(wallet)) return i.reply({ content: "Invalid EVM wallet address.", flags: MessageFlags.Ephemeral });
  await store.setRaffleWallet(i.guildId!, i.user.id, wallet);
  await i.reply({ content: "Raffle wallet set: `" + wallet + "`", flags: MessageFlags.Ephemeral });
}

async function handleRaffleEnter(i: Interaction) {
  if (!i.isButton()) return;
  if (!i.inGuild()) return i.reply({ content: "Use this inside the server.", flags: MessageFlags.Ephemeral });
  const raffleKey = customIdSuffix(i.customId, RAFFLE_ENTER);
  const raffle = store.getRaffle(i.guildId!, raffleKey);
  if (!raffle) return i.reply({ content: "Raffle `" + raffleKey + "` is not configured.", flags: MessageFlags.Ephemeral });
  if (raffle.drawnAt) return i.reply({ content: "This raffle has already been drawn.", flags: MessageFlags.Ephemeral });
  if (raffle.endsAt && Date.now() > raffle.endsAt) return i.reply({ content: "This raffle has ended. Winners will be drawn by the bot/admin.", flags: MessageFlags.Ephemeral });
  if (!memberHasAnyRole(i.member, raffle.allowedRoleIds)) return i.reply({ content: "You do not have an allowed role for this raffle.", flags: MessageFlags.Ephemeral });
  const wallet = store.getRaffleWallet(i.guildId!, i.user.id);
  if (!wallet) return i.reply({ content: "Set your raffle wallet first with `/set-raffle-wallet`.", flags: MessageFlags.Ephemeral });
  const updated = await store.addRaffleEntry(i.guildId!, raffleKey, { discordUserId: i.user.id, discordUsername: i.user.tag, walletAddress: wallet, enteredAt: Date.now() });
  if (updated) await refreshRaffleAnnounceMessage(updated);
  await i.reply({ content: "Entered raffle `" + raffleKey + "` with wallet `" + wallet + "`.", flags: MessageFlags.Ephemeral });
}

async function handleDrawRaffleCommand(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  const raffles = store.listActiveRaffles(i.guildId!);
  await replyRaffleSelect(i, raffles, RAFFLE_DRAW_SELECT, "Select an active raffle to draw.", "No active raffles to draw.");
}

async function handleExportEntriesCommand(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  await replyRaffleSelect(i, store.listEndedOrDrawnRaffles(i.guildId!), RAFFLE_EXPORT_ENTRIES_SELECT, "Select an ended/drawn raffle to export entries.", "No ended or drawn raffles to export.");
}

async function handleExportWinnersCommand(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  await replyRaffleSelect(i, store.listEndedOrDrawnRaffles(i.guildId!), RAFFLE_EXPORT_WINNERS_SELECT, "Select an ended/drawn raffle to export winners.", "No ended or drawn raffles to export.");
}

async function handleDeleteRaffleCommand(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  await replyRaffleSelect(i, store.listActiveRaffles(i.guildId!), RAFFLE_DELETE_SELECT, "Select an active raffle to delete.", "No active raffles to delete.");
}

async function handleDrawRaffleSelect(i: Interaction) {
  if (!i.isStringSelectMenu()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  await i.deferUpdate();
  const raffleKey = i.values[0];
  if (!raffleKey) return i.editReply({ content: "No raffle selected.", components: [] });
  const raffle = await drawRaffle(i.guildId!, raffleKey, "manual");
  if (!raffle) return i.editReply({ content: "Raffle `" + raffleKey + "` is not configured.", components: [] });
  await i.editReply({ content: drawSummary(raffle), components: [] });
}

async function handleExportRaffleEntriesSelect(i: Interaction) {
  if (!i.isStringSelectMenu()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  const raffleKey = i.values[0];
  if (!raffleKey) return i.reply({ content: "No raffle selected.", flags: MessageFlags.Ephemeral });
  const raffle = store.getRaffle(i.guildId!, raffleKey);
  if (!raffle) return i.reply({ content: "Raffle `" + raffleKey + "` is not configured.", flags: MessageFlags.Ephemeral });
  const entries = Object.values(raffle.entries).sort((a, b) => a.enteredAt - b.enteredAt);
  const rows = [["discord_user_id", "discord_username", "wallet_address"], ...entries.map((e) => [e.discordUserId, e.discordUsername, e.walletAddress])];
  await replyCsv(i, "Exported " + entries.length + " raffle entrie(s) for `" + raffleKey + "`.", "raffle-entries-" + raffleKey + ".csv", rows, true);
}

async function handleExportRaffleWinnersSelect(i: Interaction) {
  if (!i.isStringSelectMenu()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  const raffleKey = i.values[0];
  if (!raffleKey) return i.reply({ content: "No raffle selected.", flags: MessageFlags.Ephemeral });
  const raffle = store.getRaffle(i.guildId!, raffleKey);
  if (!raffle) return i.reply({ content: "Raffle `" + raffleKey + "` is not configured.", flags: MessageFlags.Ephemeral });
  const rows = [["discord_user_id", "discord_username", "wallet_address"], ...raffle.winners.map((e) => [e.discordUserId, e.discordUsername, e.walletAddress])];
  await replyCsv(i, "Exported " + raffle.winners.length + " raffle winner(s) for `" + raffleKey + "`.", "raffle-winners-" + raffleKey + ".csv", rows, true);
}

async function handleDeleteRaffleSelect(i: Interaction) {
  if (!i.isStringSelectMenu()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  const raffleKey = i.values[0];
  if (!raffleKey) return i.update({ content: "No raffle selected.", components: [] });
  const deleted = await store.deleteRaffle(i.guildId!, raffleKey);
  await i.update({ content: deleted ? "Deleted active raffle `" + raffleKey + "`." : "Raffle `" + raffleKey + "` is not configured.", components: [] });
}

async function drawEndedRaffles() {
  const now = Date.now();
  const due = store.listActiveRaffles(config.guildId).filter((r) => r.endsAt && r.endsAt <= now);
  for (const raffle of due) await drawRaffle(config.guildId, raffle.key, "automatic");
}

async function drawRaffle(guildId: string, raffleKey: string, reason: "manual" | "automatic") {
  const raffle = store.getRaffle(guildId, raffleKey);
  if (!raffle) return undefined;
  if (raffle.drawnAt) return raffle;
  const winners = pickWinners(Object.values(raffle.entries), raffle.winnerCount);
  const drawn = await store.setRaffleWinners(guildId, raffleKey, winners, Date.now());
  if (!drawn) return undefined;
  await postWinners(drawn, reason);
  return drawn;
}

async function postWinners(raffle: Raffle, reason: "manual" | "automatic") {
  const channel = await client.channels.fetch(raffle.winnerChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  await channel.send({ embeds: [winnerEmbed(raffle, reason)] });
}

function pickWinners(entries: RaffleEntry[], winnerCount: number) {
  const pool = [...entries];
  const winners: RaffleEntry[] = [];
  const max = Math.min(winnerCount, pool.length);
  for (let i = 0; i < max; i++) {
    const index = randomInt(pool.length);
    winners.push(pool[index]!);
    pool.splice(index, 1);
  }
  return winners;
}

async function handleResyncHolderRoles(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!isGuildAdmin(i)) return i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await syncHolderRoles("manual");
  await i.editReply("Holder role sync complete. Checked " + result.checked + " wallet(s). Added roles for " + result.membersWithAdds + " member(s), removed roles from " + result.membersWithRemoves + " member(s), skipped " + result.skipped + ".");
}

async function syncHolderRoles(reason: "manual" | "automatic") {
  const setup = store.getGuildSetup(config.guildId);
  const verified = store.getVerifiedWallets();
  const result = { checked: 0, skipped: 0, membersWithAdds: 0, membersWithRemoves: 0 };
  if (!setup || !verified.length) return result;

  const guild = await client.guilds.fetch(config.guildId);
  await guild.roles.fetch();
  await guild.members.fetchMe();
  const manageable = setup.tiers.filter((tier) => canManageRole(guild, tier.roleId));
  const manageableRoleIds = new Set(manageable.map((tier) => tier.roleId));
  const syncSetup = { ...setup, tiers: setup.tiers.filter((tier) => manageableRoleIds.has(tier.roleId)) };
  if (!syncSetup.tiers.length) return { ...result, skipped: verified.length };

  for (const entry of verified) {
    try {
      const member = await guild.members.fetch(entry.discordUserId).catch(() => null);
      if (!member) {
        result.skipped++;
        continue;
      }
      const count = await chain.balance(syncSetup.contractAddress, entry.walletAddress);
      const memberResult = await syncMemberHolderRoles(member, syncSetup, count);
      result.checked++;
      if (memberResult.added.length) result.membersWithAdds++;
      if (memberResult.removed.length) result.membersWithRemoves++;
    } catch (e) {
      result.skipped++;
      console.error("Failed to sync holder roles for " + entry.discordUserId + " during " + reason + " sync", e);
    }
  }
  return result;
}

async function syncMemberHolderRoles(member: GuildMember, setup: { tiers: Array<{ roleId: string; nftCount: number }> }, nftCount: number) {
  const all = setup.tiers.map((t) => t.roleId);
  const qualified = setup.tiers.filter((t) => nftCount >= t.nftCount);
  const active = qualified.map((t) => t.roleId);
  const add = active.filter((roleId) => !member.roles.cache.has(roleId));
  const remove = all.filter((roleId) => member.roles.cache.has(roleId) && !active.includes(roleId));
  if (remove.length) await member.roles.remove(remove, "Orixa holder role resync");
  if (add.length) await member.roles.add(add, "Orixa holder role resync");
  return { added: add, removed: remove, active };
}

function raffleEmbed(raffle: Raffle) {
  const roles = raffle.allowedRoleIds.length ? raffle.allowedRoleIds.map((r) => "<@&" + r + ">").join(", ") : "Everyone";
  const ends = raffle.endsAt ? discordTime(raffle.endsAt) + " (" + discordRelative(raffle.endsAt) + ")" : "Manual draw only";
  const entrants = Object.keys(raffle.entries).length;
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🎟️ Orixa Raffle — " + raffle.name)
    .setDescription([
      "A raffle is open for the Orixa community.",
      "",
      "Set your raffle wallet with `/set-raffle-wallet`, then click **Enter raffle** below.",
      "",
      "No transaction, approval, seed phrase, or private key is requested.",
    ].join("\n"))
    .addFields(
      { name: "🏆 Winners", value: String(raffle.winnerCount), inline: true },
      { name: "👥 Entrants", value: String(entrants), inline: true },
      { name: "⏳ Ends", value: ends, inline: false },
      { name: "📣 Winner channel", value: "<#" + raffle.winnerChannelId + ">", inline: true },
      { name: "🔒 Eligible roles", value: roles, inline: false },
    )
    .setFooter({ text: "One entry per Discord account. Re-entering updates your saved wallet for this raffle." });
}

async function refreshRaffleAnnounceMessage(raffle: Raffle) {
  if (!raffle.messageId) return;
  const channel = await client.channels.fetch(raffle.announceChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel)) return;
  const message = await channel.messages.fetch(raffle.messageId).catch(() => null);
  if (!message) return;
  await message.edit({ embeds: [raffleEmbed(raffle)], components: [raffleEnterRow(raffle.key)] }).catch(() => undefined);
}

function winnerEmbed(raffle: Raffle, reason: "manual" | "automatic") {
  const winners = raffle.winners.length ? raffle.winners.map((w, idx) => `${idx + 1}. <@${w.discordUserId}> — \`${w.walletAddress}\``).join("\n") : "No entries. No winners selected.";
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Raffle winners: " + raffle.name)
    .setDescription(["Draw type: **" + reason + "**", "", winners].join("\n"));
}

function raffleEnterRow(raffleKey: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(RAFFLE_ENTER + ":" + raffleKey).setLabel("Enter raffle").setStyle(ButtonStyle.Success),
  );
}

async function replyRaffleSelect(i: Interaction, raffles: Raffle[], customId: string, prompt: string, empty: string) {
  if (!i.isChatInputCommand()) return;
  const options = raffles.slice(0, 25).map((raffle) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(raffle.name.slice(0, 100))
      .setDescription((Object.keys(raffle.entries).length + " entries" + (raffle.drawnAt ? " • drawn" : raffle.endsAt && raffle.endsAt <= Date.now() ? " • ended" : " • active")).slice(0, 100))
      .setValue(raffle.key),
  );
  if (!options.length) return i.reply({ content: empty, flags: MessageFlags.Ephemeral });
  const select = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("Select raffle").addOptions(options);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  await i.reply({ content: prompt, components: [row], flags: MessageFlags.Ephemeral });
}

function drawSummary(raffle: Raffle) {
  if (!raffle.winners.length) return "Raffle `" + raffle.key + "` was drawn, but there were no entries.";
  return "Raffle `" + raffle.key + "` winners: " + raffle.winners.map((w) => "<@" + w.discordUserId + ">").join(", ");
}

async function replyCsv(i: Interaction, content: string, filename: string, rows: string[][], update = false) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: filename });
  if (update && i.isStringSelectMenu()) {
    await i.update({ content, components: [], files: [file] });
    return;
  }
  if (i.isRepliable()) await i.reply({ content, files: [file], flags: MessageFlags.Ephemeral });
}

function parseDurationMs(input: string) {
  const matches = [...input.toLowerCase().matchAll(/(\d+)\s*(d|day|days|hr|hrs|hour|hours|min|mins|minute|minutes|sec|secs|second|seconds)/g)];
  if (!matches.length) return null;
  let total = 0;
  for (const match of matches) {
    const value = Number(match[1]);
    const unit = String(match[2] ?? "");
    if (unit.startsWith("d")) total += value * 86_400_000;
    else if (unit.startsWith("h")) total += value * 3_600_000;
    else if (unit.startsWith("min")) total += value * 60_000;
    else if (unit.startsWith("sec")) total += value * 1_000;
  }
  return total > 0 ? total : null;
}

function isGuildAdmin(i: Interaction) {
  return Boolean(i.inGuild() && i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function missingChannelPermissions(guild: Guild, channelId: string) {
  const channel = guild.channels.cache.get(channelId);
  const me = guild.members.me;
  const permissions = channel && me ? channel.permissionsFor(me) : null;
  return [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  ].filter(([permission]) => !permissions?.has(permission as bigint)).map(([, label]) => String(label));
}

function missingChannelPermissionMessage(channelId: string, missing: string[]) {
  return "I cannot post in <#" + channelId + ">. Missing permission(s): " + missing.join(", ") + ".";
}

function memberHasAnyRole(member: Interaction["member"], allowedRoleIds: string[]) {
  if (!allowedRoleIds.length) return true;
  if (!member) return false;
  if (member instanceof GuildMember) return allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
  return allowedRoleIds.some((roleId) => member.roles.includes(roleId));
}

function canManageRole(guild: Guild, roleId: string) {
  const me = guild.members.me;
  const role = guild.roles.cache.get(roleId);
  return Boolean(me && role && !role.managed && role.position < me.roles.highest.position);
}

function parseRoleIds(input: string | null) {
  if (!input) return [];
  const ids = [...input.matchAll(/<@&(?<mentionId>\d+)>|(?<plainId>\d{17,20})/g)].map((match) => match.groups?.mentionId ?? match.groups?.plainId ?? "");
  return [...new Set(ids.filter(Boolean))];
}

function normalizeKey(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

function customIdSuffix(customId: string, prefix: string) {
  return customId.slice(prefix.length + 1);
}

function channelText(channelId?: string) {
  return channelId ? "<#" + channelId + ">" : "not set";
}

function discordTime(ms: number) {
  return "<t:" + Math.floor(ms / 1000) + ":F>";
}

function discordRelative(ms: number) {
  return "<t:" + Math.floor(ms / 1000) + ":R>";
}

function csvCell(value: string) {
  return '"' + value.replaceAll('"', '""') + '"';
}

await store.initialize();
await client.login(config.discordToken);
