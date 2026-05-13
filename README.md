# 配当台帳 v2 — Dividend Ledger PWA

日本株の配当金管理アプリ（PWA）。スマホ・PCに同期して使えます。

## 主な機能

- 📱 **PWAインストール** スマホのホーム画面・PCのデスクトップから起動
- ☁️ **クラウド同期** Firebase + Google認証 で全端末リアルタイム同期
- 📈 **自動株価更新** GitHub Actions + yfinance で1時間ごと
- 🔔 **株価アラート通知** 設定した株価で通知
- 💰 **配当管理** YoC（取得時利回り）と現在利回りの両方を計算
- 📥 CSV一括取り込み
- 💸 **完全無料運用**

## ファイル構成

```
dividend-pwa-v2/
├── index.html              # メインUI
├── app.js                  # アプリロジック
├── db.js                   # IndexedDB ラッパー
├── firebase-config.js      # Firebase設定（要編集）
├── firebase-sync.js        # Firebase同期レイヤー
├── sw.js                   # Service Worker
├── manifest.json           # PWAマニフェスト
├── icon-192.png            # アイコン
├── icon-512.png            # アイコン
├── prices.json             # 株価データ（GitHub Actionsが自動更新）
├── tickers.json            # 取得対象銘柄リスト
├── firestore.rules         # Firestoreセキュリティルール
├── scripts/
│   └── fetch_prices.py     # 株価取得スクリプト
└── .github/workflows/
    └── fetch-prices.yml    # GitHub Actions定義
```

---

## セットアップ手順（全約30分）

3つの作業に分かれます。

### STEP 1: GitHubリポジトリの作成と公開 (10分)

1. **GitHub.com で新しいPublicリポジトリを作成**
   - リポジトリ名は何でもOK（例: `dividend-ledger`）
   - Publicを選択（必須・GitHub Pages無料枠のため）

2. **ファイルをアップロード**

   コマンドラインの場合:
   ```bash
   cd dividend-pwa-v2
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/dividend-ledger.git
   git push -u origin main
   ```

   または、GitHubのWeb UIから「Add file」→「Upload files」で全ファイルをドラッグ&ドロップでもOK。

3. **GitHub Pages を有効化**
   - リポジトリの「Settings」→ 左メニュー「Pages」
   - 「Source」を `Deploy from a branch` に設定
   - Branch: `main` / Folder: `/ (root)` を選択して保存
   - 数分で `https://YOUR_NAME.github.io/dividend-ledger/` で公開される

4. **GitHub Actions を有効化**
   - リポジトリの「Settings」→ 左メニュー「Actions」→「General」
   - 「Allow all actions and reusable workflows」を選択
   - 下にスクロールして「Workflow permissions」を **「Read and write permissions」** に変更（重要・株価をコミットするため）

5. **初回実行**
   - 「Actions」タブ →「Fetch Stock Prices」→「Run workflow」で手動実行
   - 数分で完了し、prices.json が最新の株価で更新される

これでアプリは動きます（同期機能なしのローカルモード）。次のステップでクラウド同期を追加します。

---

### STEP 2: Firebase の設定 (15分)

クラウド同期が不要なら、このステップはスキップしてOKです。

1. **Firebaseプロジェクトを作成**
   - https://console.firebase.google.com/ にアクセス（Googleアカウント要）
   - 「プロジェクトを追加」→ 適当な名前を入れる（例: `dividend-ledger`）
   - Google アナリティクスは「無効」でOK
   - プロジェクトが作成されたら、左上のWebアプリ追加ボタン `</>` をクリック
   - アプリのニックネームを入れる→「アプリを登録」
   - 表示される **firebaseConfig オブジェクト** をコピーしておく

2. **Authentication を有効化**
   - 左メニュー「Build」→「Authentication」→「始める」
   - 「Sign-in method」タブ →「Google」を選択して有効化
   - サポートメール: 自分のメールアドレス → 保存

