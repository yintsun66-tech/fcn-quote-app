# FCN / DAC 詢價與自動比價系統

## 兩種執行模式

### 靜態相容模式

以靜態網頁伺服器開啟此資料夾（例如 VS Code 的 Live Server），再開啟
`index.html`。請保留同資料夾內的 `交易所查詢0715.csv`，供 BBG Code 自動補正使用。

此模式仍保留 GitHub Pages 相容性。「發送詢價條件」會使用 `mailto:` 開啟裝置的預設
郵件 App，並把 HTML 詢價表格複製到剪貼簿供使用者手動貼上。

### Cloudflare 正式模式

正式應用位於 `https://app.yintsun66.com`。同一套根目錄資產由 Cloudflare Worker
提供，並透過 `backend-client.js` 加入登入、可勾選發行機構的後端自動寄信、回覆解析、
前五名比價、私人報價圖（DAC 產品加註浮動收益）、可恢復的「我的詢價」工作區，以及
ADMIN／PS 管理功能（所有帳號列表與上次上線時間、升級／降級 PS、剔除一般帳號、
使用者申請審核、重複申請提示、以行編查詢帳號）。

API 位於 `https://api.yintsun66.com`。後端程式、D1 migrations、Queue consumers、
Durable Object、R2 與測試位於 `backend/`。

## 目前正式環境基線

- 正式後端位於 `feature/subject-branch-correlation`，尚未合併至 `main`。
- 最新正式 Worker 版本為 `566c7456-7e0f-42ac-9341-823c533ead71`（2026-07-27 部署）。
- 角色為 `USER｜PS｜ADMIN`；`PS` 以 `users.is_privileged_support` 旗標（migration
  `0010`）實作，由 Worker 推導有效角色。遠端 D1 migrations 已套用至 `0010`。
- 新版主旨規則依第一筆交易決定 T+7 商品名稱：FCN 一律使用 `FCN(T+7)`；DAC
  家族在野村、DBS、SG、GS、CA 使用 `DRA(T+7)`，BMJB、UBS、CITI 使用
  `DAC(T+7)`；規則詳見 ADR 0014。
- Barclays 已回信但拒絕 Product=`DAC`，不是收信或 parser 遺失。Barclays 接受的
  DAC 商品代碼／主旨尚未確認，不可直接修改共用 BMJB 格式或猜成 `DRA`。

接手前應以 [HANDOFF](docs/HANDOFF.md) 的正式環境證據、已知缺口與下一步為準。

## 專案協作與後端文件

- [共同協作規範](AGENTS.md)
- [Claude Code 入口](CLAUDE.md)
- [目前交接狀態（接手前必讀）](docs/HANDOFF.md)
- [後端架構](docs/backend/architecture.md)
- [API 合約](docs/backend/contracts.md)
- [部署操作手冊](docs/runbooks/deploy.md)
- [管理者操作手冊](docs/runbooks/admin.md)
