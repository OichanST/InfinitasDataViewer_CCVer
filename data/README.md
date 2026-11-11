# 地力表データ（SP☆12）

| ファイル | 内容 |
| --- | --- |
| `iidx_sp12_table.csv` | 原本。GitHub の beatmaniaIIDX-11-12-grid リポジトリの `iidx_sp12_table.csv` そのまま。**編集しない** |
| `iidx_sp12_table_edited.csv` | 修正版。ランクの更新や曲の追加はこちらに書く |

## ビューアへの反映

ビューアは Google スプレッドシートの AbilitySheet を読みます。修正版を編集したら、次を実行してシートに送ってください。

```
python F:\node\MusicCenterFetchGenre\upload_ability.py
```

その後、ビューアの ↻ ボタンで最新データを読み込むと反映されます。

## 書き方

- 文字コードは UTF-8（BOM 付き）のまま保存する
- `ノマゲ帯` / `ハード帯` は `地力S+`〜`地力F`、`個人差S+`〜`個人差F`、`未定` のいずれか
- `曲名` は INFINITAS の曲名に合わせる。LEGGENDARIA は末尾に `(L)`、HYPER は `(H)` を付ける（例: `HYENA(L)`、`gigadelic(H)`）。何も付けなければ ANOTHER
- 地力表に無い曲を追加するときは、1行増やせばよい