3. **Firestore Database を有効化**
   - 左メニュー「Build」→「Firestore Database」→「データベースを作成」
   - ロケーション: `asia-northeast1 (Tokyo)` を選択
   - 「本番環境モードで開始」を選択
   - 作成完了後、「ルール」タブを開き、`firestore.rules` の内容をコピペして「公開」

4. **firebase-config.js を編集**

   `firebase-config.js` を開き、コピーしておいた設定で書き換える:

   ```javascript
   window.FIREBASE_CONFIG = {
     apiKey: "AIzaSy...あなたの値...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123:web:abc..."
   };

   window.USE_FIREBASE = true;  // ← false から true に変更
   ```

5. **Authorized domains の追加**
   - Firebase Console >「Authentication」>「Settings」タブ >「Authorized domains」
   - 「ドメインを追加」で `YOUR_NAME.github.io` を追加

6. **コミット&プッシュ**
   ```bash
   git add firebase-config.js
   git commit -m "Enable Firebase sync"
   git push
   ```

これで全端末で同期できるようになります。

---

### STEP 3: アプリをインストール (5分)

1. ブラウザで公開URLを開く: `https://YOUR_NAME.github.io/dividend-ledger/`
2. ステータスバーの「Googleでログインして同期」をタップ → ログイン
3. インストール:
   - **iPhone (Safari)**: 共有ボタン → 「ホーム画面に追加」
   - **Android (Chrome)**: 三点メニュー → 「アプリをインストール」
   - **PC (Chrome/Edge)**: アドレスバー右端のインストールアイコン

---

## 銘柄の追加方法

### A) アプリから追加（推奨）

ポートフォリオタブ → 「銘柄を追加」から登録。
ただし、その銘柄が `tickers.json` に未登録だと株価が取得できません。
アプリに追加した後、必ず `tickers.json` も更新してください。

### B) tickers.json を直接編集

```json
[
  {"code": "7203", "name": "トヨタ自動車"},
  {"code": "9984", "name": "ソフトバンクグループ"}
]
```

編集してプッシュすると、GitHub Actions が自動で再実行されて prices.json が更新されます。

---

## 運用について

### 株価更新タイミング

- **自動**: GitHub Actions が1時間ごとに実行
- **手動**: アプリ起動時に毎回 prices.json を取得
- **遅延**: yfinance は約15-20分遅延データ

### 通知について

PWA のプッシュ通知は「アプリを開いている時」または「最近開いたばかりの時」に動作します。完全にブラウザを閉じていてもプッシュを送るには、別途 Firebase Cloud Messaging の組み込みが必要です。

代替として、メール通知やLINE通知を GitHub Actions から送る方式も検討できます。必要になったら追加実装します。

### コスト

完全無料です（ご使用範囲内では絶対に無料枠を使い切らない見込み）:
- GitHub Pages: 無制限（Public）
- GitHub Actions: Publicリポジトリは無制限
- Firebase: 無料枠（1GB保存、月50,000読み込み、月20,000書き込み）

### 注意事項

- **yfinance の利用**: 個人利用のみOK。商用配布は規約違反。
- **データの信頼性**: 株価は約20分遅延 + 配当情報の正確性は限定的。投資判断の根拠にはしないでください。
- **個人情報**: Firestoreにはあなたの保有銘柄情報が保存されます。セキュリティルールで自分以外は読めない設定にしていますが、Firebase Console での誤操作にご注意ください。

---

## トラブルシューティング

### GitHub Actions が失敗する
- Settings > Actions > General > Workflow permissions が「Read and write」になっているか確認
- Actions タブからログを確認

### 株価が取得できない（特定の銘柄）
- 一部のJ-REIT、ETF、新興市場銘柄は yfinance で取得できないことがあります
- `prices.json` の `failedCodes` に列挙されます

### Firebase ログインに失敗する
- Firebase Console > Authentication > Settings > Authorized domains に GitHub Pages のドメインを追加してください

### アプリのデータが消えた
- バックアップタブから定期的にJSONエクスポートを推奨します
- Firebase 同期中なら、別端末からログインすればデータが戻ります

---

## ライセンス

個人利用目的のサンプル実装です。MITライセンス相当として自由にカスタマイズ・改変してください。
