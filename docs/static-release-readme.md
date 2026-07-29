# FCN V2 靜態相容版

這個 repository 是 `fcn-quote-app` 的公開靜態快照，使用 GitHub Pages 提供：

- 交易條件輸入頁；
- 手動開啟郵件、複製 HTML 詢價表格與 Edge／Zimbra 網頁備援；
- 美股／日股熱門榜及公開市場資料連結；
- 手機／桌面響應式介面；
- 使用說明及版本部署狀態。

## 開啟網站

- [GitHub Pages 靜態版](https://yintsun66-tech.github.io/fcnV2/)
- [版本與部署狀態](https://yintsun66-tech.github.io/fcnV2/version-status.html)
- [Cloudflare 正式完整功能版](https://app.yintsun66.com/)

## 版本基準

- 靜態同步來源：`yintsun66-tech/fcn-quote-app`
- 來源分支：`codex/market-analysis-phase2-4`
- 來源功能 HEAD：`335a561`
- 正式靜態程式基線：Cloudflare 功能 commit `335a561`
- 同步日期：2026-07-30（Asia/Taipei）

## 重要邊界

GitHub Pages 版只有公開靜態檔案，不包含 Cloudflare Worker、登入、D1、Queue、Email
Worker、R2、後端自動寄信、回覆解析、正式排名或私人報價圖。

本 repository 不應放入密碼、API token、secret、D1 匯出、R2 內容、原始郵件、真實
RFQ、報價資料或個人資料。
