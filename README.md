# FCN / DAC 詢價與自動比價系統

## 兩種執行模式

## 跟單專區

`follow-board.html` 是靜態相容模式與 Cloudflare 應用共用的獨立跟單頁。訪客不需註冊，
只需輸入由管理者提供的四位數密碼，即可查看與正式商品圖相同的完整商品卡；點擊
「下載商品圖」會在新分頁預覽，再由使用者下載含商品代碼的 PNG。跟單按鈕會先提示
使用者以 LINE 或電話聯繫高資產業務處同事或信託處，再保留既有意向登記流程。
公開表格只顯示遮蔽行編；完整資料限
ADMIN／PS 於後端網站查看。

商品列表在「可跟單至」下方顯示「手收」：一般發行機構為
`100 - NotePrice/Cost/Offer Price`，CITI 則直接使用原始 Upfront。

商品由授權的 First Bank 信箱回覆原詢價執行緒後自動上架。發行機構及商品條件完全
取自郵件內唯一一筆完整報價；相同的重複表格會合併，`deal-N` 只供相容與稽核，
不會選擇報價列，也不會從系統既有排名猜測。主旨使用
`0730 deal-03 PBZL BNP跟單20260730`：`BNP` 必須與報價表格辨識機構相同，
末八碼是商品可跟單至該日的自動下架日期。
同一封信也可用格式
`0728 deal2~4 PBZB, PBZC, PBZD, SG跟單20260815` 一次上架多筆商品；
代碼依序對應前方筆數相符的完整報價表格。後方較大的歷史回覆表格不會混入，
任何數量、機構或候選內容不一致都會整批停止而不會部分上架。到期商品只會自動
轉為下架並保留稽核資料，不會永久刪除。
操作格式、失敗診斷、下架方式及部署前置條件請見
[follow-board operations](docs/runbooks/follow-board-operations.md)。

### 靜態相容模式

以靜態網頁伺服器開啟此資料夾（例如 VS Code 的 Live Server），再開啟
`index.html`。請保留同資料夾內的 `交易所查詢0715.csv`，供 BBG Code 自動補正使用。

此模式仍保留 GitHub Pages 相容性。「發送詢價條件」會先把 HTML 詢價表格複製到
剪貼簿，再讓使用者選擇裝置的預設郵件 App（`mailto:`）或已在同一個瀏覽器登入的
Zimbra 網頁版。Zimbra 網址只保存在該瀏覽器，不會上傳；網頁不會代替使用者按下寄出。
Cloudflare 正式模式的「手動貼郵件詢價」也共用此備援流程，後端自動寄信功能不受影響。

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
已改用 SEC 與 **Twelve Data**：登入使用者可查看 SEC 公司／最近申報文件，空白的分析
現價欄位會自動帶入**前一個已收盤美股交易日**的收盤價。資料由 Worker 正規化、所有使用者
共用 D1 短期快取，且明確標示時間與過期狀態；它不會寫回詢價條件、正式排名或報價圖。
收盤價供應鏈為 **Twelve Data → Alpha Vantage**，先成功者勝，回應中會標示實際供應者
（`provider`）並顯示在畫面上 —— **不可假設價格來自你記得設定的那一家**。2026-08-01 已在
正式環境驗證：Twelve Data 首選命中、無退回，且數值與另一個獨立來源的同日收盤一致。
Alpha Vantage 仍失敗但已無人依賴；不得恢復已移除的 movers API。
注意「已收盤」的判定：台北早上就是紐約前一晚，該盤在紐約日期上是**當天**，
所以任何「前一個日曆日」規則都會取錯一盤（詳見 API 合約的收盤價章節）。
依 ADR 0024，市場熱門榜已改放在**首頁**，並比照 TradingView 自身的層級：上層為市場
（美股 → NASDAQ, NYSE, NYSE ARCA, OTC；日股 → TSE, NAG, FSE, SAPSE），下層為五種排行
（波動最大、大型股、現金最多、成交最活躍、營收最高）。五種排行以連結開啟 TradingView
官網，**美日皆可用**；美股另外內嵌即時熱門榜（需勾選同意才載入）。熱門榜不消耗任何
報價 API 額度，與「輸入標的參考現價」的收盤價供應鏈完全無關。
注意：TradingView **免費嵌入式 widget 無法提供這五種排行，也不支援日股**（`market: "japan"`
會回傳美股、`JP`／`JPX`／`TYO` 亦然），因此排行一律走官網連結；詳見 ADR 0024 實測表。
詳細規格與操作程序記錄於
[market-analysis-roadmap](docs/backend/market-analysis-roadmap.md)。

## 目前正式環境基線

