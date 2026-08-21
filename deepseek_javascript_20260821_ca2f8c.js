// index.js
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { Riffy } = require('riffy');
const config = require('./config.js');
const express = require('express');
require('dotenv').config();

// Hàm khởi động server Express
function startExpressServer() {
  if (config.express.enabled) {
    const app = express();

    app.get('/', (req, res) => {
      res.json({
        status: 'online',
        bot: client.user ? client.user.tag : 'Đang khởi động...',
        servers: client.guilds.cache ? client.guilds.cache.size : 0,
        uptime: process.uptime(),
        lavalink: isLavalinkConnected ? 'đã kết nối' : 'ngắt kết nối'
      });
    });

    app.get('/stats', (req, res) => {
      res.json({
        guilds: client.guilds.cache ? client.guilds.cache.size : 0,
        users: client.guilds.cache ? client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0) : 0,
        players: riffy.players ? riffy.players.size : 0,
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed / 1024 / 1024,
        ping: client.ws ? client.ws.ping : 0,
        lavalink: isLavalinkConnected
      });
    });

    app.listen(config.express.port, '0.0.0.0', () => {
      console.log(`🌐 Máy chủ Express đang chạy trên cổng ${config.express.port}`);
    });
  }
}

// Khởi động server Express trước bot
startExpressServer();

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages
];

if (config.enablePrefix) {
  intents.push(GatewayIntentBits.MessageContent);
}

const client = new Client({ intents });

let isLavalinkConnected = false;

const riffy = new Riffy(client, config.lavalink.nodes, {
  send: (payload) => {
    const guild = client.guilds.cache.get(payload.d.guild_id);
    if (guild) guild.shard.send(payload);
  },
  defaultSearchPlatform: "ytmsearch",
  restVersion: "v4"
});

// Sửa lỗi khởi tạo Node của Riffy bằng cách ghi đè lệnh defineProperty bị lỗi
// Đây là giải pháp tạm thời cho lỗi của gói riffy
const { Node } = require('riffy/build/structures/Node');
const originalDefineProperty = Object.defineProperty;
Object.defineProperty = function(obj, prop, descriptor) {
    if (obj instanceof Node && (prop === 'host' || prop === 'port' || prop === 'password' || prop === 'secure' || prop === 'identifier')) {
        return originalDefineProperty(obj, prop, {
            value: descriptor.value,
            writable: true,
            enumerable: true,
            configurable: true
        });
    }
    try {
        return originalDefineProperty(obj, prop, descriptor);
    } catch (e) {
        // Nếu thất bại với lỗi cụ thể, thử cách dự phòng
        if (e instanceof TypeError && e.message.includes('Invalid property descriptor')) {
            return originalDefineProperty(obj, prop, {
                value: descriptor.value,
                writable: true,
                enumerable: true,
                configurable: true
            });
        }
        throw e;
    }
};

const queue247 = new Set();

client.on('ready', async () => {
  console.log(`${config.emojis.success} Đã đăng nhập với tên ${client.user.tag}`);

  try {
    riffy.init(client.user.id);
  } catch (error) {
    console.error(`${config.emojis.error} Không thể khởi tạo Riffy:`, error);
  }

  const activityTypes = {
    'PLAYING': ActivityType.Playing,
    'LISTENING': ActivityType.Listening,
    'WATCHING': ActivityType.Watching,
    'STREAMING': ActivityType.Streaming,
    'COMPETING': ActivityType.Competing
  };

  const activityType = activityTypes[config.activity.type] || ActivityType.Listening;
  client.user.setActivity(config.activity.name, { type: activityType });
  console.log(`${config.emojis.success} Đã đặt trạng thái: ${config.activity.type} ${config.activity.name}`);

  const commands = [
    { name: 'play', description: 'Phát một bài hát', options: [{ name: 'query', description: 'Tên bài hát hoặc URL', type: 3, required: true }] },
    { name: 'pause', description: 'Tạm dừng bài hát hiện tại' },
    { name: 'resume', description: 'Tiếp tục phát bài hát đã tạm dừng' },
    { name: 'skip', description: 'Bỏ qua bài hát hiện tại' },
    { name: 'stop', description: 'Dừng phát và xóa hàng chờ' },
    { name: 'volume', description: 'Đặt âm lượng', options: [{ name: 'level', description: 'Mức âm lượng (1-100)', type: 4, required: true, min_value: 1, max_value: 100 }] },
    { name: 'queue', description: 'Hiển thị hàng chờ hiện tại' },
    { name: 'nowplaying', description: 'Hiển thị bài hát đang phát' },
    { name: 'shuffle', description: 'Xáo trộn hàng chờ' },
    { name: 'loop', description: 'Bật/tắt chế độ lặp', options: [{ name: 'mode', description: 'Chế độ lặp', type: 3, required: true, choices: [{ name: 'Tắt', value: 'none' }, { name: 'Bài hát', value: 'track' }, { name: 'Hàng chờ', value: 'queue' }] }] },
    { name: 'remove', description: 'Xóa bài hát khỏi hàng chờ', options: [{ name: 'position', description: 'Vị trí trong hàng chờ', type: 4, required: true, min_value: 1 }] },
    { name: 'move', description: 'Di chuyển bài hát trong hàng chờ', options: [{ name: 'from', description: 'Vị trí ban đầu', type: 4, required: true, min_value: 1 }, { name: 'to', description: 'Vị trí đích', type: 4, required: true, min_value: 1 }] },
    { name: 'clearqueue', description: 'Xóa toàn bộ hàng chờ' },
    { name: '247', description: 'Bật/tắt chế độ 24/7' },
    { name: 'stats', description: 'Hiển thị thống kê bot' },
    { name: 'ping', description: 'Hiển thị độ trễ của bot' },
    { name: 'invite', description: 'Lấy link mời bot' },
    { name: 'support', description: 'Lấy link máy chủ hỗ trợ' },
    { name: 'help', description: 'Hiển thị tất cả lệnh' }
  ];

  await client.application.commands.set(commands);
  console.log(`${config.emojis.success} Đã đăng ký lệnh Slash toàn cầu`);
});

