// ==========================================
// Firebase 同期レイヤー
// ==========================================
// IndexedDB(ローカル) と Firestore(クラウド) を両方更新する
// オフライン時はIndexedDBのみ → オンライン復帰時に自動同期

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, deleteDoc, collection, getDocs,
  onSnapshot, query, enableIndexedDbPersistence, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

class FirebaseSync {
  constructor() {
    this.app = null;
    this.auth = null;
    this.db = null;
    this.user = null;
    this.unsubscribers = [];
    this.onAuthChange = null;
    this.onDataChange = null;
  }

  async init(config) {
    this.app = initializeApp(config);
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app);

    // オフラインキャッシュを有効化
    try {
      await enableIndexedDbPersistence(this.db);
    } catch (err) {
      console.warn("[Firebase] persistence:", err.code);
    }

    // 認証状態を監視
    onAuthStateChanged(this.auth, (user) => {
      this.user = user;
      if (this.onAuthChange) this.onAuthChange(user);
      if (user) this.startSync();
      else this.stopSync();
    });
  }

  async signIn() {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(this.auth, provider);
      return result.user;
    } catch (err) {
      console.error("[Firebase] sign-in failed:", err);
      throw err;
    }
  }

  async signOut() {
    await signOut(this.auth);
  }

  userCollection(name) {
    if (!this.user) throw new Error("not signed in");
    return collection(this.db, "users", this.user.uid, name);
  }

  // Firestore へ書き込み
  async upsert(storeName, item) {
    if (!this.user) return;
    const id = String(item.id);
    const data = { ...item };
    delete data.id;  // idはdocument IDとして使う
    await setDoc(doc(this.userCollection(storeName), id), data);
  }

  async remove(storeName, id) {
    if (!this.user) return;
    await deleteDoc(doc(this.userCollection(storeName), String(id)));
  }

  // 初回フル同期: Firestore -> IndexedDB
  async pullAll() {
    if (!this.user) return null;
    const result = {};
    for (const name of ["holdings", "watchlist", "alerts"]) {
      const snap = await getDocs(this.userCollection(name));
      result[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    // settingsはkey-value
    const settingsSnap = await getDocs(this.userCollection("settings"));
    result.settings = {};
    settingsSnap.docs.forEach(d => {
      result.settings[d.id] = d.data().value;
    });
    return result;
  }

  // IndexedDB -> Firestore へまるごとアップロード（初回ログイン時）
  async pushAll(data) {
    if (!this.user) return;
    const batch = writeBatch(this.db);
    for (const store of ["holdings", "watchlist", "alerts"]) {
      for (const item of (data[store] || [])) {
        const id = String(item.id);
        const d = { ...item };
        delete d.id;
        batch.set(doc(this.userCollection(store), id), d);
      }
    }
    if (data.settings) {
      for (const [key, value] of Object.entries(data.settings)) {
        batch.set(doc(this.userCollection("settings"), key), { value });
      }
    }
    await batch.commit();
  }

  async setSetting(key, value) {
    if (!this.user) return;
    await setDoc(doc(this.userCollection("settings"), key), { value });
  }

  // リアルタイム同期開始
  startSync() {
    this.stopSync();
    for (const name of ["holdings", "watchlist", "alerts"]) {
      const unsub = onSnapshot(this.userCollection(name), (snap) => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (this.onDataChange) this.onDataChange(name, items);
      });
      this.unsubscribers.push(unsub);
    }
  }

  stopSync() {
    this.unsubscribers.forEach(u => u());
    this.unsubscribers = [];
  }

  isSignedIn() {
    return !!this.user;
  }

  getUserInfo() {
    if (!this.user) return null;
    return {
      uid: this.user.uid,
      email: this.user.email,
      displayName: this.user.displayName,
      photoURL: this.user.photoURL,
    };
  }
}

window.FirebaseSync = new FirebaseSync();
