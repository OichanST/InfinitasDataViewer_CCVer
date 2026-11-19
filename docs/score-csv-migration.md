# スコア CSV への移行（作業メモ）

プレイリザルトの取得元を、Google スプレッドシート（GAS の getPlayResult）から e-amusement のスコア CSV（`○○_sp_score.csv`）に移す作業の記録。
別の PC で作業を続けるときは、まずこのメモを読む。

## 決めたこと

- **楽曲データ（レベル・ノーツ数・BPM）は GAS の getMusicData を使い続ける**。CSV にはノーツ数などが無いため
- **今のスコアは Google ドライブの `INFINITAS履歴/<DJ名>/latest.csv`**（latest.json と同じ考え方）。ビューアはこれだけを読む。
  履歴用の控えは `snapshots/` に日時の名前（`2026-11-17_2143.csv`。tracker の TSV のスナップショットと同じ並び）で置く。ビューアは読まない
  ビューアは Drive API（API キー）で読む。どの端末からでも見られるようにするため
- ブラウザで CSV ファイルを直接読み込む機能（右上の CSV ボタン）は、ドライブの latest.csv と食い違って紛らわしいので消した（2026-11-18）
- **未解禁は区別しない**。CSV にある曲の未プレイ譜面は NO PLAY。CSV に無い曲（未購入パック）は未解禁
- **MV（プレー動画）は YouTube Data API で `@oichan_ST` チャンネルのアップロード動画を読み、タイトルから譜面に割り当てる**（2026-11-18。GAS の getPlayResult は使わなくなった）
  - タイトルは `[レベル]曲名(オプション/ランプ)`（例 `[12]Dahlia(RANDOM/HARD)`）。† 付きは LEGGENDARIA、`SPH` などがあればその譜面。`AC` で始まるのはアーケードの動画なので使わない
  - DJ ST は正規（RANDOM なし）、ST-R は正規以外（RANDOM など）の動画。設定は api.js の `YOUTUBE_DJ`
  - 1譜面に動画が何本でも付く（新しい順）。一覧は最新の1本、曲の詳細は全部
  - タイトルのレベルが今の譜面と合わない（レベル改定）ときは ANOTHER に付ける
  - スプレッドシートの MV 944 件のうち 930 件が YouTube 側でも見つかった（残りは AC 動画、リミックス版の取り違え、楽曲データに無い譜面）
- **DP は保留**（DP の CSV がまだ無い）。parseScoreCsv はファイル名の `_dp_score` で DP を判別するが、今は SP だけ受け付ける
- **GAS からスコアを取る機能は消した**（2026-11-18 ユーザー判断）。スコアは CSV だけ。CSV が無ければ全部 NO PLAY として表示する。
  ログイン時・ライバル追加時の GAS の checkUser、取り込み日時の getUpdatedAt も使わない
- **ライバルもドライブの CSV と比べる**（`INFINITAS履歴/<ライバル名>/latest.csv` が無いと追加できない）
- 履歴も tracker.tsv ではなく CSV から作るようにする（下の「残り」）

## 検証の結果（2026-11-18、ST-R の CSV と GAS のリザルトを SP 全 5746 譜面で比較）

- CSV のクリアタイプは `FULLCOMBO CLEAR` だけ表記が違う（→ `FULL COMBO`）。ほかは同じ
- 曲名は 1842/1868 曲が完全一致。残りは表記ゆれ（`，` と `,`、全角スペース、末尾の空白・NBSP、`"` が抜ける、`Verão`→`Verao`、`ƒƒƒƒƒ`→`fffff`、`･･･`→`…`）。
  model.js の titleMatcher で「完全一致 → NFKC＋空白 → 記号・アクセントも無視（候補が1曲のときだけ）」の順に合わせて全曲一致。
  大文字小文字だけ違う別曲（`SHOOTING STAR` / `Shooting Star`、`ACT` / `ACTØ` など）があるので、強い正規化は一意のときだけ使う
- ランプ・EX・MISS は以下を除いて全部一致
  - Metagame Matador / The setting sun(burst) / レインボウ・フレーバー の3曲は、**スプレッドシート側で値が3曲の間でずれていた**（CSV が正しい）
    → 2026-11-19 追記：ずれていたのは CSV の方だった。e-amusement の CSV はダウンロードによってこの3曲の中身が入れ替わる（upload-script-spec.md の「できたもの」）
  - CSV では FAILED（0点）、GAS では NO PLAY の譜面が少しある（Golden Palms N、ECHIDNA A）
- CSV にはプレー回数・最終プレー日時・最終スコア更新時刻がある（ビューアの詳細の PLAY 列、並べ替えに使用）

