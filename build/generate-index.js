// build/generate-index.js
// 在 Netlify build 階段執行：掃描 reports/ 內所有 .md 檔，
// 產生 reports/index.json（日期新到舊排序）。
// Codex 每天只需要負責寫入 reports/YYYY-MM-DD.md，不需要維護索引。

const fs = require("fs");
const path = require("path");

const REPORTS_DIR = path.join(__dirname, "..", "reports");
const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

function main() {
  if (!fs.existsSync(REPORTS_DIR)) {
    console.error(`找不到 reports 資料夾: ${REPORTS_DIR}`);
    process.exit(1);
  }

  const dates = fs
    .readdirSync(REPORTS_DIR)
    .map((file) => file.match(DATE_RE))
    .filter(Boolean)
    .map((match) => match[1])
    .sort()
    .reverse(); // 新到舊

  const indexPath = path.join(REPORTS_DIR, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(dates, null, 2));

  console.log(`已產生索引，共 ${dates.length} 篇報告 -> ${indexPath}`);
}

main();
