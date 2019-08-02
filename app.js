process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});
process.env.NTBA_FIX_319 = 1;

const fs = require('fs-extra');
const TelegramBot = require('node-telegram-bot-api');

// Notify user update // TODO: remove this after the next version
try {
  const { telegramUserId } = fs.readJSONSync('./config.json');
  const telegram = new TelegramBot('746223720:AAFOzf75YuDp1N5xcHLV7EKozB7C0huuw2Y');
  telegram.sendMessage(telegramUserId, 'WARNING: This is a major update. Please delete this old bot and install the new one here: https://drive.google.com/open?id=1BQjBmBGoYHg3afB74SXI3bKAwhTrEC92');
} catch (e) {
  console.log(e);
}
// Notify user update

// TODO: enable this after the next version

// const cluster = require('cluster');
// const ccxt = require('ccxt');
// const express = require('express');
// const autoReloadJson = require('auto-reload-json');
// const _ = require('lodash');
// const open = require('open');

// // Express server
// const app = express();
// const http = require('http').Server(app);
// const io = require('socket.io')(http);
// // Express server

// const {
//   loggingMessage, calculateMinAmount, fetchMarket, fetchInfoPair, fetchActiveOrder, calculateAmount2Sell, ioEmitter,
// } = require('./helper');
// const { startStrategy, stopStrategy, setTelegram } = require('./strategy');

// if (cluster.isMaster) {
//   cluster.fork();

//   cluster.on('exit', async () => {
//     const { general: { telegramToken }, current: { telegramUserId } } = await fs.readJSON('./setting.json');
//     if (telegramUserId !== '') {
//       console.log('New files are applied. Resetting...');
//       const telegram = new TelegramBot(telegramToken);
//       telegram.sendMessage(telegramUserId, 'An update is available. New files are applied.');
//     }

//     setTimeout(() => {
//       cluster.fork();
//     }, 60000);
//   });
// } else {
//   // Express server
//   const port = process.env.PORT || 3000;

//   app.use(express.static(__dirname));

//   app.get('/', (req, res) => {
//     res.sendFile(`${__dirname}/index.html`);
//   });

//   io.on('connection', (socket) => {
//     console.log('a user connected');
//     socket.on('disconnect', () => {
//       console.log('user disconnected');
//     });
//   });

//   http.listen(port, async () => {
//     const endPoint = `http://localhost:${port}`;
//     console.log(`Server is up on ${endPoint}`);
//     await open(endPoint);
//   });
//   // Express server

//   // Remember last states
//   global.shouldStop = false;
//   global.isRunning = false;
//   global.messages = [];
//   // Remember last states

//   // Live Read Setting
//   const settings = autoReloadJson(`${__dirname}/setting.json`);

//   let exchange = new ccxt[settings.current.exchangeID]({
//     apiKey: settings.current.apiKey,
//     secret: settings.current.secret,
//     password: settings.current.password,
//     options: { adjustForTimeDifference: true, recvWindow: 10000000, warnOnFetchOpenOrdersWithoutSymbol: false },
//   });

//   io.on('connection', (socket) => {
//   // Reload previous messages, states
//     global.messages.slice(Math.max(global.messages.length - 20, 0)).map(({ triggerType, mess }) => io.emit(triggerType, mess));
//     io.emit('isRunning', global.isRunning);

//     // Fetch Market
//     socket.on('fetch:market', async () => {
//       try {
//         const fetchedMarket = await fetchMarket(exchange);
//         io.emit('fetch:market:return', fetchedMarket);
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Fetch main coin
//     socket.on('fetch:infoMAIN', async (selectedCoinMAIN) => {
//       try {
//         const fetchedMainCoin = await fetchInfoPair(exchange, selectedCoinMAIN);
//         io.emit('fetch:infoMAIN:return', fetchedMainCoin);
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Calc amount to buy on Main
//     socket.on('amount', async ({ market, pair, percentage }) => {
//       try {
//         const { free } = await exchange.fetchBalance();
//         const { ask } = await exchange.fetchTicker(pair);
//         const minAmount = calculateMinAmount(pair, ask);
//         const orgAmount = free[market] / ask * percentage;
//         const amount = orgAmount >= minAmount ? orgAmount : minAmount;
//         io.emit('amount:return', amount);
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Main start
//     socket.on('main-start', (data) => {
//       ioEmitter(io, 'general', loggingMessage('Starting the bot'));
//       startStrategy({
//         exchange, io, telegramUserId: settings.current.telegramUserId, ...data,
//       });
//     });

//     // Main stop
//     socket.on('main-stop', () => {
//       stopStrategy(io);
//     });

//     // Orders page
//     // Fetch active order
//     let isFirstInitFetchOrder = true;
//     socket.on('fetch:order', async () => {
//       await fetchActiveOrder(exchange, io);
//       if (isFirstInitFetchOrder) {
//         isFirstInitFetchOrder = false;
//         setInterval(async () => {
//           await fetchActiveOrder(exchange, io);
//         }, 250000);
//       }
//     });

//     // Market Sell and Cancel btn

