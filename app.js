process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});
process.env.NTBA_FIX_319 = 1;

Number.prototype.toFixedNumber = function (x, base) {
  const pow = Math.pow(base || 10, x);
  return +(Math.floor(this * pow) / pow);
};

Number.prototype.noExponents = function () {
  const data = String(this).split(/[eE]/);
  if (data.length == 1) return data[0];
  let z = ''; const sign = this < 0 ? '-' : '';
  const str = data[0].replace('.', '');
  let mag = Number(data[1]) + 1;
  if (mag < 0) {
    z = `${sign}0.`;
    while (mag++) z += '0';
    return z + str.replace(/^\-/, '');
  }
  mag -= str.length;
  while (mag--) z += '0';
  return str + z;
};

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const _ = require('lodash');
const moment = require('moment');
const ccxt = require('ccxt');
const Bottleneck = require('bottleneck');

let delay = 0;
const baseDelay = 1000;

const {
  AsyncArray, isAmountOk, messageTrade, fetchCandle, writeDangling, writeBought, checkBuy, calculateAmount2Sell, commonIndicator, upTrend, smoothedHeikin, slowHeikin, obvOscillatorRSI, restart,
} = require('./helper');

const {
  apiKey, secret, telegramUserId, marketPlace, useFundPercentage, takeProfitPct, stopLossPct, useStableMarket, stableMarket, timeOrder, timeFrame, timeFrameStableMarket, exchangeID,
} = require('./config');

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: delay,
});

const autoUpdater = require('./autoUpdater');

const telegram = new TelegramBot('746223720:AAFOzf75YuDp1N5xcHLV7EKozB7C0huuw2Y');
console.log('Please use your Telegram app and find @onfqzmpgvrbot, tap /start in order for the bot send messages to you');

const exchange = new ccxt[exchangeID]({
  apiKey,
  secret,
  options: { adjustForTimeDifference: true, recvWindow: 10000000, warnOnFetchOpenOrdersWithoutSymbol: false },
});

const takeProfit = (100 + takeProfitPct) / 100;
const stopLoss = (100 - stopLossPct) / 100;

