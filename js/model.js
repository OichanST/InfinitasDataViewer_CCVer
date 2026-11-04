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

	/**
	 * 一覧を作る。results は自分のリザルト（なければ null）、rivals は { id, results } の配列。
	 */
	function build(music, results, rivals) {
		const resByTitle = new Map((results || []).map((r) => [r.TITLE, r]));
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
						title: song.TITLE, artist: song.ARTIST || "", genre: song.GENRE || "", folder: song.FOLDER || "", pkg,
						level: Number(c.DIFFICULT), notes: Number(c.NOTES) || 0,
						cn: c.CN || "", bss: c.BSS || "",
						bpm, bpmNum: bpmValue(bpm),
						open, lamp, lampIdx: LAMPS.indexOf(lamp), played,
						ex, miss: played && r.MISSCOUNT !== "" && r.MISSCOUNT != null && r.MISSCOUNT !== "-" ? Number(r.MISSCOUNT) : null,
						grade: g.grade, gradeDetail: g.detail, rate: g.rate,
						mv: /^https?:\/\//.test(r.MV || "") ? r.MV : "",
						searchText,
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
			if (f.folder && c.folder !== f.folder) return false;
			if (f.cn === "cn" && !c.cn && !c.bss) return false;
			if (f.cn === "none" && (c.cn || c.bss)) return false;
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

	return { DIFFS, DIFF_NAMES, LAMPS, LAMP_SHORT, GRADES, LOCKED, grade, build, filter, sort, summarize, rivalSummary };
})();
