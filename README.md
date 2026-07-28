# 每日工作日誌（Netlify 展示頁）

顯示 Codex 每日跨專案工作日誌，可依日期查詢。

## 結構

```
.
├── index.html              主頁面
├── style.css
├── app.js                  讀取 reports/index.json，解析並渲染當天報告
├── netlify.toml             build 設定
├── build/generate-index.js  掃描 reports/，產生日期索引
└── reports/
    ├── 2026-06-22.md        範例報告（可刪除）
    ├── 2026-06-23.md        範例報告（可刪除）
    └── index.json           自動產生，不需手動維護
```

**重點：Codex 每天只需要負責寫入一個檔案 `reports/YYYY-MM-DD.md`，索引由 `build/generate-index.js` 自動產生，不需要 Codex 額外維護 index.json。**

## 近 30 天總結

側邊日誌列最上方有一個「📊 近 30 天」入口，點選後會即時抓取過去 30 天內所有報告，依專案名稱聚合：

* 活動天數（該專案在這段期間有更新的天數）
* 完成事項總數
* 出現過的所有檔案路徑（去重）
* 最近一次更新日期

依活動天數排序，越常更新的專案排越前面。這個統計是前端即時運算（讀取已有的 `reports/*.md`），不需要額外存檔或後端，Codex 不需要為此多做任何事。

## 搜尋與排除

側邊日誌列提供跨報告搜尋。搜尋結果會讀取既有的 `reports/*.md`，不需要後端。

每日「完成內容」的單項可在網頁中排除；排除狀態存於瀏覽器 `localStorage`，只影響目前瀏覽器顯示，不會改寫原始報告檔。

## 報告檔案格式

`reports/YYYY-MM-DD.md` 必須符合以下格式（與優化後的工作日誌提示詞輸出格式一致）：

```markdown
### 完成內容

## 專案名稱

* 完成事項
* 完成事項

\`\`\`text
/path/to/file
\`\`\`

### 今日建議

## 專案名稱

* 下一步工作
```

若當天無任何符合條件的更新，完成內容區塊請保留文字「未找到可確認的專案更新」，頁面會自動顯示空狀態畫面。

## 部署狀態

目前已透過 [app.netlify.com/drop](https://app.netlify.com/drop) 完成首次部署，網站已上線。

## Codex 每日自動更新

Codex 內建 Netlify 外掛，每天巡檢完成後，依以下三步驟即可自動更新已上線的網站，不需要 GitHub、不需要設定任何憑證：

1. 將「完成內容」與「今日建議」依「報告檔案格式」寫入
   `<專案資料夾路徑>/reports/<前一個工作日日期 YYYY-MM-DD>.md`（已存在則覆蓋）
2. 在 `<專案資料夾路徑>` 內執行 `node build/generate-index.js`，重新產生 `reports/index.json`
3. 跟 Codex 說「部署到 Netlify」，由內建外掛完成部署

這三步已經寫進優化後的工作日誌提示詞最後一段（輸出存檔與部署），Codex 跑完每日回顧會自動接著做。

## 拖放部署疑難排解（僅供參考）

若之後需要重新手動拖放部署，瀏覽器拖整個資料夾時，子資料夾（例如 `build/`）有時不會完整帶上去，導致找不到 `build/generate-index.js`。建議直接拖 `.zip` 檔讓 Netlify 自動解壓，而不是先解壓再拖資料夾。

`netlify.toml` 的 build command 已設計成容錯：即使 `build/generate-index.js` 缺漏，也只會印出提示訊息並改用資料夾裡現有的 `reports/index.json`，不會讓整個部署失敗。

