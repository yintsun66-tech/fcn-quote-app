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
升級／降級 PS、剔除一般帳號、ADMIN 永久刪除無詢價紀錄的已剔除帳號、
使用者申請審核、重複申請提示、以行編查詢帳號）。
新帳號申請只需分行名稱、五碼行編與密碼；核准後以五碼行編登入。既有帳號仍沿用
原本的登入名稱，不會被自動改名。

API 位於 `https://api.yintsun66.com`。後端程式、D1 migrations、Queue consumers、
Durable Object、R2 與測試位於 `backend/`。

完成詢價後，FCN 正式排名中的前四名或自選第五名可另開「市場與風險分析」頁。
Phase 1 只使用該筆經後端授權的單一發行機構報價；參考現價由使用者手動輸入並只
保存在目前瀏覽器，不會改變排名、寄件、報價圖或 D1。Phase 2 已加入使用者同意後才
載入的 TradingView 單一圖表，以及 Yahoo Finance、Google
Trends、Cboe 與 OIC 的主動外部連結；第三方資料不會進入正式排名。正式市場資料功能
已改用 SEC 與 Alpha Vantage：登入使用者可查看 SEC 公司／最近申報文件，空白的分析
現價欄位會自動帶入前一交易日美股收盤價。資料由 Worker 正規化、所有使用者共用 D1
短期快取，且明確標示時間與過期狀態；它不會寫回詢價條件、正式排名或報價圖。Secret
名稱、migration `0012` 與新版 Worker 已部署，但第一次正式請求只收到 Alpha Vantage
`Information` 回應，尚未取得可用市場資料；接手者應先確認 Key 來源與啟用狀態。
依 ADR 0024，市場熱門榜已改放在**首頁**，並比照 TradingView 自身的層級：上層為市場
（美股 → NASDAQ, NYSE, NYSE ARCA, OTC；日股 → TSE, NAG, FSE, SAPSE），下層為五種排行
（波動最大、大型股、現金最多、成交最活躍、營收最高）。五種排行以連結開啟 TradingView
官網，**美日皆可用**；美股另外內嵌即時熱門榜（需勾選同意才載入）。Alpha Vantage 現在
只負責「輸入標的參考現價」的前一日收盤價。
注意：TradingView **免費嵌入式 widget 無法提供這五種排行，也不支援日股**（`market: "japan"`
會回傳美股、`JP`／`JPX`／`TYO` 亦然），因此排行一律走官網連結；詳見 ADR 0024 實測表。
詳細規格與操作程序記錄於
[market-analysis-roadmap](docs/backend/market-analysis-roadmap.md)。

## 目前正式環境基線

- 正式後端來源分支為 `codex/market-analysis-phase2-4`，尚未合併至 `main`。
- 正式功能程式基線為 `a49fc5e`；實際最新分支 HEAD
  仍應以 Git history 與 [HANDOFF](docs/HANDOFF.md) 為準。
- 最新正式 Worker 版本為 `91dd551c-be59-494b-815e-423fbf99d6a3`（2026-07-30
  部署）。
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
  `0010`）實作，由 Worker 推導有效角色。遠端 D1 migrations 已套用至 `0012`。
- 新版主旨規則依第一筆交易決定 T+7 商品名稱：FCN 一律使用 `FCN(T+7)`；DAC
  家族在野村、DBS、SG、GS、CA 使用 `DRA(T+7)`，BMJB、UBS、CITI 使用
  `DAC(T+7)`；規則詳見 ADR 0014。
- Barclays 已回信但拒絕 Product=`DAC`，不是收信或 parser 遺失。Barclays 接受的
  DAC 商品代碼／主旨尚未確認，不可直接修改共用 BMJB 格式或猜成 `DRA`。
- 首頁「美股／日股熱門榜」（ADR 0024）在靜態版與 Cloudflare 版皆可使用；不需 API Key、
  不佔 Alpha Vantage 額度。五種排行以官網連結提供、美日皆可用；美股另內嵌即時熱門榜，
  需勾選同意才載入。**不可**把日股改成 `JP`／`JPX`／`TYO`（會顯示美股資料）。
- 目前驗證基線為 19 個測試檔、133 項測試；JavaScript 語法、TypeScript typecheck、
  完整測試及 Cloudflare Worker dry-run build 均通過。正式部署後 API health、授權
  邊界、新前端程式與快取版本均已驗證；Alpha Vantage 真實資料仍未成功正規化，是
  目前第一優先待確認事項，其次才是以真實手機／平板測試「下載報價圖」。
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
- [SEC／Alpha Vantage 公開資料操作手冊](docs/runbooks/market-context-operations.md)
