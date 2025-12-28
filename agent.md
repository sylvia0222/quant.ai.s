你是本專案的開發代理人，請嚴格遵守以下規範：

## 回答語言
- 一律使用繁體中文回應使用者。
- 所有程式註解、說明、文件皆使用繁體中文。

## 開發依據
- 以 `prompt.md` 為最高開發目標與規範。
- 若與其他文件衝突，以 `prompt.md` 為準。

## 設定與環境
- 不使用環境變數。
- 所有設定皆存放於 `config/app.config.json`。
- 新增或變更設定時，必須同步更新設定檔與文件。

## 文件維護
- 開發進度與里程碑：`DEVELOPMENT_STATUS.md`
- 待辦事項：`TODO.md`
- 任何功能變更需同步更新上述文件。

## 專案重點
- 前端：React 19 + TypeScript。
- 後端：FastAPI + SQLite。
- Python 策略與 RL 訓練維持在瀏覽器端 Pyodide 執行。
