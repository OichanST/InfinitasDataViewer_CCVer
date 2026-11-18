# アップロードスクリプトの改修メモ（tracker.tsv → スコア CSV）

家の PC の `upload_on_exit.ps1` / `save_history.py`（このリポジトリには無い）を、e-amusement のスコア CSV を元にした形に直すための仕様。
ビューア側（このリポジトリ）は対応済み（2026-11-18）。経緯は [score-csv-migration.md](score-csv-migration.md)。

## 何を変えるか

これまで：INFINITAS を終了 → `upload_on_exit.ps1` が Reflux の `tracker.tsv` をドライブに上げる → `save_history.py` が前回と比べて `history.json` に書き足す。

これから：e-amusement の「スコアデータ CSV ダウンロード」で取った SP の CSV（`C-xxxx-xxxx-xxxx_sp_score.csv`）を元にする。
**ドライブへのアップロードのやり方（認証など）は今のスクリプトのものをそのまま使う。**

## ドライブの置き場所

公開フォルダ `INFINITAS履歴/<DJ名>/`（ST-R なら `INFINITAS履歴/ST-R/`。フォルダ ID 1wDdpLEK_TUE9E-MRndHfS2NvinGd6272 の下）

| ファイル | 中身 | 誰が使う |
|---|---|---|
| `latest.csv` | **今のスコア**。ダウンロードした CSV の中身をそのまま（UTF-8 BOM 付きのまま）、名前だけ `latest.csv` にして上書き | ビューアが読む |
| `history.json` | 変化の記録（下の形式）。今のファイルに書き足していく | ビューアが読む |
| `snapshots/YYYY-MM-DD_HHMM.csv` | 履歴用の控え。上げるたびに1つ増やす（例 `2026-11-17_2143.csv`）。今までの `.tsv` と同じ並び | 人が見る用。ビューアは読まない |
| `latest.json` | tracker 時代の前回の状態 | ビューアは読まない。CSV に移ったら不要（消すかどうかは任せる） |

- 2026-11-18 時点で、`latest.csv` と `snapshots/2026-11-17_2143.csv` は手で置いてある（中身は同じ。最終プレー 2026-11-17 21:41）
- ビューアは `latest.csv` / `history.json` の**更新時刻（modifiedTime）**で変わったかを判断して読み直す。ファイルを上書きすれば反映される
- 同じ名前のファイルが2つあると、ビューアは更新時刻が新しい方を使う。上書き（update）にして、増やさない方がよい

## スコア CSV の形式

1行目が見出し、2行目から1曲1行。カンマ区切り、UTF-8（BOM 付き）。曲名にカンマが入る曲は全角の「，」になっていて、`"` で囲まれない（`"` の入った曲名は `"` が抜ける）。

```
バージョン,タイトル,アーティスト,BEGINNER スコア,BEGINNER 最終スコア更新時刻,BEGINNER ミスカウント,BEGINNER クリアタイプ,BEGINNER プレー回数,BEGINNER 最終プレー日時,NORMAL スコア,...,LEGGENDARIA 最終プレー日時,
```

- 難易度ごとに「スコア / 最終スコア更新時刻 / ミスカウント / クリアタイプ / プレー回数 / 最終プレー日時」の6列。難易度は BEGINNER, NORMAL, HYPER, ANOTHER, LEGGENDARIA（→ SPB, SPN, SPH, SPA, SPL）
- 列は見出しの名前で探すこと（行末に空の列がある）
- 遊んでいない譜面：スコア `0`、ミスカウント `---`、クリアタイプ `NO PLAY`、日時 `---`
- クリアタイプ：`NO PLAY` `FAILED` `ASSIST CLEAR` `EASY CLEAR` `CLEAR` `HARD CLEAR` `EX HARD CLEAR` `FULLCOMBO CLEAR`
  - **`FULLCOMBO CLEAR` はビューアでは `FULL COMBO`**。history.json には `FULL COMBO` で書く（ビューアはどちらでも読めるが、tracker 時代の記録とそろえる）