//     socket.on('marketAction', async ({
//       symbol, orderId, action, remaining,
//     }) => {
//       try {
//         await exchange.cancelOrder(orderId, symbol);
//         const enhancedRemain = await calculateAmount2Sell(exchange, symbol, remaining);
//         if (action === 'market-buy') {
//           await exchange.createMarketBuyOrder(symbol, enhancedRemain);
//         } else if (action === 'market-sell') {
//           await exchange.createMarketSellOrder(symbol, enhancedRemain);
//         }
//         await fetchActiveOrder(exchange, io);
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Manual page

//     // Calc minAmount

//     socket.on('minAmount', ([pair, rate]) => {
//       const minAmount = calculateMinAmount(pair, rate.value);
//       io.emit('minAmount:return', minAmount);
//     });

//     // Get rate
//     socket.on('fetch:infoPair', async (selectedCoin) => {
//       try {
//         const fetchedCoin = await fetchInfoPair(exchange, selectedCoin);
//         io.emit('fetch:infoPair:return', fetchedCoin);
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Fetch balance to manually buy and sell

//     socket.on('balance', async (market) => {
//       try {
//         const { free } = await exchange.fetchBalance();
//         const balance = free[market];
//         io.emit('balance:return', balance);
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Buy btn

//     socket.on('manual:buy', async ([pair, rate, orderType, amount]) => {
//       try {
//         await exchange.createLimitBuyOrder(pair, amount.value, rate.value);
//         io.emit('manual:buy:return', 'successful');
//       } catch (e) {
//         io.emit('manual:buy:return', 'failed');
//         console.log(e);
//       }
//     });

//     // Sell btn

//     socket.on('manual:sell', async ([pair, rate, orderType, amount]) => {
//       try {
//         await exchange.createLimitSellOrder(pair, amount.value, rate.value);
//         io.emit('manual:sell:return', 'successful');
//       } catch (e) {
//         io.emit('manual:sell:return', 'failed');
//         console.log(e);
//       }
//     });

//     // Setting page

//     socket.on('setting:get', () => {
//       io.emit('setting:get:return', settings);
//     });

//     // Save general settings
//     socket.on('setting:general:save', async (data) => {
//       try {
//         let setting = {};
//         data.map(({ name, value }) => {
//           setting = { ...setting, [name]: value };
//         });

//         setTelegram(setting.telegramToken);

//         await fs.writeJSON('setting.json', { ...settings, general: setting });
//         io.emit('setting:get:return', { ...settings, general: setting });
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Change current account on selecting
//     socket.on('setting:currentAccount', async (name) => {
//       try {
//         const currentAccount = settings.list.find(o => o.name === name);
//         const {
//           exchangeID, apiKey, secret, password,
//         } = currentAccount;

//         exchange = new ccxt[exchangeID]({
//           apiKey,
//           secret,
//           password,
//           options: { adjustForTimeDifference: true, recvWindow: 10000000, warnOnFetchOpenOrdersWithoutSymbol: false },
//         });

//         await fs.writeJSON('setting.json', { ...settings, current: currentAccount });
//         io.emit('setting:currentAccount:return', currentAccount);
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Update current account settings
//     socket.on('setting:save', async (data, oldAccountName) => {
//       try {
//         let setting = {};
//         data.map(({ name, value }) => {
//           setting = { ...setting, [name]: value };
//         });
//         const {
//           exchangeID, apiKey, secret, password,
//         } = setting;

//         exchange = new ccxt[exchangeID]({
//           apiKey,
//           secret,
//           password,
//           options: { adjustForTimeDifference: true, recvWindow: 10000000, warnOnFetchOpenOrdersWithoutSymbol: false },
//         });

//         const clonedList = _.cloneDeep(settings.list);
//         const oldAccountIndex = clonedList.findIndex(o => o.name === oldAccountName);
//         clonedList[oldAccountIndex] = setting;

//         await fs.writeJSON('setting.json', { ...settings, current: setting, list: clonedList });
//         io.emit('setting:get:return', { ...settings, current: setting, list: clonedList });
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Add new account
//     socket.on('setting:post', async (data) => {
//       try {
//         let setting = {};
//         data.map(({ name, value }) => {
//           setting = { ...setting, [name]: value };
//         });
//         const clonedList = _.cloneDeep(settings.list);
//         clonedList.push(setting);

//         await fs.writeJSON('setting.json', { ...settings, list: clonedList });
//         io.emit('setting:get:return', { ...settings, list: clonedList });
//       } catch (e) {
//         console.log(e);
//       }
//     });

//     // Delete account
//     socket.on('setting:delete', async (name) => {
//       try {
//         const clonedList = _.cloneDeep(settings.list);
//         _.remove(clonedList, o => o.name === name);

//         await fs.writeJSON('setting.json', { ...settings, current: clonedList[0], list: clonedList });
//         io.emit('setting:currentAccount:return', clonedList[0]);
//         io.emit('setting:get:return', { ...settings, current: clonedList[0], list: clonedList });
//       } catch (e) {
//         console.log(e);
//       }
//     });
//   });
// }
