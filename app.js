/* =============================================================
   科技英语 · 六日复习
   Vanilla JS app: routing, daily study, quiz, error log.
   ============================================================= */
(function () {
  "use strict";

  const DATA = window.REVIEW_DATA;
  const TERMS = DATA.terms;
  const TERM_BY_ID = new Map(TERMS.map(function (t) { return [t.id, t]; }));
  const STORAGE_KEY = "glass-ore-review.v1";

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function dateKey(d) {
    const x = d || new Date();
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }

  function parseDateKey(key) {
    const parts = String(key || dateKey()).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function shortDate(d) {
    return pad(d.getMonth() + 1) + "." + pad(d.getDate());
  }

  function dateTimeLabel(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return shortDate(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function unique(arr) {
    return Array.from(new Set(arr));
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  /* ---------------- State ---------------- */

  function freshState() {
    const now = new Date();
    return {
      version: 1,
      createdAt: now.toISOString(),
      startDate: dateKey(now),
      progress: {},
      wrong: {},
      mastery: {},
      errorStats: {},
      totals: { answered: 0, correct: 0 },
      blur: false,
      lastDay: 1
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      const parsed = JSON.parse(raw);
      const base = freshState();
      return Object.assign(base, parsed, {
        progress: parsed.progress || {},
        wrong: parsed.wrong || {},
        mastery: parsed.mastery || {},
        errorStats: parsed.errorStats || {},
        totals: Object.assign({ answered: 0, correct: 0 }, parsed.totals || {})
      });
    } catch (err) {
      return freshState();
    }
  }

  let state = loadState();
  let currentView = "home";
  let currentDay = 1;
  let termTrackFilter = "all";
  let equipGroup = "全部";
  let wrongFilter = "all";
  let scopeSource = "all";
  let scopeDay = 1;
  let scopeQty = 20;
  let quizSession = null;
  let toastTimer = null;
  let confirmCallback = null;

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* private mode */ }
  }

  function getMastery(id) {
    return state.mastery[id] || { meaning: false, spelling: false, at: null };
  }

  function isMastered(termOrId) {
    const id = typeof termOrId === "string" ? termOrId : termOrId.id;
    const m = getMastery(id);
    return !!(m.meaning && m.spelling);
  }

  function masteredCount(pool) {
    return pool.filter(function (t) { return isMastered(t); }).length;
  }

  function masteryPercent(pool) {
    if (!pool.length) return 0;
    return Math.round(masteredCount(pool) / pool.length * 100);
  }

  function errorRate(stats) {
    if (!stats || !stats.attempts) return 0;
    return Math.round(stats.wrong / stats.attempts * 100);
  }

  function getProgress(day) {
    return state.progress[day] || { best: 0, attempts: 0, completed: false, lastAt: null };
  }

  function completedDays() {
    return DATA.days.filter(function (d) { return isDayComplete(d.n); }).length;
  }

  function isDayComplete(day) {
    if (day === 6) return !!getProgress(6).completed;
    return masteredCount(dayTerms(day)) === dayTerms(day).length;
  }

  function dayTermCount(day) {
    if (day === 6) return TERMS.length;
    return TERMS.filter(function (t) { return t.day === day; }).length;
  }

  function dayTerms(day) {
    return TERMS.filter(function (t) { return t.day === day; });
  }

  function openWrongItems() {
    return Object.keys(state.wrong)
      .map(function (id) { return state.wrong[id]; })
      .filter(function (w) { return w && !w.resolved; });
  }

  function todayWrongItems() {
    const today = dateKey();
    return Object.keys(state.wrong)
      .map(function (id) { return state.wrong[id]; })
      .filter(function (w) {
        return w && w.lastWrongAt && dateKey(new Date(w.lastWrongAt)) === today;
      });
  }

  function dayWrongItems(day) {
    return Object.keys(state.wrong)
      .map(function (id) { return state.wrong[id]; })
      .filter(function (w) { return w && !w.resolved && w.day === day; });
  }

  function recommendedDay() {
    for (let i = 1; i <= 5; i++) {
      if (!isDayComplete(i)) return i;
    }
    return 6;
  }

  function scheduleDate(day) {
    return addDays(parseDateKey(state.startDate || dateKey()), day - 1);
  }

  function weekDayLabel(d) {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  }

  /* ---------------- Chrome ---------------- */

  function updateChrome() {
    const open = openWrongItems().length;
    const badge = $("#navWrongBadge");
    if (badge) {
      badge.hidden = open === 0;
      badge.textContent = open > 99 ? "99+" : String(open);
    }
    const done = completedDays();
    const text = $("#headerProgressText");
    const bar = $("#headerProgressBar");
    if (text) text.textContent = done + " / 6";
    if (bar) bar.style.width = (done / 6 * 100) + "%";
  }

  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-show"); }, 2600);
  }

  function askConfirm(opts) {
    const modal = $("#confirmModal");
    if (!modal) {
      if (window.confirm(opts.text || "确认操作？")) opts.onConfirm();
      return;
    }
    $("#confirmTitle").textContent = opts.title || "确认操作";
    $("#confirmText").textContent = opts.text || "";
    $("#confirmOk").textContent = opts.okLabel || "确认";
    $("#confirmCancel").textContent = opts.cancelLabel || "取消";
    confirmCallback = opts.onConfirm;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(function () { $("#confirmCancel").focus(); }, 40);
  }

  function closeConfirm(run) {
    const modal = $("#confirmModal");
    if (!modal || modal.hidden) return;
    const cb = run ? confirmCallback : null;
    confirmCallback = null;
    modal.hidden = true;
    if (!quizSession) document.body.classList.remove("modal-open");
    if (typeof cb === "function") cb();
  }

  /* ---------------- Typewriter ---------------- */

  function startTypewriter() {
    const wordEl = $("#typeWord");
    const zhEl = $("#typeZh");
    if (!wordEl || !zhEl) return;

    const seq = [
      { zh: "湿法冶金", en: "hydrometallurgy" },
      { zh: "磁化焙烧", en: "magnetizing roasting" },
      { zh: "解离", en: "liberation" },
      { zh: "浮选", en: "flotation" },
      { zh: "高磷鲕状赤铁矿", en: "high-phosphorus oolitic hematite" },
      { zh: "终端速度", en: "terminal velocity" }
    ];

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      wordEl.textContent = seq[0].zh;
      zhEl.textContent = seq[0].en;
      return;
    }

    let index = 0;
    let chars = 0;
    let deleting = false;

    wordEl.textContent = "";
    zhEl.textContent = seq[0].en;

    function step() {
      const item = seq[index];
      if (!deleting) {
        chars++;
        wordEl.textContent = item.zh.slice(0, chars);
        if (chars >= item.zh.length) {
          deleting = true;
          setTimeout(step, 2400);
          return;
        }
        setTimeout(step, 105);
      } else {
        chars--;
        wordEl.textContent = item.zh.slice(0, Math.max(0, chars));
        if (chars <= 0) {
          deleting = false;
          index = (index + 1) % seq.length;
          zhEl.textContent = seq[index].en;
          setTimeout(step, 320);
          return;
        }
        setTimeout(step, 42);
      }
    }
    setTimeout(step, 750);
  }

  /* ---------------- Home ---------------- */

  function renderHome() {
    updateChrome();

    const today = new Date();
    const todayDate = $("#todayDate");
    if (todayDate) {
      todayDate.textContent = (today.getMonth() + 1) + " 月 " + today.getDate() + " 日 · " + weekDayLabel(today);
    }

    const rec = recommendedDay();
    const recDay = DATA.days[rec - 1];
    const ringDays = $("#ringDays");
    const ringFg = $("#ringFg");
    const nextTitle = $("#nextDayTitle");
    const nextMeta = $("#nextDayMeta");
    const startLabel = $("#heroStartLabel");

    if (ringDays) ringDays.textContent = completedDays();
    if (ringFg) ringFg.style.strokeDashoffset = String(326.73 * (1 - completedDays() / 6));
    const totalMastered = masteredCount(TERMS);
    const homeMastered = $("#homeMastered");
    const homeBar = $("#homeMasteredBar");
    if (homeMastered) homeMastered.textContent = totalMastered;
    if (homeBar) homeBar.style.width = (totalMastered / TERMS.length * 100) + "%";
    if (nextTitle) nextTitle.textContent = recDay.title;
    if (nextMeta) {
      nextMeta.textContent = "DAY " + pad(rec) + " · " + dayTermCount(rec) + " 个术语 · 双重验证";
    }
    if (startLabel) {
      startLabel.textContent = completedDays() === 6 ? "全库回测" : "开始 DAY " + pad(rec);
    }

    const dots = $("#weekDots");
    if (dots) {
      dots.innerHTML = DATA.days.map(function (d) {
        const done = isDayComplete(d.n);
        const cls = "week-dot" + (done ? " is-done" : "") + (d.n === rec ? " is-current" : "");
        return '<button class="' + cls + '" data-day="' + d.n + '" aria-label="DAY ' + pad(d.n) + " " + esc(d.title) + '">' +
          "<i></i><span>" + pad(d.n) + "</span></button>";
      }).join("");
    }

    const grid = $("#dayGrid");
    if (!grid) return;
    grid.innerHTML = DATA.days.map(function (d) {
      const p = getProgress(d.n);
      const pool = d.n === 6 ? TERMS : dayTerms(d.n);
      const mastered = masteredCount(pool);
      const mPct = masteryPercent(pool);
      const isDone = d.n === 6 ? !!p.completed : mastered === pool.length;
      const isCurrent = d.n === rec && !isDone;
      const cls = "day-card" + (isDone ? " is-done" : "") + (isCurrent ? " is-current" : "");
      const status = isDone
        ? '<span class="day-status done">✓ ' + (d.n === 6 ? "已完成" : "已掌握") + '</span>'
        : (isCurrent || mastered > 0)
          ? '<span class="day-status current">● 进行中</span>'
          : '<span class="day-status">未开始</span>';
      return '<button class="' + cls + '" data-day="' + d.n + '">' +
        '<span class="day-card-top">' +
          '<span class="day-kicker">' + d.kicker + " · " + shortDate(scheduleDate(d.n)) + '</span>' +
          status +
        "</span>" +
        "<h3>" + esc(d.title) + "</h3>" +
        '<span class="day-en">' + esc(d.en) + "</span>" +
        '<span class="day-focus">' + esc(d.focus) + "</span>" +
        '<span class="day-card-bottom">' +
          '<span><span class="day-count">' + mastered + " / " + pool.length + " 已掌握" + (p.best ? " · 首答 " + p.best + "%" : "") + '</span>' +
          '<span class="day-bar"><span style="width:' + mPct + '%"></span></span></span>' +
          '<span class="day-arrow">↗</span>' +
        "</span>" +
      "</button>";
    }).join("");
  }

  /* ---------------- Study ---------------- */

  function renderDaySwitcher() {
    const el = $("#daySwitcher");
    if (!el) return;
    el.innerHTML = DATA.days.map(function (d) {
      const done = isDayComplete(d.n);
      const cls = "day-switch" + (d.n === currentDay ? " is-active" : "") + (done ? " is-done" : "");
      return '<button class="' + cls + '" data-day="' + d.n + '" role="tab" aria-selected="' + (d.n === currentDay) + '" aria-label="DAY ' + pad(d.n) + " " + esc(d.title) + '">' + pad(d.n) + "</button>";
    }).join("");
  }

  function renderStudy(day) {
    currentDay = day;
    state.lastDay = day;
    save();

    const d = DATA.days[day - 1];
    if (!d) return;
    const wc = dayWrongItems(day).length;
    const sideWrong = day === 6 ? openWrongItems().length : wc;
    const studyPool = day === 6 ? TERMS : dayTerms(day);
    const studyMastered = masteredCount(studyPool);

    renderDaySwitcher();

    const hero = $("#dayHero");
    if (hero) {
      hero.innerHTML = '<div class="day-hero">' +
        "<div>" +
          '<p class="eyebrow"><span class="eyebrow-dot"></span>' + d.kicker + " · " + shortDate(scheduleDate(day)) + "</p>" +
          "<h1>" + esc(d.title) + "</h1>" +
          '<p class="day-en-large">' + esc(d.en) + "</p>" +
          '<p class="day-intro">' + esc(d.intro) + "</p>" +
          '<div class="day-goals">' + d.goals.map(function (g) { return '<span class="goal-chip">' + esc(g) + "</span>"; }).join("") + "</div>" +
        "</div>" +
        '<div class="day-hero-side">' +
          '<div class="side-stat"><strong>' + dayTermCount(day) + '</strong><span>' + (day === 6 ? "Terms in scope" : "Terms in this day") + '</span></div>' +
          '<div class="side-stat"><strong>' + studyMastered + " / " + studyPool.length + '</strong><span>Fully mastered</span></div>' +
          '<div class="side-stat"><strong>' + sideWrong + '</strong><span>Open mistakes</span></div>' +
          '<button class="btn btn-primary" id="heroQuizBtn">' + (day === 6 ? "开始全库混合测" : "开始本日自测") + "</button>" +
          (day === 6
            ? '<button class="btn btn-ghost" data-view="equipment">打开设备速查</button>'
            : '<button class="btn btn-ghost" id="heroWrongBtn"' + (wc === 0 ? " disabled" : "") + ">回顾本日错题" + (wc ? "（" + wc + "）" : "") + "</button>") +
        "</div>" +
      "</div>";
    }

    const toolbar = $(".study-toolbar");
    if (toolbar) toolbar.style.display = day === 6 ? "none" : "";

    const filters = $("#termFilters");
    if (filters) filters.style.display = day === 6 ? "none" : "";
    const blurBtn = $("#blurToggle");
    if (blurBtn) {
      blurBtn.style.display = day === 6 ? "none" : "";
      blurBtn.setAttribute("aria-pressed", state.blur ? "true" : "false");
      blurBtn.classList.toggle("is-on", !!state.blur);
      blurBtn.innerHTML = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.3"/></svg>' + (state.blur ? "显示中文" : "遮挡中文");
    }

    renderTermGrid(day);

    const studyEnd = $(".study-end");
    if (studyEnd) {
      const endH = $("h3", studyEnd);
      const endP = $("p:last-child", studyEnd);
      if (endH) endH.textContent = day === 6 ? "用 40 道题，把六天的词过两关。" : "看完了，就让题目来告诉你记住没有。";
      if (endP) endP.textContent = day === 6 ? "20 个词 × 释义与拼写；错词会在 5 题后回炉，直到全部通过。" : "12 个词 × 释义与拼写，约 8 分钟。答错会在 5 题后再次出现，直到通过。";
    }

    const quizBtn = $("#heroQuizBtn");
    if (quizBtn) quizBtn.addEventListener("click", function () { startNormalQuiz(day); });
    const wrongBtn = $("#heroWrongBtn");
    if (wrongBtn) {
      wrongBtn.addEventListener("click", function () {
        const ids = dayWrongItems(day).map(function (w) { return w.id; });
        if (!ids.length) return toast("本日暂无未订正错题");
        startReview(ids, "study", day);
      });
    }
  }

  function renderTermGrid(day) {
    const grid = $("#termGrid");
    if (!grid) return;

    if (day === 6) {
      const open = openWrongItems().length;
      grid.classList.add("is-special");
      grid.innerHTML = '<div class="day6-panel">' +
        '<div class="day6-lead">' +
          '<p class="micro-label">NO NEW WORDS · ONLY RETRIEVAL</p>' +
          '<h2>第六天，不再输入。<br>只做提取与串联。</h2>' +
          '<p>20 个词 × 释义与拼写双重验证；错词在 5 题后回炉，直到全部通过。</p>' +
          '<div class="day6-actions">' +
            '<button class="btn btn-primary" id="day6Quiz">开始 20 词双重验证 →</button>' +
            '<button class="btn btn-ghost" data-view="equipment">打开设备速查</button>' +
          "</div>" +
        "</div>" +
        '<div class="day6-scope">' +
          '<div class="scope-head"><span>回测范围</span><span>已掌握</span><span>状态</span></div>' +
          DATA.days.slice(0, 5).map(function (d) {
            const pool = dayTerms(d.n);
            const mastered = masteredCount(pool);
            return '<button class="scope-row" data-day="' + d.n + '">' +
              '<span><b>DAY ' + pad(d.n) + '</b> ' + esc(d.focus) + "</span>" +
              "<span>" + mastered + " / " + pool.length + "</span>" +
              '<span class="' + (mastered === pool.length ? "scope-done" : "scope-todo") + '">' + (mastered === pool.length ? "已掌握" : "待复习") + "</span>" +
            "</button>";
          }).join("") +
          '<div class="scope-foot">未订正错题 <b>' + open + "</b> 个 · 建议先清错题，再做混合测。</div>" +
        "</div>" +
      "</div>";

      const q = $("#day6Quiz");
      if (q) q.addEventListener("click", function () { startNormalQuiz(6); });
      return;
    }

    grid.classList.remove("is-special");
    const pool = dayTerms(day).filter(function (t) {
      return termTrackFilter === "all" || t.track === termTrackFilter;
    });

    grid.innerHTML = pool.map(function (t, i) {
      const idx = dayTerms(day).indexOf(t) + 1;
      const blurred = state.blur ? " is-blurred" : "";
      const mastered = isMastered(t);
      return '<article class="term-card' + blurred + (mastered ? " is-mastered" : "") + '" data-term-id="' + t.id + '">' +
        '<div class="term-card-top">' +
          '<span class="term-index">' + pad(idx) + " / " + pad(dayTermCount(day)) + "</span>" +
          '<span class="term-flags">' + (mastered ? '<span class="term-mastered">✓ 已掌握</span>' : "") +
            '<span class="term-track ' + t.track + '">' + (t.track === "glass" ? "EN" : "MINING") + "</span></span>" +
        "</div>" +
        '<h3 class="term-en">' + esc(t.en) + "</h3>" +
        '<p class="term-zh">' + esc(t.zh) + "</p>" +
        '<p class="term-note">' + esc(t.note) + "</p>" +
      "</article>";
    }).join("");
  }

  /* ---------------- Process ---------------- */

  function renderProcess() {
    const grid = $("#processGrid");
    if (!grid) return;
    grid.innerHTML = DATA.processes.map(function (p) {
      const feature = (p.id === "p12" || p.id === "p13") ? " is-feature" : "";
      const route = p.route
        ? '<div class="process-diagram" aria-hidden="true"><span class="route-label">TYPICAL ROUTE</span>' +
            p.route.map(function (step, i) {
              return "<b>" + esc(step) + "</b>" + (i < p.route.length - 1 ? "<i>→</i>" : "");
            }).join("") +
          "</div>"
        : "";
      return '<article class="process-card' + feature + '">' +
        '<div class="process-top"><span class="process-tag">' + esc(p.tag) + '</span><span class="process-no">' + p.no + "</span></div>" +
        "<h2>" + esc(p.title) + "</h2>" +
        '<p class="process-en">' + esc(p.en) + "</p>" +
        '<p class="process-summary">' + esc(p.summary) + "</p>" +
        '<ul class="process-points">' + p.points.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
        '<div class="process-equip">' + p.equip.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div>" +
        route +
      "</article>";
    }).join("");
  }

  /* ---------------- Equipment ---------------- */

  function renderEquipFilters() {
    const el = $("#equipFilters");
    if (!el) return;
    const groups = ["全部"].concat(unique(DATA.equipment.map(function (e) { return e.group; })));
    el.innerHTML = groups.map(function (g) {
      return '<button class="filter-pill' + (g === equipGroup ? " is-active" : "") + '" data-equip-group="' + esc(g) + '">' + esc(g) + "</button>";
    }).join("");
  }

  function renderEquipment() {
    renderEquipFilters();
    const grid = $("#equipmentGrid");
    const count = $("#equipCount");
    if (!grid) return;
    const items = DATA.equipment.filter(function (e) { return equipGroup === "全部" || e.group === equipGroup; });
    if (count) count.textContent = items.length + " 类设备";
    grid.innerHTML = items.map(function (e) {
      return '<article class="equip-card">' +
        '<div class="equip-top">' +
          '<span class="equip-glyph" data-group="' + esc(e.group) + '">' + esc(e.group.charAt(0)) + "</span>" +
          '<span class="equip-group">' + esc(e.group) + "</span>" +
        "</div>" +
        '<h3 class="equip-en">' + esc(e.en) + "</h3>" +
        '<p class="equip-zh">' + esc(e.zh) + "</p>" +
        '<p class="equip-note">' + esc(e.note) + "</p>" +
      "</article>";
    }).join("");
  }

  /* ---------------- Wrong book ---------------- */

  function renderWrong() {
    updateChrome();
    const all = Object.keys(state.wrong).map(function (id) { return state.wrong[id]; });
    const open = all.filter(function (w) { return !w.resolved; });
    const resolved = all.filter(function (w) { return w.resolved; });
    const today = todayWrongItems();

    const summary = $("#wrongSummary");
    if (summary) {
      summary.innerHTML =
        '<div class="sum"><strong>' + open.length + '</strong><span>OPEN</span></div>' +
        '<div class="sum"><strong>' + today.length + '</strong><span>TODAY</span></div>' +
        '<div class="sum"><strong>' + resolved.length + '</strong><span>RESOLVED</span></div>';
    }

    const reviewAll = $("#reviewAllBtn");
    if (reviewAll) {
      reviewAll.disabled = open.length === 0;
      reviewAll.textContent = open.length ? "回顾全部未订正（" + open.length + "）" : "暂无未订正错题";
    }

    $$("#wrongFilters .filter-pill").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-wrong-filter") === wrongFilter);
    });

    let list = all.slice();
    if (wrongFilter === "open") list = open;
    else if (wrongFilter === "today") list = today;
    else if (wrongFilter === "resolved") list = resolved;

    list.sort(function (a, b) {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      return new Date(b.lastWrongAt || 0) - new Date(a.lastWrongAt || 0);
    });

    const el = $("#wrongList");
    if (!el) return;
    if (!list.length) {
      const copy = wrongFilter === "resolved"
        ? ["还没有已订正的错题。", "释义与拼写都通过后，条目会移到这里，历史仍会保留。"]
        : wrongFilter === "today"
          ? ["今天还没有错题。", "去做一组自测，错题会自动出现在这里。"]
          : wrongFilter === "open"
            ? ["没有未订正错题。", "答错的词都已完成回炉；历史记录保留在“已订正”，错误率排行榜也会继续累计。"]
            : ["错题本是空的。", "做完一次自测后，答错的术语会自动收进来。"];
      el.innerHTML = '<div class="wrong-empty">' +
        '<svg viewBox="0 0 48 48" width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="24" cy="24" r="17"/><path d="M17 24l5 5 10-11"/></svg>' +
        "<h3>" + copy[0] + "</h3><p>" + copy[1] + "</p></div>";
      renderErrorBoard();
      return;
    }

    el.innerHTML = list.map(function (w) {
      const term = TERM_BY_ID.get(w.id);
      if (!term) return "";
      const parts = (w.parts || []).map(function (p) {
        return p === "meaning" ? "释义" : "拼写";
      }).join(" + ");
      return '<div class="wrong-row' + (w.resolved ? " is-resolved" : "") + '">' +
        '<span class="wrong-status-dot" aria-hidden="true">✓</span>' +
        '<div><span class="wrong-term">' + esc(term.en) + '</span><span class="wrong-day">DAY ' + pad(w.day) + " · " + (w.resolved ? "已订正" : "未订正") + (parts ? " · " + parts : "") + "</span></div>" +
        '<span class="wrong-zh">' + esc(term.zh) + "</span>" +
        '<span class="wrong-meta">错 ' + w.count + ' 次<br>' + dateTimeLabel(w.lastWrongAt) + "</span>" +
        '<span class="wrong-action"><button class="btn btn-ghost" data-review-id="' + w.id + '">再做一次</button></span>' +
      "</div>";
    }).join("");

    renderErrorBoard();
  }

  function renderErrorBoard() {
    const el = $("#errorLeaderboard");
    if (!el) return;
    const entries = Object.keys(state.errorStats).map(function (id) {
      const term = TERM_BY_ID.get(id);
      const stats = state.errorStats[id];
      return { id: id, term: term, stats: stats };
    }).filter(function (e) { return e.term && e.stats && e.stats.attempts > 0 && e.stats.wrong > 0; });

    entries.sort(function (a, b) {
      if (b.stats.wrong !== a.stats.wrong) return b.stats.wrong - a.stats.wrong;
      const ra = errorRate(a.stats), rb = errorRate(b.stats);
      if (rb !== ra) return rb - ra;
      return b.stats.attempts - a.stats.attempts;
    });

    if (!entries.length) {
      el.innerHTML = '<div class="error-empty">还没有错误记录。完成一次自测后，错得最多的词会出现在这里。</div>';
      return;
    }

    const maxWrong = entries[0].stats.wrong;
    el.innerHTML = '<div class="error-list">' + entries.slice(0, 10).map(function (e, i) {
      const rate = errorRate(e.stats);
      return '<div class="error-row">' +
        '<span class="error-rank">' + pad(i + 1) + '</span>' +
        '<span class="error-word"><b>' + esc(e.term.en) + '</b><small>' + esc(e.term.zh) + '</small></span>' +
        '<span class="error-bar"><i style="width:' + Math.max(8, Math.round(e.stats.wrong / maxWrong * 100)) + '%"></i></span>' +
        '<span class="error-count">错 <b>' + e.stats.wrong + '</b> 次</span>' +
        '<span class="error-rate">' + rate + '%</span>' +
      '</div>';
    }).join("") + "</div>";
  }

  /* ---------------- Scope picker ---------------- */

  function scopePool() {
    return scopeSource === "daily" ? dayTerms(scopeDay) : TERMS.slice();
  }

  function scopeCount() {
    const pool = scopePool();
    if (scopeSource === "daily") return Math.min(12, pool.length);
    if (scopeQty === "all") return pool.length;
    return Math.min(Number(scopeQty) || 20, pool.length);
  }

  function prioritized(pool) {
    const unmastered = shuffle(pool.filter(function (t) { return !isMastered(t); }));
    const mastered = shuffle(pool.filter(function (t) { return isMastered(t); }));
    return unmastered.concat(mastered);
  }

  function pickTerms(pool, count) {
    if (!pool.length) return [];
    if (count >= pool.length) return shuffle(pool);
    if (count <= 1) return prioritized(pool).slice(0, count);

    const glass = prioritized(pool.filter(function (t) { return t.track === "glass"; }));
    const mining = prioritized(pool.filter(function (t) { return t.track === "mining"; }));
    let glassQuota = Math.round(count * glass.length / pool.length);
    glassQuota = clamp(glassQuota, 1, count - 1);
    const selected = glass.slice(0, glassQuota).concat(mining.slice(0, count - glassQuota));

    if (selected.length < count) {
      const selectedIds = new Set(selected.map(function (t) { return t.id; }));
      const rest = prioritized(pool).filter(function (t) { return !selectedIds.has(t.id); });
      selected.push.apply(selected, rest.slice(0, count - selected.length));
    }
    return shuffle(selected);
  }

  function renderScope() {
    const pool = scopePool();
    const selectedCount = scopeCount();
    const questions = selectedCount * 2;
    const minutes = Math.max(2, Math.ceil(questions * 0.28));

    $$("#scopeSources .scope-source").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-scope-source") === scopeSource);
    });

    const dayBlock = $("#scopeDailyBlock");
    const qtyBlock = $("#scopeQuantityBlock");
    if (dayBlock) dayBlock.hidden = scopeSource !== "daily";
    if (qtyBlock) qtyBlock.hidden = scopeSource === "daily";

    const dayGrid = $("#scopeDayGrid");
    if (dayGrid) {
      dayGrid.innerHTML = DATA.days.map(function (d) {
        const dPool = d.n === 6 ? TERMS : dayTerms(d.n);
        return '<button class="' + (scopeDay === d.n ? "is-active" : "") + '" data-scope-day="' + d.n + '">' +
          "<b>" + pad(d.n) + "</b><span>" + esc(d.title) + "</span><small>" + masteredCount(dPool) + "/" + dPool.length + " 已掌握</small></button>";
      }).join("");
    }

    $$("#scopeQuantityGrid button").forEach(function (b) {
      b.classList.toggle("is-active", String(scopeQty) === b.getAttribute("data-scope-qty"));
    });

    const summary = $("#scopeSummary");
    if (summary) {
      const warning = selectedCount > 60
        ? '<span class="scope-warning">词量较大，建议分 2–3 次完成；也可以选择 30 词。</span>'
        : '<span>答错会在 5 题后回炉，直到通过。</span>';
      summary.innerHTML =
        '<div class="scope-summary-main"><strong>' + selectedCount + "</strong> 个词 × 2 关 = <strong>" + questions + "</strong> 题</div>" +
        '<div class="scope-summary-meta">约 ' + minutes + " 分钟 · 来源：" + (scopeSource === "daily" ? "DAY " + pad(scopeDay) : "全词库") + "</div>" +
        warning;
    }
  }

  function openScope(source, day) {
    scopeSource = source || "all";
    if (day) scopeDay = day;
    if (scopeSource === "daily" && !scopeDay) scopeDay = currentDay;
    const modal = $("#scopeModal");
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    renderScope();
    const box = $("#scopeModal .scope-box");
    if (box) box.scrollTop = 0;
    setTimeout(function () { $("#closeScope").focus(); }, 50);
  }

  function closeScope() {
    const modal = $("#scopeModal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    if (!quizSession && (!$("#confirmModal") || $("#confirmModal").hidden)) {
      document.body.classList.remove("modal-open");
    }
  }

  function startScopeQuiz() {
    const terms = pickTerms(scopePool(), scopeCount());
    if (!terms.length) return toast("这个范围里还没有术语");
    const source = scopeSource;
    const day = source === "daily" ? scopeDay : null;
    closeScope();
    startTermsQuiz(terms, {
      mode: "normal",
      source: source,
      day: day,
      returnView: day ? "study" : "home",
      title: source === "daily" ? "DAY " + pad(day) : "自由复习"
    });
  }

  /* ---------------- Question generation ---------------- */

  function cleanAnswer(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^a-z0-9]/g, "");
  }

  function optionPoolFor(term, pool) {
    const sameTrack = pool.filter(function (t) { return t.track === term.track; });
    const sameKind = sameTrack.filter(function (t) { return t.kind === term.kind; });
    return sameKind.concat(sameTrack, pool, TERMS);
  }

  function makeOptions(term, direction, pool) {
    const field = direction === "en2zh" ? "zh" : "en";
    const correct = term[field];
    const seen = new Set([correct]);
    const options = [correct];
    const candidates = optionPoolFor(term, pool);

    for (let i = 0; i < candidates.length && options.length < 4; i++) {
      const cand = candidates[i];
      if (!cand || cand.id === term.id) continue;
      const val = cand[field];
      if (!val || seen.has(val)) continue;
      seen.add(val);
      options.push(val);
    }
    return shuffle(options);
  }

  function makeQuestion(term, direction, type, pool, kind) {
    const isSpell = type === "spell";
    const prompt = direction === "en2zh" ? term.en : term.zh;
    const answer = direction === "en2zh" ? term.zh : term.en;
    const options = isSpell ? [] : makeOptions(term, direction, pool);
    const correctIndex = isSpell ? -1 : options.indexOf(answer);
    return {
      term: term,
      direction: direction,
      type: type,
      kind: kind || (isSpell ? "spelling" : "meaning"),
      prompt: prompt,
      answer: answer,
      options: options,
      correctIndex: correctIndex,
      answered: false,
      selected: null,
      isCorrect: null,
      response: "",
      isRetry: false,
      retryNo: 0
    };
  }

  function buildDualQuestions(terms, pool) {
    const meanings = terms.map(function (t) {
      return makeQuestion(t, "en2zh", "choice", pool, "meaning");
    });
    const spellings = terms.map(function (t) {
      return makeQuestion(t, "zh2en", "spell", pool, "spelling");
    });
    return meanings.concat(spellings);
  }

  function startTermsQuiz(terms, opts) {
    if (!terms.length) return toast("没有可测试的术语");
    const pool = opts.pool || terms;
    const termResults = {};
    terms.forEach(function (t) {
      termResults[t.id] = {
        meaning: false,
        spelling: false,
        meaningAttempts: 0,
        spellingAttempts: 0
      };
    });
    openQuiz({
      mode: opts.mode || "normal",
      source: opts.source || "daily",
      title: opts.title || "复习自测",
      day: opts.day || null,
      returnView: opts.returnView || "home",
      pool: pool,
      terms: terms,
      termResults: termResults,
      questions: buildDualQuestions(terms, pool),
      index: 0,
      correct: 0,
      firstCorrect: 0,
      firstTotal: terms.length * 2,
      retriesScheduled: 0,
      errorById: {},
      termAttempts: {},
      failedParts: {},
      answers: [],
      finished: false
    });
  }

  function startNormalQuiz(day) {
    const pool = day === 6 ? TERMS.slice() : dayTerms(day);
    const count = day === 6 ? 20 : 12;
    if (!pool.length) return toast("这一日还没有可测试的术语");
    const terms = pickTerms(pool, Math.min(count, pool.length));
    startTermsQuiz(terms, {
      mode: "normal",
      source: day === 6 ? "day6" : "daily",
      title: day === 6 ? "全库混合" : "DAY " + pad(day),
      day: day,
      returnView: "study",
      pool: pool
    });
  }

  function startReview(ids, returnView, day) {
    const cleanIds = unique(ids).filter(function (id) { return TERM_BY_ID.has(id); });
    if (!cleanIds.length) return toast("没有需要回顾的错题");
    const terms = cleanIds.map(function (id) { return TERM_BY_ID.get(id); });
    startTermsQuiz(terms, {
      mode: "review",
      source: "review",
      title: "错题回顾",
      day: day || null,
      returnView: returnView || "wrong",
      pool: TERMS
    });
  }

  /* ---------------- Quiz shell ---------------- */

  function openQuiz(session) {
    quizSession = session;
    const modal = $("#quizModal");
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");

    $("#quizDay").textContent = session.mode === "review"
      ? (session.day ? "DAY " + pad(session.day) + " · REVIEW" : "ERROR LOG")
      : (session.source === "all" ? "FREE REVIEW" : (session.day ? "DAY " + pad(session.day) : "REVIEW"));
    $("#quizMode").textContent = session.mode === "review" ? "错题回顾" : session.title;

    renderQuestion();
    setTimeout(function () {
      const focusEl = $("#quizBody .option") || $("#spellInput") || $("#closeQuiz");
      if (focusEl) focusEl.focus({ preventScroll: true });
    }, 60);
  }

  function closeQuiz(force) {
    if (!quizSession) return;
    const session = quizSession;
    if (!force && !session.finished && session.answers.length > 0) {
      askConfirm({
        title: "退出本次自测？",
        text: "本次不会计入掌握进度；只有完成全部回炉，才会结算释义、拼写与错题记录。",
        okLabel: "退出自测",
        cancelLabel: "继续答题",
        onConfirm: function () { closeQuiz(true); }
      });
      return;
    }
    const modal = $("#quizModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("modal-open");
    quizSession = null;

    if (!session.finished) toast("本次自测未完成，未计入进度");
    if (session.mode === "review") {
      if (session.returnView === "study" && session.day) goView("study", { day: session.day });
      else goView("wrong");
    } else if (session.day) goView("study", { day: session.day });
    else goView("home");
  }

  function renderQuestion() {
    if (!quizSession) return;
    const s = quizSession;
    const q = s.questions[s.index];
    if (!q) return finishQuiz();

    const passedTerms = s.terms.filter(function (t) {
      const r = s.termResults[t.id];
      return r && r.meaning && r.spelling;
    }).length;
    $("#quizCount").textContent = passedTerms + " / " + s.terms.length + " 词";
    $("#quizProgressBar").style.width = (passedTerms / Math.max(1, s.terms.length) * 100) + "%";
    $("#quizMode").textContent = (s.mode === "review" ? "错题回顾 · " : "") +
      (q.kind === "spelling" ? "拼写轮" : "释义轮");

    const typeLabel = q.isRetry
      ? "回炉 · 第 " + (q.retryNo || 1) + " 次"
      : (q.type === "spell" ? "拼写题" : "选择题");
    const promptSub = q.type === "spell"
      ? "根据中文写出英文术语 · 不区分大小写"
      : "选择最准确的中文释义";

    let body = '<div class="question-kicker">' +
      '<span class="q-chip">' + (q.kind === "spelling" ? "中 → EN" : "EN → 中") + "</span>" +
      '<span class="q-type' + (q.isRetry ? " is-retry" : "") + '">' + typeLabel + "</span>" +
      '<span class="q-index">Q ' + pad(s.index + 1) + "</span>" +
      "</div>" +
      (q.isRetry ? '<p class="retry-banner">这个词刚才答错了。先记住正确答案，5 题后再来一次。</p>' : "") +
      '<h2 class="question-prompt">' + esc(q.prompt) + "</h2>" +
      '<p class="question-sub">' + promptSub + "</p>";

    if (q.type === "choice") {
      body += '<div class="options">' + q.options.map(function (opt, i) {
        let cls = "option";
        if (q.answered) {
          if (i === q.correctIndex) cls += " is-correct";
          else if (i === q.selected) cls += " is-wrong";
          else cls += " is-dimmed";
        }
        return '<button class="' + cls + '" data-option="' + i + '"' + (q.answered ? " disabled" : "") + ">" +
          '<span class="option-key">' + String.fromCharCode(65 + i) + "</span>" +
          "<span>" + esc(opt) + "</span>" +
        "</button>";
      }).join("") + "</div>";
    } else {
      body += '<div class="spell-wrap">' +
        '<label class="spell-label" for="spellInput">YOUR ANSWER</label>' +
        '<input class="spell-input" id="spellInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="type the term…"' +
          ' value="' + esc(q.response) + '"' + (q.answered ? " disabled" : "") + ">" +
        '<div class="spell-hint-row">' +
          '<span class="spell-hint">首字母 <b>' + esc((q.term.en.charAt(0) || "").toUpperCase()) + "</b> · 共 <b>" + cleanAnswer(q.term.en).length + "</b> 个字母</span>" +
          '<span class="spell-caret-note"><i></i> 输入时光标闪烁</span>' +
        "</div>" +
      "</div>";
    }

    if (q.answered) body += feedbackHtml(q);
    const quizBody = $("#quizBody");
    quizBody.innerHTML = body;
    quizBody.scrollTop = q.answered ? quizBody.scrollHeight : 0;

    if (q.type === "choice" && !q.answered) {
      $$("#quizBody .option").forEach(function (btn) {
        btn.addEventListener("click", function () {
          answerChoice(Number(btn.getAttribute("data-option")));
        });
      });
    }
    if (q.type === "spell" && !q.answered) {
      const input = $("#spellInput");
      if (input) {
        input.addEventListener("input", function () { q.response = input.value; });
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); checkSpell(); }
        });
        setTimeout(function () { input.focus(); }, 30);
      }
    }

    renderQuizFooter();
  }

  function feedbackHtml(q) {
    const s = quizSession;
    const r = s.termResults[q.term.id];
    const bothPassed = r && r.meaning && r.spelling;
    if (q.isCorrect) {
      return '<div class="feedback correct"><b>' + (q.kind === "spelling" ? "拼写正确。" : "释义正确。") + "</b> " +
        esc(q.term.en) + " — " + esc(q.term.zh) +
        '<span class="feedback-note">' + esc(q.term.note) +
          (bothPassed ? " · 这个词的两关都通过了。" : " · 还要通过另一关。") + "</span></div>";
    }
    return '<div class="feedback wrong"><b>再记一次：</b> ' +
      esc(q.term.en) + " — " + esc(q.term.zh) +
      '<span class="feedback-note">' + esc(q.term.note) + " · 已放入回炉队列，5 题后再次出现。</span></div>";
  }

  function renderQuizFooter() {
    if (!quizSession) return;
    const s = quizSession;
    const q = s.questions[s.index];
    if (!q) return;
    const footer = $("#quizFooter");
    if (!footer) return;

    let left;
    if (q.answered) {
      const r = s.termResults[q.term.id];
      const bothPassed = r && r.meaning && r.spelling;
      left = q.isCorrect
        ? (bothPassed ? "这个词已完全通过。" : "这一关通过，继续另一关。")
        : "已放入回炉队列，约 5 题后再次出现。";
    } else if (q.type === "choice") {
      left = "按 1–4 快速选择 · Enter 继续";
    } else {
      left = "输入后按 Enter 检查";
    }

    let right;
    if (q.answered) {
      const isLast = s.index >= s.questions.length - 1;
      right = '<button class="btn btn-primary btn-answer" id="nextQuestion">' + (isLast ? "查看结果" : "下一题") + " →</button>";
    } else if (q.type === "spell") {
      right = '<button class="btn btn-primary btn-answer" id="checkSpell">检查答案</button>';
    } else {
      right = '<button class="btn btn-primary btn-answer" disabled>选择答案</button>';
    }

    footer.innerHTML = '<span class="footer-left-note">' + left + "</span>" +
      '<span class="footer-right">' + right + "</span>";

    const next = $("#nextQuestion");
    if (next) next.addEventListener("click", nextQuestion);
    const check = $("#checkSpell");
    if (check) check.addEventListener("click", checkSpell);
  }

  function answerChoice(index) {
    if (!quizSession) return;
    const q = quizSession.questions[quizSession.index];
    if (!q || q.answered) return;
    q.answered = true;
    q.selected = index;
    q.isCorrect = index === q.correctIndex;
    recordAnswer(q);
    renderQuestion();
  }

  function checkSpell() {
    if (!quizSession) return;
    const q = quizSession.questions[quizSession.index];
    if (!q || q.answered) return;
    const input = $("#spellInput");
    if (!input) return;
    q.response = input.value;
    if (!q.response.trim()) {
      input.focus();
      toast("先输入一个答案");
      return;
    }
    q.answered = true;
    q.isCorrect = cleanAnswer(q.response) === cleanAnswer(q.answer);
    recordAnswer(q);
    renderQuestion();
  }

  function bumpErrorStat(id, correct) {
    const st = state.errorStats[id] || { attempts: 0, wrong: 0 };
    st.attempts++;
    if (!correct) st.wrong++;
    state.errorStats[id] = st;
  }

  function scheduleRetry(q) {
    const s = quizSession;
    if (!s) return;
    const retry = makeQuestion(
      q.term,
      q.kind === "spelling" ? "zh2en" : "en2zh",
      q.kind === "spelling" ? "spell" : "choice",
      s.pool,
      q.kind
    );
    retry.isRetry = true;
    retry.retryNo = (q.retryNo || 0) + 1;
    // Put it after the next five questions, or at the end if the queue is shorter.
    const at = Math.min(s.index + 6, s.questions.length);
    s.questions.splice(at, 0, retry);
    s.retriesScheduled++;
  }

  function recordAnswer(q) {
    const s = quizSession;
    const id = q.term.id;
    const r = s.termResults[id];
    s.answers.push({ id: id, correct: q.isCorrect, kind: q.kind, retry: q.isRetry });
    s.termAttempts[id] = (s.termAttempts[id] || 0) + 1; // eslint-disable-line
    if (q.kind === "meaning") r.meaningAttempts++;
    else r.spellingAttempts++;

    if (!q.isRetry && q.isCorrect) s.firstCorrect++;
    bumpErrorStat(id, q.isCorrect);

    state.totals.answered = (state.totals.answered || 0) + 1;
    if (q.isCorrect) {
      s.correct++;
      state.totals.correct = (state.totals.correct || 0) + 1;
      r[q.kind] = true;
    } else {
      s.errorById[id] = (s.errorById[id] || 0) + 1;
      if (!s.failedParts[id]) s.failedParts[id] = {};
      s.failedParts[id][q.kind] = true;
      scheduleRetry(q);
    }
    save();
    updateChrome();
  }

  function nextQuestion() {
    if (!quizSession) return;
    if (quizSession.index >= quizSession.questions.length - 1) {
      finishQuiz();
      return;
    }
    quizSession.index++;
    renderQuestion();
    setTimeout(function () {
      const focusEl = $("#quizBody .option") || $("#spellInput") || $("#nextQuestion");
      if (focusEl) focusEl.focus({ preventScroll: true });
    }, 40);
  }

  function firstPassPercent(s) {
    return Math.round(s.firstCorrect / Math.max(1, s.firstTotal) * 100);
  }

  function finishQuiz() {
    if (!quizSession || quizSession.finished) return;
    const s = quizSession;

    const incomplete = s.terms.filter(function (t) {
      const r = s.termResults[t.id];
      return !r || !r.meaning || !r.spelling;
    });
    if (incomplete.length) {
      const start = s.questions.length;
      incomplete.forEach(function (t) {
        const r = s.termResults[t.id];
        if (!r.meaning) s.questions.push(makeQuestion(t, "en2zh", "choice", s.pool, "meaning"));
        if (!r.spelling) s.questions.push(makeQuestion(t, "zh2en", "spell", s.pool, "spelling"));
      });
      s.index = start;
      toast("还有未通过的词，继续回炉");
      renderQuestion();
      return;
    }

    s.finished = true;
    const pct = firstPassPercent(s);
    const now = new Date().toISOString();

    s.terms.forEach(function (t) {
      const r = s.termResults[t.id];
      state.mastery[t.id] = { meaning: !!r.meaning, spelling: !!r.spelling, at: now };
      const errs = s.errorById[t.id] || 0;
      if (errs > 0) {
        const parts = Object.keys(s.failedParts[t.id] || {}).sort();
        markWrong(t, errs, parts);
      }
      if (s.mode === "review" || errs > 0) markResolved(t.id);
    });

    if (s.mode === "normal" && s.day) {
      const p = getProgress(s.day);
      p.completed = true;
      p.attempts = (p.attempts || 0) + 1;
      p.best = Math.max(p.best || 0, pct);
      p.lastAt = now;
      state.progress[s.day] = p;
    }

    save();
    updateChrome();
    renderHome();
    renderWrong();
    renderResult(pct);
    if (pct >= 80) spawnConfetti();
  }

  function renderResult(pct) {
    const s = quizSession;
    const isReview = s.mode === "review";
    const errorIds = Object.keys(s.errorById).filter(function (id) { return s.errorById[id] > 0; });
    const retryTerms = errorIds.map(function (id) { return TERM_BY_ID.get(id); }).filter(Boolean);
    const remaining = isReview ? openWrongItems().length : 0;
    const perfect = errorIds.length === 0;

    $("#quizCount").textContent = s.terms.length + " / " + s.terms.length + " 词";
    $("#quizProgressBar").style.width = "100%";

    let headline;
    let copy;
    if (isReview) {
      headline = remaining === 0 ? "错题清零。" : "本次订正完成。";
      copy = remaining === 0
        ? "所有未订正错题都通过了释义与拼写两关，错题本已经清空。"
        : "本次回顾的词已全部通过；错题本里还有 " + remaining + " 个未订正条目。";
    } else if (perfect) {
      headline = "一次全过。";
      copy = "所有 " + s.terms.length + " 个词都一次通过了释义与拼写，没有触发回炉。";
    } else if (pct >= 80) {
      headline = "全部通过。";
      copy = "首答正确率 " + pct + "%。有 " + errorIds.length + " 个词进入回炉队列，最终都通过了释义与拼写。";
    } else {
      headline = "全部通过。";
      copy = "首答正确率 " + pct + "%。这一轮有 " + errorIds.length + " 个词需要回炉，但最后都过了两关。";
    }

    const actionReview = errorIds.length
      ? '<button class="btn btn-primary" id="resultReview">再练本次错词（' + errorIds.length + "）</button>"
      : "";
    const actionRetry = '<button class="btn btn-ghost" id="resultRetry">' + (isReview ? "再回顾一轮" : "再测一轮") + "</button>";
    const actionClose = '<button class="btn btn-ghost" id="resultClose">' + (isReview ? (s.returnView === "study" && s.day ? "返回学习" : "返回错题本") : (s.source === "all" ? "返回总览" : "返回学习")) + "</button>";

    const board = errorIds.map(function (id) {
      const term = TERM_BY_ID.get(id);
      const wrong = s.errorById[id];
      const attempts = s.termAttempts[id] || 0;
      return {
        term: term,
        wrong: wrong,
        attempts: attempts,
        rate: attempts ? Math.round(wrong / attempts * 100) : 0
      };
    }).sort(function (a, b) {
      if (b.wrong !== a.wrong) return b.wrong - a.wrong;
      return b.rate - a.rate;
    });

    const boardHtml = board.length
      ? '<div class="result-board"><div class="result-board-head"><span>本次错误率排行榜</span><span>错 / 作答</span></div>' +
          board.slice(0, 8).map(function (e, i) {
            return '<div class="result-board-row">' +
              '<span class="result-rank">' + pad(i + 1) + '</span>' +
              '<span class="result-word"><b>' + esc(e.term.en) + '</b><small>' + esc(e.term.zh) + '</small></span>' +
              '<span class="result-board-bar"><i style="width:' + Math.max(10, e.rate) + '%"></i></span>' +
              '<span class="result-board-count">' + e.wrong + " / " + e.attempts + "</span>" +
            "</div>";
          }).join("") + "</div>"
      : '<div class="result-perfect">' + (isReview ? "本次回顾没有触发回炉。" : "没有触发回炉。可以进入下一日，或去工艺图鉴把词放回流程。") + "</div>";

    $("#quizBody").innerHTML = '<div class="result-wrap">' +
      '<div class="result-ring-wrap">' +
        '<svg class="progress-ring" viewBox="0 0 120 120" aria-hidden="true">' +
          '<circle class="ring-bg" cx="60" cy="60" r="52"></circle>' +
          '<circle class="ring-fg" cx="60" cy="60" r="52" style="stroke-dashoffset:' + (326.73 * (1 - pct / 100)) + '"></circle>' +
        "</svg>" +
        '<div class="result-score"><strong>' + pct + '</strong><span>FIRST PASS</span></div>' +
      "</div>" +
      "<h2>" + headline + "</h2>" +
      "<p>" + copy + "</p>" +
      '<div class="result-stats">' +
        '<span><b>' + s.terms.length + " / " + s.terms.length + "</b>完全掌握</span>" +
        '<span><b>' + s.firstCorrect + " / " + s.firstTotal + "</b>首答正确</span>" +
        '<span><b>' + s.retriesScheduled + "</b>次回炉</span>" +
      "</div>" +
      '<div class="result-actions">' + actionReview + actionRetry + actionClose + "</div>" +
      boardHtml +
    "</div>";

    $("#quizFooter").innerHTML = '<span class="footer-left-note">' + (isReview ? "订正结果已保存到本地" : "成绩与掌握度已保存 · 本地浏览器") + '</span><span class="footer-right"><button class="btn btn-ghost btn-small" id="resultFooterClose">关闭</button></span>';

    const close = $("#resultClose");
    if (close) close.addEventListener("click", function () { closeQuiz(true); });
    const footClose = $("#resultFooterClose");
    if (footClose) footClose.addEventListener("click", function () { closeQuiz(true); });
    const retry = $("#resultRetry");
    if (retry) retry.addEventListener("click", function () {
      const mode = s.mode;
      const terms = s.terms.slice();
      const source = s.source;
      const day = s.day;
      const returnView = s.returnView;
      const title = s.title;
      const pool = s.pool;
      closeQuiz(true);
      setTimeout(function () {
        if (mode === "review") {
          const ids = openWrongItems().map(function (w) { return w.id; });
          startReview(ids.length ? ids : terms.map(function (t) { return t.id; }), "wrong");
        } else {
          startTermsQuiz(terms, {
            mode: "normal",
            source: source,
            day: day,
            returnView: returnView,
            title: title,
            pool: pool
          });
        }
      }, 80);
    });
    const review = $("#resultReview");
    if (review) review.addEventListener("click", function () {
      const ids = errorIds.slice();
      const returnView = s.returnView;
      const day = s.day;
      closeQuiz(true);
      setTimeout(function () { startReview(ids, returnView, day); }, 80);
    });
  }

  /* ---------------- Wrong helpers ---------------- */

  function markWrong(term, count, parts) {
    const prev = state.wrong[term.id] || {
      id: term.id,
      day: term.day,
      count: 0,
      firstWrongAt: new Date().toISOString()
    };
    prev.day = term.day;
    prev.count = (prev.count || 0) + (count || 1);
    prev.lastWrongAt = new Date().toISOString();
    prev.resolved = false;
    prev.resolvedAt = null;
    prev.parts = parts || prev.parts || [];
    state.wrong[term.id] = prev;
  }

  function markResolved(id) {
    const w = state.wrong[id];
    if (!w) return;
    w.resolved = true;
    w.resolvedAt = new Date().toISOString();
    save();
    updateChrome();
  }

  /* ---------------- Confetti ---------------- */

  function spawnConfetti() {
    const layer = $("#confettiLayer");
    if (!layer) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#d97757", "#1f1e1b", "#e7c7b8", "#697b63", "#f0d9a8"];
    for (let i = 0; i < 34; i++) {
      const s = document.createElement("span");
      s.className = "confetti";
      s.style.left = Math.random() * 100 + "%";
      s.style.top = (-10 - Math.random() * 30) + "px";
      s.style.background = colors[Math.floor(Math.random() * colors.length)];
      s.style.setProperty("--dx", (Math.random() * 180 - 90) + "px");
      s.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
      s.style.animationDelay = (Math.random() * 0.35) + "s";
      s.style.animationDuration = (1.1 + Math.random() * 0.8) + "s";
      layer.appendChild(s);
      setTimeout(function () { s.remove(); }, 2400);
    }
  }

  /* ---------------- Routing & events ---------------- */

  function goView(name, opts) {
    opts = opts || {};
    if (name === "study") currentDay = opts.day || currentDay || recommendedDay();
    currentView = name;

    $$(".view").forEach(function (v) { v.classList.remove("is-visible"); });
    const view = $("#" + name + "View");
    if (view) view.classList.add("is-visible");

    $$(".nav-link").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === name);
    });

    if (name === "home") renderHome();
    if (name === "study") renderStudy(currentDay);
    if (name === "process") renderProcess();
    if (name === "equipment") renderEquipment();
    if (name === "wrong") renderWrong();

    try {
      const hash = name === "study" ? "study-" + currentDay : name;
      history.replaceState(null, "", "#" + hash);
    } catch (err) { /* ignore */ }

    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function bindEvents() {
    document.addEventListener("click", function (e) {
      const viewBtn = e.target.closest("[data-view]");
      if (viewBtn) {
        e.preventDefault();
        goView(viewBtn.getAttribute("data-view"));
        return;
      }
      const brand = e.target.closest("[data-view-link]");
      if (brand) {
        e.preventDefault();
        goView(brand.getAttribute("data-view-link"));
        return;
      }
      const dayBtn = e.target.closest("[data-day]");
      if (dayBtn) {
        e.preventDefault();
        goView("study", { day: Number(dayBtn.getAttribute("data-day")) });
        return;
      }
      const reviewBtn = e.target.closest("[data-review-id]");
      if (reviewBtn) {
        startReview([reviewBtn.getAttribute("data-review-id")], "wrong");
        return;
      }
      const equipBtn = e.target.closest("[data-equip-group]");
      if (equipBtn) {
        equipGroup = equipBtn.getAttribute("data-equip-group");
        renderEquipment();
        return;
      }
      const wrongBtn = e.target.closest("[data-wrong-filter]");
      if (wrongBtn) {
        wrongFilter = wrongBtn.getAttribute("data-wrong-filter");
        renderWrong();
        return;
      }
    });

    const heroStart = $("#heroStart");
    if (heroStart) heroStart.addEventListener("click", function () {
      goView("study", { day: recommendedDay() });
    });
    const continueLink = $("#continueLink");
    if (continueLink) continueLink.addEventListener("click", function () {
      goView("study", { day: recommendedDay() });
    });
    const heroFree = $("#heroFree");
    if (heroFree) heroFree.addEventListener("click", function () { openScope("all", null); });
    const openScopeBtn = $("#openScopeBtn");
    if (openScopeBtn) openScopeBtn.addEventListener("click", function () { openScope("daily", currentDay); });

    const closeScopeBtn = $("#closeScope");
    if (closeScopeBtn) closeScopeBtn.addEventListener("click", closeScope);
    const scopeCancel = $("#scopeCancel");
    if (scopeCancel) scopeCancel.addEventListener("click", closeScope);
    const scopeModal = $("#scopeModal");
    if (scopeModal) scopeModal.addEventListener("click", function (e) {
      if (e.target === scopeModal) closeScope();
    });
    const scopeSources = $("#scopeSources");
    if (scopeSources) scopeSources.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-scope-source]");
      if (!btn) return;
      scopeSource = btn.getAttribute("data-scope-source");
      if (scopeSource === "daily") scopeDay = currentDay || 1;
      renderScope();
    });
    const scopeDayGrid = $("#scopeDayGrid");
    if (scopeDayGrid) scopeDayGrid.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-scope-day]");
      if (!btn) return;
      scopeDay = Number(btn.getAttribute("data-scope-day"));
      renderScope();
    });
    const scopeQuantityGrid = $("#scopeQuantityGrid");
    if (scopeQuantityGrid) scopeQuantityGrid.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-scope-qty]");
      if (!btn) return;
      const val = btn.getAttribute("data-scope-qty");
      scopeQty = val === "all" ? "all" : Number(val);
      renderScope();
    });
    const scopeStart = $("#scopeStart");
    if (scopeStart) scopeStart.addEventListener("click", startScopeQuiz);

    const startQuiz = $("#studyStartQuiz");
    if (startQuiz) startQuiz.addEventListener("click", function () { startNormalQuiz(currentDay); });
    const endQuiz = $("#studyEndQuiz");
    if (endQuiz) endQuiz.addEventListener("click", function () { startNormalQuiz(currentDay); });

    const termFilters = $("#termFilters");
    if (termFilters) termFilters.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-track]");
      if (!btn) return;
      termTrackFilter = btn.getAttribute("data-track");
      $$("#termFilters .filter-pill").forEach(function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-track") === termTrackFilter);
      });
      renderTermGrid(currentDay);
    });

    const blurToggle = $("#blurToggle");
    if (blurToggle) blurToggle.addEventListener("click", function () {
      state.blur = !state.blur;
      save();
      blurToggle.setAttribute("aria-pressed", state.blur ? "true" : "false");
      blurToggle.innerHTML = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.3"/></svg>' + (state.blur ? "显示中文" : "遮挡中文");
      renderTermGrid(currentDay);
    });

    const termGrid = $("#termGrid");
    if (termGrid) termGrid.addEventListener("click", function (e) {
      const card = e.target.closest(".term-card.is-blurred");
      if (card) card.classList.remove("is-blurred");
    });

    const reviewAll = $("#reviewAllBtn");
    if (reviewAll) reviewAll.addEventListener("click", function () {
      const ids = openWrongItems().map(function (w) { return w.id; });
      if (!ids.length) return toast("没有未订正错题");
      startReview(ids, "wrong");
    });

    const close = $("#closeQuiz");
    if (close) close.addEventListener("click", function () { closeQuiz(false); });

    const modal = $("#quizModal");
    if (modal) modal.addEventListener("click", function (e) {
      if (e.target === modal) closeQuiz(false);
    });

    const reset = $("#resetBtn");
    if (reset) reset.addEventListener("click", function () {
      askConfirm({
        title: "重置所有学习记录？",
        text: "进度、错题本和六日计划起点都会清空。此操作不可撤销。",
        okLabel: "确认重置",
        cancelLabel: "保留记录",
        onConfirm: function () {
          localStorage.removeItem(STORAGE_KEY);
          state = freshState();
          termTrackFilter = "all";
          wrongFilter = "all";
          equipGroup = "全部";
          renderHome();
          renderWrong();
          goView("home");
          toast("学习记录已重置");
        }
      });
    });

    const confirmCancel = $("#confirmCancel");
    if (confirmCancel) confirmCancel.addEventListener("click", function () { closeConfirm(false); });
    const confirmOk = $("#confirmOk");
    if (confirmOk) confirmOk.addEventListener("click", function () { closeConfirm(true); });
    const confirmModal = $("#confirmModal");
    if (confirmModal) confirmModal.addEventListener("click", function (e) {
      if (e.target === confirmModal) closeConfirm(false);
    });

    document.addEventListener("keydown", function (e) {
      const scopeModalEl = $("#scopeModal");
      if (e.key === "Escape" && scopeModalEl && !scopeModalEl.hidden) {
        e.preventDefault();
        closeScope();
        return;
      }
      if (scopeModalEl && !scopeModalEl.hidden) return;
      if (e.key === "Escape" && confirmModal && !confirmModal.hidden) {
        e.preventDefault();
        closeConfirm(false);
        return;
      }
      if (confirmModal && !confirmModal.hidden) return;
      if (!quizSession) return;
      if (e.key === "Escape") { closeQuiz(false); return; }
      if (quizSession.finished) return;
      const q = quizSession.questions[quizSession.index];
      if (!q) return;

      if (q.type === "spell" && e.target && e.target.id === "spellInput") return;

      if (!q.answered) {
        if (q.type === "choice" && /^[1-4]$/.test(e.key)) {
          e.preventDefault();
          const idx = Number(e.key) - 1;
          if (idx < q.options.length) answerChoice(idx);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        nextQuestion();
      }
    });
  }

  /* ---------------- Init ---------------- */

  function init() {
    bindEvents();
    renderHome();
    renderProcess();
    renderEquipment();
    renderWrong();
    startTypewriter();
    updateChrome();

    const hash = (location.hash || "").replace(/^#/, "");
    if (hash.indexOf("study-") === 0) {
      const n = Number(hash.split("-")[1]);
      if (n >= 1 && n <= 6) { goView("study", { day: n }); return; }
    }
    if (["home", "process", "equipment", "wrong"].indexOf(hash) !== -1) {
      goView(hash);
      return;
    }
    goView("home");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
