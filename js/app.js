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

	const DEFAULT = { style: "SP", levels: [12], diffs: [], lamps: [], grades: [], q: "", sort: "level", dir: "asc", folder: "", cn: "", hideLocked: false, rival: "", rivalResult: "" };
	const state = {
		id: "", guest: false,
		music: null, results: null, rivals: [], // rivals: [{ id, results }]
		charts: [], view: [], shown: 0,
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
		for (const [k, key] of [["q", "q"], ["sort", "sort"], ["dir", "dir"], ["ver", "folder"], ["cn", "cn"], ["rv", "rival"], ["rr", "rivalResult"]]) {
			if (p.has(k)) o[key] = p.get(k);
		}
		if (p.has("lock")) o.hideLocked = p.get("lock") === "0";
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
		if (f.folder) p.set("ver", f.folder);
		if (f.cn) p.set("cn", f.cn);
		if (f.hideLocked) p.set("lock", "0");
		if (f.rival) p.set("rv", f.rival);
		if (f.rivalResult) p.set("rr", f.rivalResult);
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
		state.charts = M.build(state.music, state.guest ? null : state.results, state.rivals);
		const folders = [...new Set(state.music.musicList.map((s) => s.FOLDER).filter(Boolean))];
		const sel = $("#folder");
		if (sel.options.length - 1 !== folders.length) {
			sel.innerHTML = `<option value="">すべて</option>` + folders.map((f) => `<option>${esc(f)}</option>`).join("");
			sel.value = state.f.folder;
		}
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
	}

	function renderMore() {
		const next = state.view.slice(state.shown, state.shown + PAGE);
		if (!next.length) return;
		$("#list").insertAdjacentHTML("beforeend", next.map(rowHtml).join(""));
		state.shown += next.length;
	}

	function rowHtml(c) {
		const tags = [c.cn, c.bss].filter(Boolean).map((t) => `<span class="tag ${esc(t)}">${esc(t)}</span>`).join("");
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
				<div class="title">${esc(c.title)}${tags}</div>
				<div class="sub"><span class="num">BPM ${esc(c.bpm)}</span><span class="num">${c.notes} NOTES</span><span class="opt">${esc(c.folder)}</span>${c.mv ? `<a class="mv" href="${esc(c.mv)}" target="_blank" rel="noopener">▶ 動画</a>` : ""}</div>
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
		$("#folder").value = f.folder;
		$("#cn").value = f.cn;
		$("#hideLocked").checked = f.hideLocked;
		const n = [f.folder, f.cn, f.hideLocked, f.lamps.size, f.grades.size, f.rivalResult].filter(Boolean).length;
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
	function openDetail(id) {
		const c = state.charts.find((x) => x.id === id);
		if (!c) return;
		const same = state.charts.filter((x) => x.title === c.title && x.style === c.style);
		const s = c.song;
		const rivalHead = state.rivals.map((r) => `<th>${esc(r.id)}</th>`).join("");
		const rows = same.map((x) => {
			const rv = x.rivals.map((r) => `<td class="num">${r.played ? `${r.ex}${r.diff != null ? ` <span class="${r.diff > 0 ? "w" : r.diff < 0 ? "l" : "d"}">(${r.diff > 0 ? "+" : ""}${r.diff})</span>` : ""}` : "-"}</td>`).join("");
			return `<tr class="${x.id === c.id ? "cur" : ""}" style="--dc:var(--d-${x.diff})">
				<td class="lvcell">${M.DIFF_NAMES[x.diff]} ${x.level}${[x.cn, x.bss].filter(Boolean).map((t) => ` <span class="tag ${esc(t)}">${esc(t)}</span>`).join("")}</td>
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
		// レベル: クリックで1つだけ選ぶ。Ctrl / Shift / 長押しで複数選ぶ
		$("#levelChips").addEventListener("click", (e) => {
			const b = e.target.closest(".chip"); if (!b) return;
			if (b.dataset.v === "all") f().levels.clear();
			else toggle(f().levels, Number(b.dataset.v), e.ctrlKey || e.metaKey || e.shiftKey || multiMode);
			apply();
		});
		$("#diffChips").addEventListener("click", (e) => {
			const b = e.target.closest(".chip"); if (!b) return;
			if (b.dataset.v === "all") f().diffs.clear(); else toggle(f().diffs, b.dataset.v, true);
			apply();
		});
		// スマホ用: レベルを長押しすると複数選択モード
		let multiMode = false, pressTimer;
		$("#levelChips").addEventListener("pointerdown", (e) => {
			const b = e.target.closest(".chip"); if (!b || b.dataset.v === "all") return;
			pressTimer = setTimeout(() => { multiMode = true; toast("複数選択：続けてレベルを押してください"); }, 450);
		});
		$("#levelChips").addEventListener("pointerup", () => clearTimeout(pressTimer));
		document.addEventListener("click", (e) => { if (multiMode && !e.target.closest("#levelChips")) multiMode = false; });

		$("#styleSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { f().style = b.dataset.v; apply(); } });
		let qTimer;
		$("#q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { f().q = e.target.value.trim(); apply(); }, 150); });
		$("#sort").addEventListener("change", (e) => { f().sort = e.target.value; apply(); });
		$("#dirBtn").addEventListener("click", () => { f().dir = f().dir === "asc" ? "desc" : "asc"; apply(); });
		$("#moreBtn").addEventListener("click", () => { const ex = $("#extra"); ex.hidden = !ex.hidden; $("#moreBtn").setAttribute("aria-expanded", !ex.hidden); });
		$("#folder").addEventListener("change", (e) => { f().folder = e.target.value; apply(); });
		$("#cn").addEventListener("change", (e) => { f().cn = e.target.value; apply(); });
		$("#hideLocked").addEventListener("change", (e) => { f().hideLocked = e.target.checked; apply(); });
		$("#rivalSel").addEventListener("change", (e) => { f().rival = e.target.value; if (!f().rival) f().rivalResult = ""; apply(); });
		$("#rivalResult").addEventListener("change", (e) => { f().rivalResult = e.target.value; apply(); });
		document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
			const set = presetLamps(b.dataset.preset);
			f().lamps = sameSet(f().lamps, set) ? new Set() : set;
			apply();
		}));
		$("#resetBtn").addEventListener("click", () => { state.f = toFilter({ ...DEFAULT, style: f().style, levels: [...f().levels] }); apply(); });
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