client.on('raw', (d) => riffy.updateVoiceState(d));

riffy.on('nodeConnect', (node) => {
  console.log(`${config.emojis.success} Node ${node.name} đã kết nối`);
  isLavalinkConnected = true;
});

riffy.on('nodeError', (node, error) => {
  console.error(`${config.emojis.error} Lỗi node ${node.name}:`, error);
  isLavalinkConnected = false;
});

riffy.on('nodeDisconnect', (node) => {
  console.log(`${config.emojis.error} Node ${node.name} đã ngắt kết nối`);
  isLavalinkConnected = false;
});

const nowPlayingMessages = new Map();

function formatTime(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function createNowPlayingContainer(player, track, disabled = false) {
  const info = track.info ?? {};
  let thumbnail = info.artworkUrl || info.thumbnail || null;

  if (!thumbnail && info.uri && info.uri.includes('youtube.com')) {
    const videoId = info.uri.split('v=')[1]?.split('&')[0];
    if (videoId) {
      thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    }
  }

  if (!thumbnail && info.uri && info.uri.includes('youtu.be')) {
    const videoId = info.uri.split('youtu.be/')[1]?.split('?')[0];
    if (videoId) {
      thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    }
  }

  if (!thumbnail) {
    thumbnail = 'https://i.imgur.com/QYJfXQv.png';
  }

  const isPaused = player.paused;

  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${config.emojis.music} Đang phát\n**[${info.title || 'Không rõ tiêu đề'}](${info.uri || 'https://youtube.com'})**`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(thumbnail)
            .setDescription(info.title || 'Ảnh thu nhỏ bài hát')
        )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder()
        .setContent(`**Thời lượng:** ${formatTime(info.length || 0)} • **Yêu cầu bởi:** <@${track.info.requester}>`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(isPaused ? 'resume' : 'pause')
            .setEmoji(isPaused ? config.emojis.play : config.emojis.pause)
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
            .setDisabled(disabled),
          new ButtonBuilder()
            .setCustomId('skip')
            .setEmoji(config.emojis.skip)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
          new ButtonBuilder()
            .setCustomId('stop')
            .setEmoji(config.emojis.stop)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled),
          new ButtonBuilder()
            .setCustomId('shuffle')
            .setEmoji(config.emojis.shuffle)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
          new ButtonBuilder()
            .setCustomId('queue')
            .setEmoji(config.emojis.queue)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled)
        )
    )
    .addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('loop')
            .setEmoji(config.emojis.loop)
            .setStyle(player.loop && player.loop !== 'none' ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(disabled)
        )
    );

  return container;
}

function createSimpleContainer(title, description, emoji = config.emojis.info) {
  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${emoji} ${title}\n${description}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(client.user.displayAvatarURL({ size: 1024 }))
            .setDescription(title)
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
}

function createSimpleContainerNoButtons(title, description, emoji = config.emojis.info) {
  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${emoji} ${title}\n${description}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(client.user.displayAvatarURL({ size: 1024 }))
            .setDescription(title)
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
}

function createQueueContainer(player, guild, user) {
  const queue = player.queue ?? [];
  const current = player.current;
  let description = '';

  if (current?.info) {
    description += `**Đang phát:**\n**[${current.info.title}](${current.info.uri})**\n${current.info.author || 'Không rõ'} • ${formatTime(current.info.length)} • <@${current.info.requester}>\n\n`;
  }

  if (queue.length > 0) {
    description += `**Tiếp theo:**\n`;
    const upcoming = queue.slice(0, 10);
    upcoming.forEach((t, i) => {
      const inf = t.info || {};
      description += `\`${i + 1}.\` **[${inf.title}](${inf.uri})**\n${inf.author || 'Không rõ'} • ${formatTime(inf.length || 0)} • <@${t.info.requester}>\n`;
    });
    if (queue.length > 10) {
      description += `\n*...và ${queue.length - 10} bài hát khác*`;
    }
  } else if (!current) {
    description = 'Hàng chờ hiện đang trống.';
  }

  description += `\n\n**Lặp:** ${(!player.loop || player.loop === 'none') ? 'tắt' : player.loop} | **Tổng:** ${player.queue.length + 1} bài hát`;

  let thumbnail = client.user.displayAvatarURL({ size: 1024 });

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${config.emojis.queue} Hàng chờ\n${description}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(thumbnail)
            .setDescription('Hàng chờ')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
}

