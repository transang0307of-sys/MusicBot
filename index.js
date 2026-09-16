// index.js - ZENOS MUSIC
const {
  Client, GatewayIntentBits, ActivityType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ContainerBuilder, SectionBuilder, TextDisplayBuilder,
  ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');
const { Riffy } = require('riffy');
const config = require('./config.js');
const express = require('express');
require('dotenv').config();

// ═══════════════════════════════════════════════════
//  🌐 EXPRESS SERVER
// ═══════════════════════════════════════════════════
function startExpressServer() {
  if (!config.express.enabled) return;
  const app = express();

  app.get('/', (req, res) => {
    res.json({
      status: 'online',
      bot: client.user?.tag ?? 'Khởi động...',
      servers: client.guilds.cache?.size ?? 0,
      uptime: process.uptime(),
      lavalink: isLavalinkConnected ? 'connected' : 'disconnected'
    });
  });

  app.get('/stats', (req, res) => {
    res.json({
      guilds: client.guilds.cache?.size ?? 0,
      users: client.guilds.cache?.reduce((a, g) => a + g.memberCount, 0) ?? 0,
      players: riffy.players?.size ?? 0,
      uptime: process.uptime(),
      memory: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
      ping: client.ws?.ping ?? 0,
      lavalink: isLavalinkConnected
    });
  });

  app.listen(config.express.port, '0.0.0.0', () => {
    console.log(`🌐 Express đang chạy tại cổng ${config.express.port}`);
  });
}

startExpressServer();

// ═══════════════════════════════════════════════════
//  🤖 DISCORD CLIENT
// ═══════════════════════════════════════════════════
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages
];
if (config.enablePrefix) intents.push(GatewayIntentBits.MessageContent);

const client = new Client({ intents });
let isLavalinkConnected = false;

const riffy = new Riffy(client, config.lavalink.nodes, {
  send: (payload) => {
    const guild = client.guilds.cache.get(payload.d.guild_id);
    if (guild) guild.shard.send(payload);
  },
  defaultSearchPlatform: 'ytmsearch',
  restVersion: 'v4'
});

// Fix lỗi defineProperty của Riffy
const { Node } = require('riffy/build/structures/Node');
const originalDefineProperty = Object.defineProperty;
Object.defineProperty = function (obj, prop, descriptor) {
  if (obj instanceof Node && ['host', 'port', 'password', 'secure', 'identifier'].includes(prop)) {
    return originalDefineProperty(obj, prop, {
      value: descriptor.value, writable: true, enumerable: true, configurable: true
    });
  }
  try {
    return originalDefineProperty(obj, prop, descriptor);
  } catch (e) {
    if (e instanceof TypeError && e.message.includes('Invalid property descriptor')) {
      return originalDefineProperty(obj, prop, {
        value: descriptor.value, writable: true, enumerable: true, configurable: true
      });
    }
    throw e;
  }
};

const queue247 = new Set();
const nowPlayingMessages = new Map();

// ═══════════════════════════════════════════════════
//  🎨 THEME — ZENOS MUSIC
// ═══════════════════════════════════════════════════
const THEME = {
  name: 'ZENOS MUSIC',
  brand: 'ZENOS',
  tagline: 'Âm nhạc đỉnh cao • Trải nghiệm hoàn hảo',
  color: 0x5865F2,
  defaultThumb: 'https://i.imgur.com/QYJfXQv.png'
};

// ═══════════════════════════════════════════════════
//  🛠️ UTILITIES
// ═══════════════════════════════════════════════════
function formatTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor((ms / 1000) % 60);
  const m = Math.floor((ms / (1000 * 60)) % 60);
  const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

function createProgressBar(current, total, length = 18) {
  if (!total || total <= 0) return '▬'.repeat(length);
  const progress = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(progress * length);
  return '▬'.repeat(filled) + '🔘' + '▬'.repeat(Math.max(0, length - filled - 1));
}

function getThumbnail(track) {
  const info = track?.info ?? {};
  let thumb = info.artworkUrl || info.thumbnail;
  if (!thumb && info.uri) {
    if (info.uri.includes('youtube.com')) {
      const id = info.uri.split('v=')[1]?.split('&')[0];
      if (id) thumb = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
    } else if (info.uri.includes('youtu.be')) {
      const id = info.uri.split('youtu.be/')[1]?.split('?')[0];
      if (id) thumb = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
    }
  }
  return thumb || THEME.defaultThumb;
}

function getSourceIcon(uri = '') {
  if (uri.includes('youtube') || uri.includes('youtu.be')) return '📺 YouTube';
  if (uri.includes('spotify')) return '💚 Spotify';
  if (uri.includes('soundcloud')) return '☁️ SoundCloud';
  if (uri.includes('applemusic')) return '🍎 Apple Music';
  if (uri.includes('deezer')) return '🎵 Deezer';
  return '🎧 Khác';
}

function truncate(str, len = 40) {
  if (!str) return 'Không rõ';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

// ═══════════════════════════════════════════════════
//  🎨 CONTAINER BUILDERS
// ═══════════════════════════════════════════════════

/** Container "Đang phát" */
function createNowPlayingContainer(player, track, disabled = false) {
  const info = track?.info ?? {};
  const thumbnail = getThumbnail(track);
  const isPaused = player.paused;
  const position = player.position || 0;
  const duration = info.length || 0;
  const progress = createProgressBar(position, duration);

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# 🎵 ZENOS MUSIC\n### ${isPaused ? '⏸️ Đang tạm dừng' : '▶️ Đang phát'}`
          )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(thumbnail).setDescription('Album Art')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**[${truncate(info.title, 60)}](${info.uri || 'https://youtube.com'})**\n` +
        `👤 **${truncate(info.author, 30)}** • ${getSourceIcon(info.uri)}\n` +
        `🎧 Yêu cầu bởi: <@${info.requester}>`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `\`${formatTime(position)}\` ${progress} \`${formatTime(duration)}\``
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(isPaused ? 'resume' : 'pause')
          .setEmoji(isPaused ? '▶️' : '⏸️')
          .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('skip')
          .setEmoji('⏭️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('stop')
          .setEmoji('⏹️')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('shuffle')
          .setEmoji('🔀')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('queue')
          .setEmoji('📜')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled)
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('loop')
          .setEmoji('🔁')
          .setLabel(
            !player.loop || player.loop === 'none' ? 'Lặp: Tắt'
            : player.loop === 'track' ? 'Lặp: Bài hát'
            : 'Lặp: Hàng chờ'
          )
          .setStyle(player.loop && player.loop !== 'none' ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('vol_down')
          .setEmoji('🔉')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('vol_up')
          .setEmoji('🔊')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('menu_controls')
          .setEmoji('🎛️')
          .setLabel('Menu')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled)
      )
    );
}

