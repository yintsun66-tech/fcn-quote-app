# FCN / DAC 詢價條件網頁

## 使用方式

以靜態網頁伺服器開啟此資料夾（例如 VS Code 的 Live Server），再開啟 `index.html`。請保留同資料夾內的 `交易所查詢0715.csv`，供 BBG Code 自動補正使用。

「發送詢價條件」會透過 `mailto:` 開啟裝置的預設電子郵件 App，並建立已帶入收件人與主旨的郵件草稿。網頁會同時將內嵌樣式的 HTML 詢價表格複製到剪貼簿；在郵件本文貼上後即可保留表格格式。瀏覽器無法強制指定特定 App；若手機將 Gmail 設為預設郵件 App，即會由 Gmail 開啟。

## 專案協作與後端文件

- [共同協作規範](AGENTS.md)
- [Claude Code 入口](CLAUDE.md)
- [目前交接狀態](docs/HANDOFF.md)
- [後端架構](docs/backend/architecture.md)
- [部署操作手冊](docs/runbooks/deploy.md)
- [管理者操作手冊](docs/runbooks/admin.md)
