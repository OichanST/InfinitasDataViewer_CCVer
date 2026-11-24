"use strict";
/**
 * 画面の状態（絞り込み条件）と描画。条件は URL の # に入れるので、ブックマークや共有でそのまま開ける。
 */
(() => {
	const M = IV.model;
	const $ = (s) => document.querySelector(s);
	const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
	const cssKey = (s) => String(s).replace(/ /g, "_");
	const PAGE = 150; // 一度に描画する行数（スクロールで追加）

	const DEFAULT = { style: "SP", levels: [12], diffs: [], lamps: [], grades: [], q: "", sort: "level", dir: "asc", hideLocked: false, rival: "", rivalResult: "", view: "list", abMode: "nomage", fdOpen: "", recMode: "rate" };
	const state = {
		id: "", guest: false,
		music: null, rivals: [], // rivals: [{ id, csv: ドライブのスコア CSV }]
		videos: null, // YouTube のアップロード動画 [{ id, title, at }]（MV。DJ ごとに正規 / 正規以外を選んで譜面に割り当てる）
		charts: [], view: [], shown: 0,
		radarMap: new Map(),
		abilityMap: new Map(),
		history: null, // Google ドライブの history.json（まだ無ければ null）
		csv: null, // スコア CSV（ドライブの latest.csv）{ name, csv, at, drive }。無ければ null
		csvChecked: false, // ドライブの CSV を確認し終えたか
		f: null,
	};

	// ---------- 条件 <-> URL ----------
	function toFilter(o) {
		return { ...o, levels: new Set(o.levels), diffs: new Set(o.diffs), lamps: new Set(o.lamps), grades: new Set(o.grades) };
	}
	function readHash() {
		const p = new URLSearchParams(location.hash.slice(1));
		const list = (k, num) => (p.get(k) ? p.get(k).split(",").filter(Boolean).map((v) => (num ? Number(v) : v)) : null);
		const saved = IV.api.prefs.get("filter", DEFAULT);
		const o = { ...DEFAULT, ...saved };
		if (p.has("s")) o.style = p.get("s") === "DP" ? "DP" : "SP";
		for (const [k, key, num] of [["lv", "levels", true], ["d", "diffs"], ["lamp", "lamps"], ["g", "grades"]]) {
			const v = list(k, num);
			if (v) o[key] = v;
		}
		for (const [k, key] of [["q", "q"], ["sort", "sort"], ["dir", "dir"], ["rv", "rival"], ["rr", "rivalResult"], ["fo", "fdOpen"]]) {
			if (p.has(k)) o[key] = p.get(k);
		}
		if (p.has("lock")) o.hideLocked = p.get("lock") === "0";
		if (p.has("v")) o.view = { ab: "ability", fd: "folder", rd: "radar", rl: "rival", hs: "history" }[p.get("v")] || "list";
		if (p.has("abm")) o.abMode = p.get("abm") === "hard" ? "hard" : "nomage";
		if (!["ability", "folder", "radar", "rival", "history"].includes(o.view)) o.view = "list";
		if (o.abMode !== "hard") o.abMode = "nomage";
		return toFilter(o);
	}
	function writeHash() {
		const f = state.f;
		const p = new URLSearchParams();
		p.set("s", f.style);
		if (f.levels.size) p.set("lv", [...f.levels].sort((a, b) => a - b).join(","));
		if (f.diffs.size) p.set("d", [...f.diffs].join(","));
		if (f.lamps.size) p.set("lamp", [...f.lamps].join(","));
		if (f.grades.size) p.set("g", [...f.grades].join(","));
		if (f.q) p.set("q", f.q);
		if (f.sort !== "level") p.set("sort", f.sort);
		if (f.dir !== "asc") p.set("dir", f.dir);
		if (f.hideLocked) p.set("lock", "0");
		if (f.view === "rival" && f.rival) p.set("rv", f.rival);
		if (f.view === "rival" && f.rivalResult) p.set("rr", f.rivalResult);
		if (f.view === "ability") p.set("v", "ab");
		if (f.view === "folder") p.set("v", "fd");
		if (f.view === "radar") p.set("v", "rd");
		if (f.view === "history") p.set("v", "hs");
		if (f.view === "rival") p.set("v", "rl");
		if (f.view === "folder" && f.fdOpen) p.set("fo", f.fdOpen);
		if (f.abMode === "hard") p.set("abm", "hard");
		const url = new URL(location.href);
		if (state.id) url.searchParams.set("id", state.id); else url.searchParams.delete("id");
		url.hash = p.toString().replace(/%2C/g, ",");
		history.replaceState(null, "", url);
		IV.api.prefs.set("filter", {
			...f, levels: [...f.levels], diffs: [...f.diffs], lamps: [...f.lamps], grades: [...f.grades], q: "",
		});
	}

	// ---------- 共通 ----------
	let toastTimer;
	function toast(msg) {
		const t = $("#toast");
		t.textContent = msg; t.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (t.hidden = true), 3000);
	}
	function loading(on, text) {
		$("#loading").hidden = !on;
		if (text) $("#loadingText").textContent = text;
	}
	/** 履歴の日付: "2026/11/17"（時刻は出さない） */
	function dateText(at) {
		const d = new Date(at);
		return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
	}
	function timeText(at) {
		const d = new Date(at);
		return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	}
	function setSync(text) { $("#sync").textContent = text; }

	// ---------- データ読み込み ----------
	/**
	 * 自分とライバルのリザルトは e-amusement のスコア CSV から作る（GAS のスコアは使わない）。
	 * 自分の CSV はドライブの INFINITAS履歴/<DJ名>/latest.csv。
	 * MV は YouTube の動画をタイトルで譜面に割り当てる（1譜面に何本でも）
	 */
	let mvCache = null;
	function myVideos() {
		const kind = IV.api.youtubeKind(state.id);
		if (!kind || !state.videos || !state.music) return null;
		if (mvCache && mvCache.music === state.music && mvCache.videos === state.videos && mvCache.kind === kind) return mvCache.map;
		const { map, skipped } = M.videoMap(state.music, state.videos, kind);
		if (skipped.length) console.warn("譜面に割り当てられなかった動画:", skipped);
		mvCache = { music: state.music, videos: state.videos, kind, map };
		return map;
	}
	const csvResults = (csv) => {
		const { results, unmatched } = M.applyScoreCsv(state.music, myVideos(), csv);
		if (unmatched.length) console.warn("楽曲データに見つからなかった CSV の曲:", unmatched);
		return results;
	};
	// CSV があるか分かるまで（ドライブの確認が済むまで）は描画を待つ
	const hasResults = () => state.guest || !!state.csv || state.csvChecked;
	/** "2026-10-23 15:41" → "10/23 15:41" */
	const csvTime = (s) => s ? s.replace(/^\d{4}-0?(\d+)-0?(\d+)/, "$1/$2") : "";
	function syncText() {
		if (state.guest) setSync(`${timeText(Date.now())} 時点`);
		// CSV の中でいちばん新しい「最終プレー日時」（いつ遊んだ分までのスコアか）
		else if (state.csv) setSync(csvTime(state.csv.csv.lastPlay));
		else setSync("スコア CSV がありません");
	}

	function rebuild() {
		if (!state.music) return;
		const mine = state.guest || !state.csv ? null : csvResults(state.csv.csv);
		const rivals = state.rivals.map((rv) => ({ id: rv.id, results: rv.csv ? M.applyScoreCsv(state.music, null, rv.csv).results : null }));
		state.charts = M.build(state.music, mine, rivals, state.radarMap, state.abilityMap);
		$("#version").textContent = state.music.version ? `DATA ${state.music.version}` : "";
		apply();
	}

	async function loadAll(force = false) {
		const tasks = [];
		let firstPaint = !state.music;
		if (firstPaint) loading(true, "楽曲データを読み込み中…");
		setSync("更新を確認中…");
		const redraw = () => { if (state.music && hasResults()) { loading(false); rebuild(); } };
		const onMusic = (data, info) => {
			state.music = data;
			if (info.updated) toast("楽曲データを更新しました");
			redraw();
		};
		tasks.push(IV.api.loadMusic(onMusic, { force }));
		tasks.push(IV.api.loadRadar((data) => { state.radarMap = M.radarMap(data); redraw(); }, { force })
			.catch((e) => console.warn("ノーツレーダーの読み込みに失敗しました", e)));
		tasks.push(IV.api.loadAbility((data) => { state.abilityMap = M.abilityMap(data); redraw(); }, { force })
			.catch((e) => console.warn("地力表の読み込みに失敗しました", e)));
		if (!state.guest) {
			const id = state.id;
			// スコア CSV（ドライブの latest.csv）
			tasks.push(IV.api.loadDriveCsv(id, (data, info) => {
				if (state.id !== id) return;
				state.csv = data ? { name: data.name, csv: data.csv, at: Date.parse(data._mt), drive: true } : null;
				state.csvChecked = true;
				if (info.updated && data) toast("スコア CSV を更新しました");
				redraw();
			}, { force }).catch((e) => {
				state.csvChecked = true;
				redraw();
				throw e;
			}));
			// MV（YouTube の動画一覧）。MV を出す DJ だけ。読めなくてもほかの表示には影響させない
			if (IV.api.youtubeKind(id)) {
				tasks.push(IV.api.loadYoutube((data) => {
					if (state.id !== id || !Array.isArray(data)) return;
					state.videos = data;
					redraw();
				}, { force }).catch((e) => console.warn("MV（YouTube）を読み込めませんでした", e)));
			}
			for (const rv of state.rivals) {
				tasks.push(IV.api.loadDriveCsv(rv.id, (data) => { rv.csv = data ? data.csv : null; redraw(); }, { force })
					.catch((e) => toast(`${rv.id} のスコア CSV を読み込めませんでした`)));
			}
			// 更新履歴（Google ドライブ）。読めなくてもほかの表示には影響させない
			tasks.push(IV.api.loadHistory(id, (data) => {
				if (state.id !== id) return;
				state.history = data;
				if (state.charts.length) apply();
			}, { force }).catch((e) => console.warn("更新履歴の読み込みに失敗しました", e)));
		}
		try {
			await Promise.all(tasks);
			syncText();
			if (!state.guest && !state.csv) toast("スコア CSV がありません。ドライブの INFINITAS履歴/DJ名/latest.csv に置いてください");
		} catch (e) {
			console.error(e);
			setSync("更新に失敗しました");
			if (!state.charts.length) {
				toast(e.message || "データを読み込めませんでした");
			} else {
				toast("最新データを取得できませんでした（保存済みのデータを表示しています）");
			}
		} finally {
			loading(false);
		}
	}

	// ---------- 絞り込み・描画 ----------
	/** ライバルタブの絞り込み: 上の条件＋選んだライバルが遊んだ譜面＋勝敗。ほかのタブではライバルの条件は効かない */
	function viewCharts() {
		const f = state.f;
		if (f.view !== "rival") return M.filter(state.charts, { ...f, rivalResult: "" });
		if (!f.rival) return [];
		return M.filter(state.charts, f).filter((c) => (c.rivals.find((r) => r.id === f.rival) || {}).played);
	}
	function apply() {
		const f = state.f;
		// ライバルタブは、選んでいなければ（または外したライバルなら）最初のライバルにする
		if (!state.rivals.some((r) => r.id === f.rival)) { f.rival = state.rivals.length ? state.rivals[0].id : ""; }
		// ライバルを登録していなければライバルタブは出さない（開いていたら一覧に戻す）
		$('#viewTabs [data-view="rival"]').hidden = !state.rivals.length;
		if (!state.rivals.length && f.view === "rival") f.view = "list";
		if (f.view !== "rival" && f.sort === "rival") f.sort = "level"; // 「ライバルとの差順」はライバルタブだけ
		const base = viewCharts();
		state.view = M.sort(base, f.sort, f.dir, f.rival);
		renderSummary();
		$("#list").innerHTML = "";
		state.shown = 0;
		renderMore();
		$("#empty").hidden = state.view.length > 0;
		writeHash();
		renderControls();
		renderAbility();
		renderFolders();
		renderRivalView();
		renderPlayerRadar();
		state.histSessions = M.historySessions(state.history, state.charts);
		renderHistory();
	}

	// ---------- 更新履歴 ----------
	const lampHtml = (l) => `<span style="color:var(--lt-${cssKey(l)}, var(--l-${cssKey(l)}))">${esc(l)}</span>`;
	// 正式名と略称の両方を入れておき、CSS でどちらかを出す（スマホの詳細の HISTORY は略称。2026-11-20）
	const lampFS = (l) => `<span class="lampFull">${esc(l)}</span><span class="lampShort">${esc(M.LAMP_SHORT[l] || l)}</span>`;
	const lampHtmlFS = (l) => `<span style="color:var(--lt-${cssKey(l)}, var(--l-${cssKey(l)}))">${lampFS(l)}</span>`;
	const signed = (n) => (n > 0 ? "+" : "") + n;
	/** 1譜面ぶんの変化のセル（ランプ / DJ LEVEL / EX SCORE / MISS COUNT）。変わったところだけ「前 → 後」 */
	function changeCells(x) {
		const b = x.before, a = x.after;
		// hTo（→ 後のランプ）と差分の括弧は、詳細画面（PC）で下の段に回せるよう別の要素にしておく
		const lamp = !b || b.lamp !== a.lamp ? `${lampHtmlFS(b ? b.lamp : "NO PLAY")} <span class="hTo"><span class="muted">→</span> ${lampHtmlFS(a.lamp)}</span>` : `<span class="muted">${lampFS(a.lamp)}</span>`;
		const g = (v) => v.grade ? `<span style="color:var(--g-${v.grade})">${v.grade}</span>` : "";
		const grade = !a.grade ? "" : b && b.grade && b.grade !== a.grade ? `${g(b)} <span class="muted">→</span> ${g(a)}` : g(a);
		const diff = (n, good) => `<span class="hDiff ${good ? "hUp" : "hDown"}"><span class="paren">(</span>${signed(n)}<span class="paren">)</span></span>`;
		const ex = `${a.ex}${b && x.exDiff ? diff(x.exDiff, x.exDiff > 0) : ""}`;
		const miss = a.miss == null ? "-" : `${a.miss}${x.missDiff ? diff(x.missDiff, x.missDiff < 0) : ""}`;
		return `<td class="hLamp">${lamp}</td><td class="num hGrade">${grade}</td><td class="num">${ex}</td><td class="num">${miss}</td>`;
	}
	const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
	/**
	 * 日ごとの成果（ランプ更新・スコア更新の件数）の縦棒グラフ。遊んだ日だけを並べる（直近30日分、古い順）。
	 * 色は dataviz スキルの既定パレット 1・2 番（ビューアの背景 #070f27 に対して検証済み）
	 */
	function histChartHtml(sessions, style) {
		const days = new Map();
		for (const s of sessions) {
			if (s.baseline) continue;
			const k = dayKey(s.at);
			const d = days.get(k) || { k, at: s.at, lamp: 0, ex: 0 };
			for (const x of s.changes) {
				if (x.style !== style) continue;
				if (x.lampUp) d.lamp++;
				if (x.exDiff > 0) d.ex++;
			}
			days.set(k, d);
		}
		const list = [...days.values()].sort((a, b) => a.k.localeCompare(b.k)).slice(-30);
		if (!list.length) return "";
		// 目盛りは 1・2・5 の倍数で4本前後
		const max = Math.max(1, ...list.flatMap((d) => [d.lamp, d.ex]));
		const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => max / s <= 4) || 1000;
		const top = step * Math.ceil(max / step);
		const L = 30, T = 8, PH = 140, B = 22, SLOT = 48, BW = 16, GAP = 2;
		const W = L + list.length * SLOT + 8, H = T + PH + B;
		const y = (v) => T + PH - (v / top) * PH;
		const bar = (x, v, cls) => {
			if (!v) return "";
			const y0 = T + PH, y1 = y(v), r = Math.min(4, y0 - y1, BW / 2);
			return `<path class="${cls}" d="M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + BW - r}Q${x + BW},${y1} ${x + BW},${y1 + r}V${y0}Z"/>`;
		};
		let grid = "";
		for (let v = 0; v <= top; v += step) {
			grid += `<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="${v ? "hcGrid" : "hcBase"}"/><text x="${L - 6}" y="${y(v)}" class="hcAxis" text-anchor="end" dominant-baseline="middle">${v}</text>`;
		}
		const cols = list.map((d, i) => {
			const x0 = L + i * SLOT, bx = x0 + (SLOT - BW * 2 - GAP) / 2;
			const date = new Date(d.at);
			return `<g class="hcCol" data-day="${d.k}" data-tip="${date.getMonth() + 1}/${date.getDate()}|${d.lamp}|${d.ex}">
				<rect x="${x0}" y="${T}" width="${SLOT}" height="${PH + B}" class="hcHit"/>
				${bar(bx, d.lamp, "hcLamp")}${bar(bx + BW + GAP, d.ex, "hcEx")}
				<text x="${x0 + SLOT / 2}" y="${T + PH + 15}" class="hcAxis" text-anchor="middle">${date.getMonth() + 1}/${date.getDate()}</text>
			</g>`;
		}).join("");
		return `<section class="hChart">
			<div class="hcHead"><span class="hcTitle">日ごとの成果</span>
				<span class="hcLegend"><i class="hcLamp"></i>ランプ更新<i class="hcEx"></i>スコア更新</span></div>
			<div class="hcScroll"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="日ごとのランプ更新数とスコア更新数">${grid}${cols}</svg></div>
			<div class="hcTip" hidden></div>
		</section>`;
	}
	const chartCell = (x) => `<td class="prTitle"><span class="lvb" style="--dc:var(--d-${x.diff})">${x.level}<small>${esc(x.key)}</small></span>${esc(x.title)}</td>`;
	function renderHistory() {
		const f = state.f;
		const on = f.view === "history";
		$("#historyView").hidden = !on;
		if (!on) return;
		for (const b of $("#histStyleSeg").children) b.setAttribute("aria-checked", b.dataset.v === f.style);
		if (state.guest) { $("#histBody").innerHTML = `<p class="empty">プレイリザルトを読み込むと表示されます。</p>`; return; }
		const sessions = state.histSessions || [];
		if (!sessions.length) {
			$("#histBody").innerHTML = `<p class="empty">まだ履歴がありません。INFINITAS を終了してアップロードされると、ここに出ます。</p>`;
			return;
		}
		// 各回は見出し（日付・ランプ更新・スコア更新）だけを出し、押すと曲が開く（2026-11-19。PC だけ。スマホは最初から開いておく）。
		// 開いている回は state.hsOpen（回の at）で覚え、SP/DP の切り替えなどで描き直しても閉じない
		const mobile = window.matchMedia("(max-width: 640px)").matches;
		state.hsOpen = state.hsOpen || new Set();
		$("#histBody").innerHTML = histChartHtml(sessions, f.style) + sessions.map((s) => {
			const when = `<span class="num">${dateText(s.at)}</span>`;
			if (s.baseline) {
				return `<section class="hSession" data-day="${dayKey(s.at)}"><h3>${when}<span class="muted">記録開始（${s.count} 譜面）。ここから先の変化を記録します</span></h3></section>`;
			}
			const list = s.changes.filter((x) => x.style === f.style);
			const lampN = list.filter((x) => x.lampUp).length;
			const exN = list.filter((x) => x.exDiff > 0).length;
			// ノーツレーダーが上がった回は見出しに「ノーツレーダー更新」、表の一番右に上げた譜面の項目と値（2026-11-21。PC だけ）
			const radarUp = (s.radarUp || []).some((r) => r.style === f.style);
			const radarCell = (x) => !radarUp ? "" : `<td class="hRadar">${(x.radarUp || []).map((r) =>
				`<div>${r.f} <span class="num">${r.before.toFixed(2)}</span> <span class="muted">→</span> <span class="num hUp">${r.after.toFixed(2)}</span></div>`).join("")}</td>`;
			const rows = list.map((x) => `<tr${x.c ? ` data-id="${esc(x.id)}"` : ""}>${chartCell(x)}${changeCells(x)}${radarCell(x)}</tr>`).join("");
			const open = mobile || state.hsOpen.has(s.at) ? " open" : "";
			return `<details class="hSession" data-day="${dayKey(s.at)}" data-at="${esc(s.at)}"${open}><summary><h3>${when}<span>ランプ更新 <b class="num">${lampN}</b></span><span>スコア更新 <b class="num">${exN}</b></span>${radarUp ? `<span class="hRadarUp">ノーツレーダー更新</span>` : ""}</h3></summary>
				${list.length ? `<div style="overflow-x:auto"><table class="prTable hTable"><thead><tr><th>譜面</th><th>ランプ</th><th>DJ LEVEL</th><th>EX SCORE</th><th>MISS COUNT</th>${radarUp ? `<th class="hRadar">RADAR UPDATE</th>` : ""}</tr></thead><tbody>${rows}</tbody></table></div>`
					: `<p class="muted hNone">${f.style} の変化はありません</p>`}
			</details>`;
		}).join("");
		for (const d of $("#histBody").querySelectorAll("details.hSession")) {
			d.addEventListener("toggle", () => { if (!mobile) state.hsOpen[d.open ? "add" : "delete"](d.dataset.at); });
		}
		const sc = $("#histBody .hcScroll");
		if (sc) sc.scrollLeft = sc.scrollWidth; // 新しい日（右端）を見せる
	}
	/** 詳細モーダル用: その譜面の変化を新しい順に */
	function songHistoryHtml(c) {
		const rows = [];
		for (const s of state.histSessions || []) {
			for (const x of s.changes) {
				if (x.title === c.title && x.key === c.key) rows.push(`<tr><td class="num">${dateText(s.at)}</td>${changeCells(x)}</tr>`);
			}
		}
		if (!rows.length) return "";
		return `<div class="dhist"><div class="radarCaption muted">HISTORY</div><div style="overflow-x:auto"><table class="dtable">
			<thead><tr><th>日付</th><th>ランプ</th><th>DJ LEVEL</th><th>EX SCORE</th><th>MISS<span class="dMissCount"> COUNT</span></th></tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
	}

	// ---------- プレイヤーのノーツレーダー ----------
	/** 「伸ばすなら」欄（クリア済みの EX スコアを伸ばす）: あと何点で10位に入れるか */
	function recScoreHtml(r) {
		const rows = r.list.map((x) => `<tr data-id="${esc(x.c.id)}">
			<td class="prTitle"><span class="lvb" style="--dc:var(--d-${x.c.diff})">${x.c.level}<small>${x.c.key}</small></span>${esc(x.c.title)}</td>
			<td class="num">${x.radar.toFixed(2)}</td>
			<td class="num muted">${(x.c.rate * 100).toFixed(1)}%</td>
			<td class="num">${(x.needRate * 100).toFixed(1)}%</td>
			<td class="num prGain" title="今の EX ${x.c.ex} → ${x.c.ex + x.needEx}">あと +${x.needEx}</td>
		</tr>`).join("");
		return `<div class="prRec"><div class="prRecHead">伸ばすなら <span class="muted">（クリア済みの EX スコアを伸ばす・10位のボーダー ${r.border.toFixed(2)}）</span></div>
			<table class="prTable"><thead><tr><th>譜面</th><th>レーダー</th><th>今のレート</th><th>必要レート</th><th>EX スコア</th></tr></thead>
			<tbody>${rows || `<tr><td colspan="5" class="muted">クリア済みの譜面で10位に届くものはありません</td></tr>`}</tbody></table></div>`;
	}
	/** 「伸ばすなら」欄: いつものレートで遊べば10位を超えそうな譜面と、上がりそうな幅 */
	function recHtml(r) {
		const rows = r.list.map((x) => `<tr data-id="${esc(x.c.id)}">
			<td class="prTitle"><span class="lvb" style="--dc:var(--d-${x.c.diff})">${x.c.level}<small>${x.c.key}</small></span>${esc(x.c.title)}</td>
			<td class="num">${x.radar.toFixed(2)}</td>
			<td class="num" title="この譜面で10位に入るのに必要なスコアレート">${(x.needRate * 100).toFixed(1)}%</td>
			<td class="num muted" title="今のベスト（未プレイは —）">${x.c.played ? (x.c.rate * 100).toFixed(1) + "%" : "—"}</td>
			<td class="num prGain">+${x.gain.toFixed(2)}</td>
		</tr>`).join("");
		return `<div class="prRec"><div class="prRecHead">伸ばすなら <span class="muted">（10位のボーダー ${r.border.toFixed(2)}）</span></div>
			<table class="prTable"><thead><tr><th>譜面</th><th>レーダー</th><th>必要レート</th><th>今のベスト</th><th>見込み</th></tr></thead>
			<tbody>${rows || `<tr><td colspan="5" class="muted">いつものレートで上がりそうな譜面はありません</td></tr>`}</tbody></table></div>`;
	}
	function renderPlayerRadar() {
		const f = state.f;
		const on = f.view === "radar";
		$("#radarView").hidden = !on;
		if (!on) return;
		for (const b of $("#radarStyleSeg").children) b.setAttribute("aria-checked", b.dataset.v === f.style);
		if (state.guest) { $("#radarBody").innerHTML = `<p class="empty">プレイリザルトを読み込むと表示されます。</p>`; return; }
		const pr = M.playerRadar(state.charts, f.style);
		for (const b of $("#recModeSeg").children) b.setAttribute("aria-checked", b.dataset.v === f.recMode);
		const rec = f.recMode === "score" ? M.radarRecommendScore(state.charts, f.style, pr) : M.radarRecommend(state.charts, f.style, pr);
		const vals = Object.fromEntries(M.RADAR_FIELDS.map((k) => [k, pr[k].value]));
		const fmt = (v) => v.toFixed(2);
		const cards = M.RADAR_FIELDS.map((k) => {
			const rows = pr[k].top.map((x, i) => `<tr data-id="${esc(x.c.id)}">
				<td class="num">${i + 1}</td>
				<td class="prTitle"><span class="lvb" style="--dc:var(--d-${x.c.diff})">${x.c.level}<small>${x.c.key}</small></span>${esc(x.c.title)}</td>
				<td class="num">${fmt(x.radar)}</td><td class="num">${(x.rate * 100).toFixed(2)}%</td><td class="num prScore">${fmt(x.score)}</td>
			</tr>`).join("");
			return `<section class="prCard">
				<h3>${k}<b class="num">${fmt(pr[k].value)}</b></h3>
				<table class="prTable"><thead><tr><th>#</th><th>譜面</th><th>レーダー</th><th>レート</th><th>値</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="muted">プレイ済みの譜面がありません</td></tr>`}</tbody></table>
				${f.recMode === "score" ? recScoreHtml(rec[k]) : recHtml(rec[k])}
			</section>`;
		}).join("");
		$("#radarBody").innerHTML = `<div class="prRadarRow"><div class="prRadar">${radarSvg(vals, {}, "PLAYER NOTES RADAR", 1.4, false, undefined, window.matchMedia("(min-width: 641px)").matches ? 92 : 72)}</div></div>` + `<div class="prCards">${cards}</div>`;
	}

	// ---------- フォルダ ----------
	// 上の絞り込み（SP/DP・LV・譜面・検索・並べ替え・条件）が効く。フォルダを押すとその下に中身を開く（アコーディオン。もう一度押すと閉じる）
	function renderFolders() {
		const f = state.f;
		const isFd = f.view === "folder";
		$("#folderView").hidden = !isFd;
		for (const id of ["#summary", "#list", "#sentinel"]) $(id).hidden = isFd;
		if (isFd) $("#empty").hidden = true;
		if (!isFd) return;
		const base = M.filter(state.charts, f);
		const byFolder = new Map();
		for (const c of base) {
			if (!byFolder.has(c.folder)) byFolder.set(c.folder, []);
			byFolder.get(c.folder).push(c);
		}
		const lampOrder = [...M.LAMPS].reverse().concat(M.LOCKED);
		const stats = (items) => {
			const s = M.summarize(items);
			const bar = state.guest ? "" : `<div class="bar fdBar">${lampOrder.filter((l) => s.lamps[l] > 0).map((l) =>
				`<span style="flex:${s.lamps[l]};background:var(--l-${cssKey(l)})" title="${esc(l === M.LOCKED ? "未解禁" : M.LAMP_SHORT[l])}: ${s.lamps[l]}"></span>`).join("")}</div>`;
			return `<span class="fdCount num"><b>${items.length}</b> 譜面</span>${bar}`;
		};
		const rows = [...byFolder.keys()].sort(M.folderOrder).map((name) => {
			const open = name === f.fdOpen;
			const row = `<button type="button" class="fdRow${open ? " open" : ""}" data-folder="${esc(name)}" aria-expanded="${open}"><span class="fdName">${esc(name)}</span>${stats(byFolder.get(name))}</button>`;
			if (!open) return row;
			const items = M.sort(byFolder.get(name), f.sort, f.dir, f.rival);
			return row + `<div class="list fdList">${items.map(rowHtml).join("")}</div>`;
		}).join("");
		$("#folderView").innerHTML = rows || `<p class="empty">条件に合う譜面がありません。</p>`;
	}

	// ---------- 地力表 ----------
	/** 地力表の上の「次に狙う」欄。最初は10譜面、「もっと見る」で10譜面ずつ増やす（state.abCandN） */
	function abCandHtml(list, mode, goal) {
		const n = state.abCandN || 10;
		const head = mode === "hard" ? "H" : "N";
		// 最終プレー日（今年なら「11/17」、去年以前は「2025/7/22」）
		const thisYear = String(new Date().getFullYear());
		const playDay = (s) => (!s ? "" : s.startsWith(thisYear) ? csvTime(s).split(" ")[0] : s.slice(0, 10).replace(/-0?/g, "/"));
		const rows = list.slice(0, n).map(({ c, tier }) => `<tr data-id="${esc(c.id)}">
			<td class="prTitle"><span class="lvb" style="--dc:var(--d-${c.diff})">${c.level}<small>${esc(c.key)}</small></span>${esc(c.title)}</td>
			<td class="abcTier"><span class="tag tier-${tierClass(tier)}">${head}${esc(tier)}</span></td>
			<td class="abcLamp">${lampHtml(c.lamp)}</td>
			<td class="num">${c.miss == null ? "-" : c.miss}</td>
			<td class="abcPlay">${c.plays ? `<span class="abcN">${c.plays}</span><small>回</small><span class="muted">${esc(playDay(c.lastPlay))}</span>` : "-"}</td>
		</tr>`).join("");
		const more = list.length > n ? `<button type="button" class="abcMore">もっと見る（残り ${list.length - n}）</button>` : "";
		return `<section class="abCand"><div class="prRecHead">次に狙う <span class="muted">（${esc(goal)} 未達成。${head}地力の低さ 2 : プレー回数の少なさ 1 で並べる）</span></div>
			${list.length ? `<table class="prTable abcTable"><thead><tr><th>譜面</th><th>${head}地力</th><th>ランプ</th><th>MISS COUNT</th><th>PLAY</th></tr></thead><tbody>${rows}</tbody></table>${more}`
				: `<p class="muted hNone">${esc(goal)} 未達成の譜面はありません</p>`}
		</section>`;
	}
	function renderAbility() {
		const f = state.f;
		const isAb = f.view === "ability";
		$("#abilityView").hidden = !isAb;
		$("#listView").hidden = isAb || f.view === "radar" || f.view === "history";
		for (const b of $("#viewTabs").children) b.setAttribute("aria-selected", b.dataset.view === f.view);
		for (const b of $("#abModeSeg").children) b.setAttribute("aria-checked", b.dataset.v === f.abMode);
		if (!isAb) return;
		const groups = M.abilityGroups(state.charts, f.abMode);
		const goal = M.ABILITY_GOAL[f.abMode]; // 一覧と同じく略さない（HARD CLEAR など）
		const total = groups.reduce((n, g) => n + g.items.length, 0);
		const done = groups.reduce((n, g) => n + g.done, 0);
		$("#abTotal").innerHTML = total && !state.guest ? `${esc(goal)} 以上 <b class="num">${done}</b> / <span class="num">${total}</span>` : "";
		$("#abEmpty").hidden = total > 0;
		$("#abCand").innerHTML = state.guest || !total ? "" : abCandHtml(M.abilityCandidates(state.charts, f.abMode), f.abMode, M.ABILITY_CAND_GOAL[f.abMode]);
		$("#abGroups").innerHTML = groups.map((g) => {
			const s = M.summarize(g.items);
			const bar = state.guest ? "" : `<div class="bar abBar">${[...M.LAMPS].reverse().concat(M.LOCKED).filter((l) => s.lamps[l] > 0).map((l) =>
				`<span style="flex:${s.lamps[l]};background:var(--l-${cssKey(l)})" title="${esc(l === M.LOCKED ? "未解禁" : M.LAMP_SHORT[l])}: ${s.lamps[l]}"></span>`).join("")}</div>`;
			const tiles = g.items.map((c) => {
				const lampName = c.lamp === M.LOCKED ? "未解禁" : c.lamp; // 一覧と同じく略さない（HARD CLEAR / EX HARD CLEAR など）
				return `<button type="button" class="abTile L-${cssKey(c.lamp)}" data-id="${esc(c.id)}" style="--lc:var(--l-${cssKey(c.lamp)})" title="${esc(c.title)}${c.diff !== "A" ? ` (${M.DIFF_NAMES[c.diff]})` : ""}">
					<span class="t">${esc(c.title)}${c.diff !== "A" ? `<span class="tag abDiff" style="--dc:var(--d-${c.diff})">${c.diff}</span>` : ""}</span>
					${state.guest ? "" : `<span class="lampname">${esc(lampName)}</span>`}
				</button>`;
			}).join("");
			return `<section class="abGroup">
				<div class="abHead"><span class="tag tier-${tierClass(g.tier)}">${esc(g.tier)}</span>${state.guest ? `<span class="muted num">${g.items.length}</span>` : `<span class="num"><b>${g.done}</b> / ${g.items.length}</span>`}${bar}</div>
				<div class="abTiles">${tiles}</div>
			</section>`;
		}).join("");
	}

	// ---------- ライバル ----------
	function renderRivalView() {
		const f = state.f;
		const on = f.view === "rival";
		$("#rivalView").hidden = !on;
		if (!on) return;
		$("#summary").hidden = true;
		const has = state.rivals.length > 0 && !state.guest;
		$("#rvNone").hidden = has;
		$("#rivalCtl").hidden = !has;
		$("#empty").hidden = !has || state.view.length > 0;
		if (!has) { $("#rivalSum").innerHTML = ""; return; }
		// ライバルごとの勝敗（上の絞り込みだけを効かせた件数）。押すとそのライバルに切り替え
		const rs = M.rivalSummary(M.filter(state.charts, { ...f, rivalResult: "" }), state.rivals.map((r) => r.id));
		$("#rivalSum").innerHTML = rs.map((r) => `<button type="button" class="rsBtn" data-rival="${esc(r.id)}" aria-pressed="${r.id === f.rival}"><b class="num">${esc(r.id)}</b> に <span class="w">WIN ${r.win}</span> / <span class="l">LOSE ${r.lose}</span> / <span class="d">EVEN ${r.draw}</span></button>`).join("");
		$("#rvTotal").textContent = state.view.length;
	}
	/** ライバルタブの1行: 自分とライバルの EX・クリアステータス、差と勝敗 */
	function rivalRowHtml(c) {
		const r = c.rivals.find((x) => x.id === state.f.rival) || {};
		const cls = rivalCls(r);
		const lampName = c.lamp === M.LOCKED ? "未解禁" : c.lamp;
		const me = c.played ? `<span class="rvEx">${c.ex}</span>${rivalLampHtml(c.lamp)}` : `<span class="rvEx muted">-</span><span class="rvlamp muted">${esc(lampName)}</span>`;
		return `<article class="item rvItem L-${cssKey(c.lamp)}" data-id="${esc(c.id)}" style="--lc:var(--l-${cssKey(c.lamp)});--dc:var(--d-${c.diff})">
			<div class="lampbar" title="${esc(lampName)}"></div>
			<div class="lv">${c.level}<small>${c.key}</small></div>
			<div class="main">
				<div class="title">${esc(c.title)}</div>
				<div class="rvInfo">
					<div class="sub"><span><b>${esc(c.bpm)}</b> BPM</span><span><b>${c.notes}</b> NOTES</span></div>
					<div class="rvCmp num">
						<span class="rvWho">${esc(state.id)}</span>${me}
						<span class="rvWho">${esc(r.id || "")}</span><span class="rvEx">${r.ex ?? "-"}</span>${rivalLampHtml(r.lamp)}
					</div>
				</div>
			</div>
			<div class="rvRes ${cls}">${cls ? `<b>${RIVAL_RESULT[cls]}</b><span class="num">${r.diff > 0 ? "+" : ""}${r.diff}</span>` : ""}</div>
		</article>`;
	}

	function renderMore() {
		const next = state.view.slice(state.shown, state.shown + PAGE);
		if (!next.length) return;
		$("#list").insertAdjacentHTML("beforeend", next.map(state.f.view === "rival" ? rivalRowHtml : rowHtml).join(""));
		state.shown += next.length;
	}

	const RADAR_SHORT = { NOTES: "NOTES", PEAK: "PEAK", SCRATCH: "SCRATCH", "SOF-LAN": "SOF-LAN", CHARGE: "CHARGE", CHORD: "CHORD" };
	/** ゲームのノーツレーダーと同じく、HCN・HBSS のどちらかがあれば CHARGE の下に「HELL」と出す */
	const hellOf = (c) => ({ CHARGE: c.hell });
	/** 一番大きい項目（ゲームと同じく項目名の前に★を付け、その項目の色で表示する） */
	// ゲームの選曲画面のノーツレーダーの文字色（録画 Replay 2026-10-14 12-20-48.mp4 から測定）
	const RADAR_COLOR = { NOTES: "#f6668c", PEAK: "#ec8662", SCRATCH: "#e05a62", "SOF-LAN": "#6a9fd8", CHARGE: "#7d5fe4", CHORD: "#abe583" };
	/** 最大項目に付ける★の色（ゲームでは項目の色ではなく黄色っぽい星） */
	const RADAR_STAR = "#ffe066";
	const radarTop = (r) => Object.keys(RADAR_COLOR).reduce((a, b) => ((Number(r[b]) || 0) > (Number(r[a]) || 0) ? b : a));
	/** extra はレーダーの枠の右に並べる HTML（地力タグ） */
	function radarMiniHtml(c, extra = "") {
		const r = c.radar;
		if (!r) return extra;
		const entries = Object.keys(RADAR_SHORT).map((k) => ({ key: k, label: RADAR_SHORT[k], v: Number(r[k]) || 0 }));
		const top = radarTop(r);
		// 上の行に項目名（全項目その項目の色。最大の項目は前に黄色の★）、下の行に数値。HELL の札は一覧には出さない（詳細のチャートだけ）
		const parts = entries.map(({ key, label, v }) => {
			const name = key === top
				? `<span class="rl rmax" style="color:${RADAR_COLOR[key]}"><span style="color:${RADAR_STAR}">★</span>${label}</span>`
				: `<span class="rl" style="color:${RADAR_COLOR[key]}">${label}</span>`;
			return `<span class="ri">${name}<span class="rv">${v % 1 === 0 ? v : v.toFixed(2)}</span></span>`;
		});
		return `<div class="radarRow"><div class="radarBox num">${parts.join("")}</div>${extra}</div>`;
	}
	function tierClass(tier) {
		const m = /([SABCDEF]\+?)$/.exec(tier || "");
		return m ? m[1].replace("+", "p") : "";
	}
	function abilityHtml(c) {
		const a = c.ability;
		if (!a) return "";
		const nomage = a.NOMAGE_TIER && a.NOMAGE_TIER !== "未定" ? a.NOMAGE_TIER : "";
		const hard = a.HARD_TIER && a.HARD_TIER !== "未定" ? a.HARD_TIER : "";
		if (!nomage && !hard) return "";
		// 表記は「N地力A+」「H個人差S」（N=ノマゲ、H=ハード）
		const tag = (label, title, tier) => tier ? `<span class="tag tier-${tierClass(tier)}" title="${esc(title)} ${esc(tier)}">${esc(label)}${esc(tier)}</span>` : "";
		return `<div class="abilityRow">${tag("N", "ノマゲ", nomage)}${tag("H", "ハード", hard)}</div>`;
	}
	/** ライバルとの勝敗（w=勝ち l=負け d=同点、自分が未プレイなら ""）と表示名 */
	const rivalCls = (r) => r.diff == null ? "" : r.diff > 0 ? "w" : r.diff < 0 ? "l" : "d";
	const RIVAL_RESULT = { w: "WIN", l: "LOSE", d: "EVEN" };
	/** ライバルのクリアステータス（ランプと同じ色の文字） */
	const rivalLampHtml = (lamp) => lamp ? `<span class="rvlamp" style="color:var(--lt-${cssKey(lamp)}, var(--l-${cssKey(lamp)}))"><span class="lampFull">${esc(lamp)}</span><span class="lampShort">${esc(M.LAMP_SHORT[lamp] || lamp)}</span></span>` : "";
	function rowHtml(c) {
		const lampName = c.lamp === M.LOCKED ? "未解禁" : c.lamp;
		// スマホはランプ名を略記（スコア欄を細くしたため。2026-11-21）
		const lampTxt = `<span class="lampFull">${esc(lampName)}</span><span class="lampShort">${esc(M.LAMP_SHORT[c.lamp] || lampName)}</span>`;
		let score = `<span class="lampname">${lampTxt}</span>`;
		if (c.played) {
			score = `
				<div class="gradeBox"><div class="grade" style="--gc:var(--g-${c.grade})">${c.grade}</div><div class="rate gradeNext">${esc(state.f.sort === "nextGrade" && c.nextGap != null && c.nextGrade !== "MAX" ?`${c.nextGrade}-${c.nextGap}` : c.gradeDetail)}</div></div>
				<div><div class="ex">${c.ex}<small> /${c.notes * 2}</small></div>
				<div class="rate">${(c.rate * 100).toFixed(2)}%</div>
				${c.miss != null ? `<div class="rate"><span class="missFull">MISS COUNT</span><span class="missShort">MISS</span> ${c.miss}</div>` : ""}
				<div class="lampname">${lampTxt}</div></div>`;
		}
		// ライバルとの比較はライバルタブに出す（一覧がうるさくなるので、ここには出さない）
		return `<article class="item L-${cssKey(c.lamp)}" data-id="${esc(c.id)}" style="--lc:var(--l-${cssKey(c.lamp)});--dc:var(--d-${c.diff})">
			<div class="lampbar" title="${esc(lampName)}"></div>
			<div class="lv">${c.level}<small>${c.key}</small></div>
			<div class="main">
				<div class="title">${esc(c.title)}</div>
				<div class="sub"><span><b>${esc(c.bpm)}</b> BPM</span><span><b>${c.notes}</b> NOTES</span></div>
				${radarMiniHtml(c, abilityHtml(c))}
			</div>
			<div class="score">${score}</div>
		</article>`;
	}

	function distHtml(kind, items, total, selected) {
		const dim = selected.size ? " dim" : "";
		const bar = items.filter((it) => it.n > 0).map((it) =>
			`<span class="${selected.has(it.v) ? "on" : ""}" data-${kind}="${esc(it.v)}" style="flex:${it.n};background:${it.color}" title="${esc(it.label)}: ${it.n}（${(it.n / total * 100).toFixed(1)}%）"></span>`).join("");
		const legend = items.map((it) =>
			`<button type="button" data-${kind}="${esc(it.v)}" aria-pressed="${selected.has(it.v)}" class="${it.n ? "" : "zero"}" style="--c:${it.color}"><i></i>${esc(it.label)} <b>${it.n}</b></button>`).join("");
		return `<div class="bar${dim}">${bar}</div><div class="legend">${legend}</div>`;
	}

	function renderSummary() {
		const f = state.f;
		const noLamp = M.filter(state.charts, f, "lamp");
		const noGrade = M.filter(state.charts, f, "grade");
		const s1 = M.summarize(noLamp), s2 = M.summarize(noGrade);
		$("#total").textContent = state.view.length;
		$("#sumNote").textContent = state.guest ? "（楽曲だけ表示中）" : (f.lamps.size || f.grades.size) ? `（ランプ・DJ LEVEL で絞り込み中。バーは絞り込み前の内訳）` : "";
		if (state.guest) {
			$("#lampDist").innerHTML = ""; $("#gradeDist").innerHTML = "";
			return;
		}
		const lampItems = [M.LOCKED, ...M.LAMPS].map((l) => ({ v: l, label: l === M.LOCKED ? "未解禁" : M.LAMP_SHORT[l], n: s1.lamps[l], color: `var(--l-${cssKey(l)})` }));
		$("#lampDist").innerHTML = distHtml("lamp", lampItems, s1.total || 1, f.lamps);
		const gradeItems = [...M.GRADES, "-"].map((g) => ({ v: g, label: g === "-" ? "未プレイ" : g, n: s2.grades[g], color: `var(--g-${g})` }));
		$("#gradeDist").innerHTML = distHtml("grade", gradeItems, s2.total || 1, f.grades);
	}

	function renderControls() {
		const f = state.f;
		for (const b of $("#styleSeg").children) b.setAttribute("aria-checked", b.dataset.v === f.style);
		for (const b of $("#levelChips").children) b.setAttribute("aria-pressed", b.dataset.v === "all" ? !f.levels.size : f.levels.has(Number(b.dataset.v)));
		for (const b of $("#diffChips").children) b.setAttribute("aria-pressed", b.dataset.v === "all" ? !f.diffs.size : f.diffs.has(b.dataset.v));
		$("#sort").value = f.sort;
		$("#dirBtn").textContent = f.dir === "asc" ? "▲" : "▼";
		$("#dirBtn").title = f.dir === "asc" ? "昇順（クリックで降順）" : "降順（クリックで昇順）";
		if ($("#q").value !== f.q) $("#q").value = f.q;
		$("#hideLocked").checked = f.hideLocked;
		const n = [f.hideLocked, f.lamps.size, f.grades.size].filter(Boolean).length;
		$("#moreCount").textContent = n || "";
		for (const b of document.querySelectorAll("[data-preset]")) b.setAttribute("aria-pressed", sameSet(f.lamps, presetLamps(b.dataset.preset)));
		// ライバル（並べ替えの「ライバルとの差順」とライバルの選択はライバルタブだけ）
		const hasRival = state.rivals.length > 0;
		$("#sort").querySelector('[value="rival"]').hidden = !(hasRival && f.view === "rival");
		const rsel = $("#rivalSel");
		const opts = state.rivals.map((r) => `<option>${esc(r.id)}</option>`).join("");
		if (rsel.innerHTML !== opts) rsel.innerHTML = opts;
		rsel.value = f.rival;
		for (const b of $("#rivalResSeg").children) b.setAttribute("aria-checked", b.dataset.v === f.rivalResult);
		$("#rivalBtn").hidden = state.guest;
	}

	const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));
	function presetLamps(p) {
		const upto = { noclear: "CLEAR", nohard: "HARD CLEAR", noexh: "EX HARD CLEAR", nofc: "FULL COMBO" }[p];
		// 例: 未HARD ＝ HARD CLEAR より下のランプ（CLEAR・EASY・ASSIST・FAILED・NO PLAY）。未解禁は含めない
		return new Set(M.LAMPS.slice(0, M.LAMPS.indexOf(upto)));
	}

	// ---------- 詳細 ----------
	const RADAR_FIELDS = ["NOTES", "PEAK", "SCRATCH", "SOF-LAN", "CHARGE", "CHORD"];
	function radarHtml(c) {
		if (!c.radar) return `<p class="muted" style="text-align:center;margin:8px 0;">NOTES RADAR データなし</p>`;
		return radarSvg(c.radar, hellOf(c), "NOTES RADAR", 1.3, true, `var(--d-${c.diff})`);
	}
	/** 六角形のレーダーチャート。r は { NOTES: 数値, … }、hell は { CHARGE: true } のような HELL 札の有無 */
	/** R を指定すると六角形をその半径で描き、枠（viewBox）を六角形と文字がちょうど収まる大きさに詰める（レーダータブの PC 用。2026-11-20） */
	function radarSvg(r, hell, caption, scale = 1, markTop = true, color = "var(--accent)", R = 72) {
		const vals = RADAR_FIELDS.map((f) => Number(r[f]) || 0);
		const top = markTop ? radarTop(r) : "";
		const max = Math.max(200, ...vals.map((v) => Math.ceil(v / 50) * 50));
		// 既定（R=72）は今までどおり 270×240。R を指定したときは左右に項目名・数値が入る分（約 50）だけ空ける
		const W = R === 72 ? 270 : Math.round(2 * ((R + 16) * Math.cos(Math.PI / 6) + 50)), H = R === 72 ? 240 : Math.round(2 * (R + 16 + 12 + 9));
		const cx = W / 2, cy = H / 2;
		const angle = (i) => ((-90 + i * 60) * Math.PI) / 180;
		const axisEnd = (i) => [cx + R * Math.cos(angle(i)), cy + R * Math.sin(angle(i))];
		const dataPt = (i, v) => {
			const rr = R * Math.min(Math.max(v, 0) / max, 1);
			return [cx + rr * Math.cos(angle(i)), cy + rr * Math.sin(angle(i))];
		};
		const anchorOf = (i) => { const d = Math.cos(angle(i)); return d > 0.3 ? "start" : d < -0.3 ? "end" : "middle"; };
		// 背景はゲームの選曲画面に合わせる（録画から測定）: 中は真っ黒、外枠は白い細線、中心から各頂点へ灰色 #4a4a4a の軸、
		// 各頂点の外側に白い短い目盛り。内側の段の線はなし
		// 白い外枠と目盛りの太さ。画面上で 2×scale から 1px 細くする（ユーザー指定）
		const bw = (2 - 1 / scale).toFixed(2);
		const hexPts = RADAR_FIELDS.map((_, i) => axisEnd(i).map((n) => n.toFixed(1)).join(",")).join(" ");
		const ticks = RADAR_FIELDS.map((_, i) => {
			const a = angle(i), [x1, y1] = axisEnd(i);
			return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(cx + (R + 6.5) * Math.cos(a)).toFixed(1)}" y2="${(cy + (R + 6.5) * Math.sin(a)).toFixed(1)}" stroke="#f4feff" stroke-width="${bw}"/>`;
		}).join("");
		const rings = `<polygon points="${hexPts}" fill="#000"/>`;
		const axes = RADAR_FIELDS.map((_, i) => { const [x, y] = axisEnd(i); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#4a4a4a" stroke-width="1.5"/>`; }).join("")
			+ `<polygon points="${hexPts}" fill="none" stroke="#f4feff" stroke-width="${bw}" stroke-linejoin="miter"/>` + ticks;
		const dataPts = RADAR_FIELDS.map((_, i) => dataPt(i, vals[i]).map((n) => n.toFixed(1)).join(",")).join(" ");
		const labels = RADAR_FIELDS.map((f, i) => {
			const a = angle(i);
			const lx = cx + (R + 16) * Math.cos(a), ly = cy + (R + 16) * Math.sin(a);
			const label = f === top
				? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchorOf(i)}" dominant-baseline="middle" fill="${RADAR_COLOR[f]}" font-size="10" font-weight="700"><tspan fill="${RADAR_STAR}">★</tspan>${f}</text>`
				: `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchorOf(i)}" dominant-baseline="middle" fill="${RADAR_COLOR[f]}" font-size="10">${f}</text>`;
			if (!hell[f]) return label;
			// ラベルの下に HELL の札（ゲームと同じく暗い赤の枠に赤い文字）
			// ゲームの札を測った色: 中 #1e0002、枠 #7a1020、文字 #ff5a50（横長の字体で字間を広めに、ほんのり光らせる）
			const w = 42, h = 11, bx = anchorOf(i) === "end" ? lx - w : anchorOf(i) === "start" ? lx : lx - w / 2;
			// 数値（項目名の下）のさらに下に置く
			return label + `<rect x="${bx.toFixed(1)}" y="${(ly + 19).toFixed(1)}" width="${w}" height="${h}" rx="1" fill="#1e0002" stroke="#7a1020" stroke-width="1"/>`
				+ `<text x="${(bx + w / 2).toFixed(1)}" y="${(ly + 25).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#ff5a50" font-family="Saira Semi Expanded, sans-serif" font-size="8.5" font-weight="600" letter-spacing="1.6" style="text-shadow:0 0 3px rgba(255,70,70,.7)">HELL</text>`;
		}).join("");
		const valueLabels = RADAR_FIELDS.map((f, i) => {
			const a = angle(i);
			// 数値は項目名の下（一番上の NOTES だけ項目名の上）に出し、チャートの線に重ねない
			const lx = cx + (R + 16) * Math.cos(a), ly = cy + (R + 16) * Math.sin(a) + (Math.sin(a) < -0.9 ? -12 : 12);
			const v = vals[i];
			return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchorOf(i)}" dominant-baseline="middle" fill="var(--text)" font-size="11" class="num">${v % 1 === 0 ? v : v.toFixed(2)}</text>`;
		}).join("");
		return `<div class="radarWrap">
			<div class="radarCaption muted">${esc(caption)}</div>
			<svg viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}">
				${rings}${axes}
				<polygon points="${dataPts}" fill="${color}" fill-opacity="0.5" stroke="${color}" stroke-opacity="0.9" stroke-width="1" stroke-linejoin="round"/>
				${labels}${valueLabels}
			</svg>
		</div>`;
	}
	/**
	 * 詳細の表の下の VIDEO 欄: その譜面の動画を新しい順に縦に並べる（1行1本「▶ ランプ 日時」）。
	 * ランプは PC では正式名（HARD CLEAR）、スマホでは略記（HARD）。日時は YouTube の公開日時（publishedAt）
	 */
	function songVideosHtml(c) {
		if (!c.videos.length) return "";
		const pad = (n) => String(n).padStart(2, "0");
		const links = c.videos.map((v) => {
			const d = new Date(v.at);
			const date = isNaN(d) ? "" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
			const lamp = `<span class="dvLamp" style="color:var(--lt-${cssKey(v.lamp)}, var(--l-${cssKey(v.lamp)}))"><span class="lampFull">${esc(v.lamp)}</span><span class="lampShort">${esc(M.LAMP_SHORT[v.lamp] || v.lamp)}</span></span>`;
			return `<a class="mv" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.title)}"><span>▶</span>${lamp}<span class="muted num">${date}</span></a>`;
		}).join("");
		// 今のランプが動画のどれよりも上なら、見出しの横に小さく知らせる（撮り直しの目安。PC だけ。2026-11-19 試作）
		const best = Math.max(...c.videos.map((v) => M.LAMPS.indexOf(v.lamp)));
		const note = c.played && c.lampIdx > best ? `<span class="dvNote">${esc(c.lamp)} の動画なし</span>` : "";
		return `<div class="dvideo"><div class="radarCaption muted">VIDEO${note}</div><div class="dvLinks">${links}</div></div>`;
	}
	/** 詳細の RIVAL 欄（PC だけ。ライバル未登録なら出さない）: ライバルごとにランプ・EX SCORE・差 */
	function songRivalHtml(c) {
		if (!state.rivals.length) return "";
		const rows = c.rivals.map((r, i) => {
			const name = `<td>${esc(state.rivals[i].id)}</td>`;
			if (!r.played) return `<tr>${name}<td class="rvRes">-</td><td class="hLamp muted">-</td><td class="num">-</td><td class="num">-</td></tr>`;
			const cls = rivalCls(r);
			const res = r.diff != null ? `<b class="${cls}">${RIVAL_RESULT[cls]}</b>` : "-";
			// 差は「ライバル − 自分」で出す（r.diff は 自分 − ライバル）
			const diff = r.diff != null ? `<span class="${cls}">${-r.diff > 0 ? "+" : ""}${-r.diff}</span>` : "-";
			return `<tr>${name}<td class="rvRes">${res}</td><td class="hLamp">${rivalLampHtml(r.lamp)}</td><td class="num">${r.ex}</td><td class="num">${diff}</td></tr>`;
		}).join("");
		return `<div class="drival"><div class="radarCaption muted">RIVAL</div><div style="overflow-x:auto"><table class="dtable">
			<thead><tr><th>DJ NAME</th><th class="rvRes">WIN/LOSE</th><th class="hLamp">ランプ</th><th>EX SCORE</th><th>差</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
	}
	function openDetail(id) {
		const c = state.charts.find((x) => x.id === id);
		if (!c) return;
		const s = c.song;
		// ライバルは PC・スマホとも表の下の RIVAL 欄に出す（表が右の列に収まらず横スクロールが出たため。スマホも 2026-11-20 から同じ形）
		// 押した譜面だけ出す（同じ曲のほかの難易度は出さない）
		const rows = [c].map((x) => {
			return `<tr style="--dc:var(--d-${x.diff})">
				<td class="dlamp" style="color:var(--lt-${cssKey(x.lamp)}, var(--l-${cssKey(x.lamp)}))">${x.lamp === M.LOCKED ? "未解禁" : lampFS(x.lamp)}</td>
				<td class="num">${x.played ? `<span style="color:var(--g-${x.grade})">${x.grade}</span><span class="muted dsub"><span class="paren">(</span>${esc(x.gradeDetail)}<span class="paren">)</span></span>` : "-"}</td>
				<td class="num">${x.played ? `${x.ex}<span class="muted dsub"><span class="paren">(</span>${(x.rate * 100).toFixed(2)}%<span class="paren">)</span></span>` : "-"}</td>
				<td class="num">${x.miss ?? "-"}</td>${state.csv ? `<td class="num"${x.lastPlay ? ` title="最終プレー ${esc(x.lastPlay)}"` : ""}>${x.plays || "-"}${x.lastPlay ? `<div class="muted dlast">${esc(csvTime(x.lastPlay))}</div>` : ""}</td>` : ""}
			</tr>`;
		}).join("");
		$("#detailBody").innerHTML = `
			<div class="dhead">
				<div class="dsong">
					${s.GENRE ? `<div class="dgenre">${esc(s.GENRE)}</div>` : ""}
					<h2>${esc(s.TITLE)}</h2>
					<div class="dinfo"><span>${esc(s.ARTIST)}</span></div>
					<div class="dbpm"><b>${esc(c.bpm)}</b> BPM</div>
				</div>
				<div class="dchart" style="--dc:var(--d-${c.diff})">
					<div class="dchartName">${c.style} ${M.DIFF_NAMES[c.diff]} <b>${c.level}</b></div>
					<div class="dchartSub"><span><b>${c.notes}</b> NOTES</span></div>
				</div>
			</div>
			<div class="dbody">
			<div class="dleft">${radarHtml(c)}</div>
			<div class="dright">
			<div style="overflow-x:auto"><table class="dtable">
				<thead><tr><th class="dlamp">ランプ</th><th>DJ LEVEL</th><th>EX SCORE</th><th>MISS<span class="dMissCount"> COUNT</span></th>${state.csv ? "<th>PLAY</th>" : ""}</tr></thead>
				<tbody>${rows}</tbody>
			</table></div>
			${songRivalHtml(c)}
			${songVideosHtml(c)}
			${songHistoryHtml(c)}
			</div>
			</div>`;
		$("#detail").showModal();
		// 開いたときに最初のリンク（動画）に枠が付かないよう、自動のフォーカスを外す
		if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
	}

	// ---------- ライバル ----------
	function saveRivals() { IV.api.prefs.set("rivals:" + state.id, state.rivals.map((r) => r.id)); }
	function renderRivalList() {
		$("#rivalList").innerHTML = state.rivals.length
			? state.rivals.map((r) => `<li>${esc(r.id)} <button type="button" data-rm="${esc(r.id)}">外す</button></li>`).join("")
			: `<li class="muted">まだ登録していません</li>`;
	}

	// ---------- 開始 ----------
	function start(id, guest) {
		state.id = guest ? "" : id;
		state.guest = guest;
		state.videos = null;
		state.history = null;
		state.csv = null;
		state.csvChecked = false;
		state.rivals = guest ? [] : (IV.api.prefs.get("rivals:" + id, []) || []).map((rid) => ({ id: rid, csv: null }));
		if (!guest) IV.api.prefs.set("lastId", id);
		$("#userName").textContent = guest ? "ゲスト" : id;
		$("#login").hidden = true;
		$("#app").hidden = false;
		loadAll();
	}

	function showLogin() {
		$("#app").hidden = true;
		$("#login").hidden = false;
		$("#loginId").value = state.id || IV.api.prefs.get("lastId", "");
		$("#loginId").focus();
	}

	function bind() {
		// レベル・難易度のボタン
		$("#levelChips").innerHTML = `<button type="button" class="chip all" data-v="all">ALL</button>` +
			Array.from({ length: 12 }, (_, i) => `<button type="button" class="chip" data-v="${i + 1}">${i + 1}</button>`).join("");
		$("#diffChips").innerHTML = `<button type="button" class="chip all" data-v="all">ALL</button>` +
			M.DIFFS.map((d) => `<button type="button" class="chip" data-v="${d}" style="--c:var(--d-${d})" title="${M.DIFF_NAMES[d]}">${d}</button>`).join("");

		const f = () => state.f;
		const toggle = (set, v, multi) => {
			if (multi) { set.has(v) ? set.delete(v) : set.add(v); }
			else if (set.size === 1 && set.has(v)) { set.clear(); }
			else { set.clear(); set.add(v); }
		};
		// レベル: 各ボタンを押すたびに選択／解除（複数選べる）。ALL で解除
		$("#levelChips").addEventListener("click", (e) => {
			const b = e.target.closest(".chip"); if (!b) return;
			if (b.dataset.v === "all") f().levels.clear();
			else toggle(f().levels, Number(b.dataset.v), true);
			apply();
		});
		$("#diffChips").addEventListener("click", (e) => {
			const b = e.target.closest(".chip"); if (!b) return;
			if (b.dataset.v === "all") f().diffs.clear(); else toggle(f().diffs, b.dataset.v, true);
			apply();
		});

		// 一覧 / 地力表 の切り替え
		$("#viewTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) { f().view = b.dataset.view; if (b.dataset.view === "folder") f().fdOpen = ""; apply(); window.scrollTo(0, 0); } });
		$("#recModeSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { f().recMode = b.dataset.v; apply(); } });
		$("#radarStyleSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { f().style = b.dataset.v; apply(); } });
		$("#radarBody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) openDetail(tr.dataset.id); });
		$("#histStyleSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { f().style = b.dataset.v; apply(); } });
		$("#histBody").addEventListener("click", (e) => {
			const tr = e.target.closest("tr[data-id]"); if (tr) { openDetail(tr.dataset.id); return; }
			// グラフの棒を押すと、その日の回（新しい順なのでその日の最後の回）を開いてスクロール
			const col = e.target.closest(".hcCol");
			const sec = col && document.querySelector(`#histBody .hSession[data-day="${col.dataset.day}"]`);
			if (sec) { if (sec.tagName === "DETAILS") sec.open = true; sec.scrollIntoView({ behavior: "smooth", block: "start" }); }
		});
		// グラフのツールチップ（その日の日付と件数）
		$("#histBody").addEventListener("mousemove", (e) => {
			const tip = $("#histBody .hcTip"); if (!tip) return;
			const col = e.target.closest(".hcCol");
			if (!col) { tip.hidden = true; return; }
			const [date, lamp, ex] = col.dataset.tip.split("|");
			tip.innerHTML = `<b class="num">${esc(date)}</b><span><i class="hcLamp"></i>ランプ更新 <b class="num">${lamp}</b></span><span><i class="hcEx"></i>スコア更新 <b class="num">${ex}</b></span>`;
			tip.hidden = false;
			const box = tip.parentElement.getBoundingClientRect();
			tip.style.left = Math.min(e.clientX - box.left + 12, box.width - tip.offsetWidth - 4) + "px";
			tip.style.top = (e.clientY - box.top + 12) + "px";
		});
		$("#histBody").addEventListener("mouseleave", () => { const tip = $("#histBody .hcTip"); if (tip) tip.hidden = true; });
		$("#abModeSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { f().abMode = b.dataset.v; state.abCandN = 10; apply(); } });
		$("#abCand").addEventListener("click", (e) => {
			if (e.target.closest(".abcMore")) { state.abCandN = (state.abCandN || 10) + 10; renderAbility(); return; }
			const tr = e.target.closest("tr[data-id]"); if (tr) openDetail(tr.dataset.id);
		});
		// フォルダ: 押すと中身を開く／閉じる、曲を押すと詳細
		$("#folderView").addEventListener("click", (e) => {
			if (e.target.closest("a")) return;
			const b = e.target.closest("[data-folder]");
			if (b) {
				const name = b.dataset.folder, before = b.getBoundingClientRect().top;
				f().fdOpen = f().fdOpen === name ? "" : name;
				apply();
				// スマホ: 押した行はその場にとどめ、一覧はその下に開く（上の一覧が閉じて行がずれた分はスクロールで戻す）。
				// 上へ持っていくと固定表示（約 300px）の下に隠れていた（2026-11-21）
				if (window.matchMedia("(max-width: 640px)").matches) {
					const now = [...document.querySelectorAll("#folderView [data-folder]")].find((x) => x.dataset.folder === name);
					if (now) window.scrollBy(0, now.getBoundingClientRect().top - before);
					return;
				}
				// PC: 開いたフォルダの見出しが画面の上に来るように
				const row = f().fdOpen && [...document.querySelectorAll("#folderView [data-folder]")].find((x) => x.dataset.folder === f().fdOpen);
				if (row) row.scrollIntoView({ block: "start" });
				return;
			}
			const it = e.target.closest(".item"); if (it) openDetail(it.dataset.id);
		});
		$("#abGroups").addEventListener("click", (e) => { const t = e.target.closest(".abTile"); if (t) openDetail(t.dataset.id); });
		$("#styleSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { f().style = b.dataset.v; apply(); } });
		let qTimer;
		$("#q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { f().q = e.target.value.trim(); apply(); }, 150); });
		$("#sort").addEventListener("change", (e) => { f().sort = e.target.value; apply(); });
		$("#dirBtn").addEventListener("click", () => { f().dir = f().dir === "asc" ? "desc" : "asc"; apply(); });
		$("#moreBtn").addEventListener("click", () => { const ex = $("#extra"); ex.hidden = !ex.hidden; $("#moreBtn").setAttribute("aria-expanded", !ex.hidden); });
		$("#hideLocked").addEventListener("change", (e) => { f().hideLocked = e.target.checked; apply(); });
		$("#rivalSel").addEventListener("change", (e) => { f().rival = e.target.value; apply(); });
		$("#rivalResSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { f().rivalResult = b.dataset.v; apply(); } });
		$("#rivalSum").addEventListener("click", (e) => { const b = e.target.closest("[data-rival]"); if (b) { f().rival = b.dataset.rival; apply(); } });
		document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
			const set = presetLamps(b.dataset.preset);
			f().lamps = sameSet(f().lamps, set) ? new Set() : set;
			apply();
		}));
		$("#resetBtn").addEventListener("click", () => { state.f = toFilter({ ...DEFAULT, style: f().style, levels: [...f().levels], abMode: f().abMode }); apply(); });
		// 集計バー・凡例のクリックで絞り込み（もう一度押すと解除。Ctrl/Shift で複数）
		$("#summary").addEventListener("click", (e) => {
			const t = e.target.closest("[data-lamp],[data-grade]"); if (!t) return;
			const [set, v] = t.dataset.lamp != null ? [f().lamps, t.dataset.lamp] : [f().grades, t.dataset.grade];
			toggle(set, v, e.ctrlKey || e.metaKey || e.shiftKey);
			apply();
		});
		// 一覧
		$("#list").addEventListener("click", (e) => {
			if (e.target.closest("a")) return;
			const it = e.target.closest(".item"); if (it) openDetail(it.dataset.id);
		});
		new IntersectionObserver((ents) => { if (ents[0].isIntersecting) renderMore(); }, { rootMargin: "600px" }).observe($("#sentinel"));
		// ヘッダー
		$("#reloadBtn").addEventListener("click", () => loadAll(true));
		$("#userBtn").addEventListener("click", showLogin);
		// ログイン
		$("#loginForm").addEventListener("submit", async (e) => {
			e.preventDefault();
			const id = $("#loginId").value.trim();
			if (!id) return;
			$("#loginErr").textContent = "";
			// スコアはドライブの CSV（またはこのブラウザで読み込む CSV）なので、DJ NAME の登録は確かめない
			start(id, false);
		});
		$("#guestBtn").addEventListener("click", () => start("", true));
		// ライバル
		$("#rivalBtn").addEventListener("click", () => { renderRivalList(); $("#rivalErr").textContent = ""; $("#rivalDlg").showModal(); $("#rivalId").focus(); });
		$("#rivalList").addEventListener("click", (e) => {
			const b = e.target.closest("[data-rm]"); if (!b) return;
			state.rivals = state.rivals.filter((r) => r.id !== b.dataset.rm);
			if (f().rival === b.dataset.rm) { f().rival = ""; f().rivalResult = ""; }
			saveRivals(); renderRivalList(); rebuild();
		});
		$("#rivalForm").addEventListener("submit", async (e) => {
			e.preventDefault();
			const id = $("#rivalId").value.trim();
			$("#rivalErr").textContent = "";
			if (!id) return;
			if (id === state.id) { $("#rivalErr").textContent = "自分は追加できません。"; return; }
			if (state.rivals.some((r) => r.id === id)) { $("#rivalErr").textContent = "追加済みです。"; return; }
			try {
				// ライバルもドライブの INFINITAS履歴/<DJ名>/latest.csv と比べる
				let found = false;
				const rv = { id, csv: null };
				await IV.api.loadDriveCsv(id, (data) => { if (data) { found = true; rv.csv = data.csv; } });
				if (!found) { $("#rivalErr").textContent = `「${id}」のスコア CSV がドライブにありません。`; return; }
				state.rivals.push(rv); saveRivals(); renderRivalList();
				$("#rivalId").value = "";
				rebuild();
			} catch (err) {
				$("#rivalErr").textContent = "確認できませんでした。";
			}
		});
		// ダイアログの外をクリックしたら閉じる
		for (const d of document.querySelectorAll("dialog")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
		// ブラウザの戻る・手で # を書き換えたとき
		window.addEventListener("hashchange", () => { state.f = readHash(); apply(); });
		// PC ではタブをヘッダーに入れる（スクロールしても見えるように）。スマホは今までどおり一覧の上
		const pc = window.matchMedia("(min-width: 641px)");
		const placeTabs = () => {
			const nav = $("#viewTabs");
			if (pc.matches) $(".top").insertBefore(nav, $("#rivalBtn"));
			else $("#app").prepend(nav);
		};
		placeTabs();
		pc.addEventListener("change", placeTabs);
	}

	// 起動
	state.f = readHash();
	bind();
	const urlId = new URL(location.href).searchParams.get("id");
	const lastId = IV.api.prefs.get("lastId", "");
	if (new URL(location.href).searchParams.get("guest") === "1") start("", true);
	else if (urlId) start(urlId, false);
	else if (lastId) start(lastId, false);
	else showLogin();
})();
