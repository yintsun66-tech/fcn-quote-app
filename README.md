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
15 分鐘報價期加 60 秒郵件轉送緩衝、經濟前四名加自選第五家比價、晚到報價版本化
重新排名、隨選報價圖（在使用者瀏覽器產生，DAC 產品加註浮動收益）、可恢復的
「我的詢價」工作區，以及 ADMIN／PS 管理功能（所有帳號列表與上次上線時間、
升級／降級 PS、剔除一般帳號、使用者申請審核、重複申請提示、以行編查詢帳號）。
新帳號申請只需分行名稱、五碼行編與密碼；核准後以五碼行編登入。既有帳號仍沿用
原本的登入名稱，不會被自動改名。

API 位於 `https://api.yintsun66.com`。後端程式、D1 migrations、Queue consumers、
Durable Object、R2 與測試位於 `backend/`。

## 目前正式環境基線

- 正式後端位於 `feature/subject-branch-correlation`，尚未合併至 `main`。
- 正式功能程式基線為 `7f1dca3`；實際最新分支 HEAD 請以 Git history 與
  [HANDOFF](docs/HANDOFF.md) 為準。
- 最新正式 Worker 版本為 `b18cba05-bd46-49b5-818e-71d36d9b9d39`（2026-07-28 部署）。
- 報價圖為**隨選產生**，不再自動產圖（ADR 0016）。圖片在使用者自己的瀏覽器
  光柵化（ADR 0017），不佔用 Cloudflare Browser Rendering 額度、也不寫入 R2；
  本機產圖失敗時會自動退回伺服器產圖。`AUTO_RANK_ONE_IMAGE="1"` 可恢復舊的
  自動產圖行為。
- html2canvas 已自行託管於 `vendor/`，不再從公用 CDN 載入（銀行網路常封鎖 CDN）。
  請勿編輯該檔；來源、SHA-256 與更新程序見 `vendor/README.md`。
- 正式時序為 7 分鐘暫定提醒、15 分鐘發行機構回覆期、其後 60 秒郵件轉送緩衝，
  最晚 16 分鐘建立正式排名。緩衝期間不可提早結束。
- 正式結果自動顯示經濟排名 1–4；第五列由使用者從前四名以外的有效發行機構選擇，
  並可產圖。晚到報價保留原始狀態，僅能由詢價本人或 ADMIN 建立新的不可變排名版本。
- 角色為 `USER｜PS｜ADMIN`；`PS` 以 `users.is_privileged_support` 旗標（migration
  `0010`）實作，由 Worker 推導有效角色。遠端 D1 migrations 已套用至 `0010`。
- 新版主旨規則依第一筆交易決定 T+7 商品名稱：FCN 一律使用 `FCN(T+7)`；DAC
  家族在野村、DBS、SG、GS、CA 使用 `DRA(T+7)`，BMJB、UBS、CITI 使用
  `DAC(T+7)`；規則詳見 ADR 0014。
- Barclays 已回信但拒絕 Product=`DAC`，不是收信或 parser 遺失。Barclays 接受的
  DAC 商品代碼／主旨尚未確認，不可直接修改共用 BMJB 格式或猜成 `DRA`。
- 目前驗證基線為 16 個測試檔、103 項測試；JavaScript 語法、TypeScript typecheck、
  完整測試及 Cloudflare Worker dry-run build 均通過。正式部署後 API health 與新前端
  程式標記已驗證，但尚未完成登入後的完整人工操作巡檢——其中**以真實手機／平板
  測試「下載報價圖」是目前最優先的待驗證項目**。
- GitHub Pages 靜態相容版位於 `https://yintsun66-tech.github.io/fcnV2/`，repository
  `yintsun66-tech/fcnV2` 的目前靜態程式 commit 為 `3ae50b7`。它只包含公開前端，
  不包含 Cloudflare 後端、登入、D1、郵件、排名或私人報價圖服務。

接手前應以 [HANDOFF](docs/HANDOFF.md) 的正式環境證據、已知缺口與下一步為準。
如需快速比較 Cloudflare 正式版、功能分支與 GitHub Pages 靜態版，請開啟
[版本與部署狀態](version-status.html)。

## 專案協作與後端文件

- [共同協作規範](AGENTS.md)
- [Claude Code 入口](CLAUDE.md)
- [目前交接狀態（接手前必讀）](docs/HANDOFF.md)
- [後端架構](docs/backend/architecture.md)
- [API 合約](docs/backend/contracts.md)
- [部署操作手冊](docs/runbooks/deploy.md)
- [管理者操作手冊](docs/runbooks/admin.md)
