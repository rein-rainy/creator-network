# Heroku デプロイメント ガイド

## 問題診断

Heroku で H10 "App crashed" エラー (503 status) が発生していた原因:

1. **環境変数未設定**: `NOTION_TOKEN` が Heroku Config Vars に設定されていなかった
2. **起動時の即座の失敗**: サーバー起動時に `process.exit(1)` で強制終了していた
3. **エラーハンドリング不足**: Heroku ダイノの動作状況が把握しにくかった

## 実施した修正

- ✅ `NOTION_TOKEN` の起動時チェック廃止 → エンドポイント呼び出し時チェックに変更
- ✅ エラーハンドリングの強化
- ✅ Procfile の作成
- ✅ 本番環境での詳細なログ出力

## Heroku デプロイ手順

### 1. 環境変数の設定

```bash
# 方法A: Heroku CLI を使用（推奨）
heroku config:set NOTION_TOKEN=your_notion_token --app creator-network-87189f30c82f

# 方法B: Heroku ダッシュボード
# https://dashboard.heroku.com/apps/creator-network-87189f30c82f/settings
# [Config Vars] セクションで以下を追加:
#   NOTION_TOKEN: your_notion_token
#   DEEPL_API_KEY: (オプション)
#   YOUTUBE_API_KEY: (オプション)
```

### 2. トークン値の確認

```bash
# 設定済みの環境変数を確認
heroku config --app creator-network-87189f30c82f

# 個別確認
heroku config:get NOTION_TOKEN --app creator-network-87189f30c82f
```

### 3. デプロイ実行

```bash
# コミット準備
git add .
git commit -m "Fix: Handle missing NOTION_TOKEN gracefully on Heroku"

# Heroku へプッシュ
git push heroku main
```

### 4. ログ確認

```bash
# リアルタイムログを監視
heroku logs -f --app creator-network-87189f30c82f

# 起動ログを確認
heroku logs --app creator-network-87189f30c82f --num 100
```

## 各環境変数の説明

| 変数 | 必須 | 説明 |
|------|------|------|
| `NOTION_TOKEN` | ✅ | Notion 統合トークン |
| `DEEPL_API_KEY` | ❌ | DeepL API キー（翻訳機能用） |
| `YOUTUBE_API_KEY` | ❌ | YouTube API キー（不要 - youtubei.js を使用） |

## トラブルシューティング

### H10 エラーが継続する場合

1. **環境変数が正しく設定されているか確認**
   ```bash
   heroku config --app creator-network-87189f30c82f
   ```

2. **最新のコードがデプロイされているか確認**
   ```bash
   heroku releases --app creator-network-87189f30c82f
   ```

3. **ダイノログを詳しく確認**
   ```bash
   heroku logs -t --app creator-network-87189f30c82f
   ```

4. **ダイノを再起動**
   ```bash
   heroku restart --app creator-network-87189f30c82f
   ```

### creator-network.html が見つからない場合

- ファイルが git リポジトリに追加されているか確認
- `.gitignore` に HTML ファイルが除外されていないか確認
- 以下で確認:
  ```bash
  git status
  git ls-files | grep creator-network.html
  ```

## 本番環境のモニタリング

### 起動時メッセージの確認

```
✅  Creator Network サーバー起動中
🌐  Heroku app running on port 5000
```

このメッセージが出ればサーバーは正常に起動しています。

### 環境変数チェック

```
✅ NOTION_TOKEN が設定されています
```

または

```
⚠️  NOTION_TOKEN が設定されていません — /notion-* エンドポイントは使用不可
```

## ローカルテスト

デプロイ前にローカルでテスト:

```bash
# 環境変数を設定してローカルで実行
NOTION_TOKEN=your_token npm start

# アクセステスト
curl http://localhost:3000/
```

## 参考リンク

- [Heroku Node.js Support](https://devcenter.heroku.com/articles/nodejs-support)
- [Heroku Config Vars](https://devcenter.heroku.com/articles/config-vars)
- [Notion API Documentation](https://developers.notion.com/)
