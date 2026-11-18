"use strict";
/**
 * データの取得とキャッシュ。
 *
 * - スコア・更新履歴は Google ドライブの公開フォルダから Drive API（API キー）で読む
 *     INFINITAS履歴/<DJ名>/latest.csv（今のスコア。e-amusement のスコア CSV。自分とライバルのスコアはこれだけを使う）
 *     INFINITAS履歴/<DJ名>/history.json（PC の save_history.py がアップロードのたびに書き足す）
 * - 楽曲データなどは Google SpreadSheet（Apps Script の Web API。Inf_GoogleSpreadSheet と同じもの、読み取りだけ）
 *     ?type=getMusicData           楽曲データ { version, musicList, customBPM, packages, pkgAssign }
 *     ?type=getRadarData / getAbilityData  ノーツレーダー / 地力表
 *   GAS のプレイリザルト（getPlayResult）は使わない（スコアは CSV、MV は YouTube）
 * - MV（プレー動画）は YouTube Data API（API キー）でチャンネルのアップロード動画の一覧を読み、タイトルから譜面に割り当てる（model.js の videoMap）
 * - 取得したデータは IndexedDB に保存し、次回はまずキャッシュで表示してから裏で最新を取りに行く（設定だけ localStorage）
 */
window.IV = window.IV || {};

IV.api = (() => {
	const ENDPOINT = "https://script.google.com/macros/s/AKfycbxIaQ6fbvHINLb4pdBMsrXVcWnpeRGsa9jqwUXQNtKQWNh_SbA5kTHUQ1o7_NvpMGF4Hg/exec";
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

	async function get(params) {
		const url = ENDPOINT + "?" + new URLSearchParams(params).toString();
		const res = await fetch(url, { redirect: "follow" });
		if (!res.ok) throw new Error(`データの取得に失敗しました（HTTP ${res.status}）`);
		return res.json();
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
			async remove(key) {
				try { await run("readwrite", (s) => s.delete(key)); } catch (e) { /* 使えない環境では何もしない */ }
			},
			async clear() {
				try { await run("readwrite", (s) => s.clear()); } catch (e) { /* 使えない環境では何もしない */ }
			},
		};
	})();

	// 以前 localStorage に置いていたデータのキャッシュを消して場所を空ける（設定 pref: は残す）
	try {
		Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && !k.startsWith(PREFIX + "pref:")).forEach((k) => localStorage.removeItem(k));
	} catch (e) { /* 使えない環境では何もしない */ }

	/**
	 * キャッシュがあればすぐ onData に渡し、そのあと最新を取得して内容が変わっていれば再度 onData に渡す。
	 * キャッシュがなければ取得を待って onData に渡す。戻り値は取得完了の Promise。
	 */
	async function load(key, params, onData, { force = false } = {}) {
		const cached = force ? null : await idb.read(key);
		if (cached) onData(cached.data, { fromCache: true, at: cached.at });
		const fresh = typeof params === "function" ? await params() : await get(params);
		const changed = !cached || JSON.stringify(cached.data) !== JSON.stringify(fresh);
		idb.write(key, fresh); // 書き込みは待たない（表示を先に進める）
		if (changed) onData(fresh, { fromCache: false, at: Date.now(), updated: !!cached });
		return fresh;
	}

	return {
		loadMusic: (onData, opts) => load("music", { type: "getMusicData" }, onData, opts),
		loadRadar: (onData, opts) => load("radar", { type: "getRadarData" }, onData, opts),
		loadAbility: (onData, opts) => load("ability", { type: "getAbilityData" }, onData, opts),
		loadHistory: (id, onData, opts) => load("history:" + id, () => getHistory(id), onData, opts),
		loadDriveCsv: (id, onData, opts) => load("drivecsv:" + id, () => getDriveCsv(id), onData, opts),
		/** YouTube のアップロード動画。↻（force）のときは全部取り直す */
		loadYoutube: (onData, opts = {}) => load("youtube", () => getYoutubeVideos(!!opts.force), onData, opts),
		/** その DJ に出す動画の種類（"regular" / "random"）。MV を出さない DJ は null */
		youtubeKind: (id) => YOUTUBE_DJ[id] || null,
		/**
		 * 読み込んだスコア CSV（{ name: ファイル名, csv: parseScoreCsv の結果 }）。DJ ごとに IndexedDB に置く。
		 * ↻ では取り直さない（ファイルを選び直さないと更新できないため）
		 */
		readCsv: async (id) => { const v = await idb.read("csv:" + id); return v ? { ...v.data, at: v.at } : null; },
		saveCsv: (id, data) => idb.write("csv:" + id, data),
		removeCsv: (id) => idb.remove("csv:" + id),
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