/** Container thông báo */
function createNoticeContainer(title, description, emoji = 'ℹ️') {
  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`# ${emoji} ${title}\n${description}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(client.user.displayAvatarURL({ size: 1024 }))
            .setDescription(THEME.name)
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
}

/** Container hàng chờ */
function createQueueContainer(player) {
  const queue = player.queue ?? [];
  const current = player.current;
  const totalDuration = (current?.info?.length || 0) + queue.reduce((a, t) => a + (t.info?.length || 0), 0);

  let content = '';
  if (current?.info) {
    content += `### 🎶 Đang phát\n`;
    content += `**[${truncate(current.info.title, 55)}](${current.info.uri})**\n`;
    content += `👤 ${truncate(current.info.author, 25)} • \`${formatTime(current.info.length)}\`\n\n`;
  }

  if (queue.length > 0) {
    content += `### 📜 Tiếp theo • ${queue.length} bài\n`;
    const upcoming = queue.slice(0, 8);
    upcoming.forEach((t, i) => {
      const inf = t.info || {};
      content += `\`${String(i + 1).padStart(2, '0')}.\` **[${truncate(inf.title, 45)}](${inf.uri})**\n`;
      content += `     ⤷ \`${formatTime(inf.length || 0)}\` • <@${inf.requester}>\n`;
    });
    if (queue.length > 8) content += `\n*…và **${queue.length - 8}** bài hát khác*`;
  } else if (!current) {
    content = '### 📭 Hàng chờ trống\nThêm bài hát bằng lệnh \`/play\` để bắt đầu!';
  }

  const footer = `\n\n**🔁 Lặp:** ${!player.loop || player.loop === 'none' ? 'Tắt' : player.loop === 'track' ? 'Bài hát' : 'Hàng chờ'} • **⏱ Tổng:** \`${formatTime(totalDuration)}\` • **🔊** \`${player.volume || 100}%\``;

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`# 📜 HÀNG CHỜ\n${content}${footer}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(current ? getThumbnail(current) : client.user.displayAvatarURL({ size: 1024 }))
            .setDescription('Queue')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
}

/** Container thống kê */
function createStatsContainer() {
  const uptime = formatTime(client.uptime);
  const players = riffy.players.size;
  const totalUsers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
  const memory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  const lavalink = isLavalinkConnected ? '🟢 Đã kết nối' : '🔴 Mất kết nối';

  const desc =
    `### 🖥️ Hệ thống\n` +
    `> **Máy chủ:** \`${client.guilds.cache.size}\`\n` +
    `> **Người dùng:** \`${totalUsers.toLocaleString()}\`\n` +
    `> **Trình phát:** \`${players}\`\n\n` +
    `### ⚙️ Hiệu suất\n` +
    `> **Uptime:** \`${uptime}\`\n` +
    `> **Ping:** \`${client.ws.ping}ms\`\n` +
    `> **RAM:** \`${memory} MB\`\n` +
    `> **Lavalink:** ${lavalink}`;

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`# 📊 ZENOS STATS\n${desc}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(client.user.displayAvatarURL({ size: 1024 }))
            .setDescription('Stats')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
}

/** Container trợ giúp */
function createHelpContainer() {
  const lavalink = isLavalinkConnected ? '🟢 Online' : '🔴 Offline';

  const desc =
    `### 🎵 Lệnh âm nhạc\n` +
    `> \`/play\` — Phát nhạc\n` +
    `> \`/pause\` • \`/resume\` — Tạm dừng / Tiếp tục\n` +
    `> \`/skip\` • \`/stop\` — Bỏ qua / Dừng\n` +
    `> \`/queue\` • \`/nowplaying\` — Hàng chờ / Bài đang phát\n` +
    `> \`/loop\` • \`/shuffle\` — Lặp / Xáo trộn\n` +
    `> \`/volume\` — Âm lượng\n` +
    `> \`/clearqueue\` • \`/remove\` • \`/move\` — Quản lý hàng chờ\n` +
    `> \`/247\` — Chế độ 24/7\n\n` +
    `### ⚡ Tiện ích\n` +
    `> \`/stats\` • \`/ping\` • \`/invite\` • \`/support\` • \`/help\`\n\n` +
    `**Prefix:** \`${config.prefix}\` • **Lavalink:** ${lavalink}`;

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`# ${THEME.name}\n### ✨ ${THEME.tagline}\n\n${desc}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(client.user.displayAvatarURL({ size: 1024 }))
            .setDescription(THEME.name)
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('➕ Mời Bot')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`),
        new ButtonBuilder()
          .setLabel('💬 Hỗ trợ')
          .setStyle(ButtonStyle.Link)
          .setURL(config.supportServer)
      )
    );
}

// ═══════════════════════════════════════════════════
//  🎛️ MENU SELECT BUILDERS — MỚI
// ═══════════════════════════════════════════════════

