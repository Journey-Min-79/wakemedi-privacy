/* =========================================================
   주식 시황 대시보드 — app.js
   P1: 뼈대 — 데이터 로드 확인, 헤더 렌더, 사이드바 네비, 섹션 스캐폴딩
   렌더링은 window.*_DATA 만 참조한다 (하드코딩 금지).
   ========================================================= */
(function () {
  "use strict";

  /* ---------- 0. 공통 유틸 (이후 Phase 재사용) ---------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const NBSP_DASH = "—"; // null 표시

  // 숫자 천단위 콤마
  function fmtNum(n, digits) {
    if (n === null || n === undefined || Number.isNaN(n)) return NBSP_DASH;
    return Number(n).toLocaleString("ko-KR", {
      minimumFractionDigits: digits ?? 0,
      maximumFractionDigits: digits ?? 0,
    });
  }

  // 조/억 자동 변환 (예: 8720000000000 → "8.72조")
  function fmtKrwUnit(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return NBSP_DASH;
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(2).replace(/\.00$/, "") + "조";
    if (abs >= 1e8)  return (n / 1e8).toFixed(0) + "억";
    if (abs >= 1e4)  return (n / 1e4).toFixed(0) + "만";
    return fmtNum(n);
  }

  // 등락 방향: 1 상승 / -1 하락 / 0 보합
  function dir(change) {
    if (change === null || change === undefined || change === 0) return 0;
    return change > 0 ? 1 : -1;
  }
  function dirClass(change) {
    const d = dir(change);
    return d === 1 ? "up" : d === -1 ? "down" : "flat";
  }
  function dirSign(change) {
    const d = dir(change);
    return d === 1 ? "▲" : d === -1 ? "▼" : "―";
  }
  // "▲ 24.42 (+0.90%)" 형태
  function fmtChange(change, rate, digits) {
    if (change === null || change === undefined) return NBSP_DASH;
    const sign = rate > 0 ? "+" : "";
    const r = rate === null || rate === undefined ? "" : ` (${sign}${rate.toFixed(2)}%)`;
    return `${dirSign(change)} ${fmtNum(Math.abs(change), digits ?? 0)}${r}`;
  }

  // 한글 조사 선택 (받침 유무): josa("삼성전자","이","가") → "가"
  function josa(word, withJong, withoutJong) {
    const ch = String(word || "").charCodeAt(String(word || "").length - 1);
    if (ch < 0xac00 || ch > 0xd7a3) return withoutJong;
    return (ch - 0xac00) % 28 ? withJong : withoutJong;
  }

  // 상대시간 ("3시간 전")
  function relTime(iso) {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const diff = Date.now() - then;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "방금";
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}일 전`;
    return new Date(iso).toLocaleDateString("ko-KR");
  }

  function fmtDateTime(iso) {
    if (!iso) return NBSP_DASH;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return NBSP_DASH;
    const p = (x) => String(x).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 억원 단위 포맷 (수급 데이터, 예: 4850 → "4,850억", 12000 → "1.20조")
  function fmtEok(n, withSign) {
    if (n === null || n === undefined || Number.isNaN(n)) return NBSP_DASH;
    const sign = withSign ? (n > 0 ? "+" : n < 0 ? "-" : "") : (n < 0 ? "-" : "");
    const abs = Math.abs(n);
    if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2).replace(/\.00$/, "")}조`;
    return `${sign}${fmtNum(abs)}억`;
  }

  // 외부로 노출 (이후 Phase에서 사용)
  window.DashUtil = {
    $, $$, fmtNum, fmtKrwUnit, fmtEok, fmtChange, dir, dirClass, dirSign, relTime, fmtDateTime, DASH: NBSP_DASH,
  };

  // 공유 이벤트 (탭/기간 변경 시 구독 섹션 일괄 갱신)
  const Shared = {
    subs: [],
    on(fn) { this.subs.push(fn); return fn; },
    emit() { this.subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); },
  };
  window.DashShared = Shared;

  /* ---------- 공용 컴포넌트 (sentiment 뱃지 / 뉴스 리스트 / 스파크라인) ---------- */
  const SENTIMENT = {
    positive: { label: "긍정", cls: "sent-pos" },
    negative: { label: "부정", cls: "sent-neg" },
    watch:    { label: "주의", cls: "sent-watch" },
    neutral:  { label: "중립", cls: "sent-neutral" },
  };
  function sentimentBadge(s) {
    const m = SENTIMENT[s] || SENTIMENT.neutral;
    return `<span class="sent-badge ${m.cls}">${m.label}</span>`;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // 미니 스파크라인 SVG (마지막 vs 시작 기준 상승 빨강 / 하락 파랑)
  function sparklineSVG(values, w = 120, h = 34) {
    if (!Array.isArray(values) || values.length < 2) {
      return `<div class="spark-empty">추세 데이터 없음</div>`;
    }
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const stepX = w / (values.length - 1);
    const pts = values.map((v, i) =>
      `${(i * stepX).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
    const color = values[values.length - 1] >= values[0] ? "#f0454b" : "#3d7bfd";
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}">
      <polyline class="spark-line" pathLength="1" points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"
        stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  // 뉴스 리스트 렌더 (섹션 C 상세 + 섹션 D 공용)
  function renderNewsList(container, items, opts = {}) {
    if (!container) return;
    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `<div class="news-empty">수집된 뉴스가 없습니다</div>`;
      return;
    }
    const limit = opts.limit || items.length;
    const visible = items.slice(0, State.newsExpanded ? items.length : limit);
    const rows = visible.map((n) => {
      const isNew = Date.now() - new Date(n.publishedAt).getTime() < 24 * 3600 * 1000;
      const scopeLabel = n.scope === "global" ? "해외" : "국내";
      return `<a class="news-item" href="${encodeURI(n.url || "#")}" target="_blank" rel="noopener">
        <span class="news-title" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</span>
        <span class="news-meta">
          ${isNew ? '<span class="news-new">NEW</span>' : ""}
          <span class="news-scope ${n.scope === "global" ? "global" : "domestic"}">${scopeLabel}</span>
          <span>${escapeHtml(n.source)}</span><span>·</span><span>${relTime(n.publishedAt)}</span>
        </span></a>`;
    }).join("");
    const more = opts.more !== false && items.length > visible.length
      ? `<button type="button" class="list-more" data-more-news>뉴스 ${items.length - visible.length}개 더보기</button>` : "";
    container.innerHTML = `<div class="news-list">${rows}</div>${more}`;
    container.querySelector("[data-more-news]")?.addEventListener("click", () => {
      State.newsExpanded = true;
      if (opts.onMore) opts.onMore();
      else News.render();
    });
  }

  window.DashUtil.sentimentBadge = sentimentBadge;
  window.DashUtil.renderNewsList = renderNewsList;

  // 특정 종목의 최신 AI 분석 sentiment
  function latestSentimentFor(code) {
    const a = ANALYSIS?.analyses?.[0];
    const s = a?.stocks?.find((x) => x.code === code);
    return s?.sentiment || "neutral";
  }

  // 공용 hover 툴팁 (스파크라인용, 1개만 생성)
  let sparkTipEl = null;
  function sparkTip() {
    if (!sparkTipEl) {
      sparkTipEl = document.createElement("div");
      sparkTipEl.className = "spark-tip";
      document.body.appendChild(sparkTipEl);
    }
    return sparkTipEl;
  }

  // 인터랙티브 스파크라인 (hover 시 날짜/값 툴팁)
  function makeSpark(container, points, opts = {}) {
    if (!container) return;
    const w = opts.w || 140, h = opts.h || 20, digits = opts.digits ?? 0;
    if (!Array.isArray(points) || points.length < 2) {
      container.innerHTML = `<div class="spark-empty"></div>`;
      return;
    }
    const vals = points.map((p) => p.value);
    const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
    const stepX = w / (points.length - 1);
    const xy = points.map((p, i) => [i * stepX, h - ((p.value - min) / range) * h]);
    const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const color = vals[vals.length - 1] >= vals[0] ? "#f0454b" : "#3d7bfd";
    container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}">
      <polyline class="spark-line" pathLength="1" points="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
      <circle class="spark-dot" r="2.4" fill="${color}" style="opacity:0"/></svg>`;
    const svg = container.querySelector("svg");
    const dot = container.querySelector(".spark-dot");
    const tip = sparkTip();
    container.onmousemove = (e) => {
      const rect = svg.getBoundingClientRect();
      let idx = Math.round(((e.clientX - rect.left) / rect.width) * (points.length - 1));
      idx = Math.max(0, Math.min(points.length - 1, idx));
      dot.setAttribute("cx", xy[idx][0]); dot.setAttribute("cy", xy[idx][1]); dot.style.opacity = 1;
      tip.innerHTML = `<span class="st-date">${points[idx].date || ""}</span><span class="tnum">${fmtNum(points[idx].value, digits)}</span>`;
      tip.style.left = ((xy[idx][0] / w) * rect.width + rect.left) + "px";
      tip.style.top = ((xy[idx][1] / h) * rect.height + rect.top) + "px";
      tip.classList.add("show");
    };
    container.onmouseleave = () => { dot.style.opacity = 0; tip.classList.remove("show"); };
  }
  window.DashUtil.makeSpark = makeSpark;

  // 숫자 카운트업 애니메이션 (최초 로드 1회, 이후 재실행 없음)
  function animateCounts() {
    if (State._counted) return;
    State._counted = true;
    animateNumbers(document);
  }

  function animateNumbers(root = document) {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $$(".js-count", root).forEach((el) => {
      const target = parseFloat(el.dataset.value);
      if (Number.isNaN(target)) return;
      const digits = parseInt(el.dataset.digits || "0", 10);
      if (reduce) { el.textContent = fmtNum(target, digits); return; }
      const dur = 600, start = performance.now(), ease = (t) => 1 - Math.pow(1 - t, 3);
      (function tick(now) {
        const p = Math.min(1, (now - start) / dur);
        el.textContent = fmtNum(target * ease(p), digits);
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = fmtNum(target, digits);
      })(start);
    });
  }

  function animateView(id) {
    const view = document.getElementById(id);
    if (!view) return;
    const targets = [
      ...$$(".panel", view),
      ...$$(".stock-card", view),
      ...$$(".watch-table tbody tr", view),
      ...$$(".signal-card", view),
      ...$$(".chart-box", view),
    ];
    targets.forEach((el, i) => {
      el.style.setProperty("--stagger", `${Math.min(i, 12) * 35}ms`);
      el.classList.remove("view-pop");
      void el.offsetWidth;
      el.classList.add("view-pop");
    });
    view.classList.remove("chart-redraw");
    void view.offsetWidth;
    view.classList.add("chart-redraw");
    animateNumbers(view);
    animateChartsForView(id);
  }

  function replayChart(chart) {
    if (!chart || typeof chart.update !== "function") return;
    try {
      if (typeof chart.reset === "function") chart.reset();
      chart.update();
    } catch (e) {}
  }

  function animateChartsForView(id) {
    if (id === "sec-market") {
      replayChart(Market.cmpChart);
      replayChart(Market.tvChart);
    } else if (id === "sec-flow") {
      replayChart(Flow.cumChart);
      replayChart(Flow.dailyChart);
    } else if (id === "sec-stocks") {
      replayChart(Stocks.flow);
    }
  }

  /* ---------- 1. 데이터 로드 확인 ---------- */
  const MARKET   = window.MARKET_DATA;
  const STOCKS   = window.STOCKS_DATA;
  const NEWS     = window.NEWS_DATA;
  const ANALYSIS = window.ANALYSIS_DATA;

  function dataSummary() {
    const safeLen = (a) => (Array.isArray(a) ? a.length : 0);
    return {
      MARKET_DATA: MARKET ? {
        updatedAt: MARKET.meta?.updatedAt,
        marketStatus: MARKET.meta?.marketStatus,
        indices: MARKET.indices ? Object.keys(MARKET.indices) : [],
        kospiHistory:  safeLen(MARKET.indices?.KOSPI?.history),
        kosdaqHistory: safeLen(MARKET.indices?.KOSDAQ?.history),
        투자자수급_KOSPI: safeLen(MARKET.investorTrends?.KOSPI),
      } : "❌ 없음",
      STOCKS_DATA: STOCKS ? {
        종목수: safeLen(STOCKS.stocks),
        종목: (STOCKS.stocks || []).map((s) => `${s.name}(${s.code})`),
      } : "❌ 없음",
      NEWS_DATA: NEWS ? {
        시장뉴스: safeLen(NEWS.marketNews),
        종목뉴스: NEWS.stockNews
          ? Object.fromEntries(Object.entries(NEWS.stockNews).map(([k, v]) => [k, safeLen(v)]))
          : {},
      } : "❌ 없음",
      ANALYSIS_DATA: ANALYSIS ? {
        리포트수: safeLen(ANALYSIS.analyses),
        최신: ANALYSIS.analyses?.[0]?.period,
      } : "❌ 없음",
    };
  }

  function logSummary() {
    const missing = [];
    if (!MARKET)   missing.push("MARKET_DATA (market.js)");
    if (!STOCKS)   missing.push("STOCKS_DATA (stocks.js)");
    if (!NEWS)     missing.push("NEWS_DATA (news.js)");
    if (!ANALYSIS) missing.push("ANALYSIS_DATA (analysis.js)");

    console.log("%c📊 주식 시황 대시보드 — 데이터 로드 요약",
      "color:#22d3a5;font-weight:700;font-size:13px");
    console.table(dataSummary());

    if (missing.length) {
      console.warn("⚠️ 로드되지 않은 데이터:", missing.join(", "));
    } else {
      console.log("%c✅ 4개 데이터 파일 모두 로드됨", "color:#22d3a5");
    }
    return missing;
  }

  /* ---------- 2. 헤더 렌더 ---------- */
  function renderHeader() {
    // 마켓 상태 뱃지
    const status = MARKET?.meta?.marketStatus || "CLOSED";
    const isOpen = status === "OPEN";
    const badge = $("#market-badge");
    if (badge) {
      badge.className = "market-badge " + (isOpen ? "open" : "closed");
      badge.innerHTML = `<span class="dot"></span>${isOpen ? "장중" : "장마감"}`;
    }

    // 티커 3개
    const idx = MARKET?.indices || {};
    renderTicker("#ticker-kospi",  idx.KOSPI,  2);
    renderTicker("#ticker-kosdaq", idx.KOSDAQ, 2);
    renderTicker("#ticker-usdkrw", idx.USDKRW, 2);

    // 기준 시각 안내줄
    const updatedAt = MARKET?.meta?.updatedAt;
    const line = $("#freshness-updated");
    if (line) line.textContent = `${fmtDateTime(updatedAt)} 데이터 기준`;

    // 신선도 배너 (6시간 이상 경과 시)
    renderStaleBanner(updatedAt);
  }

  function renderTicker(sel, index, digits) {
    const el = $(sel);
    if (!el) return;
    if (!index || !index.current) {
      el.innerHTML = `<div class="t-name">${NBSP_DASH}</div>
        <div class="t-row"><span class="t-value">${NBSP_DASH}</span></div>`;
      return;
    }
    const c = index.current;
    el.innerHTML = `
      <div class="t-name">${index.name || ""}</div>
      <div class="t-row">
        <span class="t-value tnum js-count" data-value="${c.value}" data-digits="${digits}">${fmtNum(c.value, digits)}</span>
        <span class="t-change tnum ${dirClass(c.change)}">${fmtChange(c.change, c.changeRate, digits)}</span>
      </div>
      <div class="t-spark"></div>`;
    const hist = (index.history || []).slice(-30).map((d) => ({ date: d.date, value: d.close }));
    makeSpark(el.querySelector(".t-spark"), hist, { w: 140, h: 20, digits });
  }

  function renderStaleBanner(updatedAt) {
    const banner = $("#stale-banner");
    if (!banner || !updatedAt) return;
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    const sixHours = 6 * 60 * 60 * 1000;
    if (ageMs > sixHours) {
      banner.classList.add("show");
      banner.innerHTML = `⚠ 데이터가 오래되었습니다 · 스크립트를 실행하세요`;
    } else {
      banner.classList.remove("show");
    }
  }

  /* ---------- 3. 앱형 화면 전환 네비 ---------- */
  const VIEW_IDS = ["sec-brief", "sec-stocks", "sec-market", "sec-flow", "sec-news", "sec-ai", "sec-heatmap"];
  const App = {
    showView(id, opts = {}) {
      if (!VIEW_IDS.includes(id)) id = "sec-brief";
      State.view = id;
      if (id !== "sec-stocks") {
        try { Stocks.closeDetail(); } catch (e) {}
      }
      if (!opts.skipHash && location.hash !== `#${id}`) {
        history.replaceState(null, "", `#${id}`);
      }
      $$(".section").forEach((s) => s.classList.toggle("active-view", s.id === id));
      $$("[data-target]").forEach((it) => it.classList.toggle("active", it.dataset.target === id));
      if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: opts.instant ? "auto" : "smooth" });
      requestAnimationFrame(() => {
        try { Market._updateCandle(); Market._updateComparison(); } catch (e) {}
        try { Flow.update(); } catch (e) {}
        try { Stocks.refreshCharts(); } catch (e) {}
        try { animateView(id); } catch (e) {}
      });
    },
  };
  window.DashApp = App;

  function initNav() {
    const items = $$("[data-target]");
    items.forEach((item) => {
      item.addEventListener("click", () => {
        App.showView(item.dataset.target);
      });
    });
  }

  /* ---------- 4. 섹션 A — 시장 개요 (P2) ---------- */

  // 공유 상태
  const State = { view: "sec-brief", marketTab: "KOSPI", period: "2Y", flowPeriod: "3M", newsTab: "all", newsScope: "all", newsExpanded: false, aiExpanded: false, insightsExpanded: false };
  window.DashState = State;

  const PERIOD_DAYS = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "2Y": 730 };

  // 색상 토큰 (JS에서 참조)
  const C = {
    up: "#f0454b", down: "#3d7bfd", accent: "#22d3a5", warn: "#f5a524",
    grid: "#1a2236", border: "#232d45", text: "#8b95ab", muted: "#5a6478",
    panel2: "#2a3557",
  };

  // history[] 를 선택 기간으로 필터 (마지막 데이터 날짜 기준)
  function filterByPeriod(history, period) {
    if (!Array.isArray(history) || history.length === 0) return [];
    const days = PERIOD_DAYS[period] || 730;
    const lastDate = new Date(history[history.length - 1].date + "T00:00:00");
    const cutoff = new Date(lastDate);
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = history.filter((d) => new Date(d.date + "T00:00:00") >= cutoff);
    // 필터 결과가 1개 이하이면 (희소 데이터) 원본을 그대로 사용
    return filtered.length >= 2 ? filtered : history.slice(-Math.max(2, filtered.length));
  }

  const Market = {
    candleChart: null, candleSeries: null, volumeSeries: null,
    cmpChart: null, tvChart: null, ro: null,

    init() {
      if (!MARKET || !MARKET.indices) return;
      this._initCandle();
      this._bindControls();
      Shared.on(() => this.update());
      this.update();
    },

    _initCandle() {
      const el = $("#candle-chart");
      if (!el || !window.LightweightCharts) return;
      const chart = LightweightCharts.createChart(el, {
        width: el.clientWidth, height: el.clientHeight,
        layout: { background: { color: "transparent" }, textColor: C.text, fontFamily: "inherit" },
        grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
        rightPriceScale: { borderColor: C.border },
        timeScale: { borderColor: C.border, timeVisible: false },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        localization: {
          priceFormatter: (p) => fmtNum(p, 0),
        },
      });
      this.candleSeries = chart.addCandlestickSeries({
        upColor: C.up, downColor: C.down,
        borderUpColor: C.up, borderDownColor: C.down,
        wickUpColor: C.up, wickDownColor: C.down,
      });
      this.volumeSeries = chart.addHistogramSeries({
        priceScaleId: "", priceFormat: { type: "volume" }, color: C.panel2,
        lastValueVisible: false, priceLineVisible: false,
      });
      this.volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      this.candleChart = chart;

      // 리사이즈 대응
      this.ro = new ResizeObserver(() => {
        chart.resize(el.clientWidth, el.clientHeight);
      });
      this.ro.observe(el);
    },

    _bindControls() {
      $$("#market-tabs button").forEach((b) =>
        b.addEventListener("click", () => {
          State.marketTab = b.dataset.tab;
          $$("#market-tabs button").forEach((x) => x.classList.toggle("active", x === b));
          Shared.emit();
          if (State.view === "sec-market") animateView("sec-market");
          if (State.view === "sec-flow") animateView("sec-flow");
        }));
      $$("#period-seg button").forEach((b) =>
        b.addEventListener("click", () => {
          State.period = b.dataset.period;
          $$("#period-seg button").forEach((x) => x.classList.toggle("active", x === b));
          Shared.emit();
          if (State.view === "sec-market") animateView("sec-market");
          if (State.view === "sec-stocks") animateView("sec-stocks");
        }));
    },

    update() {
      this._updateCandle();
      this._updateComparison();
      this._updateBreadth();
      this._updateTradingValue();
      this._updateCheckpoints();
    },

    // A1
    _updateCandle() {
      if (!this.candleSeries) return;
      const idx = MARKET.indices[State.marketTab];
      const hist = filterByPeriod(idx?.history || [], State.period);
      const empty = $("#candle-empty");
      if (!hist.length) {
        this.candleSeries.setData([]); this.volumeSeries.setData([]);
        if (empty) empty.hidden = false;
        return;
      }
      if (empty) empty.hidden = true;
      this.candleSeries.setData(hist.map((d) => ({
        time: d.date, open: d.open, high: d.high, low: d.low, close: d.close,
      })));
      this.volumeSeries.setData(hist.map((d) => ({
        time: d.date,
        value: d.tradingValue ?? d.volume ?? 0,
        color: d.close >= d.open ? "rgba(240,69,75,.35)" : "rgba(61,123,253,.35)",
      })));
      this.candleChart.timeScale().fitContent();
    },

    // A2 — 코스피 vs 코스닥 정규화(시작점=0%)
    _updateComparison() {
      const cv = $("#cmp-chart");
      if (!cv || !window.Chart) return;
      const build = (key) => {
        const h = filterByPeriod(MARKET.indices[key]?.history || [], State.period);
        if (!h.length) return { labels: [], data: [] };
        const base = h[0].close;
        return { labels: h.map((d) => d.date), data: h.map((d) => ((d.close / base) - 1) * 100) };
      };
      const kospi = build("KOSPI"), kosdaq = build("KOSDAQ");
      const labels = kospi.labels.length >= kosdaq.labels.length ? kospi.labels : kosdaq.labels;

      const datasets = [
        { label: "코스피", data: kospi.data, borderColor: C.accent, backgroundColor: C.accent },
        { label: "코스닥", data: kosdaq.data, borderColor: C.warn, backgroundColor: C.warn },
      ].map((d) => ({ ...d, borderWidth: 1.8, pointRadius: 0, tension: 0.25, fill: false }));

      if (this.cmpChart) {
        this.cmpChart.data.labels = labels;
        this.cmpChart.data.datasets[0].data = kospi.data;
        this.cmpChart.data.datasets[1].data = kosdaq.data;
        this.cmpChart.update("none");
        return;
      }
      this.cmpChart = new Chart(cv, {
        type: "line",
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: true, position: "top", align: "end",
              labels: { color: C.text, boxWidth: 8, boxHeight: 8, font: { size: 11 }, usePointStyle: true } },
            tooltip: {
              callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y >= 0 ? "+" : ""}${c.parsed.y.toFixed(2)}%` },
            },
          },
          scales: {
            x: { display: false, grid: { display: false } },
            y: { grid: { color: C.grid }, ticks: { color: C.muted, font: { size: 10 },
              callback: (v) => (v > 0 ? "+" : "") + v + "%" } },
          },
        },
      });
    },

    // A3 — 등락 현황
    _updateBreadth() {
      const box = $("#breadth");
      const idx = MARKET.indices[State.marketTab];
      const c = idx?.current;
      const mkLabel = $("#breadth-market");
      if (mkLabel) mkLabel.textContent = idx?.name || "";
      if (!box) return;
      if (!c || (c.advancing == null && c.declining == null)) {
        box.innerHTML = `<div class="placeholder" style="--ph-h:80px">등락 데이터 없음</div>`;
        return;
      }
      const adv = c.advancing || 0, unc = c.unchanged || 0, dec = c.declining || 0;
      const total = adv + unc + dec || 1;
      const row = (label, count, cls, color) => `
        <div class="breadth-row">
          <span class="b-label">${label}</span>
          <div class="breadth-bar"><span style="width:${(count / total * 100).toFixed(1)}%;background:${color}"></span></div>
          <span class="b-count tnum ${cls}">${fmtNum(count)}</span>
        </div>`;
      box.innerHTML =
        row("상승", adv, "up", C.up) +
        row("보합", unc, "flat", C.muted) +
        row("하락", dec, "down", C.down);
    },

    // A4 — 거래대금
    _updateTradingValue() {
      const idx = MARKET.indices[State.marketTab];
      const summary = $("#tv-summary");
      const hist = idx?.history || [];
      const cur = idx?.current?.tradingValue ?? (hist.length ? hist[hist.length - 1].tradingValue : null);
      const prev = hist.length >= 2 ? hist[hist.length - 2].tradingValue : null;

      if (summary) {
        let sub = "";
        if (cur != null && prev != null) {
          const diff = cur - prev;
          const rate = prev ? (diff / prev * 100) : 0;
          sub = `<span class="tv-sub tnum ${dirClass(diff)}">${dirSign(diff)} ${fmtKrwUnit(Math.abs(diff))} (${rate >= 0 ? "+" : ""}${rate.toFixed(1)}%)</span>`;
        }
        summary.innerHTML = cur == null
          ? `<div class="tv-summary-row"><span class="tv-main">${NBSP_DASH}</span></div>`
          : `<div class="tv-summary-row">
               <span class="tv-main tnum">${fmtKrwUnit(cur)}</span>${sub}
               <span class="tv-sub" style="margin-left:auto"><span class="tv-label">전일</span><span class="tnum">${fmtKrwUnit(prev)}</span></span>
             </div>`;
      }

      // 20일 미니 바차트
      const cv = $("#tv-chart");
      if (!cv || !window.Chart) return;
      const last20 = hist.slice(-20);
      const labels = last20.map((d) => d.date);
      const data = last20.map((d) => d.tradingValue ?? 0);
      const colors = last20.map((d) => (d.close >= d.open ? "rgba(240,69,75,.55)" : "rgba(61,123,253,.55)"));
      if (this.tvChart) {
        this.tvChart.data.labels = labels;
        this.tvChart.data.datasets[0].data = data;
        this.tvChart.data.datasets[0].backgroundColor = colors;
        this.tvChart.update("none");
        return;
      }
      this.tvChart = new Chart(cv, {
        type: "bar",
        data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 2, barPercentage: 0.8 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              title: (items) => items[0]?.label,
              label: (c) => fmtKrwUnit(c.parsed.y),
            } },
          },
          scales: { x: { display: false }, y: { display: false } },
        },
      });
    },

    _updateCheckpoints() {
      const box = $("#market-checkpoints");
      if (!box || !MARKET?.indices) return;
      const k = MARKET.indices.KOSPI?.current || {};
      const q = MARKET.indices.KOSDAQ?.current || {};
      const fx = MARKET.indices.USDKRW?.current || {};
      const rows = MARKET.investorTrends?.KOSPI || [];
      const lastFlow = rows.at(-1) || {};
      const bigMoney = (lastFlow.foreign || 0) + (lastFlow.institution || 0);
      const breadthRatio = (k.advancing || 0) / Math.max((k.advancing || 0) + (k.declining || 0), 1);
      const cards = [
        ["코스피", `${k.changeRate >= 0 ? "+" : ""}${fmtNum(k.changeRate, 2)}%`, k.change || 0, `${fmtNum(k.value, 2)}p`],
        ["코스닥", `${q.changeRate >= 0 ? "+" : ""}${fmtNum(q.changeRate, 2)}%`, q.change || 0, `${fmtNum(q.value, 2)}p`],
        ["시장 폭", breadthRatio >= .65 ? "상승 우위" : breadthRatio <= .35 ? "하락 우위" : "혼조", breadthRatio - .5, `상승 ${fmtNum(k.advancing || 0)} · 하락 ${fmtNum(k.declining || 0)}`],
        ["큰손 수급", fmtEok(bigMoney, true), bigMoney, `외국인+기관 합산`],
        ["원/달러", `${fmtNum(fx.value, 2)}원`, -(fx.change || 0), `${fx.change >= 0 ? "+" : ""}${fmtNum(fx.change, 2)}원`],
      ];
      box.innerHTML = cards.map(([label, value, tone, sub]) => `
        <div class="signal-card">
          <div class="sig-label">${label}</div>
          <div class="sig-value tnum ${dirClass(tone)}">${value}</div>
          <div class="sig-sub">${sub}</div>
        </div>`).join("");
    },
  };

  window.DashMarket = Market;

  /* ---------- 5. 섹션 B — 투자자 수급 (P3) ---------- */

  const ENTITIES = [
    { key: "foreign",     name: "외국인", color: "#22d3a5" },
    { key: "institution", name: "기관",   color: "#f5a524" },
    { key: "individual",  name: "개인",   color: "#c084fc" },
  ];
  const MARKET_ENTITIES = [
    ...ENTITIES,
    { key: "otherCorporation", name: "기타법인", color: "#8b95ab" },
  ];

  const Flow = {
    cumChart: null, dailyChart: null,

    init() {
      if (!MARKET || !MARKET.investorTrends) return;
      this._bindControls();
      Shared.on(() => this.update());
      this.update();
    },

    _bindControls() {
      $$("#flow-period-seg button").forEach((b) =>
        b.addEventListener("click", () => {
          State.flowPeriod = b.dataset.flowPeriod;
          $$("#flow-period-seg button").forEach((x) => x.classList.toggle("active", x === b));
          this.update();
          if (State.view === "sec-flow") animateView("sec-flow");
        }));
    },

    // 현재 탭/기간의 수급 시계열
    _series() {
      return filterByPeriod(MARKET.investorTrends[State.marketTab] || [], State.flowPeriod);
    },

    _value(row, key) {
      if (!row) return 0;
      if (row[key] !== null && row[key] !== undefined) return row[key] || 0;
      if (key === "otherCorporation") {
        return -((row.foreign || 0) + (row.institution || 0) + (row.individual || 0));
      }
      return 0;
    },

    update() {
      const label = $("#flow-market-label");
      const idxName = MARKET.indices?.[State.marketTab]?.name || State.marketTab;
      if (label) label.textContent = `${idxName} · ${State.flowPeriod} · 억원`;
      this._updateCumulative();
      this._updateDaily();
      this._updateSummary();
      this._updateReadout();
    },

    // B1 — 누적 순매수 라인
    _updateCumulative() {
      const cv = $("#cum-flow-chart");
      if (!cv || !window.Chart) return;
      const rows = this._series();
      const empty = $("#cum-flow-empty");
      if (!rows.length) {
        if (this.cumChart) { this.cumChart.destroy(); this.cumChart = null; }
        if (empty) empty.hidden = false;
        this._renderCumulativeTotals(null);
        return;
      }
      if (empty) empty.hidden = true;

      const labels = ["시작", ...rows.map((r) => r.date)];
      const running = Object.fromEntries(MARKET_ENTITIES.map((e) => [e.key, 0]));
      const cum = Object.fromEntries(MARKET_ENTITIES.map((e) => [e.key, [0]]));
      rows.forEach((r) => MARKET_ENTITIES.forEach((e) => {
        running[e.key] += this._value(r, e.key);
        cum[e.key].push(running[e.key]);
      }));
      this._renderCumulativeTotals(running);

      if (this.cumChart) {
        this.cumChart.data.labels = labels;
        MARKET_ENTITIES.forEach((e, i) => { this.cumChart.data.datasets[i].data = cum[e.key]; });
        this.cumChart.update("none");
        return;
      }
      this.cumChart = new Chart(cv, {
        type: "line",
        data: {
          labels,
          datasets: MARKET_ENTITIES.map((e) => ({
            label: e.name, data: cum[e.key],
            borderColor: e.color, backgroundColor: e.color,
            borderWidth: 1.8, pointRadius: 0, tension: 0, fill: false,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", align: "end",
              labels: { color: C.text, boxWidth: 8, boxHeight: 8, font: { size: 11 }, usePointStyle: true } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtEok(c.parsed.y, true)}` } },
          },
          scales: {
            x: { display: false, grid: { display: false } },
            y: { grid: { color: C.grid },
              ticks: { color: C.muted, font: { size: 10 }, callback: (v) => fmtEok(v) } },
          },
        },
      });
    },

    // B2 — 일별 순매수 그룹 바
    _updateDaily() {
      const cv = $("#daily-flow-chart");
      if (!cv || !window.Chart) return;
      const rows = this._series().slice(-20);
      const empty = $("#daily-flow-empty");
      if (!rows.length) {
        if (this.dailyChart) { this.dailyChart.destroy(); this.dailyChart = null; }
        if (empty) empty.hidden = false;
        return;
      }
      if (empty) empty.hidden = true;

      const labels = rows.map((r) => r.date);
      const dsData = MARKET_ENTITIES.map((e) => rows.map((r) => this._value(r, e.key)));

      if (this.dailyChart) {
        this.dailyChart.data.labels = labels;
        MARKET_ENTITIES.forEach((e, i) => { this.dailyChart.data.datasets[i].data = dsData[i]; });
        this.dailyChart.update("none");
        return;
      }
      this.dailyChart = new Chart(cv, {
        type: "bar",
        data: {
          labels,
          datasets: MARKET_ENTITIES.map((e, i) => ({
            label: e.name, data: dsData[i],
            backgroundColor: e.color, borderRadius: 2, barPercentage: 0.9, categoryPercentage: 0.7,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", align: "end",
              labels: { color: C.text, boxWidth: 8, boxHeight: 8, font: { size: 11 }, usePointStyle: true } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtEok(c.parsed.y, true)}` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: C.muted, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
            y: { grid: { color: C.grid }, ticks: { color: C.muted, font: { size: 10 }, callback: (v) => fmtEok(v) } },
          },
        },
      });
    },

    // B3 — 수급 요약 카드 3장 (당일 / 5일 누적 / 20일 누적)
    _updateSummary() {
      const box = $("#flow-summary");
      if (!box) return;
      const rows = MARKET.investorTrends[State.marketTab] || [];
      if (!rows.length) {
        box.innerHTML = `<div class="placeholder" style="--ph-h:120px">수급 데이터 없음</div>`;
        return;
      }
      const today = (k) => this._value(rows[rows.length - 1], k);
      const sumLast = (k, n) => rows.slice(-n).reduce((a, r) => a + this._value(r, k), 0);

      // 오늘의 수급 한줄 요약
      const idxName = MARKET.indices?.[State.marketTab]?.name || State.marketTab;
      const buyers = [], sellers = [];
      ENTITIES.forEach((e) => {
        const v = today(e.key);
        if (v > 0) buyers.push(e.name); else if (v < 0) sellers.push(e.name);
      });
      let headline = "";
      if (buyers.length || sellers.length) {
        const f = today("foreign"), i = today("institution");
        const tone = f > 0 && i > 0 ? "up" : f < 0 && i < 0 ? "down" : "flat";
        const comment = f > 0 && i > 0 ? " — 외국인·기관 동반 매수는 통상 우호적 수급으로 봅니다"
          : f < 0 && i < 0 ? " — 큰손이 모두 파는 날은 반등이 나와도 신뢰가 낮습니다" : "";
        headline = `<div class="flow-headline ${tone}">오늘 ${idxName}${josa(idxName, "은", "는")} <strong>${buyers.join("·") || "없음"}</strong>이 사고 <strong>${sellers.join("·") || "없음"}</strong>이 팔았습니다${comment}</div>`;
      }

      box.innerHTML = headline + MARKET_ENTITIES.map((e) => {
        const metrics = [
          ["당일", today(e.key)],
          ["5일 누적", sumLast(e.key, 5)],
          ["20일 누적", sumLast(e.key, 20)],
        ];
        const st = Calc.streak(rows, e.key);
        const streakTag = st.days >= 2
          ? `<span class="fc-streak ${st.sign > 0 ? "up" : "down"}">${st.days}일 연속 순${st.sign > 0 ? "매수" : "매도"}</span>` : "";
        return `<div class="flow-card">
          <div class="fc-head"><span class="fc-dot" style="background:${e.color}"></span>${e.name}${streakTag}</div>
          <div class="fc-grid">${metrics.map(([lbl, v]) => `
            <div class="fc-metric">
              <div class="m-label">${lbl}</div>
              <div class="m-value tnum ${dirClass(v)}">${v == null ? NBSP_DASH : `${dirSign(v)} ${fmtEok(Math.abs(v))}`}</div>
            </div>`).join("")}</div>
        </div>`;
      }).join("");
    },

    _renderCumulativeTotals(totals) {
      const box = $("#cum-flow-totals");
      if (!box) return;
      if (!totals) {
        box.innerHTML = "";
        return;
      }
      box.innerHTML = MARKET_ENTITIES.map((e) => {
        const v = totals[e.key] || 0;
        return `<div class="flow-total">
          <span class="fc-dot" style="background:${e.color}"></span>
          <span>${e.name}</span>
          <strong class="tnum ${dirClass(v)}">${fmtEok(v, true)}</strong>
        </div>`;
      }).join("");
    },

    _updateReadout() {
      const box = $("#flow-readout");
      if (!box) return;
      const rows = MARKET.investorTrends?.[State.marketTab] || [];
      if (!rows.length) {
        box.innerHTML = `<div class="news-empty">수급 데이터가 없습니다</div>`;
        return;
      }
      const latest = rows.at(-1);
      const read = MARKET_ENTITIES.map((e) => {
        const day = this._value(latest, e.key);
        const d5 = rows.slice(-5).reduce((a, r) => a + this._value(r, e.key), 0);
        const d20 = rows.slice(-20).reduce((a, r) => a + this._value(r, e.key), 0);
        const st = Calc.streak(rows, e.key);
        const trend = st.days >= 2 ? `${st.days}일 연속 ${st.sign > 0 ? "순매수" : "순매도"}` : "단기 혼조";
        return `<div class="signal-card">
          <div class="sig-label"><span class="fc-dot" style="background:${e.color}"></span>${e.name}</div>
          <div class="sig-value tnum ${dirClass(day)}">${fmtEok(day, true)}</div>
          <div class="sig-sub">5일 ${fmtEok(d5, true)} · 20일 ${fmtEok(d20, true)} · ${trend}</div>
        </div>`;
      }).join("");
      box.innerHTML = read;
    },
  };

  window.DashFlow = Flow;

  /* ---------- 6. 섹션 C — 관심종목 5선 (P4) ---------- */

  const Stocks = {
    candle: null, flow: null,

    init() {
      if (!STOCKS || !Array.isArray(STOCKS.stocks) || !STOCKS.stocks.length) return;
      State.selectedStock = State.selectedStock || STOCKS.stocks[0].code; // 기본: 삼성전자
      this.renderCards();
      this.renderCompareTable();
      this.renderDetail(false);
      this._bindDrawer();
      Shared.on(() => this.refreshCharts()); // 기간 버튼 공유
      this._bindKeys();
    },

    // 1~5 키로 종목 상세 전환
    _bindKeys() {
      document.addEventListener("keydown", (e) => {
        if (e.target.matches("input, textarea, summary")) return;
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= STOCKS.stocks.length) {
          App.showView("sec-stocks");
          this.select(STOCKS.stocks[n - 1].code);
        }
      });
    },

    _stock(code) { return STOCKS.stocks.find((s) => s.code === code); },

    // C1 — 종목 카드 5개
    renderCards() {
      const box = $("#stock-cards");
      if (!box) return;
      const retChip = (label, v) => `<div class="ret-chip">
        <span class="rc-label">${label}</span>
        <span class="rc-val tnum ${v == null ? "flat" : dirClass(v)}">${v == null ? NBSP_DASH : (v > 0 ? "+" : "") + v.toFixed(1) + "%"}</span>
      </div>`;
      box.innerHTML = STOCKS.stocks.map((s) => {
        const c = s.current;
        const closes = (s.history || []).slice(-60).map((h) => h.close);
        const band = Calc.band52w(c);
        const pct = band == null ? 50 : band;
        const sigs = stockSignals(s).slice(0, 3);
        return `<div class="stock-card ${s.code === State.selectedStock ? "active" : ""}"
                     data-code="${s.code}" role="button" tabindex="0">
          <div class="sc-top">
            <div>
              <span class="sc-name">${escapeHtml(s.name)}</span><span class="mkt-tag">${s.market}</span>
              <div class="sc-code">${s.code} · ${escapeHtml(s.sector || "")}</div>
            </div>
            ${sentimentBadge(latestSentimentFor(s.code))}
          </div>
          <div>
            <div class="sc-price tnum js-count" data-value="${c.price}">${fmtNum(c.price)}</div>
            <div class="sc-change tnum ${dirClass(c.change)}">${fmtChange(c.change, c.changeRate)}</div>
          </div>
          <div class="sc-spark">${sparklineSVG(closes)}</div>
          <div class="sc-returns">
            ${retChip("1주", Calc.returnOver(s.history, 5))}
            ${retChip("1개월", Calc.returnOver(s.history, 21))}
            ${retChip("3개월", Calc.returnOver(s.history, 63))}
          </div>
          ${sigs.length ? `<div class="sc-badges">${sigs.map((x) =>
            `<span class="sig-badge ${x.tone}" title="${escapeHtml(x.text)}">${escapeHtml(x.badge)}</span>`).join("")}</div>` : ""}
          <div class="sc-metrics">
            <div class="sc-mrow"><span>거래량 <em class="sc-vs">/20일평균</em></span><span class="v tnum">${fmtNum(c.volume)}${(() => {
              const vr = Calc.volumeRatio(s.history, 20);
              return vr == null ? "" : ` <em class="sc-vr ${vr >= 1 ? "up" : "flat"}">${vr.toFixed(1)}x</em>`;
            })()}</span></div>
            <div class="sc-mrow"><span>시가총액</span><span class="v tnum">${fmtKrwUnit(c.marketCap)}</span></div>
            <div class="sc-mrow"><span>외인 5일 순매수</span>${(() => {
              if (!(s.investorTrends || []).length) return `<span class="v tnum flat">${NBSP_DASH}</span>`;
              const v = Calc.sumLast(s.investorTrends, "foreign", 5);
              return `<span class="v tnum ${dirClass(v)}">${fmtEok(v, true)}</span>`;
            })()}</div>
            <div class="gauge">
              <div class="gauge-track"><span class="gauge-dot" style="left:${pct.toFixed(1)}%"></span></div>
              <div class="gauge-labels"><span>저 ${fmtNum(c.low52w)}</span><span>52주 위치</span><span>고 ${fmtNum(c.high52w)}</span></div>
            </div>
          </div>
        </div>`;
      }).join("");

      box.querySelectorAll(".stock-card").forEach((el) => {
        const go = () => this.select(el.dataset.code);
        el.addEventListener("click", go);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
        });
      });
    },

    renderCompareTable() {
      const table = $("#stock-compare-table");
      if (!table) return;
      renderWatchTable(table, {
        onSelect: (code) => {
          App.showView("sec-stocks", { keepScroll: true });
          this.select(code);
        },
      });
    },

    select(code, opts = {}) {
      if (!this._stock(code)) return;
      State.selectedStock = code;
      this.renderCards();
      this.renderCompareTable();
      this.renderDetail(opts.open !== false);
    },

    _bindDrawer() {
      $("#drawer-backdrop")?.addEventListener("click", () => this.closeDetail());
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.closeDetail();
      });
    },

    closeDetail() {
      $("#stock-detail")?.classList.remove("active");
      const bd = $("#drawer-backdrop");
      if (bd) bd.hidden = true;
    },

    openDetail() {
      $("#stock-detail")?.classList.add("active");
      const bd = $("#drawer-backdrop");
      if (bd) bd.hidden = false;
    },

    _destroyCharts() {
      if (this.candle) { try { this.candle.chart.remove(); } catch (e) {} this.candle = null; }
      if (this.flow)   { try { this.flow.destroy(); } catch (e) {} this.flow = null; }
    },

    // C2 — 상세 패널
    renderDetail(open = true) {
      const box = $("#stock-detail");
      if (!box) return;
      const s = this._stock(State.selectedStock) || STOCKS.stocks[0];
      this._destroyCharts();
      const f = s.current;
      const FUND_HELP = {
        PER: "주가수익비율 = 주가 ÷ 주당순이익(EPS). 이익 대비 주가 수준 — 낮을수록 이익 대비 저평가, 적자 기업은 계산 불가(—)",
        PBR: "주가순자산비율 = 주가 ÷ 주당순자산. 1배 미만이면 장부상 자산가치보다 싸게 거래된다는 뜻",
        EPS: "주당순이익 — 1주가 1년간 벌어들인 순이익. PER 계산의 기초",
        "배당수익률": "연간 배당금 ÷ 현재가. 은행 이자처럼 보유만으로 받는 현금 수익률",
        "외국인 지분율": "외국인이 보유한 주식 비중. 상승 추세면 외국인이 사 모으고 있다는 신호",
        "시가총액": "현재가 × 상장주식수 — 회사 전체의 시장 가격",
      };
      const row = (l, v) => {
        const help = FUND_HELP[l];
        return `<tr><td>${help ? `<span class="term" title="${escapeHtml(help)}">${l}</span>` : l}</td><td class="tnum">${v}</td></tr>`;
      };
      const won = (v) => (v == null ? NBSP_DASH : fmtNum(v) + "원");
      const pctv = (v) => (v == null ? NBSP_DASH : v + "%");

      // 상단 지표 스트립: 기간 수익률 + RSI + 거래량 배수 + 52주 위치
      const rsi = Calc.rsi(s.history, 14);
      const vr = Calc.volumeRatio(s.history, 20);
      const band = Calc.band52w(f);
      const statRet = RET_PERIODS.map((p) => {
        const v = Calc.returnOver(s.history, p.days);
        return `<div class="stat-tile">
          <div class="st-label">${p.label} 수익률</div>
          <div class="st-value tnum ${v == null ? "flat" : dirClass(v)}">${v == null ? NBSP_DASH : (v > 0 ? "+" : "") + v.toFixed(1) + "%"}</div>
        </div>`;
      }).join("");
      const rsiTone = rsi == null ? "flat" : rsi >= 70 ? "warn-c" : rsi <= 30 ? "warn-c" : "";
      const statEtc = `
        <div class="stat-tile" title="RSI(14) — 최근 14일 상승/하락 강도. 70 이상 과열, 30 이하 과매도로 봅니다">
          <div class="st-label">RSI(14)</div>
          <div class="st-value tnum ${rsiTone}">${rsi == null ? NBSP_DASH : rsi.toFixed(0)}<em class="st-sub">${rsi == null ? "" : rsi >= 70 ? " 과열" : rsi <= 30 ? " 과매도" : " 중립"}</em></div>
        </div>
        <div class="stat-tile" title="당일 거래량 ÷ 최근 20일 평균 거래량">
          <div class="st-label">거래량/20일평균</div>
          <div class="st-value tnum">${vr == null ? NBSP_DASH : vr.toFixed(1) + "배"}</div>
        </div>
        <div class="stat-tile" title="52주 최저~최고가 범위에서 현재가의 위치">
          <div class="st-label">52주 위치</div>
          <div class="st-value tnum">${band == null ? NBSP_DASH : band.toFixed(0) + "%"}</div>
        </div>`;

      // 투자 포인트: 규칙 기반 시그널 + 최신 AI 분석
      const sigs = stockSignals(s);
      const aiStock = ANALYSIS?.analyses?.[0]?.stocks?.find((x) => x.code === s.code);
      const pointRows = sigs.map((x) => `
        <div class="point-row">
          <span class="sig-badge ${x.tone}">${escapeHtml(x.badge)}</span>
          <span class="point-text">${escapeHtml(x.text)}</span>
        </div>`).join("");
      const aiRow = aiStock ? `
        <div class="point-row ai">
          ${sentimentBadge(aiStock.sentiment)}
          <span class="point-text">${escapeHtml(aiStock.summary || "")}</span>
        </div>` : "";

      box.innerHTML = `
        <div class="drawer-head">
          <div>
            <div class="drawer-kicker">${escapeHtml(s.market)} · ${escapeHtml(s.sector || "")} · ${s.code}</div>
            <div class="drawer-title">${escapeHtml(s.name)} 상세</div>
          </div>
          <button type="button" class="drawer-close" aria-label="상세 닫기">닫기</button>
        </div>
        <div class="grid">
          <div class="col-12 stat-strip">${statRet}${statEtc}</div>
          <div class="panel col-7" style="min-height:340px">
            <div class="panel-title">${escapeHtml(s.name)} 캔들차트
              <span class="ma-legend"><i class="ma20"></i>20일선 <i class="ma60"></i>60일선</span>
              <span class="hint" id="detail-candle-hint">${State.period} · 기간 버튼 공유</span></div>
            <div class="chart-box" style="height:290px">
              <div id="detail-candle" style="height:100%"></div>
              <div id="detail-candle-empty" class="chart-empty" hidden>차트 데이터가 없습니다</div>
            </div>
          </div>
          <div class="col-5" style="display:flex;flex-direction:column;gap:var(--gap)">
            <div class="panel">
              <div class="panel-title">펀더멘털 <span class="hint">항목에 마우스를 올리면 설명</span><span style="margin-left:auto">${sentimentBadge(latestSentimentFor(s.code))}</span></div>
              <table class="fund-table">
                ${row("PER", f.per == null ? NBSP_DASH : f.per + "배")}
                ${row("PBR", f.pbr == null ? NBSP_DASH : f.pbr + "배")}
                ${row("EPS", won(f.eps))}
                ${row("배당수익률", pctv(f.dividendYield))}
                ${row("외국인 지분율", pctv(f.foreignOwnershipRate))}
                ${row("시가총액", fmtKrwUnit(f.marketCap))}
                ${row("52주 최고", fmtNum(f.high52w))}
                ${row("52주 최저", fmtNum(f.low52w))}
              </table>
            </div>
            <div class="panel" style="flex:1">
              <div class="panel-title">투자자 수급 누적 <span class="hint">외국인 / 기관 / 개인</span></div>
              <div class="chart-box" style="height:160px">
                <canvas id="detail-flow"></canvas>
                <div id="detail-flow-empty" class="chart-empty" hidden>수급 데이터가 없습니다</div>
              </div>
            </div>
          </div>
          <div class="panel col-12">
            <div class="panel-title">투자 포인트 <span class="hint">가격·수급·기술적 지표에서 자동 추출 — 참고용이며 투자 권유가 아닙니다</span></div>
            <div class="point-list">${aiRow}${pointRows}${!aiRow && !pointRows ? `<div class="news-empty">현재 특별한 시그널이 없습니다</div>` : ""}</div>
          </div>
          <div class="panel col-12">
            <div class="panel-title">${escapeHtml(s.name)} 뉴스 <span class="hint">${s.code}</span></div>
            <div id="detail-news"></div>
          </div>
        </div>`;

      box.querySelector(".drawer-close")?.addEventListener("click", () => this.closeDetail());
      if (open) this.openDetail();
      this._renderCandle(s);
      this._renderFlow(s);
      renderNewsList($("#detail-news"), (NEWS?.stockNews?.[s.code]) || [], { limit: 5, more: false });
      requestAnimationFrame(() => {
        box.classList.remove("chart-redraw");
        void box.offsetWidth;
        box.classList.add("chart-redraw");
        animateNumbers(box);
        replayChart(this.flow);
      });
    },

    _renderCandle(s) {
      const el = $("#detail-candle"), empty = $("#detail-candle-empty");
      if (!el || !window.LightweightCharts) return;
      if (this.candle) { try { this.candle.chart.remove(); } catch (e) {} this.candle = null; }
      const hist = filterByPeriod(s.history || [], State.period);
      if (!hist.length) { if (empty) empty.hidden = false; return; }
      if (empty) empty.hidden = true;

      const chart = LightweightCharts.createChart(el, {
        width: el.clientWidth, height: el.clientHeight,
        layout: { background: { color: "transparent" }, textColor: C.text, fontFamily: "inherit" },
        grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
        rightPriceScale: { borderColor: C.border },
        timeScale: { borderColor: C.border },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        localization: { priceFormatter: (p) => fmtNum(p, 0) },
      });
      const cs = chart.addCandlestickSeries({
        upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down,
        wickUpColor: C.up, wickDownColor: C.down,
      });
      const vs = chart.addHistogramSeries({
        priceScaleId: "", priceFormat: { type: "volume" }, color: C.panel2,
        lastValueVisible: false, priceLineVisible: false,
      });
      vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      cs.setData(hist.map((d) => ({ time: d.date, open: d.open, high: d.high, low: d.low, close: d.close })));
      vs.setData(hist.map((d) => ({
        time: d.date, value: d.volume ?? 0,
        color: d.close >= d.open ? "rgba(240,69,75,.35)" : "rgba(61,123,253,.35)",
      })));

      // 이동평균선 (전체 히스토리로 계산 → 표시 기간만 슬라이스)
      const all = s.history || [];
      const closesAll = all.map((d) => d.close);
      const maIdx = new Map(all.map((d, i) => [d.date, i]));
      [[20, C.accent], [60, C.warn]].forEach(([n, color]) => {
        const ma = Calc.sma(closesAll, n);
        const data = hist
          .map((d) => ({ time: d.date, value: ma[maIdx.get(d.date)] }))
          .filter((p) => p.value != null);
        if (data.length < 2) return;
        chart.addLineSeries({
          color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false,
        }).setData(data);
      });
      chart.timeScale().fitContent();
      const ro = new ResizeObserver(() => { try { chart.resize(el.clientWidth, el.clientHeight); } catch (e) {} });
      ro.observe(el);
      this.candle = { chart, ro };
    },

    _renderFlow(s) {
      const cv = $("#detail-flow"), empty = $("#detail-flow-empty");
      if (!cv || !window.Chart) return;
      if (this.flow) { try { this.flow.destroy(); } catch (e) {} this.flow = null; }
      const rows = filterByPeriod(s.investorTrends || [], State.period);
      if (!rows.length) { if (empty) empty.hidden = false; return; }
      if (empty) empty.hidden = true;

      const labels = rows.map((r) => r.date);
      const running = { foreign: 0, institution: 0, individual: 0 };
      const cum = { foreign: [], institution: [], individual: [] };
      rows.forEach((r) => ENTITIES.forEach((e) => {
        running[e.key] += (r[e.key] || 0); cum[e.key].push(running[e.key]);
      }));

      this.flow = new Chart(cv, {
        type: "line",
        data: {
          labels,
          datasets: ENTITIES.map((e) => ({
            label: e.name, data: cum[e.key], borderColor: e.color, backgroundColor: e.color,
            borderWidth: 1.6, pointRadius: 0, tension: 0.25, fill: false,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", align: "end",
              labels: { color: C.text, boxWidth: 8, boxHeight: 8, font: { size: 10 }, usePointStyle: true } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtEok(c.parsed.y, true)}` } },
          },
          scales: {
            x: { display: false },
            y: { grid: { color: C.grid }, ticks: { color: C.muted, font: { size: 9 }, callback: (v) => fmtEok(v) } },
          },
        },
      });
    },

    // 기간 변경(공유) 시 상세 차트만 갱신
    refreshCharts() {
      const s = this._stock(State.selectedStock);
      if (!s || !$("#detail-candle")) return;
      this._renderCandle(s);
      this._renderFlow(s);
      const hint = $("#detail-candle-hint");
      if (hint) hint.textContent = `${State.period} · 기간 버튼 공유`;
    },
  };

  window.DashStocks = Stocks;

  /* ---------- 7. 섹션 D — 뉴스 (P5) ---------- */

  const News = {
    init() {
      if (!NEWS) return;
      this._buildTabs();
      this._bindScope();
      this.render();
    },

    _buildTabs() {
      const wrap = $("#news-tabs");
      if (!wrap) return;
      const tabs = [{ id: "all", label: "전체" }, { id: "market", label: "시장" }];
      (STOCKS?.stocks || []).forEach((s) => tabs.push({ id: s.code, label: s.name }));
      wrap.innerHTML = tabs.map((t) =>
        `<button type="button" data-tab="${t.id}" class="${t.id === State.newsTab ? "active" : ""}">${escapeHtml(t.label)}</button>`).join("");
      wrap.querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => {
          State.newsTab = b.dataset.tab;
          State.newsExpanded = false;
          wrap.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
          this.render();
        }));
    },

    _bindScope() {
      const wrap = $("#news-scope");
      if (!wrap) return;
      wrap.querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => {
          State.newsScope = b.dataset.scope;
          State.newsExpanded = false;
          wrap.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
          this.render();
        }));
    },

    _collect() {
      let items = [];
      if (State.newsTab === "all") {
        items = [...(NEWS.marketNews || [])];
        Object.values(NEWS.stockNews || {}).forEach((arr) => items.push(...(arr || [])));
      } else if (State.newsTab === "market") {
        items = [...(NEWS.marketNews || [])];
      } else {
        items = [...((NEWS.stockNews || {})[State.newsTab] || [])];
      }
      if (State.newsScope !== "all") items = items.filter((n) => n.scope === State.newsScope);
      items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      return items;
    },

    render() {
      const items = this._collect();
      this._renderBrief(items);
      renderNewsList($("#news-list-wrap"), items, { limit: 8 });
    },

    _renderBrief(items) {
      const box = $("#news-brief");
      if (!box) return;
      if (!items.length) {
        box.innerHTML = `<div class="news-empty">뉴스가 없습니다</div>`;
        return;
      }
      const domestic = items.filter((n) => n.scope !== "global").length;
      const global = items.length - domestic;
      const latest = items[0];
      const related = {};
      (STOCKS?.stocks || []).forEach((s) => {
        related[s.name] = items.filter((n) => (n.title || "").includes(s.name)).length;
      });
      const topStock = Object.entries(related).sort((a, b) => b[1] - a[1])[0];
      box.innerHTML = `
        <div class="news-brief-main">
          <span class="news-brief-label">최신</span>
          <strong>${escapeHtml(latest.title || "")}</strong>
          <span>${escapeHtml(latest.source || "")} · ${relTime(latest.publishedAt)}</span>
        </div>
        <div class="news-brief-grid">
          <div><strong>${fmtNum(items.length)}</strong><span>전체 뉴스</span></div>
          <div><strong>${fmtNum(domestic)}</strong><span>국내</span></div>
          <div><strong>${fmtNum(global)}</strong><span>해외</span></div>
          <div><strong>${escapeHtml(topStock?.[0] || "시장")}</strong><span>최다 언급</span></div>
        </div>`;
    },
  };

  window.DashNews = News;

  /* ---------- 8. 섹션 E — AI 분석 리포트 (P5) ---------- */

  const Analysis = {
    init() {
      const list = ANALYSIS?.analyses;
      this._renderDisclaimer();
      if (!Array.isArray(list) || !list.length) { this._empty(); return; }
      State.analysisId = State.analysisId || list[0].id; // 최신 자동 선택
      this.renderPeriods();
      this.renderContent();
      this._bindKeys();
    },

    _list() { return ANALYSIS?.analyses || []; },
    _current() { return this._list().find((a) => a.id === State.analysisId) || this._list()[0]; },
    _isLatest(a) { return this._list()[0]?.id === a?.id; },
    _stockName(code) { return (STOCKS?.stocks || []).find((s) => s.code === code)?.name || code; },
    _fmtRange(p) { return `${(p?.from || "").replace(/-/g, ".")} ~ ${(p?.to || "").replace(/-/g, ".")}`; },

    renderPeriods() {
      const box = $("#analysis-periods");
      if (!box) return;
      const list = State.aiExpanded ? this._list() : this._list().slice(0, 8);
      box.innerHTML = list.map((a) => {
        const p = a.period || {};
        const range = `${(p.from || "").slice(5).replace(/-/g, ".")} ~ ${(p.to || "").slice(5).replace(/-/g, ".")}`;
        return `<button type="button" class="an-period ${a.id === State.analysisId ? "active" : ""}" data-id="${a.id}">
          <span class="ap-label">${escapeHtml(p.label || a.id)}</span>
          <span class="ap-range">${range}</span>
        </button>`;
      }).join("") + (this._list().length > list.length
        ? `<button type="button" class="list-more" data-more-analysis>이전 리포트 ${this._list().length - list.length}개 더보기</button>` : "");
      box.querySelectorAll(".an-period").forEach((b) =>
        b.addEventListener("click", () => {
          State.analysisId = b.dataset.id;
          this.renderPeriods();
          this.renderContent();
        }));
      box.querySelector("[data-more-analysis]")?.addEventListener("click", () => {
        State.aiExpanded = true;
        this.renderPeriods();
      });
    },

    _bullets(arr, cls, icon) {
      if (!Array.isArray(arr) || !arr.length) return "";
      return `<ul class="an-bullets ${cls}">${arr.map((x) => `<li>${icon}${escapeHtml(x)}</li>`).join("")}</ul>`;
    },

    renderContent() {
      const box = $("#analysis-content");
      if (!box) return;
      const a = this._current();
      if (!a) { box.innerHTML = `<div class="news-empty">분석 리포트가 없습니다</div>`; return; }

      const m = a.market || {};
      const past = !this._isLatest(a) ? `<span class="past-badge">과거 분석</span>` : "";
      const marketCard = `
        <div class="an-card decision-card">
          <div class="an-card-head">
            <span class="an-title">오늘의 AI 판단</span>
            ${sentimentBadge(m.sentiment)} ${past}
            <span class="an-period-tag">${escapeHtml(a.period?.label || "")} · ${this._fmtRange(a.period)}</span>
          </div>
          <p class="an-summary">${escapeHtml(m.summary || "")}</p>
          <div class="decision-grid">
            ${(m.keyPoints || []).slice(0, 2).map((x) => `<div class="decision-item positive"><span>체크</span>${escapeHtml(x)}</div>`).join("")}
            ${(m.riskFactors || []).slice(0, 2).map((x) => `<div class="decision-item risk"><span>주의</span>${escapeHtml(x)}</div>`).join("")}
          </div>
        </div>`;

      const stockCards = (a.stocks || []).map((st) => {
        return `<div class="an-stock-card">
          <div class="an-stock-head"><span class="ass-name">${escapeHtml(this._stockName(st.code))}</span>${sentimentBadge(st.sentiment)}</div>
          <p class="an-summary">${escapeHtml(st.summary || "")}</p>
        </div>`;
      }).join("");

      box.innerHTML = `${marketCard}
        <div class="an-stock-title">관심종목 한 줄 판단</div>
        <div class="an-stock-grid">${stockCards}</div>`;
    },

    _renderDisclaimer() {
      const el = $("#analysis-disclaimer");
      if (el) el.textContent = ANALYSIS?.meta?.disclaimer || "";
    },

    _empty() {
      const box = $("#analysis-content");
      if (box) box.innerHTML = `<div class="news-empty">분석 리포트가 없습니다</div>`;
    },

    // ←→ 키로 리포트 기간 이동
    _bindKeys() {
      document.addEventListener("keydown", (e) => {
        if (e.target.matches("input, textarea")) return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const list = this._list();
        const i = list.findIndex((a) => a.id === State.analysisId);
        if (i < 0) return;
        const next = e.key === "ArrowLeft" ? i - 1 : i + 1; // ←최신 →과거
        if (next < 0 || next >= list.length) return;
        State.analysisId = list[next].id;
        this.renderPeriods();
        this.renderContent();
      });
    },
  };

  window.DashAnalysis = Analysis;

  /* ---------- 9. 섹션 F — 섹터 히트맵 (P6) ---------- */

  const Heatmap = {
    init() {
      if (!STOCKS || !Array.isArray(STOCKS.stocks) || !STOCKS.stocks.length) return;
      this.render();
    },
    render() {
      const box = $("#heatmap");
      if (!box) return;
      const groups = {};
      STOCKS.stocks.forEach((s) => {
        const sec = s.sector || "기타";
        (groups[sec] = groups[sec] || []).push(s);
      });
      const tiles = Object.entries(groups)
        .map(([sec, list]) => {
          const avg = list.reduce((a, s) => a + (s.current.changeRate || 0), 0) / list.length;
          const alpha = Math.min(0.5, (Math.abs(avg) / 3) * 0.4 + 0.12);
          const base = avg > 0 ? "240,69,75" : avg < 0 ? "61,123,253" : "90,100,120";
          const bg = `rgba(${base},${alpha.toFixed(3)})`;
          const bd = `rgba(${base},${Math.min(0.7, alpha + 0.25).toFixed(3)})`;
          const rows = list.map((s) =>
            `<div class="heat-stock"><span>${escapeHtml(s.name)}</span>
              <span class="hs-rate ${dirClass(s.current.change)}">${dirSign(s.current.change)} ${Math.abs(s.current.changeRate).toFixed(2)}%</span></div>`).join("");
          return { avg, html: `<div class="heat-tile" style="background:${bg};border-color:${bd}">
            <div class="heat-head">
              <span class="heat-sector">${escapeHtml(sec)}</span>
              <span class="heat-rate ${dirClass(avg)}">${dirSign(avg)} ${Math.abs(avg).toFixed(2)}%</span>
            </div>
            <div class="heat-count">${list.length}종목</div>
            <div class="heat-stocks">${rows}</div>
          </div>` };
        })
        .sort((a, b) => b.avg - a.avg) // 등락률 높은 섹터 먼저
        .map((t) => t.html);
      box.innerHTML = `<div class="heatmap-grid">${tiles.join("")}</div>`;
    },
  };

  window.DashHeatmap = Heatmap;

  /* ---------- 9.5 계산 유틸 (지표/시그널) ---------- */

  // 거래일 근사: 1주=5, 1개월=21, 3개월=63, 6개월=126, 1년=248
  const RET_PERIODS = [
    { key: "1w", label: "1주", days: 5 },
    { key: "1m", label: "1개월", days: 21 },
    { key: "3m", label: "3개월", days: 63 },
    { key: "6m", label: "6개월", days: 126 },
    { key: "1y", label: "1년", days: 248 },
  ];

  const Calc = {
    // 단순이동평균 — 원본과 같은 길이 배열 (n-1 이전은 null)
    sma(values, n) {
      const out = new Array(values.length).fill(null);
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= n) sum -= values[i - n];
        if (i >= n - 1) out[i] = sum / n;
      }
      return out;
    },
    // 최근 n거래일 수익률 (%)
    returnOver(history, n) {
      if (!Array.isArray(history) || history.length < n + 1) return null;
      const a = history[history.length - 1].close;
      const b = history[history.length - 1 - n].close;
      return b ? (a / b - 1) * 100 : null;
    },
    // RSI(14) — Wilder 방식
    rsi(history, n = 14) {
      if (!Array.isArray(history) || history.length < n + 1) return null;
      const closes = history.map((d) => d.close);
      let gain = 0, loss = 0;
      for (let i = 1; i <= n; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gain += d; else loss -= d;
      }
      let avgG = gain / n, avgL = loss / n;
      for (let i = n + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        avgG = (avgG * (n - 1) + Math.max(d, 0)) / n;
        avgL = (avgL * (n - 1) + Math.max(-d, 0)) / n;
      }
      if (avgL === 0) return 100;
      return 100 - 100 / (1 + avgG / avgL);
    },
    // 당일 거래량 ÷ 직전 n일 평균 거래량 (배)
    volumeRatio(history, n = 20) {
      if (!Array.isArray(history) || history.length < n + 1) return null;
      const prev = history.slice(-n - 1, -1);
      const avg = prev.reduce((a, d) => a + (d.volume || 0), 0) / n;
      const today = history[history.length - 1].volume;
      return avg && today != null ? today / avg : null;
    },
    // 끝에서부터 같은 부호 연속 일수 → {days, sign, sum}
    streak(rows, key) {
      if (!Array.isArray(rows) || !rows.length) return { days: 0, sign: 0, sum: 0 };
      const sign = Math.sign(rows[rows.length - 1]?.[key] || 0);
      if (!sign) return { days: 0, sign: 0, sum: 0 };
      let days = 0, sum = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const v = rows[i][key] || 0;
        if (Math.sign(v) !== sign) break;
        days++; sum += v;
      }
      return { days, sign, sum };
    },
    // 최근 n행의 key 합계 (수급 누적)
    sumLast(rows, key, n) {
      return (rows || []).slice(-n).reduce((a, r) => a + (r[key] || 0), 0);
    },
    // 52주 밴드 내 현재가 위치 (0~100)
    band52w(c) {
      if (!c || c.price == null || c.high52w == null || c.low52w == null || c.high52w <= c.low52w) return null;
      return Math.max(0, Math.min(100, ((c.price - c.low52w) / (c.high52w - c.low52w)) * 100));
    },
    clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
  };
  window.DashCalc = Calc;

  /* ---------- 9.6 인사이트 엔진 (데이터 → 문장/뱃지) ---------- */

  // 종목별 시그널: [{tone: up|down|warn|flat, badge, text}]
  function stockSignals(s) {
    const sig = [];
    const c = s.current || {};
    const h = s.history || [];
    const closes = h.map((d) => d.close);

    // 52주 위치
    if (c.price != null && c.high52w) {
      if (c.price >= c.high52w * 0.99) {
        sig.push({ tone: "up", badge: "52주 신고가권",
          text: `현재가(${fmtNum(c.price)}원)가 52주 최고가 ${fmtNum(c.high52w)}원의 ${(c.price / c.high52w * 100).toFixed(1)}% 수준 — 신고가 부근에서 거래 중입니다.` });
      } else if (c.low52w && c.price <= c.low52w * 1.05) {
        sig.push({ tone: "down", badge: "52주 저가권",
          text: `현재가가 52주 최저가 ${fmtNum(c.low52w)}원 부근(5% 이내)입니다. 추세 바닥 확인이 필요한 구간입니다.` });
      }
    }

    // 거래량 급증
    const vr = Calc.volumeRatio(h, 20);
    if (vr != null && vr >= 2) {
      sig.push({ tone: "warn", badge: `거래량 ${vr.toFixed(1)}배`,
        text: `당일 거래량이 20일 평균의 ${vr.toFixed(1)}배 — 시장의 관심이 집중되고 있습니다. 급증 거래량은 방향 전환의 힌트가 되기도 합니다.` });
    }

    // 외국인/기관 연속 순매수·매도
    const trends = s.investorTrends || [];
    [["foreign", "외국인"], ["institution", "기관"]].forEach(([key, name]) => {
      const st = Calc.streak(trends, key);
      if (st.days >= 3) {
        const act = st.sign > 0 ? "매수" : "매도";
        sig.push({ tone: st.sign > 0 ? "up" : "down", badge: `${name} ${st.days}일 연속 ${act}`,
          text: `${name}이 ${st.days}거래일 연속 순${act} 중입니다 (누적 ${fmtEok(st.sum, true)}원). ${name} 수급은 중기 주가 방향과 상관이 높은 편입니다.` });
      }
    });

    // 이동평균 배열 + 골든/데드크로스 (최근 5거래일 내)
    const ma20a = Calc.sma(closes, 20), ma60a = Calc.sma(closes, 60);
    const ma20 = ma20a[ma20a.length - 1], ma60 = ma60a[ma60a.length - 1];
    if (ma20 != null && ma60 != null) {
      for (let i = Math.max(1, closes.length - 5); i < closes.length; i++) {
        if (ma20a[i - 1] == null || ma60a[i - 1] == null) continue;
        if (ma20a[i - 1] <= ma60a[i - 1] && ma20a[i] > ma60a[i]) {
          sig.push({ tone: "up", badge: "골든크로스",
            text: `20일 이동평균선이 60일선을 상향 돌파했습니다 (${h[i].date}). 중기 추세 전환 신호로 해석됩니다.` });
          break;
        }
        if (ma20a[i - 1] >= ma60a[i - 1] && ma20a[i] < ma60a[i]) {
          sig.push({ tone: "down", badge: "데드크로스",
            text: `20일 이동평균선이 60일선을 하향 이탈했습니다 (${h[i].date}). 추세 약화에 유의하세요.` });
          break;
        }
      }
      if (c.price > ma20 && ma20 > ma60) {
        sig.push({ tone: "up", badge: "정배열",
          text: "주가 > 20일선 > 60일선의 정배열 — 상승 추세가 유지되고 있습니다." });
      } else if (c.price < ma20 && ma20 < ma60) {
        sig.push({ tone: "down", badge: "역배열",
          text: "주가 < 20일선 < 60일선의 역배열 — 하락 추세 구간입니다. 반등 시에도 이평선 저항을 확인하세요." });
      }
    }

    // RSI 과열/과매도
    const rsi = Calc.rsi(h, 14);
    if (rsi != null) {
      if (rsi >= 70) sig.push({ tone: "warn", badge: `RSI ${Math.round(rsi)} 과열`,
        text: `RSI(14)가 ${rsi.toFixed(0)} — 단기 과열 구간입니다. 추격 매수보다는 눌림 확인이 유리할 수 있습니다.` });
      else if (rsi <= 30) sig.push({ tone: "warn", badge: `RSI ${Math.round(rsi)} 과매도`,
        text: `RSI(14)가 ${rsi.toFixed(0)} — 단기 과매도 구간으로, 기술적 반등이 나오기 쉬운 영역입니다.` });
    }

    return sig;
  }

  // 시장 인사이트: [{tone, text, target}]
  function marketInsights() {
    const out = [];
    if (!MARKET?.indices) return out;
    const push = (tone, text, target) => out.push({ tone, text, target });

    ["KOSPI", "KOSDAQ"].forEach((k) => {
      const idx = MARKET.indices[k];
      const c = idx?.current;
      const h = idx?.history || [];
      if (!c) return;

      const iga = josa(idx.name, "이", "가");
      // 큰 등락
      if (Math.abs(c.changeRate) >= 1) {
        push(dirClass(c.change),
          `${idx.name}${iga} 전일 대비 ${c.changeRate > 0 ? "+" : ""}${c.changeRate.toFixed(2)}% ${c.change > 0 ? "상승" : "하락"}하며 ${fmtNum(c.value, 2)}에 마감했습니다.`,
          "sec-market");
      }
      // 2년 최고/최저
      if (h.length >= 20) {
        const maxC = Math.max(...h.map((d) => d.close));
        const minC = Math.min(...h.map((d) => d.close));
        const last = h[h.length - 1].close;
        if (last >= maxC * 0.995) push("up", `${idx.name}${iga} 최근 2년 내 최고 수준에서 거래되고 있습니다.`, "sec-market");
        else if (last <= minC * 1.005) push("down", `${idx.name}${iga} 최근 2년 내 최저 수준입니다.`, "sec-market");
      }
      // 거래대금 이상 신호
      if (h.length >= 21) {
        const prev = h.slice(-21, -1);
        const avg = prev.reduce((a, d) => a + (d.tradingValue || 0), 0) / prev.length;
        const today = c.tradingValue ?? h[h.length - 1].tradingValue;
        if (avg && today) {
          const r = today / avg;
          if (r >= 1.3) push("warn", `${idx.name} 거래대금(${fmtKrwUnit(today)})이 20일 평균 대비 ${((r - 1) * 100).toFixed(0)}% 많습니다 — 시장 참여가 활발합니다.`, "sec-market");
          else if (r <= 0.7) push("flat", `${idx.name} 거래대금이 20일 평균 대비 ${((1 - r) * 100).toFixed(0)}% 적습니다 — 관망 분위기입니다.`, "sec-market");
        }
      }
      // 시장 폭 (등락 종목수)
      const adv = c.advancing || 0, dec = c.declining || 0;
      if (adv + dec > 0) {
        const ratio = adv / (adv + dec);
        if (ratio >= 0.7) push("up", `${idx.name} 상승 종목(${fmtNum(adv)})이 하락(${fmtNum(dec)})의 ${(adv / Math.max(dec, 1)).toFixed(1)}배 — 시장 전반이 폭넓게 강한 하루였습니다.`, "sec-market");
        else if (ratio <= 0.3) push("down", `${idx.name} 하락 종목(${fmtNum(dec)})이 상승(${fmtNum(adv)})을 압도 — 체감보다 시장이 약했습니다.`, "sec-market");
      }
      // 외국인 연속 수급
      const st = Calc.streak(MARKET.investorTrends?.[k] || [], "foreign");
      if (st.days >= 3) {
        push(st.sign > 0 ? "up" : "down",
          `외국인이 ${idx.name}를 ${st.days}거래일 연속 순${st.sign > 0 ? "매수" : "매도"} 중입니다 (누적 ${fmtEok(st.sum, true)}원).`,
          "sec-flow");
      }
    });

    // 오늘의 수급 구도 (코스피 기준)
    const rows = MARKET.investorTrends?.KOSPI || [];
    const last = rows[rows.length - 1];
    if (last) {
      const f = last.foreign || 0, i = last.institution || 0, p = last.individual || 0;
      if (f > 0 && i > 0 && p < 0)
        push("up", `오늘 코스피는 외국인(+${fmtEok(f)})·기관(+${fmtEok(i)})이 사고 개인(${fmtEok(p, true)})이 파는 구도 — 통상 수급상 우호적 신호로 봅니다.`, "sec-flow");
      else if (f < 0 && i < 0 && p > 0)
        push("down", `오늘 코스피는 외국인(${fmtEok(f, true)})·기관(${fmtEok(i, true)})이 팔고 개인이 받는 구도 — 반등 시 매물 부담에 유의하세요.`, "sec-flow");
    }

    // 환율
    const fx = MARKET.indices.USDKRW?.current;
    if (fx && Math.abs(fx.changeRate) >= 0.4) {
      const won = fx.change < 0 ? "원화 강세" : "원화 약세";
      push(fx.change < 0 ? "up" : "warn",
        `원/달러 환율이 ${fx.change > 0 ? "+" : ""}${fmtNum(fx.change, 2)}원 (${fmtNum(fx.value, 2)}원) — ${won}. ${fx.change < 0 ? "외국인 자금 유입에 우호적입니다." : "외국인 수급에 부담 요인입니다."}`,
        "sec-market");
    }

    // 관심종목 중 눈에 띄는 시그널 (종목당 1개, 강한 것 우선)
    (STOCKS?.stocks || []).forEach((s) => {
      const c = s.current || {};
      if (Math.abs(c.changeRate || 0) >= 3) {
        push(dirClass(c.change),
          `${s.name}${josa(s.name, "이", "가")} ${c.changeRate > 0 ? "+" : ""}${c.changeRate.toFixed(2)}% ${c.change > 0 ? "급등" : "급락"}했습니다 (${fmtNum(c.price)}원).`,
          "sec-stocks");
      } else {
        const top = stockSignals(s).find((x) => ["52주 신고가권", "골든크로스", "데드크로스"].includes(x.badge));
        if (top) push(top.tone, `${s.name} — ${top.text}`, "sec-stocks");
      }
    });

    return out.slice(0, 9);
  }

  // 시장 온도 (0~100): 지수 흐름 + 시장 폭 + 기관·외국인 수급
  function moodScore() {
    const k = MARKET?.indices?.KOSPI?.current;
    const q = MARKET?.indices?.KOSDAQ?.current;
    const idxPart = Calc.clamp((k?.changeRate || 0) * 8, -20, 20) + Calc.clamp((q?.changeRate || 0) * 4, -10, 10);
    const adv = k?.advancing || 0, dec = k?.declining || 0;
    const breadthPart = adv + dec ? Calc.clamp((adv / (adv + dec) - 0.5) * 60, -15, 15) : 0;
    const rows = MARKET?.investorTrends?.KOSPI || [];
    const last = rows[rows.length - 1];
    const flowPart = last ? Calc.clamp(((last.foreign || 0) + (last.institution || 0)) / 400, -15, 15) : 0;
    const score = Calc.clamp(50 + idxPart + breadthPart + flowPart, 0, 100);
    return { score, idxPart, breadthPart, flowPart };
  }

  function renderWatchTable(table, opts = {}) {
    if (!table || !STOCKS?.stocks?.length) return;
    const head = `<thead><tr>
      <th>종목</th><th class="num">현재가</th><th class="num">등락률</th>
      <th class="num">1주</th><th class="num">1개월</th><th class="num">3개월</th>
      <th class="num">외인 5일</th><th class="num">기관 5일</th>
      <th>52주 위치</th><th>시그널</th><th>AI</th>
    </tr></thead>`;
    const retCell = (v) => v == null ? `<td class="num flat">${NBSP_DASH}</td>`
      : `<td class="num ${dirClass(v)}">${v > 0 ? "+" : ""}${v.toFixed(1)}%</td>`;
    const eokCell = (v) => v == null
      ? `<td class="num flat">${NBSP_DASH}</td>`
      : `<td class="num ${dirClass(v)}">${fmtEok(v, true)}</td>`;
    const rows = STOCKS.stocks.map((s) => {
      const c = s.current || {};
      const band = Calc.band52w(c);
      const hasTrends = (s.investorTrends || []).length > 0;
      const f5 = hasTrends ? Calc.sumLast(s.investorTrends, "foreign", 5) : null;
      const i5 = hasTrends ? Calc.sumLast(s.investorTrends, "institution", 5) : null;
      const sigs = stockSignals(s).slice(0, 2);
      return `<tr data-code="${s.code}" tabindex="0">
        <td><strong>${escapeHtml(s.name)}</strong> <span class="wt-code">${s.code}</span></td>
        <td class="num"><strong class="tnum">${fmtNum(c.price)}</strong></td>
        <td class="num ${dirClass(c.change)}"><strong>${dirSign(c.change)} ${Math.abs(c.changeRate ?? 0).toFixed(2)}%</strong></td>
        ${retCell(Calc.returnOver(s.history, 5))}
        ${retCell(Calc.returnOver(s.history, 21))}
        ${retCell(Calc.returnOver(s.history, 63))}
        ${eokCell(f5)}
        ${eokCell(i5)}
        <td>${band == null ? NBSP_DASH : `<div class="wt-band"><div class="wt-band-track"><span style="left:${band.toFixed(1)}%"></span></div><span class="wt-band-pct tnum">${band.toFixed(0)}%</span></div>`}</td>
        <td>${sigs.map((x) => `<span class="sig-badge ${x.tone}" title="${escapeHtml(x.text)}">${escapeHtml(x.badge)}</span>`).join(" ") || `<span class="flat">${NBSP_DASH}</span>`}</td>
        <td>${sentimentBadge(latestSentimentFor(s.code))}</td>
      </tr>`;
    }).join("");
    table.innerHTML = head + `<tbody>${rows}</tbody>`;
    table.querySelectorAll("tbody tr").forEach((tr) => {
      const go = () => opts.onSelect ? opts.onSelect(tr.dataset.code) : null;
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    });
  }

  /* ---------- 9.7 섹션 T — 오늘의 브리핑 ---------- */

  const Briefing = {
    init() {
      if (!MARKET?.indices) return;
      this.renderMood();
      this.renderInsights();
      this.renderWatchlist();
      const dateEl = $("#brief-date");
      if (dateEl && MARKET.meta?.updatedAt) {
        dateEl.textContent = `${fmtDateTime(MARKET.meta.updatedAt)} 데이터 기준 자동 요약`;
      }
    },

    _moodLabel(score) {
      if (score >= 75) return { label: "매우 강세", cls: "up", note: "과열 여부도 함께 점검하세요" };
      if (score >= 60) return { label: "강세", cls: "up", note: "위험자산 선호가 우세합니다" };
      if (score >= 45) return { label: "중립", cls: "flat", note: "방향성 탐색 구간입니다" };
      if (score >= 30) return { label: "약세", cls: "down", note: "보수적 접근이 필요합니다" };
      return { label: "매우 약세", cls: "down", note: "리스크 관리가 우선입니다" };
    },

    renderMood() {
      const box = $("#brief-mood");
      if (!box) return;
      const m = moodScore();
      const meta = this._moodLabel(m.score);
      const compRow = (label, v, max) => {
        const pct = Calc.clamp((v / max) * 50, -50, 50);
        return `<div class="mood-comp">
          <span class="mc-label">${label}</span>
          <div class="mc-track">
            <span class="mc-bar ${v >= 0 ? "pos" : "neg"}" style="${v >= 0 ? `left:50%;width:${pct}%` : `right:50%;width:${-pct}%`}"></span>
            <span class="mc-mid"></span>
          </div>
          <span class="mc-val tnum ${dirClass(v)}">${v > 0 ? "+" : ""}${v.toFixed(0)}</span>
        </div>`;
      };
      const label = MARKET.indices?.KOSPI?.current?.changeRate >= 0 ? "강한 상승장" : "약한 흐름";
      const lead = MARKET.investorTrends?.KOSPI?.at(-1);
      const leadText = lead && (lead.foreign + lead.institution) > 0 ? "큰손 순매수" : "수급 확인 필요";
      box.innerHTML = `
        <div class="mood-head">
          <span class="mood-score tnum js-count ${meta.cls}" data-value="${Math.round(m.score)}">${Math.round(m.score)}</span>
          <div class="mood-desc">
            <span class="mood-label ${meta.cls}">${meta.label}</span>
            <span class="mood-note">${meta.note}</span>
          </div>
        </div>
        <div class="mood-pills">
          <span>${label}</span><span>${leadText}</span><span>관심종목 ${STOCKS?.stocks?.length || 0}개</span>
        </div>
        <div class="mood-meter"><span class="mood-marker" style="left:${m.score.toFixed(1)}%"></span></div>
        <div class="mood-scale"><span>침체</span><span>중립</span><span>과열</span></div>
        <div class="mood-comps">
          ${compRow("지수 흐름", m.idxPart, 30)}
          ${compRow("시장 폭", m.breadthPart, 15)}
          ${compRow("외인·기관 수급", m.flowPart, 15)}
        </div>
        <div class="mood-foot">코스피·코스닥 등락률, 상승/하락 종목수, 당일 외국인·기관 순매수를 종합한 참고 지표입니다.</div>`;
    },

    renderInsights() {
      const box = $("#brief-insights");
      if (!box) return;
      const items = marketInsights();
      const visible = State.insightsExpanded ? items : items.slice(0, 5);
      const ai = ANALYSIS?.analyses?.[0];
      const aiRow = ai?.market ? `
        <button type="button" class="insight-item ai" data-target="sec-ai">
          ${sentimentBadge(ai.market.sentiment)}
          <span class="ins-text">${escapeHtml(ai.market.summary || "")}</span>
          <span class="ins-go">AI 리포트 →</span>
        </button>` : "";
      const rows = visible.map((it) => `
        <button type="button" class="insight-item" data-target="${it.target}">
          <span class="ins-dot ${it.tone}"></span>
          <span class="ins-text">${escapeHtml(it.text)}</span>
          <span class="ins-go">보기 →</span>
        </button>`).join("");
      const more = items.length > visible.length
        ? `<button type="button" class="list-more" data-more-insights>시그널 ${items.length - visible.length}개 더보기</button>` : "";
      box.innerHTML = aiRow + (rows || `<div class="news-empty">오늘은 특별한 시그널이 없습니다</div>`) + more;
      box.querySelectorAll(".insight-item").forEach((b) =>
        b.addEventListener("click", () => {
          App.showView(b.dataset.target);
        }));
      box.querySelector("[data-more-insights]")?.addEventListener("click", () => {
        State.insightsExpanded = true;
        this.renderInsights();
      });
    },

    renderWatchlist() {
      const table = $("#brief-watchlist");
      renderWatchTable(table, {
        onSelect: (code) => {
          App.showView("sec-stocks");
          window.DashStocks?.select(code);
        },
      });
    },
  };

  window.DashBriefing = Briefing;

  /* ---------- 10. 부트스트랩 ---------- */
  function boot() {
    const missing = logSummary();

    if (missing.length === 4) {
      const main = $(".main");
      if (main) {
        main.innerHTML = `<div class="fatal-error">
          <strong>데이터를 불러오지 못했습니다.</strong><br>
          data/ 폴더의 market.js, stocks.js, news.js, analysis.js 파일이
          있는지 확인하세요. (생성: <code>python scripts/update_data.py</code>)
        </div>`;
      }
      return;
    }

    renderHeader();
    initNav();
    window.addEventListener("hashchange", () => {
      const id = (location.hash || "").replace("#", "");
      if (VIEW_IDS.includes(id)) App.showView(id, { skipHash: true });
    });
    Market.init();
    Flow.init();
    Stocks.init();
    News.init();
    Analysis.init();
    Heatmap.init();
    Briefing.init(); // 오늘의 브리핑 (인사이트/온도/워치리스트)
    animateCounts(); // 최초 로드 1회 카운트업
    document.body.classList.add("app-ready");
    const hashView = (location.hash || "").replace("#", "");
    if (VIEW_IDS.includes(hashView)) State.view = hashView;
    App.showView(State.view, { instant: true, skipHash: true });

    console.log("%c🧱 P1 · 📈 P2 · 💹 P3 · 🏷️ P4 · 📰 P5 · ✨ P6 폴리싱 렌더 완료", "color:#8b95ab");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
