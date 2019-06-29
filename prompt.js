const prompts = require('prompts');
const fs = require('fs-extra');

const checkEmpty = (value, keyName) => {
  if (value === '' || value === null) {
    return `Please enter your ${keyName}`;
  }
  return true;
};

module.exports = async () => {
  try {
    const questions = [
      {
        type: 'select',
        name: 'exchangeID',
        message: 'Select an exchange',
        choices: [
          { title: 'Binance (Highly Recommended)', value: 'binance' },
          { title: 'Bittrex', value: 'bittrex' },
          { title: 'Kucoin', value: 'kucoin' },
        ],
        initial: 0,
      },
      {
        type: 'text',
        name: 'apiKey',
        message: 'API Key',
        validate: value => checkEmpty(value, 'API Key'),
      },
      {
        type: 'text',
        name: 'secret',
        message: 'API Secret Key',
        validate: value => checkEmpty(value, 'API Secret Key'),
      },
      {
        type: prev => (prev === 'kucoin' ? 'text' : null),
        name: 'password',
        message: 'API Passphrase',
        validate: value => checkEmpty(value, 'API Passphrase'),
      },
      {
        type: 'number',
        name: 'telegramUserId',
        message: 'Telegram User Id (View doc file to find out more)',
        validate: value => checkEmpty(value, 'Telegram User Id'),
      },
    ];
    const response = await prompts(questions);
    const currentSetting = await fs.readJSON('./config.json.sample');

    await fs.writeJson('./config.json', { ...currentSetting, ...response }, { spaces: 2 });
  } catch (e) {
    return true;
  }
};
