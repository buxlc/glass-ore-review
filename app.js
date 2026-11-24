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
  let wrongFilter = "open";
  let quizSession = null;
  let toastTimer = null;
  let confirmCallback = null;

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* private mode */ }
  }

  function getProgress(day) {
    return state.progress[day] || { best: 0, attempts: 0, completed: false, lastAt: null };
  }

  function completedDays() {
    return DATA.days.filter(function (d) { return getProgress(d.n).completed; }).length;
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
    for (let i = 1; i <= 6; i++) {
      if (!getProgress(i).completed) return i;
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
    if (nextTitle) nextTitle.textContent = recDay.title;
    if (nextMeta) {
      nextMeta.textContent = "DAY " + pad(rec) + " · " + dayTermCount(rec) + " 个术语 · 约 " + (rec === 6 ? 22 : 28) + " 分钟";
    }
    if (startLabel) {
      startLabel.textContent = completedDays() === 6 ? "全库回测" : "开始 DAY " + pad(rec);
    }

    const dots = $("#weekDots");
    if (dots) {
      dots.innerHTML = DATA.days.map(function (d) {
        const p = getProgress(d.n);
        const cls = "week-dot" + (p.completed ? " is-done" : "") + (d.n === rec ? " is-current" : "");
        return '<button class="' + cls + '" data-day="' + d.n + '" aria-label="DAY ' + pad(d.n) + " " + esc(d.title) + '">' +
          "<i></i><span>" + pad(d.n) + "</span></button>";
      }).join("");
    }

    const grid = $("#dayGrid");
    if (!grid) return;
    grid.innerHTML = DATA.days.map(function (d) {
      const p = getProgress(d.n);
      const isDone = !!p.completed;
      const isCurrent = d.n === rec && !isDone;
      const cls = "day-card" + (isDone ? " is-done" : "") + (isCurrent ? " is-current" : "");
      const status = isDone
        ? '<span class="day-status done">✓ 已完成</span>'
        : isCurrent
          ? '<span class="day-status current">● 进行中</span>'
          : '<span class="day-status">未开始</span>';
      const best = p.best ? p.best + "%" : "";
      return '<button class="' + cls + '" data-day="' + d.n + '">' +
        '<span class="day-card-top">' +
          '<span class="day-kicker">' + d.kicker + " · " + shortDate(scheduleDate(d.n)) + '</span>' +
          status +
        "</span>" +
        "<h3>" + esc(d.title) + "</h3>" +
        '<span class="day-en">' + esc(d.en) + "</span>" +
        '<span class="day-focus">' + esc(d.focus) + "</span>" +
        '<span class="day-card-bottom">' +
          '<span><span class="day-count">' + dayTermCount(d.n) + " 术语" + (best ? " · 最好 " + best : "") + '</span>' +
          '<span class="day-bar"><span style="width:' + (isDone ? 100 : 0) + '%"></span></span></span>' +
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
      const p = getProgress(d.n);
      const cls = "day-switch" + (d.n === currentDay ? " is-active" : "") + (p.completed ? " is-done" : "");
      return '<button class="' + cls + '" data-day="' + d.n + '" role="tab" aria-selected="' + (d.n === currentDay) + '" aria-label="DAY ' + pad(d.n) + " " + esc(d.title) + '">' + pad(d.n) + "</button>";
    }).join("");
  }

  function renderStudy(day) {
    currentDay = day;
    state.lastDay = day;
    save();

    const d = DATA.days[day - 1];
    if (!d) return;
    const p = getProgress(day);
    const wc = dayWrongItems(day).length;
    const sideWrong = day === 6 ? openWrongItems().length : wc;

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
          '<div class="side-stat"><strong>' + (p.best ? p.best + "%" : "—") + '</strong><span>Best score</span></div>' +
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
      if (endH) endH.textContent = day === 6 ? "用 20 道混合题，把六天的词连起来。" : "看完了，就让题目来告诉你记住没有。";
      if (endP) endP.textContent = day === 6 ? "全库随机抽题，覆盖 156 个术语与工艺概念；约 7 分钟。" : "12 道题，约 4 分钟。错题会自动进入“今日错题回顾”。";
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
          '<p>20 道全库混合题，覆盖 156 个术语；再用工艺图鉴和设备速查，把零散记忆接回流程。</p>' +
          '<div class="day6-actions">' +
            '<button class="btn btn-primary" id="day6Quiz">开始 20 题混合测 →</button>' +
            '<button class="btn btn-ghost" data-view="equipment">打开设备速查</button>' +
          "</div>" +
        "</div>" +
        '<div class="day6-scope">' +
          '<div class="scope-head"><span>回测范围</span><span>最好成绩</span><span>状态</span></div>' +
          DATA.days.slice(0, 5).map(function (d) {
            const p = getProgress(d.n);
            return '<button class="scope-row" data-day="' + d.n + '">' +
              '<span><b>DAY ' + pad(d.n) + '</b> ' + esc(d.focus) + "</span>" +
              "<span>" + (p.best ? p.best + "%" : "—") + "</span>" +
              '<span class="' + (p.completed ? "scope-done" : "scope-todo") + '">' + (p.completed ? "已复习" : "待复习") + "</span>" +
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
      return '<article class="term-card' + blurred + '" data-term-id="' + t.id + '">' +
        '<div class="term-card-top">' +
          '<span class="term-index">' + pad(idx) + " / " + pad(dayTermCount(day)) + "</span>" +
          '<span class="term-track ' + t.track + '">' + (t.track === "glass" ? "EN" : "MINING") + "</span>" +
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
      const feature = p.id === "p12" ? " is-feature" : "";
      return '<article class="process-card' + feature + '">' +
        '<div class="process-top"><span class="process-tag">' + esc(p.tag) + '</span><span class="process-no">' + p.no + "</span></div>" +
        "<h2>" + esc(p.title) + "</h2>" +
        '<p class="process-en">' + esc(p.en) + "</p>" +
        '<p class="process-summary">' + esc(p.summary) + "</p>" +
        '<ul class="process-points">' + p.points.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
        '<div class="process-equip">' + p.equip.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div>" +
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
        ? ["还没有已订正的错题。", "答对回顾题后，条目会移到这里，历史仍会保留。"]
        : wrongFilter === "today"
          ? ["今天还没有错题。", "去做一组自测，错题会自动出现在这里。"]
          : ["错题本是空的。", "这不是坏事。做完任一日的自测后，答错的术语会自动收进来。"];
      el.innerHTML = '<div class="wrong-empty">' +
        '<svg viewBox="0 0 48 48" width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="24" cy="24" r="17"/><path d="M17 24l5 5 10-11"/></svg>' +
        "<h3>" + copy[0] + "</h3><p>" + copy[1] + "</p></div>";
      return;
    }

    el.innerHTML = list.map(function (w) {
      const term = TERM_BY_ID.get(w.id);
      if (!term) return "";
      return '<div class="wrong-row' + (w.resolved ? " is-resolved" : "") + '">' +
        '<span class="wrong-status-dot" aria-hidden="true">✓</span>' +
        '<div><span class="wrong-term">' + esc(term.en) + '</span><span class="wrong-day">DAY ' + pad(w.day) + " · " + (w.resolved ? "已订正" : "未订正") + "</span></div>" +
        '<span class="wrong-zh">' + esc(term.zh) + "</span>" +
        '<span class="wrong-meta">错 ' + w.count + ' 次<br>' + dateTimeLabel(w.lastWrongAt) + "</span>" +
        '<span class="wrong-action"><button class="btn btn-ghost" data-review-id="' + w.id + '">再做一次</button></span>' +
      "</div>";
    }).join("");
  }

  /* ---------------- Question generation ---------------- */

  function cleanAnswer(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^a-z0-9]/g, "");
  }

  function canSpell(term) {
    const en = term.en;
    return /^[A-Za-z][A-Za-z\s-]*$/.test(en) &&
      en.length <= 24 &&
      en.split(/\s+/).length <= 2;
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

  function makeQuestion(term, direction, type, pool) {
    const isSpell = type === "spell";
    const prompt = direction === "en2zh" ? term.en : term.zh;
    const answer = direction === "en2zh" ? term.zh : term.en;
    const options = isSpell ? [] : makeOptions(term, direction, pool);
    const correctIndex = isSpell ? -1 : options.indexOf(answer);
    return {
      term: term,
      direction: direction,
      type: type,
      prompt: prompt,
      answer: answer,
      options: options,
      correctIndex: correctIndex,
      answered: false,
      selected: null,
      isCorrect: null,
      response: ""
    };
  }

  function buildNormalQuestions(pool, count) {
    const english = shuffle(pool.filter(function (t) { return t.track === "glass"; }));
    const mining = shuffle(pool.filter(function (t) { return t.track === "mining"; }));
    const englishQuota = clamp(Math.round(count * english.length / Math.max(1, pool.length)), 1, count - 1);
    const selected = shuffle(english.slice(0, englishQuota).concat(mining.slice(0, count - englishQuota)));

    // If one track is short, fill from the other so the quiz always has `count` questions.
    if (selected.length < count) {
      const rest = shuffle(pool.filter(function (t) { return selected.indexOf(t) === -1; }));
      selected.push.apply(selected, rest.slice(0, count - selected.length));
    }

    const spellable = shuffle(selected.filter(canSpell)).slice(0, Math.min(3, selected.length));
    const spellIds = new Set(spellable.map(function (t) { return t.id; }));
    const questions = selected.map(function (t, i) {
      if (spellIds.has(t.id)) return makeQuestion(t, "zh2en", "spell", pool);
      const direction = i % 3 === 0 ? "zh2en" : "en2zh";
      return makeQuestion(t, direction, "choice", pool);
    });
    return shuffle(questions);
  }

  function startNormalQuiz(day) {
    const pool = day === 6 ? TERMS.slice() : dayTerms(day);
    const count = day === 6 ? 20 : 12;
    if (!pool.length) return toast("这一日还没有可测试的术语");
    const questions = buildNormalQuestions(pool, Math.min(count, pool.length));
    openQuiz({
      mode: "normal",
      day: day,
      questions: questions,
      index: 0,
      correct: 0,
      answers: [],
      wrongIds: [],
      finished: false,
      returnView: "study"
    });
  }

  function startReview(ids, returnView, day) {
    const cleanIds = unique(ids).filter(function (id) { return TERM_BY_ID.has(id); });
    if (!cleanIds.length) return toast("没有需要回顾的错题");
    const questions = cleanIds.map(function (id, i) {
      return makeQuestion(TERM_BY_ID.get(id), i % 2 === 0 ? "en2zh" : "zh2en", "choice", TERMS);
    });
    openQuiz({
      mode: "review",
      day: day || null,
      questions: shuffle(questions),
      index: 0,
      correct: 0,
      answers: [],
      wrongIds: [],
      finished: false,
      returnView: returnView || "wrong"
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
      : "DAY " + pad(session.day);
    $("#quizMode").textContent = session.mode === "review"
      ? "错题回顾"
      : (session.day === 6 ? "全库混合测" : "本日自测");

    renderQuestion();
    setTimeout(function () {
      const focusEl = $("#quizBody .option") || $("#spellInput") || $("#closeQuiz");
      if (focusEl) focusEl.focus();
    }, 60);
  }

  function closeQuiz(force) {
    if (!quizSession) return;
    const session = quizSession;
    if (!force && !session.finished && session.answers.length > 0) {
      askConfirm({
        title: "退出本次自测？",
        text: "已作答的题目不会计入六日完成进度；答错的术语已经进入错题本。",
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

    $("#quizCount").textContent = (s.index + 1) + " / " + s.questions.length;
    $("#quizProgressBar").style.width = ((s.index + 1) / s.questions.length * 100) + "%";

    const dirLabel = q.direction === "en2zh" ? "EN → 中" : "中 → EN";
    const typeLabel = q.type === "spell" ? "拼写题" : "选择题";
    const promptSub = q.type === "spell"
      ? "根据中文写出英文术语 · 不区分大小写"
      : q.direction === "en2zh"
        ? "选择最准确的中文释义"
        : "选择对应的英文术语";

    let body = '<div class="question-kicker">' +
      '<span class="q-chip">' + dirLabel + "</span>" +
      '<span class="q-type">' + typeLabel + "</span>" +
      '<span class="q-index">Q ' + pad(s.index + 1) + "</span>" +
      "</div>" +
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
          '<span class="spell-caret-note"><i></i> cursor blinks while you type</span>' +
        "</div>" +
      "</div>";
    }

    if (q.answered) body += feedbackHtml(q);
    $("#quizBody").innerHTML = body;

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
    const isReview = quizSession && quizSession.mode === "review";
    if (q.isCorrect) {
      return '<div class="feedback correct"><b>' + (isReview ? "订正成功。" : "正确。") + "</b> " +
        esc(q.term.en) + " — " + esc(q.term.zh) +
        '<span class="feedback-note">' + esc(q.term.note) + (isReview ? " · 已移出“未订正”。" : "") + "</span></div>";
    }
    return '<div class="feedback wrong"><b>再记一次：</b> ' +
      esc(q.term.en) + " — " + esc(q.term.zh) +
      '<span class="feedback-note">' + esc(q.term.note) + (isReview ? " · 仍保留在错题本，稍后再来。" : " · 已加入错题本。") + "</span></div>";
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
      left = q.isCorrect ? "答对了。保持这个节奏。" : "错题已记录，回顾时会再遇到它。";
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

  function recordAnswer(q) {
    const s = quizSession;
    s.answers.push({ id: q.term.id, correct: q.isCorrect });
    state.totals.answered = (state.totals.answered || 0) + 1;
    if (q.isCorrect) {
      s.correct++;
      state.totals.correct = (state.totals.correct || 0) + 1;
      if (s.mode === "review") markResolved(q.term.id);
    } else {
      s.wrongIds.push(q.term.id);
      markWrong(q.term);
    }
    save();
    updateChrome();
    if (currentView === "wrong") renderWrong();
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
      if (focusEl) focusEl.focus();
    }, 40);
  }

  function finishQuiz() {
    if (!quizSession || quizSession.finished) return;
    const s = quizSession;
    s.finished = true;
    const total = s.questions.length;
    const pct = Math.round(s.correct / total * 100);

    if (s.mode === "normal" && s.day) {
      const p = getProgress(s.day);
      p.completed = true;
      p.attempts = (p.attempts || 0) + 1;
      p.best = Math.max(p.best || 0, pct);
      p.lastAt = new Date().toISOString();
      state.progress[s.day] = p;
      save();
      updateChrome();
      renderHome();
    }

    renderResult(pct);
    renderWrong();
    if (pct >= 80) spawnConfetti();
  }

  function renderResult(pct) {
    const s = quizSession;
    const total = s.questions.length;
    const wrongUnique = unique(s.wrongIds);
    const remaining = s.mode === "review"
      ? openWrongItems().length
      : wrongUnique.length;
    const isReview = s.mode === "review";

    $("#quizCount").textContent = total + " / " + total;
    $("#quizProgressBar").style.width = "100%";

    let headline = "完成。";
    let copy = "";
    if (isReview) {
      headline = remaining === 0 ? "错题清零。" : "回顾完成。";
      copy = remaining === 0
        ? "所有未订正错题都已答对，错题本已经清空。"
        : "还有 " + remaining + " 个未订正条目。再回顾一轮，把它们逐个消掉。";
    } else if (pct === 100) {
      headline = "全对。";
      copy = "这一日的术语已经通过一次完整提取。明天再回来做一次快速回顾。";
    } else if (pct >= 80) {
      headline = "很稳。";
      copy = "大部分术语已经能认出来。把剩下的错题回炉，再进入下一日。";
    } else if (pct >= 60) {
      headline = "记住了一半以上。";
      copy = "先别急着往下走。用“回顾本日错题”把错题过一遍，再重测一次。";
    } else {
      headline = "这一轮暴露了问题。";
      copy = "这不是坏事。回到术语卡，把错题对应的词再看一遍，然后马上重测。";
    }

    const actionReview = !isReview && wrongUnique.length
      ? '<button class="btn btn-primary" id="resultReview">回顾本次错题（' + wrongUnique.length + "）</button>"
      : "";
    const actionRetry = '<button class="btn btn-ghost" id="resultRetry">' + (isReview ? "再回顾一轮" : "再测一次") + "</button>";
    const actionClose = '<button class="btn btn-ghost" id="resultClose">' + (isReview ? (s.returnView === "study" && s.day ? "返回学习" : "返回错题本") : "返回学习") + "</button>";

    $("#quizBody").innerHTML = '<div class="result-wrap">' +
      '<div class="result-ring-wrap">' +
        '<svg class="progress-ring" viewBox="0 0 120 120" aria-hidden="true">' +
          '<circle class="ring-bg" cx="60" cy="60" r="52"></circle>' +
          '<circle class="ring-fg" cx="60" cy="60" r="52" style="stroke-dashoffset:' + (326.73 * (1 - pct / 100)) + '"></circle>' +
        "</svg>" +
        '<div class="result-score"><strong>' + pct + '</strong><span>SCORE</span></div>' +
      "</div>" +
      "<h2>" + headline + "</h2>" +
      "<p>" + copy + "</p>" +
      '<div class="result-actions">' + actionReview + actionRetry + actionClose + "</div>" +
      (wrongUnique.length
        ? '<div class="result-wrong-list">' + wrongUnique.map(function (id) {
            const t = TERM_BY_ID.get(id);
            return '<div class="result-wrong-item"><span><b>' + esc(t.en) + "</b><br>" + esc(t.zh) + '</span><em>再记一次</em></div>';
          }).join("") + "</div>"
        : '<div class="result-perfect">没有新增错题。可以进入下一日，或去工艺图鉴把词放回流程。</div>') +
    "</div>";

    $("#quizFooter").innerHTML = '<span class="footer-left-note">' + (isReview ? "订正结果已保存到本地" : "成绩已保存 · 本地浏览器") + '</span><span class="footer-right"><button class="btn btn-ghost btn-small" id="resultFooterClose">关闭</button></span>';

    const close = $("#resultClose");
    if (close) close.addEventListener("click", function () { closeQuiz(true); });
    const footClose = $("#resultFooterClose");
    if (footClose) footClose.addEventListener("click", function () { closeQuiz(true); });
    const retry = $("#resultRetry");
    if (retry) retry.addEventListener("click", function () {
      const mode = s.mode;
      const day = s.day;
      const ids = wrongUnique.slice();
      closeQuiz(true);
      setTimeout(function () {
        if (mode === "review") startReview(ids.length ? ids : s.questions.map(function (q) { return q.term.id; }), "wrong");
        else startNormalQuiz(day);
      }, 80);
    });
    const review = $("#resultReview");
    if (review) review.addEventListener("click", function () {
      const ids = wrongUnique.slice();
      closeQuiz(true);
      setTimeout(function () { startReview(ids, "study", s.day); }, 80);
    });
  }

  /* ---------------- Wrong helpers ---------------- */

  function markWrong(term) {
    const prev = state.wrong[term.id] || {
      id: term.id,
      day: term.day,
      count: 0,
      firstWrongAt: new Date().toISOString()
    };
    prev.day = term.day;
    prev.count = (prev.count || 0) + 1;
    prev.lastWrongAt = new Date().toISOString();
    prev.resolved = false;
    prev.resolvedAt = null;
    state.wrong[term.id] = prev;
    save();
    updateChrome();
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
          wrongFilter = "open";
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
