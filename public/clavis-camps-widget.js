(function () {
  function initCampListWidget() {
    var cfg = window.ClavisConfig || {};
    var YEAR = cfg.year || '2026';
    var DEFAULT_SEASON = cfg.defaultSeason || 'winter_' + YEAR;
    var MAX_CAMPS = typeof cfg.maxCamps === 'number' ? cfg.maxCamps : 8;
    var ENABLE_SEASON_TABS = cfg.enableSeasonTabs !== false;
    var SHOW_TITLE = cfg.showTitle !== false;
    var SHOW_BUTTON = cfg.showButton !== false;
    var RM_PAGE_KEY = cfg.rmPageKey || null;
    var API_BASE = cfg.apiBase || 'https://clavis-readymag-stripe.vercel.app';

    var grid = document.getElementById('camps-grid');
    if (!grid) return;

    grid.classList.remove('rm-camps-grid--hidden');
    var seasonTabs = document.getElementById('rmSeasonTabs');

    // все кэмпы с бэка
    var ALL_CATALOG = [];
    var ACTIVE_SEASON = null;

    var SEASONS_CONFIG = [
      {
        key: 'winter_' + YEAR,
        label: 'Winter',
        title: 'Winterferiencamps',
        bg: '#f9c7ff',
        tabHoverBg: '#000000',
        tabHoverText: '#f9c7ff',
        emptyImage:
          'https://i-p.rmcdn.net/691608e5a42add5705475928/5961069/image-5f626f2e-b2d9-41d9-b082-2283cd66f58a.png?e=webp&nll=true&cX=78&cY=3&cW=714&cH=809',
        emptyDates: '02.02 – 06.02',
        emptyText:
          'Unsere Winterferiencamps ' + YEAR + ' sind bald hier buchbar.',
      },
      {
        key: 'spring_' + YEAR,
        label: 'Frühling',
        title: 'Frühlingsferiencamps',
        bg: '#00A554',
        tabHoverBg: '#000000',
        tabHoverText: '#00A554',
        emptyImage:
          'https://i-p.rmcdn.net/691608e5a42add5705475928/5961069/image-0d1c61d7-a39a-48c2-9296-b37391c16673.png?e=webp&nll=true',
        emptyDates: '02.03 – 30.05',
        emptyText:
          'Hier erscheinen bald die Camps für die Frühlingsferien ' +
          YEAR +
          '.',
      },
      {
        key: 'summer_' + YEAR,
        label: 'Sommer',
        title: 'Sommerferiencamps',
        bg: '#FFDB27',
        tabHoverBg: '#000000',
        tabHoverText: '#FFDB27',
        emptyImage:
          'https://i-p.rmcdn.net/691608e5a42add5705475928/5961069/image-7565f00b-9b0d-454f-ad93-90581d0d0521.png?e=webp&nll=true&cX=28.209119496855294&cY=0&cW=761.5817610062894&cH=1217',
        emptyDates: '01.06 – 13.08',
        emptyText:
          'Die Sommerfereincamps verwandeln die Schulferien in einen Raum zum Ausprobieren und Gestalten. Jugendliche arbeiten projektbasiert und mit künstlerischen Praktiken, entdecken sich selbst, knüpfen Verbindungen zur Stadt und entwickeln visuelle Fähigkeiten. So erfahren sie Kunst als Teil des Lebens, der Stadt und des kulturellen Kontexts. ',
      },
      {
        key: 'autumn_' + YEAR,
        label: 'Herbst',
        title: 'Herbstferiencamps',
        bg: '#FF3B00',
        tabHoverBg: '#000000',
        tabHoverText: '#FF3B00',
        emptyImage:
          'https://i-p.rmcdn.net/691608e5a42add5705475928/5961069/image-422ec24e-5319-43fb-952c-8b77bf9a9575.png?e=webp&nll=true&cX=0&cY=1&cW=518&cH=828',
        emptyDates: '01.09 – 19.11',
        emptyText:
          'Bald finden Sie hier die Angebote für die Herbstferien ' +
          YEAR +
          '.',
      },
    ];

    var modal = document.getElementById('campModal');
    var modalTitle = document.getElementById('campModalTitle');
    var modalSelect = document.getElementById('campSlotSelect');
    var modalFirstName = document.getElementById('campChildFirst');
    var modalLastName = document.getElementById('campChildLast');
    var modalNote = document.getElementById('campModalNote');
    var modalAddBtn = document.getElementById('campModalAdd');

    var currentCourseKey = null;
    var courseIndex = {}; // courseKey -> { title, discipline, variants[] }

    var seasonTitleEl = document.getElementById('rmSeasonTitle');
    var seasonYearEl = document.getElementById('rmSeasonYear');

    function getSeasonConfig(key) {
      for (var i = 0; i < SEASONS_CONFIG.length; i++) {
        if (SEASONS_CONFIG[i].key === key) return SEASONS_CONFIG[i];
      }
      return null;
    }

    function formatEUR(cents) {
      var euro = (cents / 100).toFixed(2).replace('.', ',');
      return euro + '€';
    }

    function slotOrder(slot) {
      if (slot === 'morning') return 0;
      if (slot === 'afternoon') return 1;
      return 2;
    }

    function sortVariantsArr(arr) {
      arr.sort(function (a, b) {
        var pa = a.periodLabel || '';
        var pb = b.periodLabel || '';
        if (pa < pb) return -1;
        if (pa > pb) return 1;

        var sa = slotOrder(a.slot);
        var sb = slotOrder(b.slot);
        return sa - sb;
      });
    }

    function parseStartMinutes(timeLabel) {
      if (!timeLabel) return null;
      var m = timeLabel.match(/(\d{2}):(\d{2})/);
      if (!m) return null;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }

    function applySeasonStyles(seasonKey) {
      var conf = getSeasonConfig(seasonKey) || {};

      var bg = conf.bg || 'var(--rm-season-bg)';
      var tabHoverBg = conf.tabHoverBg || '#000000';
      var tabHoverText = conf.tabHoverText || '#ffffff';

      document.documentElement.style.setProperty('--rm-season-bg', bg);
      document.documentElement.style.setProperty(
        '--rm-season-tab-hover-bg',
        tabHoverBg
      );
      document.documentElement.style.setProperty(
        '--rm-season-tab-hover-text',
        tabHoverText
      );

      if (SHOW_TITLE && seasonTitleEl && conf.title) {
        seasonTitleEl.textContent = conf.title;
      }
      if (SHOW_TITLE && seasonYearEl) {
        seasonYearEl.textContent = YEAR;
      }
    }

    function getFilteredCatalogForSeason() {
      if (!ACTIVE_SEASON) return ALL_CATALOG;
      var out = [];
      for (var i = 0; i < ALL_CATALOG.length; i++) {
        if (ALL_CATALOG[i].season === ACTIVE_SEASON) out.push(ALL_CATALOG[i]);
      }
      return out;
    }

    function renderCurrentSeason() {
      var catalog = getFilteredCatalogForSeason();
      var conf = getSeasonConfig(ACTIVE_SEASON) || {};

      if (!catalog || !catalog.length) {
        applySeasonStyles(ACTIVE_SEASON);
        grid.innerHTML =
          '<div class="rm-empty-season">' +
          (conf.emptyDates
            ? '<div class="rm-empty-season__dates">' +
              conf.emptyDates +
              '</div>'
            : '') +
          '<div class="rm-empty-season__image">' +
          (conf.emptyImage
            ? '<img src="' +
              conf.emptyImage +
              '" alt="' +
              (conf.title || '') +
              '" loading="lazy">'
            : '') +
          '</div>' +
          (conf.emptyText
            ? '<div class="rm-empty-season__text">' + conf.emptyText + '</div>'
            : '') +
          '</div>';
        return;
      }

      applySeasonStyles(ACTIVE_SEASON);
      renderGrid(catalog);
    }

    function initSeasonTabs() {
      if (!seasonTabs || !ENABLE_SEASON_TABS) return;

      var tabs = SEASONS_CONFIG.slice();
      if (!tabs.length) {
        seasonTabs.style.display = 'none';
        return;
      }

      if (!ACTIVE_SEASON) {
        var hasDefault = false;
        for (var i = 0; i < tabs.length; i++) {
          if (tabs[i].key === DEFAULT_SEASON) {
            hasDefault = true;
            break;
          }
        }
        ACTIVE_SEASON = hasDefault ? DEFAULT_SEASON : tabs[0].key;
      }

      var html = '';
      for (var j = 0; j < tabs.length; j++) {
        var s = tabs[j];
        html +=
          '<button class="rm-season-tab" data-season="' +
          s.key +
          '">' +
          s.label +
          '</button>';
      }
      seasonTabs.innerHTML = html;

      function updateTabUI() {
        var nodes = seasonTabs.querySelectorAll('[data-season]');
        for (var i = 0; i < nodes.length; i++) {
          var btn = nodes[i];
          if (btn.getAttribute('data-season') === ACTIVE_SEASON)
            btn.classList.add('is-active');
          else btn.classList.remove('is-active');
        }
      }

      seasonTabs.querySelectorAll('[data-season]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          ACTIVE_SEASON = btn.getAttribute('data-season');
          applySeasonStyles(ACTIVE_SEASON);
          updateTabUI();
          renderCurrentSeason();
        });
      });

      applySeasonStyles(ACTIVE_SEASON);
      updateTabUI();
    }

    // Загрузка каталога — запускаем после load, но это уже внутри init, так что просто fetch
    fetch(API_BASE + '/api/catalog', { mode: 'cors' })
      .then(function (r) {
        return r.json();
      })
      .then(function (raw) {
        var catalog = raw && raw.catalog ? raw.catalog : [];
        // один раз фильтруем по странице
        if (RM_PAGE_KEY) {
          var filtered = [];
          for (var i = 0; i < catalog.length; i++) {
            if (catalog[i].readymagPage === RM_PAGE_KEY) {
              filtered.push(catalog[i]);
            }
          }
          catalog = filtered;
        }

        ALL_CATALOG = catalog;

        // предварительно сортируем варианты внутри каждого продукта –
        // чтобы не делать slice().sort() много раз
        var courseVariantsMap = {};
        for (var i = 0; i < ALL_CATALOG.length; i++) {
          var it = ALL_CATALOG[i];
          var cKey = (it.disciplineKey || '') + '|' + it.title;
          if (!courseVariantsMap[cKey]) courseVariantsMap[cKey] = [];
          courseVariantsMap[cKey].push(it);
        }
        for (var key in courseVariantsMap) {
          if (Object.prototype.hasOwnProperty.call(courseVariantsMap, key)) {
            sortVariantsArr(courseVariantsMap[key]);
          }
        }

        // init табов
        if (!RM_PAGE_KEY && ENABLE_SEASON_TABS) {
          initSeasonTabs();
        } else if (DEFAULT_SEASON) {
          ACTIVE_SEASON = DEFAULT_SEASON;
        }

        renderCurrentSeason();
        setupModalHandlers(courseVariantsMap);
      })
      .catch(function (err) {
        console.error(err);
        grid.innerHTML = '<div>Fehler beim Laden des Katalogs</div>';
      });

    function renderGrid(catalog) {
      courseIndex = {};

      var remaining = MAX_CAMPS;
      var shouldShowFade = catalog.length > MAX_CAMPS;

      var groups = {};
      var groupOrder = [];

      for (var i = 0; i < catalog.length; i++) {
        var item = catalog[i];
        var gKey = item.ageLabel || 'Jedes Alter';
        if (!groups[gKey]) {
          groups[gKey] = [];
          groupOrder.push(gKey);
        }
        groups[gKey].push(item);
      }

      var ageOrder = ['8-11 Jahre', '10+ Jahre', '12-16 Jahre'];
      groupOrder.sort(function (a, b) {
        var ia = ageOrder.indexOf(a);
        var ib = ageOrder.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });

      var html = '';
      for (var gi = 0; gi < groupOrder.length; gi++) {
        if (remaining <= 0) break;

        var groupKey = groupOrder[gi];
        var items = groups[groupKey];

        var courseMap = {};
        var courseOrder = [];

        for (var k = 0; k < items.length; k++) {
          var it = items[k];
          var cKey = (it.disciplineKey || '') + '|' + it.title;
          if (!courseMap[cKey]) {
            courseMap[cKey] = {
              title: it.title,
              readymagPage: it.readymagPage || '',
              variants: [],
            };
            courseOrder.push(cKey);
            courseIndex[cKey] = {
              title: it.title,
              discipline: groupKey,
              readymagPage: it.readymagPage || '',
              variants: courseMap[cKey].variants,
            };
          }
          courseMap[cKey].variants.push(it);
        }

        // сортируем курсы внутри age-группы
        courseOrder.sort(function (aKey, bKey) {
          var aVariants = courseMap[aKey].variants;
          var bVariants = courseMap[bKey].variants;

          var aFirst = aVariants[0] || {};
          var bFirst = bVariants[0] || {};

          var sa = slotOrder(aFirst.slot);
          var sb = slotOrder(bFirst.slot);
          if (sa !== sb) return sa - sb;

          var ta = parseStartMinutes(aFirst.timeLabel);
          var tb = parseStartMinutes(bFirst.timeLabel);
          if (ta != null && tb != null && ta !== tb) return ta - tb;

          var at = courseMap[aKey].title || '';
          var bt = courseMap[bKey].title || '';
          return at.localeCompare(bt);
        });

        var limitedCourseOrder = courseOrder;
        if (limitedCourseOrder.length > remaining) {
          limitedCourseOrder = limitedCourseOrder.slice(0, remaining);
        }
        remaining -= limitedCourseOrder.length;

        if (!limitedCourseOrder.length) continue;

        var rowsHtml = '';
        for (var ci = 0; ci < limitedCourseOrder.length; ci++) {
          var cKey = limitedCourseOrder[ci];
          var course = courseMap[cKey];
          var variants = course.variants; // уже отсортированы заранее

          var href = '';
          if (course.readymagPage) {
            href =
              'https://readymag.website/u612815371/5961069/' +
              course.readymagPage +
              '/';
          }
          var titleHtml = href
            ? '<a class="rm-course-link" href="' +
              href +
              '">' +
              course.title +
              '</a>'
            : course.title;

          var byPeriod = {};
          var periodOrder = [];

          for (var vi = 0; vi < variants.length; vi++) {
            var v = variants[vi];
            var key = v.periodLabel || '';
            if (!byPeriod[key]) {
              byPeriod[key] = { label: v.periodLabel || '', times: [] };
              periodOrder.push(key);
            }
            if (v.timeLabel) byPeriod[key].times.push(v.timeLabel);
          }

          var dateParts = [];
          var timeParts = [];

          for (var pi = 0; pi < periodOrder.length; pi++) {
            var pk = periodOrder[pi];
            var g = byPeriod[pk];
            if (g.label) dateParts.push(g.label);
            if (g.times.length) timeParts.push(g.times.join('<br>'));
          }

          var amount = variants[0] ? variants[0].amount : 0;
          var freeSeats =
            variants[0] && typeof variants[0].freeSeats === 'number'
              ? variants[0].freeSeats
              : null;
          var isFull = freeSeats !== null && freeSeats <= 0;

          rowsHtml +=
            '<article class="rm-camp-row" data-course-key="' +
            cKey +
            '">' +
            '<div class="rm-col-title">' +
            titleHtml +
            '</div>' +
            '<div class="rm-col-date">' +
            dateParts.join('<br>') +
            '</div>' +
            '<div class="rm-col-time">' +
            timeParts.join('<br>') +
            '</div>' +
            '<div class="rm-col-price">' +
            formatEUR(amount || 0) +
            '</div>' +
            '<div class="rm-col-btn">' +
            '<button class="rm-btn rm-btn-big" data-open="' +
            cKey +
            '" ' +
            (isFull ? 'disabled' : '') +
            '>Jetzt buchen</button>' +
            '</div>' +
            '</article>';
        }

        if (!rowsHtml) continue;

        html +=
          '<section class="rm-group">' +
          '<div class="rm-group-header">' +
          '<span class="rm-group-label">' +
          groupKey +
          ':</span>' +
          '</div>' +
          '<div class="rm-camp-row-container">' +
          rowsHtml +
          '</div>' +
          '</section>';
      }

      if (!html) {
        grid.innerHTML =
          '<div class="rm-empty">Keine Camps für diesen Zeitraum gefunden.</div>';
        return;
      }

      var conf = getSeasonConfig(ACTIVE_SEASON) || {};
      var gradientColor = conf.bg || 'var(--rm-season-bg)';

      var wrapperHtml =
        '<div class="rm-list-wrapper">' +
        '<div class="rm-list-inner">' +
        html +
        '</div>' +
        '<div class="' +
        (shouldShowFade ? 'rm-list-fade' : '') +
        '" style="background: linear-gradient(to bottom, rgba(255,255,255,0), ' +
        gradientColor +
        ');"></div>' +
        '</div>' +
        (SHOW_BUTTON
          ? '<div class="rm-all-link-wrap">' +
            '<a class="rm-all-link" href="https://readymag.website/u612815371/5961069/camps">Mehr anzeigen</a>' +
            '</div>'
          : '');

      grid.innerHTML = wrapperHtml;

      var openBtns = grid.querySelectorAll('[data-open]');
      for (var bi = 0; bi < openBtns.length; bi++) {
        openBtns[bi].addEventListener('click', function () {
          var key = this.getAttribute('data-open');
          openModal(key);
        });
      }
    }

    function openModal(courseKey) {
      var course = courseIndex[courseKey];
      if (!course) return;
      currentCourseKey = courseKey;

      modalTitle.textContent = course.title || 'Camp';

      modalSelect.innerHTML = '';
      var variants = course.variants;
      for (var i = 0; i < variants.length; i++) {
        var v = variants[i];
        var slotLabel =
          v.slot === 'morning'
            ? 'Vormittag'
            : v.slot === 'afternoon'
            ? 'Nachmittag'
            : '';
        var parts = [];
        if (v.periodLabel) parts.push(v.periodLabel);
        if (v.timeLabel) parts.push(v.timeLabel);
        if (slotLabel) parts.push('(' + slotLabel + ')');
        var text = parts.join(' · ');

        var opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = text || v.title || v.id;
        modalSelect.appendChild(opt);
      }

      modalFirstName.value = '';
      modalLastName.value = '';

      modalNote.textContent = variants.length
        ? 'Bitte wählen Sie den Termin und geben Sie den Namen des Kindes ein.'
        : '';

      modal.classList.add('open');
    }

    function closeModal() {
      modal.classList.remove('open');
      currentCourseKey = null;
    }

    function setupModalHandlers(courseVariantsMap) {
      document.querySelectorAll('[data-modal-close]').forEach(function (btn) {
        btn.addEventListener('click', closeModal);
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeModal();
      });

      modalAddBtn.addEventListener('click', function () {
        if (!currentCourseKey || !window.CartStore) return;
        var course = courseIndex[currentCourseKey];
        if (!course) return;

        var fn = modalFirstName.value.trim();
        var ln = modalLastName.value.trim();
        if (!fn || !ln) {
          alert('Bitte Vorname und Nachname des Kindes eingeben.');
          return;
        }

        var selectedId = modalSelect.value;
        var variants = course.variants;
        var v = variants[0];
        for (var i = 0; i < variants.length; i++) {
          if (variants[i].id === selectedId) {
            v = variants[i];
            break;
          }
        }

        window.CartStore.add({
          week: v.weekLabel || v.weekLabel,
          week_label: v.weekLabel || '',
          camp_type: v.disciplineLabelDe || v.disciplineKey || '',
          slot: v.slot,
          childFirst: fn,
          childLast: ln,
          basePriceEUR: (v.amount || 0) / 100,
          prices: {
            fullPriceId: v.fullPriceId,
            discPriceId: v.discPriceId,
          },
          campId: v.id,
          productId: v.productId,
          title: v.title,
          image: v.image,
          timeLabel: v.timeLabel,
          periodLabel: v.periodLabel,
          ageLabel: v.ageLabel,
          season: v.season,
          disciplineKey: v.disciplineKey,
          disciplineLabelDe: v.disciplineLabelDe,
          amount: v.amount,
          label: v.title + ' (' + (v.timeLabel || '') + ')',
        });

        closeModal();

        if (window.CartBus) {
          window.CartBus.dispatchEvent(new Event('cart:open'));
        }
      });
    }
  }

  // Ленивая инициализация после полной загрузки страницы
  if (document.readyState === 'complete') {
    initCampListWidget();
  } else {
    window.addEventListener('load', initCampListWidget);
  }
})();