## ドライブの `INFINITAS履歴/<DJ名>/` の中身

- `history.json` … `{ dj, sessions: [{ at, baseline?, count?, changes: [[曲名, "SPA", [ランプ, EX, MISS] | null, [ランプ, EX, MISS]], ...] }] }`
- `latest.json` … 前回の状態（save_history.py が比較に使う）
- `latest.csv` … 今のスコア CSV（ビューアが読む。2026-11-18 から）
- `snapshots/` … アップロードごとの tracker の TSV（`2026-11-13_2144.tsv` …）と、スコア CSV（`2026-11-17_2143.csv` …、2026-11-18 から）

## 残り

PC 側のアップロードスクリプトの改修は [upload-script-spec.md](upload-script-spec.md) にまとめた（家の PC でそれを読んで作業する）。

1. ~~**PC 側のスクリプト**~~ → **2026-11-19 にできた**（INFINITAS 終了で自動。中身は upload-script-spec.md の「できたもの」）。以下は当時のメモ
   **PC 側のスクリプト**（save_history.py の CSV 版）：ダウンロードした CSV を前回（latest.json）と比べて history.json に書き足し、CSV・latest.json・history.json をドライブに上げる。
   アップロードの認証は今の `upload_on_exit.ps1` / `save_history.py` と同じやり方にそろえる（どちらも家の PC にある。このリポジトリには無い）。
   - CSV への切り替え時は、tracker と CSV で曲名・値が違うので、そのまま比べず「記録開始（baseline）」を入れ直す
   - CSV の「最終スコア更新時刻」を使えば、まとめてダウンロードしても変化を実際の日付に振り分けられる（ランプだけの更新でこの時刻が変わるかは未確認）
   - 起動のしかた（ダウンロードフォルダを監視して自動 / 手で実行）は未定
   - 履歴の曲名は CSV の表記のままでもビューア側（historySessions）で合わせる。ランプの `FULLCOMBO CLEAR` も読み替える

## やりたいこと（まだ手を付けていない）

- ~~**ノーツレーダーのデータを GAS から Google ドライブに移す**~~ → **2026-11-19 にできた**。
  Reflux が書き出す `radar.tsv` をそのままドライブの `INFINITAS履歴/radar.tsv` に置き（家の PC の `upload_radar.py` がコピーする。新曲が来たら手で Reflux を起動してから実行）、
  ビューアは api.js の `getRadar` で読んで GAS の頃と同じ形 `[{ TITLE, TYPE, NOTES, PEAK, SCRATCH, "SOF-LAN", CHARGE, CHORD }]` にする。
  移す前に GAS のデータと 11699 譜面すべて一致することを確かめた。GAS の `getRadarData` と NotesRadar シートはもう使わない
- **地力表の「次に狙う」の調整**（2026-11-18。家の PC で案出ししてから）。
  今は「目標ランプ未達成（ノマゲ=CLEAR、ハード=HARD CLEAR）の譜面を、地力ランクの低い順・同じランクは MISS COUNT の少ない順」に機械的に並べているだけ。
  ランクが低くても苦手で今は狙わない譜面（例: Rampage は RANDOM だとラストがきつい）がある。案の一つとして「譜面ごとに保留にして候補から外す」

## 画面の変更（2026-11-18。PC の表示だけ。スマホは別途調整予定）

- 曲の詳細：押した譜面だけを出す。上に「SP ANOTHER 12 / NOTES / BPM」、左にノーツレーダー、右にプレイリザルト・VIDEO（1行1本、新しい順）・HISTORY（日付は年付き・時刻なし）
- 一覧から動画リンクを消した（動画は曲の詳細だけ）
- タブ（一覧・バージョン…）をヘッダーに入れた（スクロールしても見える）
- 右上の日時は、latest.csv の中でいちばん新しい最終プレー日時
- 履歴タブの各回の見出しは年付きの日付だけ（時刻なし）
- レーダータブのおすすめ計算が 11 秒かかっていたのを直した（中央値をレベルごとに1回だけ計算）

## いずれやるかもしれない機能（2026-11-18 の案出し。今は作らない）

- **プレー回数ランキング**（いちばん欲しい）：CSV のプレー回数で、よく遊んでいる譜面のランキング。レベル別の合計なども
- **しばらく遊んでいない譜面の絞り込み**：CSV の最終プレー日時で「◯か月以上遊んでいない」（並べ替えは既にある）
- **動画の撮り直し候補**：今のランプが、その譜面の最新の動画のランプより上の譜面（例: 動画は HARD CLEAR、今は EX HARD CLEAR）
