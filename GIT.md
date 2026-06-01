# Git 運用メモ（対馬古民家プロジェクト）

このリポジトリは **ローカルのみ** で Git を使います。GitHub などのリモートは必須ではありません。後から接続したい場合は「[後から GitHub に接続する](#後から-github-に接続する)」を参照してください。

---

## 初回セットアップ（すでに `git init` 済みの場合）

リポジトリは初期化済みです。初めて履歴を残すときは、プロジェクト直下で次を実行します。

```bash
cd /Users/kotaro/Developer/cursor-projects/tushima-kominka-PJ

# 状態確認
git status

# すべての Markdown と設定をステージ
git add .

# 初回コミット
git commit -m "初回コミット: プロジェクト資料を Git 管理に追加"
```

`git status` で `nothing to commit, working tree clean` と出れば、初回コミットは完了です。

---

## 日常の更新手順

資料（`.md` など）を編集したあと、次の流れで履歴を残します。

### 1. 変更内容を確認

```bash
git status          # 変更・新規・削除されたファイル
git diff            # 未ステージの差分
git diff --staged   # ステージ済みの差分（add のあと）
```

### 2. ステージしてコミット

```bash
# 特定ファイルだけ
git add 電話確認メモ.md

# または変更をまとめて
git add .

git commit -m "保健所への問い合わせ結果を電話確認メモに追記"
```

コミットメッセージは **何を・なぜ変えたか** が後から分かる一文にするとよいです。

### 3. 履歴の確認

```bash
git log --oneline -10    # 直近10件を1行表示
git log -p 電話確認メモ.md   # 特定ファイルの変更履歴
git show HEAD            # 直近コミットの詳細
```

---

## よく使う操作

| 目的 | コマンド |
|------|----------|
| 直前コミットのメッセージだけ直す（まだ push していない場合） | `git commit --amend -m "新しいメッセージ"` |
| ファイルの変更を取り消す（未コミット） | `git checkout -- ファイル名` または `git restore ファイル名` |
| ステージを取り消す | `git restore --staged ファイル名` |
| 特定時点の内容を見る | `git show コミットID:電話確認メモ.md` |
| ブランチ一覧 | `git branch` |

このプロジェクトは主に Markdown なので、ブランチを分けず `main`（または `master`）一本で運用しても問題ありません。大きな方針変更を試すときだけ `git checkout -b 試作用ブランチ名` を使う程度で十分です。

---

## コミットしない方がよいもの

- `.env` など **パスワード・API キー** が入るファイル（`.gitignore` に記載済み）
- OS が自動生成する `.DS_Store` など（`.gitignore` に記載済み）

個人メモでリポジトリに含めたくないファイルがある場合は、そのファイル名を `.gitignore` に1行追加してください。

---

## 後から GitHub に接続する

**はい、後から接続できます。** ローカルでコミットを重ねておけば、リモートを追加した時点の履歴がそのまま GitHub に送れます。

1. GitHub で空のリポジトリを作成（README などは追加しない「空」が楽です）
2. ローカルでリモートを登録して push：

```bash
git remote add origin https://github.com/あなたのユーザー名/tushima-kominka-PJ.git
git branch -M main   # ブランチ名が main でない場合
git push -u origin main
```

SSH を使う場合は URL を `git@github.com:...` 形式に置き換えてください。

初回 push の前に、GitHub 上に README だけあるリポジトリを作ってしまった場合は、`git pull origin main --rebase` で取り込んでから push するか、空リポジトリを作り直すとスムーズです。

---

## トラブル時

- **`fatal: not a git repository`**  
  プロジェクト直下にいるか確認。別フォルダなら `cd` で移動。

- **コミットしたくないファイルが `git status` に出る**  
  `.gitignore` にパターンを追加し、`git rm --cached ファイル名` でインデックスから外す（ローカルファイルは残る）。

- **リモートはまだ不要**  
  `git remote` が何も表示されなければ、ローカル専用運用のままで問題ありません。

---

## このリポジトリで管理している主なファイル

| ファイル | 内容の目安 |
|----------|------------|
| `大目標.md` | プロジェクトの大目標 |
| `予算.md` | 予算関連 |
| `現時点スケジュール.md` | スケジュール |
| `電話確認メモ.md` | 市役所・保健所等への確認メモ |
| `GIT.md` | 本ドキュメント |
| `.gitignore` | Git が無視するファイルの定義 |

新しい `.md` を追加したら、通常どおり `git add` → `git commit` すれば履歴に載ります。
