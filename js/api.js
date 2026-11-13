"use strict";
/**
 * Google SpreadSheet（Apps Script の Web API）からのデータ取得とキャッシュ。
 *
 * - API は既存の Inf_GoogleSpreadSheet と同じもの（読み取りだけ使う）
 *     ?type=getMusicData           楽曲データ { version, musicList, customBPM, packages, pkgAssign }
 *     ?type=getPlayResult&id=DJ名  プレイリザルト [{ TITLE, SPN:{OPEN,CLEARSTATUS,PLAYRESULT,EXSCORE,MISSCOUNT,MV}, ... }]
 *     ?type=checkUser&id=DJ名      { result: true/false }
 *     ?type=getUpdatedAt&id=DJ名   { id, updatedAt: ISO日時 or null }（プレイリザルトを取り込んだ日時）
 * - 取得したデータは localStorage に保存し、次回はまずキャッシュで表示してから裏で最新を取りに行く
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
	/** 履歴 { dj, sessions: [...] }。まだ無い DJ は { sessions: [] } */
	async function getHistory(id) {
		const dir = await driveFind(HISTORY_FOLDER, id);
		const file = dir && (await driveFind(dir.id, "history.json"));
		if (!file) return { dj: id, sessions: [] };
		const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?` + new URLSearchParams({ alt: "media", key: DRIVE_KEY }));
		if (!res.ok) throw new Error(`履歴の取得に失敗しました（HTTP ${res.status}）`);
		return res.json();
	}

	async function get(params) {
		const url = ENDPOINT + "?" + new URLSearchParams(params).toString();
		const res = await fetch(url, { redirect: "follow" });
		if (!res.ok) throw new Error(`データの取得に失敗しました（HTTP ${res.status}）`);
		return res.json();
	}

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
				// 容量オーバーなどは無視する（キャッシュなしで動く）
				console.warn("キャッシュに保存できませんでした:", key, e);
			}
		},
		remove(key) {
			localStorage.removeItem(PREFIX + key);
		},
	};

	/**
	 * キャッシュがあればすぐ onData に渡し、そのあと最新を取得して内容が変わっていれば再度 onData に渡す。
	 * キャッシュがなければ取得を待って onData に渡す。戻り値は取得完了の Promise。
	 */
	async function load(key, params, onData, { force = false } = {}) {
		const cached = force ? null : cache.read(key);
		if (cached) onData(cached.data, { fromCache: true, at: cached.at });
		const fresh = typeof params === "function" ? await params() : await get(params);
		const changed = !cached || JSON.stringify(cached.data) !== JSON.stringify(fresh);
		cache.write(key, fresh);
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
		clearCache() {
			Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
		},
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
