// index.js
// ============================================================
//   ZENOS MUSIC — Premium Discord Music Bot
//   Powered by Riffy + Lavalink
// ============================================================
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { Riffy } = require('riffy');
const config = require('./config.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ---- Nhận diện thương hiệu ----
const BRAND = 'ZENOS MUSIC';
const BRAND_TAGLINE = 'Trải nghiệm âm nhạc đẳng cấp';
const ACCENT_COLOR = config.color ?? 0xB983FF;      // Tím premium làm màu chủ đạo
const FOOTER_TEXT = `-# ${config.emojis?.music ?? '🎧'} **${BRAND}** • ${BRAND_TAGLINE}`;
const DEFAULT_THUMBNAIL = 'https://i.imgur.com/QYJfXQv.png';

// ---- Lưu trữ Playlist cá nhân (dạng file JSON) ----
// Lưu ý khi host trên Render: ổ đĩa của Render KHÔNG bị xóa khi bot tự khởi động lại,
// nhưng SẼ bị làm mới mỗi khi bạn bấm "Deploy" lại code mới. Nếu muốn playlist
// tồn tại vĩnh viễn qua mọi lần deploy, hãy thêm 1 "Persistent Disk" trong Render
// và trỏ biến DATA_DIR (config.dataDir) tới đường dẫn mount của ổ đĩa đó.
const DATA_DIR = config.dataDir || path.join(__dirname, 'data');
const PLAYLIST_FILE = path.join(DATA_DIR, 'playlists.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PLAYLIST_FILE)) fs.writeFileSync(PLAYLIST_FILE, '{}');
}
ensureDataFile();

function readPlaylists() {
  try {
    return JSON.parse(fs.readFileSync(PLAYLIST_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writePlaylists(data) {
  fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(data, null, 2));
}

// Hàm khởi động server Express
function startExpressServer() {
  if (config.express.enabled) {
    const app = express();

    app.get('/', (req, res) => {
      res.json({
        status: 'online',
        bot: client.user ? client.user.tag : 'Đang khởi động...',
        brand: BRAND,
        servers: client.guilds.cache ? client.guilds.cache.size : 0,
        uptime: process.uptime(),
        lavalink: isLavalinkConnected ? 'đã kết nối' : 'ngắt kết nối'
      });
    });

    app.get('/stats', (req, res) => {
      res.json({
        brand: BRAND,
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
      console.log(`🌐 [${BRAND}] Máy chủ Express đang chạy trên cổng ${config.express.port}`);
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
const autoplayGuilds = new Set();     // Các guild đang bật Autoplay
const historyMap = new Map();         // guildId -> mảng bài đã phát gần đây (dùng cho /previous)
const voteSkipMap = new Map();        // guildId -> Set userId đã vote bỏ qua bài hiện tại
const HISTORY_LIMIT = 20;

client.on('ready', async () => {
  console.log('════════════════════════════════════════════════');
  console.log(`   ✨  ${BRAND}  —  ${BRAND_TAGLINE}`);
  console.log('════════════════════════════════════════════════');
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
  console.log(`${config.emojis.success} ${BRAND} đã sẵn sàng phục vụ trên ${client.guilds.cache.size} máy chủ`);

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
    { name: 'filter', description: 'Áp dụng bộ lọc âm thanh cho bài hát', options: [{ name: 'name', description: 'Loại bộ lọc', type: 3, required: true, choices: [
      { name: 'Tắt bộ lọc', value: 'off' },
      { name: 'Bass Boost', value: 'bassboost' },
      { name: 'Nightcore', value: 'nightcore' },
      { name: 'Vaporwave', value: 'vaporwave' },
      { name: '8D Audio', value: '8d' },
      { name: 'Slowed + Reverb', value: 'slowedreverb' }
    ] }] },
    { name: 'seek', description: 'Tua đến một thời điểm trong bài hát', options: [{ name: 'time', description: 'Thời điểm (vd: 1:30 hoặc 90)', type: 3, required: true }] },
    { name: 'replay', description: 'Phát lại bài hát hiện tại từ đầu' },
    { name: 'previous', description: 'Quay lại bài hát trước đó' },
    { name: 'lyrics', description: 'Xem lời bài hát đang phát' },
    { name: 'autoplay', description: 'Bật/tắt tự động phát nhạc liên quan khi hết hàng chờ' },
    { name: 'playlist', description: 'Quản lý playlist yêu thích cá nhân', options: [
      { name: 'save', description: 'Lưu hàng chờ hiện tại thành playlist', type: 1, options: [{ name: 'name', description: 'Tên playlist', type: 3, required: true }] },
      { name: 'load', description: 'Tải một playlist đã lưu vào hàng chờ', type: 1, options: [{ name: 'name', description: 'Tên playlist', type: 3, required: true }] },
      { name: 'list', description: 'Xem danh sách playlist đã lưu', type: 1 },
      { name: 'delete', description: 'Xóa một playlist đã lưu', type: 1, options: [{ name: 'name', description: 'Tên playlist', type: 3, required: true }] }
    ] },
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

// Tạo thanh tiến trình phát nhạc dạng trực quan, đẹp mắt
function createProgressBar(current, total, length = 18) {
  if (!total || total <= 0) return '▬'.repeat(length);
  const ratio = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(ratio * length);
  const bar = '▬'.repeat(Math.max(filled - 1, 0)) + (filled > 0 ? '🔘' : '') + '▬'.repeat(Math.max(length - filled, 0));
  return bar.length > length ? bar.slice(0, length) : bar;
}

// Tạo dòng thương hiệu nhỏ phía cuối mỗi container
function brandFooter() {
  return new TextDisplayBuilder().setContent(FOOTER_TEXT);
}

// Chuyển chuỗi "1:30" hoặc "90" thành số mili-giây
function parseTimeToMs(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) return parseInt(input, 10) * 1000;
  const parts = input.split(':').map(Number);
  if (parts.some((n) => isNaN(n))) return null;
  let ms = 0;
  if (parts.length === 2) ms = (parts[0] * 60 + parts[1]) * 1000;
  else if (parts.length === 3) ms = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  else return null;
  return ms;
}

// Làm sạch tiêu đề bài hát để tìm lời bài hát / bài hát liên quan chính xác hơn
function cleanTrackTitle(title = '') {
  return title
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/official\s*(music\s*)?video/gi, '')
    .replace(/lyrics?/gi, '')
    .replace(/audio/gi, '')
    .replace(/\bft\.?\b.*$/i, '')
    .trim();
}

// Kiểm tra thành viên có quyền DJ (quản lý máy chủ hoặc có DJ role trong config) không
function isDJ(member) {
  if (!member) return false;
  if (member.permissions?.has('ManageGuild')) return true;
  if (config.djRoleId && member.roles.cache.has(config.djRoleId)) return true;
  return false;
}

// Đếm số người thật (không tính bot) đang trong kênh thoại
function countRealMembersInVoice(voiceChannel) {
  if (!voiceChannel) return 0;
  return voiceChannel.members.filter((m) => !m.user.bot).size;
}

// Xử lý bỏ qua bài hát: DJ / phòng ít người thì skip ngay, còn lại cần vote đa số
// Trả về true nếu bài hát đã thực sự bị bỏ qua, false nếu chỉ mới ghi nhận vote
async function handleSkipRequest(guildId, player, member, replyFn) {
  const voiceChannel = member.voice.channel;
  const totalListeners = countRealMembersInVoice(voiceChannel);

  if (isDJ(member) || totalListeners <= 2) {
    voteSkipMap.delete(guildId);
    player.stop();
    await replyFn(`${config.emojis.skip} Đã bỏ qua bài hát`);
    return true;
  }

  const needed = Math.ceil(totalListeners / 2);
  let votes = voteSkipMap.get(guildId);
  if (!votes) {
    votes = new Set();
    voteSkipMap.set(guildId, votes);
  }

  if (votes.has(member.id)) {
    await replyFn(`${config.emojis.info} Bạn đã vote bỏ qua rồi (${votes.size}/${needed})`);
    return false;
  }

  votes.add(member.id);

  if (votes.size >= needed) {
    voteSkipMap.delete(guildId);
    player.stop();
    await replyFn(`${config.emojis.skip} Đã đủ vote — bỏ qua bài hát!`);
    return true;
  }

  await replyFn(`🗳️ Đã ghi nhận vote bỏ qua (${votes.size}/${needed}). Cần thêm **${needed - votes.size}** vote nữa.`);
  return false;
}

// ---- Bộ lọc âm thanh (yêu cầu Lavalink node đã bật plugin filters) ----
const FILTER_LABELS = {
  off: 'Tắt bộ lọc',
  bassboost: 'Bass Boost',
  nightcore: 'Nightcore',
  vaporwave: 'Vaporwave',
  '8d': '8D Audio',
  slowedreverb: 'Slowed + Reverb'
};

function applyFilterPreset(player, name) {
  const f = player.filters;
  if (name !== 'off') f.clearFilters();

  switch (name) {
    case 'bassboost':
      f.setEqualizer([
        { band: 0, gain: 0.6 }, { band: 1, gain: 0.5 }, { band: 2, gain: 0.4 },
        { band: 3, gain: 0.3 }, { band: 4, gain: 0.2 }
      ]);
      break;
    case 'nightcore':
      f.setTimescale(true, { speed: 1.2, pitch: 1.2, rate: 1 });
      break;
    case 'vaporwave':
      f.setTimescale(true, { speed: 0.85, pitch: 0.85, rate: 1 });
      break;
    case '8d':
      f.setRotation(true, { rotationHz: 0.2 });
      break;
    case 'slowedreverb':
      f.setTimescale(true, { speed: 0.85, pitch: 0.9, rate: 1 });
      break;
    case 'off':
      f.clearFilters();
      break;
    default:
      throw new Error('Bộ lọc không hợp lệ');
  }
}

async function handleFilterCommand(player, name, replyFn) {
  if (!player.filters) {
    return replyFn(`${config.emojis.error} Node Lavalink hiện tại không hỗ trợ bộ lọc âm thanh`);
  }
  if (!FILTER_LABELS[name]) {
    return replyFn(`${config.emojis.error} Bộ lọc không hợp lệ`);
  }
  try {
    applyFilterPreset(player, name);
    return replyFn(`${config.emojis.success} Đã áp dụng bộ lọc: **${FILTER_LABELS[name]}**`);
  } catch (err) {
    console.error('Lỗi áp dụng bộ lọc:', err);
    return replyFn(`${config.emojis.error} Không thể áp dụng bộ lọc lúc này (kiểm tra plugin filters trên Lavalink node)`);
  }
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
    thumbnail = DEFAULT_THUMBNAIL;
  }

  const isPaused = player.paused;
  const position = player.position || 0;
  const duration = info.length || 0;
  const progressBar = createProgressBar(position, duration);
  const statusEmoji = isPaused ? '⏸️' : '▶️';

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${config.emojis.music} Đang phát tại ${BRAND}\n**[${info.title || 'Không rõ tiêu đề'}](${info.uri || 'https://youtube.com'})**\n${info.author ? `by ${info.author}` : ''}`)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(thumbnail)
            .setDescription(info.title || 'Ảnh thu nhỏ bài hát')
        )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder()
        .setContent(`${statusEmoji} \`${formatTime(position)}\` ${progressBar} \`${formatTime(duration)}\`\n**Yêu cầu bởi:** <@${track.info.requester}> • **Âm lượng:** ${player.volume ?? 100}% • **Lặp:** ${(!player.loop || player.loop === 'none') ? 'Tắt' : player.loop === 'track' ? 'Bài hát' : 'Hàng chờ'}`)
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
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(brandFooter());

  return container;
}

// Container gọn, dùng chung cho mọi thông báo trạng thái (thành công, lỗi, thông tin...)
function createSimpleContainer(title, description, emoji = config.emojis.info) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
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
    )
    .addTextDisplayComponents(brandFooter());
}

// Giữ lại để tương thích ngược với các đoạn code cũ gọi hàm này
function createSimpleContainerNoButtons(title, description, emoji = config.emojis.info) {
  return createSimpleContainer(title, description, emoji);
}

const QUEUE_PAGE_SIZE = 5;

function createQueueContainer(player, guild, user, page = 0) {
  const queue = player.queue ?? [];
  const current = player.current;
  const totalPages = Math.max(1, Math.ceil(queue.length / QUEUE_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  let description = '';

  if (current?.info) {
    description += `**${config.emojis.music} Đang phát**\n**[${current.info.title}](${current.info.uri})**\n${current.info.author || 'Không rõ'} • ${formatTime(current.info.length)} • <@${current.info.requester}>\n\n`;
  }

  if (queue.length > 0) {
    description += `**📋 Tiếp theo** (trang ${safePage + 1}/${totalPages})\n`;
    const start = safePage * QUEUE_PAGE_SIZE;
    const upcoming = queue.slice(start, start + QUEUE_PAGE_SIZE);
    upcoming.forEach((t, i) => {
      const inf = t.info || {};
      description += `\`${(start + i + 1).toString().padStart(2, '0')}.\` **[${inf.title}](${inf.uri})**\n${inf.author || 'Không rõ'} • ${formatTime(inf.length || 0)} • <@${t.info.requester}>\n`;
    });
  } else if (!current) {
    description = 'Hàng chờ hiện đang trống. Dùng `/play` để bắt đầu nghe nhạc!';
  }

  description += `\n\n**Lặp:** ${(!player.loop || player.loop === 'none') ? 'Tắt' : player.loop === 'track' ? 'Bài hát' : 'Hàng chờ'}  •  **Tổng:** ${player.queue.length + (current ? 1 : 0)} bài hát`;

  let thumbnail = client.user.displayAvatarURL({ size: 1024 });

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${config.emojis.queue} Hàng chờ • ${BRAND}\n${description}`)
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

  if (totalPages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`queue_page:${safePage - 1}`)
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
          new ButtonBuilder()
            .setCustomId(`queue_page:${safePage + 1}`)
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= totalPages - 1)
        )
    );
  }

  container.addTextDisplayComponents(brandFooter());
  return container;
}

function createStatsContainer() {
  const uptime = formatTime(client.uptime);
  const players = riffy.players.size;
  const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
  const memory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const lavalinkStatus = isLavalinkConnected ? `🟢 Đã kết nối` : `🔴 Chưa kết nối`;

  const description = `🏠 **Máy chủ:** ${client.guilds.cache.size}\n👥 **Người dùng:** ${totalUsers.toLocaleString('vi-VN')}\n🎵 **Người chơi đang hoạt động:** ${players}\n⏱️ **Thời gian hoạt động:** ${uptime}\n📡 **Ping:** ${client.ws.ping}ms\n💾 **Bộ nhớ:** ${memory} MB\n🔗 **Lavalink:** ${lavalinkStatus}`;

  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${config.emojis.info} Thống kê ${BRAND}\n${description}`)
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
    .addTextDisplayComponents(brandFooter());
}

function createHelpContainer() {
  const lavalinkStatus = isLavalinkConnected ? '🟢 Đã kết nối' : '🔴 Chưa kết nối';

  const intro = `✨ Trải nghiệm âm nhạc chất lượng cao, mượt mà và chuyên nghiệp.\n\n**Tổng số lệnh:** 26  •  **Tiền tố:** \`${config.prefix}\`  •  **Lavalink:** ${lavalinkStatus}\n**Phát triển bởi:** DKHANG`;

  const musicCommands = `**play** (p) — Phát một bài hát\n**pause** (pa) — Tạm dừng bài hát hiện tại\n**resume** (r, res) — Tiếp tục phát\n**skip** (s, next) — Bỏ qua (vote-skip nếu đông người)\n**stop** (st, leave) — Dừng phát\n**nowplaying** (np) — Hiển thị bài hát đang phát\n**queue** (q) — Hiển thị hàng chờ (có phân trang)\n**loop** (l, repeat) — Chế độ lặp\n**shuffle** (sh, mix) — Xáo trộn hàng chờ\n**volume** (v, vol) — Đặt âm lượng\n**clearqueue** (cq, clear) — Xóa hàng chờ\n**remove** (rm, delete) — Xóa khỏi hàng chờ\n**move** (mv) — Di chuyển trong hàng chờ\n**247** (24/7, stay) — Bật/tắt 24/7`;

  const advancedCommands = `**filter** — Bass Boost, Nightcore, Vaporwave, 8D, Slowed+Reverb\n**seek** — Tua đến thời điểm bất kỳ\n**replay** — Phát lại bài hiện tại từ đầu\n**previous** — Quay lại bài hát trước đó\n**lyrics** — Xem lời bài hát đang phát\n**autoplay** — Tự động phát nhạc liên quan khi hết hàng chờ\n**playlist** save/load/list/delete — Playlist yêu thích cá nhân`;

  const utilityCommands = `**stats** (status, info) — Thống kê bot\n**ping** (latency) — Độ trễ bot\n**invite** (inv) — Link mời bot\n**support** (server) — Máy chủ hỗ trợ\n**help** (h, cmd) — Tin nhắn này`;

  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${config.emojis.info} ${BRAND} — Trung tâm trợ giúp\n${intro}`)
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
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${config.emojis.music} Lệnh nhạc\n${musicCommands}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ✨ Lệnh nâng cao\n${advancedCommands}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${config.emojis.info} Lệnh tiện ích\n${utilityCommands}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Mời tôi')
            .setEmoji('➕')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`),
          new ButtonBuilder()
            .setLabel('Máy chủ hỗ trợ')
            .setEmoji('🛠️')
            .setStyle(ButtonStyle.Link)
            .setURL(config.supportServer)
        )
    )
    .addTextDisplayComponents(brandFooter());
}

function createInviteContainer() {
  const invite = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`;

  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${config.emojis.success} Mời ${BRAND} vào máy chủ của bạn\n[Bấm vào đây để mời tôi](${invite})`)
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
            .setEmoji('➕')
            .setStyle(ButtonStyle.Link)
            .setURL(invite)
        )
    )
    .addTextDisplayComponents(brandFooter());
}

function createSupportContainer() {
  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(`## ${config.emojis.info} Máy chủ hỗ trợ ${BRAND}\n[Tham gia máy chủ hỗ trợ của chúng tôi](${config.supportServer})`)
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
            .setEmoji('🛠️')
            .setStyle(ButtonStyle.Link)
            .setURL(config.supportServer)
        )
    )
    .addTextDisplayComponents(brandFooter());
}

