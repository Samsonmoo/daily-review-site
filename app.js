// app.js — 載入日期索引、解析每日報告、渲染畫面

const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const HIDDEN_ITEMS_KEY = "dailyReviewHiddenItems.v1";
const SEARCH_DEBOUNCE_MS = 180;

let allDates = [];
let currentView = { type: "date", date: null };
let searchTimer = null;
const reportCache = new Map();

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return {
    label: dateStr,
    weekday: WEEKDAYS[d.getDay()],
  };
}

/**
 * 解析單篇報告 markdown。
 * 預期格式：
 *   ### 完成內容
 *   ## 專案名稱
 *   * 條目
 *   ```text
 *   /path
 *   ```
 *   ### 今日建議
 *   ## 專案名稱
 *   * 條目
 */
function parseReport(markdown) {
  const sections = markdown.split(/^### (完成內容|今日建議)\s*$/m);
  // sections[0] 是分割前的雜項（通常為空），之後是 [標題, 內容, 標題, 內容...]
  const result = { completed: [], suggestions: [], noUpdate: false };

  for (let i = 1; i < sections.length; i += 2) {
    const label = sections[i];
    const body = sections[i + 1] || "";

    if (label === "完成內容") {
      result.completed = parseProjects(body);
      if (body.includes("未找到可確認的專案更新")) {
        result.noUpdate = true;
      }
    } else if (label === "今日建議") {
      result.suggestions = parseProjects(body);
    }
  }

  return result;
}

function parseProjects(body) {
  const parts = body.split(/^## /m).slice(1); // 拿掉第一個空段
  return parts.map((part) => {
    const fullHeader = "## " + part;
    const headerMatch = fullHeader.match(/^## (.+?)\s*\n/);
    const name = headerMatch ? formatProjectName(headerMatch[1]) : "未命名專案";
    const rest = headerMatch ? fullHeader.slice(headerMatch[0].length) : part;

    // 抽出 code block（路徑）
    const codeBlocks = [...rest.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(
      (m) => m[1].trim()
    );
    const withoutCode = rest.replace(/```[a-z]*\n[\s\S]*?```/g, "");

    const items = [...withoutCode.matchAll(/^\* (.+)$/gm)].map((m) => m[1].trim());

    return { name, items, paths: codeBlocks.join("\n") };
  });
}

function formatProjectName(rawName) {
  const name = rawName.trim();
  const tickedPath = name.match(/^`([^`]+)`\s*(.*)$/);

  if (tickedPath) {
    const baseName = getPathBaseName(tickedPath[1]);
    const suffix = tickedPath[2].trim();
    return suffix ? `${baseName} ${suffix}` : baseName;
  }

  if (/^[A-Za-z]:[\\/]/.test(name)) {
    const [pathPart, ...suffixParts] = name.split(/\s+/);
    const baseName = getPathBaseName(pathPart);
    const suffix = suffixParts.join(" ").trim();
    return suffix ? `${baseName} ${suffix}` : baseName;
  }

  return name;
}

function getPathBaseName(pathText) {
  return pathText.split(/[\\/]+/).filter(Boolean).pop() || pathText;
}

function getCompletedItemKey(date, projectName, itemIndex, text) {
  return [date, "completed", projectName, itemIndex, text].join("\u001f");
}

function getHiddenItems() {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_ITEMS_KEY) || "{}");
  } catch {
    return {};
  }
}

function setItemHidden(itemKey, hidden) {
  const hiddenItems = getHiddenItems();
  if (hidden) {
    hiddenItems[itemKey] = true;
  } else {
    delete hiddenItems[itemKey];
  }
  localStorage.setItem(HIDDEN_ITEMS_KEY, JSON.stringify(hiddenItems));
}

function isItemHidden(itemKey) {
  return Boolean(getHiddenItems()[itemKey]);
}

function getCompletedItems(date, project) {
  return project.items.map((text, index) => ({
    id: getCompletedItemKey(date, project.name, index, text),
    text,
    projectName: project.name,
    index,
  }));
}

function getVisibleCompletedProjects(date, report) {
  return report.completed
    .map((project) => ({
      ...project,
      visibleItems: getCompletedItems(date, project).filter((item) => !isItemHidden(item.id)),
    }))
    .filter((project) => project.visibleItems.length > 0);
}

function getHiddenCompletedItems(date, report) {
  return report.completed.flatMap((project) =>
    getCompletedItems(date, project).filter((item) => isItemHidden(item.id))
  );
}

function renderReport(dateInfo, report) {
  const main = document.getElementById("main-content");
  const visibleCompleted = getVisibleCompletedProjects(dateInfo.label, report);
  const hiddenCompleted = getHiddenCompletedItems(dateInfo.label, report);

  if (
    report.noUpdate ||
    (visibleCompleted.length === 0 && hiddenCompleted.length === 0 && report.suggestions.length === 0)
  ) {
    main.innerHTML = `
      <div class="main-header">
        <h1 class="main-date">${dateInfo.label}<span class="weekday">${dateInfo.weekday}</span></h1>
      </div>
      <div class="empty-state">該日未找到可確認的專案更新。</div>
    `;
    return;
  }

  const completedHtml = visibleCompleted
    .map((p) => {
      const pathsHtml = p.paths
        ? `<pre>${escapeHtml(p.paths)}</pre>`
        : "";
      return `
        <div class="project-card">
          <h3 class="project-name">${escapeHtml(p.name)}</h3>
          <ul>${p.visibleItems.map((i) => completedItemHtml(i)).join("")}</ul>
          ${pathsHtml}
        </div>
      `;
    })
    .join("");

  const excludedHtml = hiddenCompleted.length
    ? `
      <details class="excluded-panel">
        <summary>已排除 ${hiddenCompleted.length} 項</summary>
        <ul>${hiddenCompleted.map((item) => excludedItemHtml(item)).join("")}</ul>
      </details>
    `
    : "";

  const suggestionsHtml = report.suggestions
    .map(
      (p) => `
        <div class="suggestion-card">
          <h4 class="suggestion-name">${escapeHtml(p.name)}</h4>
          <ul>${p.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        </div>
      `
    )
    .join("");

  main.innerHTML = `
    <div class="main-header">
      <h1 class="main-date">${dateInfo.label}<span class="weekday">${dateInfo.weekday}</span></h1>
    </div>
    ${
      visibleCompleted.length || hiddenCompleted.length
        ? `<div class="section-label">完成內容</div>${completedHtml}${excludedHtml}`
        : ""
    }
    ${report.suggestions.length ? `<div class="section-label">今日建議</div>${suggestionsHtml}` : ""}
  `;
}

function completedItemHtml(item) {
  return `
    <li class="completed-item">
      <span>${escapeHtml(item.text)}</span>
      <button class="item-action" type="button" data-hide-item="${escapeHtml(item.id)}" title="排除此完成項目" aria-label="排除此完成項目">×</button>
    </li>
  `;
}

function excludedItemHtml(item) {
  return `
    <li class="excluded-item">
      <span><strong>${escapeHtml(item.projectName)}</strong>：${escapeHtml(item.text)}</span>
      <button class="item-action restore-action" type="button" data-restore-item="${escapeHtml(item.id)}">還原</button>
    </li>
  `;
}

/**
 * 聚合一段期間內的報告，依專案名稱統計：
 * - 活動天數（出現在「完成內容」的天數）
 * - 完成事項總數
 * - 出現過的路徑（去重）
 * - 最近一次更新日期
 */
function aggregateReports(dateReports) {
  const projects = new Map();
  let activeDays = 0;
  let noUpdateDays = 0;

  for (const { date, report } of dateReports) {
    if (report.noUpdate || report.completed.length === 0) {
      noUpdateDays++;
      continue;
    }

    let hasVisibleUpdate = false;
    for (const p of report.completed) {
      const visibleItems = getCompletedItems(date, p).filter((item) => !isItemHidden(item.id));
      if (visibleItems.length === 0) continue;

      if (!projects.has(p.name)) {
        projects.set(p.name, { days: new Set(), items: [], paths: new Set(), lastDate: date });
      }
      const entry = projects.get(p.name);
      entry.days.add(date);
      visibleItems.forEach((item) => entry.items.push({ date, text: item.text }));
      if (p.paths) {
        p.paths.split("\n").filter(Boolean).forEach((path) => entry.paths.add(path));
      }
      if (date > entry.lastDate) entry.lastDate = date;
      hasVisibleUpdate = true;
    }

    if (hasVisibleUpdate) {
      activeDays++;
    } else {
      noUpdateDays++;
    }
  }

  const projectList = [...projects.entries()]
    .map(([name, v]) => ({
      name,
      activeDays: v.days.size,
      items: v.items.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0)),
      paths: [...v.paths],
      lastDate: v.lastDate,
    }))
    .sort((a, b) => b.activeDays - a.activeDays || b.items.length - a.items.length);

  return { projectList, activeDays, noUpdateDays, totalDays: dateReports.length };
}

function renderSummary(rangeLabel, summary) {
  const main = document.getElementById("main-content");

  const cardsHtml = summary.projectList
    .map((p) => {
      const itemsHtml = p.items
        .map((it) => {
          const shortDate = it.date.slice(5); // MM-DD
          return `<li><span class="item-date">${escapeHtml(shortDate)}</span>${escapeHtml(it.text)}</li>`;
        })
        .join("");
      const pathsHtml = p.paths.length
        ? `<pre>${escapeHtml(p.paths.join("\n"))}</pre>`
        : "";
      return `
        <div class="project-card summary-card">
          <h3 class="project-name">${escapeHtml(p.name)}</h3>
          <div class="summary-stats">
            <span class="stat"><strong>${p.activeDays}</strong> 天有更新</span>
            <span class="stat"><strong>${p.items.length}</strong> 項完成事項</span>
            <span class="stat-date">最近更新 ${p.lastDate}</span>
          </div>
          <ul>${itemsHtml}</ul>
          ${pathsHtml}
        </div>
      `;
    })
    .join("");

  main.innerHTML = `
    <div class="main-header">
      <h1 class="main-date">近 30 天總結<span class="weekday">${rangeLabel}</span></h1>
    </div>
    <div class="summary-overview">
      <span class="stat"><strong>${summary.activeDays}</strong> / ${summary.totalDays} 天有更新</span>
      <span class="stat"><strong>${summary.projectList.length}</strong> 個專案</span>
    </div>
    ${
      summary.projectList.length
        ? `<div class="section-label">專案統計</div>${cardsHtml}`
        : `<div class="empty-state">這段期間沒有可統計的專案更新。</div>`
    }
  `;
}

async function loadReport(date) {
  if (reportCache.has(date)) return reportCache.get(date);

  const res = await fetch(`reports/${date}.md`);
  if (!res.ok) throw new Error(`找不到報告：${date}`);
  const markdown = await res.text();
  const report = parseReport(markdown);
  reportCache.set(date, report);
  return report;
}

async function loadSummary() {
  const main = document.getElementById("main-content");
  currentView = { type: "summary", date: null };
  main.innerHTML = `<div class="empty-state">載入中…</div>`;

  document.querySelectorAll(".ledger-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.summary === "true");
  });

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const datesInRange = allDates.filter((d) => new Date(d + "T00:00:00") >= cutoff);

    const dateReports = (
      await Promise.all(
        datesInRange.map(async (date) => {
          try {
            return { date, report: await loadReport(date) };
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);

    const summary = aggregateReports(dateReports);
    const rangeLabel = datesInRange.length
      ? `${datesInRange[datesInRange.length - 1]} ~ ${datesInRange[0]}`
      : "";

    renderSummary(rangeLabel, summary);
  } catch (err) {
    main.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(err.message)}</div>`;
  }
}

function normalizeSearchText(text) {
  return text.toLowerCase();
}

function matchesSearch(text, query) {
  return normalizeSearchText(text).includes(normalizeSearchText(query));
}

function collectSearchResults(date, report, query) {
  const results = [];

  for (const project of report.completed) {
    for (const item of getCompletedItems(date, project)) {
      if (isItemHidden(item.id)) continue;

      const haystack = [date, "完成內容", project.name, item.text, project.paths].join("\n");
      if (matchesSearch(haystack, query)) {
        results.push({
          date,
          section: "完成內容",
          projectName: project.name,
          text: item.text,
          itemId: item.id,
        });
      }
    }
  }

  for (const project of report.suggestions) {
    project.items.forEach((text) => {
      const haystack = [date, "今日建議", project.name, text, project.paths].join("\n");
      if (matchesSearch(haystack, query)) {
        results.push({
          date,
          section: "今日建議",
          projectName: project.name,
          text,
          itemId: null,
        });
      }
    });
  }

  return results;
}

async function loadSearch(query) {
  const main = document.getElementById("main-content");
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    await refreshCurrentView();
    return;
  }

  main.innerHTML = `<div class="empty-state">搜尋中…</div>`;
  document.querySelectorAll(".ledger-item").forEach((el) => el.classList.remove("active"));

  try {
    const resultGroups = [];
    for (const date of allDates) {
      const report = await loadReport(date);
      const results = collectSearchResults(date, report, trimmedQuery);
      resultGroups.push(...results);
    }
    renderSearchResults(trimmedQuery, resultGroups);
  } catch (err) {
    main.innerHTML = `<div class="empty-state">搜尋失敗：${escapeHtml(err.message)}</div>`;
  }
}

function renderSearchResults(query, results) {
  const main = document.getElementById("main-content");
  const grouped = new Map();

  for (const result of results) {
    const key = [result.date, result.projectName, result.section].join("\u001f");
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: result.date,
        projectName: result.projectName,
        section: result.section,
        items: [],
      });
    }
    grouped.get(key).items.push(result);
  }

  const cardsHtml = [...grouped.values()]
    .map((group) => {
      const itemsHtml = group.items
        .map((item) =>
          item.itemId
            ? completedItemHtml({ id: item.itemId, text: item.text })
            : `<li>${escapeHtml(item.text)}</li>`
        )
        .join("");

      return `
        <div class="project-card search-card">
          <h3 class="project-name">${escapeHtml(group.projectName)}</h3>
          <div class="search-meta">
            <span>${escapeHtml(group.date)}</span>
            <span>${escapeHtml(group.section)}</span>
          </div>
          <ul>${itemsHtml}</ul>
        </div>
      `;
    })
    .join("");

  main.innerHTML = `
    <div class="main-header">
      <h1 class="main-date">搜尋<span class="weekday search-query">${escapeHtml(query)}</span></h1>
    </div>
    <div class="summary-overview">
      <span class="stat"><strong>${results.length}</strong> 項符合</span>
    </div>
    ${results.length ? cardsHtml : `<div class="empty-state">找不到符合的工作日誌。</div>`}
  `;
}