function createStatsContainer() {
  const uptime = formatTime(client.uptime);
  const players = riffy.players.size;
  const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
  const memory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

  const description = `**Máy chủ:** ${client.guilds.cache.size}\n**Người dùng:** ${totalUsers}\n**Người chơi:** ${players}\n**Thời gian hoạt động:** ${uptime}\n**Ping:** ${client.ws.ping}ms\n**Bộ nhớ:** ${memory} MB`;

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${config.emojis.info} Thống kê bot\n${description}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(client.user.displayAvatarURL({ size: 1024 }))
            .setDescription('Ảnh đại diện bot')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
}

function createHelpContainer() {
  const lavalinkStatus = isLavalinkConnected ? '🟢 Đã kết nối' : '🔴 Chưa kết nối';

  const description = `Bot nhạc mạnh mẽ với chất lượng âm thanh cao\n\n**Tổng số lệnh:** 17\n**Tiền tố:** \`${config.prefix}\`\n**Lavalink:** ${lavalinkStatus}\nPhát triển bởi **DKHANG**\n\n**${config.emojis.music} Lệnh nhạc**\n**play** (p) - Phát một bài hát\n**pause** (pa) - Tạm dừng bài hát hiện tại\n**resume** (r, res) - Tiếp tục phát\n**skip** (s, next) - Bỏ qua bài hát hiện tại\n**stop** (st, leave) - Dừng phát\n**nowplaying** (np) - Hiển thị bài hát đang phát\n**queue** (q) - Hiển thị hàng chờ\n**loop** (l, repeat) - Chế độ lặp\n**shuffle** (sh, mix) - Xáo trộn hàng chờ\n**volume** (v, vol) - Đặt âm lượng\n**clearqueue** (cq, clear) - Xóa hàng chờ\n**remove** (rm, delete) - Xóa khỏi hàng chờ\n**move** (mv) - Di chuyển trong hàng chờ\n**247** (24/7, stay) - Bật/tắt 24/7\n\n**${config.emojis.info} Lệnh tiện ích**\n**stats** (status, info) - Thống kê bot\n**ping** (latency) - Độ trễ bot\n**invite** (inv) - Link mời bot\n**support** (server) - Máy chủ hỗ trợ\n**help** (h, cmd) - Tin nhắn này`;

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${client.user.username} Trợ giúp\n${description}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(client.user.displayAvatarURL({ size: 1024 }))
            .setDescription('Ảnh đại diện bot')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Mời tôi')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`),
          new ButtonBuilder()
            .setLabel('Hỗ trợ')
            .setStyle(ButtonStyle.Link)
            .setURL(config.supportServer)
        )
    );
}

