# FCN / DAC 詢價與自動比價系統

## 兩種執行模式

### 靜態相容模式

以靜態網頁伺服器開啟此資料夾（例如 VS Code 的 Live Server），再開啟
`index.html`。請保留同資料夾內的 `交易所查詢0715.csv`，供 BBG Code 自動補正使用。

此模式仍保留 GitHub Pages 相容性。「發送詢價條件」會使用 `mailto:` 開啟裝置的預設
郵件 App，並把 HTML 詢價表格複製到剪貼簿供使用者手動貼上。

### Cloudflare 正式模式

正式應用位於 `https://app.yintsun66.com`。同一套根目錄資產由 Cloudflare Worker
提供，並透過 `backend-client.js` 加入登入、後端自動寄信、回覆解析、前五名比價、
私人報價圖、可恢復的「我的詢價」工作區及 ADMIN 管理功能。

API 位於 `https://api.yintsun66.com`。後端程式、D1 migrations、Queue consumers、
Durable Object、R2 與測試位於 `backend/`。

## 專案協作與後端文件

- [共同協作規範](AGENTS.md)
- [Claude Code 入口](CLAUDE.md)
- [目前交接狀態（接手前必讀）](docs/HANDOFF.md)
- [後端架構](docs/backend/architecture.md)
- [API 合約](docs/backend/contracts.md)
- [部署操作手冊](docs/runbooks/deploy.md)
- [管理者操作手冊](docs/runbooks/admin.md)
