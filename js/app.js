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
		music: null, results: null, rivals: [], // rivals: [{ id, results }]
		charts: [], view: [], shown: 0,
		radarMap: new Map(),
		abilityMap: new Map(),
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
		if (p.has("v")) o.view = { ab: "ability", fd: "folder", rd: "radar" }[p.get("v")] || "list";
		if (p.has("abm")) o.abMode = p.get("abm") === "hard" ? "hard" : "nomage";
		if (!["ability", "folder", "radar"].includes(o.view)) o.view = "list";
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
		if (f.rival) p.set("rv", f.rival);
		if (f.rivalResult) p.set("rr", f.rivalResult);
		if (f.view === "ability") p.set("v", "ab");
		if (f.view === "folder") p.set("v", "fd");
		if (f.view === "radar") p.set("v", "rd");
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
	function timeText(at) {
		const d = new Date(at);
		return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	}
	let syncAt = 0; // 最後に最新データを取得した時刻
	function setSync(text) { $("#sync").textContent = text; }

	// ---------- データ読み込み ----------
	function rebuild() {
		if (!state.music) return;
		state.charts = M.build(state.music, state.guest ? null : state.results, state.rivals, state.radarMap, state.abilityMap);
		$("#version").textContent = state.music.version ? `DATA ${state.music.version}` : "";
		apply();
	}

	async function loadAll(force = false) {
		const tasks = [];
		let firstPaint = !state.music;
		if (firstPaint) loading(true, "楽曲データを読み込み中…");
		setSync("更新を確認中…");
		const onMusic = (data, info) => {
			state.music = data;
			if (info.updated) toast("楽曲データを更新しました");
			if (state.guest || state.results) { loading(false); rebuild(); }
		};
		tasks.push(IV.api.loadMusic(onMusic, { force }));
		const onRadar = (data) => {
			state.radarMap = M.radarMap(data);
			if (state.music && (state.guest || state.results)) { rebuild(); }
		};
		tasks.push(IV.api.loadRadar(onRadar, { force }).catch((e) => console.warn("ノーツレーダーの読み込みに失敗しました", e)));
		const onAbility = (data) => {
			state.abilityMap = M.abilityMap(data);
			if (state.music && (state.guest || state.results)) { rebuild(); }
		};
		tasks.push(IV.api.loadAbility(onAbility, { force }).catch((e) => console.warn("地力表の読み込みに失敗しました", e)));
		if (!state.guest) {
			const onResult = (data, info) => {
				if (!Array.isArray(data)) throw new Error(`「${state.id}」のプレイリザルトを読み込めませんでした`);
				state.results = data;
				if (info.updated) toast("プレイリザルトを更新しました");
				if (state.music) { loading(false); rebuild(); }
			};
			tasks.push(IV.api.loadResult(state.id, onResult, { force }));
			for (const rv of state.rivals) {
				tasks.push(IV.api.loadResult(rv.id, (data) => { rv.results = data; rebuild(); }, { force }).catch((e) => toast(`${rv.id} の読み込みに失敗しました`)));
			}
		}
		try {
			await Promise.all(tasks);
			syncAt = Date.now();
			setSync(`${timeText(syncAt)} 時点`);
		} catch (e) {
			console.error(e);
			setSync("更新に失敗しました");
			if (!state.charts.length) {
				loading(false);
				toast(e.message || "データを読み込めませんでした");
			} else {
				toast("最新データを取得できませんでした（保存済みのデータを表示しています）");
			}
		} finally {
			loading(false);
		}
	}

	// ---------- 絞り込み・描画 ----------
	function apply() {
		const f = state.f;
		const base = M.filter(state.charts, f);
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
		renderPlayerRadar();
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
		const vals = Object.fromEntries(M.RADAR_FIELDS.map((k) => [k, Math.round(pr[k].value * 100) / 100]));
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
		$("#radarBody").innerHTML = radarSvg(vals, {}, `${f.style} プレイヤーのノーツレーダー`, 1.4, false) + `<div class="prCards">${cards}</div>`;
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
	function renderAbility() {
		const f = state.f;
		const isAb = f.view === "ability";
		$("#abilityView").hidden = !isAb;
		$("#listView").hidden = isAb || f.view === "radar";
		for (const b of $("#viewTabs").children) b.setAttribute("aria-selected", b.dataset.view === f.view);
		for (const b of $("#abModeSeg").children) b.setAttribute("aria-checked", b.dataset.v === f.abMode);
		if (!isAb) return;
		const groups = M.abilityGroups(state.charts, f.abMode);
		const goal = M.LAMP_SHORT[M.ABILITY_GOAL[f.abMode]];
		const total = groups.reduce((n, g) => n + g.items.length, 0);
		const done = groups.reduce((n, g) => n + g.done, 0);
		$("#abTotal").innerHTML = total && !state.guest ? `${esc(goal)} 以上 <b class="num">${done}</b> / <span class="num">${total}</span>` : "";
		$("#abEmpty").hidden = total > 0;
		$("#abGroups").innerHTML = groups.map((g) => {
			const s = M.summarize(g.items);
			const bar = state.guest ? "" : `<div class="bar abBar">${[...M.LAMPS].reverse().concat(M.LOCKED).filter((l) => s.lamps[l] > 0).map((l) =>
				`<span style="flex:${s.lamps[l]};background:var(--l-${cssKey(l)})" title="${esc(l === M.LOCKED ? "未解禁" : M.LAMP_SHORT[l])}: ${s.lamps[l]}"></span>`).join("")}</div>`;
			const tiles = g.items.map((c) => {
				const lampName = c.lamp === M.LOCKED ? "未解禁" : M.LAMP_SHORT[c.lamp];
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

	function renderMore() {
		const next = state.view.slice(state.shown, state.shown + PAGE);
		if (!next.length) return;
		$("#list").insertAdjacentHTML("beforeend", next.map(rowHtml).join(""));
		state.shown += next.length;
	}

	const RADAR_SHORT = { NOTES: "NOTES", PEAK: "PEAK", SCRATCH: "SCRATCH", "SOF-LAN": "SOF-LAN", CHARGE: "CHARGE", CHORD: "CHORD" };
	/** ゲームのノーツレーダーと同じく、HCN・HBSS のどちらかがあれば CHARGE の下に「HELL」と出す */
	const hellOf = (c) => ({ CHARGE: c.cn === "HCN" || c.bss === "HBSS" });
	/** 一番大きい項目（ゲームと同じく項目名の前に★を付け、その項目の色で表示する） */
	const RADAR_COLOR = { NOTES: "#3fa9ff", PEAK: "#ff8a3d", SCRATCH: "#7ee36b", "SOF-LAN": "#4fd8ff", CHARGE: "#ff3fb0", CHORD: "#c9a7ff" };
	const radarTop = (r) => Object.keys(RADAR_COLOR).reduce((a, b) => ((Number(r[b]) || 0) > (Number(r[a]) || 0) ? b : a));
	function radarMiniHtml(c) {
		const r = c.radar;
		if (!r) return "";
		const entries = Object.keys(RADAR_SHORT).map((k) => ({ key: k, label: RADAR_SHORT[k], v: Number(r[k]) || 0 }));
		const top = radarTop(r);
		// 上の行に項目名（最大の項目は「★名前」をその項目の色で）、下の行に数値。HELL の札は一覧には出さない（詳細のチャートだけ）
		const parts = entries.map(({ key, label, v }) => {
			const name = key === top ? `<span class="rl rmax" style="color:${RADAR_COLOR[key]}">★${label}</span>` : `<span class="rl">${label}</span>`;
			return `<span class="ri">${name}<span class="rv">${v % 1 === 0 ? v : v.toFixed(2)}</span></span>`;
		});
		return `<div class="radarRow"><div class="radarBox num">${parts.join("")}</div></div>`;
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
	function rowHtml(c) {
		const lampName = c.lamp === M.LOCKED ? "未解禁" : c.lamp;
		let score = `<span class="lampname">${esc(lampName)}</span>`;
		if (c.played) {
			score = `
				<div class="grade" style="--gc:var(--g-${c.grade})">${c.grade}</div>
				<div><div class="ex">${c.ex}<small> /${c.notes * 2}</small></div>
				<div class="rate">${(c.rate * 100).toFixed(2)}% ・ ${esc(c.gradeDetail)}</div>
				<span class="lampname">${esc(lampName)}</span>${c.miss != null ? ` <span class="rate">MISS ${c.miss}</span>` : ""}</div>`;
		}
		const rv = c.rivals.filter((r) => r.played).map((r) => {
			const cls = r.diff == null ? "" : r.diff > 0 ? "w" : r.diff < 0 ? "l" : "d";
			const diff = r.diff == null ? "" : ` (${r.diff > 0 ? "+" : ""}${r.diff})`;
			return `<span class="${cls}">${esc(r.id)} ${r.ex}${diff}</span>`;
		}).join("");
		return `<article class="item L-${cssKey(c.lamp)}" data-id="${esc(c.id)}" style="--lc:var(--l-${cssKey(c.lamp)});--dc:var(--d-${c.diff})">
			<div class="lampbar" title="${esc(lampName)}"></div>
			<div class="lv">${c.level}<small>${c.key}</small></div>
			<div class="main">
				<div class="title">${esc(c.title)}</div>
				<div class="sub"><span class="num">BPM ${esc(c.bpm)}</span><span class="num">${c.notes} NOTES</span>${c.mv ? `<a class="mv" href="${esc(c.mv)}" target="_blank" rel="noopener">▶ 動画</a>` : ""}</div>
				${radarMiniHtml(c)}
				${abilityHtml(c)}
			</div>
			<div class="score">${score}</div>
			${rv ? `<div class="rv">${rv}</div>` : ""}
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
			$("#lampDist").innerHTML = ""; $("#gradeDist").innerHTML = ""; $("#rivalSum").innerHTML = "";
			return;
		}
		const lampItems = [M.LOCKED, ...M.LAMPS].map((l) => ({ v: l, label: l === M.LOCKED ? "未解禁" : M.LAMP_SHORT[l], n: s1.lamps[l], color: `var(--l-${cssKey(l)})` }));
		$("#lampDist").innerHTML = distHtml("lamp", lampItems, s1.total || 1, f.lamps);
		const gradeItems = [...M.GRADES, "-"].map((g) => ({ v: g, label: g === "-" ? "未プレイ" : g, n: s2.grades[g], color: `var(--g-${g})` }));
		$("#gradeDist").innerHTML = distHtml("grade", gradeItems, s2.total || 1, f.grades);
		const rs = M.rivalSummary(state.view, state.rivals.map((r) => r.id));
		$("#rivalSum").innerHTML = rs.map((r) => `<span><b class="num">${esc(r.id)}</b> に <span class="w">勝ち ${r.win}</span> / <span class="l">負け ${r.lose}</span> / <span class="d">引き分け ${r.draw}</span></span>`).join("");
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
		const n = [f.hideLocked, f.lamps.size, f.grades.size, f.rivalResult].filter(Boolean).length;
		$("#moreCount").textContent = n || "";
		for (const b of document.querySelectorAll("[data-preset]")) b.setAttribute("aria-pressed", sameSet(f.lamps, presetLamps(b.dataset.preset)));
		// ライバル
		const hasRival = state.rivals.length > 0;
		$("#rivalFilterBox").hidden = !hasRival;
		$("#sort").querySelector('[value="rival"]').hidden = !hasRival;
		const rsel = $("#rivalSel");
		const opts = `<option value="">-</option>` + state.rivals.map((r) => `<option>${esc(r.id)}</option>`).join("");
		if (rsel.innerHTML !== opts) rsel.innerHTML = opts;
		rsel.value = f.rival;
		$("#rivalResult").value = f.rivalResult;
		$("#rivalResult").disabled = !f.rival;
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
		if (!c.radar) return `<p class="muted" style="text-align:center;margin:8px 0;">ノーツレーダーデータなし</p>`;
		return radarSvg(c.radar, hellOf(c), "ノーツレーダー");
	}
	/** 六角形のレーダーチャート。r は { NOTES: 数値, … }、hell は { CHARGE: true } のような HELL 札の有無 */
	function radarSvg(r, hell, caption, scale = 1, markTop = true) {
		const vals = RADAR_FIELDS.map((f) => Number(r[f]) || 0);
		const top = markTop ? radarTop(r) : "";
		const max = Math.max(200, ...vals.map((v) => Math.ceil(v / 50) * 50));
		const cx = 135, cy = 120, R = 72;
		const angle = (i) => ((-90 + i * 60) * Math.PI) / 180;
		const axisEnd = (i) => [cx + R * Math.cos(angle(i)), cy + R * Math.sin(angle(i))];
		const dataPt = (i, v) => {
			const rr = R * Math.min(Math.max(v, 0) / max, 1);
			return [cx + rr * Math.cos(angle(i)), cy + rr * Math.sin(angle(i))];
		};
		const anchorOf = (i) => { const d = Math.cos(angle(i)); return d > 0.3 ? "start" : d < -0.3 ? "end" : "middle"; };
		const rings = [0.25, 0.5, 0.75, 1].map((frac) =>
			`<polygon points="${RADAR_FIELDS.map((_, i) => { const a = angle(i); return `${(cx + R * frac * Math.cos(a)).toFixed(1)},${(cy + R * frac * Math.sin(a)).toFixed(1)}`; }).join(" ")}" fill="none" stroke="var(--line)" stroke-width="1"/>`
		).join("");
		const axes = RADAR_FIELDS.map((_, i) => { const [x, y] = axisEnd(i); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`; }).join("");
		const dataPts = RADAR_FIELDS.map((_, i) => dataPt(i, vals[i]).map((n) => n.toFixed(1)).join(",")).join(" ");
		const labels = RADAR_FIELDS.map((f, i) => {
			const a = angle(i);
			const lx = cx + (R + 16) * Math.cos(a), ly = cy + (R + 16) * Math.sin(a);
			const label = f === top
				? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchorOf(i)}" dominant-baseline="middle" fill="${RADAR_COLOR[f]}" font-size="10" font-weight="700">★${f}</text>`
				: `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchorOf(i)}" dominant-baseline="middle" fill="var(--muted)" font-size="10">${f}</text>`;
			if (!hell[f]) return label;
			// ラベルの下に HELL の札（ゲームと同じく暗い赤の枠に赤い文字）
			// ゲームの札を測った色: 中 #1e0002、枠 #7a1020、文字 #ff5a50（横長の字体で字間を広めに、ほんのり光らせる）
			const w = 42, h = 11, bx = anchorOf(i) === "end" ? lx - w : anchorOf(i) === "start" ? lx : lx - w / 2;
			return label + `<rect x="${bx.toFixed(1)}" y="${(ly + 7).toFixed(1)}" width="${w}" height="${h}" rx="1" fill="#1e0002" stroke="#7a1020" stroke-width="1"/>`
				+ `<text x="${(bx + w / 2).toFixed(1)}" y="${(ly + 13).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#ff5a50" font-family="Saira Semi Expanded, sans-serif" font-size="8.5" font-weight="600" letter-spacing="1.6" style="text-shadow:0 0 3px rgba(255,70,70,.7)">HELL</text>`;
		}).join("");
		const valueLabels = RADAR_FIELDS.map((f, i) => {
			const a = angle(i);
			const [px, py] = dataPt(i, vals[i]);
			const lx = px + 11 * Math.cos(a), ly = py + 11 * Math.sin(a);
			const v = vals[i];
			return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchorOf(i)}" dominant-baseline="middle" fill="var(--text)" font-size="11" class="num">${v % 1 === 0 ? v : v.toFixed(2)}</text>`;
		}).join("");
		return `<div class="radarWrap">
			<div class="radarCaption muted">${esc(caption)}</div>
			<svg viewBox="0 0 270 240" width="${270 * scale}" height="${240 * scale}">
				${rings}${axes}
				<polygon points="${dataPts}" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="1" stroke-linejoin="round"/>
				${labels}${valueLabels}
			</svg>
		</div>`;
	}
	function openDetail(id) {
		const c = state.charts.find((x) => x.id === id);
		if (!c) return;
		const same = state.charts.filter((x) => x.title === c.title && x.style === c.style);
		const s = c.song;
		const rivalHead = state.rivals.map((r) => `<th>${esc(r.id)}</th>`).join("");
		const rows = same.map((x) => {
			const rv = x.rivals.map((r) => `<td class="num">${r.played ? `${r.ex}${r.diff != null ? ` <span class="${r.diff > 0 ? "w" : r.diff < 0 ? "l" : "d"}">(${r.diff > 0 ? "+" : ""}${r.diff})</span>` : ""}` : "-"}</td>`).join("");
			return `<tr class="${x.id === c.id ? "cur" : ""}" style="--dc:var(--d-${x.diff})">
				<td class="lvcell">${M.DIFF_NAMES[x.diff]} ${x.level}</td>
				<td class="num">${x.notes}</td><td class="num">${esc(x.bpm)}</td>
				<td style="color:var(--lt-${cssKey(x.lamp)}, var(--l-${cssKey(x.lamp)}))">${x.lamp === M.LOCKED ? "未解禁" : esc(x.lamp)}</td>
				<td class="num">${x.played ? `${x.grade} ${x.ex}` : "-"}</td>
				<td class="num">${x.played ? `${(x.rate * 100).toFixed(2)}%` : "-"}</td>
				<td class="num">${x.played ? esc(x.gradeDetail) : "-"}</td>
				<td class="num">${x.miss ?? "-"}</td>${rv}
			</tr>`;
		}).join("");
		const mv = same.filter((x) => x.mv).map((x) => `<a class="mv" href="${esc(x.mv)}" target="_blank" rel="noopener">▶ ${x.style}${x.diff} の動画</a>`).join(" ");
		$("#detailBody").innerHTML = `
			<h2>${esc(s.TITLE)}</h2>
			<div class="dinfo"><span>${esc(s.ARTIST)}</span><span>${esc(s.GENRE)}</span><span>${esc(s.FOLDER)}</span><span class="num">TIME ${esc(s.TIME || "-")}</span>${mv}</div>
			${radarHtml(c)}
			<div style="overflow-x:auto"><table class="dtable">
				<thead><tr><th>${c.style}</th><th>NOTES</th><th>BPM</th><th>ランプ</th><th>スコア</th><th>レート</th><th>目安</th><th>MISS</th>${rivalHead}</tr></thead>
				<tbody>${rows}</tbody>
			</table></div>`;
		$("#detail").showModal();
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
		state.results = null;
		state.rivals = guest ? [] : (IV.api.prefs.get("rivals:" + id, []) || []).map((rid) => ({ id: rid, results: null }));
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
		$("#abModeSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { f().abMode = b.dataset.v; apply(); } });
		// フォルダ: 押すと中身を開く／閉じる、曲を押すと詳細
		$("#folderView").addEventListener("click", (e) => {
			if (e.target.closest("a")) return;
			const b = e.target.closest("[data-folder]");
			if (b) {
				f().fdOpen = f().fdOpen === b.dataset.folder ? "" : b.dataset.folder;
				apply();
				// 開いたフォルダの見出しが画面の上に来るように
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
		$("#rivalSel").addEventListener("change", (e) => { f().rival = e.target.value; if (!f().rival) f().rivalResult = ""; apply(); });
		$("#rivalResult").addEventListener("change", (e) => { f().rivalResult = e.target.value; apply(); });
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
			loading(true, "DJ NAMEを確認中…");
			try {
				const ok = await IV.api.checkUser(id);
				loading(false);
				if (!ok) { $("#loginErr").textContent = `「${id}」は登録されていません。`; return; }
				start(id, false);
			} catch (err) {
				loading(false);
				$("#loginErr").textContent = "確認できませんでした。通信状態を確認してください。";
			}
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
				if (!(await IV.api.checkUser(id))) { $("#rivalErr").textContent = `「${id}」は登録されていません。`; return; }
				const rv = { id, results: null };
				state.rivals.push(rv); saveRivals(); renderRivalList();
				$("#rivalId").value = "";
				await IV.api.loadResult(id, (data) => { rv.results = data; rebuild(); });
			} catch (err) {
				$("#rivalErr").textContent = "確認できませんでした。";
			}
		});
		// ダイアログの外をクリックしたら閉じる
		for (const d of document.querySelectorAll("dialog")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
		// ブラウザの戻る・手で # を書き換えたとき
		window.addEventListener("hashchange", () => { state.f = readHash(); apply(); });
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
