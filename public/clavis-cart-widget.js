(function () {
  function initCartWidget() {
    var cfg = window.ClavisConfig || {};
    var FULL_DAY_DISCOUNT_EUR = cfg.fullDayDiscount || 100;
    var API_BASE = cfg.apiBase || 'https://clavis-readymag-stripe.vercel.app';

    // если Store уже живёт — просто принудительно перерисуем в ВИДИМЫЙ DOM
    if (window.CartStore && window.__ClavisCartRebind) {
      window.__ClavisCartRebind();
      return;
    }
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

    // CLEANUP after ?paid=1
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('paid') === '1' && window.CartStore) {
        window.CartStore.clear();
        params.delete('paid');
        var rest = params.toString();
        var newUrl = window.location.pathname + (rest ? '?' + rest : '');
        window.history.replaceState({}, '', newUrl);
      }
    } catch (e) {}

    // ---------------------------
    // Helpers: pick visible DOM node among duplicates (because RM responsive duplicates)
    // ---------------------------
    function isVisibleEl(el) {
      if (!el) return false;
      // hidden by display:none or not in layout
      var rects = el.getClientRects();
      if (!rects || !rects.length) return false;

      var cs = window.getComputedStyle(el);
      if (
        !cs ||
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        cs.opacity === '0'
      )
        return false;

      // if inside hidden parent, rects can still be 0; above already checked
      return true;
    }

    function pickVisibleById(id) {
      var nodes = document.querySelectorAll('#' + CSS.escape(id));
      if (!nodes || !nodes.length) return null;
      for (var i = 0; i < nodes.length; i++) {
        if (isVisibleEl(nodes[i])) return nodes[i];
      }
      // fallback: first
      return nodes[0];
    }

    // if you have multiple blocks, IDs repeat — we always resolve on-demand
    function resolveDom() {
      return {
        drawer: pickVisibleById('cartDrawer'),
        cartList: pickVisibleById('cartList'),
        totalEUR: pickVisibleById('totalEUR'),
        parentEmail: pickVisibleById('parentEmail'),
        payBtn: pickVisibleById('payBtn'),
        cartCountEl: pickVisibleById('cartCount'),
        fab: pickVisibleById('cartFab'),
        closeBtn: pickVisibleById('closeDrawer'),
      };
    }

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

    // ---------------------------
    // Render (always into visible elements)
    // ---------------------------
    var lastBound = null;

    function render(state) {
      var dom = resolveDom();
      if (!dom.drawer || !dom.cartList || !dom.totalEUR || !dom.cartCountEl)
        return;

      dom.cartCountEl.textContent = String(state.items.length);

      if (!state.items.length) {
        dom.cartList.innerHTML =
          '<div class="rm-hint">Der Warenkorb ist leer</div>';
        dom.totalEUR.textContent = '€0.00';
        return;
      }

      // group by child
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
        byChild
          .get(key)
          .items.push({ slot: String(it.slot || '').toLowerCase(), idx: idx });
      });

      var childKeys = Array.from(byChild.keys());
      var siblingKeys = new Set(childKeys.slice(1)); // all except first child
      var totalChildren = byChild.size;

      // full day: map idx -> discount cents
      var fullDayDiscountPerIndex = new Map();

      if (totalChildren === 1) {
        var dayMap = new Map(); // periodLabel -> { morningIdx, afternoonIdx }

        state.items.forEach(function (it, idx) {
          var slot = String(it.slot || '').toLowerCase();
          if (slot !== 'morning' && slot !== 'afternoon') return;

          var periodLabel = getPeriodLabel(it).toLowerCase();
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

      dom.cartList.innerHTML = state.items
        .map(function (it, i) {
          var childKey = norm(it.childFirst) + '|' + norm(it.childLast);
          var isSibling = siblingKeys.has(childKey);
          var hasSiblingInCart = totalChildren >= 2;
          var applySiblingDiscount = hasSiblingInCart && isSibling;

          // base (full) amount in cents
          var amount = Number(it.amount || 0);

          // 1) sibling -10%
          var hasSiblingDiscount = false;
          if (applySiblingDiscount) {
            amount = Math.round(amount * 0.9);
            hasSiblingDiscount = true;
          }

          // 2) full-day -100€ for afternoon item
          var hasFullDayDiscount = false;
          if (totalChildren === 1 && fullDayDiscountPerIndex.has(i)) {
            var discountCents = fullDayDiscountPerIndex.get(i) || 0;
            amount = Math.max(0, amount - discountCents);
            hasFullDayDiscount = discountCents > 0;
          }

          sum += amount;

          var labels = [];
          if (hasSiblingDiscount) labels.push('−10% Geschwisterrabatt');
          if (hasFullDayDiscount)
            labels.push('−' + FULL_DAY_DISCOUNT_EUR + ' € Ganztagsrabatt');

          var baseLabel = it.label || it.title || 'Camp';
          var labelHtml = escapeHtml(baseLabel);

          if (labels.length) {
            labelHtml +=
              ' <span class="rm-discount-label">' +
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

      dom.totalEUR.textContent = formatEUR(sum);

      // remove handlers (bind to current visible list)
      dom.cartList.querySelectorAll('[data-remove]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = +btn.getAttribute('data-remove');
          window.CartStore.remove(idx);
        });
      });
    }

    // ---------------------------
    // Bind events to visible DOM (and rebind on resize/orientation)
    // ---------------------------
    function bind() {
      var dom = resolveDom();
      if (
        !dom.drawer ||
        !dom.fab ||
        !dom.closeBtn ||
        !dom.payBtn ||
        !dom.parentEmail
      ) {
        return;
      }

      // avoid double-binding to same visible nodes
      if (
        lastBound &&
        lastBound.drawer === dom.drawer &&
        lastBound.fab === dom.fab &&
        lastBound.closeBtn === dom.closeBtn &&
        lastBound.payBtn === dom.payBtn
      ) {
        // still ensure visible drawer has correct state
        render(window.CartStore);
        return;
      }
      lastBound = dom;

      // FAB open
      dom.fab.addEventListener('click', function () {
        dom.drawer.classList.add('open');
      });

      // close btn
      dom.closeBtn.addEventListener('click', function () {
        dom.drawer.classList.remove('open');
      });

      // open from camps
      window.CartBus.addEventListener('cart:open', function () {
        var d = resolveDom();
        if (d.drawer) d.drawer.classList.add('open');
      });

      // click outside to close (use capture + resolve current)
      document.addEventListener(
        'click',
        function (e) {
          var d = resolveDom();
          if (!d.drawer || !d.drawer.classList.contains('open')) return;
          if (d.drawer.contains(e.target)) return;
          if (e.target.closest && e.target.closest('#cartFab')) return;
          if (e.target.closest && e.target.closest('[data-remove]')) return;
          d.drawer.classList.remove('open');
        },
        true
      );

      // pay
      dom.payBtn.addEventListener('click', function () {
        var d = resolveDom();
        var state = window.CartStore;
        if (!state.items.length) {
          alert('Der Einkaufswagen ist leer');
          return;
        }

        var email = (
          d.parentEmail && d.parentEmail.value ? d.parentEmail.value : ''
        ).trim();
        if (!email) {
          alert('Geben Sie Ihre E-Mail-Adresse');
          return;
        }

        // IMPORTANT: these checkboxes also duplicated -> pick visible by id
        var agb = pickVisibleById('legalAgb');
        var wid = pickVisibleById('legalWiderruf');
        var dsg = pickVisibleById('legalDsgvo');

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

        d.payBtn.disabled = true;
        d.payBtn.textContent = 'Checkout wird erstellt…';

        fetch(API_BASE + '/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, items: state.items }),
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
            d.payBtn.disabled = false;
            d.payBtn.textContent = 'Zur Zahlung fortfahren';
          });
      });

      // make sure it's visible (if you use hidden class)
      dom.drawer.classList.remove('rm-drawer--hidden');

      // initial render into the now-correct DOM
      render(window.CartStore);
    }

    // expose rebind (so if you call init again, it rebinds instead of exiting)
    window.__ClavisCartRebind = function () {
      bind();
    };

    // subscribe render
    window.CartStore.subscribe(function (state) {
      render(state);
    });

    // initial bind after layout settles
    setTimeout(bind, 0);

    // rebind on resize/orientation (Readymag switches layouts)
    var t = null;
    function scheduleRebind() {
      clearTimeout(t);
      t = setTimeout(function () {
        bind();
      }, 120);
    }
    window.addEventListener('resize', scheduleRebind);
    window.addEventListener('orientationchange', scheduleRebind);
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