/** Menu điều khiển chính */
function createControlMenuContainer(player) {
  const isPaused = player.paused;
  const loopLabel = !player.loop || player.loop === 'none' ? 'Tắt'
    : player.loop === 'track' ? 'Bài hát' : 'Hàng chờ';

  const controlMenu = new StringSelectMenuBuilder()
    .setCustomId('menu_control_action')
    .setPlaceholder('🎛️ Chọn hành động điều khiển...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(isPaused ? 'Tiếp tục phát' : 'Tạm dừng')
        .setDescription(isPaused ? 'Tiếp tục bài hát đang phát' : 'Tạm dừng bài hát hiện tại')
        .setValue(isPaused ? 'resume' : 'pause')
        .setEmoji(isPaused ? '▶️' : '⏸️'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Bỏ qua bài hát')
        .setDescription('Chuyển sang bài hát tiếp theo')
        .setValue('skip')
        .setEmoji('⏭️'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Dừng phát nhạc')
        .setDescription('Dừng và xóa toàn bộ hàng chờ')
        .setValue('stop')
        .setEmoji('⏹️'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Xáo trộn hàng chờ')
        .setDescription('Trộn ngẫu nhiên các bài hát')
        .setValue('shuffle')
        .setEmoji('🔀'),
      new StringSelectMenuOptionBuilder()
        .setLabel(`Chế độ lặp: ${loopLabel}`)
        .setDescription('Đổi chế độ lặp (Tắt → Bài → Hàng chờ)')
        .setValue('loop')
        .setEmoji('🔁'),
      new StringSelectMenuOptionBuilder()
        .setLabel(`Âm lượng: ${player.volume || 100}%`)
        .setDescription('Xem âm lượng hiện tại và điều chỉnh')
        .setValue('volume')
        .setEmoji('🔊'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Xem hàng chờ')
        .setDescription('Hiển thị danh sách bài hát đang chờ')
        .setValue('queue')
        .setEmoji('📜'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Bài đang phát')
        .setDescription('Xem thông tin chi tiết bài hát hiện tại')
        .setValue('nowplaying')
        .setEmoji('🎶')
    );

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# 🎛️ BẢNG ĐIỀU KHIỂN\n### ${isPaused ? '⏸️ Đang tạm dừng' : '▶️ Đang phát'} • Âm lượng \`${player.volume || 100}%\` • Lặp \`${loopLabel}\``
          )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(player.current ? getThumbnail(player.current) : client.user.displayAvatarURL({ size: 1024 }))
            .setDescription('Control Panel')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Chọn hành động bên dưới để điều khiển trình phát 👇`
      )
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(controlMenu));
}

/** Menu chọn bài hát trong hàng chờ */
function createQueueSelectContainer(player) {
  const queue = player.queue ?? [];
  if (queue.length === 0) {
    return new ContainerBuilder()
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# 📜 HÀNG CHỜ TRỐNG\nKhông có bài hát nào để chọn.`)
          )
          .setThumbnailAccessory(
            new ThumbnailBuilder()
              .setURL(client.user.displayAvatarURL({ size: 1024 }))
              .setDescription('Empty Queue')
          )
      );
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('menu_queue_select')
    .setPlaceholder('🎵 Chọn bài hát để phát ngay...')
    .setMinValues(1)
    .setMaxValues(1);

  const options = queue.slice(0, 25).map((track, index) => {
    const info = track.info || {};
    return new StringSelectMenuOptionBuilder()
      .setLabel(truncate(info.title, 90))
      .setDescription(`👤 ${truncate(info.author, 50)} • ⏱ ${formatTime(info.length)}`)
      .setValue(String(index))
      .setEmoji('🎵');
  });

  selectMenu.addOptions(options);

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# 🎵 CHỌN BÀI HÁT\n### Hàng chờ có \`${queue.length}\` bài\nChọn bài bên dưới để **phát ngay lập tức**`
          )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(player.current ? getThumbnail(player.current) : client.user.displayAvatarURL({ size: 1024 }))
            .setDescription('Queue Select')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));
}

/** Menu tìm kiếm & chọn kết quả */
function createSearchSelectContainer(query, tracks, requesterId) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('menu_search_select')
    .setPlaceholder('🔍 Chọn bài hát để thêm vào hàng chờ...')
    .setMinValues(1)
    .setMaxValues(1);

  const options = tracks.slice(0, 25).map((track, index) => {
    const info = track.info || {};
    return new StringSelectMenuOptionBuilder()
      .setLabel(truncate(info.title, 90))
      .setDescription(`👤 ${truncate(info.author, 45)} • ⏱ ${formatTime(info.length)}`)
      .setValue(String(index))
      .setEmoji('🎵');
  });

  selectMenu.addOptions(options);

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# 🔍 KẾT QUẢ TÌM KIẾM\n**Từ khóa:** \`${truncate(query, 60)}\`\n**Tìm thấy:** \`${tracks.length}\` kết quả\n\nChọn bài bên dưới để thêm vào hàng chờ 👇`
          )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(getThumbnail(tracks[0]))
            .setDescription('Search Results')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));
}

/** Lưu tạm search results */
const searchCache = new Map(); // messageId -> { tracks, requesterId, guildId }

