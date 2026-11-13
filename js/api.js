"use strict";
/**
 * Google SpreadSheet（Apps Script の Web API）からのデータ取得とキャッシュ。
 *
 * - API は既存の Inf_GoogleSpreadSheet と同じもの（読み取りだけ使う）
 *     ?type=getMusicData           楽曲データ { version, musicList, customBPM, packages, pkgAssign }
 *     ?type=getPlayResult&id=DJ名  プレイリザルト [{ TITLE, SPN:{OPEN,CLEARSTATUS,PLAYRESULT,EXSCORE,MISSCOUNT,MV}, ... }]
 *     ?type=checkUser&id=DJ名      { result: true/false }
 *     ?type=getUpdatedAt&id=DJ名   { id, updatedAt: ISO日時 or null }（プレイリザルトを取り込んだ日時）
 * - 取得したデータは IndexedDB に保存し、次回はまずキャッシュで表示してから裏で最新を取りに行く（設定だけ localStorage）
 * - 更新履歴は GAS ではなく Google ドライブの公開フォルダから Drive API（API キー）で読む
 *     INFINITAS履歴/<DJ名>/history.json（PC の save_history.py がアップロードのたびに書き足す）
 */
window.IV = window.IV || {};

IV.api = (() => {
	const ENDPOINT = "https://script.google.com/macros/s/AKfycbxIaQ6fbvHINLb4pdBMsrXVcWnpeRGsa9jqwUXQNtKQWNh_SbA5kTHUQ1o7_NvpMGF4Hg/exec";
	const PREFIX = "ivcc:";
	// 更新履歴（Google ドライブ）。キーは Drive API だけに制限してある。フォルダは「リンクを知っている全員」が閲覧可
	const DRIVE_KEY = "AIzaSyB53XswWAZgxGICNZMQYe7lqaMzr5KUZ3o";
	const HISTORY_FOLDER = "1wDdpLEK_TUE9E-MRndHfS2NvinGd6272";

	async function driveFind(parent, name) {
		const q = `'${parent}' in parents and name = '${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
		const url = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id,name,modifiedTime)", key: DRIVE_KEY });
		const res = await fetch(url);
		if (!res.ok) throw new Error(`履歴の取得に失敗しました（HTTP ${res.status}）`);
		const files = (await res.json()).files || [];
		files.sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""));
		return files[0] || null;
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
		loadResult: (id, onData, opts) => load("result:" + id, { type: "getPlayResult", id }, onData, opts),
		loadRadar: (onData, opts) => load("radar", { type: "getRadarData" }, onData, opts),
		loadAbility: (onData, opts) => load("ability", { type: "getAbilityData" }, onData, opts),
		loadHistory: (id, onData, opts) => load("history:" + id, () => getHistory(id), onData, opts),
		checkUser: async (id) => !!(await get({ type: "checkUser", id })).result,
		/** プレイリザルトを取り込んだ日時（ミリ秒）。記録がない・GAS が未対応なら null */
		async getUpdatedAt(id) {
			const r = await get({ type: "getUpdatedAt", id });
			const t = r && r.updatedAt ? Date.parse(r.updatedAt) : NaN;
			return Number.isNaN(t) ? null : t;
		},
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