riffy.on('trackStart', async (player, track) => {
  // Lưu lịch sử phát để dùng cho lệnh /previous
  const hist = historyMap.get(player.guildId) || [];
  hist.push(track);
  if (hist.length > HISTORY_LIMIT) hist.shift();
  historyMap.set(player.guildId, hist);

  // Bài mới bắt đầu thì xóa phiếu vote-skip cũ
  voteSkipMap.delete(player.guildId);

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

  // Autoplay: tự động tìm và phát bài hát liên quan khi hàng chờ trống
  if (autoplayGuilds.has(player.guildId) && player.current) {
    try {
      const seedInfo = player.current.info;
      const searchQuery = `${seedInfo.author || ''} ${cleanTrackTitle(seedInfo.title || '')}`.trim();
      const result = await riffy.resolve({ query: searchQuery, requester: client.user.id });
      const candidate = result?.tracks?.find((t) => t.info.uri !== seedInfo.uri);

      if (candidate) {
        candidate.info.requester = client.user.id;
        player.queue.add(candidate);
        player.play();

        if (channel) {
          const container = createSimpleContainerNoButtons(
            'Autoplay',
            `Đang tự động phát tiếp: **[${candidate.info.title}](${candidate.info.uri})**`,
            config.emojis.music
          );
          await channel.send({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
        }
        return;
      }
    } catch (err) {
      console.error(`${config.emojis.error} Lỗi Autoplay:`, err);
    }
  }

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

    if (interaction.customId.startsWith('queue_page:')) {
      const page = parseInt(interaction.customId.split(':')[1], 10) || 0;
      const queueContainer = createQueueContainer(player, interaction.guild, interaction.user, page);
      return interaction.update({ components: [queueContainer], flags: MessageFlags.IsComponentsV2 });
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
        const didSkip = await handleSkipRequest(interaction.guildId, player, member, (content) =>
          interaction.reply({ content, ephemeral: true })
        );
        if (didSkip) {
          const disabledContainer = createNowPlayingContainer(player, player.current, true);
          await interaction.message.edit({ components: [disabledContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 }).catch(() => {});
        }
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
        if (resolve.loadType === 'search' && resolve.tracks.length > 1) {
          const options = resolve.tracks.slice(0, 5).map((t, i) => ({
            label: (t.info.title || 'Không rõ tiêu đề').slice(0, 90),
            description: `${t.info.author || 'Không rõ'} • ${formatTime(t.info.length || 0)}`.slice(0, 90),
            value: String(i)
          }));

          const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`select_track:${interaction.id}`)
              .setPlaceholder('Chọn một bài hát để phát...')
              .addOptions(options)
          );

          const promptContainer = new ContainerBuilder()
            .setAccentColor(ACCENT_COLOR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔎 Kết quả tìm kiếm cho: **${query}**\nChọn một bài hát bên dưới trong vòng 30 giây`))
            .addActionRowComponents(selectRow)
            .addTextDisplayComponents(brandFooter());

          const promptMsg = await interaction.editReply({ components: [promptContainer], flags: MessageFlags.IsComponentsV2 });

          try {
            const selectInteraction = await promptMsg.awaitMessageComponent({
              filter: (i) => i.user.id === member.id && i.customId === `select_track:${interaction.id}`,
              time: 30000
            });

            const chosen = resolve.tracks[parseInt(selectInteraction.values[0], 10)];
            chosen.info.requester = member.user.id;
            player.queue.add(chosen);

            const container = createSimpleContainerNoButtons(
              'Đã thêm vào hàng chờ',
              `[${chosen.info.title}](${chosen.info.uri})`,
              config.emojis.success
            );
            await selectInteraction.update({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
          } catch {
            await interaction.editReply({ content: `${config.emojis.error} Hết thời gian chọn bài hát`, components: [] });
            return;
          }
        } else {
          const track = resolve.tracks[0];
          track.info.requester = member.user.id;
          player.queue.add(track);

          const container = createSimpleContainerNoButtons(
            'Đã thêm vào hàng chờ',
            `[${track.info.title}](${track.info.uri})`,
            config.emojis.success
          );

          await interaction.editReply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
        }
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

    await handleSkipRequest(guild.id, player, member, (content) =>
      interaction.reply({ content })
    );
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

          const container = createNowPlayingContainer(player, player.current, false);
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

        if (commandName === 'filter') {
          const player = riffy.players.get(guild.id);
          if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
          if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
          }

          const name = options.getString('name');
          await handleFilterCommand(player, name, (content) => interaction.reply({ content }));
        }

        if (commandName === 'seek') {
          const player = riffy.players.get(guild.id);
          if (!player || !player.current) {
            return interaction.reply({ content: `${config.emojis.error} Không có bài hát nào đang phát`, ephemeral: true });
          }
          if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
          }

          const ms = parseTimeToMs(options.getString('time'));
          if (ms === null || ms < 0) {
            return interaction.reply({ content: `${config.emojis.error} Định dạng thời gian không hợp lệ (vd: 1:30 hoặc 90)`, ephemeral: true });
          }
          if (ms > (player.current.info.length || 0)) {
            return interaction.reply({ content: `${config.emojis.error} Thời điểm vượt quá độ dài bài hát`, ephemeral: true });
          }

          player.seek(ms);
          const container = createSimpleContainer('Đã tua nhạc', `Đã tua đến \`${formatTime(ms)}\``, config.emojis.info);
          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'replay') {
          const player = riffy.players.get(guild.id);
          if (!player || !player.current) {
            return interaction.reply({ content: `${config.emojis.error} Không có bài hát nào đang phát`, ephemeral: true });
          }
          if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
          }

          player.seek(0);
          if (player.paused) player.pause(false);
          const container = createSimpleContainer('Đã phát lại', 'Đang phát lại bài hát từ đầu', config.emojis.play);
          await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'previous') {
          const player = riffy.players.get(guild.id);
          if (!player) return interaction.reply({ content: `${config.emojis.error} Không tìm thấy người chơi`, ephemeral: true });
          if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
            return interaction.reply({ content: `${config.emojis.error} Bạn cần ở cùng kênh thoại`, ephemeral: true });
          }

          const hist = historyMap.get(guild.id) || [];
          if (hist.length < 2) {
            return interaction.reply({ content: `${config.emojis.error} Không có bài hát trước đó trong lịch sử`, ephemeral: true });
          }

          const prevTrack = hist[hist.length - 2];
          hist.splice(hist.length - 2, 2);
          historyMap.set(guild.id, hist);

          player.queue.unshift(prevTrack);
          player.stop();

          const container = createSimpleContainerNoButtons('Quay lại bài trước', `Đang phát lại: **[${prevTrack.info.title}](${prevTrack.info.uri})**`, config.emojis.success);
          await interaction.reply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'lyrics') {
          const player = riffy.players.get(guild.id);
          if (!player || !player.current) {
            return interaction.reply({ content: `${config.emojis.error} Không có bài hát nào đang phát`, ephemeral: true });
          }

          await interaction.deferReply();
          try {
            const info = player.current.info;
            const artist = encodeURIComponent(info.author || '');
            const title = encodeURIComponent(cleanTrackTitle(info.title || ''));
            const res = await fetch(`https://api.lyrics.ovh/v1/${artist}/${title}`);
            const data = await res.json();

            if (!data.lyrics) {
              return interaction.editReply({ content: `${config.emojis.error} Không tìm thấy lời bài hát cho **${info.title}**` });
            }

            let lyrics = data.lyrics.trim();
            if (lyrics.length > 3800) lyrics = lyrics.slice(0, 3800) + '\n*(...đã cắt bớt)*';

            const container = new ContainerBuilder()
              .setAccentColor(ACCENT_COLOR)
              .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📜 Lời bài hát\n**${info.title}**`))
              .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
              .addTextDisplayComponents(new TextDisplayBuilder().setContent(lyrics))
              .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
              .addTextDisplayComponents(brandFooter());

            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          } catch (err) {
            console.error('Lỗi lấy lời bài hát:', err);
            await interaction.editReply({ content: `${config.emojis.error} Không thể lấy lời bài hát lúc này` });
          }
        }

        if (commandName === 'autoplay') {
          if (autoplayGuilds.has(guild.id)) {
            autoplayGuilds.delete(guild.id);
            const container = createSimpleContainer('Đã tắt Autoplay', 'Bot sẽ dừng lại khi hết hàng chờ như bình thường', config.emojis.info);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          } else {
            autoplayGuilds.add(guild.id);
            const container = createSimpleContainer('Đã bật Autoplay', 'Bot sẽ tự động phát nhạc liên quan khi hết hàng chờ', config.emojis.success);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }
        }

        if (commandName === 'playlist') {
          const sub = options.getSubcommand();
          const playlists = readPlaylists();
          const userPlaylists = playlists[member.id] || {};

          if (sub === 'save') {
            const name = options.getString('name').toLowerCase().slice(0, 32);
            const player = riffy.players.get(guild.id);
            if (!player || (!player.current && player.queue.length === 0)) {
              return interaction.reply({ content: `${config.emojis.error} Không có bài hát nào để lưu`, ephemeral: true });
            }

            const tracks = [];
            if (player.current) tracks.push({ title: player.current.info.title, uri: player.current.info.uri });
            player.queue.forEach((t) => tracks.push({ title: t.info.title, uri: t.info.uri }));

            userPlaylists[name] = tracks;
            playlists[member.id] = userPlaylists;
            writePlaylists(playlists);

            const container = createSimpleContainer('Đã lưu Playlist', `Đã lưu **${tracks.length}** bài hát vào playlist **${name}**`, config.emojis.success);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (sub === 'list') {
            const names = Object.keys(userPlaylists);
            const desc = names.length
              ? names.map((n, i) => `\`${i + 1}.\` **${n}** — ${userPlaylists[n].length} bài hát`).join('\n')
              : 'Bạn chưa có playlist nào. Dùng `/playlist save` để tạo!';
            const container = createSimpleContainer('Playlist của bạn', desc, config.emojis.queue);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (sub === 'delete') {
            const name = options.getString('name').toLowerCase();
            if (!userPlaylists[name]) {
              return interaction.reply({ content: `${config.emojis.error} Không tìm thấy playlist **${name}**`, ephemeral: true });
            }
            delete userPlaylists[name];
            playlists[member.id] = userPlaylists;
            writePlaylists(playlists);

            const container = createSimpleContainer('Đã xóa Playlist', `Đã xóa playlist **${name}**`, config.emojis.success);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (sub === 'load') {
            const name = options.getString('name').toLowerCase();
            const saved = userPlaylists[name];
            if (!saved || saved.length === 0) {
              return interaction.reply({ content: `${config.emojis.error} Không tìm thấy playlist **${name}**`, ephemeral: true });
            }
            if (!member.voice.channel) {
              return interaction.reply({ content: `${config.emojis.error} Bạn cần ở trong kênh thoại`, ephemeral: true });
            }
            if (!isLavalinkConnected) {
              return interaction.reply({ content: `${config.emojis.error} Lavalink chưa kết nối`, ephemeral: true });
            }

            await interaction.deferReply();

            let player = riffy.players.get(guild.id);
            if (!player) {
              player = riffy.createConnection({
                guildId: guild.id,
                voiceChannel: member.voice.channel.id,
                textChannel: channel.id,
                deaf: true
              });
            }

            let added = 0;
            for (const item of saved) {
              try {
                const resolved = await riffy.resolve({ query: item.uri, requester: member.id });
                const track = resolved?.tracks?.[0];
                if (track) {
                  track.info.requester = member.id;
                  player.queue.add(track);
                  added++;
                }
              } catch {
                // Bỏ qua bài hát bị lỗi khi tải lại
              }
            }

            if (!player.playing && !player.paused) player.play();

            const container = createSimpleContainerNoButtons(
              'Đã tải Playlist',
              `Đã thêm **${added}/${saved.length}** bài hát từ playlist **${name}** vào hàng chờ`,
              config.emojis.success
            );
            return interaction.editReply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
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
          await interaction.reply({ components: [createInviteContainer()], flags: MessageFlags.IsComponentsV2 });
        }

        if (commandName === 'support') {
          await interaction.reply({ components: [createSupportContainer()], flags: MessageFlags.IsComponentsV2 });
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

            await handleSkipRequest(message.guild.id, player, message.member, (content) => message.reply(content));
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

            const container = createNowPlayingContainer(player, player.current, false);
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

          if (command === 'filter') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            const name = (args[0] || '').toLowerCase();
            if (!name) {
              return message.reply(`${config.emojis.error} Vui lòng chọn bộ lọc: off, bassboost, nightcore, vaporwave, 8d, slowedreverb`);
            }
            await handleFilterCommand(player, name, (content) => message.reply(content));
          }

          if (command === 'seek') {
            const player = riffy.players.get(message.guild.id);
            if (!player || !player.current) return message.reply(`${config.emojis.error} Không có bài hát nào đang phát`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            const ms = parseTimeToMs(args[0]);
            if (ms === null || ms < 0) {
              return message.reply(`${config.emojis.error} Định dạng thời gian không hợp lệ (vd: 1:30 hoặc 90)`);
            }
            if (ms > (player.current.info.length || 0)) {
              return message.reply(`${config.emojis.error} Thời điểm vượt quá độ dài bài hát`);
            }

            player.seek(ms);
            const container = createSimpleContainer('Đã tua nhạc', `Đã tua đến \`${formatTime(ms)}\``, config.emojis.info);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'replay') {
            const player = riffy.players.get(message.guild.id);
            if (!player || !player.current) return message.reply(`${config.emojis.error} Không có bài hát nào đang phát`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            player.seek(0);
            if (player.paused) player.pause(false);
            const container = createSimpleContainer('Đã phát lại', 'Đang phát lại bài hát từ đầu', config.emojis.play);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'previous') {
            const player = riffy.players.get(message.guild.id);
            if (!player) return message.reply(`${config.emojis.error} Không tìm thấy người chơi`);
            if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
              return message.reply(`${config.emojis.error} Bạn cần ở cùng kênh thoại`);
            }

            const hist = historyMap.get(message.guild.id) || [];
            if (hist.length < 2) {
              return message.reply(`${config.emojis.error} Không có bài hát trước đó trong lịch sử`);
            }

            const prevTrack = hist[hist.length - 2];
            hist.splice(hist.length - 2, 2);
            historyMap.set(message.guild.id, hist);

            player.queue.unshift(prevTrack);
            player.stop();

            const container = createSimpleContainerNoButtons('Quay lại bài trước', `Đang phát lại: **[${prevTrack.info.title}](${prevTrack.info.uri})**`, config.emojis.success);
            await message.reply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
          }

          if (command === 'lyrics') {
            const player = riffy.players.get(message.guild.id);
            if (!player || !player.current) return message.reply(`${config.emojis.error} Không có bài hát nào đang phát`);

            try {
              const info = player.current.info;
              const artist = encodeURIComponent(info.author || '');
              const title = encodeURIComponent(cleanTrackTitle(info.title || ''));
              const res = await fetch(`https://api.lyrics.ovh/v1/${artist}/${title}`);
              const data = await res.json();

              if (!data.lyrics) {
                return message.reply(`${config.emojis.error} Không tìm thấy lời bài hát cho **${info.title}**`);
              }

              let lyrics = data.lyrics.trim();
              if (lyrics.length > 3800) lyrics = lyrics.slice(0, 3800) + '\n*(...đã cắt bớt)*';

              const container = new ContainerBuilder()
                .setAccentColor(ACCENT_COLOR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📜 Lời bài hát\n**${info.title}**`))
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(lyrics))
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                .addTextDisplayComponents(brandFooter());

              await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (err) {
              console.error('Lỗi lấy lời bài hát:', err);
              await message.reply(`${config.emojis.error} Không thể lấy lời bài hát lúc này`);
            }
          }

          if (command === 'autoplay') {
            if (autoplayGuilds.has(message.guild.id)) {
              autoplayGuilds.delete(message.guild.id);
              const container = createSimpleContainer('Đã tắt Autoplay', 'Bot sẽ dừng lại khi hết hàng chờ như bình thường', config.emojis.info);
              await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
              autoplayGuilds.add(message.guild.id);
              const container = createSimpleContainer('Đã bật Autoplay', 'Bot sẽ tự động phát nhạc liên quan khi hết hàng chờ', config.emojis.success);
              await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
          }

          if (command === 'playlist') {
            const sub = (args[0] || '').toLowerCase();
            const name = (args[1] || '').toLowerCase().slice(0, 32);
            const playlists = readPlaylists();
            const userPlaylists = playlists[message.author.id] || {};

            if (sub === 'save') {
              if (!name) return message.reply(`${config.emojis.error} Vui lòng nhập tên playlist: \`${config.prefix}playlist save <tên>\``);
              const player = riffy.players.get(message.guild.id);
              if (!player || (!player.current && player.queue.length === 0)) {
                return message.reply(`${config.emojis.error} Không có bài hát nào để lưu`);
              }

              const tracks = [];
              if (player.current) tracks.push({ title: player.current.info.title, uri: player.current.info.uri });
              player.queue.forEach((t) => tracks.push({ title: t.info.title, uri: t.info.uri }));

              userPlaylists[name] = tracks;
              playlists[message.author.id] = userPlaylists;
              writePlaylists(playlists);

              const container = createSimpleContainer('Đã lưu Playlist', `Đã lưu **${tracks.length}** bài hát vào playlist **${name}**`, config.emojis.success);
              return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (sub === 'list') {
              const names = Object.keys(userPlaylists);
              const desc = names.length
                ? names.map((n, i) => `\`${i + 1}.\` **${n}** — ${userPlaylists[n].length} bài hát`).join('\n')
                : `Bạn chưa có playlist nào. Dùng \`${config.prefix}playlist save <tên>\` để tạo!`;
              const container = createSimpleContainer('Playlist của bạn', desc, config.emojis.queue);
              return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (sub === 'delete') {
              if (!name || !userPlaylists[name]) {
                return message.reply(`${config.emojis.error} Không tìm thấy playlist **${name || ''}**`);
              }
              delete userPlaylists[name];
              playlists[message.author.id] = userPlaylists;
              writePlaylists(playlists);

              const container = createSimpleContainer('Đã xóa Playlist', `Đã xóa playlist **${name}**`, config.emojis.success);
              return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (sub === 'load') {
              const saved = userPlaylists[name];
              if (!name || !saved || saved.length === 0) {
                return message.reply(`${config.emojis.error} Không tìm thấy playlist **${name || ''}**`);
              }
              if (!message.member.voice.channel) {
                return message.reply(`${config.emojis.error} Bạn cần ở trong kênh thoại`);
              }
              if (!isLavalinkConnected) {
                return message.reply(`${config.emojis.error} Lavalink chưa kết nối`);
              }

              let player = riffy.players.get(message.guild.id);
              if (!player) {
                player = riffy.createConnection({
                  guildId: message.guild.id,
                  voiceChannel: message.member.voice.channel.id,
                  textChannel: message.channel.id,
                  deaf: true
                });
              }

              let added = 0;
              for (const item of saved) {
                try {
                  const resolved = await riffy.resolve({ query: item.uri, requester: message.author.id });
                  const track = resolved?.tracks?.[0];
                  if (track) {
                    track.info.requester = message.author.id;
                    player.queue.add(track);
                    added++;
                  }
                } catch {
                  // Bỏ qua bài hát bị lỗi khi tải lại
                }
              }

              if (!player.playing && !player.paused) player.play();

              const container = createSimpleContainerNoButtons(
                'Đã tải Playlist',
                `Đã thêm **${added}/${saved.length}** bài hát từ playlist **${name}** vào hàng chờ`,
                config.emojis.success
              );
              return message.reply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
            }

            if (!sub) {
              return message.reply(`${config.emojis.error} Cách dùng: \`${config.prefix}playlist <save|load|list|delete> [tên]\``);
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
            await message.reply({ components: [createInviteContainer()], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'support') {
            await message.reply({ components: [createSupportContainer()], flags: MessageFlags.IsComponentsV2 });
          }

          if (command === 'help') {
            const helpContainer = createHelpContainer();
            await message.reply({ components: [helpContainer], flags: MessageFlags.IsComponentsV2 });
          }
        });
      }

      client.login(config.token);
