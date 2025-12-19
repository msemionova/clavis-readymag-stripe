(function () {
  function initCartWidget() {
    var cfg = window.ClavisConfig || {};
    var FULL_DAY_DISCOUNT_EUR = cfg.fullDayDiscount || 100;
    var API_BASE = cfg.apiBase || 'https://clavis-readymag-stripe.vercel.app';

    var drawer = document.getElementById('cartDrawer');

    if (window.CartStore) return;

    var Bus = new EventTarget();

    var Store = {
      items: [],
      email: '',
      listeners: [],
      subscribe: function (fn) {
        this.listeners.push(fn);
        fn(this);
      },
      notify: function () {
        var self = this;
        this.listeners.forEach(function (fn) {
          fn(self);
        });
      },
      add: function (item) {
        this.items.push(item);
        this.persist();
        this.notify();
      },
      remove: function (index) {
        this.items.splice(index, 1);
        this.persist();
        this.notify();
      },
      clear: function () {
        this.items = [];
        this.persist();
        this.notify();
      },
      setEmail: function (v) {
        this.email = v;
        this.persist();
      },
      totalCents: function () {
        return this.items.reduce(function (sum, it) {
          return sum + (it.amount || 0);
        }, 0);
      },
      persist: function () {
        try {
          localStorage.setItem(
            'camp_cart_v1',
            JSON.stringify({
              items: this.items,
              email: this.email,
            })
          );
        } catch (e) {}
      },
    };

    try {
      var saved = JSON.parse(localStorage.getItem('camp_cart_v1') || 'null');
      if (saved && Array.isArray(saved.items)) {
        Store.items = saved.items;
        Store.email = saved.email || '';
      }
    } catch (e) {}

    window.CartStore = Store;
    window.CartBus = Bus;

    // CLEANUP
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('paid') === '1' && window.CartStore) {
        window.CartStore.clear();

        // убираем ?paid=1 из URL, чтобы при обновлении не чистить снова
        params.delete('paid');
        var rest = params.toString();
        var newUrl = window.location.pathname + (rest ? '?' + rest : '');
        window.history.replaceState({}, '', newUrl);
      }
    } catch (e) {}

    //WARENKORB
    var cartList = document.getElementById('cartList');
    var totalEUR = document.getElementById('totalEUR');
    var parentEmail = document.getElementById('parentEmail');
    var payBtn = document.getElementById('payBtn');
    var cartCountEl = document.getElementById('cartCount');
    var fab = document.getElementById('cartFab');

    if (
      !drawer ||
      !cartList ||
      !totalEUR ||
      !parentEmail ||
      !payBtn ||
      !cartCountEl ||
      !fab
    ) {
      console.warn('Warenkorb-Widget: Einige Elemente fehlen');
      return;
    }

    function formatEUR(cents) {
      return '€' + (cents / 100).toFixed(2);
    }

    function norm(s) {
      return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    fab.addEventListener('click', function () {
      drawer.classList.add('open');
    });
    document
      .getElementById('closeDrawer')
      .addEventListener('click', function () {
        drawer.classList.remove('open');
      });

    window.CartBus.addEventListener('cart:open', function () {
      drawer.classList.add('open');
    });

    window.CartStore.subscribe(function (state) {
      cartCountEl.textContent = String(state.items.length);

      if (!state.items.length) {
        cartList.innerHTML =
          '<div class="rm-hint">Der Warenkorb ist leer</div>';
        totalEUR.textContent = '€0.00';
        return;
      }

      // группируем по детям
      var byChild = new Map();

      state.items.forEach(function (it, idx) {
        var key = norm(it.childFirst) + '|' + norm(it.childLast);
        if (!byChild.has(key)) {
          byChild.set(key, {
            first: it.childFirst,
            last: it.childLast,
            items: [],
          });
        }
        byChild.get(key).items.push({
          week: it.week,
          week_label: it.week_label,
          camp: it.camp_type,
          slot: it.slot,
          idx: idx, // запоминаем индекс в корзине
        });
      });

      var childKeys = Array.from(byChild.keys());
      var siblingKeys = new Set(childKeys.slice(1)); // все, кроме первого ребёнка, считаем сиблингами
      var totalChildren = byChild.size;

      var fullDayDiscountPerIndex = new Map(); // idx -> скидка в центах

      if (totalChildren === 1) {
        var dayMap = new Map(); // dayKey -> { morningIdx, afternoonIdx }

        state.items.forEach(function (it, idx) {
          var slot = it.slot;
          if (slot !== 'morning' && slot !== 'afternoon') return;

          var dayKey = String(it.week);
          var info = dayMap.get(dayKey) || {};
          if (slot === 'morning') {
            if (info.morningIdx == null) info.morningIdx = idx;
          } else if (slot === 'afternoon') {
            if (info.afternoonIdx == null) info.afternoonIdx = idx;
          }
          dayMap.set(dayKey, info);
        });

        dayMap.forEach(function (info) {
          if (info.morningIdx != null && info.afternoonIdx != null) {
            var discountCents = Math.round(FULL_DAY_DISCOUNT_EUR * 100);
            fullDayDiscountPerIndex.set(info.afternoonIdx, discountCents);
          }
        });
      }

      var sum = 0;

      cartList.innerHTML = state.items
        .map(function (it, i) {
          var childKey = norm(it.childFirst) + '|' + norm(it.childLast);
          var isSibling = siblingKeys.has(childKey);
          var hasSiblingInCart = totalChildren >= 2;
          var applySiblingDiscount = hasSiblingInCart && isSibling;

          var amount = it.amount || 0; // base price in cents

          // 1) скидка сиблингу: −10%
          var hasSiblingDiscount = false;
          if (applySiblingDiscount) {
            amount = Math.round(amount * 0.9);
            hasSiblingDiscount = true;
          }

          // 2) скидка за полный день (только один ребёнок)
          var hasFullDayDiscount = false;
          if (totalChildren === 1 && fullDayDiscountPerIndex.has(i)) {
            var discountCents = fullDayDiscountPerIndex.get(i);
            amount = Math.max(0, amount - discountCents);
            hasFullDayDiscount = true;
          }

          sum += amount;

          var labels = [];
          if (hasSiblingDiscount) labels.push('−10% Geschwisterrabatt');
          if (hasFullDayDiscount)
            labels.push(`−${FULL_DAY_DISCOUNT_EUR} € Ganztagsrabatt`);

          var labelHtml = escapeHtml(it.label);
          if (labels.length) {
            labelHtml +=
              ' <span style="color:#16a34a; font-weight:500">' +
              labels.join(', ') +
              '</span>';
          }

          return (
            '' +
            '<div class="rm-d-row">' +
            '<div>' +
            '<div class="rm-d-title">' +
            labelHtml +
            '</div>' +
            '<div class="rm-d-sub">Kind: ' +
            (escapeHtml(it.childFirst) || '') +
            ' ' +
            (escapeHtml(it.childLast) || '') +
            '</div>' +
            '</div>' +
            '<div>' +
            '<div style="text-align:right; font-weight:500">' +
            formatEUR(amount) +
            '</div>' +
            '<div style="text-align:right; margin-top:6px">' +
            '<button class="rm-x" data-remove="' +
            i +
            '">✕</button>' +
            '</div>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');

      totalEUR.textContent = formatEUR(sum);

      cartList.querySelectorAll('[data-remove]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = +btn.getAttribute('data-remove');
          window.CartStore.remove(idx);
        });
      });
    });

    payBtn.addEventListener('click', function () {
      var state = window.CartStore;
      if (!state.items.length) {
        alert('Der Einkaufswagen ist leer');
        return;
      }
      var email = (parentEmail.value || '').trim();
      if (!email) {
        alert('Geben Sie Ihre E-Mail-Adresse');
        return;
      }

      var agb = document.getElementById('legalAgb');
      var wid = document.getElementById('legalWiderruf');
      var dsg = document.getElementById('legalDsgvo');

      if (!agb || !wid || !dsg) {
        alert('Bitte bestätigen Sie AGB/Widerruf/Datenschutz.');
        return;
      }

      if (!agb.checked || !wid.checked || !dsg.checked) {
        alert(
          'Bitte bestätigen Sie AGB, Widerrufsbelehrung und Datenschutzerklärung.'
        );
        return;
      }

      state.setEmail(email);

      payBtn.disabled = true;
      payBtn.textContent = 'Checkout wird erstellt…';

      fetch(API_BASE + '/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          items: state.items,
        }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (!data.url)
            throw new Error('Es wurde keine Checkout-URL zurückgegeben.');
          window.location.href = data.url;
        })
        .catch(function (err) {
          console.error(err);
          alert('Die Zahlung konnte nicht erstellt werden.');
          payBtn.disabled = false;
          payBtn.textContent = 'Zur Zahlung weitergehen';
        });
    });

    // === close drawer when clicking outside ===
    document.addEventListener('click', function (e) {
      // если drawer не открыт — ничего не делаем
      if (!drawer.classList.contains('open')) return;

      // если клик был внутри drawer → игнорируем
      if (drawer.contains(e.target)) return;

      // если клик был по кнопке открытия → игнорируем
      if (e.target.closest('#cartFab')) return;

      if (e.target.closest('[data-remove]')) {
        return;
      }

      // закрываем
      drawer.classList.remove('open');
    });
    drawer.classList.remove('rm-drawer--hidden');
  }

  window.ClavisCartInit = function () {
    setTimeout(initCartWidget, 0);
  };

  if (
    document.readyState === 'interactive' ||
    document.readyState === 'complete'
  ) {
    window.ClavisCartInit();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      window.ClavisCartInit();
    });
  }
})();
