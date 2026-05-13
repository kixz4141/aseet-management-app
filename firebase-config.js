// ==========================================
// Firebase 設定
// ==========================================
// このファイルはGitHubに公開されます。
// 注意: Firebase のapiKeyは公開しても問題ありませんが、
// Firestoreの「セキュリティルール」で必ずアクセス制限してください。
// 詳しい設定はREADME.md を参照してください。
//
// 1. Firebase Console (https://console.firebase.google.com/) でプロジェクト作成
// 2. ウェブアプリを追加して下記設定を取得
// 3. 認証 > Sign-in method で Google を有効化
// 4. Firestore Database を有効化
// 5. 下の値を書き換える

window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "0000000000",
  appId: "1:000:web:abcdef"
};

// Firebase を有効にする場合は true に変更
// false の場合は IndexedDB のみで動作（同期なし）
window.USE_FIREBASE = false;
