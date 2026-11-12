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

	function bpmOf(song, key, customBPM) {
		return (customBPM && customBPM[song.TITLE] && customBPM[song.TITLE][key]) || song.BPM || "";
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
						cn: c.CN || "", bss: c.BSS || "",
						// BPM に "-" があれば（例: 150-300）ソフラン曲
						soflan: String(bpm).includes("-") ? "SOF-LAN" : "",
						bpm, bpmNum: bpmValue(bpm),
						open, lamp, lampIdx: LAMPS.indexOf(lamp), played,
						ex, miss: played && r.MISSCOUNT !== "" && r.MISSCOUNT != null && r.MISSCOUNT !== "-" ? Number(r.MISSCOUNT) : null,
						grade: g.grade, gradeDetail: g.detail, rate: g.rate,
						mv: /^https?:\/\//.test(r.MV || "") ? r.MV : "",
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

	const RADAR_FIELDS = ["NOTES", "PEAK", "SCRATCH", "SOF-LAN", "CHARGE", "CHORD"];
	/** 小数2桁で切り捨て（浮動小数の誤差で 1.23 が 1.2299999… になって 1.22 に落ちないよう微小値を足す） */
	const floor2 = (v) => Math.floor(v * 100 + 1e-6) / 100;
	/**
	 * プレイヤーのノーツレーダー。項目ごとに「譜面のレーダー値 × スコアレート（EX ÷ (ノーツ数×2)）」を計算し、
	 * 上位10譜面の平均をその項目の値にする（SP/DP は別々に計算）。
	 * 戻り値: { NOTES: { value, top: [{ c, radar, rate, score }] }, … }
	 */
	function playerRadar(charts, style, n = 10) {
		const played = charts.filter((c) => c.style === style && c.played && c.radar && c.notes > 0);
		const out = {};
		for (const f of RADAR_FIELDS) {
			const list = played
				.map((c) => { const radar = Number(c.radar[f]) || 0; return { c, radar, rate: c.rate, score: floor2(radar * c.rate) }; })
				.filter((x) => x.score > 0)
				.sort((a, b) => b.score - a.score)
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
		const allRates = [...byLevel.values()].flat();
		const typical = (lv) => (byLevel.get(lv)?.length >= 3 ? median(byLevel.get(lv)) : median(allRates));
		const out = {};
		for (const f of RADAR_FIELDS) {
			const top = pr[f].top;
			const border = top.length < 10 ? 0 : top[top.length - 1].score;
			const inTop = new Set(top.map((x) => x.c.id));
			const list = [];
			for (const c of mine) {
				if (inTop.has(c.id)) continue;
				const radar = Number(c.radar[f]) || 0;
				if (!radar) continue;
				const expRate = Math.max(c.played ? c.rate : 0, typical(c.level));
				const exp = radar * expRate;
				if (exp <= border) continue;
				list.push({ c, radar, expRate, needRate: border / radar, gain: (exp - border) / 10 });
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
			const list = [];
			for (const c of cleared) {
				if (inTop.has(c.id)) continue;
				const radar = Number(c.radar[f]) || 0;
				if (!radar) continue;
				const needRate = border / radar;
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

	return { DIFFS, DIFF_NAMES, LAMPS, LAMP_SHORT, GRADES, LOCKED, ABILITY_GOAL, RADAR_FIELDS, playerRadar, radarRecommend, radarRecommendScore, folderOrder, grade, build, filter, sort, summarize, rivalSummary, radarMap, abilityMap, abilityGroups };
})();
