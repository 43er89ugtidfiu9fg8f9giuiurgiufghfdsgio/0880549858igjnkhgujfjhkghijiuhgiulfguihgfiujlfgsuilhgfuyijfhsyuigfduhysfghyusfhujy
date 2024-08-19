const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const TOKEN = process.env.DISCORD_TOKEN;
const COOKIE = process.env.ROBLOX_COOKIE;
const GROUP_ID = process.env.GROUP_ID;
const RANKING_ROLE_IDS = process.env.RANKING_ROLE_IDS.split(',');
const TDU_ROLE_ID = process.env.TDU_ROLE_ID;
const CHECK_GROUP_ID = process.env.CHECK_GROUP_ID.split(',');

const cooldowns = new Collection();
const SPAM_LIMIT = 3;
const spamTracker = new Collection();
const ipBansFilePath = path.join(__dirname, 'IPbans.json');
const ipBans = loadIPBans();
const commands = [
  {
    name: '!rank',
    description: 'Changes the rank of a user to the specified rank.',
    usage: '!rank <RobloxUsername> <RankName>'
  },
  {
    name: '!promote',
    description: 'Promotes a user by a specified number of ranks.',
    usage: '!promote <RobloxUsername> <NumberOfRanks>'
  },
  {
    name: '!demote',
    description: 'Demotes a user by a specified number of ranks.',
    usage: '!demote <RobloxUsername> <NumberOfRanks>'
  },
  {
    name: '!auth',
    description: 'Starts the authentication process for a user.',
    usage: '!auth <RobloxUsername>'
  },
  {
    name: '!verify',
    description: 'Verifies a user after they have placed the verification code in their profile.',
    usage: '!verify'
  },
  {
    name: '!BT',
    description: 'Promotes a Police Recruit to Police Officer.',
    usage: '!BT <RobloxUsername>'
  },
  {
    name: '/commands',
    description: 'Lists all available commands and their usage.',
    usage: '/commands'
  },
  {
    name: '!groups',
    description: 'Shows all groups a user is in and checks if they are in a specific group.',
    usage: '!groups <RobloxUsername>'
  }
];

const groupNames = {
  32914780: 'SCPD Education & Discipline Unit',
  32912779: 'SCPD | Seattle City Police Department',
  32914575: 'SCPD Administration',
  32914539: 'SCPD headquarters',
  32914638: 'SCPD Traffic & Regulations Unit',
  32914600: 'SCPD Academy Protection Unit',
  32914419: 'SCPD Armed Responsive Unit'
};

const verifiedUsersFilePath = path.join(__dirname, 'verifiedUsers.json');
let verifiedUsers = loadVerifiedUsers();
const verificationCodes = new Collection(); // In-memory storage for verification codes

client.login(TOKEN);

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const commandData = [
    new SlashCommandBuilder()
      .setName('commands')
      .setDescription('Lists all available commands and their usage.'),
    new SlashCommandBuilder()
      .setName('ipban')
      .setDescription('Bans a user by their IP address.')
      .addUserOption(option => option.setName('user').setDescription('The user to IP ban').setRequired(true))
  ].map(command => command.toJSON());

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commandData }
    );
    console.log('Successfully registered application (slash) commands.');
  } catch (error) {
    console.error('Error registering application commands:', error);
  }
});

// Load IP bans from the file
function loadIPBans() {
  try {
    if (fs.existsSync(ipBansFilePath)) {
      const data = fs.readFileSync(ipBansFilePath, 'utf8');
      if (data) {
        return JSON.parse(data);
      }
    }
  } catch (error) {
    console.error('Error loading IP bans:', error.message);
  }
  return {}; // Return an empty object if the file is empty or parsing fails
}

// Save IP bans to the file
function saveIPBans() {
  try {
    fs.writeFileSync(ipBansFilePath, JSON.stringify(ipBans, null, 2));
  } catch (error) {
    console.error('Error saving IP bans:', error.message);
  }
}

// Load verified users from the file
function loadVerifiedUsers() {
  try {
    if (fs.existsSync(verifiedUsersFilePath)) {
      const data = fs.readFileSync(verifiedUsersFilePath, 'utf8');
      if (data) {
        return JSON.parse(data);
      }
    }
  } catch (error) {
    console.error('Error loading verified users:', error.message);
  }
  return {}; // Return an empty object if the file is empty or parsing fails
}

