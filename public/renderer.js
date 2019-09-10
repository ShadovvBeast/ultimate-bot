const socket = io();

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

let selectedCoin = 'ETH/BTC'; // TODO: Init pair
// let selectedCoinMAIN = 'ETH/BTC';
let toggleClickIndex = 0;

$.fn.toggleClick = function () {
  const methods = arguments; // Store the passed arguments for future reference
  const count = methods.length; // Cache the number of methods

  // Use return this to maintain jQuery chainability
  // For each element you bind to
  return this.each((i, item) => {
    // Bind a click handler to that element
    $(item).on('click', function () {
      // That when called will apply the 'index'th method to that element
      // the index % count means that we constrain our iterator between 0
      // and (count-1)
      return methods[toggleClickIndex++ % count].apply(this, arguments);
    });
  });
};

$(document).ready(() => {
  // Home page
  // Init

  socket.emit('author', $('#fiverr').attr('href'));
  socket.once('version', (version) => { document.title = `${document.title} v${version}`; });

  // Reload previous states
  const marketPlaceRef = $('#main-market-place');
  const useFundPercentageRef = $('#main-amount-percentage');
  const takeProfitPctRef = $('#main-take-profit');
  const stopLossPctRef = $('#main-stop-loss');
  const useStableMarketRef = $('#main-use-stable-market');
  const stableMarketRef = $('#main-stable-market');
  const timeOrderRef = $('#main-time-order');
  const timeFrameRef = $('#main-time-frame');
  const timeFrameStableMarketRef = $('#main-time-frame-stable-market');
  const mainListRef = [marketPlaceRef, useFundPercentageRef, takeProfitPctRef, stopLossPctRef, useStableMarketRef, stableMarketRef, timeOrderRef, timeFrameRef, timeFrameStableMarketRef];

  socket.on('isRunning', (isRunning) => {
    if (isRunning) {
      toggleClickIndex = 1;
      $('#main-start').html('<i class="tim-icons icon-button-pause"></i>Stop');
    } else {
      toggleClickIndex = 0;
      $('#main-start').html('<i class="tim-icons icon-triangle-right-17"></i>Start');
    }
  });
  socket.on('lastStates', (lastStates) => {
    Object.keys(lastStates).map((key, index) => {
      if (typeof lastStates[key] !== 'object') {
        mainListRef[index].val(lastStates[key].toString());
      }
    });
  });
  // Reload previous states

  // Fetch Market
  // let intervalMAIN;
  socket.emit('fetch:market');
  socket.on('fetch:market:return', (pair) => {
    $('#pair').html(pair);
    // $('#main-pair').html(pair);
    selectedCoin = $('#pair').val();
    // selectedCoinMAIN = $('#main-pair').val();
    // socket.emit('fetch:infoMAIN', selectedCoinMAIN);
    socket.emit('fetch:infoPair', selectedCoin);
    // intervalMAIN = setInterval(() => {
    //   socket.emit('fetch:infoMAIN', selectedCoinMAIN);
    // }, 5000);
  });

  // Fetch main coin
  // let parse2InputOnce = true;
  // socket.on('fetch:infoMAIN:return', ({ bid, ask, percentage }) => {
  //   $('#main-signal-bid').text(bid);
  //   $('#main-signal-ask').text(ask);
  //   $('#main-signal-change').text(percentage);

  //   if (parse2InputOnce) {
  //     parse2InputOnce = false;
  //     // Change default useFundPercentage and dispatch an event
  //     $('#main-amount-percentage').val(15);
  //     $('#main-amount-percentage').trigger('change');
  //   }
  // });

  let focusMain = true;

  // End Init

  // MAIN Page
  // Calc amount to buy

  // $('#main').click(() => {
  //   setTimeout(() => {
  //     $('#main-pair').select2();
  //   }, 500);
  // });

  // $('#main-pair').on('change', function () {
  //   selectedCoinMAIN = $(this).val();
  //   $('#main-amount').val('');
  //   socket.emit('fetch:infoMAIN', selectedCoinMAIN);
  //   clearInterval(intervalMAIN);
  //   intervalMAIN = setInterval(() => {
  //     socket.emit('fetch:infoMAIN', selectedCoinMAIN);
  //   }, 5000);
  // });

  // $('#main-amount-percentage').on('change', function () {
  //   const percentage = $(this).val() / 100;
  //   const re = /\w+$/;
  //   const [market] = selectedCoinMAIN.match(re);
  //   const pair = selectedCoinMAIN;
  //   socket.emit('amount', { market, pair, percentage });
  //   socket.on('amount:return', (data) => {
  //     $('#main-amount').val(data);
  //     socket.removeAllListeners('amount:return');
  //   });
  // });

  // Main start
  $('#main-start').toggleClick(() => {
    // TODO: config this every time
    // const pair = selectedCoinMAIN;
    const marketPlace = $('#main-market-place').val();
    const useFundPercentage = $('#main-amount-percentage').val() !== '' ? parseFloat($('#main-amount-percentage').val()) : 15;
    const takeProfitPct = $('#main-take-profit').val() !== '' ? parseFloat($('#main-take-profit').val()) : 1.5;
    const stopLossPct = $('#main-stop-loss').val() !== '' ? parseFloat($('#main-stop-loss').val()) : 1.5;
    const useStableMarket = $('#main-use-stable-market').val() === 'true';
    const stableMarket = $('#main-stable-market').val();
    const timeOrder = $('#main-time-order').val() !== '' ? parseFloat($('#main-time-order').val()) : 45;
    const timeFrame = $('#main-time-frame').val();
    const timeFrameStableMarket = $('#main-time-frame-stable-market').val();

    socket.emit('main-start', {
      marketPlace, useFundPercentage, takeProfitPct, stopLossPct, useStableMarket, stableMarket, timeOrder, timeFrame, timeFrameStableMarket,
    });

    $('#main-start').html('<i class="tim-icons icon-button-pause"></i>Stop');
  }, () => {
    socket.emit('main-stop');
    $('#main-start').html('<i class="tim-icons icon-triangle-right-17"></i>Start').attr('disabled', true);
  });

  // Live trigger info

  function removeTriggerListOverLoad() {
    let alertLength = $('.alert').length;

    if (alertLength > 50) {
      while (alertLength > 50) {
        $('.alert').last().remove();
        alertLength = $('.alert').length;
      }
    }
  }

  // Buy
  socket.on('trigger:buy', (msg) => {
    $('#trigger')
      .prepend(`<div class="alert alert-info">
        <span>${msg}</span>
      </div>`);
    removeTriggerListOverLoad();
  });

  // Sell
  socket.on('trigger:sell', (msg) => {
    $('#trigger')
      .prepend(`<div class="alert alert-success">
        <span>${msg}</span>
    </div>`);
    removeTriggerListOverLoad();
  });

  // Stoploss
  socket.on('trigger:stopLoss', (msg) => {
    $('#trigger')
      .prepend(`<div class="alert alert-danger">
        <span>${msg}</span>
    </div>`);
    removeTriggerListOverLoad();
  });

  // General
  socket.on('general', (msg) => {
    $('#trigger')
      .prepend(`<div class="alert alert-primary">
        <span>${msg}</span>
    </div>`);
    removeTriggerListOverLoad();
  });

  // Error
  socket.on('error', (msg) => {
    $('#trigger')
      .prepend(`<div class="alert alert-danger">
          <span>${msg}</span>
      </div>`);
    removeTriggerListOverLoad();
  });

  // Enable the button when it fully stopped
  socket.on('stopBot', (msg) => {
    $('#trigger')
      .prepend(`<div class="alert alert-danger">
          <span>${msg}</span>
        </div>`);
    $('#main-start').attr('disabled', false);
  });

  // Order page
  // Loading active and history orders
  $('#orders').click(() => {
    socket.emit('fetch:order');
  });

  let orderTable = '';

  socket.on('listOrder', (data) => {
    $('#list-orders').html('');
    orderTable = '';
    data.map(({
      id, symbol, amount, price, side, remaining,
    }) => {
      const buyBtn = `<button type="button" rel="Market Buy" class="btn btn-danger btn-link btn-sm market-action" data-id="${id}" data-symbol="${symbol}" data-action="market-buy" data-remaining="${remaining}">
      Market Buy
    </button>`;
      const sellBtn = `<button type="button" rel="Market Sell" class="btn btn-danger btn-link btn-sm market-action" data-id="${id}" data-symbol="${symbol}" data-action="market-sell" data-remaining="${remaining}">
      Market Sell
    </button>`;
      orderTable += `<tr>
      <td class="text-center">
        ${symbol}
      </td>
      <td class="text-center">
        ${amount}
      </td>
      <td class="text-center">
        ${price}
      </td>
      <td class="text-center">
      ${side.toUpperCase()}
      </td>
      <td class="text-center">
        ${side === 'buy' ? buyBtn : sellBtn}
        <button type="button" rel="Cancel" class="btn btn-danger btn-link btn-sm market-action" data-id="${id}" data-symbol="${symbol}" data-action="cancel" data-remaining="0">
          Cancel
        </button>
      </td>
    </tr>`;
    });
    $('#list-orders').html(orderTable);
    $('.market-action').click(function () {
      const symbol = $(this).data('symbol');
      const orderId = $(this).data('id');
      const action = $(this).data('action');
      const remaining = $(this).data('remaining');
      socket.emit('marketAction', {
        symbol, orderId, action, remaining,
      });
    });
  });

  // Manual page
  $('#manual').click(() => {
    setTimeout(() => {
      $('#pair').select2();
    }, 500);
  });

  $('#pair').on('change', function () {
    selectedCoin = $(this).val();
    // eslint-disable-next-line no-new
    new TradingView.widget(
      {
        width: 980,
        height: 610,
        symbol: `${$('#exchangeID').val().toUpperCase()}:${selectedCoin.replace('/', '')}`,
        interval: '30',
        timezone: 'Etc/UTC',
        theme: 'Dark',
        style: '1',
        locale: 'en',
        toolbar_bg: '#f1f3f6',
        enable_publishing: false,
        hide_legend: true,
        allow_symbol_change: true,
        container_id: 'trading-view-chart',
      },
    );
    $('#rate-buy').val('');
    $('#rate-sell').val('');
    $('#amount-buy').val('');
    $('#amount-sell').val('');
  });

  // Get rate
  socket.on('fetch:infoPair:return', ({ bid, ask, last }) => {
    const rateBuyType = $('#rate-buy-type').val();
    const rateSellType = $('#rate-sell-type').val();
    $('#rate-buy').val(eval(rateBuyType));
    $('#rate-sell').val(eval(rateSellType));
  });

  $('.rate-type').on('change', () => socket.emit('fetch:infoPair', selectedCoin));
  // Get rate

  $('#amount-buy-percentage').on('change', () => {
    const re = /\w+$/;
    const [market] = selectedCoin.match(re);
    socket.emit('balance', market);
    socket.on('balance:return', (balance) => {
      const percentage = $('#amount-buy-percentage').val() / 100;
      const rateBuy = $('#rate-buy').val();
      const amount = (balance / rateBuy) * percentage;
      $('#amount-buy').val(amount);
      socket.removeAllListeners('balance:return');
    });
  });

  $('#amount-sell-percentage').on('change', () => {
    const re = /^\w+/;
    const [market] = selectedCoin.match(re);
    socket.emit('balance', market);
    socket.on('balance:return', (balance) => {
      const percentage = $('#amount-sell-percentage').val() / 100;
      const amount = balance * percentage;
      $('#amount-sell').val(amount);
      socket.removeAllListeners('balance:return');
    });
  });

  $('#buy-form').on('submit', function (event) {
    event.preventDefault();
    if ($('#rate-buy').val() !== '') {
      socket.emit('minAmount', [selectedCoin, ...$(this).serializeArray()]);
      socket.once('minAmount:return', (minAmount) => {
        const currentAmount = parseFloat($('#amount-buy').val() === '' ? 0 : $('#amount-buy').val());
        if (currentAmount <= minAmount) {
          $('#amount-buy').val(minAmount);
        }
        socket.emit('manual:buy', [selectedCoin, ...$(this).serializeArray()]);
        $('#manual-buy-btn').text('Loading...').attr('disabled', 'disabled');
        $('#buy-text').hide();
        socket.once('manual:buy:return', (msg) => {
          $('#manual-buy-btn').text('Buy').attr('disabled', false);

          if (msg === 'successful') {
            $('#buy-text').show().text('Buy order placed!');
          } else {
            $('#buy-text').show().text('Can\'t buy the order');
          }
        });
      });
    }
  });

  $('#sell-form').on('submit', function (event) {
    event.preventDefault();
    if ($('#rate-sell').val() !== '') {
      socket.emit('minAmount', [selectedCoin, ...$(this).serializeArray()]);
      socket.once('minAmount:return', (minAmount) => {
        const currentAmount = parseFloat($('#amount-sell').val() === '' ? 0 : $('#amount-sell').val());
        if (currentAmount <= minAmount) {
          $('#amount-sell').val(minAmount);
        }
        socket.emit('manual:sell', [selectedCoin, ...$(this).serializeArray()]);
        $('#manual-sell-btn').text('Loading...').attr('disabled', 'disabled');
        $('#sell-text').hide();
        socket.once('manual:sell:return', (msg) => {
          $('#manual-sell-btn').text('Sell').attr('disabled', false);

          if (msg === 'successful') {
            $('#sell-text').show().text('Sell order placed!');
          } else {
            $('#sell-text').show().text('Can\'t sell the order');
          }
        });
      });
    }
  });


  // Setting page

  // Fetch account list

  socket.emit('setting:get');
  socket.on('setting:get:return', ({ general, current, list }) => {
    // Render account list
    let accountList = '';
    list.map((account) => {
      accountList += `<option value="${account.name}">${account.name}</option>`;
    });
    $('#account-list').html(accountList);
    $('#account-list').val(current.name);

    // Filling general form
    Object.keys(general).map((prop) => {
      $(`#${prop}`).val(general[prop]);
    });

    // Filling current account form
    Object.keys(current).map((prop) => {
      $(`#${prop}`).val(current[prop]);
    });

    if (typeof current.apiKey === 'undefined' || current.apiKey === '') {
      $('#setting-link').click();
      $('#main').prop('disabled', true);
      $('#orders').prop('disabled', true);
      $('#manual').prop('disabled', true);
    } else if (focusMain) { // Click main section on first init
      $('#main').click();
      focusMain = false;
    }
  });

  // Save general settings
  $('#general-save').click((e) => {
    e.preventDefault();
    socket.emit('setting:general:save', $('#general-setting').serializeArray());
  });

  // Change current account on selecting
  $('#account-list').on('change', function () {
    const selectedAccount = $(this).val();
    socket.emit('setting:currentAccount', selectedAccount);
  });

  socket.on('setting:currentAccount:return', (current) => {
    Object.keys(current).map((prop) => {
      $(`#${prop}`).val(current[prop]);
    });
  });

  // Save current account setting
  $('#save-account').click((e) => {
    e.preventDefault();
    const oldAccountName = $('#account-list').val();
    socket.emit('setting:save', $('#current-account').serializeArray(), oldAccountName);

    $('#main').prop('disabled', false);
    $('#orders').prop('disabled', false);
    $('#manual').prop('disabled', false);
  });

  // Delete current account
  $('#delete-account').click((e) => {
    e.preventDefault();
    const currentAccount = $('#name').val();
    socket.emit('setting:delete', currentAccount);
  });

  // Add new account
  $('#add-new').click((e) => {
    e.preventDefault();
    socket.emit('setting:post', $('#add-new-form').serializeArray());
  });
});