riffy.on('trackStart', async (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (!channel) return;

  const container = createNowPlayingContainer(player, track);

  try {
    const msg = await channel.send({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
    nowPlayingMessages.set(player.guildId, msg);
  } catch (err) {
    console.error('Không thể gửi tin nhắn Đang phát:', err);
  }
});

riffy.on('queueEnd', async (player) => {
  const channel = client.channels.cache.get(player.textChannel);

  const msg = nowPlayingMessages.get(player.guildId);
  if (msg && player.current) {
    try {
      const disabledContainer = createNowPlayingContainer(player, player.current, true);
      await msg.edit({ components: [disabledContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
    } catch (error) {
      console.error('Không thể vô hiệu hóa nút:', error);
    }
    nowPlayingMessages.delete(player.guildId);
  }

  if (queue247.has(player.guildId)) {
    if (channel) {
      const container = createSimpleContainerNoButtons('Chế độ 24/7', 'Hàng chờ đã kết thúc nhưng vẫn ở chế độ 24/7', config.emojis.info);
      await channel.send({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
    }
    return;
  }

  if (channel) {
    const container = createSimpleContainerNoButtons('Hàng chờ đã kết thúc', 'Hàng chờ đã kết thúc, rời khỏi kênh thoại', config.emojis.success);
    await channel.send({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
  }

  player.destroy();
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const player = riffy.players.get(interaction.guildId);

    if (!player) {
      return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
    }

    const member = interaction.member;
    if (!member.voice.channel) {
      return interaction.reply({ content: `${config.emojis.error} Bạn cần ở trong kênh thoại`, ephemeral: true });
    }

    if (member.voice.channel.id !== player.voiceChannel) {
      return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
    }

    switch (interaction.customId) {
      case 'pause':
      case 'resume': {
        const message = nowPlayingMessages.get(player.guildId);
        const shouldPause = interaction.customId === 'pause';
        await player.pause(shouldPause);

        if (message && player.current) {
          const updatedContainer = createNowPlayingContainer(player, player.current);
          await message.edit({ components: [updatedContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        await interaction.reply({ 
          content: shouldPause ? `${config.emojis.pause} Đã tạm dừng` : `${config.emojis.play} Đã tiếp tục`, 
          ephemeral: true 
        });
        break;
      }

      case 'skip': {
        player.stop();
        const disabledContainer = createNowPlayingContainer(player, player.current, true);
        await interaction.message.edit({ components: [disabledContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
        await interaction.reply({ content: `${config.emojis.skip} Đã bỏ qua`, ephemeral: true });
        break;
      }

      case 'stop': {
        const disabledContainer = createNowPlayingContainer(player, player.current, true);
        await interaction.message.edit({ components: [disabledContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
        player.destroy();
        await interaction.reply({ content: `${config.emojis.stop} Đã dừng`, ephemeral: true });
        break;
      }

      case 'shuffle': {
        if (player.queue.length === 0) {
          return interaction.reply({ content: `${config.emojis.error} Hàng chờ trống`, ephemeral: true });
        }
        player.queue.shuffle();
        await interaction.reply({ content: `${config.emojis.shuffle} Đã xáo trộn hàng chờ`, ephemeral: true });
        break;
      }

      case 'loop': {
        const modes = ['none', 'track', 'queue'];
        const currentMode = player.loop || 'none';
        const nextMode = modes[(modes.indexOf(currentMode) + 1) % modes.length];
        player.setLoop(nextMode);
        const loopLabel = nextMode === 'none' ? 'tắt' : nextMode;

        const loopMsg = nowPlayingMessages.get(player.guildId);
        if (loopMsg && player.current) {
          const updatedContainer = createNowPlayingContainer(player, player.current);
          await loopMsg.edit({ components: [updatedContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        await interaction.reply({ content: `${config.emojis.loop} Đã đặt lặp: ${loopLabel}`, ephemeral: true });
        break;
      }

      case 'queue': {
        const queueContainer = createQueueContainer(player, interaction.guild, interaction.user);
        await interaction.reply({ components: [queueContainer], flags: MessageFlags.IsComponentsV2, ephemeral: true });
        break;
      }
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, member, guild, channel } = interaction;

  if (commandName === 'play') {
    const query = options.getString('query');

    if (!member.voice.channel) {
      return interaction.reply({ content: `${config.emojis.error} Bạn cần ở trong kênh thoại`, ephemeral: true });
    }

    if (!isLavalinkConnected) {
      return interaction.reply({ content: `${config.emojis.error} Lavalink chưa kết nối. Các lệnh nhạc không khả dụng.`, ephemeral: true });
    }

    await interaction.deferReply();

    try {
      let player = riffy.players.get(guild.id);

      if (!player) {
        player = riffy.createConnection({
          guildId: guild.id,
          voiceChannel: member.voice.channel.id,
          textChannel: channel.id,
          deaf: true
        });
      }

      const resolve = await riffy.resolve({ query, requester: member.user.id });

      if (!resolve || !resolve.tracks.length) {
        return interaction.editReply({ content: `${config.emojis.error} Không tìm thấy kết quả` });
      }

      if (resolve.loadType === 'playlist') {
        for (const track of resolve.tracks) {
          track.info.requester = member.user.id;
          player.queue.add(track);
        }

        const container = createSimpleContainerNoButtons(
          'Đã thêm danh sách phát',
          `Đã thêm danh sách phát **${resolve.playlistInfo.name}** (${resolve.tracks.length} bài hát)`,
          config.emojis.success
        );

        await interaction.editReply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
      } else if (resolve.loadType === 'search' || resolve.loadType === 'track') {
        const track = resolve.tracks[0];
        track.info.requester = member.user.id;
        player.queue.add(track);

        const container = createSimpleContainerNoButtons(
          'Đã thêm vào hàng chờ',
          `[${track.info.title}](${track.info.uri})`,
          config.emojis.success
        );

        await interaction.editReply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
      } else {
        return interaction.editReply({ content: `${config.emojis.error} Không tìm thấy kết quả` });
      }

      if (!player.playing && !player.paused) player.play();
    } catch (error) {
      console.error('Lỗi lệnh play:', error);
      await interaction.editReply({ content: `${config.emojis.error} Đã xảy ra lỗi khi phát bài hát` });
    }
  }

  if (commandName === 'pause') {
    const player = riffy.players.get(guild.id);
    if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
    if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
      return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
    }

    player.pause(true);
    const container = createSimpleContainer('Đã tạm dừng', 'Đã tạm dừng phát nhạc', config.emojis.pause);
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (commandName === 'resume') {
    const player = riffy.players.get(guild.id);
    if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
    if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
      return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
    }

    player.pause(false);
    const container = createSimpleContainer('Đã tiếp tục', 'Đã tiếp tục phát nhạc', config.emojis.play);
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (commandName === 'skip') {
    const player = riffy.players.get(guild.id);
    if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
    if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
      return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
    }

    player.stop();
    const container = createSimpleContainer('Đã bỏ qua', 'Đã chuyển sang bài hát tiếp theo', config.emojis.skip);
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (commandName === 'stop') {
    const player = riffy.players.get(guild.id);
    if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
    if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
      return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
    }

    player.destroy();
    const container = createSimpleContainer('Đã dừng', 'Đã dừng và xóa hàng chờ', config.emojis.stop);
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (commandName === 'volume') {
    const player = riffy.players.get(guild.id);
    if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
    if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
      return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
    }

    const volume = options.getInteger('level');
    player.setVolume(volume);
    const container = createSimpleContainer('Đã đặt âm lượng', `Đã đặt âm lượng thành ${volume}%`, config.emojis.volume);
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (commandName === 'queue') {
    const player = riffy.players.get(guild.id);
    if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });

    if (player.queue.length === 0 && !player.current) {
      return interaction.reply({ content: `${config.emojis.error} Hàng chờ trống`, ephemeral: true });
    }

    const queueContainer = createQueueContainer(player, guild, interaction.user);
    await interaction.reply({ components: [queueContainer], flags: MessageFlags.IsComponentsV2 });
  }

  if (commandName === 'nowplaying') {
    const player = riffy.players.get(guild.id);
    if (!player || !player.current) {
      return interaction.reply({ content: `${config.emojis.error} Không có bài hát nào đang phát`, ephemeral: true });
    }

    const info = player.current.info ?? {};
    let thumbnail = info.artworkUrl || info.thumbnail || null;

    if (!thumbnail && info.uri && info.uri.includes('youtube.com')) {
      const videoId = info.uri.split('v=')[1]?.split('&')[0];
      if (videoId) {
        thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }
    }

    if (!thumbnail && info.uri && info.uri.includes('youtu.be')) {
      const videoId = info.uri.split('youtu.be/')[1]?.split('?')[0];
      if (videoId) {
        thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }
    }

    if (!thumbnail) {
      thumbnail = 'https://i.imgur.com/QYJfXQv.png';
    }

    const currentPosition = player.position || 0;
    const totalDuration = info.length || 0;
    const status = player.paused ? '⏸️ Đã tạm dừng' : '▶️ Đang phát';

          const description = `**[${info.title || 'Không rõ tiêu đề'}](${info.uri || 'https://youtube.com'})**\n\n**Trạng thái:** ${status}\n**Thời lượng hiện tại:** ${formatTime(currentPosition)} / ${formatTime(totalDuration)}\n**Yêu cầu bởi:** <@${player.current.info.requester}>\n**Lặp:** ${(!player.loop || player.loop === 'none') ? 'tắt' : player.loop}`;

          const container = new ContainerBuilder()
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder()
                    .setContent(`## ${config.emojis.music} Đang phát\n${description}`)
                )
                .setThumbnailAccessory(
                  new ThumbnailBuilder()
                    .setURL(thumbnail)
                    .setDescription(info.title || 'Ảnh thu nhỏ bài hát')
                )
            )
            .addSeparatorComponents(
              new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            );

          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'shuffle') {
          const player = riffy.players.get(guild.id);
          if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
          if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
          }
          if (player.queue.length === 0) {
            return interaction.reply({ content: `${config.emojis.error} Hàng chờ trống`, ephemeral: true });
          }

          player.queue.shuffle();
          const container = createSimpleContainer('Đã xáo trộn', 'Đã xáo trộn hàng chờ', config.emojis.shuffle);
          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'loop') {
          const player = riffy.players.get(guild.id);
          if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
          if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
          }

          const mode = options.getString('mode');
          player.setLoop(mode);
          const container = createSimpleContainer('Đã đặt lặp', `Đã đặt lặp: ${mode}`, config.emojis.loop);
          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'remove') {
          const player = riffy.players.get(guild.id);
          if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
          if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
          }

          const position = options.getInteger('position') - 1;
          if (position < 0 || position >= player.queue.length) {
            return interaction.reply({ content: `${config.emojis.error} Vị trí không hợp lệ`, ephemeral: true });
          }

          const removed = player.queue.remove(position);
          const container = createSimpleContainer('Đã xóa', `Đã xóa: ${removed.info.title}`, config.emojis.success);
          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'move') {
          const player = riffy.players.get(guild.id);
          if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
          if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
          }

          const from = options.getInteger('from') - 1;
          const to = options.getInteger('to') - 1;

          if (from < 0 || from >= player.queue.length || to < 0 || to >= player.queue.length) {
            return interaction.reply({ content: `${config.emojis.error} Vị trí không hợp lệ`, ephemeral: true });
          }

          const track = player.queue.remove(from);
          player.queue.splice(to, 0, track);
          const container = createSimpleContainer('Đã di chuyển', `Đã di chuyển: ${track.info.title}`, config.emojis.success);
          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'clearqueue') {
          const player = riffy.players.get(guild.id);
          if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
          if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
          }

          player.queue.clear();
          const container = createSimpleContainer('Đã xóa hàng chờ', 'Đã xóa toàn bộ hàng chờ', config.emojis.success);
          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === '247') {
          const player = riffy.players.get(guild.id);
          if (!member.voice.channel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở trong kênh thoại`, ephemeral: true });
          }

          if (queue247.has(guild.id)) {
            queue247.delete(guild.id);
            const container = createSimpleContainer('Đã tắt 24/7', 'Đã tắt chế độ 24/7', config.emojis.success);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          } else {
            queue247.add(guild.id);

            if (!player) {
              riffy.createConnection({
                guildId: guild.id,
                voiceChannel: member.voice.channel.id,
                textChannel: channel.id,
                deaf: true
              });
            }

            const container = createSimpleContainer('Đã bật 24/7', 'Đã bật chế độ 24/7', config.emojis.success);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }
        }

        if (commandName === 'stats') {
          const statsContainer = createStatsContainer();
          await interaction.reply({ components: [statsContainer], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'ping') {
          const container = createSimpleContainer('Pong!', `Độ trễ: ${client.ws.ping}ms`, config.emojis.info);
          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'invite') {
          const invite = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`;

          const container = new ContainerBuilder()
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder()
                    .setContent(`## ${config.emojis.success} Mời bot\n[Bấm vào đây để mời tôi](${invite})`)
                )
                .setThumbnailAccessory(
                  new ThumbnailBuilder()
                    .setURL(client.user.displayAvatarURL({ size: 1024 }))
                    .setDescription('Mời bot')
                )
            )
            .addSeparatorComponents(
              new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addActionRowComponents(
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setLabel('Mời tôi')
                    .setStyle(ButtonStyle.Link)
                    .setURL(invite)
                )
            );

          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'support') {
          const container = new ContainerBuilder()
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder()
                    .setContent(`## ${config.emojis.info} Máy chủ hỗ trợ\n[Tham gia máy chủ hỗ trợ của chúng tôi](${config.supportServer})`)
                )
                .setThumbnailAccessory(
                  new ThumbnailBuilder()
                    .setURL(client.user.displayAvatarURL({ size: 1024 }))
                    .setDescription('Máy chủ hỗ trợ')
                )
            )
            .addSeparatorComponents(
              new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addActionRowComponents(
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setLabel('Hỗ trợ')
                    .setStyle(ButtonStyle.Link)
                    .setURL(config.supportServer)
                )
            );

          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'help') {
          const helpContainer = createHelpContainer();
          await interaction.reply({ components: [helpContainer], flags: MessageFlags.IsComponentsV2 });
        }
      });

      if (config.enablePrefix) {
        client.on('messageCreate', async (message) => {
          if (message.author.bot || !message.guild) return;
          if (!message.content.startsWith(config.prefix)) return;

          const args = message.content.slice(config.prefix.length).trim().split(/ +/);
          let command = args.shift().toLowerCase();

          for (const [cmd, aliases] of Object.entries(config.aliases)) {
            if (aliases.includes(command)) {
              command = cmd;
              break;
            }
          }

          if (command === 'play') {
            const query = args.join(' ');
            if (!query) return message.reply(`${config.emojis.error} Vui lòng cung cấp tên bài hát hoặc URL`);

            if (!message.member.voice.channel) {
              return message.reply(`${config.emojis.error} Bạn cần ở trong kênh thoại`);
            }

            if (!isLavalinkConnected) {
              return message.reply(`${config.emojis.error} Lavalink chưa kết nối. Các lệnh nhạc không khả dụng.`);
            }

            try {
              let player = riffy.players.get(message.guild.id);

              if (!player) {
                player = riffy.createConnection({
                  guildId: message.guild.id,
                  voiceChannel: message.member.voice.channel.id,
                  textChannel: message.channel.id,
                  deaf: true
                });
              }

              const resolve = await riffy.resolve({ query, requester: message.author.id });

              if (!resolve || !resolve.tracks.length) {
                return message.reply(`${config.emojis.error} Không tìm thấy kết quả`);
              }

              if (resolve.loadType === 'playlist') {
                for (const track of resolve.tracks) {
                  track.info.requester = message.author.id;
                  player.queue.add(track);
                }

                const container = createSimpleContainerNoButtons(
                  'Đã thêm danh sách phát',
                  `Đã thêm danh sách phát **${resolve.playlistInfo.name}** (${resolve.tracks.length} bài hát)`,
                  config.emojis.success
                );

                await message.reply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
              } else if (resolve.loadType === 'search' || resolve.loadType === 'track') {
                const track = resolve.tracks[0];
                track.info.requester = message.author.id;
                player.queue.add(track);

                const container = createSimpleContainerNoButtons(
                  'Đã thêm vào hàng chờ',
                  `[${track.info.title}](${track.info.uri})`,
                  config.emojis.success
                );

                await message.reply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
              } else {
                return message.reply(`${config.emojis.error} Không tìm thấy kết quả`);
              }

              if (!player.playing && !player.paused) player.play();
            } catch (error) {
              console.error('Lỗi lệnh play:', error);
              await message.reply(`${config.emojis.error} Đã xảy ra lỗi khi phát bài hát`);
            }
          }

          if (command === 'pause') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            player.pause(true);
            const container = createSimpleContainer('Đã tạm dừng', 'Đã tạm dừng phát nhạc', config.emojis.pause);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'resume') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            player.pause(false);
            const container = createSimpleContainer('Đã tiếp tục', 'Đã tiếp tục phát nhạc', config.emojis.play);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'skip') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            player.stop();
            const container = createSimpleContainer('Đã bỏ qua', 'Đã chuyển sang bài hát tiếp theo', config.emojis.skip);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'stop') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            player.destroy();
            const container = createSimpleContainer('Đã dừng', 'Đã dừng và xóa hàng chờ', config.emojis.stop);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'volume') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            const volume = parseInt(args[0]);
            if (isNaN(volume) || volume < 1 || volume > 100) {
              return message.reply(`${config.emojis.error} Vui lòng cung cấp âm lượng từ 1-100`);
            }

            player.setVolume(volume);
            const container = createSimpleContainer('Đã đặt âm lượng', `Đã đặt âm lượng thành ${volume}%`, config.emojis.volume);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'queue') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);

            if (player.queue.length === 0 && !player.current) {
              return message.reply(`${config.emojis.error} Hàng chờ trống`);
            }

            const queueContainer = createQueueContainer(player, message.guild, message.author);
            await message.reply({ components: [queueContainer], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'nowplaying') {
            const player = riffy.players.get(message.guild.id);
            if (!player || !player.current) {
              return message.reply(`${config.emojis.error} Không có bài hát nào đang phát`);
            }

            const info = player.current.info ?? {};
            let thumbnail = info.artworkUrl || info.thumbnail || null;

            if (!thumbnail && info.uri && info.uri.includes('youtube.com')) {
              const videoId = info.uri.split('v=')[1]?.split('&')[0];
              if (videoId) {
                thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
              }
            }

            if (!thumbnail && info.uri && info.uri.includes('youtu.be')) {
              const videoId = info.uri.split('youtu.be/')[1]?.split('?')[0];
              if (videoId) {
                thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
              }
            }

            if (!thumbnail) {
              thumbnail = 'https://i.imgur.com/QYJfXQv.png';
            }

            const currentPosition = player.position || 0;
            const totalDuration = info.length || 0;
            const status = player.paused ? '⏸️ Đã tạm dừng' : '▶️ Đang phát';

            const description = `**[${info.title || 'Không rõ tiêu đề'}](${info.uri || 'https://youtube.com'})**\n\n**Trạng thái:** ${status}\n**Thời lượng hiện tại:** ${formatTime(currentPosition)} / ${formatTime(totalDuration)}\n**Yêu cầu bởi:** <@${player.current.info.requester}>\n**Lặp:** ${(!player.loop || player.loop === 'none') ? 'tắt' : player.loop}`;

            const container = new ContainerBuilder()
              .addSectionComponents(
                new SectionBuilder()
                  .addTextDisplayComponents(
                    new TextDisplayBuilder()
                      .setContent(`## ${config.emojis.music} Đang phát\n${description}`)
                  )
                  .setThumbnailAccessory(
                    new ThumbnailBuilder()
                      .setURL(thumbnail)
                      .setDescription(info.title || 'Ảnh thu nhỏ bài hát')
                  )
              )
              .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
              );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'shuffle') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }
            if (player.queue.length === 0) {
              return message.reply(`${config.emojis.error} Hàng chờ trống`);
            }

            player.queue.shuffle();
            const container = createSimpleContainer('Đã xáo trộn', 'Đã xáo trộn hàng chờ', config.emojis.shuffle);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'loop') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            const mode = args[0]?.toLowerCase();
            if (!mode || !['off', 'track', 'queue'].includes(mode)) {
              return message.reply(`${config.emojis.error} Vui lòng chỉ định: tắt, bài hát, hoặc hàng chờ`);
            }

            player.setLoop(mode);
            const container = createSimpleContainer('Đã đặt lặp', `Đã đặt lặp: ${mode}`, config.emojis.loop);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'remove') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            const position = parseInt(args[0]) - 1;
            if (isNaN(position) || position < 0 || position >= player.queue.length) {
              return message.reply(`${config.emojis.error} Vị trí không hợp lệ`);
            }

            const removed = player.queue.remove(position);
            const container = createSimpleContainer('Đã xóa', `Đã xóa: ${removed.info.title}`, config.emojis.success);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'move') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            const from = parseInt(args[0]) - 1;
            const to = parseInt(args[1]) - 1;

            if (isNaN(from) || isNaN(to) || from < 0 || from >= player.queue.length || to < 0 || to >= player.queue.length) {
              return message.reply(`${config.emojis.error} Vị trí không hợp lệ`);
            }

            const track = player.queue.remove(from);
            player.queue.splice(to, 0, track);
            const container = createSimpleContainer('Đã di chuyển', `Đã di chuyển: ${track.info.title}`, config.emojis.success);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'clearqueue') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            player.queue.clear();
            const container = createSimpleContainer('Đã xóa hàng chờ', 'Đã xóa toàn bộ hàng chờ', config.emojis.success);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === '247') {
            if (!message.member.voice.channel) {
              return message.reply(`${config.emojis.error} Bạn cần ở trong kênh thoại`);
            }

            if (queue247.has(message.guild.id)) {
              queue247.delete(message.guild.id);
              const container = createSimpleContainer('Đã tắt 24/7', 'Đã tắt chế độ 24/7', config.emojis.success);
              await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
              queue247.add(message.guild.id);

              let player = riffy.players.get(message.guild.id);
              if (!player) {
                riffy.createConnection({
                  guildId: message.guild.id,
                  voiceChannel: message.member.voice.channel.id,
                  textChannel: message.channel.id,
                  deaf: true
                });
              }

              const container = createSimpleContainer('Đã bật 24/7', 'Đã bật chế độ 24/7', config.emojis.success);
              await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
          }

          if (command === 'stats') {
            const statsContainer = createStatsContainer();
            await message.reply({ components: [statsContainer], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'ping') {
            const container = createSimpleContainer('Pong!', `Độ trễ: ${client.ws.ping}ms`, config.emojis.info);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'invite') {
            const invite = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`;

            const container = new ContainerBuilder()
              .addSectionComponents(
                new SectionBuilder()
                  .addTextDisplayComponents(
                    new TextDisplayBuilder()
                      .setContent(`## ${config.emojis.success} Mời bot\n[Bấm vào đây để mời tôi](${invite})`)
                  )
                  .setThumbnailAccessory(
                    new ThumbnailBuilder()
                      .setURL(client.user.displayAvatarURL({ size: 1024 }))
                      .setDescription('Mời bot')
                  )
              )
              .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
              )
              .addActionRowComponents(
                new ActionRowBuilder()
                  .addComponents(
                    new ButtonBuilder()
                      .setLabel('Mời tôi')
                      .setStyle(ButtonStyle.Link)
                      .setURL(invite)
                  )
              );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'support') {
            const container = new ContainerBuilder()
              .addSectionComponents(
                new SectionBuilder()
                  .addTextDisplayComponents(
                    new TextDisplayBuilder()
                      .setContent(`## ${config.emojis.info} Máy chủ hỗ trợ\n[Tham gia máy chủ hỗ trợ của chúng tôi](${config.supportServer})`)
                  )
                  .setThumbnailAccessory(
                    new ThumbnailBuilder()
                      .setURL(client.user.displayAvatarURL({ size: 1024 }))
                      .setDescription('Máy chủ hỗ trợ')
                  )
              )
              .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
              )
              .addActionRowComponents(
                new ActionRowBuilder()
                  .addComponents(
                    new ButtonBuilder()
                      .setLabel('Hỗ trợ')
                      .setStyle(ButtonStyle.Link)
                      .setURL(config.supportServer)
                  )
              );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'help') {
            const helpContainer = createHelpContainer();
            await message.reply({ components: [helpContainer], flags: MessageFlags.IsComponentsV2 });
          }
        });
      }

      client.login(config.token);