// Save verified users to the file
function saveVerifiedUsers() {
  try {
    fs.writeFileSync(verifiedUsersFilePath, JSON.stringify(verifiedUsers, null, 2));
  } catch (error) {
    console.error('Error saving verified users:', error.message);
  }
}

// Generate a verification code
function generateVerificationCode() {
  return Math.random().toString(36).substring(2, 15);
}

// Get CSRF token for making API requests
async function getCSRFToken() {
  try {
    await axios.post('https://auth.roblox.com/v2/logout', {}, {
      headers: { 'Cookie': `.ROBLOSECURITY=${COOKIE}` }
    });
  } catch (err) {
    const csrfToken = err.response.headers['x-csrf-token'];
    if (!csrfToken) {
      throw new Error('CSRF token not found.');
    }
    return csrfToken;
  }
}

// Get Roblox user ID by username
async function getUserID(username) {
  const response = await axios.post('https://users.roblox.com/v1/usernames/users', {
    usernames: [username]
  });
  if (response.data.data.length === 0) {
    throw new Error('Username not found.');
  }
  return response.data.data[0].id;
}

// Get roles in the Roblox group
async function getGroupRoles() {
  const response = await axios.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}/roles`);
  return response.data.roles;
}

// Get user's rank in the Roblox group
async function getUserRank(userId) {
  const response = await axios.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
  const group = response.data.data.find(group => group.group.id === parseInt(GROUP_ID));
  if (!group) {
    throw new Error('User is not in the group.');
  }
  return group.role;
}

// Change user's role in the Roblox group
async function changeUserRole(userId, roleId, csrfToken) {
  await axios.patch(`https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${userId}`, {
    roleId: roleId
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `.ROBLOSECURITY=${COOKIE}`,
      'x-csrf-token': csrfToken
    }
  });
}

// Get user's profile description
async function getProfileDescription(userId) {
  const response = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
  return response.data.description;
}

// Get groups a user is in
async function getUserGroups(userId) {
  const response = await axios.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
  return response.data.data;
}

// Exile user from the Roblox group
async function exileUser(userId, csrfToken) {
  await axios.delete(`https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${userId}`, {
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `.ROBLOSECURITY=${COOKIE}`,
      'x-csrf-token': csrfToken
    }
  });
}

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();
  const commandData = commands.find(cmd => cmd.name === command);
  if (!commandData) return;

  if (command === '!auth') {
    const robloxUsername = args[1];
    if (!robloxUsername) {
      return message.channel.send('Please provide your Roblox username. Usage: `!auth <RobloxUsername>`');
    }

    try {
      const userId = await getUserID(robloxUsername);
      const verificationCode = generateVerificationCode();
      verificationCodes.set(message.author.id, { robloxUsername, verificationCode });
      
      message.channel.send(`Please place the following code in your Roblox profile description: \n\n\`${verificationCode}\``);
    } catch (err) {
      console.error('Error generating verification code:', err.message);
      message.channel.send('Failed to generate verification code. Please try again.');
    }
    return;
  } else if (command === '!verify') {
    const verificationData = verificationCodes.get(message.author.id);
    if (!verificationData) {
      return message.channel.send('You need to authenticate first. Use `!auth <RobloxUsername>` to start the process.');
    }

    try {
      const { robloxUsername, verificationCode } = verificationData;
      const userId = await getUserID(robloxUsername);
      const profileDescription = await getProfileDescription(userId);

      if (profileDescription.includes(verificationCode)) {
        verifiedUsers[message.author.id] = { robloxUsername, userId };
        verificationCodes.delete(message.author.id);
        saveVerifiedUsers();
        message.channel.send(`Successfully verified as ${robloxUsername}!`);
      } else {
        message.channel.send('The verification code is not found in your profile description. Please ensure you have placed the correct code.');
      }
    } catch (err) {
      console.error('Error verifying user:', err.message);
      message.channel.send('Failed to verify your Roblox username. Please try again.');
    }
    return;
  }

  if (!verifiedUsers[message.author.id]) {
    return message.channel.send('You need to verify your Roblox account before using this command. Use `!auth <RobloxUsername>` to start the process.');
  }

  if (command === '!exile') {
    if (args.length < 2) {
      return message.channel.send('Please provide the Roblox username to exile. Usage: `!exile <RobloxUsername>`');
    }

    const robloxUsername = args[1];
    try {
      const userId = await getUserID(robloxUsername);
      const csrfToken = await getCSRFToken();
      await exileUser(userId, csrfToken);
      message.channel.send(`Successfully exiled ${robloxUsername} from the group.`);
    } catch (err) {
      console.error('Error exiling user:', err.message);
      message.channel.send('Failed to exile the user. Please try again.');
    }
    return;
  }

  // Command handling for ranking and group membership
  const robloxUsername = args[1];
  if (!robloxUsername) {
    return message.channel.send(`Usage: ${commandData.usage}`);
  }

  try {
    const userId = await getUserID(robloxUsername);
    const csrfToken = await getCSRFToken();
    const userRank = await getUserRank(userId);
    const groupRoles = await getGroupRoles();

    let newRoleId;
    if (command === '!rank') {
      const rankName = args.slice(2).join(' ');
      const targetRole = groupRoles.find(role => role.name.toLowerCase() === rankName.toLowerCase());
      if (!targetRole) {
        return message.channel.send('Invalid rank name. Please provide a valid rank name.');
      }
      newRoleId = targetRole.id;
    } else if (command === '!promote') {
      const numberOfRanks = parseInt(args[2], 10);
      if (isNaN(numberOfRanks)) {
        return message.channel.send('Invalid number of ranks. Please provide a valid number.');
      }
      const currentRoleIndex = groupRoles.findIndex(role => role.id === userRank.id);
      newRoleId = groupRoles[Math.min(currentRoleIndex + numberOfRanks, groupRoles.length - 1)].id;
    } else if (command === '!demote') {
      const numberOfRanks = parseInt(args[2], 10);
      if (isNaN(numberOfRanks)) {
        return message.channel.send('Invalid number of ranks. Please provide a valid number.');
      }
      const currentRoleIndex = groupRoles.findIndex(role => role.id === userRank.id);
      newRoleId = groupRoles[Math.max(currentRoleIndex - numberOfRanks, 0)].id;
    } else if (command === '!BT') {
      if (userRank.id === 226) {
        const targetRole = groupRoles.find(role => role.id === 229);
        if (!targetRole) {
          return message.channel.send('Invalid target rank. Please provide a valid target rank.');
        }
        newRoleId = targetRole.id;
      } else {
        return message.channel.send('User does not have the required rank to be promoted.');
      }
    }

    await changeUserRole(userId, newRoleId, csrfToken);
    message.channel.send(`Successfully changed the rank of ${robloxUsername} to ${groupRoles.find(role => role.id === newRoleId).name}.`);
  } catch (err) {
    console.error('Error processing command:', err.message);
    message.channel.send('Failed to process the command. Please try again.');
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;
  if (commandName === 'commands') {
    const commandsList = commands.map(cmd => `**${cmd.name}**: ${cmd.description} \nUsage: \`${cmd.usage}\``).join('\n\n');
    const embed = {
      title: 'Available Commands',
      description: commandsList,
      color: 0x00FF00
    };

    if (interaction.user.id === process.env.BOT_CREATOR_ID) {
      embed.footer = {
        text: 'permissions: **bot creator**'
      };
    }

    await interaction.reply({ embeds: [embed] });
  } else if (commandName === 'ipban') {
    const user = interaction.options.getUser('user');
    if (!user) {
      return interaction.reply('User not found.');
    }

    const adminRoleId = '1257097028308303923'; // Admin role ID
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(adminRoleId)) {
      return interaction.reply('You do not have permission to use this command.');
    }

    try {
      const targetMember = await interaction.guild.members.fetch(user.id);
      const ip = targetMember.presence?.clientStatus?.desktop?.ip || targetMember.presence?.clientStatus?.mobile?.ip || 'Unknown';
      if (ip === 'Unknown') {
        return interaction.reply('Could not retrieve the IP address of the user.');
      }

      const currentDate = new Date().toISOString();
      ipBans[ip] = { userId: user.id, date: currentDate };
      saveIPBans();
      await targetMember.ban({ reason: 'IP banned' });
      await interaction.reply(`User ${user.tag} has been IP banned. IP: ${ip}`);
    } catch (error) {
      console.error('Error banning user:', error.message);
      await interaction.reply('Failed to IP ban the user. Please try again.');
    }
  }
});
