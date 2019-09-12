
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
const weightedMean = require('weighted-mean');

const {
  loggingMessage, ioEmitter, AsyncArray, isAmountOk, messageTrade, fetchCandle, writeDangling, writeBought, checkBuy, checkBalance, calculateAmount2Sell, commonIndicator, upTrend, smoothedHeikin, slowHeikin, restart,
} = require('./helper');
const messenger = require('./messenger');
const { general: { telegramToken } } = require('./setting.json');

let delay = 0;
let lastScannedSymbol;
let shouldSkipAllSymbols = false;
let shouldEnableCounterDDOS = false;
const baseDelay = 1000;

const ultimateLimiter = new Bottleneck({
  maxConcurrent: 1,
});

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: delay,
});

const autoUpdater = require('./autoUpdater');

let telegram = new TelegramBot(telegramToken);

let weight = 1;
const weightStep = 0.25 / 48;
setInterval(() => {
  if (weight > 0.85) {
    weight -= weightStep;
  }
}, 1800000);
let initWeightTime = moment();

async function start(data) {
  try {
    global.isRunning = true;
    const {
      telegramUserId, useFundPercentage, useStableMarket, timeOrder, timeFrame, timeFrameStableMarket, enhancedMarketPlace, enhancedStableMarket, exchange, io, takeProfit,
    } = data;

    const { bought, dangling } = await fs.readJSON('./trade.json');

    const checkMarketPlace = new RegExp(`${enhancedMarketPlace}$`, 'g');

    const ultimateExchange = new ccxt.binance({
      options: { adjustForTimeDifference: true, recvWindow: 10000, warnOnFetchOpenOrdersWithoutSymbol: false },
    });
    const ultimateMarkets = await ultimateExchange.fetchMarkets();
    const ultimateFilterMarkets = ultimateMarkets.filter(o => o.active === true && o.quote === enhancedMarketPlace);
    const ultimateFilterStableMarkets = ultimateMarkets.filter(o => o.active === true && o.quote === enhancedStableMarket);

    const markets = await exchange.fetchMarkets();
    const filterMarkets = markets.filter(o => o.active === true && o.quote === enhancedMarketPlace);
    const filterStableMarkets = markets.filter(o => o.active === true && o.quote === enhancedStableMarket);

    const commonMarkets = _.intersectionBy(filterMarkets, ultimateFilterMarkets, 'symbol');
    const commonStableMarkets = _.intersectionBy(filterStableMarkets, ultimateFilterStableMarkets, 'symbol');
    const differentMarkets = _.differenceBy(filterMarkets, ultimateFilterMarkets, 'symbol');
    const differentStableMarkets = _.differenceBy(filterStableMarkets, ultimateFilterStableMarkets, 'symbol');

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

          const rate2Sell = price * takeProfit;
          const amount2Sell = await calculateAmount2Sell(exchange, pair, filled);
          const checkAmount = isAmountOk(pair, amount2Sell, rate2Sell, telegram, telegramUserId, io);

          if (filled > 0 && checkAmount) {
            const sellRef = await exchange.createLimitSellOrder(symbol, amount2Sell.toFixedNumber(precision.amount).noExponents(), rate2Sell.toFixedNumber(precision.price).noExponents());
            await writeBought(dangling, bought, pair, id, sellRef.id);
            ioEmitter(io, 'general', loggingMessage('Unresolved order, selling dangling order'));
            messageTrade(sellRef, 'Sell', amount2Sell, symbol, rate2Sell, telegram, telegramUserId, io, 'trigger:sell');
          } else {
            await writeBought(dangling, bought, pair, id);
            resolve();
          }
        } catch (e) {
          await writeBought(dangling, bought, pair, id);
        }
      }))));
    }

    const accountBalance = await exchange.fetchBalance();

    const marketPlaceBalance = !_.isUndefined(accountBalance.free[enhancedMarketPlace]) ? accountBalance.free[enhancedMarketPlace] * (useFundPercentage / 100) : 0;
    const stableCoinBalance = !_.isUndefined(accountBalance.free[enhancedStableMarket]) ? accountBalance.free[enhancedStableMarket] : 0;

    if (!checkBalance(enhancedMarketPlace, marketPlaceBalance) && !checkBalance(enhancedStableMarket, stableCoinBalance)) {
      ioEmitter(io, 'general', loggingMessage(`You have too small ${enhancedMarketPlace} or ${enhancedStableMarket}, please deposit more or cancel open order`));
      throw new Error('At check balance step');
    }

    if (useStableMarket) {
      const pair = `${enhancedMarketPlace}/${enhancedStableMarket}`;
      const { precision: { amount, price } } = _.find(markets, o => o.symbol === pair);
      const {
        opens, highs, lows, closes, vols,
      } = await fetchCandle(exchange, pair, timeFrameStableMarket);
      const { bid, last } = await exchange.fetchTicker(pair);
      const {
        lastClose, lastEMA, lastPSAR, spikyVal, changeBB, orderThickness, closeDiff, lastVolOsc, volDiff,
      } = await commonIndicator(exchange, highs, lows, closes, vols, last, pair);
      const { shouldBuySmoothedHeikin, shouldSellSmoothedHeikin } = smoothedHeikin(opens, highs, lows, closes, 14);
      const { shouldBuySlowHeikin, shouldSellSlowHeikin } = slowHeikin(opens, highs, lows, closes, 6, 0.666, 0.0645);

      const baseCondition = last <= lastEMA && spikyVal <= 3.5 && changeBB >= 1.08 && closeDiff <= 1.025;
      const volCheckerDown = volDiff <= 0.75 || lastVolOsc < 0;
      const volCheckerUp = volDiff > 0.75 || lastVolOsc > 0;
      const historyOrder = await exchange.fetchMyTrades(`${enhancedMarketPlace}/${enhancedStableMarket}`);
      const isLastBuy = historyOrder.length === 0 ? true : _.last(historyOrder).side === 'buy';
      const isLastSell = historyOrder.length === 0 ? true : _.last(historyOrder).side === 'sell';

      if ((shouldBuySmoothedHeikin || shouldBuySlowHeikin) && checkBalance(enhancedStableMarket, stableCoinBalance) && baseCondition && volCheckerUp && lastPSAR < lastClose && orderThickness >= 0.95 && isLastSell) {
        const buyRef = await exchange.createLimitBuyOrder(pair, marketPlaceBalance.toFixedNumber(amount).noExponents(), bid.toFixedNumber(price).noExponents());
        await writeDangling(dangling, bought, pair, buyRef.id);
        messageTrade(buyRef, 'Buy', marketPlaceBalance, pair, bid, telegram, telegramUserId, io, 'trigger:buy');
        await checkBuy(exchange, timeOrder, buyRef.id, pair, telegram, telegramUserId, io);
      } else if ((shouldSellSmoothedHeikin || shouldSellSlowHeikin) && checkBalance(enhancedMarketPlace, marketPlaceBalance) && volCheckerDown && lastPSAR > lastClose && orderThickness < 0.95 && isLastBuy) {
        const sellRef = await exchange.createLimitSellOrder(pair, marketPlaceBalance.toFixedNumber(amount).noExponents(), bid.toFixedNumber(price).noExponents());
        messageTrade(sellRef, 'Sell', marketPlaceBalance, pair, bid, telegram, telegramUserId, io, 'trigger:sell');
      }
    }

    const marketPlaceInfo = await exchange.fetchTicker(`${enhancedMarketPlace}/${enhancedStableMarket}`);
    if (marketPlaceInfo.percentage >= 5 || marketPlaceInfo.percentage <= -7) {
      if (marketPlaceInfo.percentage >= 5) {
        ioEmitter(io, 'general', loggingMessage(`The ${enhancedMarketPlace} is going up too much, so it's better to pause for a while`));
      } else {
        ioEmitter(io, 'general', loggingMessage(`The ${enhancedMarketPlace} is going down too much, so it's better to pause for a while`));
      }
      throw new Error('At check is stable market step');
    }

    let scanMarkets = [];

    if (useStableMarket && checkBalance(enhancedMarketPlace, marketPlaceBalance) && checkBalance(enhancedStableMarket, stableCoinBalance)) {
      scanMarkets = { common: [...commonMarkets, ...commonStableMarkets], difference: [...differentMarkets, ...differentStableMarkets] };
    } else if (useStableMarket && checkBalance(enhancedStableMarket, stableCoinBalance)) {
      scanMarkets = { common: commonStableMarkets, difference: differentStableMarkets };
    } else if (checkBalance(enhancedMarketPlace, marketPlaceBalance)) {
      scanMarkets = { common: commonMarkets, difference: differentMarkets };
    }

    if (scanMarkets.common.length === 0 && scanMarkets.difference.length === 0) {
      ioEmitter(io, 'general', loggingMessage('Doesn\'t have anything to scan'));
      throw new Error('At check pairs to scan step');
    }

    const openOrders = await exchange.fetchOpenOrders();

    if (openOrders.length >= 2) {
      ioEmitter(io, 'general', loggingMessage('Waiting for other open orders are filled'));
      throw new Error('At check open orders step');
    }

    const candleCommonMarkets = await Promise.all(scanMarkets.common.map(({ symbol }) => ultimateLimiter.schedule(() => new Promise(async (resolve) => {
      try {
        // We we got banned, skip all remain pairs
        if (!shouldSkipAllSymbols) {
          const boughtIndex = openOrders.findIndex(o => o.symbol === symbol);
          if (boughtIndex === -1) {
            const candles = await fetchCandle(ultimateExchange, symbol, timeFrame);
            const ticker = await exchange.fetchTicker(symbol);

            console.log(loggingMessage(`Scanning: ${symbol}`));

            resolve({
              pair: symbol, ...candles, ...ticker,
            });
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      } catch (e) {
        resolve(null);
      }
    }))));

    if (global.shouldStop) {
      throw new Error('Stop the bot');
    }

    const lastScannedIndex = scanMarkets.difference.findIndex(o => o.symbol === lastScannedSymbol);
    const slicedScanDifferentMarkets = lastScannedIndex !== -1 ? scanMarkets.difference.slice(lastScannedIndex) : scanMarkets.difference;
    const slicedScanDifferentMarketsLength = slicedScanDifferentMarkets.length;

    const candleDifferentMarkets = await Promise.all(slicedScanDifferentMarkets.map(({ symbol }, index) => limiter.schedule(() => new Promise(async (resolve) => {
      try {
        // We got banned, skip all remain pairs
        if (!shouldSkipAllSymbols) {
          // If we reach to the end of array then reset lastScannedSymbol

          if ((index + 1) === slicedScanDifferentMarketsLength) {
            lastScannedSymbol = null;
          }

          const boughtIndex = openOrders.findIndex(o => o.symbol === symbol);
          if (boughtIndex === -1) {
            const candles = await fetchCandle(exchange, symbol, timeFrame);
            const ticker = await exchange.fetchTicker(symbol);

            console.log(loggingMessage(`Scanning: ${symbol}`));
            lastScannedSymbol = symbol;

            if ((index + 1) === slicedScanDifferentMarketsLength) {
              lastScannedSymbol = null;
            }

            resolve({
              pair: symbol, ...candles, ...ticker,
            });
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      } catch (e) {
        if (e.message.includes('429') || e.message.toLowerCase().includes('ddos')) {
          lastScannedSymbol = symbol;
          shouldSkipAllSymbols = true;
          shouldEnableCounterDDOS = true;
          if (shouldSkipAllSymbols) {
            limiter.updateSettings({
              maxConcurrent: 1,
              minTime: 0,
            });
          }
          resolve(null);
        } else {
          resolve(null);
        }
      }
    }))));

    if (global.shouldStop) {
      throw new Error('Stop the bot');
    }

    const compactCandleMarkets = [..._.compact(candleCommonMarkets), ..._.compact(candleDifferentMarkets)];

    const listShouldBuy = await Promise.all(compactCandleMarkets.map(({
      pair, opens, highs, lows, closes, vols, last, bid, quoteVolume, percentage,
    }) => limiter.schedule(() => new Promise(async (resolve) => {
      try {
        const {
          baseRate, lastClose, lastRSI, lastEMA, lastPSAR, spikyVal, changeBB, orderThickness, closeDiff, lastVolOsc, volDiff,
        } = await commonIndicator(exchange, highs, lows, closes, vols, last, pair);
        const upTrendBuyWeight = upTrend(opens, highs, lows, closes);
        const { shouldBuySmoothedHeikin } = smoothedHeikin(opens, highs, lows, closes, 14);
        const { shouldBuySlowHeikin } = slowHeikin(opens, highs, lows, closes, 6, 0.666, 0.0645);

        const volChecker = volDiff >= 0.75 || lastVolOsc > 0;

        const meanBaseCondition = [
          [+(last >= 0.000001), 6.25],
          [+(last <= lastEMA), 6.25],
          [+(spikyVal <= 3.5), 6.25],
          [+(changeBB >= 1.08), 6.25],
          [+(quoteVolume >= 1), 6.25],
          [+(orderThickness >= 0.95), 6.25],
          [+(volChecker), 6.25],
          [+(closeDiff <= 1.025), 6.25],
        ]; // 50 % weight

        const dipWeight = weightedMean([
          ...meanBaseCondition,
          [+(last <= baseRate), 45],
          [+(lastRSI <= 35), 5],
        ]);

        const smoothedHeikinWeight = weightedMean([
          ...meanBaseCondition,
          [+(shouldBuySmoothedHeikin), 40],
          [+(lastPSAR < lastClose), 10],
        ]);

        const slowHeikinWeight = weightedMean([
          ...meanBaseCondition,
          [+(shouldBuySlowHeikin), 40],
          [+(lastPSAR < lastClose), 10],
        ]);

        const topWeight = weightedMean([
          ...meanBaseCondition,
          ...upTrendBuyWeight,
        ]);

        const strategyResult = loggingMessage(`Calculating Strategy: ${pair} - Result:`);

        if (dipWeight >= weight) {
          console.log(strategyResult, 'SUCCESS');
          resolve({
            pair, percentage, bid, baseRate, method: 'Dip',
          });
        } else if (smoothedHeikinWeight >= weight) {
          console.log(strategyResult, 'SUCCESS');
          resolve({
            pair, percentage, bid, baseRate, method: 'Smoothed Heikin',
          });
        } else if (slowHeikinWeight >= weight) {
          console.log(strategyResult, 'SUCCESS');
          resolve({
            pair, percentage, bid, baseRate, method: 'Slow Heikin',
          });
        } else if (topWeight >= weight) {
          console.log(strategyResult, 'SUCCESS');
          resolve({
            pair, percentage, bid, baseRate, method: 'Top',
          });
        } else {
          console.log(strategyResult, 'FAIL');
          resolve(null);
        }
      } catch (e) {
        resolve(null);
      }
    }))));

    if (global.shouldStop) {
      throw new Error('Stop the bot');
    }

    const compactListShouldBuy = _.compact(listShouldBuy);

    if (compactListShouldBuy.length === 0) {
      ioEmitter(io, 'general', loggingMessage('There is nothing to buy at the moment'));
      if (shouldEnableCounterDDOS) {
        throw new Error('429');
      }
      throw new Error('At check list should buy step');
    }

    if (compactListShouldBuy.length > 0) {
      const currentWeightTime = moment();
      const weightDiffTime = moment.duration(currentWeightTime.diff(initWeightTime)).asDays();
      const diffTimeCheck = weightDiffTime >= 1;
      const {
        pair, bid, baseRate, method,
      } = _.minBy(compactListShouldBuy, 'percentage');
      const historyOrder = await exchange.fetchMyTrades(pair);
      const isLastSell = historyOrder.length === 0 ? true : _.last(historyOrder).side === 'sell';

      if (isLastSell) {
        const { precision: { amount, price } } = _.find(markets, o => o.symbol === pair);
        let rate2Buy;
        rate2Buy = method === 'Dip' ? baseRate * 0.985 : bid * 0.99;
        rate2Buy = diffTimeCheck ? rate2Buy * 1.01 : rate2Buy;
        if (rate2Buy > bid) {
          rate2Buy = bid;
        }

        const targetBalance = checkMarketPlace.test(pair) ? marketPlaceBalance : stableCoinBalance;

        const amount2Buy = (targetBalance / rate2Buy) * 0.9975;
        const buyRef = await exchange.createLimitBuyOrder(pair, amount2Buy.toFixedNumber(amount).noExponents(), rate2Buy.toFixedNumber(price).noExponents());

        await writeDangling(dangling, bought, pair, buyRef.id);
        messageTrade(buyRef, 'Buy', amount2Buy, pair, rate2Buy, telegram, telegramUserId, io, 'trigger:buy');

        const buyFilled = await checkBuy(exchange, timeOrder, buyRef.id, pair, telegram, telegramUserId, io);

        if (buyFilled > 0) {
          weight = 1;
          initWeightTime = moment();
          const amount2Sell = await calculateAmount2Sell(exchange, pair, buyFilled);
          const rate2Sell = rate2Buy * takeProfit;
          const checkAmount = isAmountOk(pair, amount2Sell, rate2Sell, telegram, telegramUserId, io);

          if (checkAmount) {
            const sellRef = await exchange.createLimitSellOrder(pair, amount2Sell.toFixedNumber(amount).noExponents(), rate2Sell.toFixedNumber(price).noExponents());
            messageTrade(sellRef, 'Sell', amount2Sell, pair, rate2Sell, telegram, telegramUserId, io, 'trigger:sell');
            await writeBought(dangling, bought, pair, buyRef.id, sellRef.id);
          }
        } else {
          throw new Error('At check bought or not');
        }
      } else {
        throw new Error('At check double buy');
      }
    }
    throw new Error('Everything is fine');
  } catch (e) {
    try {
      const {
        telegramUserId, io, exchange, takeProfit, stopLoss,
      } = data;
      shouldSkipAllSymbols = false;
      shouldEnableCounterDDOS = false;
      if (!global.shouldStop) {
        const { dangling, bought } = await fs.readJSON('./trade.json');
        if (bought.length > 0) {
          const markets = await exchange.fetchMarkets();
          const waitSell = [];
          const boughtAsync = new AsyncArray(bought);
          const shouldStopLoss = await boughtAsync.filterAsync(({ id, pair }) => limiter.schedule(() => new Promise(async (resolve) => {
            try {
              const { last } = await exchange.fetchTicker(pair);
              const {
                price, datetime, status, filled, amount,
              } = await exchange.fetchOrder(id, pair);

              const currentTime = moment();
              const targetTime = moment(datetime);
              const diffTime = moment.duration(currentTime.diff(targetTime)).asHours();
              const boughtRate = price / takeProfit;
              const stopLossPrice = boughtRate * stopLoss;

              if (status === 'closed') {
                const mess = loggingMessage(`Sold ${filled} ${pair} at rate = ${price}`);
                ioEmitter(io, 'trigger:sell', mess);
                telegram.sendMessage(telegramUserId, mess);
                resolve(false);
              } else if ((diffTime >= 24 && status === 'open') || (last <= stopLossPrice && diffTime >= 3 && status === 'open')) {
                const cancel = await exchange.cancelOrder(id, pair);
                console.log('Cancel the selling order');
                console.log(cancel);
                resolve(true);
              } else if (status === 'canceled' && amount > 0) {
                const re = /^\w+/;
                const [coin] = pair.match(re);
                const accountBalance = await exchange.fetchBalance();
                const coinBalance = !_.isUndefined(accountBalance.free[coin]) ? accountBalance.free[coin] : 0;

                if (coinBalance >= amount) {
                  console.log('The order is canceled but it wasn\'t sold. Reset the stop loss operation');
                  resolve(true);
                } else {
                  resolve(false);
                }
              } else {
                waitSell.push({ id, pair });
                resolve(false);
              }
            } catch (error) {
              waitSell.push({ id, pair });
              resolve(false);
              console.log(error.message);
            }
          })));

          const tempBought = shouldStopLoss.length > 0 ? await Promise.all(shouldStopLoss.map(({ id, pair }) => limiter.schedule(() => new Promise(async (resolve) => {
            try {
              const { precision } = _.find(markets, o => o.symbol === pair);
              const { amount, filled } = await exchange.fetchOrder(id, pair);
              const { bid } = await exchange.fetchTicker(pair);
              const rate2StopLoss = bid * 0.99;
              const remain = await calculateAmount2Sell(exchange, pair, amount - filled);
              const checkAmount = isAmountOk(pair, remain, rate2StopLoss, telegram, telegramUserId, io);

              if (checkAmount) {
                const stopLossRef = await exchange.createLimitSellOrder(pair, remain.toFixedNumber(precision.amount).noExponents(), rate2StopLoss.toFixedNumber(precision.price).noExponents());

                messageTrade(stopLossRef, 'Stop Loss', remain, pair, rate2StopLoss, telegram, telegramUserId, io, 'trigger:stopLoss');
                resolve({ id: stopLossRef.id, pair });
              } else {
                resolve(null);
              }
            } catch (error) {
              waitSell.push({ id, pair });
              resolve(null);
            }
          })))) : null;

          const newBought = [...waitSell, ..._.compact(tempBought)];
          await fs.writeJSON('./trade.json', { dangling, bought: newBought });
        }

        if (!e.message.includes('429') && !e.message.toLowerCase().includes('ddos')) {
          await autoUpdater('https://codeload.github.com/dotai2012/ultimate-bot/zip/master');
          restart(start, e, data);
        } else {
          if (delay < 1000) {
            delay += baseDelay;
            limiter.updateSettings({
              maxConcurrent: 1,
              minTime: delay,
            });
          }
          restart(start, e, data);
        }
      } else {
        global.shouldStop = false;
        global.isRunning = false;
        io.emit('isRunning', global.isRunning);
        ioEmitter(io, 'stopBot', loggingMessage('Fully stopped the bot'));
      }
    } catch (error) {
      restart(start, error, data);
    }
  }
}

function startStrategy(data) {
  const {
    telegramUserId, takeProfitPct, stopLossPct, marketPlace, stableMarket,
  } = data;
  const enhancedMarketPlace = marketPlace.toUpperCase();
  const enhancedStableMarket = stableMarket.toUpperCase();

  const takeProfit = (100 + takeProfitPct) / 100;
  const stopLoss = (100 - stopLossPct) / 100;

  messenger(telegram, telegramUserId);
  start({
    ...data, takeProfit, stopLoss, enhancedMarketPlace, enhancedStableMarket,
  });
}

function stopStrategy(io) {
  global.shouldStop = true;
  ioEmitter(io, 'general', loggingMessage('Stopping the bot, please wait'));
}

function setTelegram(token) {
  telegram = new TelegramBot(token);
}

module.exports = {
  startStrategy, stopStrategy, setTelegram,
};