- 正式後端來源分支為 `codex/market-analysis-phase2-4`，已於 2026-08-01 再次合併進 `main`
  （merge commit `9346760`，合併後 tree 與分支逐位元組相同）。`main` 現在包含完整
  Cloudflare 後端，不再只是純靜態檔案。但部署仍是從工作樹執行 `wrangler deploy`、
  不是從 `main` 觸發，所以兩者日後仍可能分歧。
- 正式功能程式基線為 `599a31d`；實際最新分支 HEAD
  仍應以 Git history 與 [HANDOFF](docs/HANDOFF.md) 為準。
- 最新正式 Worker 版本為 `7ea7c41e-ae32-4610-92c5-39f879779919`（2026-08-01
  部署，程式來自 commit `599a31d`）。Cloudflare 每次部署都會整包取代 Worker，
  因此**只上傳一個資產的部署同樣在服務程式**。若之後只重新發布狀態頁，
  線上版本編號會比上面這一組高而程式內容相同；以 `wrangler deployments list` 為準。
- 跟單商品發布後會推播到一個私密 LINE 群組（`LINE_PUSH_ENABLED="1"`，2026-07-31
  啟用）。推播在發布交易 commit **之後**才執行且不會拋出例外，LINE 中斷或憑證失效
  都不會導致發布失敗或回滾。輸出刻意拆成兩則：商品條件圖走公開 URL，因此**手收
  絕不入圖**；**手收與交易日期只出現在群組訊息本文**。`LINE_CHANNEL_ACCESS_TOKEN`
  與 `LINE_GROUP_ID` 是 Secret 而非 var，稽核記錄筆數、HTTP 狀態碼與 LINE 自己的
  錯誤訊息（識別碼會先遮蔽）。429／5xx 會沿用同一組 retry key 重試一次。
  **推播路徑已證實會執行，但從未成功投遞過** —— 2026-07-31 的第一次真實發布
  在 3.8 秒後收到 LINE 回覆 429，原因至今未確定。
- `POST /api/v1/public/line/webhook` 僅用於取得 LINE group id（LINE 不以其他方式
  提供），取得後已關閉：`LINE_WEBHOOK_ENABLED="0"` 時一律回 404。
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
  `0010`）實作，由 Worker 推導有效角色。遠端 D1 migrations 已套用至 `0017`。
- 新版主旨規則依第一筆交易決定 T+7 商品名稱：FCN 一律使用 `FCN(T+7)`；DAC
  家族在野村、DBS、SG、GS、CA 使用 `DRA(T+7)`，BMJB、UBS、CITI 使用
  `DAC(T+7)`；規則詳見 ADR 0014。
- Barclays 已回信但拒絕 Product=`DAC`，不是收信或 parser 遺失。Barclays 接受的
  DAC 商品代碼／主旨尚未確認，不可直接修改共用 BMJB 格式或猜成 `DRA`。
- 首頁「美股／日股熱門榜」（ADR 0024）在靜態版與 Cloudflare 版皆可使用；不需 API Key、
  不佔 Alpha Vantage 額度。五種排行以官網連結提供、美日皆可用；美股另內嵌即時熱門榜，
  需勾選同意才載入。**不可**把日股改成 `JP`／`JPX`／`TYO`（會顯示美股資料）。
- 目前驗證基線為 27 個測試檔、197 項測試；JavaScript 語法、TypeScript typecheck、
  完整測試及 Cloudflare Worker dry-run build 均通過。正式部署後 API health、授權
  邊界、新前端程式與快取版本均已驗證。**前一日收盤價已於 2026-08-01 在正式環境
  驗證可用**（Twelve Data），不再需要手動輸入。目前唯一未解問題是 LINE 推播 ——
  路徑會執行，但從未成功投遞過（LINE 回 429，額度、token、訊息格式皆已排除）。
  第一優先是讓一次真實跟單發布自然發生並讀取稽核中的 `providerMessage`；
  其次才是以真實手機／平板測試「下載報價圖」。
- **`fcn-quote-app` 本身不得啟用 GitHub Pages。** 它原本以 `main` 根目錄啟用，形成一個沒有
  任何文件記載、且落後 147 個 commit 的第三份靜態站，已於 2026-07-31 關閉。合併進 `main`
  之前請先確認未被重新啟用：`main` 帶有 `.nojekyll`，合併會把 `backend/`、`docs/`、
  `migrations/` 原樣公開；且跟單頁的 CORS 允許整個 `https://yintsun66-tech.github.io`
  主機，與 `fcnV2` 站是**同一個 origin**，等於多出一份不受 `prepare-assets.mjs`
  白名單控制、又會隨 `main` 漂移的前端。
- GitHub Pages 靜態相容版位於 `https://yintsun66-tech.github.io/fcnV2/`，repository
  `yintsun66-tech/fcnV2` 的目前靜態程式 commit 為 `7af6b6d`（狀態文件 HEAD `cdafc8a`）。它只包含公開前端，
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