- 日時は `2026-10-23 15:41`（日本時間）
- CSV に無い曲は未購入（未解禁）
- FAILED でスコア 0 の譜面がある（遊んで 0 点で落ちた）。NO PLAY とは区別される

## history.json の形式（今と同じ。変えない）

```json
{
  "dj": "ST-R",
  "sessions": [
    { "at": "2026-11-13T21:44:00+09:00", "baseline": true, "count": 3642 },
    { "at": "2026-11-14T21:00:29+09:00", "changes": [
      ["HIGH", "SPH", ["EX HARD CLEAR", 1563, 16], ["EX HARD CLEAR", 1651, 15]],
      ["Everlasting Resort", "SPH", null, ["FULL COMBO", 1173, 0]]
    ]}
  ]
}
```

- `changes` の1件は `[曲名, 譜面, 前, 後]`。前・後は `[ランプ, EXスコア, ミスカウント]`。前が無い（初めて遊んだ）ときは `null`。ミスカウントが無いときは `null`
- 曲名は CSV の表記のままでよい（ビューアの historySessions が楽曲データの曲名に合わせる。`，` や末尾の空白などの表記ゆれも吸収する）
- 1回のアップロード（= 1つの CSV）で1セッション。変化が無ければセッションを足さなくてよい（今の save_history.py の動きに合わせる）
- `at` は ISO 8601（`+09:00` 付き）。何の時刻にするかは下の「決めること」

## 比べ方

- 前回の状態 = 前回上げた CSV（ドライブの `latest.csv`、またはローカルに残した前回の CSV）。新しい CSV と譜面ごとに比べる
- 変化とみなす条件は今の save_history.py に合わせる（ランプ・EX スコア・ミスカウントのどれかが変わった譜面）。
  NO PLAY → 遊んだ は「前 = null」
- **これまでの履歴（tracker.tsv から作った history.json の各セッション）は引き継ぐ**（2026-11-18 ユーザー指示）。消したり作り直したりせず、CSV からのセッションを後ろに書き足す
- **CSV に切り替えた最初の1回（tracker の最後の状態 → 最初の CSV）のつなぎ方**は、家の PC で実データを見て決める。
  - できれば比べて、その間の変化もそのまま記録する（つなぎ目の分が抜けないように）。その場合、tracker（latest.json）と CSV で曲名の表記やランプの表記（`FULLCOMBO CLEAR`）がそろっているかを先に確かめ、
    曲名は表記ゆれを吸収して照合する（ビューアの model.js の titleMatcher と同じ考え方：完全一致 → NFKC＋空白 → 記号・アクセントも無視して候補が1つのときだけ）
  - 書き込む前に変化の件数と中身を出して確認する。表記の違いだけの「変わっていない変化」が大量に出るなら、比べずに
    `{ "at": ..., "baseline": true, "count": 遊んだ譜面の数 }`（記録開始。ビューアは「記録開始」と表示する）を足す方にする
  - 参考：スプレッドシート（GAS）と CSV を比べたときは、3曲の値がずれていた（スプレッドシート側の誤り）、CSV では FAILED（0点）・GAS では NO PLAY の譜面があった。tracker.tsv との差は未確認

## 決めること（家の PC で相談）

1. **起動のしかた**：ダウンロードフォルダに `*_sp_score.csv` が来たら自動で動かす（監視）か、手で実行するか。
   CSV のダウンロードは e-amusement へのログインが要るので自動化しない（手でダウンロードする）
2. **セッションの時刻**：アップロードした時刻にするか、CSV の中のいちばん新しい「最終プレー日時」にするか（後者だとダウンロードが遅れても遊んだ日に近い）。
   さらに、変化ごとの「最終スコア更新時刻」で日ごとにセッションを分けると、まとめてダウンロードしても日ごとの成果のグラフが正確になる
   （ただし、ランプだけ更新したときにこの時刻が変わるかは未確認）
3. tracker.tsv / latest.json の扱い（INFINITAS 終了時のアップロードをやめるか、しばらく両方続けるか）
4. DP：まだ DP の CSV が無いので SP だけ。DP を始めたら `○○_dp_score.csv` も同じように（ビューアは今 SP だけ）