// ═══════════════════════════════════════════════════
//  🚀 READY EVENT
// ═══════════════════════════════════════════════════
client.on('ready', async () => {
  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║   🎵 ${THEME.name} đã khởi động`);
  console.log(`║   👤 ${client.user.tag}`);
  console.log(`║   🌐 ${client.guilds.cache.size} máy chủ`);
  console.log(`║   💬 Prefix: ${config.prefix}`);
  console.log(`╚══════════════════════════════════════════════╝`);

  try { riffy.init(client.user.id); }
  catch (e) { console.error('❌ Riffy init:', e); }

  // ═══════════════════════════════════════════════════
  //  📡 ACTIVITY ROTATION
  // ═══════════════════════════════════════════════════
  let activityIndex = 0;

  const updatePresence = () => {
    try {
      const guildCount = client.guilds.cache.size;
      const userCount = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);

      const list = [
        {
          name: 'ZENOS MUSIC | BOT ÓC CHÓ NHẤT THỜI ĐÀI',
          type: ActivityType.Listening
        },
        {
          name: `Prefix: ${config.prefix} | ${guildCount} servers`,
          type: ActivityType.Watching
        },
        {
          name: `${userCount.toLocaleString()} users | ZENOS MUSIC`,
          type: ActivityType.Watching
        },
        {
          name: '/help | ZENOS MUSIC',
          type: ActivityType.Listening
        },
        {
          name: `${guildCount} servers | Prefix: ${config.prefix}`,
          type: ActivityType.Playing
        }
      ];

      const act = list[activityIndex % list.length];

      client.user.setPresence({
        status: 'online',
        activities: [{
          name: act.name,
          type: act.type,
          ...(act.type === ActivityType.Listening && {
            details: '🎧 Đang nghe ZENOS MUSIC',
            state: `💬 Prefix: ${config.prefix} • 🌐 ${guildCount} servers`
          })
        }]
      });

      activityIndex++;
    } catch (e) {
      console.error('Presence error:', e);
    }
  };

  updatePresence();
  setInterval(updatePresence, 15000);

  // ═══════════════════════════════════════════════════
  //  📋 SLASH COMMANDS
  // ═══════════════════════════════════════════════════
  const commands = [
    { name: 'play', description: '🎵 Phát một bài hát', options: [{ name: 'query', description: 'Tên bài hát hoặc URL', type: 3, required: true }] },
    { name: 'pause', description: '⏸️ Tạm dừng bài hát hiện tại' },
    { name: 'resume', description: '▶️ Tiếp tục phát bài hát' },
    { name: 'skip', description: '⏭️ Bỏ qua bài hát hiện tại' },
    { name: 'stop', description: '⏹️ Dừng phát và xóa hàng chờ' },
    { name: 'volume', description: '🔊 Đặt âm lượng', options: [{ name: 'level', description: 'Mức âm lượng (1-100)', type: 4, required: true, min_value: 1, max_value: 100 }] },
    { name: 'queue', description: '📜 Hiển thị hàng chờ' },
    { name: 'nowplaying', description: '🎶 Bài hát đang phát' },
    { name: 'shuffle', description: '🔀 Xáo trộn hàng chờ' },
    { name: 'loop', description: '🔁 Bật/tắt chế độ lặp', options: [{ name: 'mode', description: 'Chế độ lặp', type: 3, required: true, choices: [{ name: 'Tắt', value: 'none' }, { name: 'Bài hát', value: 'track' }, { name: 'Hàng chờ', value: 'queue' }] }] },
    { name: 'remove', description: '🗑️ Xóa bài khỏi hàng chờ', options: [{ name: 'position', description: 'Vị trí', type: 4, required: true, min_value: 1 }] },
    { name: 'move', description: '↔️ Di chuyển bài trong hàng chờ', options: [{ name: 'from', description: 'Vị trí ban đầu', type: 4, required: true, min_value: 1 }, { name: 'to', description: 'Vị trí đích', type: 4, required: true, min_value: 1 }] },
    { name: 'clearqueue', description: '🧹 Xóa toàn bộ hàng chờ' },
    { name: '247', description: '♾️ Bật/tắt chế độ 24/7' },
    { name: 'stats', description: '📊 Thống kê bot' },
    { name: 'ping', description: '🏓 Độ trễ bot' },
    { name: 'invite', description: '🔗 Link mời bot' },
    { name: 'support', description: '💬 Máy chủ hỗ trợ' },
    { name: 'help', description: '❓ Danh sách lệnh' },
    { name: 'menu', description: '🎛️ Mở bảng điều khiển' }
  ];
  await client.application.commands.set(commands);
  console.log('✅ Đã đăng ký Slash Commands');
});

client.on('raw', (d) => riffy.updateVoiceState(d));

// ═══════════════════════════════════════════════════
//  🔌 LAVALINK EVENTS
// ═══════════════════════════════════════════════════
riffy.on('nodeConnect', (node) => {
  console.log(`✅ Node ${node.name} đã kết nối`);
  isLavalinkConnected = true;
});
riffy.on('nodeError', (node, error) => {
  console.error(`❌ Node ${node.name}:`, error.message);
  isLavalinkConnected = false;
});
riffy.on('nodeDisconnect', (node) => {
  console.log(`⚠️ Node ${node.name} ngắt kết nối`);
  isLavalinkConnected = false;
});

// ═══════════════════════════════════════════════════
//  🎵 TRACK EVENTS
// ═══════════════════════════════════════════════════
riffy.on('trackStart', async (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (!channel) return;
  try {
    const container = createNowPlayingContainer(player, track);
    const msg = await channel.send({
      components: [container],
      flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2
    });
    nowPlayingMessages.set(player.guildId, msg);
  } catch (e) { console.error('trackStart:', e); }
});

riffy.on('queueEnd', async (player) => {
  const channel = client.channels.cache.get(player.textChannel);
  const msg = nowPlayingMessages.get(player.guildId);

  if (msg && player.current) {
    try {
      const disabled = createNowPlayingContainer(player, player.current, true);
      await msg.edit({ components: [disabled], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
    } catch {}
    nowPlayingMessages.delete(player.guildId);
  }

  if (queue247.has(player.guildId)) {
    if (channel) {
      const c = createNoticeContainer('Chế độ 24/7', 'Hàng chờ đã kết thúc, bot vẫn ở trong kênh', '♾️');
      await channel.send({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
    }
    return;
  }

  if (channel) {
    const c = createNoticeContainer('Hàng chờ kết thúc', 'Đã phát xong tất cả bài hát. Tạm biệt! 👋', '✅');
    await channel.send({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
  }
  player.destroy();
});

// ═══════════════════════════════════════════════════
//  🖱️ INTERACTION HANDLER
// ═══════════════════════════════════════════════════
client.on('interactionCreate', async (interaction) => {

  // ═══ STRING SELECT MENUS ═══
  if (interaction.isStringSelectMenu()) {
    const player = riffy.players.get(interaction.guildId);
    if (!player)
      return interaction.reply({ content: '❌ Không có trình phát nào đang hoạt động', ephemeral: true });

    const member = interaction.member;
    if (!member.voice.channel)
      return interaction.reply({ content: '❌ Bạn cần ở trong kênh thoại', ephemeral: true });
    if (member.voice.channel.id !== player.voiceChannel)
      return interaction.reply({ content: '❌ Bạn cần ở cùng kênh thoại với bot', ephemeral: true });

    // ─── MENU ĐIỀU KHIỂN ───
    if (interaction.customId === 'menu_control_action') {
      const action = interaction.values[0];

      switch (action) {
        case 'pause':
        case 'resume': {
          const shouldPause = action === 'pause';
          await player.pause(shouldPause);
          const msg = nowPlayingMessages.get(player.guildId);
          if (msg && player.current) {
            try {
              const c = createNowPlayingContainer(player, player.current);
              await msg.edit({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
            } catch {}
          }
          return interaction.reply({
            content: shouldPause ? '⏸️ Đã tạm dừng' : '▶️ Đã tiếp tục',
            ephemeral: true
          });
        }
        case 'skip': {
          player.stop();
          return interaction.reply({ content: '⏭️ Đã bỏ qua bài hát', ephemeral: true });
        }
        case 'stop': {
          player.destroy();
          nowPlayingMessages.delete(player.guildId);
          return interaction.reply({ content: '⏹️ Đã dừng phát nhạc', ephemeral: true });
        }
        case 'shuffle': {
          if (!player.queue.length)
            return interaction.reply({ content: '❌ Hàng chờ trống', ephemeral: true });
          player.queue.shuffle();
          return interaction.reply({ content: '🔀 Đã xáo trộn hàng chờ', ephemeral: true });
        }
        case 'loop': {
          const modes = ['none', 'track', 'queue'];
          const cur = player.loop || 'none';
          const next = modes[(modes.indexOf(cur) + 1) % modes.length];
          player.setLoop(next);
          const label = next === 'none' ? 'Tắt' : next === 'track' ? 'Bài hát' : 'Hàng chờ';
          const msg = nowPlayingMessages.get(player.guildId);
          if (msg && player.current) {
            try {
              const c = createNowPlayingContainer(player, player.current);
              await msg.edit({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
            } catch {}
          }
          return interaction.reply({ content: `🔁 Chế độ lặp: **${label}**`, ephemeral: true });
        }
        case 'volume': {
          return interaction.reply({
            content: `🔊 Âm lượng hiện tại: **${player.volume || 100}%**\nDùng nút 🔉 / 🔊 hoặc \`/volume\` để điều chỉnh`,
            ephemeral: true
          });
        }
        case 'queue': {
          const c = createQueueContainer(player);
          return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2, ephemeral: true });
        }
        case 'nowplaying': {
          if (!player.current)
            return interaction.reply({ content: '❌ Không có bài nào đang phát', ephemeral: true });
          const c = createNowPlayingContainer(player, player.current);
          return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2, ephemeral: true });
        }
      }
    }

    // ─── MENU CHỌN BÀI TRONG HÀNG CHỜ ───
    if (interaction.customId === 'menu_queue_select') {
      const index = parseInt(interaction.values[0]);
      if (isNaN(index) || index < 0 || index >= player.queue.length)
        return interaction.reply({ content: '❌ Bài hát không hợp lệ', ephemeral: true });

      // Di chuyển bài được chọn lên đầu hàng chờ
      const track = player.queue.remove(index);
      player.queue.unshift(track);

      // Nếu có bài đang phát, skip để phát bài mới
      if (player.current) {
        player.stop();
      }

      const c = createNoticeContainer(
        'Đã chọn bài hát',
        `Đang phát ngay: **[${truncate(track.info.title, 55)}](${track.info.uri})**`,
        '🎵'
      );
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    // ─── MENU CHỌN KẾT QUẢ TÌM KIẾM ───
    if (interaction.customId === 'menu_search_select') {
      const cache = searchCache.get(interaction.message.id);
      if (!cache)
        return interaction.reply({ content: '❌ Kết quả tìm kiếm đã hết hạn. Vui lòng tìm lại.', ephemeral: true });

      if (cache.requesterId !== interaction.user.id)
        return interaction.reply({ content: '❌ Bạn không phải người yêu cầu tìm kiếm này', ephemeral: true });

      const index = parseInt(interaction.values[0]);
      const track = cache.tracks[index];
      if (!track)
        return interaction.reply({ content: '❌ Bài hát không hợp lệ', ephemeral: true });

      track.info.requester = interaction.user.id;
      player.queue.add(track);

      const c = createNoticeContainer(
        'Đã thêm vào hàng chờ',
        `**[${truncate(track.info.title, 60)}](${track.info.uri})**\n👤 ${truncate(track.info.author, 30)} • \`${formatTime(track.info.length)}\``,
        '✅'
      );

      if (!player.playing && !player.paused) player.play();

      searchCache.delete(interaction.message.id);
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    return;
  }

  // ═══ BUTTONS ═══
  if (interaction.isButton()) {
    const player = riffy.players.get(interaction.guildId);
    if (!player)
      return interaction.reply({ content: '❌ Không có trình phát nào đang hoạt động', ephemeral: true });

    const member = interaction.member;
    if (!member.voice.channel)
      return interaction.reply({ content: '❌ Bạn cần ở trong kênh thoại', ephemeral: true });
    if (member.voice.channel.id !== player.voiceChannel)
      return interaction.reply({ content: '❌ Bạn cần ở cùng kênh thoại với bot', ephemeral: true });

    switch (interaction.customId) {
      case 'pause':
      case 'resume': {
        const shouldPause = interaction.customId === 'pause';
        await player.pause(shouldPause);
        const msg = nowPlayingMessages.get(player.guildId);
        if (msg && player.current) {
          try {
            const c = createNowPlayingContainer(player, player.current);
            await msg.edit({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
          } catch {}
        }
        return interaction.reply({
          content: shouldPause ? '⏸️ Đã tạm dừng' : '▶️ Đã tiếp tục',
          ephemeral: true
        });
      }
      case 'skip': {
        player.stop();
        return interaction.reply({ content: '⏭️ Đã bỏ qua bài hát', ephemeral: true });
      }
      case 'stop': {
        player.destroy();
        nowPlayingMessages.delete(player.guildId);
        return interaction.reply({ content: '⏹️ Đã dừng phát nhạc', ephemeral: true });
      }
      case 'shuffle': {
        if (!player.queue.length)
          return interaction.reply({ content: '❌ Hàng chờ trống', ephemeral: true });
        player.queue.shuffle();
        return interaction.reply({ content: '🔀 Đã xáo trộn hàng chờ', ephemeral: true });
      }
      case 'loop': {
        const modes = ['none', 'track', 'queue'];
        const cur = player.loop || 'none';
        const next = modes[(modes.indexOf(cur) + 1) % modes.length];
        player.setLoop(next);
        const msg = nowPlayingMessages.get(player.guildId);
        if (msg && player.current) {
          try {
            const c = createNowPlayingContainer(player, player.current);
            await msg.edit({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
          } catch {}
        }
        const label = next === 'none' ? 'Tắt' : next === 'track' ? 'Bài hát' : 'Hàng chờ';
        return interaction.reply({ content: `🔁 Chế độ lặp: **${label}**`, ephemeral: true });
      }
      case 'queue': {
        const c = createQueueContainer(player);
        return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2, ephemeral: true });
      }
      case 'vol_up':
      case 'vol_down': {
        const delta = interaction.customId === 'vol_up' ? 10 : -10;
        const nv = Math.min(100, Math.max(1, (player.volume || 100) + delta));
        player.setVolume(nv);
        const msg = nowPlayingMessages.get(player.guildId);
        if (msg && player.current) {
          try {
            const c = createNowPlayingContainer(player, player.current);
            await msg.edit({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
          } catch {}
        }
        return interaction.reply({ content: `🔊 Âm lượng: **${nv}%**`, ephemeral: true });
      }
      case 'menu_controls': {
        const c = createControlMenuContainer(player);
        return interaction.reply({
          components: [c],
          flags: MessageFlags.IsComponentsV2,
          ephemeral: true
        });
      }
    }
  }

  // ═══ SLASH COMMANDS ═══
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, member, guild, channel } = interaction;

  const requireVC = () => {
    const player = riffy.players.get(guild.id);
    if (!player) {
      interaction.reply({ content: '❌ Không có trình phát nào đang hoạt động', ephemeral: true });
      return null;
    }
    if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
      interaction.reply({ content: '❌ Bạn cần ở cùng kênh thoại với bot', ephemeral: true });
      return null;
    }
    return player;
  };

  // ─── PLAY (với menu chọn kết quả) ───
  if (commandName === 'play') {
    const query = options.getString('query');
    if (!member.voice.channel)
      return interaction.reply({ content: '❌ Bạn cần ở trong kênh thoại', ephemeral: true });
    if (!isLavalinkConnected)
      return interaction.reply({ content: '❌ Lavalink chưa kết nối', ephemeral: true });

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
      if (!resolve?.tracks?.length)
        return interaction.editReply({ content: '❌ Không tìm thấy kết quả' });

      if (resolve.loadType === 'playlist') {
        for (const t of resolve.tracks) {
          t.info.requester = member.user.id;
          player.queue.add(t);
        }
        const c = createNoticeContainer(
          'Đã thêm danh sách phát',
          `**${resolve.playlistInfo.name}** • \`${resolve.tracks.length}\` bài hát`,
          '📚'
        );
        await interaction.editReply({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
      } else if (resolve.loadType === 'track') {
        // Direct URL → phát ngay
        const track = resolve.tracks[0];
        track.info.requester = member.user.id;
        player.queue.add(track);
        const c = createNoticeContainer(
          'Đã thêm vào hàng chờ',
          `**[${truncate(track.info.title, 60)}](${track.info.uri})**\n👤 ${truncate(track.info.author, 30)} • \`${formatTime(track.info.length)}\``,
          '✅'
        );
        await interaction.editReply({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
      } else {
        // Search → hiển thị menu chọn
        const c = createSearchSelectContainer(query, resolve.tracks, member.user.id);
        const msg = await interaction.editReply({
          components: [c],
          flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2
        });
        searchCache.set(msg.id, {
          tracks: resolve.tracks,
          requesterId: member.user.id,
          guildId: guild.id
        });
        // Tự động xóa cache sau 5 phút
        setTimeout(() => searchCache.delete(msg.id), 5 * 60 * 1000);

        if (!player.playing && !player.paused && player.queue.length > 0) player.play();
        return;
      }

      if (!player.playing && !player.paused) player.play();
    } catch (e) {
      console.error('play:', e);
      await interaction.editReply({ content: '❌ Đã xảy ra lỗi khi phát bài hát' });
    }
    return;
  }

  // ─── PAUSE / RESUME ───
  if (commandName === 'pause' || commandName === 'resume') {
    const player = requireVC(); if (!player) return;
    player.pause(commandName === 'pause');
    const c = createNoticeContainer(
      commandName === 'pause' ? 'Đã tạm dừng' : 'Đã tiếp tục',
      commandName === 'pause' ? 'Nhạc đã được tạm dừng' : 'Nhạc đã được tiếp tục phát',
      commandName === 'pause' ? '⏸️' : '▶️'
    );
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── SKIP ───
  if (commandName === 'skip') {
    const player = requireVC(); if (!player) return;
    player.stop();
    const c = createNoticeContainer('Đã bỏ qua', 'Chuyển sang bài hát tiếp theo', '⏭️');
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── STOP ───
  if (commandName === 'stop') {
    const player = requireVC(); if (!player) return;
    player.destroy();
    nowPlayingMessages.delete(guild.id);
    const c = createNoticeContainer('Đã dừng', 'Đã dừng phát và xóa hàng chờ', '⏹️');
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── VOLUME ───
  if (commandName === 'volume') {
    const player = requireVC(); if (!player) return;
    const volume = options.getInteger('level');
    player.setVolume(volume);
    const c = createNoticeContainer('Đã đặt âm lượng', `Âm lượng hiện tại: **${volume}%**`, '🔊');
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── QUEUE (có menu chọn bài) ───
  if (commandName === 'queue') {
    const player = riffy.players.get(guild.id);
    if (!player || (!player.queue.length && !player.current))
      return interaction.reply({ content: '❌ Hàng chờ trống', ephemeral: true });

    if (player.queue.length > 0) {
      const c = createQueueSelectContainer(player);
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2, ephemeral: true });
    }

    const c = createQueueContainer(player);
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── NOWPLAYING ───
  if (commandName === 'nowplaying') {
    const player = riffy.players.get(guild.id);
    if (!player?.current)
      return interaction.reply({ content: '❌ Không có bài hát nào đang phát', ephemeral: true });
    const c = createNowPlayingContainer(player, player.current);
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── SHUFFLE ───
  if (commandName === 'shuffle') {
    const player = requireVC(); if (!player) return;
    if (!player.queue.length) return interaction.reply({ content: '❌ Hàng chờ trống', ephemeral: true });
    player.queue.shuffle();
    const c = createNoticeContainer('Đã xáo trộn', 'Hàng chờ đã được xáo trộn', '🔀');
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── LOOP ───
  if (commandName === 'loop') {
    const player = requireVC(); if (!player) return;
    const mode = options.getString('mode');
    player.setLoop(mode);
    const label = mode === 'none' ? 'Tắt' : mode === 'track' ? 'Bài hát' : 'Hàng chờ';
    const c = createNoticeContainer('Đã đặt chế độ lặp', `Chế độ: **${label}**`, '🔁');
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── REMOVE ───
  if (commandName === 'remove') {
    const player = requireVC(); if (!player) return;
    const pos = options.getInteger('position') - 1;
    if (pos < 0 || pos >= player.queue.length)
      return interaction.reply({ content: '❌ Vị trí không hợp lệ', ephemeral: true });
    const removed = player.queue.remove(pos);
    const c = createNoticeContainer('Đã xóa', `Đã xóa: **${truncate(removed.info.title, 50)}**`, '🗑️');
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── MOVE ───
  if (commandName === 'move') {
    const player = requireVC(); if (!player) return;
    const from = options.getInteger('from') - 1;
    const to = options.getInteger('to') - 1;
    if (from < 0 || from >= player.queue.length || to < 0 || to >= player.queue.length)
      return interaction.reply({ content: '❌ Vị trí không hợp lệ', ephemeral: true });
    const track = player.queue.remove(from);
    player.queue.splice(to, 0, track);
    const c = createNoticeContainer('Đã di chuyển', `**${truncate(track.info.title, 50)}** → vị trí \`${to + 1}\``, '↔️');
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── CLEARQUEUE ───
  if (commandName === 'clearqueue') {
    const player = requireVC(); if (!player) return;
    player.queue.clear();
    const c = createNoticeContainer('Đã xóa hàng chờ', 'Toàn bộ hàng chờ đã được xóa', '🧹');
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── 247 ───
  if (commandName === '247') {
    if (!member.voice.channel)
      return interaction.reply({ content: '❌ Bạn cần ở trong kênh thoại', ephemeral: true });

    if (queue247.has(guild.id)) {
      queue247.delete(guild.id);
      const c = createNoticeContainer('Đã tắt 24/7', 'Bot sẽ rời kênh khi hàng chờ kết thúc', '♾️');
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    } else {
      queue247.add(guild.id);
      let player = riffy.players.get(guild.id);
      if (!player) {
        riffy.createConnection({
          guildId: guild.id,
          voiceChannel: member.voice.channel.id,
          textChannel: channel.id,
          deaf: true
        });
      }
      const c = createNoticeContainer('Đã bật 24/7', 'Bot sẽ ở lại kênh thoại mãi mãi', '♾️');
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
  }

  // ─── MENU ───
  if (commandName === 'menu') {
    const player = requireVC(); if (!player) return;
    const c = createControlMenuContainer(player);
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── STATS ───
  if (commandName === 'stats') {
    const c = createStatsContainer();
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── PING ───
  if (commandName === 'ping') {
    const c = createNoticeContainer('Pong! 🏓', `Độ trễ WebSocket: \`${client.ws.ping}ms\``, '🏓');
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── INVITE ───
  if (commandName === 'invite') {
    const invite = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`;
    const c = new ContainerBuilder()
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# 🔗 Mời ZENOS MUSIC\nCảm ơn bạn đã ủng hộ!\n\n[**👉 Bấm vào đây để mời bot**](${invite})`)
          )
          .setThumbnailAccessory(
            new ThumbnailBuilder()
              .setURL(client.user.displayAvatarURL({ size: 1024 }))
              .setDescription('Invite')
          )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('➕ Mời Bot').setStyle(ButtonStyle.Link).setURL(invite)
        )
      );
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── SUPPORT ───
  if (commandName === 'support') {
    const c = new ContainerBuilder()
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# 💬 Hỗ trợ\nCần giúp đỡ? Tham gia máy chủ hỗ trợ!\n\n[**👉 Tham gia ngay**](${config.supportServer})`)
          )
          .setThumbnailAccessory(
            new ThumbnailBuilder()
              .setURL(client.user.displayAvatarURL({ size: 1024 }))
              .setDescription('Support')
          )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('💬 Tham gia').setStyle(ButtonStyle.Link).setURL(config.supportServer)
        )
      );
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // ─── HELP ───
  if (commandName === 'help') {
    const c = createHelpContainer();
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
});

// ═══════════════════════════════════════════════════
//  💬 PREFIX COMMANDS
// ═══════════════════════════════════════════════════
if (config.enablePrefix) {
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(config.prefix)) return;

    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    let command = args.shift().toLowerCase();

    for (const [cmd, aliases] of Object.entries(config.aliases || {})) {
      if (aliases.includes(command)) { command = cmd; break; }
    }

    const getPlayer = () => riffy.players.get(message.guild.id);
    const requireVC = () => {
      const p = getPlayer();
      if (!p) { message.reply('❌ Không có trình phát nào đang hoạt động'); return null; }
      if (!message.member.voice.channel || message.member.voice.channel.id !== p.voiceChannel) {
        message.reply('❌ Bạn cần ở cùng kênh thoại với bot');
        return null;
      }
      return p;
    };

    if (command === 'play') {
      const query = args.join(' ');
      if (!query) return message.reply('❌ Vui lòng cung cấp tên bài hát hoặc URL');
      if (!message.member.voice.channel) return message.reply('❌ Bạn cần ở trong kênh thoại');
      if (!isLavalinkConnected) return message.reply('❌ Lavalink chưa kết nối');
      try {
        let p = getPlayer();
        if (!p) p = riffy.createConnection({
          guildId: message.guild.id,
          voiceChannel: message.member.voice.channel.id,
          textChannel: message.channel.id,
          deaf: true
        });
        const resolve = await riffy.resolve({ query, requester: message.author.id });
        if (!resolve?.tracks?.length) return message.reply('❌ Không tìm thấy kết quả');

        if (resolve.loadType === 'playlist') {
          for (const t of resolve.tracks) {
            t.info.requester = message.author.id;
            p.queue.add(t);
          }
          const c = createNoticeContainer('Đã thêm danh sách phát',
            `**${resolve.playlistInfo.name}** • \`${resolve.tracks.length}\` bài`, '📚');
          await message.reply({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
        } else if (resolve.loadType === 'track') {
          const t = resolve.tracks[0];
          t.info.requester = message.author.id;
          p.queue.add(t);
          const c = createNoticeContainer('Đã thêm vào hàng chờ',
            `**[${truncate(t.info.title, 60)}](${t.info.uri})**\n👤 ${truncate(t.info.author, 30)} • \`${formatTime(t.info.length)}\``, '✅');
          await message.reply({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
        } else {
          // Search → menu chọn
          const c = createSearchSelectContainer(query, resolve.tracks, message.author.id);
          const msg = await message.reply({ components: [c], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
          searchCache.set(msg.id, {
            tracks: resolve.tracks,
            requesterId: message.author.id,
            guildId: message.guild.id
          });
          setTimeout(() => searchCache.delete(msg.id), 5 * 60 * 1000);
          if (!p.playing && !p.paused && p.queue.length > 0) p.play();
          return;
        }
        if (!p.playing && !p.paused) p.play();
      } catch (e) { console.error(e); message.reply('❌ Đã xảy ra lỗi'); }
      return;
    }

    if (command === 'pause' || command === 'resume') {
      const p = requireVC(); if (!p) return;
      p.pause(command === 'pause');
      const c = createNoticeContainer(
        command === 'pause' ? 'Đã tạm dừng' : 'Đã tiếp tục',
        command === 'pause' ? 'Nhạc đã tạm dừng' : 'Nhạc đã tiếp tục phát',
        command === 'pause' ? '⏸️' : '▶️'
      );
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'skip') {
      const p = requireVC(); if (!p) return;
      p.stop();
      return message.reply({ components: [createNoticeContainer('Đã bỏ qua', 'Chuyển bài tiếp theo', '⏭️')], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'stop') {
      const p = requireVC(); if (!p) return;
      p.destroy();
      nowPlayingMessages.delete(message.guild.id);
      return message.reply({ components: [createNoticeContainer('Đã dừng', 'Đã dừng phát và xóa hàng chờ', '⏹️')], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'volume') {
      const p = requireVC(); if (!p) return;
      const v = parseInt(args[0]);
      if (isNaN(v) || v < 1 || v > 100) return message.reply('❌ Âm lượng từ 1-100');
      p.setVolume(v);
      return message.reply({ components: [createNoticeContainer('Đã đặt âm lượng', `Âm lượng: **${v}%**`, '🔊')], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'queue') {
      const p = getPlayer();
      if (!p || (!p.queue.length && !p.current)) return message.reply('❌ Hàng chờ trống');
      if (p.queue.length > 0) {
        const c = createQueueSelectContainer(p);
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }
      return message.reply({ components: [createQueueContainer(p)], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'nowplaying') {
      const p = getPlayer();
      if (!p?.current) return message.reply('❌ Không có bài nào đang phát');
      return message.reply({ components: [createNowPlayingContainer(p, p.current)], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'shuffle') {
      const p = requireVC(); if (!p) return;
      if (!p.queue.length) return message.reply('❌ Hàng chờ trống');
      p.queue.shuffle();
      return message.reply({ components: [createNoticeContainer('Đã xáo trộn', 'Hàng chờ đã xáo trộn', '🔀')], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'loop') {
      const p = requireVC(); if (!p) return;
      const mode = args[0]?.toLowerCase();
      if (!['none', 'track', 'queue'].includes(mode)) return message.reply('❌ Chỉ định: none | track | queue');
      p.setLoop(mode);
      return message.reply({ components: [createNoticeContainer('Đã đặt lặp', `Chế độ: **${mode}**`, '🔁')], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'clearqueue') {
      const p = requireVC(); if (!p) return;
      p.queue.clear();
      return message.reply({ components: [createNoticeContainer('Đã xóa hàng chờ', 'Toàn bộ hàng chờ đã xóa', '🧹')], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'menu') {
      const p = requireVC(); if (!p) return;
      return message.reply({ components: [createControlMenuContainer(p)], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'stats') {
      return message.reply({ components: [createStatsContainer()], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'ping') {
      return message.reply({ components: [createNoticeContainer('Pong! 🏓', `Độ trễ: \`${client.ws.ping}ms\``, '🏓')], flags: MessageFlags.IsComponentsV2 });
    }

    if (command === 'help') {
      return message.reply({ components: [createHelpContainer()], flags: MessageFlags.IsComponentsV2 });
    }
  });
}

// ═══════════════════════════════════════════════════
//  🚪 LOGIN
// ═══════════════════════════════════════════════════
client.login(config.token);
