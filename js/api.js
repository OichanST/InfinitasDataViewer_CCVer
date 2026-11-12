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
 */
window.IV = window.IV || {};

IV.api = (() => {
	const ENDPOINT = "https://script.google.com/macros/s/AKfycbxIaQ6fbvHINLb4pdBMsrXVcWnpeRGsa9jqwUXQNtKQWNh_SbA5kTHUQ1o7_NvpMGF4Hg/exec";
	const PREFIX = "ivcc:";

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
		const fresh = await get(params);
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