(async function start() {
  try {
    const { bought, dangling } = await fs.readJSON('./trade.json');

    const markets = await exchange.fetchMarkets();
    const checkMarketPlace = new RegExp(`${marketPlace}$`, 'g');
    const checkStableMarkets = new RegExp(`${stableMarket}$`, 'g');
    const filterMarkets = markets.filter(o => checkMarketPlace.test(o.symbol)).filter(o => o.active === true);
    const filterStableMarkets = markets.filter(o => checkStableMarkets.test(o.symbol)).filter(o => o.active === true);

    if (dangling.length > 0) {
      await Promise.all(dangling.map(({ id, pair }) => limiter.schedule(() => new Promise(async (resolve) => {
        try {
          const { precision } = _.find(markets, o => o.symbol === pair);
          const {
            filled, status, symbol, price,
          } = await exchange.fetchOrder(id, pair);

          if (status === 'open') {
            await exchange.cancelOrder(id, pair);
          }

          if (filled > 0) {
            const rate2Sell = price * takeProfit;
            const amount2Sell = await calculateAmount2Sell(exchange, pair, filled);
            const checkAmount = isAmountOk(marketPlace, amount2Sell, rate2Sell);

            if (checkAmount) {
              const sellRef = await exchange.createLimitSellOrder(symbol, amount2Sell.toFixedNumber(precision.amount).noExponents(), rate2Sell.toFixedNumber(precision.price).noExponents());
              await writeBought(dangling, bought, pair, id, sellRef.id);
              console.log('Unresolved order, selling dangling order');
              messageTrade(sellRef, 'Sell', amount2Sell, symbol, rate2Sell, telegram, telegramUserId);
            }
          } else {
            await writeBought(dangling, bought, pair, id);
          }
          resolve();
        } catch (e) {
          await writeBought(dangling, bought, pair, id);
        }
      }))));
    }

    const accountBalance = await exchange.fetchBalance();

    const marketPlaceBalance = !_.isUndefined(accountBalance.free[marketPlace]) ? accountBalance.free[marketPlace] * (useFundPercentage / 100) : 0;
    const stableCoinBalance = !_.isUndefined(accountBalance.free[stableMarket]) ? accountBalance.free[stableMarket] : 0;

    if (marketPlaceBalance < 0.001 && stableCoinBalance < 11) {
      console.log(`You have too small ${marketPlace}, plzz deposit more or cancel open order`);
      throw new Error('At check balance step');
    } else if (stableCoinBalance >= 11) {
      console.log(`The bot moved your fund to ${stableMarket}, it is waiting for the right opportunity to buy ${marketPlace} back`);
    }

    if (useStableMarket) {
      const { precision: { amount, price } } = _.find(markets, o => o.symbol === `${marketPlace}/${stableMarket}`);
      const {
        opens, highs, lows, closes,
      } = await fetchCandle(exchange, `${marketPlace}/${stableMarket}`, timeFrameStableMarket);
      const { bid } = await exchange.fetchTicker(`${marketPlace}/${stableMarket}`);
      const { shouldSellSlowHeikin } = slowHeikin(opens, highs, lows, closes, 6, 0.666, 0.0645);
      const historyOrder = await exchange.fetchMyTrades(`${marketPlace}/${stableMarket}`);
      const isDoubleSellCheckOk = historyOrder.length === 0 ? true : _.last(historyOrder).side === 'buy';

      if (shouldSellSlowHeikin && marketPlaceBalance >= 0.001 && isDoubleSellCheckOk) {
        const sellRef = await exchange.createLimitSellOrder(`${marketPlace}/${stableMarket}`, marketPlaceBalance.toFixedNumber(amount).noExponents(), bid.toFixedNumber(price).noExponents());

        messageTrade(sellRef, 'Sell', marketPlaceBalance, `${marketPlace}/${stableMarket}`, bid, telegram, telegramUserId);
      }
    }

    const openOrders = await exchange.fetchOpenOrders();
    let scanMarkets = [];

    if (useStableMarket && stableCoinBalance >= 11 && marketPlaceBalance >= 0.001) {
      scanMarkets = [...filterMarkets, ...filterStableMarkets];
    } else if (useStableMarket && stableCoinBalance >= 11) {
      scanMarkets = filterStableMarkets;
    } else if (marketPlaceBalance >= 0.001) {
      scanMarkets = filterMarkets;
    }

    if (scanMarkets.length === 0) {
      console.log('Doesn\'t have anything to scan');
      throw new Error('At check pairs to scan step');
    }

    const candleMarkets = await Promise.all(scanMarkets.map(({ symbol }) => limiter.schedule(() => new Promise(async (resolve, reject) => {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        const boughtIndex = openOrders.findIndex(o => o.symbol === symbol);

        if (boughtIndex === -1) {
          const candles = await fetchCandle(exchange, symbol, timeFrame);

          console.log(`[${moment().format('HH:mm:ss DD/MM/YYYY')}] - Scanning: ${symbol}`);

          resolve({
            pair: symbol, ...candles, ...ticker,
          });
        } else {
          resolve(null);
        }
      } catch (e) {
        if (e.message.includes('429')) {
          reject(e);
        } else {
          resolve(null);
        }
      }
    }))));

    const compactCandleMarkets = _.compact(candleMarkets);

    const listShouldBuy = await Promise.all(compactCandleMarkets.map(({
      pair, opens, highs, lows, closes, vols, last, bid, quoteVolume, percentage,
    }) => limiter.schedule(() => new Promise(async (resolve, reject) => {
      try {
        const {
          baseRate, lastRSI, lastEMA, spikyVal, changeBB, orderThickness, bidVol, askVol,
        } = await commonIndicator(exchange, closes, last, pair);
        const shouldBuyUpTrend = upTrend(opens, highs, lows, closes);
        const shouldBuySmmothedHeikin = smoothedHeikin(opens, highs, lows, closes, 14);
        const { shouldBuySlowHeikin } = slowHeikin(opens, highs, lows, closes, 6, 0.666, 0.0645);

        const OBVOscRSIVal = obvOscillatorRSI(closes, vols, 7);

        const volOscRSI = _.last(OBVOscRSIVal) - OBVOscRSIVal[OBVOscRSIVal.length - 2];
        const volDiff = bidVol / askVol;
        const volChecker = volDiff >= 0.75 || volOscRSI > 0;

        const baseCondition = last >= 0.000001 && last <= lastEMA && spikyVal <= 3.5 && changeBB >= 1.08 && quoteVolume >= 1 && orderThickness >= 0.95 && volChecker;
        const strategyResult = `[${moment().format('HH:mm:ss DD/MM/YYYY')}] - Calculating Strategy: ${pair} - Result:`;

        if (last <= baseRate && lastRSI <= 35 && baseCondition) {
          console.log(strategyResult, 'SUCCESS');
          resolve({
            pair, percentage, bid, baseRate, method: 'Dip',
          });
        } else if (shouldBuySmmothedHeikin && baseCondition) {
          console.log(strategyResult, 'SUCCESS');
          resolve({
            pair, percentage, bid, baseRate, method: 'Smoothed Heikin',
          });
        } else if (shouldBuySlowHeikin && baseCondition) {
          console.log(strategyResult, 'SUCCESS');
          resolve({
            pair, percentage, bid, baseRate, method: 'Slow Heikin',
          });
        } else if (shouldBuyUpTrend && baseCondition) {
          console.log(strategyResult, 'SUCCESS');
          resolve({
            pair, percentage, bid, baseRate, method: 'Top',
          });
        } else {
          console.log(strategyResult, 'FAIL');
          resolve(null);
        }
      } catch (e) {
        reject(e);
      }
    }))));

    const compactListShouldBuy = _.compact(listShouldBuy);

    if (compactListShouldBuy.length === 0) {
      console.log('There is nothing to buy at the moment');
      throw new Error('At check list should buy step');
    }

    if (compactListShouldBuy.length > 0) {
      const {
        pair, bid, baseRate, method,
      } = _.minBy(compactListShouldBuy, 'percentage');
      const { precision: { amount, price } } = _.find(markets, o => o.symbol === pair);
      let rate2Buy;

      rate2Buy = method === 'Dip' ? baseRate : bid;
      if (rate2Buy > bid) {
        rate2Buy = bid;
      }

      const targetBalance = checkMarketPlace.test(pair) ? marketPlaceBalance : stableCoinBalance;

      const amount2Buy = (targetBalance / rate2Buy) * 0.9975;
      const buyRef = await exchange.createLimitBuyOrder(pair, amount2Buy.toFixedNumber(amount).noExponents(), rate2Buy.toFixedNumber(price).noExponents());

      await writeDangling(dangling, bought, pair, buyRef.id);
      messageTrade(buyRef, `Buy (${method})`, amount2Buy, pair, rate2Buy, telegram, telegramUserId);

      const buyFilled = await checkBuy(exchange, timeOrder, buyRef.id, pair, telegram, telegramUserId);

      if (buyFilled > 0) {
        const amount2Sell = await calculateAmount2Sell(exchange, pair, buyFilled);
        const rate2Sell = rate2Buy * takeProfit;

        const checkAmount = isAmountOk(marketPlace, amount2Sell, rate2Sell);
        if (checkAmount) {
          const sellRef = await exchange.createLimitSellOrder(pair, amount2Sell.toFixedNumber(amount).noExponents(), rate2Sell.toFixedNumber(price).noExponents());
          messageTrade(sellRef, 'Sell', amount2Sell, pair, rate2Sell, telegram, telegramUserId);
          await writeBought(dangling, bought, pair, buyRef.id, sellRef.id);
        }
      } else {
        throw new Error('At check bought or not');
      }
    }
    throw new Error('Everything is fine');
  } catch (e) {
    try {
      if (delay <= 10000 && e.message.includes('429')) {
        delay += baseDelay;
        limiter.updateSettings({
          maxConcurrent: 1,
          minTime: delay,
        });
      }
      const { dangling, bought } = await fs.readJSON('./trade.json');
      if (bought.length > 0) {
        const markets = await exchange.fetchMarkets();
        const waitSell = [];
        const boughtAsync = new AsyncArray(bought);
        const shouldStopLoss = await boughtAsync.filterAsync(({ id, pair }) => limiter.schedule(() => new Promise(async (resolve) => {
          try {
            const { last } = await exchange.fetchTicker(pair);
            const {
              price, datetime, status, filled,
            } = await exchange.fetchOrder(id, pair);

            if (status === 'closed') {
              telegram.sendMessage(telegramUserId, `Sold ${filled} ${pair} at rate = ${price}`);
            }

            const currentTime = moment();
            const targetTime = moment(datetime);
            const diffTime = moment.duration(currentTime.diff(targetTime)).asHours();

            const diffPrice = last / price;
            if (diffTime >= 24 || (diffPrice <= stopLoss && diffTime >= 3)) {
              const cancel = await exchange.cancelOrder(id, pair);
              console.log('Cancel sell order due to exceed time');
              console.log(cancel);
              resolve(true);
            } else {
              waitSell.push({ id, pair });
              resolve(false);
            }
          } catch (error) {
            resolve(false);
          }
        })));

        const tempBought = shouldStopLoss.length > 0 ? await Promise.all(shouldStopLoss.map(({ id, pair }) => limiter.schedule(() => new Promise(async (resolve, reject) => {
          try {
            const { precision } = _.find(markets, o => o.symbol === pair);
            const { amount, filled } = await exchange.fetchOrder(id, pair);
            const { bid } = await exchange.fetchTicker(pair);
            const rate2StopLoss = bid * 0.99;
            const remain = await calculateAmount2Sell(exchange, pair, amount - filled);
            const checkAmount = isAmountOk(marketPlace, remain, rate2StopLoss);

            if (checkAmount) {
              const stopLossRef = await exchange.createLimitSellOrder(pair, remain.toFixedNumber(precision.amount).noExponents(), rate2StopLoss.toFixedNumber(precision.price).noExponents());

              messageTrade(stopLossRef, 'Stop Loss', remain, pair, rate2StopLoss, telegram, telegramUserId);
              resolve({ id: stopLossRef.id, pair });
            } else {
              resolve(null);
            }
          } catch (error) {
            reject(error);
          }
        })))) : null;

        const newBought = [...waitSell, ..._.compact(tempBought)];
        await fs.writeJSON('./trade.json', { dangling, bought: newBought });
      }
      restart(start, e);
      await autoUpdater('https://codeload.github.com/dotai2012/ultimate-bot/zip/master');
    } catch (error) {
      restart(start, error);
    }
  }
}());
