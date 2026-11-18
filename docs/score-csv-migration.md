# スコア CSV への移行（作業メモ）

プレイリザルトの取得元を、Google スプレッドシート（GAS の getPlayResult）から e-amusement のスコア CSV（`○○_sp_score.csv`）に移す作業の記録。
別の PC で作業を続けるときは、まずこのメモを読む。

## 決めたこと

- **楽曲データ（レベル・ノーツ数・BPM）は GAS の getMusicData を使い続ける**。CSV にはノーツ数などが無いため
- **CSV は Google ドライブの `INFINITAS履歴/<DJ名>/` に置く**（履歴 history.json と同じフォルダ。ファイル名はダウンロードしたままでよい）。
  ビューアは Drive API（API キー）で読む。どの端末からでも見られるようにするため
- ビューアの「CSV」ボタンやドラッグ＆ドロップで読み込んだ CSV は、そのブラウザだけで使い、ドライブのものより優先する（手元で試す用）
- **未解禁は区別しない**。CSV にある曲の未プレイ譜面は NO PLAY。CSV に無い曲（未購入パック）は未解禁
- **MV リンクは GAS の getPlayResult から拾う**（MV の有無はユーザーごとなので getMusicData には載せない）
- **DP は保留**（DP の CSV がまだ無い）。parseScoreCsv はファイル名の `_dp_score` で DP を判別するが、今は SP だけ受け付ける
- **GAS からスコアを取る機能は消した**（2026-11-18 ユーザー判断）。スコアは CSV だけ。CSV が無ければ全部 NO PLAY として表示する。
  ログイン時・ライバル追加時の GAS の checkUser、取り込み日時の getUpdatedAt も使わない
- **ライバルもドライブの CSV と比べる**（`INFINITAS履歴/<ライバル名>/` に CSV が無いと追加できない）
- 履歴も tracker.tsv ではなく CSV から作るようにする（下の「残り」）

## 検証の結果（2026-11-18、ST-R の CSV と GAS のリザルトを SP 全 5746 譜面で比較）

- CSV のクリアタイプは `FULLCOMBO CLEAR` だけ表記が違う（→ `FULL COMBO`）。ほかは同じ
- 曲名は 1842/1868 曲が完全一致。残りは表記ゆれ（`，` と `,`、全角スペース、末尾の空白・NBSP、`"` が抜ける、`Verão`→`Verao`、`ƒƒƒƒƒ`→`fffff`、`･･･`→`…`）。
  model.js の titleMatcher で「完全一致 → NFKC＋空白 → 記号・アクセントも無視（候補が1曲のときだけ）」の順に合わせて全曲一致。
  大文字小文字だけ違う別曲（`SHOOTING STAR` / `Shooting Star`、`ACT` / `ACTØ` など）があるので、強い正規化は一意のときだけ使う
- ランプ・EX・MISS は以下を除いて全部一致
  - Metagame Matador / The setting sun(burst) / レインボウ・フレーバー の3曲は、**スプレッドシート側で値が3曲の間でずれていた**（CSV が正しい）
  - CSV では FAILED（0点）、GAS では NO PLAY の譜面が少しある（Golden Palms N、ECHIDNA A）
- CSV にはプレー回数・最終プレー日時・最終スコア更新時刻がある（ビューアの詳細の PLAY 列、並べ替えに使用）

## ドライブの `INFINITAS履歴/<DJ名>/` の中身

- `history.json` … `{ dj, sessions: [{ at, baseline?, count?, changes: [[曲名, "SPA", [ランプ, EX, MISS] | null, [ランプ, EX, MISS]], ...] }] }`
- `latest.json` … 前回の状態（save_history.py が比較に使う）
- `snapshots/`
- `○○_sp_score.csv` … ここに置く（2026-11-18 から）

## 残り

1. **PC 側のスクリプト**（save_history.py の CSV 版）：ダウンロードした CSV を前回（latest.json）と比べて history.json に書き足し、CSV・latest.json・history.json をドライブに上げる。
   アップロードの認証は今の `upload_on_exit.ps1` / `save_history.py` と同じやり方にそろえる（どちらも家の PC にある。このリポジトリには無い）。
   - CSV への切り替え時は、tracker と CSV で曲名・値が違うので、そのまま比べず「記録開始（baseline）」を入れ直す
   - CSV の「最終スコア更新時刻」を使えば、まとめてダウンロードしても変化を実際の日付に振り分けられる（ランプだけの更新でこの時刻が変わるかは未確認）
   - 起動のしかた（ダウンロードフォルダを監視して自動 / 手で実行）は未定
   - 履歴の曲名は CSV の表記のままでもビューア側（historySessions）で合わせる。ランプの `FULLCOMBO CLEAR` も読み替える
