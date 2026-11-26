"use strict";
/**
 * データの取得とキャッシュ。
 *
 * - スコア・更新履歴は Google ドライブの公開フォルダから Drive API（API キー）で読む
 *     INFINITAS履歴/<DJ名>/latest.csv（今のスコア。e-amusement のスコア CSV。自分とライバルのスコアはこれだけを使う）
 *     INFINITAS履歴/<DJ名>/history.json（PC の save_history_csv.py が INFINITAS 終了のたびに書き足す）
 *     INFINITAS履歴/music.tsv（楽曲データ。Reflux が書き出す music.tsv。家の PC の upload_radar.py が先頭にゲームのバージョンを付けて置く）
 *     INFINITAS履歴/radar.tsv（ノーツレーダー。Reflux が書き出す radar.tsv をそのまま置く）
 * - 地力表（SP☆12）はこのリポジトリの data/iidx_sp12_table_edited.csv を直接読む
 * - 2026-11-19 に楽曲データ・ノーツレーダー・地力表を GAS（Google スプレッドシート）から移し、GAS は一切使わなくなった
 * - MV（プレー動画）は YouTube Data API（API キー）でチャンネルのアップロード動画の一覧を読み、タイトルから譜面に割り当てる（model.js の videoMap）
 * - 取得したデータは IndexedDB に保存し、次回はまずキャッシュで表示してから裏で最新を取りに行く（設定だけ localStorage）
 */
window.IV = window.IV || {};