function getSearchQuery() {
  const input = document.getElementById("search-input");
  return input ? input.value.trim() : "";
}

function clearSearchInput() {
  const input = document.getElementById("search-input");
  if (input) input.value = "";
}

function initSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;

  input.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const query = getSearchQuery();
      if (query) {
        void loadSearch(query);
      } else {
        void refreshCurrentView();
      }
    }, SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value) {
      input.value = "";
      void refreshCurrentView();
    }
  });
}

function initItemActions() {
  const main = document.getElementById("main-content");
  main.addEventListener("click", (event) => {
    const hideButton = event.target.closest("[data-hide-item]");
    const restoreButton = event.target.closest("[data-restore-item]");
    if (!hideButton && !restoreButton) return;

    const itemKey = hideButton?.dataset.hideItem || restoreButton?.dataset.restoreItem;
    setItemHidden(itemKey, Boolean(hideButton));
    void refreshCurrentView();
  });
}

async function refreshCurrentView() {
  const query = getSearchQuery();
  if (query) {
    await loadSearch(query);
    return;
  }

  if (currentView.type === "summary") {
    await loadSummary();
  } else if (currentView.date) {
    await loadDate(currentView.date);
  } else if (allDates.length > 0) {
    await loadDate(allDates[0]);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadDate(dateStr) {
  currentView = { type: "date", date: dateStr };
  const report = await loadReport(dateStr);
  renderReport(formatDate(dateStr), report);

  document.querySelectorAll(".ledger-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.date === dateStr);
  });
}

function renderLedger(dates) {
  const list = document.getElementById("ledger-list");

  const summaryItemHtml = `
    <li class="ledger-item summary-item" data-summary="true" tabindex="0" role="button">
      <div class="ledger-date">📊 近 30 天</div>
      <div class="ledger-weekday">總結</div>
    </li>
  `;

  if (dates.length === 0) {
    list.innerHTML = summaryItemHtml + `<li class="ledger-empty">尚無任何報告</li>`;
  } else {
    list.innerHTML =
      summaryItemHtml +
      dates
        .map((dateStr) => {
          const { weekday } = formatDate(dateStr);
          return `
            <li class="ledger-item" data-date="${dateStr}" tabindex="0" role="button">
              <div class="ledger-date">${dateStr}</div>
              <div class="ledger-weekday">${weekday}</div>
            </li>
          `;
        })
        .join("");
  }

  const summaryEl = list.querySelector(".summary-item");
  summaryEl.addEventListener("click", () => {
    clearSearchInput();
    loadSummary();
  });
  summaryEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      clearSearchInput();
      loadSummary();
    }
  });

  list.querySelectorAll(".ledger-item:not(.summary-item)").forEach((el) => {
    el.addEventListener("click", () => {
      clearSearchInput();
      loadDate(el.dataset.date);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        clearSearchInput();
        loadDate(el.dataset.date);
      }
    });
  });
}

async function init() {
  const main = document.getElementById("main-content");
  initSearch();
  initItemActions();

  try {
    const res = await fetch("reports/index.json");
    if (!res.ok) throw new Error("索引載入失敗");
    allDates = await res.json();

    renderLedger(allDates);

    if (allDates.length > 0) {
      await loadDate(allDates[0]);
    } else {
      main.innerHTML = `<div class="empty-state">尚無任何報告。Codex 完成第一次工作日誌後將自動出現於此。</div>`;
    }
  } catch (err) {
    main.innerHTML = `<div class="empty-state">載入失敗：${escapeHtml(err.message)}</div>`;
  }
}

init();
