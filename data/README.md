# 地力表データ（SP☆12）

| ファイル | 内容 |
| --- | --- |
| `iidx_sp12_table.csv` | 原本。GitHub の beatmaniaIIDX-11-12-grid リポジトリの `iidx_sp12_table.csv` そのまま。**編集しない** |
| `iidx_sp12_table_edited.csv` | 修正版。ランクの更新や曲の追加はこちらに書く |

## ビューアへの反映

ビューアはこのフォルダの `iidx_sp12_table_edited.csv` を直接読みます（2026-11-19 から。それまでは GAS 経由で Google スプレッドシートの AbilitySheet に送っていた）。
修正版を編集したら、コミットして main にプッシュするだけで、GitHub Pages に反映されたあとのビューアに出ます（↻ ボタンで読み直し）。
`upload_ability.py` で送る手順は要らなくなりました。

## 書き方

- 文字コードは UTF-8（BOM 付き）のまま保存する
- `ノマゲ帯` / `ハード帯` は `地力S+`〜`地力F`、`個人差S+`〜`個人差F`、`未定` のいずれか
- `曲名` は INFINITAS の曲名に合わせる。LEGGENDARIA は末尾に `(L)`、HYPER は `(H)` を付ける（例: `HYENA(L)`、`gigadelic(H)`）。何も付けなければ ANOTHER
- 地力表に無い曲を追加するときは、1行増やせばよい
