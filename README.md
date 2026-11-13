# INFINITAS Viewer（CC Ver）

beatmania IIDX INFINITAS のプレイリザルト（クリアランプ・EXスコア・DJ LEVEL）を、Google スプレッドシートから読み込んでブラウザで見るためのビューア。

データは [Inf_GoogleSpreadSheet](https://github.com/OichanST/Inf_GoogleSpreadSheet) と同じ Google Apps Script の Web API から**読むだけ**。
リザルトの入力・Reflux の TSV 取込は、これまでどおり Inf_GoogleSpreadSheet で行う。

## 使い方

`index.html` をブラウザで開く（サーバー不要。GitHub Pages などに置いてもそのまま動く）。

1. DJ NAME を入力して「表示する」。次回からは前回の DJ NAME で自動的に開く（右上の名前を押すと切り替え）。
   「楽曲だけ見る」で、リザルトなしで譜面の一覧だけを見ることもできる。
2. 上の段で絞り込む。
   - **SP / DP**
   - **LV**：押すたびにそのレベルを選択／解除（複数選べる）。**ALL** で全レベル
   - **譜面**：B / N / H / A / L（複数選択）
   - 検索欄：曲名・アーティスト・ジャンル（スペース区切りでAND）
   - 「条件」：バージョン（収録フォルダ）、CN/BSS の有無、未解禁を隠す、ランプのまとめ選択（未クリア・未HARD・未EXH・未FC）
3. 集計バー（クリアランプ・DJ LEVEL）や下のボタンを押すと、そのランプ・DJ LEVEL だけに絞り込む（もう一度押すと解除、Ctrl/Shift で複数）。
4. 一覧の行を押すと、その曲の全譜面のリザルト（ノーツ数・BPM・ランプ・スコア・次のDJ LEVELまでの目安・ミスカウント・ライバルとの差）を表示。
5. 右上の「ライバル」で DJ NAME を追加すると、「ライバル」タブで比べられる。ライバルごとの WIN / LOSE / EVEN の件数と、譜面ごとの自分とライバルの EX スコア・クリアステータス・差を出す（上の絞り込みが効く。WIN / LOSE / EVEN だけに絞ったり、「ライバルとの差順」で並べたりもできる）。一覧タブにはライバルの情報は出さない。
6. 「履歴」タブで、INFINITAS を終了してアップロードした回ごとに、前回から変わった譜面（ランプ・DJ LEVEL・EXスコア・ミスカウント）を見られる。曲の詳細にも、その曲の推移（HISTORY）が出る。
   履歴は GAS ではなく Google ドライブの公開フォルダ `INFINITAS履歴/<DJ名>/history.json` を Drive API（API キー）で読む。
   history.json は PC 側の `save_history.py`（upload_on_exit.ps1 がアップロード成功後に呼ぶ）が tracker.tsv を前回と比べて書き足す。

絞り込み条件は URL の `#` 以降に入るので、ブックマークしておけば同じ条件で開ける。
例：`index.html?id=DJNAME#s=SP&lv=11,12&lamp=NO PLAY,FAILED,ASSIST CLEAR,EASY CLEAR,CLEAR`

## 速さの工夫

- 読み込んだ楽曲データ・リザルトはブラウザ（localStorage）に保存し、次回はまず保存済みのデータですぐ表示してから、裏で最新を取りに行く（変わっていれば自動で表示を更新し、通知を出す）。右上の ↻ で強制的に取り直す。
- 一覧は表示する分だけ描画し、スクロールに合わせて続きを描画する（全レベル表示でも重くならない）。

## 構成

| ファイル | 内容 |
|---|---|
| `index.html` | 画面 |
| `css/style.css` | 見た目（ランプ・難易度・DJ LEVEL の色は先頭の変数で定義） |
| `js/api.js` | Apps Script の Web API の呼び出しとキャッシュ |
| `js/model.js` | 楽曲データとリザルトを「譜面1つ＝1行」の一覧にまとめる。DJ LEVEL の計算、絞り込み、並べ替え、集計 |
| `js/app.js` | 画面の状態（絞り込み条件）、描画、操作 |

ライブラリやビルドは使っていない（数字のフォントだけ Google Fonts の Kdam Thmor Pro を読む）。