IV.api = (() => {
	const PREFIX = "ivcc:";
	// API キー（ページに書くので誰でも見られる。使える API を絞って守る）
	// Google ドライブ（スコア CSV・更新履歴）。キーは Drive API だけに制限してある。フォルダは「リンクを知っている全員」が閲覧可
	const DRIVE_KEY = "AIzaSyB53XswWAZgxGICNZMQYe7lqaMzr5KUZ3o";
	const HISTORY_FOLDER = "1wDdpLEK_TUE9E-MRndHfS2NvinGd6272";
	// YouTube Data API（MV）。youtubeViewer と同じキー
	const YOUTUBE_KEY = "AIzaSyAcvkG759mbzrz-Xkoh0YdwSybBgwYeybA";
	// MV を出す DJ と、使う動画。チャンネルは @oichan_ST（S T）。ST は正規（RANDOM なし）、ST-R は正規以外（RANDOM など）の動画
	const YOUTUBE_UPLOADS = "UUJxtUcrOc1yyG7ZzJKBtTUA"; // チャンネル UCJxtUcrOc1yyG7ZzJKBtTUA のアップロード動画のプレイリスト
	const YOUTUBE_DJ = { "ST": "regular", "ST-R": "random" };

	/**
	 * チャンネルのアップロード動画 [{ id, title, at }]（新しい順）。50 本ずつ取る（1回 1 ユニット。1日 10,000 ユニットまで）。
	 * キャッシュがあれば、知っている動画が出てきたところで止めて新しい分だけ足す（full なら全部取り直す。タイトルの直し・削除はこちらで反映）
	 */
	async function getYoutubeVideos(full) {
		const cached = full ? null : await idb.read("youtube");
		const known = new Set(cached && cached.data ? cached.data.map((v) => v.id) : []);
		const got = [];
		let token = "";
		for (;;) {
			const url = "https://www.googleapis.com/youtube/v3/playlistItems?" + new URLSearchParams({
				part: "snippet", playlistId: YOUTUBE_UPLOADS, maxResults: "50", key: YOUTUBE_KEY, ...(token ? { pageToken: token } : {}),
			});
			const res = await fetch(url);
			if (!res.ok) throw new Error(`動画一覧の取得に失敗しました（HTTP ${res.status}）`);
			const d = await res.json();
			let hit = false;
			for (const it of d.items || []) {
				const id = it.snippet.resourceId.videoId;
				if (known.has(id)) { hit = true; break; }
				got.push({ id, title: it.snippet.title, at: it.snippet.publishedAt });
			}
			token = d.nextPageToken;
			if (hit || !token) break;
		}
		return known.size ? [...got, ...cached.data] : got;
	}

	async function driveFind(parent, name) {
		return (await driveList(parent, `name = '${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`))[0] || null;
	}
	/** フォルダの中のファイル（新しい順）。cond は Drive API の検索条件 */
	async function driveList(parent, cond) {
		const q = `'${parent}' in parents${cond ? ` and ${cond}` : ""} and trashed = false`;
		const url = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id,name,modifiedTime)", key: DRIVE_KEY });
		const res = await fetch(url);
		if (!res.ok) throw new Error(`ドライブの取得に失敗しました（HTTP ${res.status}）`);
		const files = (await res.json()).files || [];
		files.sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""));
		return files;
	}
	/**
	 * ドライブの INFINITAS履歴/<DJ名>/latest.csv（今のスコア。e-amusement の SP のスコア CSV の中身そのまま）。
	 * snapshots/ の CSV は履歴用の控えなので読まない。
	 * { name, csv: parseScoreCsv の結果, _mt: 更新時刻 }。置いていなければ null。
	 * 履歴と同じく、更新時刻がキャッシュと同じならダウンロードしない
	 */
	async function getDriveCsv(id) {
		const dir = await driveFind(HISTORY_FOLDER, id);
		const file = dir && (await driveFind(dir.id, "latest.csv"));
		if (!file) return null;
		const cached = await idb.read("drivecsv:" + id);
		if (cached && cached.data && cached.data._mt === file.modifiedTime) return cached.data;
		const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?` + new URLSearchParams({ alt: "media", key: DRIVE_KEY }));
		if (!res.ok) throw new Error(`スコア CSV の取得に失敗しました（HTTP ${res.status}）`);
		return { name: file.name, csv: IV.model.parseScoreCsv(await res.text(), file.name), _mt: file.modifiedTime };
	}
	/**
	 * 履歴 { dj, sessions: [...], _mt: 更新時刻 }。まだ無い DJ は { sessions: [] }
	 * 中身のダウンロード（alt=media）は回数が多いと Google に自動アクセスとして止められる（403 Sorry...）ので、
	 * ファイルの更新時刻がキャッシュと同じならダウンロードせずキャッシュを返す
	 */
	async function getHistory(id) {
		const dir = await driveFind(HISTORY_FOLDER, id);
		const file = dir && (await driveFind(dir.id, "history.json"));
		if (!file) return { dj: id, sessions: [] };
		const cached = await idb.read("history:" + id);
		if (cached && cached.data && cached.data._mt === file.modifiedTime) return cached.data;
		const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?` + new URLSearchParams({ alt: "media", key: DRIVE_KEY }));
		if (!res.ok) throw new Error(`履歴の取得に失敗しました（HTTP ${res.status}）`);
		return { ...(await res.json()), _mt: file.modifiedTime };
	}

	/**
	 * 楽曲データ。ドライブの INFINITAS履歴/music.tsv（Reflux が書き出す）を model.js の parseMusicTsv で GAS の頃と同じ形にする。
	 * 置いていなければエラー（楽曲データが無いと何も出せない）。更新時刻がキャッシュと同じならダウンロードしない
	 */
	async function getMusic() {
		const file = await driveFind(HISTORY_FOLDER, "music.tsv");
		if (!file) throw new Error("楽曲データ（music.tsv）がドライブにありません");
		const cached = await idb.read("drivemusic");
		if (cached && cached.data && cached.data._mt === file.modifiedTime) return cached.data;
		const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?` + new URLSearchParams({ alt: "media", key: DRIVE_KEY }));
		if (!res.ok) throw new Error(`楽曲データの取得に失敗しました（HTTP ${res.status}）`);
		return { ...IV.model.parseMusicTsv(await res.text()), _mt: file.modifiedTime };
	}

	/**
	 * ノーツレーダー。ドライブの INFINITAS履歴/radar.tsv（Reflux の radar.tsv。列は id, title, difficulty, level, notes, peak, scratch, sof-lan, charge, chord）を
	 * GAS の getRadarData と同じ形 { list: [{ TITLE, TYPE, NOTES, PEAK, SCRATCH, "SOF-LAN", CHARGE, CHORD }], _mt } にする。
	 * 置いていなければ list は空。更新時刻がキャッシュと同じならダウンロードしない
	 */
	async function getRadar() {
		const file = await driveFind(HISTORY_FOLDER, "radar.tsv");
		if (!file) return { list: [] };
		const cached = await idb.read("driveradar");
		if (cached && cached.data && cached.data._mt === file.modifiedTime) return cached.data;
		const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?` + new URLSearchParams({ alt: "media", key: DRIVE_KEY }));
		if (!res.ok) throw new Error(`ノーツレーダーの取得に失敗しました（HTTP ${res.status}）`);
		const lines = (await res.text()).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
		const head = lines[0].split("\t");
		const col = (name) => head.indexOf(name);
		const num = { NOTES: col("notes"), PEAK: col("peak"), SCRATCH: col("scratch"), "SOF-LAN": col("sof-lan"), CHARGE: col("charge"), CHORD: col("chord") };
		const list = lines.slice(1).map((l) => {
			const c = l.split("\t");
			const r = { TITLE: c[col("title")], TYPE: c[col("difficulty")] };
			for (const [k, i] of Object.entries(num)) r[k] = Number(c[i]);
			return r;
		});
		return { list, _mt: file.modifiedTime };
	}

	/** 引用符（"…"、"" はエスケープ）に対応した CSV の読み取り。行の配列（各行は列の配列） */
	function parseCsv(text) {
		const rows = [];
		let row = [], cell = "", quoted = false;
		text = text.replace(/^﻿/, "");
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (quoted) {
				if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
				else if (ch === '"') quoted = false;
				else cell += ch;
			} else if (ch === '"') quoted = true;
			else if (ch === ",") { row.push(cell); cell = ""; }
			else if (ch === "\n" || ch === "\r") {
				if (ch === "\r" && text[i + 1] === "\n") i++;
				row.push(cell); rows.push(row); row = []; cell = "";
			} else cell += ch;
		}
		if (cell || row.length) { row.push(cell); rows.push(row); }
		return rows.filter((r) => r.some((c) => c.trim()));
	}

	/**
	 * 地力表（SP☆12）。このリポジトリの data/iidx_sp12_table_edited.csv（修正版）を読み、GAS の getAbilityData と同じ形
	 * [{ TITLE, TYPE, NOMAGE_TIER, HARD_TIER, VER, BPM, NOTES, TENDENCY, ATTRIBUTE, CPI_EC, CPI_CL }]（値は文字列）にする。
	 * 曲名の末尾 (L) は LEGGENDARIA、(H) は HYPER、無ければ ANOTHER（upload_ability.py と同じ）。2026-11-19 に GAS から移した。
	 * file:// で開いたときはローカルのファイルを読めないので、GitHub Pages のものを読む
	 */
	async function getAbility() {
		const path = "data/iidx_sp12_table_edited.csv";
		const url = /^https?:$/.test(location.protocol) ? path : "https://oichanst.github.io/InfinitasDataViewer_CCVer/" + path;
		const res = await fetch(url, { cache: "no-cache" });
		if (!res.ok) throw new Error(`地力表の取得に失敗しました（HTTP ${res.status}）`);
		const [head, ...rows] = parseCsv(await res.text());
		const col = (name) => head.indexOf(name);
		const fields = { NOMAGE_TIER: "ノマゲ帯", HARD_TIER: "ハード帯", VER: "ver", BPM: "BPM", NOTES: "ノーツ数", TENDENCY: "譜面傾向", ATTRIBUTE: "属性", CPI_EC: "適正CPI_EC", CPI_CL: "適正CPI_CL" };
		return rows.map((c) => {
			const raw = c[col("曲名")] || "";
			const m = raw.match(/\((L|H)\)\s*$/);
			const r = { TITLE: raw.replace(/\((L|H)\)\s*$/, "").trim(), TYPE: m ? "SP" + m[1] : "SPA" };
			for (const [k, h] of Object.entries(fields)) r[k] = c[col(h)] ?? "";
			return r;
		});
	}


	/**
	 * ノーツ密度（1 秒ごとのノーツ数）。このリポジトリの data/density.tsv（tools/make_density.py が textage の譜面から作る。2026-11-26〜）。
	 * [{ TITLE, TYPE, NOTES, AVG, MAX, SEC }]（SEC は 1 秒ごとの数のカンマ区切りの文字列のまま。詳細を開いたときに分ける）
	 */
	async function getDensity() {
		const path = "data/density.tsv";
		const url = /^https?:$/.test(location.protocol) ? path : "https://oichanst.github.io/InfinitasDataViewer_CCVer/" + path;
		const res = await fetch(url, { cache: "no-cache" });
		if (!res.ok) throw new Error(`ノーツ密度の取得に失敗しました（HTTP ${res.status}）`);
		const [head, ...lines] = (await res.text()).split(/\r?\n/).filter((l) => l.trim());
		const col = Object.fromEntries(head.split("\t").map((h, i) => [h, i]));
		return lines.map((l) => {
			const c = l.split("\t");
			return { TITLE: c[col.title], TYPE: c[col.type], NOTES: c[col.notes], AVG: c[col.avg], MAX: c[col.max], SEC: c[col.sec] };
		});
	}

	/** 小さな設定（絞り込み条件・ライバル一覧・前回の DJ NAME）は localStorage に置く（起動時にすぐ読みたいので同期で読める方） */
	const cache = {
		read(key) {
			try {
				const raw = localStorage.getItem(PREFIX + key);
				return raw ? JSON.parse(raw) : null;
			} catch (e) {
				return null;
			}
		},
		write(key, data) {
			try {
				localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }));
			} catch (e) {
				console.warn("設定を保存できませんでした:", key, e);
			}
		},
	};

	/**
	 * 取得したデータ（楽曲・リザルト・レーダー・地力表・履歴）は IndexedDB に置く。
	 * localStorage は約5MBまでで、リザルト1人分（約160万字）×ライバルの人数で足りなくなるため（2026-11-13 に切り替え）。
	 * IndexedDB が使えない環境（一部のシークレットモードなど）では、キャッシュなしで毎回取りに行く。
	 */
	const idb = (() => {
		let dbp = null;
		const open = () => {
			if (!dbp) {
				dbp = new Promise((resolve, reject) => {
					if (!window.indexedDB) { reject(new Error("IndexedDB が使えません")); return; }
					const req = indexedDB.open("ivcc", 1);
					req.onupgradeneeded = () => req.result.createObjectStore("cache");
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
				dbp.catch((e) => console.warn("キャッシュを使わずに動きます:", e));
			}
			return dbp;
		};
		const run = async (mode, fn) => {
			const db = await open();
			return new Promise((resolve, reject) => {
				const tx = db.transaction("cache", mode);
				const req = fn(tx.objectStore("cache"));
				tx.oncomplete = () => resolve(req.result);
				tx.onerror = tx.onabort = () => reject(tx.error);
			});
		};
		return {
			async read(key) {
				try { return (await run("readonly", (s) => s.get(key))) || null; } catch (e) { return null; }
			},
			async write(key, data) {
				try { await run("readwrite", (s) => s.put({ at: Date.now(), data }, key)); }
				catch (e) { console.warn("キャッシュに保存できませんでした:", key, e); }
			},
			async clear() {
				try { await run("readwrite", (s) => s.clear()); } catch (e) { /* 使えない環境では何もしない */ }
			},
			/** キーが prefixes のどれかで始まるデータを消す */
			async removePrefixed(prefixes) {
				try {
					const keys = await run("readonly", (s) => s.getAllKeys());
					const old = keys.filter((k) => prefixes.some((p) => String(k).startsWith(p)));
					if (old.length) await run("readwrite", (s) => { old.forEach((k) => s.delete(k)); return s.count(); });
				} catch (e) { /* 使えない環境では何もしない */ }
			},
		};
	})();

	// もう使わない保存データを消して場所を空ける（2026-11-18〜）
	//   result:<DJ名> … GAS のプレイリザルト（1人約1.4MB。スコアは CSV、動画は YouTube になった）
	//   csv:<DJ名>    … ブラウザで読み込んだスコア CSV（CSV ボタンを消した）
	//   radar         … GAS のノーツレーダー（2026-11-19 からドライブの radar.tsv。キーは driveradar）
	//   ability       … GAS の地力表（2026-11-19 からリポジトリの data/iidx_sp12_table_edited.csv。キーは sp12table）
	//   music         … GAS の楽曲データ（2026-11-19 からドライブの music.tsv。キーは drivemusic）
	idb.removePrefixed(["result:", "csv:", "radar", "ability", "music"]);

	// 以前 localStorage に置いていたデータのキャッシュを消して場所を空ける（設定 pref: は残す）
	try {
		Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && !k.startsWith(PREFIX + "pref:")).forEach((k) => localStorage.removeItem(k));
	} catch (e) { /* 使えない環境では何もしない */ }

	/**
	 * キャッシュがあればすぐ onData に渡し、そのあと最新を取得して内容が変わっていれば再度 onData に渡す。
	 * キャッシュがなければ取得を待って onData に渡す。戻り値は取得完了の Promise。
	 */
	async function load(key, fetcher, onData, { force = false } = {}) {
		const cached = force ? null : await idb.read(key);
		if (cached) onData(cached.data, { fromCache: true, at: cached.at });
		const fresh = await fetcher();
		const changed = !cached || JSON.stringify(cached.data) !== JSON.stringify(fresh);
		idb.write(key, fresh); // 書き込みは待たない（表示を先に進める）
		if (changed) onData(fresh, { fromCache: false, at: Date.now(), updated: !!cached });
		return fresh;
	}

	return {
		loadMusic: (onData, opts) => load("drivemusic", getMusic, onData, opts),
		/** onData には GAS の頃と同じ配列を渡す */
		loadRadar: (onData, opts) => load("driveradar", getRadar, (d, info) => onData(d.list, info), opts),
		loadAbility: (onData, opts) => load("sp12table", getAbility, onData, opts),
		loadDensity: (onData, opts) => load("density", getDensity, onData, opts),
		loadHistory: (id, onData, opts) => load("history:" + id, () => getHistory(id), onData, opts),
		loadDriveCsv: (id, onData, opts) => load("drivecsv:" + id, () => getDriveCsv(id), onData, opts),
		/** YouTube のアップロード動画。↻（force）のときは全部取り直す */
		loadYoutube: (onData, opts = {}) => load("youtube", () => getYoutubeVideos(!!opts.force), onData, opts),
		/** その DJ に出す動画の種類（"regular" / "random"）。MV を出さない DJ は null */
		youtubeKind: (id) => YOUTUBE_DJ[id] || null,
		/** データのキャッシュ（IndexedDB）を全部消す。設定は残す */
		clearCache: () => idb.clear(),
		prefs: {
			get(key, def) {
				const v = cache.read("pref:" + key);
				return v ? v.data : def;
			},
			set(key, value) {
				cache.write("pref:" + key, value);
			},
		},
	};
})();
