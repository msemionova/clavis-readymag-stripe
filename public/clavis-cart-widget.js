(function () {
  function initCartWidget() {
    var cfg = window.ClavisConfig || {};
    var FULL_DAY_DISCOUNT_EUR = cfg.fullDayDiscount || 100;
    var API_BASE = cfg.apiBase || 'https://clavis-readymag-stripe.vercel.app';

    function waitForElements() {
      var drawer = document.getElementById('cartDrawer');
      var fab = document.getElementById('cartFab');
      var closeBtn = document.getElementById('closeDrawer');
      var cartList = document.getElementById('cartList');
      var totalEUR = document.getElementById('totalEUR');
      var parentEmail = document.getElementById('parentEmail');
      var payBtn = document.getElementById('payBtn');
      var cartCountEl = document.getElementById('cartCount');

      if (
        !drawer ||
        !fab ||
        !closeBtn ||
        !cartList ||
        !totalEUR ||
        !parentEmail ||
        !payBtn ||
        !cartCountEl
      ) {
        setTimeout(waitForElements, 80);
        return;
      }

      try {
        if (drawer.parentElement !== document.body)
          document.body.appendChild(drawer);
        if (fab.parentElement !== document.body) document.body.appendChild(fab);
      } catch (e) {}

      if (window.CartStore) return;

      setup(
        drawer,
        fab,
        closeBtn,
        cartList,
        totalEUR,
        parentEmail,
        payBtn,
        cartCountEl
      );
    }

    function setup(
      drawer,
      fab,
      closeBtn,
      cartList,
      totalEUR,
      parentEmail,
      payBtn,
      cartCountEl
    ) {
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
        persist: function () {
          try {
            localStorage.setItem(
              'camp_cart_v1',
              JSON.stringify({ items: this.items, email: this.email })
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

      try {
        var params = new URLSearchParams(window.location.search);
        if (params.get('paid') === '1') {
          window.CartStore.clear();

          // убираем paid=1 из URL, чтобы при обновлении не чистить снова
          params.delete('paid');
          var rest = params.toString();
          var newUrl = window.location.pathname + (rest ? '?' + rest : '');
          window.history.replaceState({}, '', newUrl);
        }
      } catch (e) {}

      function formatEUR(cents) {
        return '€' + (cents / 100).toFixed(2);
      }
      function norm(s) {
        return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
      }
      function getPeriodLabel(it) {
        return String(it.periodLabel || it.period_label || '').trim();
      }
      function escapeHtml(str) {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function openDrawer() {
        // на всякий случай повторно переносим в body при открытии
        try {
          if (drawer.parentElement !== document.body)
            document.body.appendChild(drawer);
          if (fab.parentElement !== document.body)
            document.body.appendChild(fab);
        } catch (e) {}

        drawer.classList.add('open');
        drawer.classList.remove('rm-drawer--hidden');
      }
      function closeDrawer() {
        drawer.classList.remove('open');
      }

      fab.addEventListener('click', function (e) {
        e.preventDefault();
        openDrawer();
      });
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        closeDrawer();
      });
      window.CartBus.addEventListener('cart:open', openDrawer);

      document.addEventListener('click', function (e) {
        if (!drawer.classList.contains('open')) return;
        if (drawer.contains(e.target)) return;
        if (e.target.closest('#cartFab')) return;
        closeDrawer();
      });

      window.CartStore.subscribe(function (state) {
        cartCountEl.textContent = String(state.items.length);

        if (!state.items.length) {
          cartList.innerHTML =
            '<div class="rm-hint">Der Warenkorb ist leer</div>';
          totalEUR.textContent = '€0.00';
          return;
        }

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
            slot: String(it.slot || '').toLowerCase(),
            idx: idx,
          });
        });

        var childKeys = Array.from(byChild.keys());
        var siblingKeys = new Set(childKeys.slice(1));
        var totalChildren = byChild.size;

        var fullDayDiscountPerIndex = new Map();

        if (totalChildren === 1) {
          var dayMap = new Map(); // key -> { morningIdx, afternoonIdx }

          state.items.forEach(function (it, idx) {
            var slot = String(it.slot || '').toLowerCase();
            if (slot !== 'morning' && slot !== 'afternoon') return;

            var periodLabel = getPeriodLabel(it).toLowerCase();

            // fallback: если periodLabel пустой, пытаемся группировать по productId (лучше чем ничего)
            if (!periodLabel) {
              var pid = String(it.productId || it.product_id || '').trim();
              if (pid) periodLabel = ('pid:' + pid).toLowerCase();
            }

            if (!periodLabel) return;

            var info = dayMap.get(periodLabel) || {};
            if (slot === 'morning' && info.morningIdx == null)
              info.morningIdx = idx;
            if (slot === 'afternoon' && info.afternoonIdx == null)
              info.afternoonIdx = idx;
            dayMap.set(periodLabel, info);
          });

          dayMap.forEach(function (info) {
            if (info.morningIdx != null && info.afternoonIdx != null) {
              fullDayDiscountPerIndex.set(
                info.afternoonIdx,
                Math.round(FULL_DAY_DISCOUNT_EUR * 100)
              );
            }
          });
        }

        var sum = 0;

        cartList.innerHTML = state.items
          .map(function (it, i) {
            var childKey = norm(it.childFirst) + '|' + norm(it.childLast);
            var isSibling = siblingKeys.has(childKey);
            var applySiblingDiscount = totalChildren >= 2 && isSibling;

            var amount = Number(it.amount || 0);
            var labels = [];

            // sibling −10%
            if (applySiblingDiscount) {
              amount = Math.round(amount * 0.9);
              labels.push('−10% Geschwisterrabatt');
            }

            // full-day −100€
            if (totalChildren === 1 && fullDayDiscountPerIndex.has(i)) {
              var discountCents = fullDayDiscountPerIndex.get(i) || 0;
              if (discountCents > 0) {
                amount = Math.max(0, amount - discountCents);
                labels.push('−' + FULL_DAY_DISCOUNT_EUR + ' € Ganztagsrabatt');
              }
            }

            sum += amount;

            var baseLabel = it.label || it.title || 'Camp';
            var labelHtml = escapeHtml(baseLabel);

            if (labels.length) {
              labelHtml +=
                ' <span class="rm-discount-label" style="display:inline; font-weight:500;">' +
                escapeHtml(labels.join(', ')) +
                '</span>';
            }

            return (
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

      // checkout
      payBtn.addEventListener('click', function () {
        var state = window.CartStore;
        if (!state.items.length) return alert('Der Einkaufswagen ist leer');

        var email = (parentEmail.value || '').trim();
        if (!email) return alert('Geben Sie Ihre E-Mail-Adresse');

        var agb = document.getElementById('legalAgb');
        var wid = document.getElementById('legalWiderruf');
        var dsg = document.getElementById('legalDsgvo');
        if (!agb || !wid || !dsg)
          return alert('Bitte bestätigen Sie AGB/Widerruf/Datenschutz.');
        if (!agb.checked || !wid.checked || !dsg.checked) {
          return alert(
            'Bitte bestätigen Sie AGB, Widerrufsbelehrung und Datenschutzerklärung.'
          );
        }

        state.setEmail(email);

        payBtn.disabled = true;
        payBtn.textContent = 'Checkout wird erstellt…';

        fetch(API_BASE + '/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, items: state.items }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            if (!data.url) throw new Error('No checkout url');
            window.location.href = data.url;
          })
          .catch(function () {
            alert('Die Zahlung konnte nicht erstellt werden.');
            payBtn.disabled = false;
            payBtn.textContent = 'Zur Zahlung fortfahren';
          });
      });

      drawer.classList.remove('rm-drawer--hidden');
    }

    waitForElements();
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
