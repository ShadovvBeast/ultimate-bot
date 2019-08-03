const axios = require('axios');

module.exports = async (telegram, telegramUserID) => {
  const message = await axios.get('https://raw.githubusercontent.com/dotai2012/ultimate-bot/master/message.txt');
  const trimmedMessage = message.data.trim();
  if (trimmedMessage !== '') {
    telegram.sendMessage(telegramUserID, trimmedMessage);
  }
};
