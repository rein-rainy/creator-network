# Heroku H10 Crash Fix - Summary

## 問題の原因

Heroku で表示されていた H10 "App crashed" エラーの原因は:

1. **起動時に即座に失敗**: `NOTION_TOKEN` 環境変数が設定されていないと、サーバー起動時に `process.exit(1)` で終了していた
2. **環境変数未設定**: Heroku のダイノに Config Vars として `NOTION_TOKEN` が設定されていなかった
3. **エラーハンドリング不足**: 例外が適切にキャッチされていなかった

## 実施した修正

### 1. **server.js の改善**

#### a) 起動時の NOTION_TOKEN チェック廃止
- **変更前**: `process.exit(1)` で強制終了
- **変更後**: 警告ログを表示し、サーバーを起動。エンドポイント呼び出し時にチェック

```javascript
// 変更前 (行 24-27)
if (!NOTION_TOKEN) {
  console.error('[Error] 環境変数 NOTION_TOKEN が設定されていません。');
  process.exit(1);
}

// 変更後 (行 30-36)
if (!NOTION_TOKEN) {
  console.warn('[Warning] 環境変数 NOTION_TOKEN が設定されていません。');
  console.warn('[Warning] /notion-* エンドポイントは動作しません。');
  if (!isProduction) {
    console.warn('[Info] ローカル開発の場合: NOTION_TOKEN=your_token node server.js');
  }
}
```

#### b) 本番環境検出の追加
```javascript
const IS_HEROKU = !!process.env.DYNO;
const isProduction = process.env.NODE_ENV === 'production' || IS_HEROKU;
```

#### c) /notion-data エンドポイントのバリデーション追加
```javascript
if (!NOTION_TOKEN) {
  res.writeHead(503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    error: 'Notion API is not configured. Please set NOTION_TOKEN environment variable.',
    code: 'NOTION_TOKEN_MISSING'
  }));
  return;
}
```

#### d) エラーハンドリングの強化
- `server.on('error', ...)` で EADDRINUSE エラーをキャッチ
- `process.on('unhandledRejection', ...)` で未処理の Promise 拒否をキャッチ
- `process.on('uncaughtException', ...)` で予期しない例外をキャッチ

#### e) スタティックファイル配信の改善
- HTML ファイルの存在チェック
- エラーハンドリングの強化

#### f) ログ出力の改善
- 本番環境（Heroku）と開発環境で異なるメッセージを表示
- 環境変数の設定状況を起動時に表示

### 2. **Procfile の作成**
```
web: node server.js
```

### 3. **HEROKU_DEPLOYMENT.md の作成**
- Heroku へのデプロイ手順
- 環境変数の設定方法
- ログの確認方法
- トラブルシューティングガイド

## 次のステップ

### 1. 環境変数の設定

```bash
# Heroku CLI で環境変数を設定
heroku config:set NOTION_TOKEN=your_notion_token --app creator-network-87189f30c82f
```

**注意**: `your_notion_token` を実際の Notion トークンに置き換えてください

### 2. コード変更のコミットとプッシュ

```bash
cd /Users/kensei/Dev/creator-network

# 変更をステージング
git add server.js Procfile HEROKU_DEPLOYMENT.md

# コミット
git commit -m "Fix: Handle missing NOTION_TOKEN gracefully on Heroku"

# Heroku へプッシュ
git push heroku main
```

### 3. デプロイ後の確認

```bash
# リアルタイムログを監視
heroku logs -f --app creator-network-87189f30c82f

# ログ例（正常系）
# ✅  Creator Network サーバー起動中
# 🌐  Heroku app running on port 5000
# ✅ NOTION_TOKEN が設定されています
```

## 検証方法

デプロイ後、以下で確認:

```bash
# ブラウザでアクセス
curl -I https://creator-network-87189f30c82f.herokuapp.com/

# 期待される応答
# HTTP/1.1 200 OK
# Content-Type: text/html; charset=utf-8

# /favicon.ico にアクセス（エラーハンドリングテスト）
curl -I https://creator-network-87189f30c82f.herokuapp.com/favicon.ico

# 期待される応答
# HTTP/1.1 404 Not Found
```

## ファイル変更一覧

- ✅ `server.js` - 起動処理とエラーハンドリング改善
- ✅ `Procfile` - Heroku デプロイメント設定（新規作成）
- ✅ `HEROKU_DEPLOYMENT.md` - デプロイメントガイド（新規作成）

## トラブルシューティング

### H10 エラーが続く場合

1. **環境変数が設定されているか確認**
   ```bash
   heroku config --app creator-network-87189f30c82f
   ```

2. **最新のコードがデプロイされているか確認**
   ```bash
   heroku releases --app creator-network-87189f30c82f
   ```

3. **ダイノを再起動**
   ```bash
   heroku restart --app creator-network-87189f30c82f
   ```

4. **詳細ログを確認**
   ```bash
   heroku logs --app creator-network-87189f30c82f --num 200
   ```

## 参考資料

- [HEROKU_DEPLOYMENT.md](./HEROKU_DEPLOYMENT.md) - 詳細なデプロイメントガイド
- [Heroku Node.js ドキュメント](https://devcenter.heroku.com/articles/nodejs-support)
- [Notion API ドキュメント](https://developers.notion.com/)
