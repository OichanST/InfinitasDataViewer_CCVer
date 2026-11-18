# このリポジトリで作業するときのルール

- **ユーザーへの返答・作業の合間の報告は日本語で書く**（英語にしない。会話が長くなっても切り替えない）。コード・識別子・コミットメッセージの書き方は今までどおり（コミットメッセージも日本語）
- **画面のレイアウト調整は、言われない限り PC の表示だけを変える**。スマホ（css の `@media (max-width: 640px)`）の表示はそのまま残す（スマホはユーザーが別の機会に実機で確認しながら直す）。
  見た目を変えたら PC 幅とスマホ幅の両方で確かめ、スマホが変わっていないことも見る
- JS / CSS を変えたら `index.html` の `?v=` の番号を上げる（GitHub Pages で古いファイルが残るのを防ぐ）
- main に直接コミット・プッシュしてよい（GitHub Pages で公開している。壊れないことを確かめてから）

## データの取り方（2026-11-18 から）

- スコア：Google ドライブ `INFINITAS履歴/<DJ名>/latest.csv`（e-amusement のスコア CSV）。GAS のプレイリザルトは使わない
- 動画：YouTube Data API で `@oichan_ST` のアップロード動画（ST は正規、ST-R は RANDOM）
- 楽曲データ・ノーツレーダー・地力表：GAS（Inf_GoogleSpreadSheet と同じ Web API）。ノーツレーダーはドライブに移したい（未着手）
- 更新履歴：ドライブの `history.json`（PC 側のスクリプトが書く）

詳しくは [README.md](README.md)、[docs/score-csv-migration.md](docs/score-csv-migration.md)（経緯と残り）、
[docs/upload-script-spec.md](docs/upload-script-spec.md)（PC 側のアップロードスクリプトの改修仕様）。
