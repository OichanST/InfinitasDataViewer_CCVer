"use strict";
/**
 * 楽曲データとプレイリザルトを、譜面1つ＝1行の一覧に組み立てる。絞り込み・並べ替え・集計もここで行う。
 */
window.IV = window.IV || {};

IV.model = (() => {
	const DIFFS = ["B", "N", "H", "A", "L"];
	const DIFF_NAMES = { B: "BEGINNER", N: "NORMAL", H: "HYPER", A: "ANOTHER", L: "LEGGENDARIA" };
	// クリアランプ（低い順）。未解禁はランプとは別に扱う
	const LAMPS = ["NO PLAY", "FAILED", "ASSIST CLEAR", "EASY CLEAR", "CLEAR", "HARD CLEAR", "EX HARD CLEAR", "FULL COMBO"];
	const LAMP_SHORT = {
		"NO PLAY": "NO PLAY", "FAILED": "FAILED", "ASSIST CLEAR": "ASSIST", "EASY CLEAR": "EASY",
		"CLEAR": "CLEAR", "HARD CLEAR": "HARD", "EX HARD CLEAR": "EX HARD", "FULL COMBO": "F-COMBO",
	};
	const GRADES = ["AAA", "AA", "A", "B", "C", "D", "E", "F"];
	const LOCKED = "LOCKED";

	/**
	 * DJ LEVEL と、次（または今）の境界との差。
	 * 境界の中間（例: AA と AAA の間の 75/90）より上なら上の DJ LEVEL までの差（AAA-12）、下なら今の DJ LEVEL からの差（AA+8）。
	 */
	function grade(notes, ex) {
		const max = notes * 2;
		if (!notes || ex == null || isNaN(ex)) return { grade: "-", detail: "", rate: 0 };
		const rate = ex / max;
		const border = (k) => Math.ceil(max * k / 9);
		if (ex >= max) return { grade: "AAA", detail: "MAX+0", rate };
		for (let k = 8; k >= 2; k--) {
			if (rate >= k / 9) {
				const g = GRADES[8 - k];
				const upper = k === 8 ? "MAX" : GRADES[7 - k];
				const upperScore = k === 8 ? max : border(k + 1);
				const detail = rate >= (k + 0.5) / 9 ? `${upper}-${upperScore - ex}` : `${g}+${ex - border(k)}`;
				return { grade: g, detail, rate };
			}
		}
		const detail = ex > 0 ? `E-${border(2) - ex}` : "";
		return { grade: "F", detail, rate };
	}

	/** 譜面の BPM。music.tsv（2026-11-19〜）は譜面ごとに持つ。GAS の頃の customBPM（譜面ごとの例外）も読める */
	function bpmOf(song, key, customBPM) {
		return (song[key] && song[key].BPM) || (customBPM && customBPM[song.TITLE] && customBPM[song.TITLE][key]) || song.BPM || "";
	}

	// BPM の並べ替え用の数値（"123-135" は最大値）
	function bpmValue(bpm) {
		const nums = String(bpm).split(/[-～~]/).map((s) => parseFloat(s)).filter((n) => !isNaN(n));
		return nums.length ? Math.max(...nums) : 0;
	}

	const norm = (s) => String(s || "").normalize("NFKC").toLowerCase();

	// バージョンフォルダ（ゲームの並び順）。substream は 1st と 2nd の間、INFINITAS は最後
	const FOLDERS = ["IIDX", "substream", "2nd style", "3rd style", "4th style", "5th style", "6th style", "7th style", "8th style", "9th style", "10th style",
		"RED", "HAPPY SKY", "DistorteD", "GOLD", "DJ TROOPERS", "EMPRESS", "SIRIUS", "Resort Anthem", "Lincle", "tricoro", "SPADA", "PENDUAL", "copula",
		"SINOBUZ", "CANNON BALLERS", "Rootage", "HEROIC VERSE", "BISTROVER", "Cast Hour", "RESIDENT", "EPOLIS", "Pinky Crush", "Sparkle Shower", "INFINITAS"];
	const folderKey = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
	const FOLDER_BY_KEY = new Map(FOLDERS.map((f) => [folderKey(f), f]));
	/**
	 * music.tsv の folder（ゲームのバージョン番号）→ フォルダ名。0 = 1st style（IIDX）… 33 = Sparkle Shower は FOLDERS の並びと同じ、80 = INFINITAS。
	 * 2026-11-19 に GAS の楽曲データの FOLDER と全曲突き合わせて決めた。新しいバージョンが出たら FOLDERS の INFINITAS の前に足す
	 */
	const folderOfNumber = (n) => (n === 80 ? "INFINITAS" : n >= 0 && n < FOLDERS.length - 1 ? FOLDERS[n] : `ver.${n}`);
	/** フォルダ名の表記ゆれ（"CastHour" / "5th Style" など）をそろえる */
	const normFolder = (s) => FOLDER_BY_KEY.get(folderKey(s)) || String(s || "");
	/** フォルダの並び順（知らないフォルダは最後に名前順） */
	const folderOrder = (a, b) => {
		const ia = FOLDERS.indexOf(a), ib = FOLDERS.indexOf(b);
		return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
	};

	/**
	 * 一覧を作る。results は自分のリザルト（なければ null）、rivals は { id, results } の配列。
	 */
	function build(music, results, rivals, radarMap, abilityMap) {
		const resByTitle = new Map((results || []).map((r) => [r.TITLE, r]));
		radarMap = radarMap || new Map();
		abilityMap = abilityMap || new Map();
		const rivalMaps = (rivals || []).map((rv) => ({ id: rv.id, map: new Map((rv.results || []).map((r) => [r.TITLE, r])) }));
		const charts = [];
		for (const song of music.musicList) {
			const res = resByTitle.get(song.TITLE);
			const pkg = music.pkgAssign ? music.pkgAssign[song.TITLE] || "" : "";
			const searchText = norm(`${song.TITLE} ${song.ARTIST} ${song.GENRE}`);
			for (const style of ["SP", "DP"]) {
				for (const d of DIFFS) {
					const key = style + d;
					const c = song[key];
					if (!c || !c.DIFFICULT) continue;
					const r = (res && res[key]) || {};
					const open = results ? !!r.OPEN : true;
					const lamp = open ? (r.CLEARSTATUS && LAMPS.includes(r.CLEARSTATUS) ? r.CLEARSTATUS : "NO PLAY") : LOCKED;
					const ex = open && lamp !== "NO PLAY" ? Number(r.EXSCORE) || 0 : 0;
					const played = open && lamp !== "NO PLAY";
					const g = played ? grade(c.NOTES, ex) : { grade: "-", detail: "", rate: 0 };
					const bpm = bpmOf(song, key, music.customBPM);
					const row = {
						id: `${key}|${song.TITLE}`,
						song, key, style, diff: d,
						title: song.TITLE, artist: song.ARTIST || "", genre: song.GENRE || "", folder: normFolder(song.FOLDER), pkg,
						level: Number(c.DIFFICULT), notes: Number(c.NOTES) || 0,
						// HCN か HBSS がある（ゲームのノーツレーダーの「HELL」札）。music.tsv の hell 列。GAS の頃は CN/BSS 列から
						hell: !!c.HELL || c.CN === "HCN" || c.BSS === "HBSS",
						// BPM に "-" があれば（例: 150-300）ソフラン曲
						soflan: String(bpm).includes("-") ? "SOF-LAN" : "",
						bpm, bpmNum: bpmValue(bpm),
						open, lamp, lampIdx: LAMPS.indexOf(lamp), played,
						ex, miss: played && r.MISSCOUNT !== "" && r.MISSCOUNT != null && r.MISSCOUNT !== "-" ? Number(r.MISSCOUNT) : null,
						grade: g.grade, gradeDetail: g.detail, rate: g.rate,
						// YouTube の動画（新しい順）。曲の詳細に出す
						videos: r.VIDEOS || [],
						// スコア CSV から読んだときだけ入る（GAS のリザルトには無い）
						plays: r.PLAYS ?? null, lastPlay: r.LASTPLAY || "",
						searchText,
						radar: radarMap.get(song.TITLE + "|" + key) || null,
						ability: abilityMap.get(song.TITLE + "|" + key) || abilityMap.get("~" + looseTitle(song.TITLE) + "|" + key) || null,
						rivals: [],
					};
					for (const rv of rivalMaps) {
						const rr = (rv.map.get(song.TITLE) || {})[key] || {};
						const rPlayed = !!rr.OPEN && rr.CLEARSTATUS && rr.CLEARSTATUS !== "NO PLAY";
						const rEx = rPlayed ? Number(rr.EXSCORE) || 0 : null;
						row.rivals.push({
							id: rv.id, played: rPlayed, lamp: rPlayed ? rr.CLEARSTATUS : "", ex: rEx,
							diff: rPlayed && played ? ex - rEx : null,
						});
					}
					charts.push(row);
				}
			}
		}
		return charts;
	}

	/**
	 * 絞り込み。except に "lamp" / "grade" を渡すと、その条件だけ外す（集計バーを出すため）。
	 */
	function filter(charts, f, except = "") {
		const terms = norm(f.q).split(/\s+/).filter(Boolean);
		return charts.filter((c) => {
			if (c.style !== f.style) return false;
			if (f.levels.size && !f.levels.has(c.level)) return false;
			if (f.diffs.size && !f.diffs.has(c.diff)) return false;
			if (f.hideLocked && !c.open) return false;
			if (except !== "lamp" && f.lamps.size && !f.lamps.has(c.lamp)) return false;
			if (except !== "grade" && f.grades.size && !f.grades.has(c.grade)) return false;
			if (f.rival && f.rivalResult) {
				const rv = c.rivals.find((r) => r.id === f.rival);
				if (!rv || rv.diff == null) return false;
				if (f.rivalResult === "win" && !(rv.diff > 0)) return false;
				if (f.rivalResult === "lose" && !(rv.diff < 0)) return false;
				if (f.rivalResult === "draw" && rv.diff !== 0) return false;
			}
			return terms.every((t) => c.searchText.includes(t));
		});
	}

	const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
	const sortTitle = (c) => c.title.normalize("NFKC");

	function sort(list, by, dir, rivalId) {
		const sign = dir === "desc" ? -1 : 1;
		const byTitle = (a, b) => collator.compare(sortTitle(a), sortTitle(b)) || DIFFS.indexOf(a.diff) - DIFFS.indexOf(b.diff);
		const key = {
			level: (a, b) => a.level - b.level,
			title: () => 0,
			rate: (a, b) => a.rate - b.rate,
			lamp: (a, b) => a.lampIdx - b.lampIdx,
			miss: (a, b) => (a.miss ?? 1e9) - (b.miss ?? 1e9),
			bpm: (a, b) => a.bpmNum - b.bpmNum,
			notes: (a, b) => a.notes - b.notes,
			plays: (a, b) => (a.plays ?? -1) - (b.plays ?? -1),
			lastPlay: (a, b) => (a.lastPlay || "").localeCompare(b.lastPlay || ""),
			radarNotes: (a, b) => (a.radar?.NOTES ?? -1) - (b.radar?.NOTES ?? -1),
			radarPeak: (a, b) => (a.radar?.PEAK ?? -1) - (b.radar?.PEAK ?? -1),
			radarScratch: (a, b) => (a.radar?.SCRATCH ?? -1) - (b.radar?.SCRATCH ?? -1),
			radarSoflan: (a, b) => (a.radar?.["SOF-LAN"] ?? -1) - (b.radar?.["SOF-LAN"] ?? -1),
			radarCharge: (a, b) => (a.radar?.CHARGE ?? -1) - (b.radar?.CHARGE ?? -1),
			radarChord: (a, b) => (a.radar?.CHORD ?? -1) - (b.radar?.CHORD ?? -1),
			rival: (a, b) => {
				const da = (a.rivals.find((r) => r.id === rivalId) || {}).diff;
				const db = (b.rivals.find((r) => r.id === rivalId) || {}).diff;
				return (da ?? 1e9) - (db ?? 1e9);
			},
		}[by] || (() => 0);
		return list.slice().sort((a, b) => sign * key(a, b) || byTitle(a, b));
	}

	/** ランプ・DJ LEVEL の件数（未解禁は lamp に LOCKED として数える） */
	function summarize(list) {
		const lamps = Object.fromEntries([LOCKED, ...LAMPS].map((l) => [l, 0]));
		const grades = Object.fromEntries([...GRADES, "-"].map((g) => [g, 0]));
		for (const c of list) {
			lamps[c.lamp]++;
			grades[c.grade]++;
		}
		return { total: list.length, lamps, grades };
	}

	function rivalSummary(list, rivalIds) {
		return rivalIds.map((id) => {
			const s = { id, win: 0, lose: 0, draw: 0 };
			for (const c of list) {
				const rv = c.rivals.find((r) => r.id === id);
				if (!rv || rv.diff == null) continue;
				if (rv.diff > 0) s.win++;
				else if (rv.diff < 0) s.lose++;
				else s.draw++;
			}
			return s;
		});
	}

	/**
	 * 楽曲データ。Reflux が書き出す music.tsv（ドライブの INFINITAS履歴/music.tsv）を GAS の getMusicData と同じ形
	 * { version, musicList: [{ TITLE, ARTIST, GENRE, FOLDER, BPM, SPN: { DIFFICULT, NOTES, BPM, HELL }, ... }], pkgAssign } にする。
	 * 列: id, title, artist, genre, folder（バージョン番号）, label（パック ID）, 譜面ごとに「<SPB…DPL> level / notes / bpm / hell」。
	 * 1行目が "# " で始まればゲームのバージョン（upload_radar.py が付ける）。BEGINNER は使わない（ユーザー指定）
	 */
	function parseMusicTsv(text) {
		let lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
		let version = "";
		if (lines[0] && lines[0].startsWith("# ")) { version = lines[0].slice(2).trim(); lines = lines.slice(1); }
		const head = lines[0].split("\t");
		const col = Object.fromEntries(head.map((h, i) => [h, i]));
		const KEYS = ["SPN", "SPH", "SPA", "SPL", "DPN", "DPH", "DPA", "DPL"];
		const musicList = [], pkgAssign = {};
		for (const line of lines.slice(1)) {
			const c = line.split("\t");
			const v = (name) => c[col[name]] ?? "";
			const song = { TITLE: v("title"), ARTIST: v("artist"), GENRE: v("genre"), FOLDER: folderOfNumber(Number(v("folder"))) };
			for (const k of KEYS) {
				const level = Number(v(`${k} level`));
				if (!level) continue;
				song[k] = { DIFFICULT: level, NOTES: Number(v(`${k} notes`)) || 0, BPM: v(`${k} bpm`), HELL: v(`${k} hell`) === "1" };
			}
			const firstChart = KEYS.map((k) => song[k]).find(Boolean);
			if (!firstChart) continue;
			song.BPM = (song.SPA || firstChart).BPM;
			if (v("label")) pkgAssign[song.TITLE] = v("label");
			musicList.push(song);
		}
		return { version, musicList, pkgAssign };
	}

	/** ノーツレーダーの一覧を "曲名|SPA" のようなキーで引けるMapにする */
	function radarMap(list) {
		return new Map((list || []).map((r) => [r.TITLE + "|" + r.TYPE, r]));
	}

	/**
	 * 表記ゆれを吸収した曲名（アクセント記号・全角/半角・記号・空白・大文字小文字を無視）。
	 * 地力表は「Ubertreffen」「［ ］DENTITY」のように INFINITAS と表記が違う曲があるため
	 */
	const looseTitle = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

	/** 地力表(AbilitySheet)の一覧を "曲名|SPA" のようなキーで引けるMapにする（表記ゆれ用に "~ゆるい曲名|SPA" も登録） */
	function abilityMap(list) {
		const map = new Map();
		for (const r of list || []) {
			map.set(r.TITLE + "|" + r.TYPE, r);
			// 記号だけの曲名（∀ や ≡+≡）はゆるい曲名が空になり別の曲と一致してしまうので登録しない
			const lt = looseTitle(r.TITLE);
			if (!lt) continue;
			const loose = "~" + lt + "|" + r.TYPE;
			if (!map.has(loose)) map.set(loose, r);
		}
		return map;
	}

	// 地力表のランク（上から）。「地力」と「個人差」は別グループにし、同じランクなら地力→個人差の順
	const ABILITY_RANKS = ["S+", "S", "A+", "A", "B+", "B", "C", "D", "E", "F"];
	const ABILITY_GOAL = { nomage: "EASY CLEAR", hard: "HARD CLEAR" };
	// 「次に狙う」の目標。ノマゲは EASY CLEAR の譜面も CLEAR を狙う候補に入れる（地力表の達成数は ABILITY_GOAL のまま）
	const ABILITY_CAND_GOAL = { nomage: "CLEAR", hard: "HARD CLEAR" };

	/**
	 * 地力表のグループを作る。mode は "nomage"（EASY 以上で達成）か "hard"（HARD 以上で達成）。
	 * 戻り値: [{ tier: "地力S+", items: [譜面], done: 達成数 }]（譜面は曲名順。「未定」などは最後）
	 */
	function abilityGroups(charts, mode) {
		const col = mode === "hard" ? "HARD_TIER" : "NOMAGE_TIER";
		const goal = LAMPS.indexOf(ABILITY_GOAL[mode] || ABILITY_GOAL.nomage);
		const order = [...ABILITY_RANKS.flatMap((r) => ["地力" + r, "個人差" + r]), "未定", "未設定"];
		const groups = new Map();
		for (const c of charts) {
			// 地力表に無い SP☆12 譜面は「未設定」として最後に出す
			if (!c.ability && !(c.style === "SP" && c.level === 12)) continue;
			const tier = c.ability ? String(c.ability[col] || "").trim() || "未定" : "未設定";
			if (!groups.has(tier)) groups.set(tier, []);
			groups.get(tier).push(c);
		}
		const rank = (t) => (order.includes(t) ? order.indexOf(t) : order.length);
		return [...groups.entries()]
			.sort((a, b) => rank(a[0]) - rank(b[0]) || collator.compare(a[0], b[0]))
			.map(([tier, items]) => ({
				tier,
				items: items.sort((a, b) => collator.compare(sortTitle(a), sortTitle(b)) || DIFFS.indexOf(a.diff) - DIFFS.indexOf(b.diff)),
				done: items.filter((c) => c.lampIdx >= goal).length,
			}));
	}

	/**
	 * 地力表の「次に狙う」候補。遊んだことがあり、まだ目標（ノマゲ=CLEAR、ハード=HARD CLEAR）に届いていない譜面を、
	 * 地力ランクの低い順（地力と個人差は同じランクなら混ぜる）、同じランクなら MISS COUNT の少ない順に並べる。
	 * 「未定」の譜面と未プレイ（MISS COUNT が無いので比べられない）は入れない。
	 * 戻り値: [{ c, tier }]
	 */
	function abilityCandidates(charts, mode) {
		const col = mode === "hard" ? "HARD_TIER" : "NOMAGE_TIER";
		const goal = LAMPS.indexOf(ABILITY_CAND_GOAL[mode] || ABILITY_CAND_GOAL.nomage);
		const rankOf = (t) => { const m = /^(?:地力|個人差)([SABCDEF]\+?)$/.exec(t); return m ? ABILITY_RANKS.indexOf(m[1]) : -1; };
		const miss = (c) => (c.miss == null ? Infinity : c.miss);
		return charts
			.filter((c) => c.ability && c.played && c.lampIdx < goal)
			.map((c) => { const tier = String(c.ability[col] || "").trim(); return { c, tier, rank: rankOf(tier) }; })
			.filter((x) => x.rank >= 0)
			// ABILITY_RANKS は上（S+）から並んでいるので、番号が大きいほど低いランク
			.sort((a, b) => b.rank - a.rank || miss(a.c) - miss(b.c) || collator.compare(sortTitle(a.c), sortTitle(b.c)));
	}

	const RADAR_FIELDS = ["NOTES", "PEAK", "SCRATCH", "SOF-LAN", "CHARGE", "CHORD"];
	/** 小数2桁で切り捨て（浮動小数の誤差で 1.23 が 1.2299999… になって 1.22 に落ちないよう微小値を足す） */
	const floor2 = (v) => Math.floor(v * 100 + 1e-6) / 100;
	/**
	 * プレイヤーのノーツレーダー。項目ごとに「譜面のレーダー値 × スコアレート（EX ÷ (ノーツ数×2)）」を計算し、
	 * 上位10譜面の平均をその項目の値にする（SP/DP は別々に計算）。
	 * 同じ曲の譜面は一番高いもの1つだけ数える（SPH と SPA が両方上位にいても1件。2026-11-12 実機と照合して確認）。
	 * 戻り値: { NOTES: { value, top: [{ c, radar, rate, score }] }, … }
	 */
	function playerRadar(charts, style, n = 10) {
		const played = charts.filter((c) => c.style === style && c.played && c.radar && c.notes > 0);
		const out = {};
		for (const f of RADAR_FIELDS) {
			const seen = new Set();
			const list = played
				.map((c) => { const radar = Number(c.radar[f]) || 0; return { c, radar, rate: c.rate, score: floor2(radar * c.rate) }; })
				.filter((x) => x.score > 0)
				.sort((a, b) => b.score - a.score)
				.filter((x) => !seen.has(x.c.title) && seen.add(x.c.title))
				.slice(0, n);
			// 端数は四捨五入ではなく切り捨て（実機と照合済み）。譜面ごとの値も平均も小数2桁で切り捨て。誤差を避けるため 1/100 単位の整数で計算
			const sum = list.reduce((s, x) => s + Math.round(x.score * 100), 0);
			out[f] = { value: Math.floor(sum / n) / 100, top: list };
		}
		return out;
	}

	/**
	 * ノーツレーダーを伸ばすためのおすすめ譜面。
	 * 「そのレベルでいつも出しているスコアレート（プレイ済み譜面の中央値。自己ベストの方が高ければそちら）」で遊んだと仮定し、
	 * 今の10位（ボーダー）を超えて項目の値がどれだけ上がるかを見積もって、上がり幅の大きい順に並べる。未解禁の譜面は除く。
	 * 戻り値: { NOTES: { border, list: [{ c, radar, expRate, needRate, gain }] }, … }
	 */
	function radarRecommend(charts, style, pr, n = 10) {
		const mine = charts.filter((c) => c.style === style && c.open && c.radar && c.notes > 0);
		const byLevel = new Map();
		for (const c of mine) if (c.played) {
			if (!byLevel.has(c.level)) byLevel.set(c.level, []);
			byLevel.get(c.level).push(c.rate);
		}
		const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
		// 中央値はレベルごとに1回だけ計算しておく（譜面ごとに並べ替え直すと、全譜面が対象のとき10秒以上かかっていた）
		const allMedian = median([...byLevel.values()].flat());
		const levelMedian = new Map([...byLevel].map(([lv, rates]) => [lv, rates.length >= 3 ? median(rates) : allMedian]));
		const typical = (lv) => (levelMedian.has(lv) ? levelMedian.get(lv) : allMedian);
		const out = {};
		for (const f of RADAR_FIELDS) {
			const top = pr[f].top;
			const border = top.length < 10 ? 0 : top[top.length - 1].score;
			const inTop = new Set(top.map((x) => x.c.id));
			const songTop = new Map(top.map((x) => [x.c.title, x.score]));
			const list = [];
			for (const c of mine) {
				if (inTop.has(c.id)) continue;
				const radar = Number(c.radar[f]) || 0;
				if (!radar) continue;
				// 同じ曲の別譜面が上位にいるなら、それを超えないと値は上がらない（1曲1譜面のため）
				const bar = songTop.has(c.title) ? songTop.get(c.title) : border;
				const expRate = Math.max(c.played ? c.rate : 0, typical(c.level));
				const exp = radar * expRate;
				if (exp <= bar) continue;
				list.push({ c, radar, expRate, needRate: bar / radar, gain: (exp - bar) / 10 });
			}
			list.sort((a, b) => b.gain - a.gain);
			out[f] = { border, list: list.slice(0, n) };
		}
		return out;
	}

	/**
	 * クリア済み（EASY CLEAR 以上）の譜面の EX スコアを伸ばして10位に入れる候補。
	 * 「あと EX スコアを何点伸ばせば10位（ボーダー）を超えるか」が少ない順に並べる。
	 * 戻り値: { NOTES: { border, list: [{ c, radar, needRate, needEx }] }, … }
	 */
	function radarRecommendScore(charts, style, pr, n = 10) {
		const easy = LAMPS.indexOf("EASY CLEAR");
		const cleared = charts.filter((c) => c.style === style && c.played && c.lampIdx >= easy && c.radar && c.notes > 0);
		const out = {};
		for (const f of RADAR_FIELDS) {
			const top = pr[f].top;
			const border = top.length < 10 ? 0 : top[top.length - 1].score;
			const inTop = new Set(top.map((x) => x.c.id));
			const songTop = new Map(top.map((x) => [x.c.title, x.score]));
			const list = [];
			for (const c of cleared) {
				if (inTop.has(c.id)) continue;
				const radar = Number(c.radar[f]) || 0;
				if (!radar) continue;
				// 同じ曲の別譜面が上位にいるなら、それを超えないと値は上がらない（1曲1譜面のため）
				const needRate = (songTop.has(c.title) ? songTop.get(c.title) : border) / radar;
				if (needRate > 1) continue; // MAX でも届かない
				// ボーダーを「超える」のに必要な EX スコア（同点では入れ替わらない）
				const needEx = Math.floor(needRate * c.notes * 2) + 1 - c.ex;
				if (needEx <= 0 || c.ex + needEx > c.notes * 2) continue;
				list.push({ c, radar, needRate, needEx });
			}
			list.sort((a, b) => a.needEx - b.needEx || b.radar - a.radar);
			out[f] = { border, list: list.slice(0, n) };
		}
		return out;
	}

	/**
	 * 更新履歴（Google ドライブの history.json）を、新しい順の回ごとにまとめる。
	 * 変化は [曲名, "SPA", [ランプ, EX, MISS] or null, [ランプ, EX, MISS]]。譜面が一覧にあれば c に入る（DJ LEVEL・詳細表示用）
	 */
	const matcherCache = new WeakMap();
	// 絞り込みのたびに呼ばれるので、一覧と履歴が同じなら作り直さない（レーダーの計算が重いため。2026-11-21）
	const sessionsCache = new WeakMap();
	function historySessions(history, charts) {
		const hit = sessionsCache.get(charts);
		if (hit && hit.history === history) return hit.sessions;
		const sessions = buildHistorySessions(history, charts);
		attachHistoryRadar(sessions, charts);
		sessionsCache.set(charts, { history, sessions });
		return sessions;
	}

	/**
	 * 履歴の各回で、プレイヤーのノーツレーダー（playerRadar）が上がった項目と、上げた譜面（2026-11-21）。
	 * 今のスコアから新しい回の順に「前の EX」へ戻しながら、回の前と後のレーダーを計算して比べる。
	 * 上げた譜面＝その回でスコアが伸び、回の後にその項目の上位10曲に入っていて、回の前より値が上がった譜面。
	 * 回に s.radarUp = [{ style, f, before, after }]、変化に x.radarUp = [{ f, before, after }]（before / after は項目全体の値）
	 */
	function attachHistoryRadar(sessions, charts) {
		const cur = new Map(charts.filter((c) => c.radar && c.notes > 0).map((c) => [c.id, { c, ex: c.ex, played: c.played }]));
		const snap = () => [...cur.values()].map(({ c, ex, played }) => ({
			id: c.id, title: c.title, style: c.style, radar: c.radar, notes: c.notes, played, rate: played ? ex / (c.notes * 2) : 0,
		}));
		for (const s of sessions) { // 新しい順
			s.radarUp = [];
			for (const x of s.changes) x.radarUp = [];
			if (s.baseline) continue;
			const afterCharts = snap();
			for (const x of s.changes) {
				const e = cur.get(x.id);
				if (!e) continue;
				e.ex = x.before ? x.before.ex : 0;
				e.played = !!x.before && x.before.lamp !== "NO PLAY";
			}
			const beforeCharts = snap();
			for (const style of ["SP", "DP"]) {
				const changed = s.changes.filter((x) => x.style === style && x.exDiff > 0 && cur.has(x.id));
				if (!changed.length) continue;
				const A = playerRadar(afterCharts, style), B = playerRadar(beforeCharts, style);
				for (const f of RADAR_FIELDS) {
					if (A[f].value <= B[f].value) continue;
					const up = { f, before: B[f].value, after: A[f].value };
					s.radarUp.push({ style, ...up });
					const bScore = new Map(B[f].top.map((t) => [t.c.id, t.score]));
					for (const x of changed) {
						const t = A[f].top.find((t) => t.c.id === x.id);
						if (t && t.score > (bScore.get(x.id) ?? 0)) x.radarUp.push(up);
					}
				}
			}
		}
	}

	function buildHistorySessions(history, charts) {
		const byId = new Map(charts.map((c) => [c.id, c]));
		// スコア CSV から作った履歴は曲名が CSV の表記（「，」や末尾の空白など）なので、楽曲データの曲名に合わせる
		// （絞り込みのたびに呼ばれるので、一覧が同じなら作り直さない）
		if (!matcherCache.has(charts)) matcherCache.set(charts, titleMatcher([...new Set(charts.map((c) => c.title))]));
		const match = matcherCache.get(charts);
		const sessions = ((history && history.sessions) || []).map((s) => {
			const changes = (s.changes || []).map(([rawTitle, key, b, a]) => {
				const title = match(rawTitle) || rawTitle;
				const c = byId.get(`${key}|${title}`) || null;
				const side = (v) => {
					if (!v) return null;
					const [rawLamp, ex, miss] = v;
					const lamp = rawLamp === "FULLCOMBO CLEAR" ? "FULL COMBO" : rawLamp;
					const g = c && lamp !== "NO PLAY" ? grade(c.notes, ex) : { grade: "", detail: "", rate: 0 };
					return { lamp, lampIdx: LAMPS.indexOf(lamp), ex, miss, grade: g.grade, rate: g.rate };
				};
				const before = side(b), after = side(a);
				return {
					id: `${key}|${title}`, c, title, key, style: key.slice(0, 2), diff: key.slice(2),
					level: c ? c.level : "", before, after,
					// NO PLAY → FAILED（初めて遊んで落ちた）はランプ更新に数えない（2026-11-20）
					lampUp: after.lamp !== "FAILED" && after.lampIdx > (before ? before.lampIdx : 0),
					exDiff: after.ex - (before ? before.ex : 0),
					missDiff: before && before.miss != null && after.miss != null ? after.miss - before.miss : null,
				};
			});
			// ランプが上がった譜面を先に。その中はレベルの高い順、同じなら EX の伸びが大きい順
			changes.sort((x, y) => (y.lampUp - x.lampUp) || (Number(y.level) || 0) - (Number(x.level) || 0) || y.exDiff - x.exDiff);
			return { at: Date.parse(s.at), baseline: !!s.baseline, count: s.count || 0, changes };
		});
		return sessions.sort((a, b) => b.at - a.at);
	}

	// ---------- e-amusement のスコア CSV（○○_sp_score.csv） ----------
	/** カンマ区切りを行・列に分ける（"..." で囲まれた値にも対応） */
	function splitCsv(text) {
		const rows = [];
		let row = [], cell = "", q = false;
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (q) {
				if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
				else cell += ch;
			} else if (ch === '"' && cell === "") q = true;
			else if (ch === ",") { row.push(cell); cell = ""; }
			else if (ch === "\n" || ch === "\r") {
				if (ch === "\r" && text[i + 1] === "\n") i++;
				row.push(cell); rows.push(row); row = []; cell = "";
			} else cell += ch;
		}
		if (cell || row.length) { row.push(cell); rows.push(row); }
		return rows.filter((r) => r.some((c) => c !== ""));
	}

	/**
	 * スコア CSV を読む。戻り値 { style, songs: [{ title, version, charts: { B: { lamp, ex, miss, plays, lastPlay, updated }, ... } }], lastPlay }
	 * CSV のクリアタイプは "FULLCOMBO CLEAR" だけビューアの "FULL COMBO" と表記が違う
	 */
	function parseScoreCsv(text, fileName = "") {
		const rows = splitCsv(text.replace(/^﻿/, ""));
		const head = rows.shift() || [];
		const col = (name) => head.indexOf(name);
		const iTitle = col("タイトル");
		if (iTitle < 0 || col("ANOTHER スコア") < 0) throw new Error("e-amusement のスコア CSV ではないようです");
		const style = /_dp_score/i.test(fileName) ? "DP" : "SP";
		const date = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || "") ? s : "");
		let lastPlay = "";
		const songs = rows.map((r) => {
			const charts = {};
			for (const d of DIFFS) {
				const n = DIFF_NAMES[d];
				const at = (k) => r[col(`${n} ${k}`)] ?? "";
				let lamp = at("クリアタイプ");
				if (lamp === "FULLCOMBO CLEAR") lamp = "FULL COMBO";
				const lp = date(at("最終プレー日時"));
				if (lp > lastPlay) lastPlay = lp;
				charts[d] = {
					lamp, ex: Number(at("スコア")) || 0, miss: /^\d+$/.test(at("ミスカウント")) ? Number(at("ミスカウント")) : null,
					plays: Number(at("プレー回数")) || 0, lastPlay: lp, updated: date(at("最終スコア更新時刻")),
				};
			}
			return { title: r[iTitle], version: r[col("バージョン")] || "", charts };
		});
		return { style, songs, lastPlay };
	}

	/**
	 * CSV の曲名を楽曲データの曲名に合わせる。CSV は「,」が「，」、「"」が抜けている、末尾に空白があるなど表記がゆれるので、
	 * 完全一致 → 空白と全角半角だけそろえて一致 → 記号も無視して一致、の順に試す（あとの2つは候補が1曲に決まるときだけ。
	 * 「SHOOTING STAR」と「Shooting Star」のように大文字小文字だけ違う別の曲があるため）
	 */
	function titleMatcher(titles) {
		const exact = new Set(titles);
		const light = (s) => String(s).normalize("NFKC").replace(/\s+/g, " ").trim();
		const strong = (s) => looseTitle(String(s).replace(/ƒ/g, "f").replace(/[･・…]/g, ""));
		const idx = (fn) => {
			const m = new Map();
			for (const t of exact) { const k = fn(t); m.set(k, m.has(k) ? null : t); }
			return m;
		};
		const byLight = idx(light), byStrong = idx(strong);
		return (title) => (exact.has(title) ? title : byLight.get(light(title)) || byStrong.get(strong(title)) || null);
	}

	// ---------- YouTube の動画（MV リンク） ----------
	// タイトルの例: "[12]Dahlia(RANDOM/HARD)"、"[10]the trigger of innocence†(RANDOM/EXH) AA"、"[12]Viridian"、"[11]FOO(SPH/RANDOM/FC)"
	//   [レベル]曲名(オプション/ランプ) の形。† 付きは LEGGENDARIA。"AC" で始まるものはアーケードの動画なので使わない
	const VIDEO_TOKENS = new Set(["RANDOM", "RAN", "RRAN", "SRAN", "S-RANDOM", "R-RANDOM", "MIRROR", "HARD", "EASY", "EXH", "FC", "CLEAR", "AE", "ASSIST", "SPB", "SPN", "SPH", "SPA", "SPL"]);
	const VIDEO_RANDOM = new Set(["RANDOM", "RAN", "RRAN", "SRAN", "S-RANDOM", "R-RANDOM", "MIRROR"]);
	const VIDEO_LAMP = { EASY: "EASY CLEAR", CLEAR: "CLEAR", HARD: "HARD CLEAR", EXH: "EX HARD CLEAR", FC: "FULL COMBO", AE: "ASSIST CLEAR", ASSIST: "ASSIST CLEAR" };
	/** 動画タイトルを読む。{ level, song, diff: "A" など or null, leggendaria, random: 正規以外か, lamp } 読めなければ null。ランプが書いていなければ CLEAR */
	function parseVideoTitle(title) {
		const t = String(title || "").trim();
		if (/^AC/i.test(t)) return null;
		const m = t.match(/^\[(\d+)\](.*)$/);
		if (!m) return null;
		const rest = m[2];
		let song = rest.trim(), opts = [];
		// 曲名にもカッコがある（"(This Is Not) The Angels"、"THE SHINING POLARIS(kors k mix)"）ので、
		// 中身が全部オプション・ランプの言葉になっている最後のカッコだけをオプションとみなす。後ろの " AA" などは捨てる
		const groups = [...rest.matchAll(/\(([^()]*)\)/g)];
		for (let i = groups.length - 1; i >= 0; i--) {
			const toks = groups[i][1].split(/[/\\]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
			if (toks.length && toks.every((x) => VIDEO_TOKENS.has(x))) { opts = toks; song = rest.slice(0, groups[i].index).trim(); break; }
		}
		const leggendaria = /†$/.test(song);
		song = song.replace(/†$/, "").trim();
		const d = opts.find((x) => /^SP[BNHAL]$/.test(x));
		const lampTok = opts.find((x) => VIDEO_LAMP[x]);
		return {
			level: Number(m[1]), song, diff: d ? d[2] : null, leggendaria,
			random: opts.some((x) => VIDEO_RANDOM.has(x)), lamp: lampTok ? VIDEO_LAMP[lampTok] : "CLEAR",
		};
	}

	/**
	 * YouTube の動画を譜面に割り当てる。videos は [{ id, title, at }]、kind は "regular"（正規）/ "random"（正規以外）。
	 * 戻り値 { map: Map<曲名, { SPA: [{ url, title, lamp, at }, ...（新しい順）] }>, skipped: [割り当てられなかった動画のタイトル] }。
	 * 1つの譜面に動画が何本あってもよい。
	 * 譜面はタイトルの SPx、† なら L、なければレベルが同じ譜面（A → H → N → B の順）。
	 * レベルが合う譜面が無いとき（レベル改定のあと）は A にする
	 */
	function videoMap(music, videos, kind) {
		const match = titleMatcher(music.musicList.map((s) => s.TITLE));
		const songs = new Map(music.musicList.map((s) => [s.TITLE, s]));
		const map = new Map();
		const skipped = [];
		const sorted = (videos || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
		for (const v of sorted) {
			const p = parseVideoTitle(v.title);
			if (!p) continue;
			if (p.random !== (kind === "random")) continue;
			const t = match(p.song);
			const song = t && songs.get(t);
			if (!song) { skipped.push(v.title); continue; }
			const has = (d) => song["SP" + d] && song["SP" + d].DIFFICULT;
			let d = p.diff || (p.leggendaria ? "L" : ["A", "H", "N", "B"].find((x) => has(x) && Number(song["SP" + x].DIFFICULT) === p.level));
			if (!d) d = has("A") ? "A" : null;
			if (!d || !has(d)) { skipped.push(v.title); continue; }
			if (!map.has(t)) map.set(t, {});
			const o = map.get(t);
			(o["SP" + d] = o["SP" + d] || []).push({ url: `https://www.youtube.com/watch?v=${v.id}`, title: v.title, lamp: p.lamp, at: v.at });
		}
		return { map, skipped };
	}

	/**
	 * CSV の内容でリザルトを作る（build に渡す形）。動画は mvs（videoMap の map、なければ無し）から付ける。
	 * CSV に無い曲（未購入のパックなど）は未解禁、CSV にあって遊んでいない譜面は NO PLAY として扱う。
	 * CSV の反対の style（今は DP）は、CSV にある曲なら NO PLAY、無い曲なら未解禁
	 * 戻り値 { results, unmatched: [CSV の曲名] }。同じ music・mvs・csv なら前の結果を使い回す
	 */
	const applyCache = new WeakMap();
	function applyScoreCsv(music, mvs, csv) {
		const hit = applyCache.get(csv);
		if (hit && hit.music === music && hit.mvs === mvs) return hit.out;
		const match = titleMatcher(music.musicList.map((s) => s.TITLE));
		const byTitle = new Map();
		const unmatched = [];
		for (const s of csv.songs) {
			const t = match(s.title);
			if (t) byTitle.set(t, s); else unmatched.push(s.title);
		}
		const results = music.musicList.map((song) => {
			const s = byTitle.get(song.TITLE);
			const mv = (mvs && mvs.get(song.TITLE)) || {};
			const out = { TITLE: song.TITLE };
			for (const st of ["SP", "DP"]) {
				for (const d of DIFFS) {
					const key = st + d;
					const c = s && st === csv.style ? s.charts[d] : null;
					const videos = mv[key] || [];
					out[key] = c ? {
						OPEN: "TRUE", CLEARSTATUS: c.lamp === "NO PLAY" ? "" : c.lamp, EXSCORE: c.ex, MISSCOUNT: c.miss ?? "", VIDEOS: videos,
						PLAYS: c.plays, LASTPLAY: c.lastPlay, UPDATED: c.updated,
					} : { OPEN: s ? "TRUE" : "", VIDEOS: videos };
				}
			}
			return out;
		});
		const out = { results, unmatched };
		applyCache.set(csv, { music, mvs, out });
		return out;
	}

	return { parseMusicTsv, parseScoreCsv, applyScoreCsv, parseVideoTitle, videoMap, historySessions, DIFFS, DIFF_NAMES, LAMPS, LAMP_SHORT, GRADES, LOCKED, ABILITY_GOAL, ABILITY_CAND_GOAL, RADAR_FIELDS, playerRadar, radarRecommend, radarRecommendScore, folderOrder, grade, build, filter, sort, summarize, rivalSummary, radarMap, abilityMap, abilityGroups, abilityCandidates };
})();
